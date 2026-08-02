const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FIREFLY_URL = (process.env.FIREFLY_URL || '').replace(/\/$/, '');
const FIREFLY_TOKEN = process.env.FIREFLY_TOKEN || '';

// Function to consolidate (+) and (-) category pairs in SankeyMatic output strings.
function consolidateSankeyData(input) {
  const lines = input.split("\n");
  const lineRegex = /^(.*?)\s*\[([\d\.]+)\]\s*(.*)$/;

  const parsedLines = [];
  const plusEntries = {};  // Keyed by cleaned category name
  const minusEntries = {}; // Keyed by cleaned category name
  const budgetEntries = {};// Keyed by primary budget name

  // --- Step 1: Parse all lines into dynamic objects ---
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const match = trimmed.match(lineRegex);

    if (!match) {
      parsedLines.push({ index, raw: line, isData: false });
      return;
    }

    const [_, source, amountStr, target] = match;
    const amount = parseFloat(amountStr);
    const isPlus = source.includes("(+)") || target.includes("(+)");
    const isMinus = source.includes("(-)") || target.includes("(-)");

    const entry = {
      index,
      source,
      target,
      amount,
      isPlus,
      isMinus,
      isData: true,
      remove: false
    };

    parsedLines.push(entry);

    if (isPlus) {
      const category = source.replace(/\(\+\)/g, "").trim();
      plusEntries[category] = entry;
    } else if (isMinus) {
      const category = target.replace(/\(-\)/g, "").trim();
      const primaryBudget = source.trim(); // e.g. "Shopping", "Health", "[NO BUDGET]"
      minusEntries[category] = { ...entry, primaryBudget };
    } else if (source.trim() === "All Funds") {
      const primaryBudget = target.trim();
      budgetEntries[primaryBudget] = entry;
    }
  });

  // --- Step 2: Perform Reconciliations ---
  Object.keys(plusEntries).forEach(category => {
    const plus = plusEntries[category];
    const minusInfo = minusEntries[category];

    if (!minusInfo) return; // No matching (-) entry found

    const minus = parsedLines[minusInfo.index];
    const primaryBudget = minusInfo.primaryBudget;
    const budgetEntry = budgetEntries[primaryBudget];

    if (minus.amount > plus.amount) {
      // Case 1: (-) > (+)
      const diff = minus.amount - plus.amount;

      // 1. Subtract (+) from Category (-)
      minus.amount = parseFloat(diff.toFixed(2));

      // 2. Subtract (+) from All Funds [Value] Primary
      if (budgetEntry) {
        budgetEntry.amount = parseFloat((budgetEntry.amount - plus.amount).toFixed(2));
      }

      // 3. Remove Category (+) [Value] All Funds
      plus.remove = true;

    } else if (plus.amount > minus.amount) {
      // Case 2: (+) > (-)
      const diff = plus.amount - minus.amount;

      // 1. Subtract (-) from Category (+)
      plus.amount = parseFloat(diff.toFixed(2));

      // 2. Subtract (-) from All Funds [Value] Primary
      if (budgetEntry) {
        budgetEntry.amount = parseFloat((budgetEntry.amount - minus.amount).toFixed(2));
      }

      // 3. Remove Primary [Value] Category (-)
      minus.remove = true;

    } else {
      // Case 3: Equal values
      if (budgetEntry) {
        budgetEntry.amount = parseFloat((budgetEntry.amount - plus.amount).toFixed(2));
      }
      plus.remove = true;
      minus.remove = true;
    }
  });

  // --- Step 3: Format and Reconstruct Output ---
  return parsedLines
    .filter(item => !item.remove)
    .map(item => {
      if (!item.isData) return item.raw;
      return `${item.source} [${item.amount.toFixed(2)}] ${item.target}`;
    })
    .join("\n");
}

// 1. Connection check endpoint
app.get('/api/health', async (req, res) => {
  if (!FIREFLY_URL || !FIREFLY_TOKEN) {
    return res.status(400).json({ 
      connected: false, 
      message: 'Missing FIREFLY_URL or FIREFLY_TOKEN environment variables.' 
    });
  }

  try {
    const response = await fetch(`${FIREFLY_URL}/api/v1/about`, {
      headers: {
        'Authorization': `Bearer ${FIREFLY_TOKEN}`,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const data = await response.json();
      return res.json({ 
        connected: true, 
        version: data.data?.version || 'Connected' 
      });
    } else {
      return res.status(response.status).json({ 
        connected: false, 
        message: `HTTP ${response.status}: Failed to authenticate with Firefly III.` 
      });
    }
  } catch (err) {
    return res.status(500).json({ 
      connected: false, 
      message: `Could not reach server: ${err.message}` 
    });
  }
});

// 2. Generate Sankey data endpoint
app.post('/api/generate', (req, res) => {
  const { startDate, endDate, withAssets, withAccounts } = req.body;

  let cmd = `npx firefly-iii-sankey -u "${FIREFLY_URL}" -t "${FIREFLY_TOKEN}" -f sankeymatic`;

  if (startDate) cmd += ` --start ${startDate}`;
  if (endDate) cmd += ` --end ${endDate}`;
  if (withAssets) cmd += ` --with-assets`;
  if (withAccounts) cmd += ` --with-accounts`;

  exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      return res.status(500).json({ error: stderr || error.message });
    }

    // Split output into individual lines
    const lines = stdout.split('\n');

    // Comment out non-flow metadata lines
    const processedLines = lines.map(line => {
      const trimmed = line.trim();

      // Keep empty lines clean
      if (!trimmed) return '';

      // Check if the line is a valid SankeyMatic connection line: "Source [amount] Target"
      const isSankeyFlow = /^.+?\s+\[\d+(?:\.\d+)?\]\s+.+?$/.test(trimmed);

      // If it's already a comment, return as-is
      if (trimmed.startsWith('//')) return trimmed;

      // Comment out metadata, status logs, links, or ASCII dividers
      if (!isSankeyFlow) {
        return `// ${line}`;
      }

      return line;
    });

    // Build final output with the top comment header
    const commentSafeResult = [`// Firefly III Sankey Diagram`, ...processedLines].join('\n');
	
	// Consolidate catagories
	const finalResult = consolidateSankeyData(commentSafeResult);
	
    res.json({ result: finalResult });
  });
}); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

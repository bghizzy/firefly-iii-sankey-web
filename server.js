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
  
  // Regex to extract source, target, amount, and optional (+) / (-) sign
  // Matches pattern: "Source [Amount] Target"
  const lineRegex = /^(.*?)\s*\[([\d\.]+)\]\s*(.*)$/;

  const parsedLines = [];
  const entriesByKey = {};

  // Step 1: Parse all lines and group (+) and (-) entries by normalized category name
  lines.forEach((line, index) => {
    const match = line.trim().match(lineRegex);
    
    if (!match) {
      parsedLines.push({ raw: line, isData: false });
      return;
    }

    const [_, source, amountStr, target] = match;
    const amount = parseFloat(amountStr);

    // Identify if '+' or '-' exists in source or target
    const isPlus = source.includes("(+)") || target.includes("(+)");
    const isMinus = source.includes("(-)") || target.includes("(-)");

    if (isPlus || isMinus) {
      // Normalize category name by stripping (+), (-), and extra spaces
      const cleanSource = source.replace(/\(\+\)|\(-\)/g, "").trim();
      const cleanTarget = target.replace(/\(\+\)|\(-\)/g, "").trim();
      const key = isPlus 
        ? (source.includes("(+)") ? cleanSource : cleanTarget)
        : (source.includes("(-)") ? cleanSource : cleanTarget);

      if (!entriesByKey[key]) {
        entriesByKey[key] = { plus: null, minus: null };
      }

      const entryObj = { index, source, target, cleanSource, cleanTarget, amount, isPlus, isMinus };

      if (isPlus) entriesByKey[key].plus = entryObj;
      if (isMinus) entriesByKey[key].minus = entryObj;

      parsedLines.push({ ...entryObj, isData: true, remove: false });
    } else {
      parsedLines.push({ raw: line, isData: false });
    }
  });

  // Step 2: Compare (+) and (-) pairs and adjust amounts/removals
  Object.values(entriesByKey).forEach(({ plus, minus }) => {
    if (plus && minus) {
      if (minus.amount > plus.amount) {
        // (-) > (+) : Subtract (+) from (-), remove (+)
        parsedLines[minus.index].amount = parseFloat((minus.amount - plus.amount).toFixed(2));
        parsedLines[plus.index].remove = true;
      } else if (plus.amount > minus.amount) {
        // (+) > (-) : Subtract (-) from (+), remove (-)
        parsedLines[plus.index].amount = parseFloat((plus.amount - minus.amount).toFixed(2));
        parsedLines[minus.index].remove = true;
      } else {
        // Equal values: remove both
        parsedLines[plus.index].remove = true;
        parsedLines[minus.index].remove = true;
      }
    }
  });

  // Step 3: Reconstruct text output
  return parsedLines
    .filter(item => !item.remove)
    .map(item => {
      if (!item.isData) return item.raw;
      
      // Re-assemble line with updated amount
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

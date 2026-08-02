const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FIREFLY_URL = (process.env.FIREFLY_URL || '').replace(/\/$/, '');
const FIREFLY_TOKEN = process.env.FIREFLY_TOKEN || '';

// SankeyMatic canvas and styling configuration appended to outputs
const SANKEY_SETTINGS = `
// === Settings ===

size w 1600
  h 1800
margin l 12
  r 12
  t 18
  b 20
bg color #ffffff
  transparent N
node w 12
  h 50
  spacing 75
  border 0
  theme a
  color #888888
  opacity 1
flow curvature 0.3
  inheritfrom source
  color #999999
  opacity 0.45
layout order exact
  justifyorigins Y
  justifyends Y
  reversegraph N
  attachincompletesto nearest
labels color #000000
  hide N
  highlight 0.75
  fontface sans-serif
  linespacing 0.2
  relativesize 100
  magnify 100
labelname appears Y
  size 16
  weight 400
labelvalue appears Y
  fullprecision Y
  position before
  weight 400
labelposition autoalign 0
  scheme auto
  first before
  breakpoint 6
value format ',.'
  prefix ''
  suffix ''
themeoffset a 6
  b 0
  c 0
  d 0
meta mentionsankeymatic Y
  listimbalances Y
`;

// Function to consolidate (+) and (-) category pairs in SankeyMatic output strings.
function consolidateSankeyData(input) {
const lines = input.split("\n");
  const lineRegex = /^(.*?)\s*\[([\d\.]+)\]\s*(.*)$/;

  const parsedLines = [];
  const plusEntries = {};   // Keyed by cleaned category name
  const minusEntries = {};  // Keyed by cleaned category name
  const budgetEntries = {}; // Keyed by primary budget name

  // --- Step 1: Parse lines ---
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
      const primaryBudget = source.trim();
      minusEntries[category] = { ...entry, primaryBudget };
    } else if (source.trim() === "All Funds") {
      const primaryBudget = target.trim();
      budgetEntries[primaryBudget] = entry;
    }
  });

  // --- Step 2: Perform Reconciliations for (+) and (-) ---
  Object.keys(plusEntries).forEach(category => {
    const plus = plusEntries[category];
    const minusInfo = minusEntries[category];

    if (!minusInfo) return;

    const minus = parsedLines[minusInfo.index];
    const primaryBudget = minusInfo.primaryBudget;
    const budgetEntry = budgetEntries[primaryBudget];

    if (minus.amount > plus.amount) {
      const diff = minus.amount - plus.amount;
      minus.amount = parseFloat(diff.toFixed(2));

      if (budgetEntry) {
        budgetEntry.amount = parseFloat((budgetEntry.amount - plus.amount).toFixed(2));
      }
      plus.remove = true;

    } else if (plus.amount > minus.amount) {
      const diff = plus.amount - minus.amount;
      plus.amount = parseFloat(diff.toFixed(2));

      if (budgetEntry) {
        budgetEntry.amount = parseFloat((budgetEntry.amount - minus.amount).toFixed(2));
      }
      minus.remove = true;

    } else {
      if (budgetEntry) {
        budgetEntry.amount = parseFloat((budgetEntry.amount - plus.amount).toFixed(2));
      }
      plus.remove = true;
      minus.remove = true;
    }
  });

  // --- Step 3: Remaps & Flow Adjustments ---
  let totalSpending = 0;

  parsedLines.forEach(item => {
    if (!item.isData || item.remove) return;

    // Remap "Inc - Match [Val] All Funds" -> "Inc - Match [Val] Savings"
    if (item.source.trim() === "Inc - Match" && item.target.trim() === "All Funds") {
      item.target = "Savings";

      if (budgetEntries["Savings"]) {
        budgetEntries["Savings"].amount = parseFloat(
          (budgetEntries["Savings"].amount - item.amount).toFixed(2)
        );
      }
    }

    // Remap "All Funds [Val] Primary" to "Spending [Val] Primary" (Except Savings & Taxes)
    if (item.source.trim() === "All Funds") {
      const primary = item.target.trim();

      if (primary !== "Savings" && primary !== "Taxes") {
        totalSpending += item.amount;
        item.source = "Spending";
      }
    }
  });

  totalSpending = parseFloat(totalSpending.toFixed(2));

  // --- Step 4: Group & Sort Sections ---

  // 1. Income Section (Sources -> All Funds / Savings)
  const incomeEntries = parsedLines.filter(
    item => item.isData && !item.remove && (item.target === "All Funds" || item.source.startsWith("Inc -"))
  );
  
  // Sort Income: "Inc - Match" strictly FIRST, remaining sorted largest to smallest
  incomeEntries.sort((a, b) => {
    if (a.source.trim() === "Inc - Match") return -1;
    if (b.source.trim() === "Inc - Match") return 1;
    return b.amount - a.amount;
  });

  // 2. Middle Layer: All Funds -> 1st Category (Savings, Spending, Taxes)
  const firstCategoryEntries = parsedLines.filter(
    item => item.isData && !item.remove && item.source === "All Funds"
  );
  
  const firstCategoryOrder = ["Savings", "Taxes", "Spending"];
  
  if (totalSpending > 0) {
    firstCategoryEntries.push({
      source: "All Funds",
      target: "Spending",
      amount: totalSpending,
      isData: true
    });
  }

  firstCategoryEntries.sort((a, b) => {
    return firstCategoryOrder.indexOf(a.target) - firstCategoryOrder.indexOf(b.target);
  });

  // 3. Sub-Categories: (1st Category -> 2nd Category) and (2nd Category -> 3rd Category)
  const subCategoryEntries = parsedLines.filter(
    item => item.isData && !item.remove && item.source !== "All Funds" && !item.source.startsWith("Inc -") && item.source !== "[NO CATEGORY] (+)"
  );

  // Group by Source Node
  const subCategoryGroups = {};
  subCategoryEntries.forEach(item => {
    if (!subCategoryGroups[item.source]) {
      subCategoryGroups[item.source] = [];
    }
    subCategoryGroups[item.source].push(item);
  });

  // Sort items inside every group largest to smallest
  Object.keys(subCategoryGroups).forEach(sourceKey => {
    subCategoryGroups[sourceKey].sort((a, b) => b.amount - a.amount);
  });

  // Build ordered list of 1st Category -> 2nd Category according to Savings -> Spending -> Taxes order
  const orderedSubCategories = [];

  firstCategoryOrder.forEach(cat => {
    if (subCategoryGroups[cat]) {
      orderedSubCategories.push(...subCategoryGroups[cat]);
      delete subCategoryGroups[cat]; // Remove so it isn't processed twice
    }
  });

  // Append remaining 2nd Category -> 3rd Category groups (e.g. Shopping -> Shop - Target) sorted by group total
  const remainingKeys = Object.keys(subCategoryGroups).sort((a, b) => {
    const sumA = subCategoryGroups[a].reduce((acc, curr) => acc + curr.amount, 0);
    const sumB = subCategoryGroups[b].reduce((acc, curr) => acc + curr.amount, 0);
    return sumB - sumA;
  });

  remainingKeys.forEach(key => {
    orderedSubCategories.push(...subCategoryGroups[key]);
  });

  // --- Step 5: Format Final Output ---
  const outputLines = [];

  // Section 1: Income / Sources
  incomeEntries.forEach(item => {
    outputLines.push(`${item.source} [${item.amount.toFixed(2)}] ${item.target}`);
  });

  outputLines.push("\n// Assets -> Budgets");

  // Section 2: Assets -> 1st Categories (Savings, Spending, Taxes)
  firstCategoryEntries.forEach(item => {
    outputLines.push(`${item.source} [${item.amount.toFixed(2)}] ${item.target}`);
  });

  outputLines.push("\n// Budgets -> Expense Categories");

  // Section 3: 1st Category -> 2nd Category -> 3rd Category
  orderedSubCategories.forEach(item => {
    outputLines.push(`${item.source} [${item.amount.toFixed(2)}] ${item.target}`);
  });

  return outputLines.join("\n");
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
  const { startDate, endDate, withAssets, withAccounts, excludePaycheck } = req.body;

  let cmd = `npx firefly-iii-sankey -u "${FIREFLY_URL}" -t "${FIREFLY_TOKEN}" -f sankeymatic`;

  if (startDate) cmd += ` --start ${startDate}`;
  if (endDate) cmd += ` --end ${endDate}`;
  if (withAssets) cmd += ` --with-assets`;
  if (withAccounts) cmd += ` --with-accounts`;
  if (excludePaycheck) cmd += ` --exclude-accounts "Other - Paycheck"`;

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
	const consolidatedResult = consolidateSankeyData(commentSafeResult);

	// Append SankeyMatic layout and theme settings
    const finalResult = `${consolidatedResult.trim()}\n\n${SANKEY_SETTINGS.trim()}\n`;
	  
    res.json({ result: finalResult });
  });
}); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

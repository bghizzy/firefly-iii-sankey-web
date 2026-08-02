const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Strips CLI connection banners, system information, and execution status logs,
 * leaving only the actual Sankey diagram flow data.
 */
function cleanSankeyOutput(rawOutput) {
  if (!rawOutput) return '';

  return rawOutput
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();

      // Drop blank lines, borders, system/auth headers, and status log lines
      if (!trimmed) return false;
      if (trimmed.startsWith('// Firefly III Sankey Diagram')) return false;
      if (trimmed.includes('━━━━━━')) return false;
      if (trimmed.startsWith('Connected to Firefly III')) return false;
      if (trimmed.startsWith('System Information:')) return false;
      if (trimmed.startsWith('Authenticated User:')) return false;
      if (trimmed.startsWith('Firefly III Version:')) return false;
      if (trimmed.startsWith('API Version:')) return false;
      if (trimmed.startsWith('OS:')) return false;
      if (trimmed.startsWith('PHP Version:')) return false;
      if (trimmed.startsWith('User ID:')) return false;
      if (trimmed.startsWith('Email:')) return false;
      if (trimmed.startsWith('Role:')) return false;
      if (trimmed.startsWith('Account Status:')) return false;
      if (trimmed.startsWith('Fetching transactions')) return false;
      if (trimmed.startsWith('✓')) return false;

      return true;
    })
    .join('\n')
    .trim();
}

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Sankey Diagram Generation Endpoint
app.post('/api/generate', (req, res) => {
  const fireflyUrl = process.env.FIREFLY_III_URL || req.body.fireflyUrl;
  const apiToken = process.env.FIREFLY_III_ACCESS_TOKEN || req.body.apiToken;
  const startDate = req.body.startDate;
  const endDate = req.body.endDate;

  if (!fireflyUrl || !apiToken || !startDate || !endDate) {
    return res.status(400).json({
      error: 'Missing required parameters (URL, API Token, Start Date, or End Date).'
    });
  }

  // Construct CLI command execution
  const command = `firefly-iii-sankey --url "${fireflyUrl}" --token "${apiToken}" --start "${startDate}" --end "${endDate}"`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Execution error: ${error.message}`);
      return res.status(500).json({ error: 'Failed to generate Sankey data', details: stderr || error.message });
    }

    // Process stdout to remove header & metadata
    const cleanOutput = cleanSankeyOutput(stdout);

    return res.json({ result: cleanOutput });
  });
});

app.listen(PORT, () => {
  console.log(`Firefly III Sankey Web App listening on port ${PORT}`);
});

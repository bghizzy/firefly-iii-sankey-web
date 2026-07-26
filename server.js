const express = require('express');
const { exec } = require('child_process');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const FIREFLY_URL = (process.env.FIREFLY_URL || '').replace(/\/$/, '');
const FIREFLY_TOKEN = process.env.FIREFLY_TOKEN || '';

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

    // Process and trim the output string
    let cleanOutput = stdout;

    // Remove CLI leading metadata up to the first data line/comment
    cleanOutput = cleanOutput.replace(/^[\s\S]*?(?=\n\n|\r\n\r\n|^[A-Za-z0-9"'/])/, '').trim();

    // Remove any trailing URLs, http(s) links, or footer notes
    cleanOutput = cleanOutput.split('\n').filter(line => {
      const trimmed = line.trim();
      return !trimmed.startsWith('http://') && 
             !trimmed.startsWith('https://') && 
             !trimmed.toLowerCase().includes('github.com');
    }).join('\n').trim();

    // Prepend the requested header line
    const finalResult = `// Firefly III Sankey Diagram\n${cleanOutput}`;

    res.json({ result: finalResult });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

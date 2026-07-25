import express from 'express';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    hasEnvConfig: Boolean(process.env.FIREFLY_URL && process.env.FIREFLY_TOKEN),
    fireflyUrl: process.env.FIREFLY_URL || ''
  });
});

app.post('/api/generate', (req, res) => {
  const url = process.env.FIREFLY_URL || req.body.url;
  const token = process.env.FIREFLY_TOKEN || req.body.token;
  const { startDate, endDate, withAssets, format } = req.body;

  if (!url || !token) {
    return res.status(400).json({ 
      error: 'Firefly URL and Token are required in environment variables or form.' 
    });
  }

  const args = [
    'npx', 'firefly-iii-sankey',
    '-u', `"${url}"`,
    '-t', `"${token}"`,
    '-f', format || 'sankeymatic'
  ];

  if (startDate) args.push('-s', `"${startDate}"`);
  if (endDate) args.push('-e', `"${endDate}"`);
  if (withAssets) args.push('--with-assets');

  const command = args.join(' ');

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Execution error: ${error}`);
      return res.status(500).json({ error: stderr || error.message });
    }
    res.json({ result: stdout });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

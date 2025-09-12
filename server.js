const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { runAutomation } = require('./playwright-automation');

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// API to start automation
app.post('/api/start', async (req, res) => {
  const { context, journeyName, prompts, hostName, hostVoiceId, speakerName, speakerVoiceId } = req.body;
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return res.status(400).json({ error: 'Prompt list required.' });
  }
  if (!journeyName) {
    return res.status(400).json({ error: 'Journey name required.' });
  }
  try {
    await runAutomation(prompts, context, journeyName, hostName, hostVoiceId, speakerName, speakerVoiceId);
    res.json({ status: 'completed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

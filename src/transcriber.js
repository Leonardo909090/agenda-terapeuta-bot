const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function downloadTelegramFile(bot, fileId) {
  const fileLink = await bot.getFileLink(fileId);
  const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
  return Buffer.from(response.data);
}

async function transcribeAudio(bot, fileId) {
  const audioBuffer = await downloadTelegramFile(bot, fileId);
  const tmpPath = path.join(os.tmpdir(), `audio-${crypto.randomUUID()}.ogg`);
  fs.writeFileSync(tmpPath, audioBuffer);

  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-large-v3',
      language: 'pt',
      response_format: 'text',
    });

    return typeof transcription === 'string' ? transcription.trim() : transcription.text.trim();
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

module.exports = { transcribeAudio };

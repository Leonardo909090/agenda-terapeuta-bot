require('dotenv').config();

const { createBot } = require('./telegram');
const { startDailyAgendaJob } = require('./scheduler');

const REQUIRED_ENV_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'THERAPIST_CHAT_ID',
  'GROQ_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
];

function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`❌ Variáveis de ambiente faltando: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function main() {
  validateEnv();

  const bot = createBot();
  console.log('🤖 Bot da agenda da terapeuta iniciado.');

  startDailyAgendaJob(bot);
}

main();

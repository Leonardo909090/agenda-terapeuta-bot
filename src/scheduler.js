const cron = require('node-cron');
const calendar = require('./calendar');

function formatDailyAgenda(events) {
  if (events.length === 0) {
    return 'Bom dia! ☀️ Você não tem consultas hoje 🎉';
  }

  const lines = events.map((ev) => {
    const time = calendar.formatTimeFromISO(ev.start.dateTime);
    return `🕐 ${time} — ${ev.summary}`;
  });

  return `Bom dia! ☀️ Aqui está sua agenda de hoje:\n\n${lines.join('\n')}`;
}

function startDailyAgendaJob(bot) {
  const chatId = process.env.THERAPIST_CHAT_ID;

  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        const today = calendar.todayISO();
        const events = await calendar.listEventsForDay(today);
        await bot.sendMessage(chatId, formatDailyAgenda(events));
      } catch (err) {
        console.error('Erro ao enviar agenda diária:', err);
      }
    },
    { timezone: calendar.TIMEZONE }
  );

  console.log('⏰ Job da agenda diária agendado para 08:00 (America/Sao_Paulo).');
}

module.exports = { startDailyAgendaJob };

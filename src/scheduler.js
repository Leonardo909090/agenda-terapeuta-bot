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
  const chatIds = process.env.THERAPIST_CHAT_ID.split(',').map((id) => id.trim());

  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        const today = calendar.todayISO();
        const events = await calendar.listEventsForDay(today);
        const message = formatDailyAgenda(events);

        for (const chatId of chatIds) {
          await bot.sendMessage(chatId, message);
        }
      } catch (err) {
        console.error('Erro ao enviar agenda diária:', err);
      }
    },
    { timezone: calendar.TIMEZONE }
  );

  console.log('⏰ Job da agenda diária agendado para 08:00 (America/Sao_Paulo).');
}

module.exports = { startDailyAgendaJob };

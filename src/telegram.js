const TelegramBot = require('node-telegram-bot-api');
const calendar = require('./calendar');
const { transcribeAudio } = require('./transcriber');
const { interpretCommand } = require('./interpreter');

const pendingByChat = new Map();

const MISSING_INFO_LABELS = {
  patientName: 'o nome do paciente',
  date: 'a data',
  time: 'o horário',
  newDate: 'a nova data',
  newTime: 'o novo horário',
  recurrenceCount: 'por quantas semanas devo repetir',
};

const WEEKDAY_LABELS = {
  MO: 'segunda-feira',
  TU: 'terça-feira',
  WE: 'quarta-feira',
  TH: 'quinta-feira',
  FR: 'sexta-feira',
  SA: 'sábado',
  SU: 'domingo',
};

function createBot() {
  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  const therapistChatId = String(process.env.THERAPIST_CHAT_ID);

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    if (chatId !== therapistChatId) return;

    try {
      if (msg.voice || msg.audio) {
        await bot.sendMessage(chatId, '🎙️ Ouvindo seu áudio...');
        const fileId = msg.voice ? msg.voice.file_id : msg.audio.file_id;
        const transcript = await transcribeAudio(bot, fileId);
        await bot.sendMessage(chatId, `📝 Entendi: "${transcript}"`);
        await handleIncomingText(bot, chatId, transcript, { fromAudio: true });
        return;
      }

      if (msg.text) {
        await handleIncomingText(bot, chatId, msg.text, { fromAudio: false });
      }
    } catch (err) {
      console.error('Erro ao processar mensagem:', err);
      await bot.sendMessage(chatId, '⚠️ Ocorreu um erro ao processar sua mensagem. Tente novamente.');
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = String(query.message.chat.id);
    if (chatId !== therapistChatId) return;

    try {
      await handleConfirmationCallback(bot, chatId, query);
    } catch (err) {
      console.error('Erro ao processar confirmação:', err);
      await bot.answerCallbackQuery(query.id).catch(() => {});
      await bot.sendMessage(chatId, '⚠️ Ocorreu um erro ao processar sua confirmação. Tente novamente.');
    }
  });

  return bot;
}

async function handleConfirmationCallback(bot, chatId, query) {
  const pending = pendingByChat.get(chatId);

  if (!pending || pending.type !== 'awaitingConfirmation') {
    await bot.answerCallbackQuery(query.id, { text: 'Essa confirmação já expirou.' });
    return;
  }

  pendingByChat.delete(chatId);
  await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message.message_id });

  if (query.data === 'confirm_yes') {
    await bot.answerCallbackQuery(query.id, { text: 'Confirmado!' });
    await executeAction(bot, chatId, pending.parsed);
    return;
  }

  await bot.answerCallbackQuery(query.id, { text: 'Cancelado.' });
  await bot.sendMessage(chatId, 'Ok, cancelei a operação. Pode me dizer de novo o que você precisa.');
}

async function handleIncomingText(bot, chatId, text, { fromAudio }) {
  const pending = pendingByChat.get(chatId);

  if (pending?.type === 'awaitingConfirmation') {
    return handleConfirmationReply(bot, chatId, text, pending);
  }

  if (pending?.type === 'awaitingMissingInfo') {
    return handleMissingInfoReply(bot, chatId, text, pending);
  }

  if (pending?.type === 'awaitingPick') {
    return handlePickReply(bot, chatId, text, pending);
  }

  const parsed = await interpretCommand(text);
  await routeParsed(bot, chatId, parsed, { rawMessage: text, fromAudio });
}

async function handleMissingInfoReply(bot, chatId, text, pending) {
  const standalone = await interpretCommand(text);
  const isStandaloneComplete = standalone.action !== 'desconhecido' && (!standalone.missingInfo || standalone.missingInfo.length === 0);

  if (isStandaloneComplete) {
    await routeParsed(bot, chatId, standalone, { rawMessage: text, fromAudio: pending.fromAudio });
    return;
  }

  const combined = `${pending.rawMessage}. ${text}`;
  const parsed = await interpretCommand(combined);
  await routeParsed(bot, chatId, parsed, { rawMessage: combined, fromAudio: pending.fromAudio });
}

async function handleConfirmationReply(bot, chatId, text, pending) {
  const normalized = text.trim().toLowerCase();
  const isYes = ['sim', 'confirmo', 'confirma', 'pode', 'ok', 'isso', 'correto'].some((w) => normalized.includes(w));

  pendingByChat.delete(chatId);

  if (!isYes) {
    await bot.sendMessage(chatId, 'Ok, cancelei a operação. Pode me dizer de novo o que você precisa.');
    return;
  }

  await executeAction(bot, chatId, pending.parsed);
}

async function handlePickReply(bot, chatId, text, pending) {
  const index = parseInt(text.trim(), 10) - 1;
  pendingByChat.delete(chatId);

  if (Number.isNaN(index) || index < 0 || index >= pending.events.length) {
    await bot.sendMessage(chatId, 'Não entendi qual consulta você quer. Pode repetir o comando?');
    return;
  }

  const event = pending.events[index];
  await runOnEvent(bot, chatId, pending.action, event, pending.parsed);
}

async function routeParsed(bot, chatId, parsed, { rawMessage, fromAudio }) {
  pendingByChat.delete(chatId);

  if (parsed.missingInfo && parsed.missingInfo.length > 0) {
    const labels = parsed.missingInfo.map((f) => MISSING_INFO_LABELS[f] || f).join(', ');
    pendingByChat.set(chatId, { type: 'awaitingMissingInfo', rawMessage, fromAudio });
    await bot.sendMessage(chatId, `Faltou me dizer ${labels}. Pode completar?`);
    return;
  }

  if (parsed.action === 'desconhecido') {
    await bot.sendMessage(
      chatId,
      'Não entendi o que você gostaria de fazer 🤔. Você pode marcar, cancelar, remarcar uma consulta ou pedir para ver a agenda.'
    );
    return;
  }

  const isReadOnly = parsed.action === 'ver' || parsed.action === 'consultar';
  const isBulkCancel = parsed.action === 'cancelar' && !parsed.patientName;
  const isRecurring = parsed.action === 'criar' && !!parsed.recurrence?.weekday;
  const requiresConfirmation = !isReadOnly && (fromAudio || isBulkCancel || isRecurring);

  if (requiresConfirmation) {
    pendingByChat.set(chatId, { type: 'awaitingConfirmation', parsed });
    await bot.sendMessage(chatId, `${describeAction(parsed)}\n\nConfirma?`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Sim', callback_data: 'confirm_yes' },
          { text: '❌ Não', callback_data: 'confirm_no' },
        ]],
      },
    });
    return;
  }

  await executeAction(bot, chatId, parsed);
}

function describeAction(parsed) {
  switch (parsed.action) {
    case 'criar':
      if (parsed.recurrence?.weekday) {
        const weekdayLabel = WEEKDAY_LABELS[parsed.recurrence.weekday] || parsed.recurrence.weekday;
        const countLabel = parsed.recurrence.count ? `por ${parsed.recurrence.count} semanas` : 'sem data de término definida';
        return `Entendi que você quer marcar ${parsed.patientName} toda ${weekdayLabel} às ${parsed.time}, a partir de ${formatDatePtBr(parsed.date)}, ${countLabel}.`;
      }
      return `Entendi que você quer marcar ${parsed.patientName} no dia ${formatDatePtBr(parsed.date)} às ${parsed.time}.`;
    case 'cancelar':
      return parsed.patientName
        ? `Entendi que você quer cancelar a consulta de ${parsed.patientName}${parsed.date ? ` do dia ${formatDatePtBr(parsed.date)}` : ''}.`
        : `Entendi que você quer cancelar TODA a agenda do dia ${formatDatePtBr(parsed.date)}.`;
    case 'remarcar':
      return `Entendi que você quer remarcar ${parsed.patientName} para ${formatDatePtBr(parsed.newDate)} às ${parsed.newTime}.`;
    case 'ver':
      return `Entendi que você quer ver a agenda de ${parsed.period === 'week' ? 'semana' : formatDatePtBr(parsed.date)}.`;
    case 'consultar':
      return `Entendi que você quer saber quando ${parsed.patientName} está marcado(a).`;
    default:
      return 'Entendi seu pedido.';
  }
}

function formatDatePtBr(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

async function executeAction(bot, chatId, parsed) {
  switch (parsed.action) {
    case 'criar':
      return handleCriar(bot, chatId, parsed);
    case 'cancelar':
      return handleCancelar(bot, chatId, parsed);
    case 'remarcar':
      return handleRemarcar(bot, chatId, parsed);
    case 'ver':
      return handleVer(bot, chatId, parsed);
    case 'consultar':
      return handleConsultar(bot, chatId, parsed);
    default:
      await bot.sendMessage(chatId, 'Não consegui executar essa ação.');
  }
}

async function handleCriar(bot, chatId, parsed) {
  const { patientName, date, time, notes, recurrence } = parsed;
  const { available, conflictingEvent } = await calendar.checkAvailability(date, time);

  if (!available) {
    const slots = await calendar.suggestFreeSlots(date, time);
    const conflictSummary = conflictingEvent?.summary || 'outro compromisso';
    const slotsText = slots.length
      ? `Próximos horários livres: ${slots.join(', ')}.`
      : 'Não encontrei outros horários livres nesse dia.';
    await bot.sendMessage(
      chatId,
      `⚠️ Esse horário já está ocupado (${conflictSummary}) em ${formatDatePtBr(date)} às ${time}.\n${slotsText}`
    );
    return;
  }

  await calendar.createEvent({ patientName, date, time, notes, recurrence });

  if (recurrence?.weekday) {
    const weekdayLabel = WEEKDAY_LABELS[recurrence.weekday] || recurrence.weekday;
    const countLabel = recurrence.count ? `por ${recurrence.count} semanas` : 'sem data de término (repete indefinidamente até você cancelar)';
    await bot.sendMessage(
      chatId,
      `✅ Consulta recorrente marcada!\n👤 Paciente: ${patientName}\n🔁 Toda ${weekdayLabel} às ${time} (2h)\n📅 A partir de: ${formatDatePtBr(date)}\n${countLabel}\n\n⚠️ Só verifiquei conflito no primeiro horário — vale conferir a agenda das próximas semanas.`
    );
    return;
  }

  await bot.sendMessage(
    chatId,
    `✅ Consulta marcada!\n👤 Paciente: ${patientName}\n📅 Data: ${formatDatePtBr(date)}\n🕐 Horário: ${time} (2h)`
  );
}

async function handleCancelar(bot, chatId, parsed) {
  const { patientName, date } = parsed;

  if (!patientName) {
    if (!date) {
      await bot.sendMessage(chatId, 'Para cancelar toda a agenda eu preciso saber a data. Pode me dizer qual dia?');
      return;
    }

    const events = await calendar.listEventsForDay(date);
    if (events.length === 0) {
      await bot.sendMessage(chatId, `Você não tem nenhuma consulta em ${formatDatePtBr(date)}.`);
      return;
    }

    for (const ev of events) {
      await calendar.cancelEvent(ev.id);
    }

    await bot.sendMessage(chatId, `🗑️ Cancelei todas as ${events.length} consulta(s) de ${formatDatePtBr(date)}.`);
    return;
  }

  const events = date
    ? await calendar.findEventsByPatientAndDate(patientName, date)
    : await calendar.findUpcomingEventsByPatient(patientName);

  if (events.length === 0) {
    await bot.sendMessage(chatId, `Não encontrei nenhuma consulta de ${patientName}${date ? ` em ${formatDatePtBr(date)}` : ''}.`);
    return;
  }

  if (events.length > 1) {
    pendingByChat.set(chatId, { type: 'awaitingPick', action: 'cancelar', events, parsed });
    await bot.sendMessage(chatId, `Encontrei mais de uma consulta:\n${formatEventOptions(events)}\nQual número você quer cancelar?`);
    return;
  }

  await runOnEvent(bot, chatId, 'cancelar', events[0], parsed);
}

async function handleRemarcar(bot, chatId, parsed) {
  const { patientName, date } = parsed;
  const events = date
    ? await calendar.findEventsByPatientAndDate(patientName, date)
    : await calendar.findUpcomingEventsByPatient(patientName);

  if (events.length === 0) {
    await bot.sendMessage(chatId, `Não encontrei nenhuma consulta de ${patientName}${date ? ` em ${formatDatePtBr(date)}` : ''} para remarcar.`);
    return;
  }

  if (events.length > 1) {
    pendingByChat.set(chatId, { type: 'awaitingPick', action: 'remarcar', events, parsed });
    await bot.sendMessage(chatId, `Encontrei mais de uma consulta:\n${formatEventOptions(events)}\nQual número você quer remarcar?`);
    return;
  }

  await runOnEvent(bot, chatId, 'remarcar', events[0], parsed);
}

async function runOnEvent(bot, chatId, action, event, parsed) {
  if (action === 'cancelar') {
    await calendar.cancelEvent(event.id);
    await bot.sendMessage(chatId, `🗑️ Consulta de "${event.summary}" cancelada.`);
    return;
  }

  if (action === 'remarcar') {
    const { newDate, newTime } = parsed;
    const { available, conflictingEvent } = await calendar.checkAvailability(newDate, newTime);

    if (!available && conflictingEvent?.id !== event.id) {
      const slots = await calendar.suggestFreeSlots(newDate, newTime);
      const slotsText = slots.length ? `Próximos horários livres: ${slots.join(', ')}.` : 'Não há outros horários livres nesse dia.';
      await bot.sendMessage(chatId, `⚠️ Já existe um compromisso em ${formatDatePtBr(newDate)} às ${newTime}.\n${slotsText}`);
      return;
    }

    await calendar.rescheduleEvent(event.id, newDate, newTime);
    await bot.sendMessage(chatId, `🔁 Consulta remarcada para ${formatDatePtBr(newDate)} às ${newTime}.`);
  }
}

async function handleConsultar(bot, chatId, parsed) {
  const { patientName } = parsed;
  const events = await calendar.findUpcomingEventsByPatient(patientName);

  if (events.length === 0) {
    await bot.sendMessage(chatId, `Não encontrei nenhuma consulta marcada para ${patientName} nos próximos dias.`);
    return;
  }

  const lines = events.map((ev) => {
    const time = calendar.formatTimeFromISO(ev.start.dateTime);
    const dateStr = calendar.formatDateFromISO(ev.start.dateTime);
    return `🕐 ${dateStr} às ${time}`;
  });

  const intro = events.length === 1
    ? `📅 ${patientName} está marcado(a) para:`
    : `📅 ${patientName} tem ${events.length} consultas marcadas:`;

  await bot.sendMessage(chatId, `${intro}\n\n${lines.join('\n')}`);
}

function formatEventOptions(events) {
  return events
    .map((ev, i) => `${i + 1}. ${ev.summary} — ${calendar.formatDateFromISO(ev.start.dateTime)} às ${calendar.formatTimeFromISO(ev.start.dateTime)}`)
    .join('\n');
}

async function handleVer(bot, chatId, parsed) {
  const date = parsed.date || calendar.todayISO();

  if (parsed.period === 'week') {
    const events = await calendar.listEventsForRange(date, calendar.addDaysISO(date, 6));
    await bot.sendMessage(chatId, formatAgendaMessage(events, 'da semana'));
    return;
  }

  const events = await calendar.listEventsForDay(date);
  await bot.sendMessage(chatId, formatAgendaMessage(events, `de ${formatDatePtBr(date)}`));
}

function formatAgendaMessage(events, label) {
  if (events.length === 0) {
    return `📅 Você não tem consultas ${label} 🎉`;
  }

  const lines = events.map((ev) => {
    const time = calendar.formatTimeFromISO(ev.start.dateTime);
    const dateStr = calendar.formatDateFromISO(ev.start.dateTime);
    return `🕐 ${dateStr} ${time} — ${ev.summary}`;
  });

  return `📅 Agenda ${label}:\n\n${lines.join('\n')}`;
}

module.exports = { createBot };

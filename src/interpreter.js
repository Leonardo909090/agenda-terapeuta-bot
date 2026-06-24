const Groq = require('groq-sdk');
const { TIMEZONE } = require('./calendar');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function buildSystemPrompt() {
  const now = new Date();
  const todayISO = now.toLocaleDateString('en-CA', { timeZone: TIMEZONE }); // YYYY-MM-DD
  const weekday = now.toLocaleDateString('pt-BR', { timeZone: TIMEZONE, weekday: 'long' });

  return `Você é um interpretador de comandos para a agenda de uma terapeuta.
Hoje é ${weekday}, ${todayISO} (fuso horário America/Sao_Paulo).

Sua tarefa: ler a mensagem da terapeuta e devolver APENAS um JSON (sem markdown, sem texto extra) com os campos:
{
  "action": "criar" | "cancelar" | "ver" | "remarcar" | "consultar" | "desconhecido",
  "patientName": string | null,
  "date": "YYYY-MM-DD" | null,
  "time": "HH:mm" | null,
  "newDate": "YYYY-MM-DD" | null,
  "newTime": "HH:mm" | null,
  "period": "day" | "week" | null,
  "notes": string | null,
  "missingInfo": string[]
}

Regras:
- Resolva datas relativas ("hoje", "amanhã", "sexta", "sexta-feira que vem", "dia 25", "25/06") para data absoluta "YYYY-MM-DD", usando hoje como referência.
- "remarcar" usa "date"/"time" para o evento atual (se mencionado) e "newDate"/"newTime" para o novo horário.
- "ver" usa "period": "day" para um dia específico (preencha "date") ou "week" para a semana.
- "consultar" é usada quando a terapeuta pergunta sobre os horários/dias de UM paciente específico, sem querer criar, cancelar ou remarcar nada — ex: "Quando a Fernanda está marcada?", "A Bia tem consulta essa semana?", "Qual o próximo horário do João?". Preencha "patientName". Se faltar o nome do paciente, liste ["patientName"] em "missingInfo".
- Se a ação for "criar" ou "remarcar" e faltar paciente, data ou horário, liste os campos faltantes em "missingInfo" (ex: ["time"]).
- Se a terapeuta pedir para cancelar/apagar TODA a agenda de um dia (sem mencionar um paciente específico), use "action": "cancelar", deixe "patientName" como null e preencha "date". Se nem isso for possível por faltar a data, liste "date" em "missingInfo".
- Se não conseguir identificar a intenção, use "action": "desconhecido".
- Nunca invente nome de paciente, data ou horário que não estejam na mensagem.
- Responda SOMENTE com o JSON.`;
}

async function interpretCommand(message) {
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: message },
    ],
  });

  const raw = completion.choices[0]?.message?.content || '{}';

  try {
    return JSON.parse(raw);
  } catch (err) {
    return {
      action: 'desconhecido',
      patientName: null,
      date: null,
      time: null,
      newDate: null,
      newTime: null,
      period: null,
      notes: null,
      missingInfo: [],
    };
  }
}

module.exports = { interpretCommand };

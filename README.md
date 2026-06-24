# Bot de Agenda para Terapeuta (Telegram + Google Calendar)

Bot de Telegram que entende comandos em português (texto ou áudio) para gerenciar a agenda de uma terapeuta, integrado ao Google Calendar. Usa a API do Groq (Whisper para transcrição e LLaMA 3.3 70B para interpretar linguagem natural).

## Funcionalidades

- Marcar, cancelar, remarcar e consultar consultas via mensagem de texto ou áudio.
- Verificação automática de conflitos de horário, com sugestão dos 3 próximos horários livres.
- Resumo diário automático às 8h (horário de Brasília) com a agenda do dia.
- Responde apenas ao chat ID configurado da terapeuta (qualquer outro chat é ignorado).

## Passo a passo de configuração

### 1. Criar o bot no Telegram

1. Abra o Telegram e procure por **@BotFather**.
2. Envie `/newbot` e siga as instruções (nome e username do bot).
3. O BotFather vai te dar um token, algo como `123456789:ABCdefGhIJKlmNoPQRstuVWXyz`.
4. Guarde esse valor — ele vai para `TELEGRAM_BOT_TOKEN` no `.env`.

### 2. Descobrir o THERAPIST_CHAT_ID

1. No Telegram, procure por **@userinfobot** e inicie uma conversa com ele.
2. Ele responde com o seu `Id` — esse número é o `THERAPIST_CHAT_ID`.
3. Guarde esse valor no `.env`. O bot vai ignorar qualquer mensagem que não venha desse chat.

### 3. Criar projeto no Google Cloud e ativar a Calendar API

1. Acesse [console.cloud.google.com](https://console.cloud.google.com/) e crie um novo projeto (ou use um existente).
2. No menu, vá em **APIs e Serviços > Biblioteca**, procure por "Google Calendar API" e clique em **Ativar**.
3. Vá em **APIs e Serviços > Tela de consentimento OAuth**:
   - Tipo de usuário: **Externo** (ou Interno, se for Google Workspace).
   - Preencha nome do app, e-mail de suporte e e-mail de contato.
   - Em "Usuários de teste", adicione o e-mail da conta Google da terapeuta (a que tem o Google Calendar).
4. Vá em **APIs e Serviços > Credenciais > Criar credenciais > ID do cliente OAuth**:
   - Tipo de aplicativo: **Aplicativo da Web**.
   - Em "URIs de redirecionamento autorizados", adicione: `http://localhost:3000/oauth2callback`.
5. Copie o **Client ID** e o **Client Secret** gerados — eles vão para `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no `.env`.

### 4. Gerar o GOOGLE_REFRESH_TOKEN

1. Preencha no `.env` os valores de `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (os outros campos podem ficar vazios por enquanto).
2. Instale as dependências (veja o passo 6) e rode:
   ```bash
   npm run auth:google
   ```
3. O script vai imprimir uma URL — abra-a no navegador e faça login com a conta Google da terapeuta.
4. Após autorizar, você será redirecionado para `localhost:3000`, e o script vai capturar o código automaticamente.
5. O terminal vai exibir o `refresh_token`. Copie esse valor para `GOOGLE_REFRESH_TOKEN` no `.env`.
6. Para descobrir o `THERAPIST_CALENDAR_ID`: se for usar o calendário principal da conta, use `primary`. Se for um calendário secundário, acesse o Google Calendar > Configurações do calendário desejado > "Integrar agenda" > copie o "ID da agenda".

### 5. Criar conta no Groq

1. Acesse [console.groq.com](https://console.groq.com/) e crie uma conta gratuita.
2. Vá em **API Keys > Create API Key**.
3. Copie a chave gerada para `GROQ_API_KEY` no `.env`.

### 6. Instalar dependências e rodar localmente

```bash
cd therapist-bot
cp .env.example .env
# edite o .env com todos os valores coletados acima
npm install
npm start
```

Se tudo estiver correto, você verá no terminal:
```
🤖 Bot da agenda da terapeuta iniciado.
⏰ Job da agenda diária agendado para 08:00 (America/Sao_Paulo).
```

Envie uma mensagem para o bot no Telegram, como `Marcar João Silva amanhã às 14h`, para testar.

### 7. Deploy gratuito no Render.com

1. Suba este projeto para um repositório no GitHub (apenas a pasta `therapist-bot`, ou o repositório inteiro).
2. Acesse [render.com](https://render.com/) e crie uma conta.
3. Clique em **New > Background Worker** (o bot usa polling, não precisa expor uma porta HTTP).
4. Conecte o repositório do GitHub.
5. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Root Directory**: `therapist-bot` (se o repositório tiver outras pastas)
6. Em **Environment**, adicione todas as variáveis do `.env` (TELEGRAM_BOT_TOKEN, THERAPIST_CHAT_ID, GROQ_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, THERAPIST_CALENDAR_ID).
7. Clique em **Create Background Worker** e aguarde o deploy.

## Estrutura de arquivos

```
src/
  index.js          # entrada principal, inicializa o bot
  telegram.js       # conexão e handlers de mensagem
  calendar.js       # operações do Google Calendar
  transcriber.js    # transcrição de áudio via Groq Whisper
  interpreter.js    # interpretação de comandos via Groq LLaMA
  scheduler.js       # cron job da agenda diária
scripts/
  auth-google.js    # gera o GOOGLE_REFRESH_TOKEN
.env.example
```

## Exemplos de comandos aceitos

- "Marcar Maria Souza sexta às 15h"
- "Cancelar consulta do João dia 25/06"
- "Ver agenda de hoje" / "Ver agenda da semana"
- "Remarcar Ana para quinta às 10h"

Áudios passam pelo mesmo fluxo: o bot transcreve, confirma o que entendeu e só executa após a sua confirmação.

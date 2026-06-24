require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');
const http = require('http');
const url = require('url');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

async function main() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.error('❌ Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no arquivo .env antes de rodar este script.');
    process.exit(1);
  }

  const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\n1) Abra esta URL no navegador e faça login com a conta Google da terapeuta:\n');
  console.log(authUrl);
  console.log('\n2) Depois de autorizar, você será redirecionado para localhost. Aguardando o código...\n');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname === '/oauth2callback' && parsed.query.code) {
        res.end('Autorização recebida! Pode fechar esta aba e voltar ao terminal.');
        server.close();
        resolve(parsed.query.code);
      }
    });

    server.listen(3000, () => {
      console.log('Aguardando callback em http://localhost:3000/oauth2callback ...');
    });

    server.on('error', reject);

    setTimeout(async () => {
      const manualCode = await prompt('\nSe o navegador não redirecionou automaticamente, cole aqui o código (parâmetro "code" da URL): ');
      if (manualCode) {
        server.close();
        resolve(manualCode.trim());
      }
    }, 15000);
  });

  const { tokens } = await oAuth2Client.getToken(code);

  console.log('\n✅ Autenticação concluída!\n');
  console.log('Copie o valor abaixo para a variável GOOGLE_REFRESH_TOKEN no seu .env:\n');
  console.log(tokens.refresh_token);
  console.log('\n');

  if (!tokens.refresh_token) {
    console.log('⚠️ Nenhum refresh_token foi retornado. Isso normalmente acontece se a conta já autorizou esse app antes.');
    console.log('Revogue o acesso em https://myaccount.google.com/permissions e rode este script de novo.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Erro na autenticação:', err);
  process.exit(1);
});

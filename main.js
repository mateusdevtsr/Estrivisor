const path = require('path');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// Carrega o .env pelo caminho absoluto da pasta do app, não pela pasta
// "atual" de execução — sem isso, o .env não é encontrado quando o app
// está instalado (o diretório de trabalho muda dependendo do atalho).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880';
const TOKEN_SERVER_URL = process.env.TOKEN_SERVER_URL || 'http://127.0.0.1:8080';
const INVITE_KEY = process.env.INVITE_KEY;

if (!TOKEN_SERVER_URL || !INVITE_KEY) {
  app.whenReady().then(() => {
    dialog.showErrorBox(
      'Erro de configuração',
      'Defina TOKEN_SERVER_URL e INVITE_KEY no arquivo .env (veja .env.example).'
    );
    app.quit();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 750,
    title: 'Concord',
    backgroundColor: '#1e1f22',
    webPreferences: {
      nodeIntegration: false,      // renderer não acessa Node diretamente
      contextIsolation: true,      // isola o mundo JS do preload/renderer
      sandbox: true,
      webSecurity: true,           // não desabilitar política de mesma origem
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.setMenuBarVisibility(false);
  // DevTools só em desenvolvimento, não em builds distribuídos
  if (!app.isPackaged) win.webContents.openDevTools();
  win.loadFile('index.html');
}

// Em vez de gerar o token aqui (o que exigiria guardar a chave secreta do
// LiveKit em cada instalação distribuída), pedimos ao servidor de token,
// que é o único lugar que conhece essa chave.
ipcMain.handle('gerar-token-seguro', async (event, { sala, usuario }) => {
  if (!sala || !usuario) throw new Error('Sala e usuário são obrigatórios.');

  const resposta = await fetch(`${TOKEN_SERVER_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-invite-key': INVITE_KEY
    },
    body: JSON.stringify({ sala, usuario })
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    throw new Error(erro.erro || `O servidor de token respondeu com erro ${resposta.status}.`);
  }

  const dados = await resposta.json();
  if (dados.token) return dados.token;
  if (dados.aguardando) return esperarAprovacao(dados.solicitacaoId);

  throw new Error('Resposta inesperada do servidor de token.');
});

// A sala tem um anfitrião: fica consultando o servidor até ele decidir,
// ou até passar o tempo limite.
async function esperarAprovacao(solicitacaoId) {
  const TEMPO_LIMITE_MS = 120000;
  const INTERVALO_MS = 2000;
  const inicio = Date.now();

  while (Date.now() - inicio < TEMPO_LIMITE_MS) {
    await new Promise(resolve => setTimeout(resolve, INTERVALO_MS));

    const resposta = await fetch(`${TOKEN_SERVER_URL}/token/status/${solicitacaoId}`, {
      headers: { 'x-invite-key': INVITE_KEY }
    });
    if (!resposta.ok) continue;

    const dados = await resposta.json();
    if (dados.status === 'aprovado') return dados.token;
    if (dados.status === 'negado') throw new Error('O anfitrião recusou sua entrada na sala.');
  }

  throw new Error('Tempo esgotado esperando aprovação do anfitrião.');
}

// Marca o usuário como anfitrião da sala: a partir daí, quem mais tentar
// entrar fica pendente até ele aceitar ou recusar.
ipcMain.handle('tornar-dono', async (event, { sala, usuario }) => {
  await fetch(`${TOKEN_SERVER_URL}/rooms/${encodeURIComponent(sala)}/tornar-dono`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-invite-key': INVITE_KEY
    },
    body: JSON.stringify({ usuario })
  });
});

// O anfitrião usa isso pra ver quem está esperando pra entrar.
ipcMain.handle('listar-pendentes', async (event, { sala }) => {
  const resposta = await fetch(`${TOKEN_SERVER_URL}/rooms/${encodeURIComponent(sala)}/pendentes`, {
    headers: { 'x-invite-key': INVITE_KEY }
  });
  if (!resposta.ok) return [];
  const dados = await resposta.json();
  return dados.pedidos || [];
});

// O anfitrião aceita ou recusa um pedido específico.
ipcMain.handle('decidir-pendente', async (event, { sala, solicitacaoId, decisao }) => {
  await fetch(`${TOKEN_SERVER_URL}/rooms/${encodeURIComponent(sala)}/decidir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-invite-key': INVITE_KEY
    },
    body: JSON.stringify({ solicitacaoId, decisao })
  });
});

// Guarda qual fonte (janela/tela) o usuário escolheu no dropdown, para
// responder ao pedido de getDisplayMedia() feito pelo livekit-client.
let fonteEscolhidaId = null;

ipcMain.handle('definir-fonte', (event, id) => {
  fonteEscolhidaId = id;
});

ipcMain.handle('obter-url-servidor', () => LIVEKIT_URL);

// A partir do Electron 17, desktopCapturer só funciona no processo principal.
ipcMain.handle('listar-fontes', async () => {
  const fontes = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return fontes.map(f => ({ id: f.id, name: f.name }));
});

app.whenReady().then(() => {
  createWindow();

  // Sem isso, navigator.mediaDevices.getDisplayMedia() do renderer falha
  // com "Not supported" no Electron. Aqui respondemos automaticamente com
  // a fonte que o usuário escolheu no dropdown do app.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    const fontes = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    const fonte = fontes.find(f => f.id === fonteEscolhidaId) || fontes[0];
    callback({ video: fonte, audio: 'loopback' });
  });

  // Sem isso, o pedido de microfone (getUserMedia de áudio) é negado
  // silenciosamente pelo Electron, mesmo com permissão do Windows.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Atualização automática: confere os Releases do GitHub configurados em
  // package.json ("build.publish"). Só funciona no app empacotado (.exe
  // instalado) — em desenvolvimento (npm start) isso é ignorado sozinho.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox({
        type: 'info',
        title: 'Atualização pronta',
        message: 'Uma nova versão do Concord foi baixada. Reiniciar agora pra instalar?',
        buttons: ['Reiniciar agora', 'Depois']
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('Erro ao verificar atualização:', err);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

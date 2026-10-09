const path = require('path');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { migrarDadosAntigos } = require('./migrar-dados');
const { montarPerfilDiscord } = require('./perfil-discord');
const { lerConfiguracao, salvarConfiguracao } = require('./configuracao');

// Carrega o .env pelo caminho absoluto da pasta do app, não pela pasta
// "atual" de execução — sem isso, o .env não é encontrado quando o app
// está instalado (o diretório de trabalho muda dependendo do atalho).
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Copia o nome e os canais salvos da pasta de dados da época em que o app
// tinha outro nome ("Concord"). Roda antes do app abrir; se não houver nada
// pra copiar, não faz nada. Veja migrar-dados.js.
migrarDadosAntigos(app.getPath('appData'), app.getPath('userData'));

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

// ============================================================
// Discord Rich Presence — mostra no perfil do Discord o que a pessoa
// está fazendo no Estrivisor ("Compartilhando tela", "Em canal de voz").
//
// - Funciona só se o Discord DESKTOP estiver aberto no mesmo PC.
// - Fala com o Discord por um canal local (nada passa pela internet).
// - O Application ID não é segredo (pode ir no .exe). Sem ele, o recurso
//   simplesmente fica desligado.
// - Se o Discord não estiver aberto, não dá erro: tenta de novo de tempos
//   em tempos, em silêncio.
// ============================================================
const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();

let rpcClient = null;
let rpcPronto = false;
let atividadeDiscord = null; // { details, state, inicio } ou null (= limpar)
let timerReconexaoRpc = null;
let usuarioDiscord = null;   // { id, nome, avatar } de quem está logado no Discord aberto
let janelaPrincipal = null;

// Avisa a janela quando o perfil do Discord ficar disponível (ou mudar).
function enviarUsuarioDiscord() {
  if (janelaPrincipal && !janelaPrincipal.isDestroyed()) {
    janelaPrincipal.webContents.send('usuario-discord', usuarioDiscord);
  }
}

function aplicarAtividadeDiscord() {
  if (!rpcClient || !rpcPronto) return;
  try {
    if (!atividadeDiscord) {
      rpcClient.clearActivity().catch(() => {});
      return;
    }
    rpcClient.setActivity({
      details: atividadeDiscord.details,
      state: atividadeDiscord.state,
      startTimestamp: new Date(atividadeDiscord.inicio),
      instance: false
    }).catch(() => {});
  } catch (e) {
    // Qualquer falha aqui não pode derrubar o app.
  }
}

function agendarReconexaoRpc() {
  if (timerReconexaoRpc) return;
  timerReconexaoRpc = setTimeout(() => {
    timerReconexaoRpc = null;
    conectarDiscordRpc();
  }, 30000);
}

function conectarDiscordRpc() {
  if (!DISCORD_CLIENT_ID) return; // recurso desligado até colocar o ID no .env

  let RPC;
  try {
    RPC = require('discord-rpc');
  } catch (e) {
    console.warn('[discord] biblioteca discord-rpc não instalada; Rich Presence desligado.');
    return;
  }

  const client = new RPC.Client({ transport: 'ipc' });

  client.on('ready', () => {
    rpcClient = client;
    rpcPronto = true;
    console.log('[discord] Rich Presence conectado.');
    aplicarAtividadeDiscord();

    // O Discord informa quem está logado nele; usamos isso como perfil.
    usuarioDiscord = montarPerfilDiscord(client.user);
    if (usuarioDiscord) {
      console.log('[discord] Perfil carregado:', usuarioDiscord.nome);
      enviarUsuarioDiscord();
    }
  });

  client.on('disconnected', () => {
    rpcPronto = false;
    rpcClient = null;
    agendarReconexaoRpc();
  });

  client.login({ clientId: DISCORD_CLIENT_ID }).catch(() => {
    // Discord provavelmente não está aberto — tenta de novo daqui a pouco.
    rpcPronto = false;
    rpcClient = null;
    agendarReconexaoRpc();
  });
}

// O app pergunta pelo perfil do Discord ao abrir. "configurado" diz se o
// recurso está ligado (se tem DISCORD_CLIENT_ID no .env); sem isso não vale
// a pena esperar pelo Discord.
ipcMain.handle('obter-usuario-discord', () => ({
  configurado: Boolean(DISCORD_CLIENT_ID),
  usuario: usuarioDiscord
}));

// O renderer avisa o que a pessoa está fazendo; null limpa o status.
ipcMain.handle('definir-atividade-discord', (event, atividade) => {
  if (atividade && typeof atividade === 'object') {
    atividadeDiscord = {
      details: String(atividade.details || '').slice(0, 120),
      state: String(atividade.state || '').slice(0, 120),
      inicio: Number(atividade.inicio) || Date.now()
    };
  } else {
    atividadeDiscord = null;
  }
  aplicarAtividadeDiscord();
});

// ============================================================
// Segundo plano (bandeja do sistema)
//
// Ao clicar no X, o app NÃO fecha: a janela some e ele continua rodando na bandeja
// (perto do relógio) — a conexão de voz, o chat e o status do Discord continuam ativos.
// Pra fechar de verdade: ícone da bandeja > "Sair do Estrivisor".
// ============================================================
const CAMINHO_ICONE = path.join(__dirname, 'icone.png');
let bandeja = null;
let encerrando = false; // vira true quando o app está saindo DE VERDADE
let configuracao = lerConfiguracao(app.getPath('userData'));

// Só uma cópia do app por vez: abrir de novo traz de volta a janela escondida na bandeja.
// (Em desenvolvimento — npm start — não vale, pra não esbarrar com o app instalado.)
const instanciaPrincipal = !app.isPackaged || app.requestSingleInstanceLock();
if (!instanciaPrincipal) app.quit();

function mostrarJanela() {
  if (!janelaPrincipal || janelaPrincipal.isDestroyed()) {
    createWindow();
    return;
  }
  if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
  janelaPrincipal.show();
  janelaPrincipal.focus();
}

function sairDeVez() {
  encerrando = true;
  app.quit();
}

function atualizarMenuBandeja() {
  if (!bandeja) return;
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir o Estrivisor', click: mostrarJanela },
    { type: 'separator' },
    {
      label: 'Continuar em segundo plano ao fechar a janela',
      type: 'checkbox',
      checked: configuracao.fecharParaBandeja,
      click: (item) => {
        configuracao = salvarConfiguracao(app.getPath('userData'), { fecharParaBandeja: item.checked });
      }
    },
    { type: 'separator' },
    { label: 'Sair do Estrivisor', click: sairDeVez }
  ]));
}

function criarBandeja() {
  try {
    const imagem = nativeImage.createFromPath(CAMINHO_ICONE).resize({ width: 16, height: 16 });
    bandeja = new Tray(imagem);
    bandeja.setToolTip('Estrivisor');
    bandeja.on('click', mostrarJanela);
    bandeja.on('double-click', mostrarJanela);
    atualizarMenuBandeja();
  } catch (e) {
    // Sem bandeja (sistema sem suporte, ícone ausente...): o app funciona normal e o X fecha de verdade.
    console.warn('[bandeja] não foi possível criar o ícone:', e.message);
    bandeja = null;
  }
}

// Na primeira vez que a janela some, explica pra onde o app foi (uma vez só).
function avisarBandeja() {
  if (configuracao.avisoBandejaMostrado) return;
  configuracao = salvarConfiguracao(app.getPath('userData'), { avisoBandejaMostrado: true });
  if (bandeja && typeof bandeja.displayBalloon === 'function') {
    bandeja.displayBalloon({
      iconType: 'info',
      title: 'O Estrivisor continua aberto',
      content: 'Ele ficou na bandeja, perto do relógio. Clique no ícone pra abrir de novo, ou com o botão direito > Sair pra fechar de vez.'
    });
  }
}

function aoFecharJanela(evento) {
  // Fecha de verdade se: o app está saindo, a pessoa desligou o segundo plano, ou não há bandeja.
  if (encerrando || !configuracao.fecharParaBandeja || !bandeja) return;
  evento.preventDefault();
  janelaPrincipal.hide();
  avisarBandeja();
}

// Qualquer pedido de saída (menu da bandeja, atualização automática, sistema) libera o fechamento.
app.on('before-quit', () => { encerrando = true; });
if (instanciaPrincipal) app.on('second-instance', mostrarJanela);

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 750,
    title: 'Estrivisor',
    icon: CAMINHO_ICONE,
    backgroundColor: '#1e1f22',
    webPreferences: {
      nodeIntegration: false,      // renderer não acessa Node diretamente
      contextIsolation: true,      // isola o mundo JS do preload/renderer
      sandbox: true,
      webSecurity: true,           // não desabilitar política de mesma origem
      // Com a janela escondida na bandeja, o Chromium não pode "economizar" (desacelerar
      // timers e a página): a chamada de voz e o status do Discord precisam seguir normais.
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.setMenuBarVisibility(false);
  // A janela só mostra o app: nada de navegar pra outra página (ex.: arquivo solto em cima
  // dela) nem abrir janelas novas.
  win.webContents.on('will-navigate', (evento) => evento.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // DevTools só em desenvolvimento, não em builds distribuídos
  if (!app.isPackaged) win.webContents.openDevTools();
  janelaPrincipal = win;
  win.on('close', aoFecharJanela);
  win.on('session-end', () => { encerrando = true; }); // Windows desligando / encerrando a sessão
  win.on('closed', () => { if (janelaPrincipal === win) janelaPrincipal = null; });
  win.loadFile('index.html');
}

// Em vez de gerar o token aqui (o que exigiria guardar a chave secreta do
// LiveKit em cada instalação distribuída), pedimos ao servidor de token,
// que é o único lugar que conhece essa chave.
ipcMain.handle('gerar-token-seguro', async (event, { sala, usuario, nome, avatar }) => {
  if (!sala || !usuario) throw new Error('Sala e usuário são obrigatórios.');

  const resposta = await fetch(`${TOKEN_SERVER_URL}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-invite-key': INVITE_KEY
    },
    body: JSON.stringify({ sala, usuario, nome, avatar })
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
ipcMain.handle('listar-pendentes', async (event, { sala, usuario }) => {
  const resposta = await fetch(`${TOKEN_SERVER_URL}/rooms/${encodeURIComponent(sala)}/pendentes`, {
    headers: { 'x-invite-key': INVITE_KEY, 'x-usuario': String(usuario || '') }
  });
  if (!resposta.ok) return [];
  const dados = await resposta.json();
  return dados.pedidos || [];
});

// O anfitrião aceita ou recusa um pedido específico.
ipcMain.handle('decidir-pendente', async (event, { sala, solicitacaoId, decisao, usuario }) => {
  await fetch(`${TOKEN_SERVER_URL}/rooms/${encodeURIComponent(sala)}/decidir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-invite-key': INVITE_KEY,
      'x-usuario': String(usuario || '')
    },
    body: JSON.stringify({ solicitacaoId, decisao })
  });
});

// Lista as salas com gente conectada agora, pra mostrar em vez de digitar
// o nome da sala de cabeça.
ipcMain.handle('listar-salas-ativas', async () => {
  const resposta = await fetch(`${TOKEN_SERVER_URL}/rooms/ativas`, {
    headers: { 'x-invite-key': INVITE_KEY }
  });
  if (!resposta.ok) return [];
  const dados = await resposta.json();
  return dados.salas || [];
});

// Moderação: só o anfitrião da sala consegue (o servidor confere).
async function pedirModeracao(sala, acao, usuarioQueMandou, identidadeAlvo, mensagemPadrao) {
  const resposta = await fetch(`${TOKEN_SERVER_URL}/rooms/${encodeURIComponent(sala)}/${acao}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-invite-key': INVITE_KEY
    },
    body: JSON.stringify({ usuarioQueMandou, identidadeAlvo })
  });
  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    throw new Error(erro.erro || mensagemPadrao);
  }
  return resposta.json();
}

ipcMain.handle('forcar-parar-transmissao', (event, { sala, usuarioQueMandou, identidadeAlvo }) =>
  pedirModeracao(sala, 'parar-transmissao', usuarioQueMandou, identidadeAlvo, 'Falha ao forçar parar a transmissão.'));

ipcMain.handle('forcar-mutar-microfone', (event, { sala, usuarioQueMandou, identidadeAlvo }) =>
  pedirModeracao(sala, 'mutar-microfone', usuarioQueMandou, identidadeAlvo, 'Falha ao mutar o microfone.'));

// ---------- Servidores, canais, convites e presença ----------
// O app só conhece a chave de convite aqui no processo principal. A tela pede por este
// canal único, e só passam caminhos que começam com /servidores ou /convites.
const METODOS_API = ['GET', 'POST', 'PATCH', 'DELETE'];
const CAMINHO_API = /^\/(servidores|convites)(\/[A-Za-z0-9._\-]+)*$/;

ipcMain.handle('api-servidor', async (event, { metodo, caminho, corpo, usuario } = {}) => {
  if (!METODOS_API.includes(metodo) || typeof caminho !== 'string' || !CAMINHO_API.test(caminho)) {
    return { ok: false, status: 400, erro: 'Pedido inválido.' };
  }
  if (!usuario || typeof usuario !== 'string') {
    return { ok: false, status: 400, erro: 'Perfil ainda não carregado.' };
  }
  try {
    const resposta = await fetch(`${TOKEN_SERVER_URL}${caminho}`, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'x-invite-key': INVITE_KEY,
        'x-usuario': usuario
      },
      body: corpo !== undefined && metodo !== 'GET' ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) return { ok: false, status: resposta.status, erro: dados.erro || `Erro ${resposta.status} do servidor.` };
    return { ok: true, status: resposta.status, dados };
  } catch (e) {
    return { ok: false, status: 0, erro: 'Sem conexão com o servidor do Estrivisor.' };
  }
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
  if (!instanciaPrincipal) return; // já existe outra cópia aberta (ela foi avisada e mostra a janela)
  criarBandeja();
  createWindow();
  conectarDiscordRpc();

  // Sem isso, navigator.mediaDevices.getDisplayMedia() do renderer falha
  // com "Not supported" no Electron. Aqui respondemos automaticamente com
  // a fonte que o usuário escolheu no dropdown do app.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    let fonte = null;
    try {
      const fontes = await desktopCapturer.getSources({ types: ['window', 'screen'] });
      fonte = fontes.find(f => f.id === fonteEscolhidaId) || null;
    } catch (e) {
      console.warn('[transmissão] não consegui listar as fontes:', e.message);
    }
    if (!fonte) {
      // A tela/janela escolhida não existe mais: recusa em vez de transmitir outra coisa
      // (antes caía na primeira da lista, normalmente a tela inteira).
      try { callback(null); } catch (e) { /* pedido já encerrado */ }
      return;
    }
    callback({ video: fonte, audio: 'loopback' });
  });

  // Sem isso, o pedido de microfone (getUserMedia de áudio) é negado
  // silenciosamente pelo Electron, mesmo com permissão do Windows.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') return callback(true);
    // Tela cheia do vídeo de uma transmissão (botão ⤢). Sem isso o Electron nega em silêncio.
    if (permission === 'fullscreen') return callback(true);
    callback(false);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Atualização automática: confere os Releases do GitHub configurados em
  // package.json ("build.publish"). Só funciona no app empacotado (.exe
  // instalado) — em desenvolvimento (npm start) isso é ignorado sozinho.
  if (app.isPackaged) {
    const LINK_RELEASES = 'https://github.com/mateusdevtsr/Estrivisor/releases/latest';

    // Logs em cada etapa — se travar de novo, dá pra ver exatamente onde,
    // olhando o terminal (ou os logs do electron-updater).
    autoUpdater.on('checking-for-update', () => {
      console.log('[atualização] verificando se tem versão nova...');
    });
    autoUpdater.on('update-available', (info) => {
      console.log('[atualização] versão nova encontrada:', info.version);
    });
    autoUpdater.on('update-not-available', () => {
      console.log('[atualização] já está na versão mais recente.');
    });
    autoUpdater.on('download-progress', (progresso) => {
      console.log(`[atualização] baixando... ${Math.round(progresso.percent)}%`);
    });

    autoUpdater.on('update-downloaded', () => {
      console.log('[atualização] download concluído, perguntando se reinicia agora.');
      dialog.showMessageBox({
        type: 'info',
        title: 'Atualização pronta',
        message: 'Uma nova versão do Estrivisor foi baixada. Reiniciar agora pra instalar?',
        buttons: ['Reiniciar agora', 'Depois']
      }).then(({ response }) => {
        if (response === 0) {
          // isSilent=true: instala sem pedir cliques extras.
          // isForceRunAfter=true: garante que o app reabre sozinho depois.
          autoUpdater.quitAndInstall(true, true);
        }
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('[atualização] erro:', err);
      // Erro não fica mais silencioso — mostra um aviso com link pra
      // baixar manualmente, caso a atualização automática falhe.
      dialog.showMessageBox({
        type: 'warning',
        title: 'Não foi possível atualizar automaticamente',
        message:
          'Houve um problema ao atualizar o Estrivisor automaticamente.\n\n' +
          'Você pode baixar a versão mais recente manualmente em:\n' + LINK_RELEASES,
        buttons: ['OK']
      });
    });

    autoUpdater.checkForUpdatesAndNotify();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

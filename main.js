const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, desktopCapturer, session, dialog, Tray, Menu, nativeImage, shell, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { migrarDadosAntigos } = require('./migrar-dados');
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
let janelaPrincipal = null;

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

// O renderer avisa o que a pessoa está fazendo; null limpa o status.
responder('definir-atividade-discord', (event, atividade) => {
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

// ============================================================
// Pedidos da tela (IPC)
// ============================================================
// Só a própria janela do app (index.html carregado do disco) pode pedir coisas ao processo
// principal. Qualquer outra origem é recusada.
function remetenteValido(evento) {
  const url = evento && evento.senderFrame && evento.senderFrame.url;
  return typeof url === 'string' && url.startsWith('file://') && url.endsWith('/index.html');
}
function responder(canal, fn) {
  ipcMain.handle(canal, (evento, ...args) => {
    if (!remetenteValido(evento)) throw new Error('Pedido recusado: origem desconhecida.');
    return fn(evento, ...args);
  });
}

// ============================================================
// Conta (login) — a sessão fica SÓ aqui no processo principal
// ============================================================
// A chave de sessão que o servidor entrega no login é guardada criptografada pelo próprio
// Windows (safeStorage) na pasta de dados do app. A tela nunca vê essa chave: ela só pede
// as coisas, e este processo manda a chave junto em cada pedido ao servidor.
const sessao = { chave: null, conta: null };
const arquivoSessao = () => path.join(app.getPath('userData'), 'sessao.dat');

function carregarSessao() {
  try {
    const bruto = fs.readFileSync(arquivoSessao());
    const texto = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(bruto) : bruto.toString('utf8');
    const dados = JSON.parse(texto);
    if (dados && typeof dados.chave === 'string' && dados.conta && typeof dados.conta.usuario === 'string') {
      sessao.chave = dados.chave;
      sessao.conta = dados.conta;
    }
  } catch (e) {
    // Sem sessão salva (ou ilegível): a tela pede login.
  }
}

function gravarSessao() {
  try {
    const texto = JSON.stringify({ chave: sessao.chave, conta: sessao.conta });
    const dados = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(texto) : Buffer.from(texto, 'utf8');
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const temporario = arquivoSessao() + '.tmp';
    fs.writeFileSync(temporario, dados);
    fs.renameSync(temporario, arquivoSessao());
  } catch (e) {
    console.warn('[sessão] não consegui salvar:', e.message);
  }
}

function apagarSessao() {
  sessao.chave = null;
  sessao.conta = null;
  try { fs.unlinkSync(arquivoSessao()); } catch (e) { /* já não existia */ }
}

// O servidor disse que a sessão não vale mais (venceu ou foi encerrada): avisa a tela.
function sessaoExpirou(mensagem) {
  if (!sessao.chave) return;
  apagarSessao();
  if (janelaPrincipal && !janelaPrincipal.isDestroyed()) janelaPrincipal.webContents.send('sessao-expirou', typeof mensagem === 'string' ? mensagem.slice(0, 300) : '');
}

// Único lugar que fala com o servidor do Estrivisor.
async function chamarServidor(caminho, { metodo = 'GET', corpo, semSessao = false, tempo = 10000 } = {}) {
  const headers = { 'x-invite-key': INVITE_KEY };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  const chaveUsada = semSessao ? null : sessao.chave;
  if (chaveUsada) headers.Authorization = `Bearer ${chaveUsada}`;
  let resposta;
  try {
    resposta = await fetch(`${TOKEN_SERVER_URL}${caminho}`, {
      method: metodo,
      headers,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(tempo),
    });
  } catch (e) {
    return { ok: false, status: 0, erro: 'Sem conexão com o servidor do Estrivisor.' };
  }
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.ok) return { ok: true, status: resposta.status, dados };
  // Só derruba a sessão se ela ainda for a mesma que foi usada neste pedido.
  if (resposta.status === 401 && dados.codigo === 'login' && chaveUsada && chaveUsada === sessao.chave) sessaoExpirou(dados.erro);
  return { ok: false, status: resposta.status, erro: dados.erro || `Erro ${resposta.status} do servidor.`, codigo: dados.codigo };
}

responder('obter-versao', () => app.getVersion());

// Abre um link de mensagem no navegador padrão. Só http(s), sem usuário/senha na URL.
// (A confirmação com o endereço completo é mostrada na tela antes de chegar aqui.)
responder('abrir-link', (evento, url) => {
  if (typeof url !== 'string' || url.length > 2000) return { ok: false };
  let u;
  try { u = new URL(url); } catch (e) { return { ok: false }; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return { ok: false };
  shell.openExternal(u.href);
  return { ok: true };
});

responder('conta-atual', () => {
  if (!sessao.chave) return { conta: null };
  // Confere com o servidor em segundo plano: atualiza nome/foto ou descobre que a sessão venceu.
  chamarServidor('/auth/eu').then((r) => {
    if (r.ok && r.dados && r.dados.conta) { sessao.conta = r.dados.conta; gravarSessao(); }
  });
  return { conta: sessao.conta };
});

responder('login-local', async (evento, nome) => {
  const r = await chamarServidor('/auth/local', { metodo: 'POST', corpo: { nome: String(nome || '').slice(0, 40) }, semSessao: true });
  if (!r.ok) return { ok: false, erro: r.erro };
  sessao.chave = r.dados.sessao;
  sessao.conta = r.dados.conta;
  gravarSessao();
  return { ok: true, conta: sessao.conta };
});

responder('sair-da-conta', async () => {
  if (sessao.chave) await chamarServidor('/auth/sair', { metodo: 'POST', tempo: 5000 });
  apagarSessao();
  return { ok: true };
});

// ---------- Login com Discord ----------
// 1) Abre o Discord no navegador da pessoa.  2) Depois que ela autoriza, o Discord manda o
// navegador de volta pra http://127.0.0.1:53134/callback — um mini servidor aqui no PC, que
// só existe durante o login.  3) O código recebido vai pro servidor do Estrivisor, que confirma
// a conta com o Discord e devolve a sessão. O Client Secret nunca passa por este PC.
const DISCORD_REDIRECT_URI = (process.env.DISCORD_REDIRECT_URI || 'http://127.0.0.1:53134/callback').trim();
let loginDiscordAtual = null; // { promessa, cancelar }

function paginaDeRetorno(titulo, texto) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Estrivisor</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d10;color:#e8eaed;font-family:"Segoe UI",sans-serif}
.c{background:#14171b;border:1px solid #23272c;border-radius:12px;padding:28px 32px;max-width:420px;text-align:center}
h1{font-size:20px;margin:0 0 10px}p{color:#8a919a;margin:0;line-height:1.5}</style></head>
<body><div class="c"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p></div></body></html>`;
}

function loginComDiscord() {
  if (loginDiscordAtual) return loginDiscordAtual.promessa; // já tem um login aberto: reaproveita
  let finalizar = null;
  const promessa = new Promise((resolve) => {
    if (!DISCORD_CLIENT_ID) {
      resolve({ ok: false, erro: 'O login com Discord não está configurado (falta DISCORD_CLIENT_ID no .env).' });
      return;
    }
    let destino;
    try { destino = new URL(DISCORD_REDIRECT_URI); } catch (e) {
      resolve({ ok: false, erro: 'DISCORD_REDIRECT_URI inválido no .env.' });
      return;
    }
    const estado = crypto.randomBytes(16).toString('hex'); // protege contra um retorno falso
    let terminado = false;
    let relogio = null;
    const servidorLocal = http.createServer(async (req, res) => {
      const url = new URL(req.url, DISCORD_REDIRECT_URI);
      if (req.method !== 'GET' || url.pathname !== destino.pathname) { res.writeHead(404); res.end(); return; }
      const enviarPagina = (status, titulo, texto) => {
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(paginaDeRetorno(titulo, texto));
      };
      if (url.searchParams.get('state') !== estado) {
        enviarPagina(400, 'Link de login inválido', 'Volte ao Estrivisor e clique em "Entrar com Discord" de novo.');
        return;
      }
      if (url.searchParams.get('error')) {
        enviarPagina(200, 'Login cancelado', 'Você pode fechar esta aba e voltar ao Estrivisor.');
        finalizar({ ok: false, cancelado: true });
        return;
      }
      const codigo = url.searchParams.get('code');
      if (!codigo) { enviarPagina(400, 'Algo deu errado', 'O Discord não mandou o código de login. Tente de novo.'); return; }
      const r = await chamarServidor('/auth/discord', { metodo: 'POST', corpo: { codigo, redirectUri: DISCORD_REDIRECT_URI }, semSessao: true, tempo: 20000 });
      if (!r.ok) {
        enviarPagina(200, 'Não deu certo', `${r.erro} Volte ao Estrivisor e tente de novo.`);
        finalizar({ ok: false, erro: r.erro });
        return;
      }
      sessao.chave = r.dados.sessao;
      sessao.conta = r.dados.conta;
      gravarSessao();
      enviarPagina(200, 'Pronto!', 'Você entrou no Estrivisor. Pode fechar esta aba e voltar pro app.');
      finalizar({ ok: true, conta: sessao.conta });
      mostrarJanela();
    });

    finalizar = (resultado) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(relogio);
      servidorLocal.close();
      loginDiscordAtual = null;
      resolve(resultado);
    };
    relogio = setTimeout(() => finalizar({ ok: false, erro: 'O login demorou demais. Tente de novo.' }), 5 * 60 * 1000);
    servidorLocal.on('error', (e) => finalizar({
      ok: false,
      erro: e.code === 'EADDRINUSE'
        ? `A porta ${destino.port} (usada no login) está ocupada por outro programa. Feche-o e tente de novo.`
        : 'Não consegui iniciar o login.',
    }));
    // Só escuta no próprio PC (127.0.0.1): ninguém da rede consegue acessar.
    servidorLocal.listen(Number(destino.port) || 80, destino.hostname, () => {
      const parametros = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        response_type: 'code',
        redirect_uri: DISCORD_REDIRECT_URI,
        scope: 'identify',
        state: estado,
        prompt: 'none', // quem já autorizou antes não precisa clicar de novo
      });
      shell.openExternal(`https://discord.com/oauth2/authorize?${parametros}`);
    });
  });
  // (Se nem deu pra começar — falta configuração —, não fica nenhum login "pendurado".)
  if (finalizar) loginDiscordAtual = { promessa, cancelar: () => finalizar({ ok: false, cancelado: true }) };
  return promessa;
}

responder('login-discord', () => loginComDiscord());
responder('cancelar-login', () => { if (loginDiscordAtual) loginDiscordAtual.cancelar(); });

// ============================================================
// Canais de voz/texto (tokens do LiveKit)
// ============================================================
// Em vez de gerar o token aqui (o que exigiria guardar a chave secreta do LiveKit em cada
// instalação), pedimos ao servidor do Estrivisor, que é o único lugar que conhece essa chave.
// Endereço do LiveKit que o servidor indicou junto com o último token. Se o servidor for de uma
// versão antiga (não manda "url"), cai no LIVEKIT_URL do .env do app.
let urlLivekitDoServidor = null;
function guardarUrlLivekit(url) {
  if (typeof url === 'string' && /^wss?:\/\//.test(url)) urlLivekitDoServidor = url;
}

responder('gerar-token-seguro', async (evento, { sala, nome } = {}) => {
  if (typeof sala !== 'string' || !sala) throw new Error('Sala inválida.');
  const r = await chamarServidor('/token', { metodo: 'POST', corpo: { sala, nome } });
  if (!r.ok) throw new Error(r.erro);
  guardarUrlLivekit(r.dados.url);
  if (r.dados.token) return r.dados.token;
  if (r.dados.aguardando) return esperarAprovacao(r.dados.solicitacaoId);
  throw new Error('Resposta inesperada do servidor de token.');
});

// O canal pede aprovação e o dono está lá: consulta o servidor até ele decidir.
async function esperarAprovacao(solicitacaoId) {
  const TEMPO_LIMITE_MS = 120000;
  const INTERVALO_MS = 2000;
  const inicio = Date.now();
  while (Date.now() - inicio < TEMPO_LIMITE_MS) {
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
    const r = await chamarServidor(`/token/status/${encodeURIComponent(solicitacaoId)}`);
    if (!r.ok) {
      if (r.status === 404) throw new Error('O pedido de entrada expirou. Tente de novo.');
      continue; // falha de rede momentânea: tenta de novo
    }
    if (r.dados.status === 'aprovado') { guardarUrlLivekit(r.dados.url); return r.dados.token; }
    if (r.dados.status === 'negado') throw new Error('O dono recusou sua entrada na sala.');
  }
  throw new Error('Tempo esgotado esperando a aprovação do dono.');
}

// O dono vê quem está esperando pra entrar...
responder('listar-pendentes', async (evento, { sala } = {}) => {
  const r = await chamarServidor(`/rooms/${encodeURIComponent(String(sala || ''))}/pendentes`);
  return r.ok ? (r.dados.pedidos || []) : [];
});

// ...e aceita ou recusa.
responder('decidir-pendente', async (evento, { sala, solicitacaoId, decisao } = {}) => {
  const r = await chamarServidor(`/rooms/${encodeURIComponent(String(sala || ''))}/decidir`, { metodo: 'POST', corpo: { solicitacaoId, decisao } });
  if (!r.ok) throw new Error(r.erro);
});

// Moderação: só o dono do servidor consegue (o servidor confere pela sessão).
async function pedirModeracao(sala, acao, identidadeAlvo) {
  const r = await chamarServidor(`/rooms/${encodeURIComponent(String(sala || ''))}/${acao}`, { metodo: 'POST', corpo: { identidadeAlvo } });
  if (!r.ok) throw new Error(r.erro);
  return r.dados;
}
responder('forcar-parar-transmissao', (evento, { sala, identidadeAlvo } = {}) => pedirModeracao(sala, 'parar-transmissao', identidadeAlvo));
responder('forcar-mutar-microfone', (evento, { sala, identidadeAlvo } = {}) => pedirModeracao(sala, 'mutar-microfone', identidadeAlvo));

// ---------- Servidores, canais, convites e presença ----------
// A tela pede por este canal único; só passam caminhos que começam com /servidores, /convites, /amigos, /dm, /admin, /termos, /denuncias ou /qualidade.
const METODOS_API = ['GET', 'POST', 'PATCH', 'DELETE'];
const CAMINHO_API = /^\/(servidores|convites|amigos|dm|admin|termos|denuncias|qualidade)(\/[A-Za-z0-9._%\-]+)*(\?[A-Za-z0-9=&._\-]*)?$/;

responder('api-servidor', async (evento, { metodo, caminho, corpo } = {}) => {
  if (!METODOS_API.includes(metodo) || typeof caminho !== 'string' || !CAMINHO_API.test(caminho)) {
    return { ok: false, status: 400, erro: 'Pedido inválido.' };
  }
  if (!sessao.chave) return { ok: false, status: 401, erro: 'Entre com a sua conta primeiro.', codigo: 'login' };
  return chamarServidor(caminho, { metodo, corpo: metodo === 'GET' ? undefined : corpo });
});

// ---------- Transmissão de tela ----------
// Guarda qual fonte (janela/tela) o usuário escolheu na lista, para responder ao pedido de
// getDisplayMedia() feito pelo livekit-client.
let fonteEscolhidaId = null;

responder('definir-fonte', (evento, id) => {
  fonteEscolhidaId = typeof id === 'string' ? id : null;
});

responder('obter-url-servidor', () => urlLivekitDoServidor || LIVEKIT_URL);

// A partir do Electron 17, desktopCapturer só funciona no processo principal.
responder('listar-fontes', async () => {
  const fontes = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return fontes.map(f => ({ id: f.id, name: f.name }));
});

app.whenReady().then(() => {
  if (!instanciaPrincipal) return; // já existe outra cópia aberta (ela foi avisada e mostra a janela)
  carregarSessao();
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
    // O aviso de falha só aparece se a atualização foi ENCONTRADA e deu erro ao baixar/instalar.
    // Sem internet ao abrir o app, o erro fica só no log (não é problema de quem está usando).
    let atualizacaoEncontrada = false;
    autoUpdater.on('update-available', (info) => {
      atualizacaoEncontrada = true;
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
      if (!atualizacaoEncontrada) return; // erro de rede ao procurar: só log
      // Havia versão nova e o download/instalação falhou: avisa com link pra baixar manualmente.
      dialog.showMessageBox({
        type: 'warning',
        title: 'Não foi possível atualizar automaticamente',
        message:
          'Houve um problema ao atualizar o Estrivisor automaticamente.\n\n' +
          'Você pode baixar a versão mais recente manualmente em:\n' + LINK_RELEASES,
        buttons: ['OK']
      });
    });

    // checkForUpdates (sem "AndNotify"): quem avisa é só a janela "Atualização pronta" acima,
    // sem notificação duplicada do Windows.
    autoUpdater.checkForUpdates().catch((e) => console.error('[atualização] falha ao verificar:', e && e.message));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

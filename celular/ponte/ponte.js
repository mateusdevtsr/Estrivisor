// ============================================================
// Ponte do app de celular: faz no Android o papel que o main.js + preload.js fazem no PC.
// Cria window.electronAPI com os MESMOS nomes, então o estrivisor-app.js roda sem mudanças.
//
// - A sessão (chave de login) fica guardada só neste celular (armazenamento privado do app).
// - Os pedidos ao servidor saem pelo HTTP nativo do Android (não pelo navegador): só para o
//   endereço do Estrivisor e só nos caminhos liberados — a mesma lista do app do PC.
// - O login com Discord abre o navegador e volta pelo link estrivisor://login (veja celular.js no servidor).
//
// Os valores __TOKEN_SERVER_URL__ etc. são trocados na montagem (montar-www.js), vindos dos segredos do GitHub.
// ============================================================
import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { PushNotifications } from '@capacitor/push-notifications';
import { iniciarTelaCelular } from './tela.js';

/* global __TOKEN_SERVER_URL__, __INVITE_KEY__, __LIVEKIT_URL__, __VERSAO__, __PUSH_ATIVO__ */
const TOKEN_SERVER_URL = __TOKEN_SERVER_URL__;
const INVITE_KEY = __INVITE_KEY__;
const LIVEKIT_URL = __LIVEKIT_URL__;
const VERSAO = __VERSAO__;
const PUSH_ATIVO = __PUSH_ATIVO__; // false quando o APK foi montado sem o google-services.json
const VozCelular = registerPlugin('VozCelular');

const CHAVE_SESSAO = 'estrivisor_sessao';
const CHAVE_LOGIN_PENDENTE = 'estrivisor_login_pendente';
const sessao = { chave: null, conta: null };
let aoExpirar = null;

async function gravarSessao() {
  await Preferences.set({ key: CHAVE_SESSAO, value: JSON.stringify({ chave: sessao.chave, conta: sessao.conta }) });
}
async function apagarSessao() {
  sessao.chave = null; sessao.conta = null;
  await Preferences.remove({ key: CHAVE_SESSAO });
}
function sessaoExpirou(mensagem) {
  apagarSessao().catch(() => {});
  if (aoExpirar) { try { aoExpirar(mensagem || 'A sua sessão expirou. Entre de novo.'); } catch (e) {} }
}

// ---------- Falar com o servidor ----------
async function chamarServidor(caminho, { metodo = 'GET', corpo, semSessao = false, tempo = 10000 } = {}) {
  const headers = { 'x-invite-key': INVITE_KEY, 'x-app-versao': VERSAO, Accept: 'application/json' };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';
  const chaveUsada = semSessao ? null : sessao.chave;
  if (chaveUsada) headers.Authorization = `Bearer ${chaveUsada}`;
  let r;
  try {
    r = await CapacitorHttp.request({
      url: TOKEN_SERVER_URL + caminho, method: metodo, headers,
      data: corpo, connectTimeout: tempo, readTimeout: tempo, responseType: 'json'
    });
  } catch (e) {
    return { ok: false, status: 0, erro: 'Sem conexão com o servidor do Estrivisor.' };
  }
  let dados = r.data;
  if (typeof dados === 'string') { try { dados = JSON.parse(dados); } catch (e) { dados = {}; } }
  if (!dados || typeof dados !== 'object') dados = {};
  if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, dados };
  if (r.status === 401 && dados.codigo === 'login' && chaveUsada && chaveUsada === sessao.chave) sessaoExpirou(dados.erro);
  return { ok: false, status: r.status, erro: dados.erro || `Erro ${r.status} do servidor.`, codigo: dados.codigo };
}

// Mesma lista de caminhos do main.js do PC (a tela só pede o que está aqui).
const METODOS_API = ['GET', 'POST', 'PATCH', 'DELETE'];
const CAMINHO_API = /^\/(servidores|convites|amigos|dm|admin|termos|denuncias|qualidade|conta|previa|perfil)(\/[A-Za-z0-9._%\-]+)*(\?[A-Za-z0-9=&._\-]*)?$/;
function caminhoApiValido(caminho) {
  if (typeof caminho !== 'string' || caminho.length > 600 || !CAMINHO_API.test(caminho)) return false;
  const semConsulta = caminho.split('?')[0];
  if (/%2e|%2f|%5c/i.test(semConsulta)) return false;
  return !semConsulta.split('/').some((parte) => parte === '.' || parte === '..');
}

// ---------- Login com Discord (navegador -> estrivisor://login) ----------
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function sha256Hex(texto) {
  const resumo = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
let loginAtual = null; // { resolver, relogio }
function terminarLogin(resultado) {
  if (!loginAtual) return;
  const { resolver, relogio } = loginAtual;
  loginAtual = null;
  clearTimeout(relogio);
  Preferences.remove({ key: CHAVE_LOGIN_PENDENTE }).catch(() => {});
  resolver(resultado);
}
async function trocarTicket(ticket, verificador) {
  const r = await chamarServidor('/auth/celular/trocar', { metodo: 'POST', corpo: { ticket, verificador }, semSessao: true, tempo: 20000 });
  if (!r.ok) return { ok: false, erro: r.erro, cancelado: Boolean(r.dados && r.dados.cancelado) || /cancelad/i.test(r.erro || '') };
  sessao.chave = r.dados.sessao; sessao.conta = r.dados.conta;
  await gravarSessao();
  return { ok: true, conta: sessao.conta };
}
// O link estrivisor://login?ticket=... chegou (com o app aberto ou abrindo o app).
async function receberLink(url) {
  let u;
  try { u = new URL(url); } catch (e) { return; }
  if (u.protocol !== 'estrivisor:' || u.hostname !== 'login') return;
  try { await Browser.close(); } catch (e) {}
  const ticket = u.searchParams.get('ticket');
  const pendente = await Preferences.get({ key: CHAVE_LOGIN_PENDENTE });
  let verificador = null;
  try { const p = JSON.parse(pendente.value || 'null'); if (p && Date.now() - p.inicio < 10 * 60 * 1000) verificador = p.verificador; } catch (e) {}
  if (!ticket || !verificador) {
    terminarLogin({ ok: false, erro: u.searchParams.get('erro') === 'expirado' ? 'O login demorou demais. Tente de novo.' : 'Esse login não começou neste aparelho. Tente de novo.' });
    return;
  }
  const r = await trocarTicket(ticket, verificador);
  if (loginAtual) terminarLogin(r);
  else await Preferences.remove({ key: CHAVE_LOGIN_PENDENTE });
}
async function loginComDiscord() {
  if (loginAtual) return loginAtual.promessa;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verificador = base64url(bytes);
  const desafio = await sha256Hex(verificador);
  // Guardado no aparelho: se o Android fechar o app enquanto o navegador está aberto, o login continua.
  await Preferences.set({ key: CHAVE_LOGIN_PENDENTE, value: JSON.stringify({ verificador, inicio: Date.now() }) });
  let resolver;
  const promessa = new Promise((r) => { resolver = r; });
  loginAtual = { promessa, resolver, relogio: setTimeout(() => terminarLogin({ ok: false, erro: 'O login demorou demais. Tente de novo.' }), 5 * 60 * 1000) };
  try {
    await Browser.open({ url: `${TOKEN_SERVER_URL}/auth/celular/inicio?desafio=${desafio}`, presentationStyle: 'fullscreen' });
  } catch (e) {
    terminarLogin({ ok: false, erro: 'Não consegui abrir o navegador para o login.' });
  }
  return promessa;
}
// Fechou o navegador sem terminar: espera um pouco (o link pode estar chegando) e cancela.
Browser.addListener('browserFinished', () => {
  if (loginAtual) setTimeout(() => { if (loginAtual) terminarLogin({ ok: false, cancelado: true }); }, 4000);
});
App.addListener('appUrlOpen', (e) => { receberLink(e.url); });

// ---------- Token do LiveKit ----------
let urlLivekitDoServidor = null;
const guardarUrlLivekit = (url) => { if (typeof url === 'string' && /^wss?:\/\//.test(url)) urlLivekitDoServidor = url; };
async function esperarAprovacao(solicitacaoId) {
  const inicio = Date.now();
  while (Date.now() - inicio < 120000) {
    await new Promise((r) => setTimeout(r, 2000));
    const r = await chamarServidor(`/token/status/${encodeURIComponent(solicitacaoId)}`);
    if (!r.ok) { if (r.status === 404) throw new Error('O pedido de entrada expirou. Tente de novo.'); continue; }
    if (r.dados.status === 'aprovado') { guardarUrlLivekit(r.dados.url); return r.dados.token; }
    if (r.dados.status === 'negado') throw new Error('O dono recusou sua entrada na sala.');
  }
  throw new Error('Tempo esgotado esperando a aprovação do dono.');
}
async function pedirModeracao(sala, acao, identidadeAlvo) {
  const r = await chamarServidor(`/rooms/${encodeURIComponent(String(sala || ''))}/${acao}`, { metodo: 'POST', corpo: { identidadeAlvo } });
  if (!r.ok) throw new Error(r.erro);
  return r.dados;
}

// ---------- Imagens e arquivos: no celular, "salvar" abre o menu de compartilhar do Android ----------
const TIPOS_IMAGEM = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
async function compartilharArquivo(nome, dados, encoding) {
  const escrito = await Filesystem.writeFile({ path: nome, data: dados, directory: Directory.Cache, ...(encoding ? { encoding } : {}) });
  await Share.share({ title: 'Estrivisor', files: [escrito.uri], dialogTitle: 'Salvar ou enviar' });
}

// ---------- Aviso "Na chamada" do Android (sem ele o microfone para quando a tela apaga) ----------
let vozLigada = false, tentativasVoz = [];
function vozMudou(conectado) {
  vozLigada = Boolean(conectado);
  tentativasVoz.forEach(clearTimeout); tentativasVoz = [];
  if (!vozLigada) { VozCelular.parar().catch(() => {}); return; }
  // A permissão do microfone pode chegar alguns segundos depois de entrar: tenta de novo.
  const tentar = () => { if (vozLigada) VozCelular.iniciar({ texto: 'Você está numa chamada de voz' }).catch(() => {}); };
  tentar();
  tentativasVoz = [setTimeout(tentar, 3000), setTimeout(tentar, 10000)];
}

// ---------- Notificações (Firebase) ----------
// O celular pede permissão, ganha um "endereço de notificação" do Google e manda pro servidor junto com o
// que a pessoa quer receber. Tocar na notificação abre a conversa (abrirConversaDeAviso, no estrivisor-app.js).
const CHAVE_PREFS_NOTIF = 'estrivisor_notificacoes';
let notificacoesLigadas = false;
const notif = { token: null, permissao: 'desconhecida', erro: null, pendente: null, ouvintes: false };
function prefsNotif() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(CHAVE_PREFS_NOTIF) || '{}') || {}; } catch (e) {}
  return { dm: p.dm !== false, mencoes: p.mencoes !== false, canais: p.canais === true };
}
async function enviarAparelho() {
  if (!notif.token || !sessao.chave) return;
  const r = await chamarServidor('/conta/aparelho', { metodo: 'POST', corpo: { token: notif.token, ...prefsNotif() } });
  notif.erro = r.ok ? null : (r.erro || 'O servidor não aceitou o aparelho.');
  if (r.ok && r.dados && r.dados.ativo === false) notif.erro = 'As notificações ainda não foram ligadas no servidor (falta a chave do Firebase).';
}
function abrirDoAviso(dados) {
  if (!dados || typeof dados !== 'object') return;
  const limpo = { tipo: String(dados.tipo || ''), amigo: dados.amigo ? String(dados.amigo) : '', servidor: dados.servidor ? String(dados.servidor) : '', canal: dados.canal ? String(dados.canal) : '' };
  if (typeof window.abrirConversaDeAviso === 'function') window.abrirConversaDeAviso(limpo);
  else notif.pendente = limpo; // o app ainda está abrindo: a tela pega depois
}
async function ligarNotificacoes({ perguntar = true } = {}) {
  if (!PUSH_ATIVO) { notif.permissao = 'indisponivel'; return; }
  if (!notif.ouvintes) {
    notif.ouvintes = true;
    await PushNotifications.addListener('registration', (t) => { notif.token = t.value; enviarAparelho(); });
    await PushNotifications.addListener('registrationError', (e) => { notif.erro = 'O Google não registrou este celular (' + (e && e.error) + ').'; });
    await PushNotifications.addListener('pushNotificationActionPerformed', (a) => abrirDoAviso(a && a.notification && a.notification.data));
    // Com o app aberto na tela o próprio app já mostra a mensagem: nada a fazer aqui.
    await PushNotifications.addListener('pushNotificationReceived', () => {});
  }
  try {
    let p = await PushNotifications.checkPermissions();
    if (p.receive === 'prompt' || p.receive === 'prompt-with-rationale') { if (!perguntar) { notif.permissao = 'prompt'; return; } p = await PushNotifications.requestPermissions(); }
    notif.permissao = p.receive;
    if (p.receive !== 'granted') return;
    await PushNotifications.createChannel({ id: 'mensagens', name: 'Mensagens', description: 'Mensagens diretas, menções e canais que você escolheu', importance: 4, visibility: 1, vibration: true });
    await PushNotifications.register();
  } catch (e) { notif.erro = 'Não consegui ligar as notificações (' + (e && e.message) + ').'; }
}

// ---------- Carrega a sessão guardada antes de a tela perguntar ----------
const pronto = (async () => {
  // App acabou de ser instalado no celular: não mostra "O que há de novo" de versões que a pessoa nunca usou aqui.
  try { if (!localStorage.getItem('estrivisor_novidade_vista')) localStorage.setItem('estrivisor_novidade_vista', VERSAO); } catch (e) {}
  try {
    const v = await Preferences.get({ key: CHAVE_SESSAO });
    const s = JSON.parse(v.value || 'null');
    if (s && typeof s.chave === 'string') { sessao.chave = s.chave; sessao.conta = s.conta || null; }
  } catch (e) {}
  // Abriu pelo link do login (o Android tinha fechado o app enquanto o navegador estava aberto)?
  try {
    const lancado = await App.getLaunchUrl();
    if (lancado && lancado.url) await receberLink(lancado.url);
  } catch (e) {}
})();
const depois = (fn) => async (...args) => { await pronto; return fn(...args); };

window.electronAPI = {
  plataforma: 'android',
  definirZoom: (fator) => {
    const n = Number(fator);
    if (Number.isFinite(n) && n >= 0.8 && n <= 1.5) document.documentElement.style.zoom = String(n);
  },
  versaoApp: async () => { try { return (await App.getInfo()).version || VERSAO; } catch (e) { return VERSAO; } },
  abrirLink: async (url) => {
    let u; try { u = new URL(String(url)); } catch (e) { return { ok: false }; }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return { ok: false };
    await Browser.open({ url: u.href });
    return { ok: true };
  },
  copiarImagem: async (dados) => {
    try {
      if (!dados || !TIPOS_IMAGEM[dados.tipo] || typeof ClipboardItem === 'undefined') return { ok: false };
      const bin = Uint8Array.from(atob(dados.base64), (c) => c.charCodeAt(0));
      // A área de transferência do Android só aceita PNG; outros formatos ficam de fora.
      if (dados.tipo !== 'image/png') return { ok: false, erro: 'No celular só dá pra copiar imagens PNG. Use "Salvar".' };
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bin], { type: 'image/png' }) })]);
      return { ok: true };
    } catch (e) { return { ok: false }; }
  },
  salvarImagem: async (dados) => {
    if (!dados || !TIPOS_IMAGEM[dados.tipo] || typeof dados.base64 !== 'string') return { ok: false, erro: 'Imagem inválida.' };
    try { await compartilharArquivo(`estrivisor-imagem-${Date.now()}.${TIPOS_IMAGEM[dados.tipo]}`, dados.base64); return { ok: true }; }
    catch (e) { return /cancel/i.test(String(e && e.message)) ? { ok: false, cancelado: true } : { ok: false, erro: 'Não consegui salvar a imagem.' }; }
  },
  exportarMeusDados: depois(async () => {
    if (!sessao.chave) return { ok: false, erro: 'Entre com a sua conta primeiro.' };
    const r = await chamarServidor('/conta/dados', { tempo: 20000 });
    if (!r.ok) return { ok: false, erro: r.erro };
    try { await compartilharArquivo('estrivisor-meus-dados.json', JSON.stringify(r.dados, null, 2), Encoding.UTF8); }
    catch (e) { return /cancel/i.test(String(e && e.message)) ? { ok: false, cancelado: true } : { ok: false, erro: 'Não consegui salvar o arquivo.' }; }
    return { ok: true, arquivo: 'o lugar que você escolheu' };
  }),
  apagarMinhaConta: depois(async () => {
    if (!sessao.chave) return { ok: false, erro: 'Entre com a sua conta primeiro.' };
    const r = await chamarServidor('/conta/dados', { metodo: 'DELETE', corpo: { confirmacao: 'APAGAR' }, tempo: 30000 });
    if (r.ok) await apagarSessao();
    return r.ok ? { ok: true, mensagensApagadas: r.dados.mensagensApagadas } : { ok: false, erro: r.erro };
  }),

  // Conta / login
  contaAtual: depois(async () => {
    if (!sessao.chave) return { conta: null };
    if (!notificacoesLigadas) { notificacoesLigadas = true; setTimeout(() => ligarNotificacoes(), 2500); }
    chamarServidor('/auth/eu').then((r) => { if (r.ok && r.dados && r.dados.conta) { sessao.conta = r.dados.conta; gravarSessao().catch(() => {}); } });
    return { conta: sessao.conta };
  }),
  loginDiscord: depois(() => loginComDiscord()),
  cancelarLogin: async () => { terminarLogin({ ok: false, cancelado: true }); try { await Browser.close(); } catch (e) {} },
  loginLocal: depois(async (nome) => {
    const r = await chamarServidor('/auth/local', { metodo: 'POST', corpo: { nome: String(nome || '').slice(0, 40) }, semSessao: true });
    if (!r.ok) return { ok: false, erro: r.erro };
    sessao.chave = r.dados.sessao; sessao.conta = r.dados.conta;
    await gravarSessao();
    return { ok: true, conta: sessao.conta };
  }),
  sairDaConta: depois(async () => {
    // Antes de sair: este celular para de receber avisos dessa conta.
    if (sessao.chave && notif.token) await chamarServidor('/conta/aparelho', { metodo: 'DELETE', corpo: { token: notif.token }, tempo: 5000 });
    if (sessao.chave) await chamarServidor('/auth/sair', { metodo: 'POST', tempo: 5000 });
    notificacoesLigadas = false;
    await apagarSessao();
    return { ok: true };
  }),
  aoExpirarSessao: (callback) => { aoExpirar = callback; },

  // Canais (tokens do LiveKit). Transmitir a tela não existe no celular (por enquanto).
  gerarToken: depois(async ({ sala, nome } = {}) => {
    if (typeof sala !== 'string' || !sala) throw new Error('Sala inválida.');
    const r = await chamarServidor('/token', { metodo: 'POST', corpo: { sala, nome } });
    if (!r.ok) throw new Error(r.erro);
    guardarUrlLivekit(r.dados.url);
    if (r.dados.token) return r.dados.token;
    if (r.dados.aguardando) return esperarAprovacao(r.dados.solicitacaoId);
    throw new Error('Resposta inesperada do servidor de token.');
  }),
  obterUrlServidor: async () => urlLivekitDoServidor || LIVEKIT_URL,
  listarFontes: async () => [],
  definirFonte: async () => {},

  listarPendentes: depois(async ({ sala } = {}) => {
    const r = await chamarServidor(`/rooms/${encodeURIComponent(String(sala || ''))}/pendentes`);
    return r.ok ? (r.dados.pedidos || []) : [];
  }),
  decidirPendente: depois(async ({ sala, solicitacaoId, decisao } = {}) => {
    const r = await chamarServidor(`/rooms/${encodeURIComponent(String(sala || ''))}/decidir`, { metodo: 'POST', corpo: { solicitacaoId, decisao } });
    if (!r.ok) throw new Error(r.erro);
  }),
  apiServidor: depois(async ({ metodo, caminho, corpo } = {}) => {
    if (!METODOS_API.includes(metodo) || !caminhoApiValido(caminho)) return { ok: false, status: 400, erro: 'Pedido inválido.' };
    if (!sessao.chave) return { ok: false, status: 401, erro: 'Entre com a sua conta primeiro.', codigo: 'login' };
    const tempo = metodo === 'POST' && /\/imagens$/.test(caminho) ? 90000 : metodo === 'GET' && /\/imagem$/.test(caminho) ? 30000 : undefined;
    return chamarServidor(caminho, { metodo, corpo: metodo === 'GET' ? undefined : corpo, ...(tempo ? { tempo } : {}) });
  }),

  // Status no Discord (Rich Presence) só existe no PC.
  definirAtividadeDiscord: async () => {},

  forcarPararTransmissao: depois(({ sala, identidadeAlvo } = {}) => pedirModeracao(sala, 'parar-transmissao', identidadeAlvo)),
  forcarMutarMicrofone: depois(({ sala, identidadeAlvo } = {}) => pedirModeracao(sala, 'mutar-microfone', identidadeAlvo)),
  forcarTirarDaChamada: depois(({ sala, identidadeAlvo } = {}) => pedirModeracao(sala, 'tirar-da-chamada', identidadeAlvo)),

  // Janela flutuante não existe no celular.
  flutuanteLer: async () => ({ ativa: false, atalho: '', atalhoFunciona: false, opacidade: 1, clique: false, chat: false, avisos: false }),
  flutuanteDefinir: async () => ({ ok: false }),
  flutuanteEstado: async () => {},
  aoComandoFlutuante: () => {},
  aoFlutuanteMudou: () => {},

  // Só no celular: entrou/saiu da chamada (liga/desliga o aviso "Na chamada" do Android).
  vozMudou,

  // Só no celular: notificações (Configurações > Sons do app > Notificações no celular).
  notificacoesCelular: {
    ler: async () => ({ ...prefsNotif(), disponivel: PUSH_ATIVO, permissao: notif.permissao, registrado: Boolean(notif.token), erro: notif.erro }),
    definir: async (novas) => {
      const atual = prefsNotif();
      const p = { dm: novas && typeof novas.dm === 'boolean' ? novas.dm : atual.dm, mencoes: novas && typeof novas.mencoes === 'boolean' ? novas.mencoes : atual.mencoes, canais: novas && typeof novas.canais === 'boolean' ? novas.canais : atual.canais };
      try { localStorage.setItem(CHAVE_PREFS_NOTIF, JSON.stringify(p)); } catch (e) {}
      if (notif.token) await enviarAparelho(); else await ligarNotificacoes();
      return { ok: !notif.erro, erro: notif.erro };
    },
    pedirPermissao: async () => { await ligarNotificacoes({ perguntar: true }); return { permissao: notif.permissao }; },
    // A tela chama quando terminou de abrir: se o app foi aberto tocando numa notificação, abre a conversa.
    pegarPendente: () => { const p = notif.pendente; notif.pendente = null; return p; }
  }
};

iniciarTelaCelular({ App });

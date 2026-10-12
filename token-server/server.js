'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const INVITE_KEY = process.env.INVITE_KEY;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

// Login com Discord (Developer Portal > seu app > OAuth2). Sem isso, só funciona "entrar sem Discord".
const DISCORD_CLIENT_ID = (process.env.DISCORD_CLIENT_ID || '').trim();
const DISCORD_CLIENT_SECRET = (process.env.DISCORD_CLIENT_SECRET || '').trim();
// Endereços de retorno aceitos depois do login (separados por vírgula). Têm que ser
// exatamente os mesmos cadastrados no Discord e usados pelo app.
const DISCORD_REDIRECTS = (process.env.DISCORD_REDIRECT_URI || 'http://127.0.0.1:53134/callback')
  .split(',').map((s) => s.trim()).filter(Boolean);
// Transição: enquanto ainda houver app antigo (sem login), "0" aceita a identidade que o
// próprio app informa. Depois que todo mundo atualizar, coloque EXIGIR_LOGIN=1 no server.env.
const EXIGIR_LOGIN = process.env.EXIGIR_LOGIN === '1';
// Acesso restrito (ligado por padrão): só usa o Estrivisor quem o administrador liberou.
// ACESSO_RESTRITO=0 desliga (qualquer pessoa com o app consegue entrar).
const ACESSO_RESTRITO = process.env.ACESSO_RESTRITO !== '0';
// IDs do Discord dos administradores (separados por vírgula). Eles liberam e bloqueiam pessoas pelo app.
// Versão dos termos de uso que o app mostra. Se você mudar os termos, aumente este número: todo mundo aceita de novo.
const VERSAO_TERMOS = 1;
// EXIGIR_ACEITE=1: quem não aceitou os termos não consegue usar o servidor (ligue depois que todos atualizarem o app).
const EXIGIR_ACEITE = process.env.EXIGIR_ACEITE === '1';
const ADMINS = (process.env.ADMIN_DISCORD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean)
  .map((id) => (/^\d+$/.test(id) ? `discord:${id}` : id));

if (!API_KEY || !API_SECRET || !INVITE_KEY || !LIVEKIT_URL) {
  console.error(
    'ERRO: defina LIVEKIT_API_KEY, LIVEKIT_API_SECRET, INVITE_KEY e ' +
    'LIVEKIT_URL no server.env antes de subir este serviço.'
  );
  process.exit(1);
}
if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
  console.warn('[aviso] DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET não definidos: o login com Discord fica desligado.');
}

// A API de administração (listar participantes, mutar, remover) usa HTTP(S), não WS(S).
const HOST_ADMIN = LIVEKIT_URL.replace(/^ws/, 'http');
let roomService = new RoomServiceClient(HOST_ADMIN, API_KEY, API_SECRET);
let buscarNoDiscord = (...args) => fetch(...args); // trocável nos testes

const { criarRepositorio, ErroRegra, limparTexto, limparAvatar, interpretarSala, salaDoCanal } = require('./servidores');
const { criarSessoes } = require('./sessoes');
const { contaDoCodigo, ErroDiscord } = require('./discord');
const { criarConversas, ErroConversa } = require('./conversas');
const { criarAmigos, ErroAmigos } = require('./amigos');
const { criarAcesso } = require('./acesso');
const { criarModeracao, ErroModeracao } = require('./moderacao');
const { criarChaves, ErroChave } = require('./chaves');

const ARQUIVO_DADOS = process.env.DATA_FILE || '/data/servidores.json';
const repo = criarRepositorio({ arquivo: ARQUIVO_DADOS });
const sessoes = criarSessoes({ arquivo: process.env.SESSOES_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'sessoes.json') });
const conversas = criarConversas({ arquivo: process.env.CONVERSAS_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'conversas.json') });
const acesso = criarAcesso({
  arquivo: process.env.ACESSO_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'acesso.json'),
  restrito: ACESSO_RESTRITO,
  admins: ADMINS,
});
const moderacao = criarModeracao({
  arquivoDenuncias: process.env.DENUNCIAS_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'denuncias.json'),
  arquivoAuditoria: process.env.AUDITORIA_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'auditoria.json'),
});
const amigos = criarAmigos({ arquivo: process.env.AMIGOS_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'amigos.json') });
const chaves = criarChaves({ arquivo: process.env.CHAVES_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'chaves.json') });

if (ACESSO_RESTRITO && acesso.semear([...sessoes.todos(), ...repo.todosUsuarios(), ...amigos.todos()])) {
  console.log('[acesso] primeira vez com acesso restrito: quem já usava o Estrivisor foi liberado. Veja com: node autorizar.js listar');
}
if (ACESSO_RESTRITO && !ADMINS.length) {
  console.warn('[aviso] ADMIN_DISCORD_IDS não definido: ninguém consegue liberar pessoas pelo app (use autorizar.js).');
}

const app = express();
// Os ícones dos servidores viajam em base64 (até ~40 mil caracteres), então o limite sobe um pouco.
app.use(express.json({ limit: '200kb' }));

function chaveValida(req) {
  return req.get('x-invite-key') === INVITE_KEY;
}

// ============================================================
// Quem está pedindo
// ============================================================
// Com login, a identidade vem da SESSÃO (cabeçalho Authorization) — o app não consegue
// mais simplesmente dizer quem é. Sem sessão, só no modo de transição, vale o que o app
// antigo informa (cabeçalho x-usuario, ou o campo que ele usava em cada pedido).
function erroLogin(mensagem) {
  const erro = new ErroRegra(401, mensagem);
  erro.codigo = 'login'; // o app entende isso como "mostrar a tela de login"
  return erro;
}

function chaveDeSessao(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
  return m ? m[1] : null;
}

const quando = (ts) => new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

// Texto que a pessoa vê quando o acesso dela está bloqueado.
function mensagemDaSituacao(sit) {
  const p = sit.punicao;
  if (sit.estado === 'banido') {
    return `Seu acesso ao Estrivisor foi bloqueado.${p && p.motivo ? ' Motivo: ' + p.motivo + '.' : ''} Se acha que foi engano, escreva para estrivisor@gmail.com.`;
  }
  if (sit.estado === 'suspenso') {
    return `Seu acesso ao Estrivisor está suspenso até ${quando(p.ate)}.${p.motivo ? ' Motivo: ' + p.motivo + '.' : ''}`;
  }
  return 'O seu acesso ao Estrivisor não foi liberado (ou foi removido). Fale com o dono do Estrivisor.';
}

function exigirAcesso(usuario) {
  const sit = acesso.situacao(usuario);
  if (sit.estado !== 'ok') throw erroLogin(mensagemDaSituacao(sit));
}

function exigirAceite(usuario) {
  if (EXIGIR_ACEITE && !acesso.aceitou(usuario, VERSAO_TERMOS)) {
    const erro = new ErroRegra(403, 'Aceite os Termos de uso para continuar.');
    erro.codigo = 'aceite';
    throw erro;
  }
}

function identidadeDe(req, usuarioLegado, { semAceite = false } = {}) {
  const chave = chaveDeSessao(req);
  if (chave) {
    const sessao = sessoes.validar(chave);
    if (!sessao) throw erroLogin('Sua sessão expirou. Entre de novo.');
    exigirAcesso(sessao.usuario);
    if (!semAceite) exigirAceite(sessao.usuario);
    return { usuario: sessao.usuario, sessao };
  }
  if (EXIGIR_LOGIN) throw erroLogin('Atualize o Estrivisor e entre com a sua conta.');
  const usuario = usuarioLegado !== undefined ? usuarioLegado : req.get('x-usuario');
  if (!usuario || typeof usuario !== 'string') throw erroLogin('Entre com a sua conta pra continuar.');
  exigirAcesso(usuario);
  return { usuario, sessao: null };
}

function responderErro(res, err) {
  if (err instanceof ErroRegra || err instanceof ErroConversa || err instanceof ErroAmigos || err instanceof ErroModeracao || err instanceof ErroChave) {
    return res.status(err.status).json({ erro: err.message, codigo: err.codigo });
  }
  console.error('Erro interno:', err);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
}

// Embrulha uma rota: exige a chave do app, descobre quem pediu e trata os erros.
// "legado" diz de onde o app antigo mandava a identidade naquele pedido.
function rota(fn, { legado, semAceite = false } = {}) {
  return async (req, res) => {
    if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
    try {
      const { usuario, sessao } = identidadeDe(req, legado ? legado(req) : undefined, { semAceite });
      acesso.marcarVisto(usuario);
      if (sessao) amigos.registrar(usuario, sessao.perfil); // mantém nome e foto no diretório de amigos
      await fn(req, res, usuario, sessao);
    } catch (err) {
      responderErro(res, err);
    }
  };
}

// Pra o túnel e pra você conferirem que o serviço está no ar (não revela nada).
app.get('/saude', (req, res) => res.json({ ok: true }));

// ============================================================
// Login
// ============================================================
// Freios contra enxurrada de logins: um limite por IP (quem abusa só trava a si mesmo),
// um por conta, e um teto geral bem mais alto que o antigo (30/min travava todo mundo junto).
const JANELA_LOGIN_MS = 60 * 1000;
const LIMITE_LOGIN_IP = 12;      // por minuto, por IP
const LIMITE_LOGIN_CONTA = 10;   // por minuto, por conta
const LIMITE_LOGIN_GERAL = 150;  // por minuto, no servidor todo
const contadoresLogin = new Map();
function contar(chave, limite) {
  const t = Date.now();
  let c = contadoresLogin.get(chave);
  if (!c || t - c.inicio > JANELA_LOGIN_MS) { c = { inicio: t, n: 0 }; contadoresLogin.set(chave, c); }
  c.n++;
  return c.n <= limite;
}
setInterval(() => {
  const t = Date.now();
  for (const [k, c] of contadoresLogin) if (t - c.inicio > JANELA_LOGIN_MS) contadoresLogin.delete(k);
}, JANELA_LOGIN_MS).unref();
// O servidor só é alcançável pelo túnel da Cloudflare (que informa o IP real) ou pelo próprio notebook.
function ipDe(req) {
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  if (/^[0-9a-fA-F:.]{3,45}$/.test(cf)) return cf;
  return String((req.socket && req.socket.remoteAddress) || 'desconhecido');
}
function loginLiberado(req) {
  // O IP é contado primeiro: quem abusa não gasta o teto geral dos outros.
  return contar('ip:' + ipDe(req), LIMITE_LOGIN_IP) && contar('geral', LIMITE_LOGIN_GERAL);
}
const contaLiberada = (usuario) => contar('conta:' + usuario, LIMITE_LOGIN_CONTA);

const contaPublica = (usuario, tipo, perfil) => ({ usuario, tipo, nome: perfil.nome, avatar: perfil.avatar || null });

app.post('/auth/discord', async (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
  if (!loginLiberado(req)) return res.status(429).json({ erro: 'Muitos logins seguidos. Espere um minuto.' });
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(503).json({ erro: 'O login com Discord ainda não foi configurado no servidor.' });
  }
  const { codigo, redirectUri } = req.body || {};
  if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(codigo)) {
    return res.status(400).json({ erro: 'Código de login inválido.' });
  }
  if (!DISCORD_REDIRECTS.includes(redirectUri)) {
    return res.status(400).json({ erro: 'Endereço de retorno do login não autorizado no servidor.' });
  }
  try {
    const perfil = await contaDoCodigo({
      codigo, redirectUri, clientId: DISCORD_CLIENT_ID, clientSecret: DISCORD_CLIENT_SECRET, buscar: buscarNoDiscord,
    });
    const usuario = `discord:${perfil.id}`;
    if (!contaLiberada(usuario)) return res.status(429).json({ erro: 'Muitos logins seguidos nessa conta. Espere um minuto.' });
    const sit = acesso.situacao(usuario);
    if (sit.estado === 'banido' || sit.estado === 'suspenso') {
      return res.status(403).json({ erro: mensagemDaSituacao(sit), codigo: 'punido' });
    }
    if (sit.estado !== 'ok') {
      acesso.registrarPedido(usuario, perfil);
      return res.status(403).json({ erro: 'Seu acesso ainda não foi liberado. O pedido foi enviado ao dono do Estrivisor: avise ele para liberar você e depois entre de novo.', codigo: 'sem-acesso' });
    }
    const { chave } = sessoes.criar({ usuario, tipo: 'discord', perfil });
    res.json({ sessao: chave, conta: contaPublica(usuario, 'discord', perfil) });
  } catch (err) {
    if (err instanceof ErroDiscord) return res.status(401).json({ erro: err.message });
    responderErro(res, err);
  }
});

// "Entrar sem Discord": o servidor cria um código aleatório pra pessoa (ninguém escolhe o próprio).
app.post('/auth/local', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
  if (!loginLiberado(req)) return res.status(429).json({ erro: 'Muitos logins seguidos. Espere um minuto.' });
  if (ACESSO_RESTRITO) return res.status(403).json({ erro: 'Entrar sem Discord está desativado. Use o login com o Discord.', codigo: 'sem-acesso' });
  const nome = limparTexto((req.body || {}).nome, 40);
  if (!nome) return res.status(400).json({ erro: 'Digite um nome.' });
  const usuario = 'local:' + crypto.randomUUID();
  const perfil = { nome, avatar: null };
  const { chave } = sessoes.criar({ usuario, tipo: 'local', perfil });
  res.json({ sessao: chave, conta: contaPublica(usuario, 'local', perfil) });
});

app.get('/auth/eu', rota((req, res, usuario, sessao) => {
  if (!sessao) throw erroLogin('Entre com a sua conta.');
  res.json({ conta: contaPublica(usuario, sessao.tipo, sessao.perfil) });
}, { semAceite: true }));

app.post('/auth/sair', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
  const chave = chaveDeSessao(req);
  if (chave) sessoes.revogar(chave);
  res.json({ ok: true });
});

// ============================================================
// Tokens do LiveKit (entrar nos canais)
// ============================================================
// O token só serve pra ENTRAR na sala: quem já está dentro continua conectado (o LiveKit
// renova sozinho). Prazo curto = quem foi expulso não consegue reaproveitar um token velho.
const VALIDADE_TOKEN_LIVEKIT = '15m';

async function criarToken(usuario, sala, nome, avatar) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: usuario,
    name: nome || usuario,
    ttl: VALIDADE_TOKEN_LIVEKIT,
    // O avatar viaja como "metadata" do participante: todo mundo na sala recebe.
    metadata: avatar ? JSON.stringify({ avatar }) : undefined,
  });
  at.addGrant({ roomJoin: true, room: sala, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

async function donoEstaNaSala(sala, dono) {
  try {
    const participantes = await roomService.listParticipants(sala);
    return participantes.some((p) => p.identity === dono);
  } catch (e) {
    return false; // sala vazia ou LiveKit fora do ar: entra direto
  }
}

// Pedidos de entrada esperando o dono decidir (canais com aprovação).
const pendentesPorSala = new Map(); // sala -> Map(solicitacaoId -> pedido)

// Pedidos esquecidos (ninguém decidiu em 2 minutos) viram "negado"; depois de 5 minutos são apagados.
setInterval(() => {
  const agora = Date.now();
  for (const [sala, pendentes] of pendentesPorSala) {
    for (const [id, pedido] of pendentes) {
      const idade = agora - pedido.criadoEm;
      if (pedido.status === 'pendente' && idade > 120000) pedido.status = 'negado';
      if (idade > 300000) pendentes.delete(id);
    }
    if (pendentes.size === 0) pendentesPorSala.delete(sala);
  }
}, 15000).unref();

app.post('/token', rota(async (req, res, usuario, sessao) => {
  const { sala, nome, avatar } = req.body || {};
  // Só salas de servidor ("sXXXXXXXXXX__canal"). As salas avulsas da versão antiga foram desligadas.
  if (typeof sala !== 'string' || !interpretarSala(sala)) throw new ErroRegra(400, 'Sala inválida.');
  const { servidor, canal } = repo.verificarAcessoSala(sala, usuario); // só membros

  // O nome pode ser o apelido escolhido no app; o avatar vem da conta (com login).
  const nomeExibicao = limparTexto(nome, 40) || (sessao && sessao.perfil.nome) || usuario;
  const avatarSeguro = sessao ? (sessao.perfil.avatar || '') : limparAvatar(avatar);

  // A aprovação só vale se o canal pedir E o dono estiver lá dentro (senão ninguém esperaria à toa).
  const precisaAprovacao = canal.tipo === 'voz' && canal.aprovacao && servidor.dono !== usuario && await donoEstaNaSala(sala, servidor.dono);
  if (!precisaAprovacao) {
    // A url vai junto: o app usa o LiveKit que o servidor indicar (assim dá pra trocar de VPS
    // pro notebook só mexendo no server.env, sem lançar versão nova do app).
    return res.json({ token: await criarToken(usuario, sala, nomeExibicao, avatarSeguro), url: LIVEKIT_URL });
  }

  if (!pendentesPorSala.has(sala)) pendentesPorSala.set(sala, new Map());
  const solicitacaoId = crypto.randomBytes(16).toString('hex');
  pendentesPorSala.get(sala).set(solicitacaoId, {
    usuario, nome: nomeExibicao, avatar: avatarSeguro, status: 'pendente', token: null, criadoEm: Date.now(),
  });
  res.json({ aguardando: true, solicitacaoId });
}, { legado: (req) => (req.body || {}).usuario }));

// Quem está esperando consulta aqui se já foi decidido (com login, só o próprio pedido).
app.get('/token/status/:solicitacaoId', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
  let usuario = null; // null = app antigo no modo de transição (sem conferência, como antes)
  if (chaveDeSessao(req) || EXIGIR_LOGIN) {
    try { usuario = identidadeDe(req).usuario; } catch (err) { return responderErro(res, err); }
  }
  for (const pendentes of pendentesPorSala.values()) {
    const pedido = pendentes.get(req.params.solicitacaoId);
    if (pedido && (usuario === null || pedido.usuario === usuario)) {
      return res.json({ status: pedido.status, token: pedido.token || undefined, url: pedido.token ? LIVEKIT_URL : undefined });
    }
  }
  res.status(404).json({ erro: 'Pedido não encontrado.' });
});

// O dono do servidor consulta quem está esperando pra entrar...
app.get('/rooms/:sala/pendentes', rota((req, res, usuario) => {
  if (repo.donoDaSala(req.params.sala) !== usuario) throw new ErroRegra(403, 'Só o dono do servidor pode ver os pedidos.');
  const pendentes = pendentesPorSala.get(req.params.sala);
  const pedidos = pendentes
    ? [...pendentes.entries()]
        .filter(([, p]) => p.status === 'pendente')
        .map(([solicitacaoId, p]) => ({ solicitacaoId, usuario: p.usuario, nome: p.nome || p.usuario }))
    : [];
  res.json({ pedidos });
}));

// ...e aceita ou recusa um pedido.
app.post('/rooms/:sala/decidir', rota(async (req, res, usuario) => {
  const sala = req.params.sala;
  if (repo.donoDaSala(sala) !== usuario) throw new ErroRegra(403, 'Só o dono do servidor pode decidir.');
  const { solicitacaoId, decisao } = req.body || {};
  const pendentes = pendentesPorSala.get(sala);
  const pedido = pendentes && pendentes.get(solicitacaoId);
  if (!pedido) throw new ErroRegra(404, 'Pedido não encontrado (pode ter expirado).');
  if (decisao === 'aprovado') {
    try {
      pedido.token = await criarToken(pedido.usuario, sala, pedido.nome, pedido.avatar);
      pedido.status = 'aprovado';
    } catch (err) {
      console.error('Erro ao gerar token de aprovação:', err);
      pedido.status = 'negado';
      throw new ErroRegra(500, 'Falha ao gerar token de aprovação.');
    }
  } else {
    pedido.status = 'negado';
  }
  res.json({ ok: true });
}));

// ============================================================
// Moderação (só o dono do servidor)
// ============================================================
// Tipos de faixa do LiveKit. Dependendo da versão do SDK, o servidor devolve o tipo como
// NÚMERO (2, 3...) ou como TEXTO ("MICROPHONE"...). Aceitamos os dois jeitos.
const FAIXA = {
  MICROFONE: { numero: 2, nome: 'MICROPHONE' },
  TELA: { numero: 3, nome: 'SCREEN_SHARE' },
  AUDIO_DA_TELA: { numero: 4, nome: 'SCREEN_SHARE_AUDIO' },
};
function faixaEhDe(faixa, ...tipos) {
  return tipos.some((t) => faixa.source === t.numero || String(faixa.source).toUpperCase() === t.nome);
}

// Muta (à força, pelo servidor) as faixas de um tipo de outra pessoa.
async function mutarFaixasDe(req, res, usuario, tipos, mensagemErro) {
  const sala = req.params.sala;
  if (repo.donoDaSala(sala) !== usuario) throw new ErroRegra(403, 'Só o dono do servidor pode fazer isso.');
  const { identidadeAlvo } = req.body || {};
  if (!identidadeAlvo || typeof identidadeAlvo !== 'string') throw new ErroRegra(400, 'identidadeAlvo é obrigatório.');
  try {
    const participante = await roomService.getParticipant(sala, identidadeAlvo);
    const faixas = (participante.tracks || []).filter((t) => faixaEhDe(t, ...tipos));
    for (const faixa of faixas) {
      await roomService.mutePublishedTrack(sala, identidadeAlvo, faixa.sid, true);
    }
    res.json({ ok: true, faixasPausadas: faixas.length });
  } catch (err) {
    console.error(mensagemErro, err);
    throw new ErroRegra(500, mensagemErro);
  }
}

const quemMandouLegado = { legado: (req) => (req.body || {}).usuarioQueMandou };

// Parar a transmissão de tela de outra pessoa (vídeo e o áudio que vem junto).
app.post('/rooms/:sala/parar-transmissao', rota((req, res, usuario) =>
  mutarFaixasDe(req, res, usuario, [FAIXA.TELA, FAIXA.AUDIO_DA_TELA], 'Falha ao forçar parar a transmissão.'), quemMandouLegado));

// Mutar o microfone de outra pessoa (pra todos na sala).
app.post('/rooms/:sala/mutar-microfone', rota((req, res, usuario) =>
  mutarFaixasDe(req, res, usuario, [FAIXA.MICROFONE], 'Falha ao mutar o microfone.'), quemMandouLegado));

// ============================================================
// Servidores (cada pessoa pode ter 1; salas "sXXXXXXXXXX__canal")
// ============================================================
// Tira pessoas (ou todo mundo, se usuario for null) das salas de voz no LiveKit.
async function desconectar(salas, usuario) {
  for (const sala of salas) {
    try {
      if (usuario) await roomService.removeParticipant(sala, usuario);
      else await roomService.deleteRoom(sala);
    } catch (e) { /* sala vazia ou pessoa não estava nela */ }
  }
}

app.get('/servidores', rota((req, res, usuario) => res.json({ servidores: repo.listarMeus(usuario) })));

app.post('/servidores', rota((req, res, usuario) => {
  const { nome, icone, cor, nomeUsuario } = req.body || {};
  res.status(201).json({ servidor: repo.criarServidor({ usuario, nomeUsuario, nome, icone, cor }) });
}));

app.get('/servidores/:id', rota((req, res, usuario) => res.json({ servidor: repo.obter(req.params.id, usuario) })));

app.patch('/servidores/:id', rota((req, res, usuario) => {
  const { nome, icone, cor } = req.body || {};
  res.json({ servidor: repo.atualizarServidor(req.params.id, usuario, { nome, icone, cor }) });
}));

app.delete('/servidores/:id', rota(async (req, res, usuario) => {
  const { salas } = repo.apagarServidor(req.params.id, usuario);
  presenca.delete(req.params.id);
  conversas.apagarPrefixo(`c:${req.params.id}:`);
  await desconectar(salas, null);
  res.json({ ok: true });
}));

app.post('/servidores/:id/sair', rota(async (req, res, usuario) => {
  const { salas } = repo.sair(req.params.id, usuario);
  tirarPresenca(req.params.id, usuario);
  await desconectar(salas, usuario);
  res.json({ ok: true });
}));

app.post('/servidores/:id/expulsar', rota(async (req, res, usuario) => {
  const { alvo } = req.body || {};
  const { salas } = repo.expulsar(req.params.id, usuario, alvo);
  tirarPresenca(req.params.id, alvo);
  await desconectar(salas, alvo);
  res.json({ ok: true });
}));

app.post('/servidores/:id/transferir', rota((req, res, usuario) => {
  const { novoDono } = req.body || {};
  res.json({ servidor: repo.transferir(req.params.id, usuario, novoDono) });
}));

// ---- Canais ----
app.post('/servidores/:id/canais', rota((req, res, usuario) => {
  const { tipo, nome, aprovacao } = req.body || {};
  res.status(201).json({ canal: repo.criarCanal(req.params.id, usuario, { tipo, nome, aprovacao }) });
}));

app.patch('/servidores/:id/canais/:canalId', rota((req, res, usuario) => {
  const { nome, aprovacao } = req.body || {};
  res.json({ canal: repo.editarCanal(req.params.id, usuario, req.params.canalId, { nome, aprovacao }) });
}));

app.delete('/servidores/:id/canais/:canalId', rota(async (req, res, usuario) => {
  const { sala } = repo.apagarCanal(req.params.id, usuario, req.params.canalId);
  conversas.apagarConversa(chaveCanal(req.params.id, req.params.canalId));
  await desconectar([sala], null);
  res.json({ ok: true });
}));

// ---- Convites ----
app.post('/servidores/:id/convites', rota((req, res, usuario) =>
  res.status(201).json({ convite: repo.criarConvite(req.params.id, usuario) })));

app.get('/servidores/:id/convites', rota((req, res, usuario) =>
  res.json({ convites: repo.listarConvites(req.params.id, usuario) })));

app.delete('/servidores/:id/convites/:codigo', rota((req, res, usuario) => {
  repo.revogarConvite(req.params.id, usuario, req.params.codigo);
  res.json({ ok: true });
}));

// Freio contra tentativa de adivinhar códigos: 10 erros por pessoa a cada 15 minutos.
const errosConvite = new Map(); // usuario -> { n, desde }
function conviteBloqueado(usuario) {
  const e = errosConvite.get(usuario);
  if (!e) return false;
  if (Date.now() - e.desde > 15 * 60 * 1000) { errosConvite.delete(usuario); return false; }
  return e.n >= 10;
}
function registrarErroConvite(usuario) {
  const e = errosConvite.get(usuario);
  if (!e || Date.now() - e.desde > 15 * 60 * 1000) errosConvite.set(usuario, { n: 1, desde: Date.now() });
  else e.n++;
}

app.post('/convites/usar', rota((req, res, usuario) => {
  if (conviteBloqueado(usuario)) {
    return res.status(429).json({ erro: 'Muitas tentativas erradas. Tente de novo em alguns minutos.' });
  }
  const { codigo, nomeUsuario } = req.body || {};
  try {
    res.json({ servidor: repo.usarConvite({ usuario, nomeUsuario, codigo }) });
  } catch (err) {
    if (err instanceof ErroRegra && err.status === 404) registrarErroConvite(usuario);
    throw err;
  }
}));

// ---- Presença ----
// Cada app avisa a cada ~10s que está aberto; quem fica 60s sem avisar some da lista.
const TTL_PRESENCA_MS = 60 * 1000;
const presenca = new Map(); // servidorId -> Map(usuario -> { nome, avatar, canalVoz, ultimo })
const visto = new Map();    // usuario -> última vez que o app dele avisou que está aberto (em qualquer servidor)
const online = (usuario) => (visto.get(usuario) || 0) > Date.now() - TTL_PRESENCA_MS;
function emVoz(usuario) {
  for (const mapa of presenca.values()) {
    const p = mapa.get(usuario);
    if (p && p.canalVoz && p.ultimo > Date.now() - TTL_PRESENCA_MS) return true;
  }
  return false;
}

function tirarPresencaDeTodos(usuario) {
  for (const mapa of presenca.values()) mapa.delete(usuario);
  visto.delete(usuario);
}

function tirarPresenca(servidorId, usuario) {
  const mapa = presenca.get(servidorId);
  if (mapa) mapa.delete(usuario);
}

function listarOnline(servidorId) {
  const mapa = presenca.get(servidorId);
  if (!mapa) return [];
  const limite = Date.now() - TTL_PRESENCA_MS;
  const online = [];
  for (const [usuario, p] of mapa) {
    if (p.ultimo < limite) { mapa.delete(usuario); continue; }
    online.push({ usuario, nome: p.nome, avatar: p.avatar, canalVoz: p.canalVoz });
  }
  return online;
}

app.post('/servidores/:id/presenca', rota((req, res, usuario, sessao) => {
  const servidor = repo.obter(req.params.id, usuario); // 403 se não for membro
  const { nome, avatar, canalVoz } = req.body || {};
  const canalOk = typeof canalVoz === 'string' && servidor.canais.some((c) => c.id === canalVoz && c.tipo === 'voz') ? canalVoz : null;
  if (!presenca.has(servidor.id)) presenca.set(servidor.id, new Map());
  presenca.get(servidor.id).set(usuario, {
    nome: limparTexto(nome, 40) || (sessao && sessao.perfil.nome) || usuario,
    avatar: sessao ? (sessao.perfil.avatar || '') : limparAvatar(avatar),
    canalVoz: canalOk,
    ultimo: Date.now(),
  });
  visto.set(usuario, Date.now());
  // Último número de mensagem de cada canal de texto: o app compara com o que já leu (não lidas).
  const ultimas = {};
  servidor.canais.filter((c) => c.tipo === 'texto').forEach((c) => { ultimas[c.id] = conversas.ultimaSeq(chaveCanal(servidor.id, c.id)); });
  // A resposta já traz a versão do servidor: se mudou (canal novo, nome...), o app recarrega.
  res.json({ versao: servidor.versao, online: listarOnline(servidor.id), ultimas });
}));

app.post('/servidores/:id/presenca/sair', rota((req, res, usuario) => {
  repo.obter(req.params.id, usuario);
  tirarPresenca(req.params.id, usuario);
  res.json({ ok: true });
}));


// ============================================================
// Mensagens de texto (canais) e conversas privadas
// ============================================================
const chaveCanal = (servidorId, canalId) => `c:${servidorId}:${canalId}`;
const chaveDm = (a, b) => 'd:' + (a < b ? `${a}|${b}` : `${b}|${a}`);

// Freio: no máximo 8 mensagens a cada 10 segundos por pessoa.
const envios = new Map(); // usuario -> [horários]
function exigirRitmo(usuario) {
  const t = Date.now();
  const recentes = (envios.get(usuario) || []).filter((x) => t - x < 10000);
  if (recentes.length >= 8) throw new ErroRegra(429, 'Calma! Você está enviando mensagens rápido demais.');
  recentes.push(t);
  envios.set(usuario, recentes);
}
setInterval(() => { const t = Date.now(); for (const [u, l] of envios) if (!l.some((x) => t - x < 10000)) envios.delete(u); }, 60000).unref();

const inteiro = (v) => (v !== undefined && v !== '' && Number.isInteger(Number(v)) ? Number(v) : undefined);
function mensagemPublica(m) {
  return { seq: m.seq, usuario: m.usuario, nome: m.nome, avatar: m.avatar, texto: m.texto, ts: m.ts, editadoEm: m.editadoEm };
}
function exigirCanalTexto(servidorId, canalId, usuario) {
  const servidor = repo.obter(servidorId, usuario); // 403 se não for membro
  const canal = servidor.canais.find((c) => c.id === canalId && c.tipo === 'texto');
  if (!canal) throw new ErroRegra(404, 'Canal de texto não encontrado.');
  return servidor;
}
function exigirSessao(sessao) {
  if (!sessao) throw erroLogin('Entre com a sua conta pra usar isto.');
}
function exigirAmigo(usuario, outro) {
  if (!amigos.saoAmigos(usuario, outro)) throw new ErroRegra(403, 'Vocês não são amigos.');
}
function nomeDoAutor(req, sessao, usuario) {
  // Com login, o nome vem sempre da conta (o app não pode mandar outro nome e se passar por alguém).
  if (sessao && sessao.perfil && sessao.perfil.nome) return sessao.perfil.nome;
  return limparTexto((req.body || {}).nome, 40) || usuario;
}
function listarMensagens(chave, req) {
  const r = conversas.listar(chave, { depois: inteiro(req.query.depois), antes: inteiro(req.query.antes), limite: inteiro(req.query.limite) });
  return { mensagens: r.mensagens.map(mensagemPublica), ultimaSeq: r.ultimaSeq, temMais: r.temMais };
}

app.get('/servidores/:id/canais/:canalId/mensagens', rota((req, res, usuario) => {
  exigirCanalTexto(req.params.id, req.params.canalId, usuario);
  res.json(listarMensagens(chaveCanal(req.params.id, req.params.canalId), req));
}));

app.post('/servidores/:id/canais/:canalId/mensagens', rota((req, res, usuario, sessao) => {
  exigirCanalTexto(req.params.id, req.params.canalId, usuario);
  exigirRitmo(usuario);
  const msg = conversas.enviar(chaveCanal(req.params.id, req.params.canalId), {
    usuario, nome: nomeDoAutor(req, sessao, usuario), avatar: sessao ? (sessao.perfil.avatar || '') : '', texto: (req.body || {}).texto,
  });
  res.status(201).json({ mensagem: mensagemPublica(msg) });
}));

app.patch('/servidores/:id/canais/:canalId/mensagens/:seq', rota((req, res, usuario) => {
  exigirCanalTexto(req.params.id, req.params.canalId, usuario);
  res.json({ mensagem: mensagemPublica(conversas.editar(chaveCanal(req.params.id, req.params.canalId), inteiro(req.params.seq), usuario, (req.body || {}).texto)) });
}));

app.delete('/servidores/:id/canais/:canalId/mensagens/:seq', rota((req, res, usuario) => {
  const servidor = exigirCanalTexto(req.params.id, req.params.canalId, usuario);
  res.json(conversas.apagar(chaveCanal(req.params.id, req.params.canalId), inteiro(req.params.seq), usuario, servidor.souDono));
}));

// ---- Amigos ----
app.get('/amigos', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  visto.set(usuario, Date.now());
  const l = amigos.listar(usuario);
  res.json({
    codigo: amigos.meuCodigo(usuario),
    amigos: l.amigos.map((p) => ({ ...p, online: online(p.usuario), emVoz: online(p.usuario) && emVoz(p.usuario), ultimaDm: conversas.ultimaSeq(chaveDm(usuario, p.usuario)) })),
    recebidos: l.recebidos,
    enviados: l.enviados,
  });
}));

app.post('/amigos/pedir', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  const { codigo, usuario: alvoDireto } = req.body || {};
  let alvo = null;
  if (typeof codigo === 'string' && codigo.trim()) {
    alvo = amigos.porCodigo(codigo);
  } else if (typeof alvoDireto === 'string') {
    // Pelo menu de uma pessoa: só vale pra quem divide um servidor com você.
    const emComum = repo.listarMeus(usuario).some((s) => s.membros.some((m) => m.usuario === alvoDireto));
    if (!emComum) throw new ErroRegra(403, 'Você só pode adicionar quem está num servidor com você.');
    alvo = alvoDireto;
  }
  if (!alvo) throw new ErroRegra(404, 'Não encontrei ninguém com esse código.');
  const resultado = amigos.pedir(usuario, alvo);
  res.json({ resultado, pessoa: amigos.pessoa(alvo) });
}));

app.post('/amigos/aceitar', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  amigos.aceitar(usuario, String((req.body || {}).usuario || ''));
  res.json({ ok: true });
}));

app.post('/amigos/recusar', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  amigos.recusar(usuario, String((req.body || {}).usuario || ''));
  res.json({ ok: true });
}));

app.delete('/amigos/:outro', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  amigos.remover(usuario, req.params.outro);
  res.json({ ok: true });
}));

// ---- Mensagens diretas (só entre amigos) ----
app.get('/dm/:outro/mensagens', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao); exigirAmigo(usuario, req.params.outro);
  res.json(listarMensagens(chaveDm(usuario, req.params.outro), req));
}));

app.post('/dm/:outro/mensagens', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao); exigirAmigo(usuario, req.params.outro);
  exigirRitmo(usuario);
  const msg = conversas.enviar(chaveDm(usuario, req.params.outro), {
    usuario, nome: nomeDoAutor(req, sessao, usuario), avatar: sessao.perfil.avatar || '', texto: (req.body || {}).texto,
  });
  res.status(201).json({ mensagem: mensagemPublica(msg) });
}));

app.patch('/dm/:outro/mensagens/:seq', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao); exigirAmigo(usuario, req.params.outro);
  res.json({ mensagem: mensagemPublica(conversas.editar(chaveDm(usuario, req.params.outro), inteiro(req.params.seq), usuario, (req.body || {}).texto)) });
}));

app.delete('/dm/:outro/mensagens/:seq', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao); exigirAmigo(usuario, req.params.outro);
  res.json(conversas.apagar(chaveDm(usuario, req.params.outro), inteiro(req.params.seq), usuario, false));
}));


// ============================================================
// Termos de uso (aceite) e denúncias — qualquer pessoa liberada
// ============================================================
app.get('/termos', rota((req, res, usuario) => {
  res.json({ versao: VERSAO_TERMOS, aceito: acesso.aceitou(usuario, VERSAO_TERMOS), exigido: EXIGIR_ACEITE });
}, { semAceite: true }));

app.post('/termos/aceitar', rota((req, res, usuario) => {
  const { versao, maior18 } = req.body || {};
  if (maior18 !== true) throw new ErroRegra(400, 'É preciso confirmar que você tem 18 anos ou mais.');
  if (versao !== VERSAO_TERMOS) throw new ErroRegra(409, 'Os termos mudaram. Atualize o Estrivisor para a versão mais nova.');
  acesso.aceitar(usuario, VERSAO_TERMOS);
  res.json({ ok: true });
}, { semAceite: true }));

app.post('/denuncias', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  const b = req.body || {};
  const eu = sessao.perfil.nome || usuario;
  const nomeDe = (u) => (amigos.pessoa(u) || {}).nome || u;
  let alvo; let origem = null; let contexto = [];
  if (b.tipo === 'pessoa') {
    alvo = String(b.alvo || '');
    if (!/^(discord|local):[A-Za-z0-9-]{1,40}$/.test(alvo) || !amigos.existe(alvo)) throw new ErroRegra(404, 'Pessoa não encontrada.');
  } else if (b.tipo === 'mensagem') {
    const seq = inteiro(b.seq);
    if (!seq) throw new ErroRegra(400, 'Mensagem inválida.');
    let chave;
    if (b.origem === 'dm') {
      const outro = String(b.outro || '');
      exigirAmigo(usuario, outro);
      chave = chaveDm(usuario, outro);
      origem = { tipo: 'dm', chave, seq, outro, outroNome: nomeDe(outro) };
    } else {
      const servidor = exigirCanalTexto(String(b.servidorId || ''), String(b.canalId || ''), usuario);
      chave = chaveCanal(servidor.id, b.canalId);
      const canal = servidor.canais.find((c) => c.id === b.canalId);
      origem = { tipo: 'canal', chave, seq, servidorId: servidor.id, servidorNome: servidor.nome, canalId: canal.id, canalNome: canal.nome };
    }
    contexto = conversas.contexto(chave, seq, 5);
    if (!contexto) throw new ErroRegra(404, 'Essa mensagem não existe mais.');
    alvo = contexto.find((m) => m.seq === seq).usuario;
  } else {
    throw new ErroRegra(400, 'Denúncia inválida.');
  }
  if (acesso.ehAdmin(alvo)) throw new ErroRegra(400, 'Esta pessoa é administradora do Estrivisor. Se há um problema, escreva para estrivisor@gmail.com.');
  moderacao.denunciar({
    de: usuario, deNome: eu, alvo, alvoNome: nomeDe(alvo), motivo: b.motivo, detalhe: limparTexto(b.detalhe, 500), origem, contexto,
  });
  res.json({ ok: true });
}));

// ============================================================
// Administração (só administradores)
// ============================================================
function exigirAdmin(usuario) {
  if (!acesso.ehAdmin(usuario)) throw new ErroRegra(403, 'Só o administrador do Estrivisor pode fazer isso.');
}
const nomeConhecido = (u) => (amigos.pessoa(u) || {}).nome || u;
function auditar(usuario, acao, alvo, detalhe) {
  moderacao.registrar({ por: usuario, porNome: nomeConhecido(usuario), acao, alvo: alvo || '', alvoNome: alvo ? nomeConhecido(alvo) : '', detalhe });
}
// Tira a pessoa de tudo que está ligado agora (presença e chamadas de voz).
async function cortarAcesso(usuario) {
  tirarPresencaDeTodos(usuario);
  const salas = repo.servidoresDe(usuario).flatMap((s) => s.canais.map((c) => salaDoCanal(s.id, c.id)));
  await desconectar(salas, usuario);
}
function exigirAlvoPunivel(usuario, alvo) {
  if (!/^(discord|local):[A-Za-z0-9-]{1,40}$/.test(String(alvo || ''))) throw new ErroRegra(400, 'Pessoa inválida.');
  if (acesso.ehAdmin(alvo)) throw new ErroRegra(400, 'Administradores não podem ser punidos.');
  if (alvo === usuario) throw new ErroRegra(400, 'Você não pode fazer isso consigo mesmo.');
}
async function aplicarPunicao(usuario, { alvo, tipo, dias, motivo }) {
  exigirAlvoPunivel(usuario, alvo);
  const texto = limparTexto(motivo, 200);
  if (!texto) throw new ErroRegra(400, 'Escreva o motivo.');
  let ate = null;
  if (tipo === 'suspensao') {
    const d = Number(dias);
    if (!Number.isFinite(d) || d < 1 || d > 365) throw new ErroRegra(400, 'A suspensão deve ser de 1 a 365 dias.');
    ate = Date.now() + Math.round(d) * 24 * 3600 * 1000;
  } else if (tipo !== 'ban') {
    throw new ErroRegra(400, 'Tipo de punição inválido.');
  }
  acesso.punir(alvo, { tipo, ate, motivo: texto, por: usuario, nome: nomeConhecido(alvo) });
  auditar(usuario, tipo === 'ban' ? 'banir' : 'suspender', alvo, `${texto}${ate ? ' (até ' + quando(ate) + ')' : ''}`);
  await cortarAcesso(alvo);
}

app.get('/admin/acesso', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  res.json({ restrito: ACESSO_RESTRITO, ...acesso.listar(), denunciasAbertas: moderacao.abertas() });
}));

app.post('/admin/acesso/autorizar', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  const alvo = String((req.body || {}).usuario || '');
  if (!/^discord:\d{5,25}$/.test(alvo)) throw new ErroRegra(400, 'Pessoa inválida.');
  acesso.autorizar(alvo, usuario);
  auditar(usuario, 'liberar', alvo, '');
  res.json({ ok: true });
}));

app.post('/admin/acesso/negar', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  const alvo = String((req.body || {}).usuario || '');
  acesso.negar(alvo);
  auditar(usuario, 'negar', alvo, '');
  res.json({ ok: true });
}));

app.delete('/admin/acesso/:alvo', rota(async (req, res, usuario) => {
  exigirAdmin(usuario);
  if (acesso.ehAdmin(req.params.alvo)) throw new ErroRegra(400, 'Administradores não podem ser removidos por aqui.');
  acesso.revogar(req.params.alvo);
  auditar(usuario, 'remover-acesso', req.params.alvo, '');
  await cortarAcesso(req.params.alvo);
  res.json({ ok: true });
}));

app.post('/admin/punir', rota(async (req, res, usuario) => {
  exigirAdmin(usuario);
  const b = req.body || {};
  await aplicarPunicao(usuario, { alvo: String(b.usuario || ''), tipo: b.tipo, dias: b.dias, motivo: b.motivo });
  res.json({ ok: true });
}));

app.post('/admin/desfazer-punicao', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  const alvo = String((req.body || {}).usuario || '');
  if (!acesso.desfazerPunicao(alvo)) throw new ErroRegra(404, 'Esta pessoa não está punida.');
  auditar(usuario, 'desfazer-punicao', alvo, '');
  res.json({ ok: true });
}));

app.get('/admin/pessoas', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  const l = acesso.listar();
  const ids = new Set([...ADMINS, ...l.autorizados.map((a) => a.usuario), ...l.punidos.map((p) => p.usuario)]);
  const pessoas = [...ids].map((u) => {
    const dir = amigos.pessoa(u) || {};
    const aut = l.autorizados.find((a) => a.usuario === u) || {};
    const sit = acesso.situacao(u);
    const aceite = acesso.aceiteDe(u);
    return {
      usuario: u, nome: dir.nome || aut.nome || u, avatar: dir.avatar || '', admin: acesso.ehAdmin(u),
      desde: aut.desde || null, ultimaVez: visto.get(u) || acesso.ultimaVez(u), online: online(u),
      servidores: repo.servidoresDe(u).map((s) => s.nome),
      aceite: aceite ? { versao: aceite.versao, ts: aceite.ts } : null,
      estado: sit.estado === 'nao-liberado' ? 'removido' : sit.estado,
      punicao: sit.punicao ? { tipo: sit.punicao.tipo, ate: sit.punicao.ate, motivo: sit.punicao.motivo, ts: sit.punicao.ts } : null,
    };
  }).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  res.json({ versaoTermos: VERSAO_TERMOS, pessoas });
}));

app.get('/admin/servidores', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  res.json({ servidores: repo.listarTodos().map((s) => ({ ...s, donoNome: nomeConhecido(s.dono) || s.donoNome })) });
}));

app.delete('/admin/servidores/:id', rota(async (req, res, usuario) => {
  exigirAdmin(usuario);
  const { salas, nome, dono } = repo.apagarComoAdmin(req.params.id);
  presenca.delete(req.params.id);
  conversas.apagarPrefixo(`c:${req.params.id}:`);
  await desconectar(salas, null);
  auditar(usuario, 'apagar-servidor', dono, `Servidor "${nome}"`);
  res.json({ ok: true });
}));

app.get('/admin/denuncias', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  res.json({ denuncias: moderacao.listarDenuncias() });
}));

app.post('/admin/denuncias/:id/resolver', rota(async (req, res, usuario) => {
  exigirAdmin(usuario);
  const b = req.body || {};
  const d = moderacao.denuncia(req.params.id);
  if (!d) throw new ErroRegra(404, 'Denúncia não encontrada.');
  const acao = String(b.acao || '');
  let nota = '';
  if (acao === 'remover-mensagem') {
    if (!d.origem || !d.origem.chave) throw new ErroRegra(400, 'Esta denúncia não é de uma mensagem.');
    try { conversas.apagar(d.origem.chave, d.origem.seq, usuario, true); } catch (e) { /* já tinha sido apagada */ }
    nota = 'mensagem removida';
  } else if (acao === 'suspender' || acao === 'banir') {
    await aplicarPunicao(usuario, { alvo: d.alvo, tipo: acao === 'banir' ? 'ban' : 'suspensao', dias: b.dias, motivo: b.motivo });
    nota = acao === 'banir' ? 'banido' : `suspenso por ${Number(b.dias)} dia(s)`;
  } else if (acao !== 'ignorar') {
    throw new ErroRegra(400, 'Ação inválida.');
  }
  moderacao.resolverDenuncia(d.id, { acao, por: usuario, nota });
  auditar(usuario, `denuncia-${acao}`, d.alvo, `Denúncia #${d.id} (${d.motivo})`);
  res.json({ ok: true });
}));

// ---- Qualidade da transmissão (chaves) ----
// Todo mundo transmite até 720p30. Uma chave gerada pelo administrador libera um nível maior na conta.
const qualidadeDe = (usuario) => chaves.nivelDe(usuario, acesso.ehAdmin(usuario));

// Freio contra tentativa de adivinhar chaves: 5 erros por pessoa a cada 15 minutos.
const errosChave = new Map(); // usuario -> { n, desde }
function chaveBloqueada(usuario) {
  const e = errosChave.get(usuario);
  if (!e) return false;
  if (Date.now() - e.desde > 15 * 60 * 1000) { errosChave.delete(usuario); return false; }
  return e.n >= 5;
}
function registrarErroChave(usuario) {
  const e = errosChave.get(usuario);
  if (!e || Date.now() - e.desde > 15 * 60 * 1000) errosChave.set(usuario, { n: 1, desde: Date.now() });
  else e.n++;
}

app.get('/qualidade', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  res.json({ qualidade: qualidadeDe(usuario), niveis: chaves.listar().niveis });
}));

app.post('/qualidade/resgatar', rota((req, res, usuario, sessao) => {
  exigirSessao(sessao);
  if (chaveBloqueada(usuario)) {
    return res.status(429).json({ erro: 'Muitas tentativas erradas. Tente de novo em alguns minutos.' });
  }
  const { chave } = req.body || {};
  if (typeof chave !== 'string' || chave.length > 64) throw new ErroChave(404, 'Chave inválida ou já usada.');
  try {
    const r = chaves.resgatar(usuario, chave, acesso.ehAdmin(usuario));
    auditar(usuario, 'ativar-chave', '', `chave ${r.chaveId} → ${r.nivel.nome}`);
    res.json({ qualidade: r.nivel });
  } catch (err) {
    if (err instanceof ErroChave && err.status === 404) registrarErroChave(usuario);
    throw err;
  }
}));

app.get('/admin/chaves', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  const l = chaves.listar();
  res.json({ ...l, concedidos: l.concedidos.map((c) => ({ ...c, nome: nomeConhecido(c.usuario) })),
    chaves: l.chaves.map((c) => ({ ...c, usadaPorNome: c.usadaPor ? nomeConhecido(c.usadaPor) : null })) });
}));

app.post('/admin/chaves', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  const { nivel, validadeDias, quantidade, nota } = req.body || {};
  const criadas = chaves.gerar({ nivel, validadeDias, quantidade, nota, por: usuario });
  auditar(usuario, 'gerar-chaves', '', `${criadas.length}× ${nivel}${validadeDias ? ' · ' + validadeDias + ' dias' : ' · permanente'}${criadas[0].nota ? ' · ' + criadas[0].nota : ''}`);
  res.status(201).json({ chaves: criadas });
}));

app.delete('/admin/chaves/:id', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  chaves.apagar(req.params.id);
  auditar(usuario, 'apagar-chave', '', req.params.id);
  res.json({ ok: true });
}));

app.delete('/admin/qualidade/:alvo', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  if (!chaves.revogar(req.params.alvo)) throw new ErroRegra(404, 'Essa pessoa não tem qualidade liberada por chave.');
  auditar(usuario, 'revogar-qualidade', req.params.alvo, '');
  res.json({ ok: true });
}));

app.get('/admin/historico', rota((req, res, usuario) => {
  exigirAdmin(usuario);
  res.json({ historico: moderacao.historico(200) });
}));

// Limpeza geral de tempos em tempos (servidores sem ninguém avisando).
setInterval(() => {
  for (const id of [...presenca.keys()]) {
    listarOnline(id);
    if (!presenca.get(id).size) presenca.delete(id);
  }
}, 60000).unref();

module.exports = {
  app, repo, sessoes, conversas, amigos, acesso, moderacao, chaves,
  _trocarRoomService: (novo) => { roomService = novo; },
  _trocarBuscaDiscord: (nova) => { buscarNoDiscord = nova; },
};

// Ao desligar (docker stop / reiniciar), grava na hora o que ainda estava esperando pra ir pro disco.
function gravarTudoEsair() {
  try { conversas.gravarAgora(); amigos.gravarAgora(); } catch (e) { console.error(e); }
  process.exit(0);
}

if (require.main === module) {
  process.on('SIGTERM', gravarTudoEsair);
  process.on('SIGINT', gravarTudoEsair);
  app.listen(PORT, () => {
    console.log(`Servidor do Estrivisor ativo na porta ${PORT} (login obrigatório: ${EXIGIR_LOGIN ? 'sim' : 'não, modo de transição'})`);
  });
}

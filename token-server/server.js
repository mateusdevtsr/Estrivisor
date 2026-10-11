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

const { criarRepositorio, ErroRegra, limparTexto, limparAvatar, interpretarSala } = require('./servidores');
const { criarSessoes } = require('./sessoes');
const { contaDoCodigo, ErroDiscord } = require('./discord');

const ARQUIVO_DADOS = process.env.DATA_FILE || '/data/servidores.json';
const repo = criarRepositorio({ arquivo: ARQUIVO_DADOS });
const sessoes = criarSessoes({ arquivo: process.env.SESSOES_FILE || path.join(path.dirname(ARQUIVO_DADOS), 'sessoes.json') });

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

function identidadeDe(req, usuarioLegado) {
  const chave = chaveDeSessao(req);
  if (chave) {
    const sessao = sessoes.validar(chave);
    if (!sessao) throw erroLogin('Sua sessão expirou. Entre de novo.');
    return { usuario: sessao.usuario, sessao };
  }
  if (EXIGIR_LOGIN) throw erroLogin('Atualize o Estrivisor e entre com a sua conta.');
  const usuario = usuarioLegado !== undefined ? usuarioLegado : req.get('x-usuario');
  if (!usuario || typeof usuario !== 'string') throw erroLogin('Entre com a sua conta pra continuar.');
  return { usuario, sessao: null };
}

function responderErro(res, err) {
  if (err instanceof ErroRegra) return res.status(err.status).json({ erro: err.message, codigo: err.codigo });
  console.error('Erro interno:', err);
  return res.status(500).json({ erro: 'Erro interno do servidor.' });
}

// Embrulha uma rota: exige a chave do app, descobre quem pediu e trata os erros.
// "legado" diz de onde o app antigo mandava a identidade naquele pedido.
function rota(fn, { legado } = {}) {
  return async (req, res) => {
    if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
    try {
      const { usuario, sessao } = identidadeDe(req, legado ? legado(req) : undefined);
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
// Freio simples contra enxurrada de logins (ex.: alguém criando contas "sem Discord" em massa).
const limiteLogin = { inicio: 0, n: 0 };
function loginLiberado() {
  const agora = Date.now();
  if (agora - limiteLogin.inicio > 60 * 1000) { limiteLogin.inicio = agora; limiteLogin.n = 0; }
  limiteLogin.n++;
  return limiteLogin.n <= 30;
}

const contaPublica = (usuario, tipo, perfil) => ({ usuario, tipo, nome: perfil.nome, avatar: perfil.avatar || null });

app.post('/auth/discord', async (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
  if (!loginLiberado()) return res.status(429).json({ erro: 'Muitos logins seguidos. Espere um minuto.' });
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
  if (!loginLiberado()) return res.status(429).json({ erro: 'Muitos logins seguidos. Espere um minuto.' });
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
}));

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
  // A resposta já traz a versão do servidor: se mudou (canal novo, nome...), o app recarrega.
  res.json({ versao: servidor.versao, online: listarOnline(servidor.id) });
}));

app.post('/servidores/:id/presenca/sair', rota((req, res, usuario) => {
  repo.obter(req.params.id, usuario);
  tirarPresenca(req.params.id, usuario);
  res.json({ ok: true });
}));

// Limpeza geral de tempos em tempos (servidores sem ninguém avisando).
setInterval(() => {
  for (const id of [...presenca.keys()]) {
    listarOnline(id);
    if (!presenca.get(id).size) presenca.delete(id);
  }
}, 60000).unref();

module.exports = {
  app, repo, sessoes,
  _trocarRoomService: (novo) => { roomService = novo; },
  _trocarBuscaDiscord: (nova) => { buscarNoDiscord = nova; },
};

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor do Estrivisor ativo na porta ${PORT} (login obrigatório: ${EXIGIR_LOGIN ? 'sim' : 'não, modo de transição'})`);
  });
}

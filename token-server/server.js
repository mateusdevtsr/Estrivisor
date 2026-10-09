const express = require('express');
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk');

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const INVITE_KEY = process.env.INVITE_KEY;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

if (!API_KEY || !API_SECRET || !INVITE_KEY || !LIVEKIT_URL) {
  console.error(
    'ERRO: defina LIVEKIT_API_KEY, LIVEKIT_API_SECRET, INVITE_KEY e ' +
    'LIVEKIT_URL no server.env antes de subir este serviço.'
  );
  process.exit(1);
}

// A API de administração (listar salas, forçar parar transmissão) usa
// HTTP(S), não WS(S) — troca o esquema da URL pra montar o endereço certo.
const HOST_ADMIN = LIVEKIT_URL.replace(/^ws/, 'http');
let roomService = new RoomServiceClient(HOST_ADMIN, API_KEY, API_SECRET);

const { criarRepositorio, ErroRegra, limparTexto, limparAvatar: limparAvatarServidor, interpretarSala } = require('./servidores');
const repo = criarRepositorio({ arquivo: process.env.DATA_FILE || '/data/servidores.json' });

const app = express();
// Os ícones dos servidores viajam em base64 (até ~40 mil caracteres), então o limite sobe um pouco.
app.use(express.json({ limit: '200kb' }));

// Estado em memória (some se o servidor reiniciar — aceitável para o
// tamanho deste projeto): quem é o "anfitrião" de cada sala, e os pedidos
// de entrada aguardando decisão dele.
const donosPorSala = new Map();       // sala -> identidade do anfitrião
const pendentesPorSala = new Map();   // sala -> Map(solicitacaoId -> pedido)

function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function chaveValida(req) {
  return req.get('x-invite-key') === INVITE_KEY;
}

// ---------- Perfil: nome de exibição e avatar ----------
// O nome de exibição e o avatar vêm do app de cada pessoa, então são
// validados aqui antes de virarem parte do token que os outros vão ler.
function limparNome(nome) {
  if (typeof nome !== 'string') return '';
  return nome.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
}

// Só aceita imagens do CDN do Discord (evita que alguém coloque um endereço
// qualquer que os outros apps seriam obrigados a abrir).
const REGEX_AVATAR = /^https:\/\/cdn\.discordapp\.com\/[A-Za-z0-9_\-\/\.]+(\?[A-Za-z0-9_=&\-]*)?$/;
function limparAvatar(url) {
  if (typeof url !== 'string' || url.length > 250) return '';
  return REGEX_AVATAR.test(url) ? url : '';
}

async function donoEstaNaSala(sala, dono) {
  try {
    const participantes = await roomService.listParticipants(sala);
    return participantes.some((p) => p.identity === dono);
  } catch (e) {
    return false; // sala não existe ou LiveKit fora do ar: entra direto
  }
}

async function criarToken(usuario, sala, nome, avatar) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: usuario,
    name: nome || usuario,
    ttl: '4h',
    // O avatar viaja como "metadata" do participante: todo mundo na sala
    // recebe, sem precisar de nenhum outro serviço.
    metadata: avatar ? JSON.stringify({ avatar }) : undefined,
  });
  at.addGrant({
    roomJoin: true,
    room: sala,
    canPublish: true,
    canSubscribe: true,
  });
  return at.toJwt();
}

// Em salas de servidor, só o dono (cabeçalho x-usuario) pode ver/decidir pedidos.
// Salas do modo antigo continuam como sempre (sem esta checagem).
function souAnfitriaoDeServidor(req, sala) {
  if (!interpretarSala(sala)) return true;
  const dono = repo.donoDaSala(sala);
  return !!dono && req.get('x-usuario') === dono;
}

// Pedidos esquecidos (ninguém decidiu em 2 minutos) viram "negado". Depois de 5 minutos o
// pedido é apagado de vez — antes eles ficavam na memória pra sempre.
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

// Marca quem é o anfitrião de uma sala — a partir daí, novos pedidos de
// entrada de outras pessoas ficam pendentes até ele decidir.
app.post('/rooms/:sala/tornar-dono', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });

  const { usuario } = req.body || {};
  if (!usuario) return res.status(400).json({ erro: 'usuario é obrigatório.' });
  // Em salas de servidor o anfitrião é sempre o dono do servidor (não dá pra "tomar" a sala).
  if (interpretarSala(req.params.sala)) return res.status(403).json({ erro: 'Nas salas de servidor o anfitrião é o dono do servidor.' });

  donosPorSala.set(req.params.sala, usuario);
  res.json({ ok: true });
});

// O anfitrião consulta aqui quem está esperando pra entrar.
app.get('/rooms/:sala/pendentes', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
  if (!souAnfitriaoDeServidor(req, req.params.sala)) return res.status(403).json({ erro: 'Só o dono do servidor pode ver os pedidos.' });

  const pendentes = pendentesPorSala.get(req.params.sala);
  const pedidos = pendentes
    ? [...pendentes.entries()]
        .filter(([, p]) => p.status === 'pendente')
        .map(([solicitacaoId, p]) => ({ solicitacaoId, usuario: p.usuario, nome: p.nome || p.usuario }))
    : [];

  res.json({ pedidos });
});

// O anfitrião aceita ou recusa um pedido específico.
app.post('/rooms/:sala/decidir', async (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
  if (!souAnfitriaoDeServidor(req, req.params.sala)) return res.status(403).json({ erro: 'Só o dono do servidor pode decidir.' });

  const { solicitacaoId, decisao } = req.body || {};
  const pendentes = pendentesPorSala.get(req.params.sala);
  const pedido = pendentes && pendentes.get(solicitacaoId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado (pode ter expirado).' });

  if (decisao === 'aprovado') {
    try {
      pedido.token = await criarToken(pedido.usuario, req.params.sala, pedido.nome, pedido.avatar);
      pedido.status = 'aprovado';
    } catch (err) {
      console.error('Erro ao gerar token de aprovação:', err);
      pedido.status = 'negado';
      return res.status(500).json({ erro: 'Falha ao gerar token de aprovação.' });
    }
  } else {
    pedido.status = 'negado';
  }

  res.json({ ok: true });
});

// Quem está esperando consulta aqui se já foi decidido.
app.get('/token/status/:solicitacaoId', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });

  for (const pendentes of pendentesPorSala.values()) {
    const pedido = pendentes.get(req.params.solicitacaoId);
    if (pedido) {
      return res.json({ status: pedido.status, token: pedido.token || undefined });
    }
  }
  res.status(404).json({ erro: 'Pedido não encontrado.' });
});

app.post('/token', async (req, res) => {
  // A "chave de convite" não é a chave criptográfica real do LiveKit —
  // é só uma senha de app, mais fácil de trocar se vazar, sem precisar
  // gerar novas chaves do LiveKit nem reconfigurar o servidor inteiro.
  if (!chaveValida(req)) {
    return res.status(401).json({ erro: 'Chave de convite inválida.' });
  }

  const { sala, usuario, nome, avatar } = req.body || {};
  if (!sala || !usuario) {
    return res.status(400).json({ erro: 'Os campos sala e usuario são obrigatórios.' });
  }
  if (typeof sala !== 'string' || typeof usuario !== 'string' || usuario.length > 100) {
    return res.status(400).json({ erro: 'Os campos sala e usuario são inválidos.' });
  }

  // "usuario" é a identidade (única); "nome" é só o texto que aparece pros
  // outros. App antigo não manda "nome": aí o nome é a própria identidade.
  const nomeExibicao = limparNome(nome) || usuario;
  const avatarSeguro = limparAvatar(avatar);

  let dono = donosPorSala.get(sala);

  // Sala de servidor: só membros entram. O anfitrião é o dono do servidor, e a aprovação
  // só vale se o canal pedir E o dono estiver lá dentro (senão ninguém ficaria esperando à toa).
  if (interpretarSala(sala)) {
    try {
      const { servidor, canal } = repo.verificarAcessoSala(sala, usuario);
      dono = null;
      if (canal.tipo === 'voz' && canal.aprovacao && servidor.dono !== usuario && await donoEstaNaSala(sala, servidor.dono)) {
        dono = servidor.dono;
      }
    } catch (err) {
      if (err instanceof ErroRegra) return res.status(err.status).json({ erro: err.message });
      throw err;
    }
  }

  // Sala sem anfitrião definido (modo aberto, como sempre foi) ou é o
  // próprio anfitrião pedindo de novo: token na hora, sem espera.
  if (!dono || dono === usuario) {
    try {
      return res.json({ token: await criarToken(usuario, sala, nomeExibicao, avatarSeguro) });
    } catch (err) {
      console.error('Erro ao gerar token:', err);
      return res.status(500).json({ erro: 'Falha interna ao gerar o token.' });
    }
  }

  // Sala com anfitrião: cria um pedido pendente em vez de liberar na hora.
  if (!pendentesPorSala.has(sala)) pendentesPorSala.set(sala, new Map());
  const pendentes = pendentesPorSala.get(sala);
  const solicitacaoId = gerarId();
  pendentes.set(solicitacaoId, { usuario, nome: nomeExibicao, avatar: avatarSeguro, status: 'pendente', token: null, criadoEm: Date.now() });

  res.json({ aguardando: true, solicitacaoId });
});

// ---------- Salas ativas (pra listar em vez de digitar o nome de cabeça) ----------
app.get('/rooms/ativas', async (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });

  try {
    const salas = await roomService.listRooms();
    res.json({
      salas: salas.map(s => ({ nome: s.name, participantes: s.numParticipants }))
    });
  } catch (err) {
    console.error('Erro ao listar salas ativas:', err);
    res.status(500).json({ erro: 'Falha ao consultar salas ativas.' });
  }
});

// ---------- Moderação (só o anfitrião da sala) ----------
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

// Muta (à força, pelo servidor) as faixas de um tipo de outra pessoa. Só quem é o
// anfitrião da sala pode pedir isso.
async function mutarFaixasDe(req, res, tipos, mensagemErro) {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });

  const { usuarioQueMandou, identidadeAlvo } = req.body || {};
  const sala = req.params.sala;
  const dono = interpretarSala(sala) ? repo.donoDaSala(sala) : donosPorSala.get(sala);

  if (!dono || dono !== usuarioQueMandou) {
    return res.status(403).json({ erro: 'Só o anfitrião da sala pode fazer isso.' });
  }
  if (!identidadeAlvo || typeof identidadeAlvo !== 'string') {
    return res.status(400).json({ erro: 'identidadeAlvo é obrigatório.' });
  }

  try {
    const participante = await roomService.getParticipant(sala, identidadeAlvo);
    const faixas = (participante.tracks || []).filter((t) => faixaEhDe(t, ...tipos));

    for (const faixa of faixas) {
      await roomService.mutePublishedTrack(sala, identidadeAlvo, faixa.sid, true);
    }

    res.json({ ok: true, faixasPausadas: faixas.length });
  } catch (err) {
    console.error(mensagemErro, err);
    res.status(500).json({ erro: mensagemErro });
  }
}

// Parar a transmissão de tela de outra pessoa (vídeo e o áudio que vem junto).
app.post('/rooms/:sala/parar-transmissao', (req, res) =>
  mutarFaixasDe(req, res, [FAIXA.TELA, FAIXA.AUDIO_DA_TELA], 'Falha ao forçar parar a transmissão.'));

// Mutar o microfone de outra pessoa (pra todos na sala).
app.post('/rooms/:sala/mutar-microfone', (req, res) =>
  mutarFaixasDe(req, res, [FAIXA.MICROFONE], 'Falha ao mutar o microfone.'));

// ============================================================
// Servidores (cada pessoa pode ter 1; salas "sXXXXXXXXXX__canal")
// ============================================================
// A identidade vem no cabeçalho x-usuario (o app manda "discord:<id>"). Continua sendo
// "honor system" como no resto deste serviço: a chave de convite é o que protege o acesso.
function usuarioDe(req) {
  const usuario = req.get('x-usuario');
  if (!usuario) throw new ErroRegra(400, 'Cabeçalho x-usuario ausente.');
  return usuario;
}

// Embrulha uma rota: exige a chave, converte ErroRegra em resposta HTTP e esconde erros internos.
function rota(fn) {
  return async (req, res) => {
    if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });
    try {
      await fn(req, res, usuarioDe(req));
    } catch (err) {
      if (err instanceof ErroRegra) return res.status(err.status).json({ erro: err.message });
      console.error('Erro interno:', err);
      res.status(500).json({ erro: 'Erro interno do servidor.' });
    }
  };
}

// Tira pessoas (ou todo mundo, se usuario for null) das salas de voz no LiveKit. Se falhar,
// o servidor já mudou de qualquer jeito: o token delas vence em até 4h e nenhum novo é emitido.
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

// ---- Presença (substitui a sala "presença" do LiveKit, que cobrava minutos 24h por dia) ----
// Cada app avisa a cada ~20s que está aberto; quem fica 60s sem avisar some da lista.
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

app.post('/servidores/:id/presenca', rota((req, res, usuario) => {
  const servidor = repo.obter(req.params.id, usuario); // 403 se não for membro
  const { nome, avatar, canalVoz } = req.body || {};
  const canalOk = typeof canalVoz === 'string' && servidor.canais.some((c) => c.id === canalVoz && c.tipo === 'voz') ? canalVoz : null;
  if (!presenca.has(servidor.id)) presenca.set(servidor.id, new Map());
  presenca.get(servidor.id).set(usuario, {
    nome: limparTexto(nome, 40) || usuario,
    avatar: limparAvatarServidor(avatar),
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

// Limpeza geral de tempos em tempos (servidores sem ninguém ping-ando).
setInterval(() => { for (const id of [...presenca.keys()]) { listarOnline(id); if (!presenca.get(id).size) presenca.delete(id); } }, 60000).unref();

module.exports = { app, repo, _trocarRoomService: (novo) => { roomService = novo; } };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Servidor de token ativo na porta ${PORT}`);
  });
}

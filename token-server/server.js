const express = require('express');
const { AccessToken } = require('livekit-server-sdk');

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const INVITE_KEY = process.env.INVITE_KEY;

if (!API_KEY || !API_SECRET || !INVITE_KEY) {
  console.error(
    'ERRO: defina LIVEKIT_API_KEY, LIVEKIT_API_SECRET e INVITE_KEY ' +
    'no server.env antes de subir este serviço.'
  );
  process.exit(1);
}

const app = express();
app.use(express.json());

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

async function criarToken(usuario, sala) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity: usuario,
    name: usuario,
    ttl: '4h',
  });
  at.addGrant({
    roomJoin: true,
    room: sala,
    canPublish: true,
    canSubscribe: true,
  });
  return at.toJwt();
}

// Descarta pedidos esquecidos (ninguém decidiu em 2 minutos).
setInterval(() => {
  const agora = Date.now();
  for (const pendentes of pendentesPorSala.values()) {
    for (const pedido of pendentes.values()) {
      if (pedido.status === 'pendente' && agora - pedido.criadoEm > 120000) {
        pedido.status = 'negado';
      }
    }
  }
}, 15000);

// Marca quem é o anfitrião de uma sala — a partir daí, novos pedidos de
// entrada de outras pessoas ficam pendentes até ele decidir.
app.post('/rooms/:sala/tornar-dono', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });

  const { usuario } = req.body || {};
  if (!usuario) return res.status(400).json({ erro: 'usuario é obrigatório.' });

  donosPorSala.set(req.params.sala, usuario);
  res.json({ ok: true });
});

// O anfitrião consulta aqui quem está esperando pra entrar.
app.get('/rooms/:sala/pendentes', (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });

  const pendentes = pendentesPorSala.get(req.params.sala);
  const pedidos = pendentes
    ? [...pendentes.entries()]
        .filter(([, p]) => p.status === 'pendente')
        .map(([solicitacaoId, p]) => ({ solicitacaoId, usuario: p.usuario }))
    : [];

  res.json({ pedidos });
});

// O anfitrião aceita ou recusa um pedido específico.
app.post('/rooms/:sala/decidir', async (req, res) => {
  if (!chaveValida(req)) return res.status(401).json({ erro: 'Chave de convite inválida.' });

  const { solicitacaoId, decisao } = req.body || {};
  const pendentes = pendentesPorSala.get(req.params.sala);
  const pedido = pendentes && pendentes.get(solicitacaoId);
  if (!pedido) return res.status(404).json({ erro: 'Pedido não encontrado (pode ter expirado).' });

  if (decisao === 'aprovado') {
    try {
      pedido.token = await criarToken(pedido.usuario, req.params.sala);
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

  const { sala, usuario } = req.body || {};
  if (!sala || !usuario) {
    return res.status(400).json({ erro: 'Os campos sala e usuario são obrigatórios.' });
  }

  const dono = donosPorSala.get(sala);

  // Sala sem anfitrião definido (modo aberto, como sempre foi) ou é o
  // próprio anfitrião pedindo de novo: token na hora, sem espera.
  if (!dono || dono === usuario) {
    try {
      return res.json({ token: await criarToken(usuario, sala) });
    } catch (err) {
      console.error('Erro ao gerar token:', err);
      return res.status(500).json({ erro: 'Falha interna ao gerar o token.' });
    }
  }

  // Sala com anfitrião: cria um pedido pendente em vez de liberar na hora.
  if (!pendentesPorSala.has(sala)) pendentesPorSala.set(sala, new Map());
  const pendentes = pendentesPorSala.get(sala);
  const solicitacaoId = gerarId();
  pendentes.set(solicitacaoId, { usuario, status: 'pendente', token: null, criadoEm: Date.now() });

  res.json({ aguardando: true, solicitacaoId });
});

app.listen(PORT, () => {
  console.log(`Servidor de token ativo na porta ${PORT}`);
});

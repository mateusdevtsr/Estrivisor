'use strict';
// Testes do painel (/painel): só o administrador entra, cabeçalhos de segurança e os números.
// Sobe o servidor de verdade numa porta livre, com dados numa pasta temporária.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'painel-'));
const backups = path.join(dir, 'backups');
fs.mkdirSync(backups);
fs.writeFileSync(path.join(backups, 'dados-2026-10-11.tar.gz'), 'x');
fs.writeFileSync(path.join(backups, 'status.txt'), 'data=2026-10-11 04:00:05\nlocal=ok\nvps=ok\n');
Object.assign(process.env, {
  LIVEKIT_API_KEY: 'chave-de-teste', LIVEKIT_API_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres', INVITE_KEY: 'convite', LIVEKIT_URL: 'ws://127.0.0.1:1',
  DISCORD_CLIENT_ID: '123456', DISCORD_CLIENT_SECRET: 'segredo', DISCORD_REDIRECT_URI: 'http://127.0.0.1:53134/callback',
  PAINEL_REDIRECT_URI: 'https://api.exemplo.com.br/painel/retorno',
  ADMIN_DISCORD_IDS: '111111111', APP_VERSAO_MINIMA: '3.9.0', GITHUB_REPO: 'desligado', ACESSO_RESTRITO: '1',
  DATA_FILE: path.join(dir, 'servidores.json'), BACKUP_DIR: backups, PRAZO_LIVEKIT_MS: '300',
});
const srv = require('../server.js');
const { ACAO_TENTOU, ACAO_ENTROU } = require('../painel.js');

// Discord de mentira: devolve a conta com o ID que o teste escolher.
let idDiscord = '111111111';
async function discordDeMentira(url) {
  if (String(url).includes('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'token-de-teste' }) };
  return { ok: true, json: async () => ({ id: idDiscord, username: 'pessoa', global_name: idDiscord === '111111111' ? 'Mateus' : 'Intrusa', avatar: null, discriminator: '0' }) };
}
srv._trocarBuscaDiscord(discordDeMentira);

let servidor; let base;
test.before(async () => {
  servidor = await new Promise((ok) => { const s = srv.app.listen(0, '127.0.0.1', () => ok(s)); });
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => { if (servidor) servidor.close(); });

function cookiesDe(r) {
  const lista = typeof r.headers.getSetCookie === 'function'
    ? r.headers.getSetCookie()
    : String(r.headers.get('set-cookie') || '').split(/,(?=\s*__Secure-)/).filter(Boolean);
  const saida = {};
  for (const c of lista) {
    const par = c.split(';')[0];
    const i = par.indexOf('=');
    saida[par.slice(0, i).trim()] = { valor: par.slice(i + 1), inteiro: c };
  }
  return saida;
}
const pegar = (caminho, opcoes = {}) => fetch(base + caminho, { redirect: 'manual', ...opcoes });

// Faz o caminho inteiro do login: /painel/entrar -> (Discord) -> /painel/retorno.
// (O painel aceita no máximo 20 pedidos de login por minuto por IP; por isso os testes
// reaproveitam uma sessão de admin em vez de entrar toda hora.)
let cookieAdmin = null;
async function sessaoAdmin() {
  if (cookieAdmin) return cookieAdmin;
  const { r2 } = await entrar();
  cookieAdmin = `__Secure-painel=${cookiesDe(r2)['__Secure-painel'].valor}`;
  return cookieAdmin;
}
async function entrar() {
  const r1 = await pegar('/painel/entrar');
  assert.strictEqual(r1.status, 302);
  const destino = new URL(r1.headers.get('location'));
  const estado = destino.searchParams.get('state');
  const cookieEstado = cookiesDe(r1)['__Secure-painel-estado'].valor;
  const r2 = await pegar(`/painel/retorno?code=codigo-de-teste-123&state=${encodeURIComponent(estado)}`, { headers: { cookie: `__Secure-painel-estado=${cookieEstado}` } });
  return { r1, r2, destino, estado, cookieEstado };
}

test('a página abre com cabeçalhos de segurança, mesmo com a versão mínima do app ligada', async () => {
  const r = await pegar('/painel');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.strictEqual(r.headers.get('x-frame-options'), 'DENY');
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  assert.strictEqual(r.headers.get('referrer-policy'), 'no-referrer');
  const js = await pegar('/painel/painel.js');
  assert.strictEqual(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  // o app continua obrigado a mandar a versão
  const app = await pegar('/servidores', { headers: { 'x-invite-key': 'convite' } });
  assert.strictEqual(app.status, 426);
});

test('sem login, os números não saem', async () => {
  const r = await pegar('/painel/api/resumo');
  assert.strictEqual(r.status, 401);
  const j = await r.json();
  assert.strictEqual(j.login, true);
  const r2 = await pegar('/painel/api/resumo', { headers: { cookie: '__Secure-painel=pnl_inventado_0123456789abcdef' } });
  assert.strictEqual(r2.status, 401);
});

test('o login manda pro Discord com o endereço de retorno do painel', async () => {
  const r = await pegar('/painel/entrar');
  assert.strictEqual(r.status, 302);
  const u = new URL(r.headers.get('location'));
  assert.strictEqual(u.origin + u.pathname, 'https://discord.com/oauth2/authorize');
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://api.exemplo.com.br/painel/retorno');
  assert.strictEqual(u.searchParams.get('scope'), 'identify');
  assert.ok(u.searchParams.get('state').length >= 20);
  const c = cookiesDe(r)['__Secure-painel-estado'];
  assert.ok(c, 'faltou o cookie do state');
  assert.match(c.inteiro, /HttpOnly/i);
  assert.match(c.inteiro, /Secure/i);
  assert.match(c.inteiro, /Path=\/painel/i);
});

test('retorno com state que não bate (ou sem cookie) é recusado', async () => {
  const r1 = await pegar('/painel/entrar');
  const estado = new URL(r1.headers.get('location')).searchParams.get('state');
  const outro = await pegar(`/painel/retorno?code=codigo-de-teste-123&state=${estado}`, { headers: { cookie: '__Secure-painel-estado=outro-valor' } });
  assert.strictEqual(outro.status, 400);
  const semCookie = await pegar(`/painel/retorno?code=codigo-de-teste-123&state=${estado}`);
  assert.strictEqual(semCookie.status, 400);
  assert.ok(!cookiesDe(semCookie)['__Secure-painel'] || !cookiesDe(semCookie)['__Secure-painel'].valor);
});

test('conta que não é administradora não entra, e a tentativa vai pro Histórico (uma vez por hora)', async () => {
  idDiscord = '999999999';
  const { r2 } = await entrar();
  const { r2: deNovo } = await entrar();
  idDiscord = '111111111';
  assert.strictEqual(r2.status, 403);
  assert.strictEqual(deNovo.status, 403);
  const sessao = cookiesDe(r2)['__Secure-painel'];
  assert.ok(!sessao || !sessao.valor, 'não pode criar sessão pra quem não é admin');
  const registros = srv.moderacao.historico(50).filter((h) => h.acao === ACAO_TENTOU && h.por === 'discord:999999999');
  assert.strictEqual(registros.length, 1);
});

test('o administrador entra, vê os números e sai', async () => {
  const { r2, estado, cookieEstado } = await entrar();
  assert.strictEqual(r2.status, 302);
  assert.strictEqual(r2.headers.get('location'), '/painel');
  const c = cookiesDe(r2)['__Secure-painel'];
  assert.ok(c && c.valor, 'faltou o cookie da sessão');
  assert.match(c.inteiro, /HttpOnly/i);
  assert.match(c.inteiro, /Secure/i);
  assert.match(c.inteiro, /SameSite=Strict/i);
  assert.match(c.inteiro, /Path=\/painel/i);
  const cookie = `__Secure-painel=${c.valor}`;

  // o mesmo state não serve duas vezes
  const repetido = await pegar(`/painel/retorno?code=codigo-de-teste-123&state=${estado}`, { headers: { cookie: `__Secure-painel-estado=${cookieEstado}` } });
  assert.strictEqual(repetido.status, 400);

  const eu = await (await pegar('/painel/api/eu', { headers: { cookie } })).json();
  assert.strictEqual(eu.nome, 'Mateus');
  assert.ok(srv.moderacao.historico(50).some((h) => h.acao === ACAO_ENTROU && h.por === 'discord:111111111'));
  const r = await pegar('/painel/api/resumo?dias=30', { headers: { cookie } });
  assert.strictEqual(r.status, 200);
  const d = await r.json();
  for (const chave of ['agora', 'pessoas', 'mensagens', 'chamadas', 'servidores', 'downloads', 'versoes', 'serie', 'saude', 'moderacao']) assert.ok(chave in d, 'faltou ' + chave);
  assert.strictEqual(d.serie.length, 30);
  // todo campo que a página e o CSV usam vem em cada dia da série
  for (const campo of ['dia', 'coletado', 'ativos', 'novos', 'logins', 'pedidosAcesso', 'msgCanal', 'msgDm', 'msgEstimado', 'msgEditadas', 'msgApagadas',
    'entradasVoz', 'salasCheias', 'minutosVoz', 'minutosTela', 'picoOnline', 'picoVoz', 'picoTela', 'servidoresCriados', 'downloads', 'requisicoes', 'erros', 'falhasLivekit']) {
    assert.ok(campo in d.serie[d.serie.length - 1], 'faltou na série: ' + campo);
  }
  assert.strictEqual(d.downloads.ok, false);
  assert.strictEqual(d.saude.backup.ultimo.arquivo, 'dados-2026-10-11.tar.gz');
  assert.strictEqual(d.saude.backup.status.vps, 'ok');

  const sair = await pegar('/painel/api/sair', { method: 'POST', headers: { cookie } });
  assert.strictEqual(sair.status, 200);
  const depois = await pegar('/painel/api/resumo', { headers: { cookie } });
  assert.strictEqual(depois.status, 401);
});

test('se o Discord recusar o login, a página explica o motivo (nada de 502/504, que a Cloudflare troca por "Bad gateway")', async () => {
  const linhas = [];
  const errorOriginal = console.error;
  console.error = (...a) => linhas.push(a.map(String).join(' '));
  srv._trocarBuscaDiscord(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Invalid "code" in request.' }) }));
  try {
    const { r2 } = await entrar();
    assert.ok(![502, 504].includes(r2.status), 'status ' + r2.status);
    assert.strictEqual(r2.status, 401);
    const texto = await r2.text();
    assert.match(texto, /Não deu para entrar/);
    assert.match(texto, /O Discord não confirmou o login/);
    const sessao = cookiesDe(r2)['__Secure-painel'];
    assert.ok(!sessao || !sessao.valor, 'não pode criar sessão');
    assert.ok(linhas.some((l) => l.includes('HTTP 400') && l.includes('invalid_grant')), 'o motivo do Discord tem que ir pro log');

    // a pessoa cancelou (ou o Discord voltou com erro): página clara e o motivo no log
    const r1 = await pegar('/painel/entrar');
    const estado = new URL(r1.headers.get('location')).searchParams.get('state');
    const cookieEstado = cookiesDe(r1)['__Secure-painel-estado'].valor;
    const cancelado = await pegar(`/painel/retorno?error=access_denied&state=${encodeURIComponent(estado)}`, { headers: { cookie: `__Secure-painel-estado=${cookieEstado}` } });
    assert.strictEqual(cancelado.status, 400);
    assert.match(await cancelado.text(), /Login cancelado/);
    assert.ok(linhas.some((l) => l.includes('access_denied')), 'o erro devolvido pelo Discord tem que ir pro log');
  } finally {
    console.error = errorOriginal;
    srv._trocarBuscaDiscord(discordDeMentira);
  }
});

test('o painel conta pessoas ativas, mensagens, versões e servidores', async () => {
  srv.acesso.autorizarPorId('discord:222222222', 'Beto');
  const { chave } = srv.sessoes.criar({ usuario: 'discord:222222222', tipo: 'discord', perfil: { nome: 'Beto', avatar: null } });
  const h = { 'content-type': 'application/json', 'x-invite-key': 'convite', 'x-app-versao': '3.9.1', authorization: 'Bearer ' + chave };
  await pegar('/termos/aceitar', { method: 'POST', headers: h, body: JSON.stringify({ versao: 2, maior18: true }) });
  const criado = await pegar('/servidores', { method: 'POST', headers: h, body: JSON.stringify({ nome: 'Turma do Beto', nomeUsuario: 'Beto' }) });
  assert.strictEqual(criado.status, 201);
  const sv = (await criado.json()).servidor;
  const canal = sv.canais.find((x) => x.tipo === 'texto');
  for (let i = 0; i < 3; i++) {
    const m = await pegar(`/servidores/${sv.id}/canais/${canal.id}/mensagens`, { method: 'POST', headers: h, body: JSON.stringify({ texto: 'oi ' + i }) });
    assert.strictEqual(m.status, 201);
  }
  const cookie = await sessaoAdmin();
  const d = await (await pegar('/painel/api/resumo?dias=7', { headers: { cookie } })).json();
  assert.ok(d.pessoas.ativasHoje >= 1);
  assert.ok(d.mensagens.hoje >= 3, 'mensagens de hoje: ' + d.mensagens.hoje);
  assert.ok(d.versoes.some((v) => v.versao === '3.9.1'));
  assert.strictEqual(d.servidores.total, 1);
  assert.strictEqual(d.servidores.lista[0].nome, 'Turma do Beto');
  assert.ok(d.servidores.lista[0].mensagensPeriodo >= 3);
  assert.strictEqual(d.serie[d.serie.length - 1].servidoresCriados, 1);
  // nada de texto das mensagens na resposta
  assert.ok(!JSON.stringify(d).includes('oi 1'));
});

test('a foto por minuto conta quem está em chamada e transmitindo', async () => {
  srv._trocarRoomService({
    listRooms: async () => [{ name: 'sala-a', numParticipants: 3 }, { name: 'sala-b', numParticipants: 0 }],
    listParticipants: async () => [
      { identity: 'a', tracks: [{ source: 3, muted: false }] },
      { identity: 'b', tracks: [{ source: 'SCREEN_SHARE', muted: true }] },
      { identity: 'c', tracks: [{ source: 2, muted: false }] },
    ],
  });
  await srv._fotografar();
  const cookie = await sessaoAdmin();
  const d = await (await pegar('/painel/api/resumo?dias=90', { headers: { cookie } })).json();
  assert.strictEqual(d.agora.emChamada, 3);
  assert.strictEqual(d.agora.salasAtivas, 1);
  assert.strictEqual(d.agora.transmitindo, 1);
  assert.strictEqual(d.agora.livekit.ok, true);
  assert.ok(d.ultimas24h.length >= 1);
});

test('JSON quebrado recebe uma resposta curta (sem detalhes internos)', async () => {
  const r = await pegar('/auth/local', { method: 'POST', headers: { 'content-type': 'application/json', 'x-invite-key': 'convite', 'x-app-versao': '3.9.1' }, body: '{quebrado' });
  assert.strictEqual(r.status, 400);
  const texto = await r.text();
  assert.ok(!/node_modules|at \w+ \(/.test(texto), 'vazou detalhe interno: ' + texto.slice(0, 200));
});

test('quem abre por http é mandado pro https (e o https ganha HSTS)', async () => {
  const r = await pegar('/painel?x=1', { headers: { 'cf-visitor': '{"scheme":"http"}' } });
  assert.strictEqual(r.status, 301);
  assert.strictEqual(r.headers.get('location'), 'https://api.exemplo.com.br/painel?x=1');
  const r2 = await pegar('/painel', { headers: { 'cf-visitor': '{"scheme":"https"}' } });
  assert.strictEqual(r2.status, 200);
  assert.match(r2.headers.get('strict-transport-security') || '', /max-age=\d+/);
});

test('LiveKit travado: a foto termina no prazo e marca o servidor de voz como fora', async () => {
  srv._trocarRoomService({ listRooms: () => new Promise(() => {}), listParticipants: () => new Promise(() => {}) });
  const inicio = Date.now();
  await Promise.all([srv._fotografar(), srv._fotografar()]); // a segunda não pode ficar empilhada
  assert.ok(Date.now() - inicio < 3000, 'demorou demais');
  const a = srv.metricas.amostrasRecentes(1);
  assert.strictEqual(a[a.length - 1].livekitOk, false);
});

test('pedido pro app não fica pendurado se o LiveKit travar (entrar em canal de voz)', async () => {
  srv._trocarRoomService({ listRooms: () => new Promise(() => {}), listParticipants: () => new Promise(() => {}) });
  const { chave } = srv.sessoes.criar({ usuario: 'discord:222222222', tipo: 'discord', perfil: { nome: 'Beto', avatar: null } });
  const h = { 'content-type': 'application/json', 'x-invite-key': 'convite', 'x-app-versao': '3.9.1', authorization: 'Bearer ' + chave };
  const sv = srv.repo.listarMeus('discord:222222222')[0];
  const inicio = Date.now();
  const r = await pegar('/token', { method: 'POST', headers: h, body: JSON.stringify({ sala: `${sv.id}__geral-voz` }) });
  assert.strictEqual(r.status, 200);
  assert.ok(Date.now() - inicio < 3000, 'demorou demais');
});

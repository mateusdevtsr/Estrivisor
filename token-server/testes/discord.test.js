'use strict';
// Testes do login com Discord (troca do código pela conta da pessoa), sem internet.
const test = require('node:test');
const assert = require('node:assert');
const { contaDoCodigo, ErroDiscord } = require('../discord.js');

const base = { codigo: 'codigo-secreto-0123456789', redirectUri: 'https://api.exemplo.com.br/painel/retorno', clientId: '123456', clientSecret: 'segredo-do-app' };

// Guarda o que foi pro log (console.error) enquanto fn roda.
async function comLog(fn) {
  const linhas = [];
  const original = console.error;
  console.error = (...a) => linhas.push(a.map(String).join(' '));
  try { await fn(); } finally { console.error = original; }
  return linhas;
}

test('troca o código usando o mesmo endereço de retorno e devolve a conta', async () => {
  let pedido = null;
  const perfil = await contaDoCodigo({
    ...base,
    buscar: async (url, opcoes) => {
      if (String(url).includes('/oauth2/token')) { pedido = opcoes; return { ok: true, json: async () => ({ access_token: 'token-de-teste' }) }; }
      return { ok: true, json: async () => ({ id: '111111111', username: 'mateus', global_name: 'Mateus', avatar: null, discriminator: '0' }) };
    },
  });
  assert.strictEqual(perfil.id, '111111111');
  assert.strictEqual(perfil.nome, 'Mateus');
  const corpo = new URLSearchParams(pedido.body);
  assert.strictEqual(corpo.get('grant_type'), 'authorization_code');
  assert.strictEqual(corpo.get('redirect_uri'), base.redirectUri);
  assert.strictEqual(pedido.headers.Authorization, 'Basic ' + Buffer.from('123456:segredo-do-app').toString('base64'));
});

test('o Discord recusou o código: erro amigável, e o motivo vai pro log (sem segredo e sem quebra de linha)', async () => {
  const linhas = await comLog(async () => {
    await assert.rejects(
      contaDoCodigo({ ...base, buscar: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Invalid "redirect_uri" in request.\nlinha falsa' }) }) }),
      (e) => e instanceof ErroDiscord && /não confirmou o login/.test(e.message),
    );
  });
  assert.strictEqual(linhas.length, 1);
  assert.match(linhas[0], /HTTP 400/);
  assert.match(linhas[0], /invalid_grant: Invalid "redirect_uri" in request\. linha falsa/);
  assert.ok(!linhas[0].includes('\n'));
  assert.ok(!linhas[0].includes('segredo-do-app') && !linhas[0].includes('codigo-secreto'));
});

test('resposta estranha do Discord (sem JSON, JSON quebrado, sem token) vira erro amigável', async () => {
  const respostas = [
    { ok: false, status: 500 },
    { ok: false, status: 502, json: async () => { throw new SyntaxError('nao e json'); } },
    { ok: true, status: 200, json: async () => null },
    { ok: true, status: 200, json: async () => ({ access_token: 42 }) },
  ];
  await comLog(async () => {
    for (const r of respostas) await assert.rejects(contaDoCodigo({ ...base, buscar: async () => r }), ErroDiscord);
  });
  // conta que volta sem dados
  await comLog(async () => {
    await assert.rejects(contaDoCodigo({
      ...base,
      buscar: async (url) => (String(url).includes('/oauth2/token') ? { ok: true, json: async () => ({ access_token: 't' }) } : { ok: true, json: async () => null }),
    }), ErroDiscord);
  });
});

test('sem conexão com o Discord: erro amigável e a causa vai pro log', async () => {
  const linhas = await comLog(async () => {
    await assert.rejects(
      contaDoCodigo({ ...base, buscar: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } }),
      (e) => e instanceof ErroDiscord && /Não consegui falar com o Discord/.test(e.message),
    );
  });
  assert.ok(linhas.some((l) => l.includes('ENOTFOUND')));
});

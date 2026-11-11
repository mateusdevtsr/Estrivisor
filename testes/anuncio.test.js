'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mensagemDaVersao, escolher, mandar } = require('../scripts/anunciar-discord.js');
const { NOVIDADES } = require('../novidades.js');

test('anúncio no Discord: cabe nos limites, não marca ninguém e tem os links', () => {
  for (const n of NOVIDADES) {
    const m = mensagemDaVersao(n, { maisNova: n === NOVIDADES[0] });
    const e = m.embeds[0];
    assert.ok(e.title.length <= 256 && e.description.length <= 4096, n.versao);
    assert.deepStrictEqual(m.allowed_mentions, { parse: [] });
    assert.ok(e.description.includes(`releases/tag/v${n.versao}`));
    assert.strictEqual(e.description.includes('Estrivisor-Android.apk'), n === NOVIDADES[0], 'link do celular só na mais nova');
  }
});

test('anúncio no Discord: escolhe a versão, o histórico em ordem e recusa versão sem novidades', () => {
  assert.strictEqual(escolher([], NOVIDADES[0].versao)[0].n.versao, NOVIDADES[0].versao);
  const todas = escolher(['--todas'], '0.0.0').map((x) => x.n.versao);
  assert.strictEqual(todas[todas.length - 1], NOVIDADES[0].versao, 'a mais nova por último');
  assert.throws(() => escolher(['9.9.9'], '0.0.0'), /não tem/);
});

test('anúncio no Discord: espera quando o Discord pede e avisa quando recusa', async () => {
  let chamadas = 0;
  await mandar('https://discord.com/api/webhooks/1/x', {}, async () => (++chamadas === 1 ? { ok: false, status: 429, json: async () => ({ retry_after: 0.01 }) } : { ok: true }));
  assert.strictEqual(chamadas, 2);
  await assert.rejects(mandar('u', {}, async () => ({ ok: false, status: 404, text: async () => 'Unknown Webhook' })), /404/);
});

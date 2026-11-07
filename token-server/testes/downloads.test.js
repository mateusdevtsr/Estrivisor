'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarDownloads } = require('../downloads');

const silencioso = { error() {} };
const resposta = (corpo, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const versao = (tag, dias, exe, bm, yml, extra = {}) => ({
  tag_name: tag, draft: false, prerelease: false, published_at: new Date(Date.parse('2026-10-13T12:00:00Z') - dias * 86400e3).toISOString(),
  assets: [{ name: 'Estrivisor-Setup.exe', download_count: exe }, { name: 'Estrivisor-Setup.exe.blockmap', download_count: bm }, { name: 'latest.yml', download_count: yml }],
  ...extra,
});

test('soma os downloads de cada tipo, ignora rascunhos e ordena da versão mais nova', async () => {
  const d = criarDownloads({
    log: silencioso,
    buscar: async () => resposta([versao('v3.9.0', 2, 37, 11, 940), versao('v3.9.1', 1, 41, 9, 1210), versao('v4.0.0', 0, 999, 0, 0, { draft: true })]),
  });
  const e = await d.atualizar();
  assert.strictEqual(e.ok, true);
  assert.deepStrictEqual(e.total, { instalador: 78, blockmap: 20, verificacoes: 2150 });
  assert.deepStrictEqual(e.versoes.map((v) => v.versao), ['3.9.1', '3.9.0']);
});

test('resposta estranha do GitHub não derruba nada e mantém os números de antes', async () => {
  let vez = 0;
  const d = criarDownloads({
    log: silencioso,
    buscar: async () => {
      vez++;
      if (vez === 1) return resposta([versao('v3.9.1', 1, 41, 9, 1210)]);
      if (vez === 2) return resposta({ message: 'API rate limit exceeded' }, 403);
      if (vez === 3) return resposta('isso não é uma lista');
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    },
  });
  await d.atualizar();
  for (const esperado of [/limitou/, /inesperada/, /demorou/]) {
    const e = await d.atualizar();
    assert.strictEqual(e.ok, false);
    assert.match(e.erro, esperado);
    assert.strictEqual(e.total.instalador, 41, 'perdeu os números que já tinha');
  }
});

test('arquivos com contagem estranha contam como zero', async () => {
  const d = criarDownloads({
    log: silencioso,
    buscar: async () => resposta([{ tag_name: 'v1.0.0', assets: [{ name: 'a.exe', download_count: 'muitos' }, { download_count: 5 }, null, { name: 'b.EXE', download_count: '3' }] }, null, 'x']),
  });
  const e = await d.atualizar();
  assert.strictEqual(e.ok, true);
  assert.strictEqual(e.total.instalador, 3);
});

test('guarda a consulta por 30 minutos e não repete enquanto uma está em andamento', async () => {
  let t = 1_000_000; let chamadas = 0;
  const d = criarDownloads({ log: silencioso, agora: () => t, buscar: async () => { chamadas++; return resposta([versao('v1.0.0', 1, 1, 0, 0)]); } });
  await Promise.all([d.atualizar(), d.atualizar()]);
  assert.strictEqual(chamadas, 1);
  d.obter(); assert.strictEqual(chamadas, 1);
  t += 31 * 60 * 1000;
  d.obter(); await new Promise((r) => setImmediate(r));
  assert.strictEqual(chamadas, 2);
});

test('GITHUB_REPO=desligado (ou inválido) não consulta nada', async () => {
  let chamadas = 0;
  const buscar = async () => { chamadas++; return resposta([]); };
  for (const repo of ['desligado', '', 'sem-barra', '../../x/y/z']) {
    const d = criarDownloads({ repo, log: silencioso, buscar });
    const e = await d.atualizar();
    assert.strictEqual(e.ok, false);
    assert.strictEqual(d.obter().ok, false);
  }
  assert.strictEqual(chamadas, 0);
});

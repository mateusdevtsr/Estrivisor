const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../sons');

test('todo evento tem nome, descrição e notas válidas', () => {
  assert.equal(new Set(S.IDS).size, S.IDS.length);
  for (const e of S.EVENTOS) {
    assert.ok(e.nome && e.desc, e.id);
    assert.ok(e.notas.length > 0, e.id);
    for (const n of e.notas) {
      assert.ok(n.f >= 100 && n.f <= 4000, e.id + ' freq');
      assert.ok(n.t >= 0 && n.d > 0 && n.t + n.d < 1, e.id + ' tempo');
      assert.ok(n.v > 0 && n.v <= 0.6, e.id + ' volume');
      assert.ok(['sine', 'triangle', 'square', 'sawtooth'].includes(n.o), e.id + ' onda');
    }
  }
});

test('validar: lixo vira padrão e tudo começa ligado', () => {
  for (const x of [null, undefined, 5, 'x', [], {}]) {
    const c = S.validar(x);
    assert.equal(c.ativo, true);
    assert.equal(c.volume, 60);
    assert.deepEqual(Object.keys(c.eventos), S.IDS);
    assert.ok(Object.values(c.eventos).every((v) => v === true));
    assert.deepEqual(c.custom, {});
  }
});

test('validar: volume com limites e eventos só verdadeiro/falso', () => {
  assert.equal(S.validar({ volume: 100 }).volume, 100);
  assert.equal(S.validar({ volume: 0 }).volume, 0);
  assert.equal(S.validar({ volume: 101 }).volume, 60);
  assert.equal(S.validar({ volume: -1 }).volume, 60);
  assert.equal(S.validar({ volume: '50' }).volume, 60);
  assert.equal(S.validar({ ativo: 'nao' }).ativo, true);
  const c = S.validar({ ativo: false, eventos: { mensagem: false, dm: 'x', inventado: false } });
  assert.equal(c.ativo, false);
  assert.equal(c.eventos.mensagem, false);
  assert.equal(c.eventos.dm, true);
  assert.ok(!('inventado' in c.eventos));
});

test('validar: sons escolhidos só para eventos conhecidos e áudio válido', () => {
  const c = S.validar({ custom: {
    mensagem: { tipo: 'audio/mpeg', nome: 'ding\n<x>' + 'a'.repeat(100) },
    dm: { tipo: 'text/html', nome: 'x' },
    inventado: { tipo: 'audio/mpeg', nome: 'x' },
    entrou: 'lixo',
  } });
  assert.deepEqual(Object.keys(c.custom), ['mensagem']);
  assert.ok(c.custom.mensagem.nome.length <= 60);
  assert.ok(!/[\n\r]/.test(c.custom.mensagem.nome));
  assert.deepEqual(S.validar({ custom: [1, 2] }).custom, {});
});

test('arquivos de som: tipo e tamanho', () => {
  assert.equal(S.validarArquivo({ type: 'audio/mpeg', size: 1000 }).ok, true);
  assert.equal(S.validarArquivo({ type: 'audio/wav', size: S.MAX_BYTES }).ok, true);
  assert.equal(S.validarArquivo({ type: 'audio/wav', size: S.MAX_BYTES + 1 }).ok, false);
  assert.equal(S.validarArquivo({ type: 'audio/mpeg', size: 0 }).ok, false);
  for (const t of ['video/mp4', 'image/png', 'application/octet-stream', '', undefined]) assert.equal(S.validarArquivo({ type: t, size: 10 }).ok, false, String(t));
  assert.equal(S.validarArquivo(null).ok, false);
});

test('sons.js está no instalador e carregado antes do app; app usa todos os eventos', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('sons.js'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('sons.js') > 0 && html.indexOf('sons.js') < html.indexOf('estrivisor-app.js'));
  const app = fs.readFileSync(path.join(__dirname, '..', 'estrivisor-app.js'), 'utf8');
  for (const id of S.IDS) assert.ok(app.includes(`'${id}'`), 'sem uso no app: ' + id);
});

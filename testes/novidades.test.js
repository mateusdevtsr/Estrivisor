const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const N = require('../novidades');

const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

test('compararVersoes compara número por número', () => {
  assert.ok(N.compararVersoes('3.10.0', '3.9.1') > 0);
  assert.ok(N.compararVersoes('3.9.1', '3.10.0') < 0);
  assert.equal(N.compararVersoes('v3.10.1', '3.10.1'), 0);
  assert.equal(N.compararVersoes('3.10', '3.10.0'), 0);
  assert.ok(N.compararVersoes('abc', '1.0.0') < 0);
});

test('cada versão tem itens completos e a lista vai da mais nova para a mais antiga', () => {
  for (const n of N.NOVIDADES) {
    assert.match(n.versao, /^\d+\.\d+\.\d+$/);
    assert.ok(n.titulo && n.itens.length > 0, n.versao);
    for (const it of n.itens) for (const k of ['i', 't', 'd', 'c']) assert.ok(typeof it[k] === 'string' && it[k].length > 0, n.versao + ' ' + k);
  }
  for (let i = 1; i < N.NOVIDADES.length; i++) assert.ok(N.compararVersoes(N.NOVIDADES[i - 1].versao, N.NOVIDADES[i].versao) > 0);
});

test('a versão do package.json tem novidades escritas no topo da lista', () => {
  const v = JSON.parse(ler('package.json')).version;
  assert.equal(N.NOVIDADES[0].versao, v, 'Acrescente o bloco da versão ' + v + ' em novidades.js');
});

test('novidadesParaMostrar: só o que é depois da última vista, até a atual', () => {
  assert.deepEqual(N.novidadesParaMostrar('3.10.0', '3.10.1').map((n) => n.versao), ['3.10.1']);
  assert.deepEqual(N.novidadesParaMostrar('3.10.1', '3.10.1'), []);
  assert.deepEqual(N.novidadesParaMostrar('3.9.0', '3.10.1').map((n) => n.versao), ['3.10.1', '3.10.0']);
  assert.deepEqual(N.novidadesParaMostrar(null, '3.10.1').map((n) => n.versao), ['3.10.1']); // primeira vez: só a mais recente
  assert.deepEqual(N.novidadesParaMostrar('3.10.0', '3.10.0'), []);
  assert.deepEqual(N.novidadesParaMostrar('1.0.0', '1.0.1'), []); // versão atual sem texto
});

test('novidades.js está no instalador e carregado antes do app', () => {
  assert.ok(JSON.parse(ler('package.json')).build.files.includes('novidades.js'));
  const html = ler('index.html');
  assert.ok(html.includes('./novidades.js'));
  assert.ok(html.indexOf('novidades.js') < html.indexOf('estrivisor-app.js'));
});

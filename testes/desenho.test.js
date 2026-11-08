const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../desenho');

const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

test('mensagem: ida e volta e rejeita lixo', () => {
  const m = D.criarMensagem({ alvo: 'ana', origem: 'tela', modo: 'livre', id: 'abc', pontos: [0.1, 0.2, 0.3, 0.4] });
  assert.deepEqual(D.lerMensagem(m), { alvo: 'ana', origem: 'tela', modo: 'livre', id: 'abc', pontos: [0.1, 0.2, 0.3, 0.4] });
  assert.deepEqual(D.lerMensagem(D.criarMensagem({ alvo: 'ana', origem: 'tela', modo: 'limpar', id: '', pontos: [] })).modo, 'limpar');
  const ok = { v: 1, alvo: 'ana', origem: 'tela', modo: 'livre', id: 'x', p: [0.5, 0.5] };
  const ruins = [
    null, 5, '', '{', 'x'.repeat(3000),
    { ...ok, v: 2 }, { ...ok, alvo: '' }, { ...ok, alvo: 'a'.repeat(200) }, { ...ok, origem: 'tudo' }, { ...ok, modo: 'apagar-tudo' },
    { ...ok, id: 'i'.repeat(30) }, { ...ok, p: [0.5] }, { ...ok, p: [0.5, 1.5] }, { ...ok, p: [0.5, -0.1] }, { ...ok, p: [0.5, 'a'] },
    { ...ok, p: [] }, { ...ok, id: '' }, { ...ok, p: new Array(400).fill(0.5) }, { ...ok, p: [0.5, null] }
  ];
  for (const r of ruins) assert.equal(D.lerMensagem(typeof r === 'object' && r !== null ? JSON.stringify(r) : r), null, JSON.stringify(r).slice(0, 40));
});

test('retângulo da imagem: sobram faixas pretas dos lados ou em cima/embaixo', () => {
  // quadro 1000x500 com vídeo 16:9 (cabe pela altura): 888,9 de largura
  const r = D.retanguloDaImagem(1000, 500, 1920, 1080);
  assert.ok(Math.abs(r.h - 500) < 0.01 && Math.abs(r.w - 888.89) < 0.1 && Math.abs(r.x - 55.55) < 0.1 && r.y === 0);
  // quadro alto: sobra em cima e embaixo
  const s = D.retanguloDaImagem(800, 800, 1920, 1080);
  assert.ok(Math.abs(s.w - 800) < 0.01 && Math.abs(s.h - 450) < 0.01 && Math.abs(s.y - 175) < 0.01);
  // sem tamanho do vídeo ainda: usa o quadro todo; quadro vazio: zero
  assert.deepEqual(D.retanguloDaImagem(300, 200, 0, 0), { x: 0, y: 0, w: 300, h: 200 });
  assert.deepEqual(D.retanguloDaImagem(0, 0, 10, 10), { x: 0, y: 0, w: 0, h: 0 });
});

test('conversão de posição ida e volta, em tamanhos diferentes', () => {
  const r1 = D.retanguloDaImagem(1000, 500, 1920, 1080), r2 = D.retanguloDaImagem(400, 300, 1920, 1080);
  const [nx, ny] = D.paraNormalizado(500, 250, r1);
  assert.ok(Math.abs(nx - 0.5) < 1e-6 && Math.abs(ny - 0.5) < 1e-6);
  const [px, py] = D.paraPixels(nx, ny, r2);
  assert.ok(Math.abs(px - 200) < 0.01 && Math.abs(py - 150) < 0.01);
});

test('cor do autor é sempre a mesma e é uma cor válida', () => {
  assert.equal(D.corDoAutor('ana'), D.corDoAutor('ana'));
  assert.notEqual(D.corDoAutor('ana'), D.corDoAutor('beto'));
  assert.match(D.corDoAutor('x'), /^hsl\(\d{1,3}, 92%, 62%\)$/);
});

test('traços: aparecem, desvanecem e somem sozinhos', () => {
  const r = D.criarRegistro();
  r.adicionar('ana', 'tela', 'beto', 'livre', 't1', [0.1, 0.1, 0.2, 0.2], 1000);
  r.adicionar('ana', 'tela', 'beto', 'livre', 't1', [0.3, 0.3], 1100);
  let a = r.ativos('ana', 'tela', 2000);
  assert.equal(a.length, 1);
  assert.equal(a[0].pontos.length, 6);
  assert.equal(a[0].alfa, 1);
  a = r.ativos('ana', 'tela', 1100 + D.VIDA_MS - 750);
  assert.ok(a[0].alfa > 0.4 && a[0].alfa < 0.6, 'alfa ' + a[0].alfa);
  assert.equal(r.ativos('ana', 'tela', 1100 + D.VIDA_MS).length, 0);
  assert.equal(r.temAlgo(), false);
});

test('seta guarda só o começo e o fim; limpar tira só os traços do autor', () => {
  const r = D.criarRegistro();
  r.adicionar('ana', 'tela', 'beto', 'seta', 's1', [0.1, 0.1, 0.5, 0.5], 0);
  r.adicionar('ana', 'tela', 'beto', 'seta', 's1', [0.1, 0.1, 0.9, 0.9], 10);
  assert.deepEqual(r.ativos('ana', 'tela', 20)[0].pontos, [0.1, 0.1, 0.9, 0.9]);
  r.adicionar('ana', 'tela', 'zeca', 'livre', 'z1', [0.2, 0.2], 20);
  r.limpar('ana', 'tela', 'beto');
  const a = r.ativos('ana', 'tela', 30);
  assert.equal(a.length, 1);
  assert.equal(a[0].autor, 'zeca');
  r.removerAutor('zeca');
  assert.equal(r.ativos('ana', 'tela', 40).length, 0);
});

test('limites: traços por autor, pontos por traço e autores', () => {
  const r = D.criarRegistro();
  for (let i = 0; i < 60; i++) r.adicionar('a', 'tela', 'x', 'livre', 'id' + i, [0.1, 0.1], i);
  assert.equal(r.ativos('a', 'tela', 100).length, 40);
  const grande = new Array(3200).fill(0.5); // 1600 pontos
  assert.equal(r.adicionar('a', 'tela', 'y', 'livre', 'g', grande, 0), false);
  for (let i = 0; i < 25; i++) r.adicionar('b', 'tela', 'autor' + i, 'livre', 'k', [0.1, 0.1], 0);
  assert.equal(new Set(r.ativos('b', 'tela', 1).map((t) => t.autor)).size, 20);
});

test('desenho.js está no instalador e carregado antes do app', () => {
  assert.ok(JSON.parse(ler('package.json')).build.files.includes('desenho.js'));
  const html = ler('index.html');
  assert.ok(html.includes('./desenho.js'));
  assert.ok(html.indexOf('desenho.js') < html.indexOf('estrivisor-app.js'));
});

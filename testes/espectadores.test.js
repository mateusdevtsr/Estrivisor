const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const X = require('../espectadores');

const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

test('mensagem: ida e volta e rejeita lixo', () => {
  assert.deepEqual(X.lerMensagem(X.criarMensagem('entrou', 'tela')), { acao: 'entrou', origem: 'tela' });
  assert.deepEqual(X.lerMensagem(X.criarMensagem('saiu', 'camera')), { acao: 'saiu', origem: 'camera' });
  assert.deepEqual(X.lerMensagem(X.criarMensagem('qualquer', 'x')), { acao: 'entrou', origem: 'tela' });
  for (const ruim of [null, undefined, 5, '', '{', '[]', 'x'.repeat(300), JSON.stringify({ v: 2, acao: 'entrou', origem: 'tela' }), JSON.stringify({ v: 1, acao: 'hackear', origem: 'tela' }), JSON.stringify({ v: 1, acao: 'entrou', origem: 'tudo' })]) {
    assert.equal(X.lerMensagem(ruim), null, String(ruim).slice(0, 20));
  }
});

test('registro: entra, sai, vários tipos de transmissão da mesma pessoa e saída da sala', () => {
  const r = X.criarRegistro();
  r.entrou('a', 'Andy', 'tela'); r.entrou('b', 'Ana', 'tela'); r.entrou('a', 'Andy', 'camera');
  assert.equal(r.total(), 2);
  assert.deepEqual(r.nomes(), ['Ana', 'Andy']);
  r.saiu('a', 'tela');
  assert.equal(r.total(), 2, 'Andy ainda vê a câmera');
  r.saiu('a', 'camera');
  assert.deepEqual(r.nomes(), ['Ana']);
  r.removerPessoa('b');
  assert.equal(r.total(), 0);
  r.saiu('fantasma', 'tela'); // não quebra
  r.entrou('c', 'x'.repeat(200), 'tela');
  assert.equal(r.nomes()[0].length, 40);
  r.limpar();
  assert.equal(r.total(), 0);
});

test('registro tem limite de pessoas', () => {
  const r = X.criarRegistro();
  for (let i = 0; i < 80; i++) r.entrou('p' + i, 'P' + i, 'tela');
  assert.equal(r.total(), 50);
});

test('resumo do selo', () => {
  assert.equal(X.resumo([]), '');
  assert.equal(X.resumo(['Andy']), 'Andy');
  assert.equal(X.resumo(['Ana', 'Andy']), 'Ana e Andy');
  assert.equal(X.resumo(['Ana', 'Andy', 'Zeca', 'Bia']), 'Ana, Andy e +2');
});

test('espectadores.js está no instalador e carregado antes do app', () => {
  assert.ok(JSON.parse(ler('package.json')).build.files.includes('espectadores.js'));
  const html = ler('index.html');
  assert.ok(html.includes('./espectadores.js'));
  assert.ok(html.indexOf('espectadores.js') < html.indexOf('estrivisor-app.js'));
});

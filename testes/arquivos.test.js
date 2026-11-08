const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../arquivos');

const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

test('nomeSeguro: tira pasta, caracteres proibidos e setas de inversão de texto', () => {
  assert.equal(A.nomeSeguro('C:\\Users\\x\\foto.png'), 'foto.png');
  assert.equal(A.nomeSeguro('../../etc/passwd'), 'passwd');
  assert.equal(A.nomeSeguro('a<b>:"c|d?e*.txt'), 'abcde.txt');
  assert.equal(A.nomeSeguro('foto\u202Egpj.exe'), 'fotogpj.exe');
  assert.equal(A.nomeSeguro('   ...  '), 'arquivo');
  assert.equal(A.nomeSeguro(''), 'arquivo');
  assert.equal(A.nomeSeguro(null), 'arquivo');
  assert.equal(A.nomeSeguro('nul.txt'), '_nul.txt');
  assert.equal(A.nomeSeguro('COM1'), '_COM1');
});

test('nomeSeguro: nome enorme é cortado mas guarda a extensão', () => {
  const n = A.nomeSeguro('a'.repeat(500) + '.mp4');
  assert.equal(n.length, 100);
  assert.ok(n.endsWith('.mp4'));
});

test('extensaoPerigosa pega programas, inclusive com extensão dupla', () => {
  for (const n of ['setup.exe', 'FOTO.JPG.EXE', 'x.bat', 'a.ps1', 'b.jar', 'c.lnk', 'd.scr', 'e.JS']) assert.ok(A.extensaoPerigosa(n), n);
  for (const n of ['foto.png', 'video.mp4', 'doc.pdf', 'sem-extensao', 'musica.mp3', 'save.zip']) assert.ok(!A.extensaoPerigosa(n), n);
});

test('formatarTamanho', () => {
  assert.equal(A.formatarTamanho(500), '500 B');
  assert.equal(A.formatarTamanho(1536), '1.5 KB');
  assert.equal(A.formatarTamanho(5 * 1024 * 1024), '5.0 MB');
  assert.equal(A.formatarTamanho(50 * 1024 * 1024), '50 MB');
  assert.equal(A.formatarTamanho(-1), '?');
  assert.equal(A.formatarTamanho('x'), '?');
});

test('oferta: ida e volta, e rejeita lixo, tamanho acima do limite e id falso', () => {
  const id = A.novoId();
  assert.match(id, /^[0-9a-f]{16}$/);
  const o = A.lerOferta(A.criarOferta({ id, nome: 'C:\\x\\foto.png', tamanho: 1234, tipo: 'image/png' }));
  assert.deepEqual(o, { id, nomeOriginal: 'C:\\x\\foto.png', nome: 'foto.png', tamanho: 1234, tipo: 'image/png' });
  assert.equal(A.lerOferta('lixo'), null);
  assert.equal(A.lerOferta(null), null);
  assert.equal(A.lerOferta('[]'), null);
  assert.equal(A.lerOferta('x'.repeat(3000)), null);
  assert.equal(A.lerOferta(A.criarOferta({ id, nome: 'a', tamanho: A.LIMITE_BYTES + 1 })), null);
  assert.equal(A.lerOferta(A.criarOferta({ id, nome: 'a', tamanho: -5 })), null);
  assert.equal(A.lerOferta(A.criarOferta({ id, nome: 'a', tamanho: 1.5 })), null);
  assert.equal(A.lerOferta(A.criarOferta({ id: '<script>', nome: 'a', tamanho: 5 })), null);
  assert.equal(A.lerOferta(JSON.stringify({ v: 2, id, nome: 'a', tamanho: 5 })), null);
  assert.equal(A.lerOferta(A.criarOferta({ id, nome: '', tamanho: 5 })), null);
});

test('resposta: ida e volta e validação', () => {
  const id = A.novoId();
  assert.deepEqual(A.lerResposta(A.criarResposta(id, true)), { id, aceito: true });
  assert.deepEqual(A.lerResposta(A.criarResposta(id, false)), { id, aceito: false });
  assert.equal(A.lerResposta(JSON.stringify({ v: 1, id, aceito: 'sim' })), null);
  assert.equal(A.lerResposta('{'), null);
  assert.equal(A.lerResposta(JSON.stringify({ v: 1, id: 'zz', aceito: true })), null);
});

test('problemaNoEnvio: vazio e grande demais', () => {
  assert.equal(A.problemaNoEnvio({ size: 10 }), null);
  assert.ok(A.problemaNoEnvio({ size: 0 }));
  assert.ok(A.problemaNoEnvio({ size: A.LIMITE_BYTES + 1 }));
  assert.ok(A.problemaNoEnvio(null));
});

test('arquivos.js está no instalador e carregado antes do app', () => {
  const pkg = JSON.parse(ler('package.json'));
  assert.ok(pkg.build.files.includes('arquivos.js'));
  const html = ler('index.html');
  assert.ok(html.includes('./arquivos.js'));
  assert.ok(html.indexOf('arquivos.js') < html.indexOf('estrivisor-app.js'));
});

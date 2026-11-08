'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../somboard');

test('arquivo: formato, tamanho e duração', () => {
  assert.strictEqual(S.problemaNoArquivo({ nome: 'buzina.mp3', tamanho: 50000 }, 2), '');
  assert.match(S.problemaNoArquivo({ nome: 'x.wav', tamanho: 1000 }, 1), /mp3/);
  assert.match(S.problemaNoArquivo({ nome: 'x.exe', tamanho: 1000 }, 1), /Formato/);
  assert.match(S.problemaNoArquivo({ nome: 'sem-extensao', tamanho: 1000 }, 1), /Formato/);
  assert.match(S.problemaNoArquivo({ nome: 'a.mp3', tamanho: 200 * 1024 }, 1), /140 KB/);
  assert.match(S.problemaNoArquivo({ nome: 'a.mp3', tamanho: 0 }, 1), /vazio/);
  assert.match(S.problemaNoArquivo({ nome: 'a.mp3', tamanho: 1000 }, 9.5), /6 segundos/);
  assert.match(S.problemaNoArquivo({ nome: 'a.mp3', tamanho: 1000 }, 0), /ler o áudio/);
  assert.strictEqual(S.problemaNoArquivo({ nome: 'A.MP3', tamanho: 1000 }), '', 'sem duração ainda: só confere o resto');
});

test('nome sugerido a partir do arquivo', () => {
  assert.strictEqual(S.nomeSugerido('que_buzina-feia.mp3'), 'que buzina feia');
  assert.strictEqual(S.nomeSugerido('x'.repeat(60) + '.mp3').length, 24);
  assert.strictEqual(S.nomeSugerido(''), '');
});

test('lista vinda do servidor é conferida', () => {
  const l = S.validarLista({ sons: [{ id: 'abcdef012345', nome: 'Buzina‮', por: 'discord:1', porNome: 'Ana', segundos: 99 }, { id: '../x', nome: 'ruim' }, null, { id: 'abcdef012346', nome: '' }] });
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].nome, 'Buzina'); assert.strictEqual(l[0].segundos, 6);
  assert.deepStrictEqual(S.validarLista(null), []);
});

test('base64 ida e volta com arquivo grande', () => {
  const b = new Uint8Array(100000).map((_, i) => (i * 7) % 256);
  const volta = S.deBase64(S.paraBase64(b));
  assert.strictEqual(volta.length, b.length);
  assert.ok(volta.every((v, i) => v === b[i]));
});

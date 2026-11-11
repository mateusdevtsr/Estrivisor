'use strict';
const test = require('node:test');
const assert = require('node:assert');
const I = require('../imagens');

const u8 = (...b) => Uint8Array.from([...b, ...new Array(20).fill(0)]);

test('formato pelo conteúdo', () => {
  assert.strictEqual(I.tipoPorBytes(u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.strictEqual(I.tipoPorBytes(u8(0xff, 0xd8, 0xff)), 'image/jpeg');
  assert.strictEqual(I.tipoPorBytes(Uint8Array.from([...Buffer.from('GIF89a'), ...new Array(20).fill(0)])), 'image/gif');
  assert.strictEqual(I.tipoPorBytes(Uint8Array.from([...Buffer.from('RIFF\0\0\0\0WEBPVP8 '), ...new Array(20).fill(0)])), 'image/webp');
  assert.strictEqual(I.tipoPorBytes(Uint8Array.from(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))), null);
  assert.strictEqual(I.tipoPorBytes(null), null);
});

test('redução mantém a proporção e não amplia', () => {
  assert.deepStrictEqual(I.dimensoesAlvo(3840, 2160, 1920), { w: 1920, h: 1080, mudou: true });
  assert.deepStrictEqual(I.dimensoesAlvo(1000, 500), { w: 1000, h: 500, mudou: false });
  assert.deepStrictEqual(I.dimensoesAlvo(1000, 4000, 2000), { w: 500, h: 2000, mudou: true });
  assert.strictEqual(I.dimensoesAlvo(0, 10).mudou, false);
});

test('quando refazer: GIF nunca; o resto só se pesado ou enorme', () => {
  assert.strictEqual(I.deveReencodar({ tipo: 'image/gif', bytes: 5e6, w: 5000, h: 5000 }), false);
  assert.strictEqual(I.deveReencodar({ tipo: 'image/png', bytes: 300e3, w: 800, h: 600 }), false);
  assert.strictEqual(I.deveReencodar({ tipo: 'image/png', bytes: 3e6, w: 1920, h: 1080 }), true);
  assert.strictEqual(I.deveReencodar({ tipo: 'image/jpeg', bytes: 400e3, w: 4000, h: 3000 }), true);
});

test('tamanho, nome e caixa de exibição', () => {
  assert.strictEqual(I.formatarTamanho(900), '900 B');
  assert.strictEqual(I.formatarTamanho(20 * 1024), '20 KB');
  assert.strictEqual(I.formatarTamanho(2.5 * 1024 * 1024), '2,5 MB');
  assert.strictEqual(I.nomeDoArquivo('image/png', '../../evil.exe'), 'evil.png');
  assert.strictEqual(I.nomeDoArquivo('image/gif', 'meu gif.gif'), 'meu gif.gif');
  assert.deepStrictEqual(I.caixaDeExibicao(1920, 1080, 420, 320), { w: 420, h: 236 });
  assert.deepStrictEqual(I.caixaDeExibicao(100, 50), { w: 100, h: 50 });
  assert.strictEqual(I.caixaDeExibicao(null, 5), null);
});

test('o que vem do servidor é conferido', () => {
  assert.deepStrictEqual(I.imagemRecebida({ tipo: 'image/png', bytes: 10, w: 5, h: 6 }), { tipo: 'image/png', bytes: 10, w: 5, h: 6 });
  assert.strictEqual(I.imagemRecebida({ tipo: 'image/svg+xml', bytes: 10 }), null);
  assert.strictEqual(I.imagemRecebida({ tipo: 'image/png', bytes: 1, w: -4, h: 'x' }).w, null);
  assert.strictEqual(I.imagemRecebida('x'), null);
});

test('colar: imagem sozinha vale; com texto junto, vale o texto', () => {
  const arq = { kind: 'file', type: 'image/png' };
  assert.strictEqual(I.escolherImagemColada([arq]), arq);
  assert.strictEqual(I.escolherImagemColada([{ kind: 'string', type: 'text/html' }, arq]), arq);
  assert.strictEqual(I.escolherImagemColada([{ kind: 'string', type: 'text/plain' }, arq]), null);
  assert.strictEqual(I.escolherImagemColada([{ kind: 'file', type: 'application/pdf' }]), null);
  assert.strictEqual(I.escolherImagemColada(null), null);
});

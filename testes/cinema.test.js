'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../cinema');

test('mensagens: ida e volta e rejeita lixo', () => {
  const id = C.novoId();
  const o = C.lerMensagem(C.criarMensagem('oferta', { id, nome: 'filme\\legal‮.mp4', tamanho: 123456, duracao: 5432.123 }));
  assert.deepStrictEqual(o, { t: 'oferta', id, nome: 'filme legal .mp4', tamanho: 123456, duracao: 5432.1 });
  assert.deepStrictEqual(C.lerMensagem(C.criarMensagem('estado', { id, pos: 12.3456, tocando: true })), { t: 'estado', id, pos: 12.35, tocando: true });
  assert.deepStrictEqual(C.lerMensagem(C.criarMensagem('pronto', { id })), { t: 'pronto', id });
  assert.deepStrictEqual(C.lerMensagem(C.criarMensagem('fim', { id })), { t: 'fim', id });
  for (const lixo of [null, '', 'x', '{}', '[]', JSON.stringify({ v: 2, t: 'fim', id }), JSON.stringify({ v: 1, t: 'hack', id }), JSON.stringify({ v: 1, t: 'fim', id: '../../x' }),
    JSON.stringify({ v: 1, t: 'estado', id, pos: -1, tocando: true }), JSON.stringify({ v: 1, t: 'estado', id, pos: 5, tocando: 'sim' }), JSON.stringify({ v: 1, t: 'estado', id, pos: 1e9, tocando: true }),
    JSON.stringify({ v: 1, t: 'oferta', id, nome: '', tamanho: 5, duracao: 5 }), JSON.stringify({ v: 1, t: 'oferta', id, nome: 'a', tamanho: 1.5, duracao: 5 }), JSON.stringify({ v: 1, t: 'oferta', id, nome: 'a', tamanho: 5, duracao: 0 }), 'a'.repeat(700)]) {
    assert.strictEqual(C.lerMensagem(lixo), null, String(lixo).slice(0, 40));
  }
  assert.throws(() => C.criarMensagem('xx', {}));
});

test('extensões de vídeo', () => {
  assert.ok(C.extensaoOk('Filme.MP4')); assert.ok(C.extensaoOk('a.webm'));
  assert.ok(!C.extensaoOk('a.exe')); assert.ok(!C.extensaoOk('semextensao'));
});

test('arquivo precisa ser o mesmo: tamanho igual e duração parecida', () => {
  const o = { nome: 'filme.mp4', tamanho: 1000, duracao: 100 };
  assert.deepStrictEqual(C.arquivoCombina(o, { nome: 'filme.mp4', tamanho: 1000 }, 100.4), { ok: true, nomeDiferente: false });
  assert.deepStrictEqual(C.arquivoCombina(o, { nome: 'Outro Nome.mp4', tamanho: 1000 }, 100), { ok: true, nomeDiferente: true });
  assert.strictEqual(C.arquivoCombina(o, { nome: 'filme.mp4', tamanho: 999 }, 100).ok, false);
  assert.strictEqual(C.arquivoCombina(o, { nome: 'filme.mp4', tamanho: 1000 }, 103).ok, false);
  assert.strictEqual(C.arquivoCombina(o, { nome: 'filme.mp4', tamanho: 1000 }, NaN).ok, false);
});

test('ajuste: pausado, tocando em sincronia, pouco fora e muito fora', () => {
  // pausado: vai para a posição se estiver longe
  assert.deepStrictEqual(C.ajuste({ pos: 10, tocando: true }, { pos: 50, tocando: false }, 0), { seek: 50, tocando: false, taxa: 1 });
  assert.strictEqual(C.ajuste({ pos: 50.1, tocando: false }, { pos: 50, tocando: false }, 0).seek, null);
  // tocando: leva em conta o tempo desde que a mensagem chegou
  assert.strictEqual(C.ajuste({ pos: 12, tocando: true }, { pos: 10, tocando: true }, 2000).seek, null);
  assert.strictEqual(C.ajuste({ pos: 12, tocando: true }, { pos: 10, tocando: true }, 2000).taxa, 1);
  // atrasado um pouco: acelera de leve; adiantado um pouco: segura
  assert.strictEqual(C.ajuste({ pos: 11.5, tocando: true }, { pos: 12, tocando: true }, 0).taxa, 1.05);
  assert.strictEqual(C.ajuste({ pos: 12.6, tocando: true }, { pos: 12, tocando: true }, 0).taxa, 0.95);
  // muito fora: pula direto
  const r = C.ajuste({ pos: 5, tocando: true }, { pos: 60, tocando: true }, 1500);
  assert.strictEqual(r.seek, 61.5); assert.strictEqual(r.tocando, true);
  assert.strictEqual(C.ajuste({ pos: 5, tocando: true }, { pos: 60, tocando: true }, -50).seek, 60, 'relógio estranho não anda pra trás');
});

test('tempo em texto', () => {
  assert.strictEqual(C.formatarTempo(65), '1:05');
  assert.strictEqual(C.formatarTempo(3725), '1:02:05');
  assert.strictEqual(C.formatarTempo(-3), '0:00');
  assert.strictEqual(C.formatarTempo('x'), '0:00');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarConversas, MAX_TEXTO } = require('../conversas');

const nova = () => criarConversas({ log: { error() {} } });

test('mensagem mantém quebras de linha e tira caracteres perigosos', () => {
  const c = nova();
  const m = c.enviar('k', { usuario: 'u', nome: 'n', texto: 'oi\r\nlinha2‮​\u0007 fim\n\n\n\n\n\nx' });
  assert.strictEqual(m.texto, 'oi\nlinha2 fim\n\n\nx');
});

test('mensagem só com caracteres invisíveis é recusada', () => {
  const c = nova();
  assert.throws(() => c.enviar('k', { usuario: 'u', nome: 'n', texto: '​‮  ' }), /Escreva alguma coisa/);
});

test('mensagem é cortada no limite', () => {
  const c = nova();
  const m = c.enviar('k', { usuario: 'u', nome: 'n', texto: 'a'.repeat(MAX_TEXTO + 50) });
  assert.strictEqual(m.texto.length, MAX_TEXTO);
});

test('só quem escreveu edita; o dono do servidor pode apagar', () => {
  const c = nova();
  const m = c.enviar('k', { usuario: 'a', nome: 'A', texto: 'oi' });
  assert.throws(() => c.editar('k', m.seq, 'b', 'x'), /só pode editar/);
  assert.throws(() => c.apagar('k', m.seq, 'b'), /não pode apagar/);
  assert.doesNotThrow(() => c.apagar('k', m.seq, 'b', true));
});

test('exportarDe e apagarDe mexem só nas mensagens da pessoa', () => {
  const c = nova();
  c.enviar('k1', { usuario: 'a', nome: 'A', texto: 'a1' });
  c.enviar('k1', { usuario: 'b', nome: 'B', texto: 'b1' });
  c.enviar('k2', { usuario: 'a', nome: 'A', texto: 'a2' });
  const exp = c.exportarDe('a');
  assert.strictEqual(exp.reduce((n, x) => n + x.mensagens.length, 0), 2);
  assert.strictEqual(c.apagarDe('a'), 2);
  assert.strictEqual(c.listar('k1').mensagens.length, 1);
  assert.strictEqual(c.listar('k1').mensagens[0].texto, 'b1');
  assert.strictEqual(c.exportarDe('a').length, 0);
});

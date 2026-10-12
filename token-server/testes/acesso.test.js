'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarAcesso } = require('../acesso');

test('fila de pedidos cheia recusa, e libera vaga depois de 30 dias', () => {
  let t = 1_000_000_000_000;
  const a = criarAcesso({ agora: () => t, log: { error() {} } });
  for (let i = 0; i < 100; i++) assert.strictEqual(a.registrarPedido('discord:' + i, { nome: 'x' }), true);
  assert.strictEqual(a.registrarPedido('discord:999', { nome: 'y' }), false);
  t += 31 * 24 * 3600 * 1000;
  assert.strictEqual(a.registrarPedido('discord:999', { nome: 'y' }), true);
});

test('banido não vira pedido e apagar a conta não tira a punição', () => {
  const a = criarAcesso({ log: { error() {} } });
  a.punir('discord:1', { tipo: 'ban', motivo: 'teste' });
  assert.strictEqual(a.registrarPedido('discord:1', { nome: 'x' }), false);
  a.autorizarPorId('discord:2', 'Dois');
  a.apagarDe('discord:1');
  assert.strictEqual(a.situacao('discord:1').estado, 'banido');
  a.apagarDe('discord:2');
  assert.notStrictEqual(a.situacao('discord:2').estado, 'ok');
});

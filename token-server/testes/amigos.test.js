'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarAmigos } = require('../amigos');

test('apagarDe remove amizades, pedidos e cadastro da pessoa', () => {
  const a = criarAmigos({ log: { error() {} } });
  a.registrar('discord:1', { nome: 'Um' });
  a.registrar('discord:2', { nome: 'Dois' });
  a.registrar('discord:3', { nome: 'Tres' });
  a.pedir('discord:1', 'discord:2');
  a.aceitar('discord:2', 'discord:1');
  a.pedir('discord:3', 'discord:1');
  assert.strictEqual(a.saoAmigos('discord:1', 'discord:2'), true);
  assert.strictEqual(a.apagarDe('discord:1'), 1);
  assert.strictEqual(a.saoAmigos('discord:1', 'discord:2'), false);
  assert.strictEqual(a.listar('discord:3').enviados.length, 0);
  assert.strictEqual(a.existe('discord:1'), false);
});

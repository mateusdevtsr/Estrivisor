'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { salaLotada } = require('../lotacao');

const gente = (n) => Array.from({ length: n }, (_, i) => ({ identity: 'discord:' + i }));

test('sala com vaga deixa entrar, sala cheia barra', () => {
  assert.strictEqual(salaLotada(gente(9), 'discord:99', 10), false);
  assert.strictEqual(salaLotada(gente(10), 'discord:99', 10), true);
});

test('quem já está na sala pode voltar mesmo com ela cheia', () => {
  assert.strictEqual(salaLotada(gente(10), 'discord:3', 10), false);
});

test('limite 0 ou inválido = sem limite', () => {
  assert.strictEqual(salaLotada(gente(50), 'discord:99', 0), false);
  assert.strictEqual(salaLotada(gente(50), 'discord:99', NaN), false);
  assert.strictEqual(salaLotada(undefined, 'discord:99', 10), false);
});

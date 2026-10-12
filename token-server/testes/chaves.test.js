'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarChaves } = require('../chaves');

const nova = (agora) => criarChaves({ agora, log: { error() {} } });

test('padrão é 720p30 e chave sobe o nível só da conta que usou', () => {
  const c = nova();
  assert.strictEqual(c.nivelDe('a').nivel, 'livre');
  const [k] = c.gerar({ nivel: 'hd60', quantidade: 1 });
  c.resgatar('a', k.chave);
  assert.strictEqual(c.nivelDe('a').nivel, 'hd60');
  assert.strictEqual(c.nivelDe('b').nivel, 'livre');
  assert.throws(() => c.resgatar('b', k.chave), /inválida ou já usada/);
});

test('chave com validade vence', () => {
  let t = 1_000_000;
  const c = nova(() => t);
  const [k] = c.gerar({ nivel: 'hd30', validadeDias: 1 });
  c.resgatar('a', k.chave);
  assert.strictEqual(c.nivelDe('a').nivel, 'hd30');
  t += 2 * 24 * 3600 * 1000;
  assert.strictEqual(c.nivelDe('a').nivel, 'livre');
});

test('administrador tem sempre o nível máximo; apagarDe remove o nível', () => {
  const c = nova();
  assert.strictEqual(c.nivelDe('adm', true).nivel, 'max');
  const [k] = c.gerar({ nivel: 'max' });
  c.resgatar('a', k.chave);
  assert.strictEqual(c.apagarDe('a'), true);
  assert.strictEqual(c.nivelDe('a').nivel, 'livre');
});

test('chave errada tem sempre a mesma mensagem', () => {
  const c = nova();
  assert.throws(() => c.resgatar('a', 'lixo'), /inválida ou já usada/);
  assert.throws(() => c.resgatar('a', 'ESTR-AAAA-BBBB-CCCC'), /inválida ou já usada/);
});

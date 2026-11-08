'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../social');

test('a lista de reações é a mesma do servidor', (t) => {
  // Só confere se a cópia do servidor que está nesta pasta é a nova (a do PC pode ser antiga ou nem existir).
  const arquivo = path.join(__dirname, '..', 'token-server', 'conversas.js');
  if (!fs.existsSync(arquivo)) return t.skip('sem a pasta token-server aqui');
  const m = /EMOJIS_REACAO = (\[[^\]]+\])/.exec(fs.readFileSync(arquivo, 'utf8'));
  if (!m) return t.skip('token-server desta pasta é de uma versão antiga');
  assert.deepStrictEqual(eval(m[1]), S.EMOJIS_REACAO);
});

test('status: limpa caracteres estranhos e corta no limite', () => {
  assert.strictEqual(S.limparStatus('  jogando\n  wardogs‮ 🎮 '), 'jogando wardogs 🎮');
  assert.strictEqual(S.limparStatus('x'.repeat(100)).length, S.MAX_STATUS);
  assert.strictEqual(S.limparStatus(null), '');
});

test('resumo das reações marca as minhas e ignora lixo', () => {
  const r = S.resumoReacoes({ '🔥': ['a', 'b'], '👍': ['eu'], 'x': ['a'], '😂': 'oi' }, 'eu');
  assert.deepStrictEqual(r, [{ emoji: '👍', qtd: 1, minha: true }, { emoji: '🔥', qtd: 2, minha: false }]);
  assert.deepStrictEqual(S.resumoReacoes(undefined, 'eu'), []);
  assert.notStrictEqual(S.assinaturaReacoes({ '🔥': ['a'] }), S.assinaturaReacoes({ '🔥': ['a', 'b'] }));
});

test('primeiro link da mensagem', () => {
  assert.strictEqual(S.primeiroLink('olha isso https://exemplo.com/a?b=1, legal'), 'https://exemplo.com/a?b=1');
  assert.strictEqual(S.primeiroLink('sem link'), null);
  assert.strictEqual(S.primeiroLink('ftp://x.com e javascript:alert(1)'), null);
  assert.strictEqual(S.primeiroLink('https://user:senha@x.com/ depois https://ok.com'), 'https://ok.com');
});

test('prévia vinda do servidor é conferida', () => {
  assert.strictEqual(S.previaValida(null), null);
  assert.strictEqual(S.previaValida({ url: 'https://a.com' }), null);
  const p = S.previaValida({ url: 'https://a.com', titulo: 'T‮', descricao: 5, extra: 'x' });
  assert.deepStrictEqual(p, { url: 'https://a.com', dominio: '', titulo: 'T', descricao: '', site: '' });
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../perfil');

test('duração em texto', () => {
  assert.strictEqual(P.formatarDuracao(0), '0 s');
  assert.strictEqual(P.formatarDuracao(59), '59 s');
  assert.strictEqual(P.formatarDuracao(600), '10 min');
  assert.strictEqual(P.formatarDuracao(5400), '1 h 30 min');
  assert.strictEqual(P.formatarDuracao(90000), '25 h');
  assert.strictEqual(P.formatarDuracao(-5), '0 s');
  assert.strictEqual(P.formatarDuracao('abc'), '0 s');
});

test('períodos: mês atual, passado e ano (virada de janeiro)', () => {
  const nov = P.periodos(Date.parse('2026-11-07T18:00:00Z')).map((p) => p.id);
  assert.deepStrictEqual(nov, ['2026-11', '2026-10', '2026']);
  const jan = P.periodos(Date.parse('2027-01-10T18:00:00Z')).map((p) => p.id);
  assert.deepStrictEqual(jan, ['2027-01', '2026-12', '2027']);
  // 01:00 de 1º de dezembro em Brasília ainda é 30/nov em UTC-3? (02:00Z = 23:00 de 30/nov)
  assert.strictEqual(P.periodos(Date.parse('2026-12-01T02:00:00Z'))[0].id, '2026-11');
});

test('perfil vindo do servidor é conferido (texto puro, números sãos)', () => {
  assert.strictEqual(P.validarPerfil(null), null);
  const v = P.validarPerfil({
    perfil: { usuario: 'discord:1', nome: 'Ana‮<b>', avatar: 5, desde: 1, meu: true },
    numeros: { voz: -3, msgs: '12' },
    topJogos: [{ nome: 'Wardogs', s: 60 }, { nome: '', s: 1 }, null],
    conquistas: [{ id: 'x', icone: '🐣', titulo: 'T', desc: 'D', unidade: 'tempo', meta: 0, valor: 5, ganha: 1 }, { id: '' }],
  });
  assert.strictEqual(v.perfil.nome, 'Ana <b>'); assert.strictEqual(v.perfil.avatar, ''); assert.strictEqual(v.perfil.meu, true);
  assert.strictEqual(v.numeros.voz, 0); assert.strictEqual(v.numeros.msgs, 12);
  assert.deepStrictEqual(v.topJogos, [{ nome: 'Wardogs', s: 60 }]);
  assert.strictEqual(v.conquistas.length, 1); assert.strictEqual(v.conquistas[0].meta, 1); assert.strictEqual(v.conquistas[0].ganha, true);
});

test('resumo: manchetes só do que existe', () => {
  assert.strictEqual(P.validarResumo({}), null);
  const vazio = P.validarResumo({ resumo: { periodo: '2026-11' } });
  assert.deepStrictEqual(P.manchetes(vazio), []);
  const r = P.validarResumo({ resumo: { periodo: '2026-11', voz: 36000, tela: 3600, msgs: 1, reacoes: 5, diasAtivos: 3, melhorDia: { dia: '2026-11-06', voz: 7200 }, topJogos: [{ nome: 'Wardogs', s: 3600 }], topParceiros: [{ nome: 'Andy', s: 18000 }] } });
  const m = P.manchetes(r);
  assert.strictEqual(m[0].titulo, '10 h'); assert.match(m[0].texto, /5 filmes/);
  assert.ok(m.some((x) => x.titulo === '06/11'));
  assert.ok(m.some((x) => x.titulo === '1 mensagem'));
  assert.ok(m.some((x) => x.titulo === 'Andy'));
  assert.strictEqual(P.validarResumo({ resumo: { melhorDia: { dia: 'x' } } }).melhorDia, null);
});

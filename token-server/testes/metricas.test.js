'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarMetricas, diaDe, somarDias, compararVersoes } = require('../metricas');

const HORA = 3600 * 1000;
const DIA = 24 * HORA;
// 13/10/2026 12:00 em Brasília (15:00 UTC)
const T0 = Date.parse('2026-10-13T15:00:00Z');
const silencioso = { error() {} };

test('dia no horário de Brasília (23h de Brasília ainda é o mesmo dia)', () => {
  assert.strictEqual(diaDe(Date.parse('2026-10-14T02:30:00Z')), '2026-10-13');
  assert.strictEqual(diaDe(Date.parse('2026-10-14T03:30:00Z')), '2026-10-14');
  assert.strictEqual(somarDias('2026-10-01', -1), '2026-09-30');
  assert.ok(compararVersoes('3.10.0', '3.9.1') > 0);
  assert.ok(compararVersoes('3.9.1', '3.9.1') === 0);
});

test('conta pessoas diferentes em 1, 7 e 30 dias', () => {
  let t = T0;
  const m = criarMetricas({ agora: () => t, log: silencioso });
  m.atividade('discord:1'); m.atividade('discord:1'); m.atividade('discord:2');
  t += 3 * DIA; m.atividade('discord:1'); m.atividade('discord:3');
  t += 10 * DIA; m.atividade('discord:4');
  assert.strictEqual(m.pessoasDiferentes(1), 1);   // só o 4 hoje
  assert.strictEqual(m.pessoasDiferentes(7), 1);
  assert.strictEqual(m.pessoasDiferentes(30), 4);
  const s = m.serie(14);
  assert.strictEqual(s.length, 14);
  assert.strictEqual(s[0].ativos, 2);               // primeiro dia: 1 e 2
  assert.strictEqual(s[3].ativos, 2);               // 3 dias depois: 1 e 3
  assert.strictEqual(s[13].ativos, 1);
  assert.strictEqual(s[0].novos, 2);
  assert.strictEqual(s[3].novos, 1);                // o 3 é novo, o 1 não
});

test('ignora identificadores estranhos e versões mal escritas', () => {
  const m = criarMetricas({ agora: () => T0, log: silencioso });
  m.atividade('__proto__'); m.atividade('constructor'); m.atividade(''); m.atividade(123);
  m.atividade('discord:9', 'abc'); m.atividade('discord:8', '3.9.1');
  assert.strictEqual(m.pessoasDiferentes(1), 2);
  assert.deepStrictEqual(m.versoesEmUso(), [{ versao: '3.9.1', pessoas: 1 }]);
  assert.strictEqual(Object.prototype.polluted, undefined);
});

test('contadores, fotos por minuto, picos e minutos em chamada', () => {
  let t = T0;
  const m = criarMetricas({ agora: () => t, log: silencioso });
  m.contar('msgCanal'); m.contar('msgCanal'); m.contar('msgDm'); m.contar('inexistente'); m.contar('logins', -5);
  m.amostra({ online: 3, voz: 2, salas: 1, telas: 1, livekitOk: true, latencia: 40, requisicoes: 30, erros: 1 });
  t += 60000;
  m.amostra({ online: 5, voz: 4, salas: 2, telas: 0, livekitOk: false, requisicoes: 10 });
  const hoje = m.serie(1)[0];
  assert.strictEqual(hoje.msgCanal, 2);
  assert.strictEqual(hoje.msgDm, 1);
  assert.strictEqual(hoje.logins, 0);
  assert.strictEqual(hoje.picoOnline, 5);
  assert.strictEqual(hoje.picoVoz, 4);
  assert.strictEqual(hoje.minutosVoz, 6);
  assert.strictEqual(hoje.minutosTela, 1);
  assert.strictEqual(hoje.requisicoes, 40);
  assert.strictEqual(hoje.erros, 1);
  assert.strictEqual(hoje.falhasLivekit, 1);
  const a = m.amostrasRecentes(24);
  assert.strictEqual(a.length, 2);
  assert.strictEqual(a[1].livekitOk, false);
  assert.strictEqual(a[1].latencia, null);
});

test('guarda no máximo 24 h de fotos por minuto', () => {
  let t = T0;
  const m = criarMetricas({ agora: () => t, log: silencioso });
  for (let i = 0; i < 1500; i++) { m.amostra({ online: 1 }); t += 60000; }
  assert.ok(m.amostrasRecentes(48).length <= 1440);
});

test('versões em uso: só de quem apareceu nos últimos 30 dias, da mais nova pra mais velha', () => {
  let t = T0;
  const m = criarMetricas({ agora: () => t, log: silencioso });
  m.atividade('discord:1', '3.9.0');
  t += 40 * DIA;
  m.atividade('discord:2', '3.9.1'); m.atividade('discord:3', '3.10.0'); m.atividade('discord:4', '3.9.1');
  assert.deepStrictEqual(m.versoesEmUso(30), [{ versao: '3.10.0', pessoas: 1 }, { versao: '3.9.1', pessoas: 2 }]);
});

test('depois de 31 dias, sobra só o número de ativos do dia (não a lista)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'met-'));
  const arquivo = path.join(dir, 'metricas.json');
  let t = T0;
  const m = criarMetricas({ arquivo, agora: () => t, log: silencioso });
  m.atividade('discord:1'); m.atividade('discord:2');
  t += 40 * DIA;
  m.atividade('discord:3');
  m.gravarAgora();
  const salvo = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const diaAntigo = diaDe(T0);
  assert.strictEqual(salvo.dias[diaAntigo].nAtivos, 2);
  assert.strictEqual(salvo.dias[diaAntigo].ativos, undefined);
  assert.deepStrictEqual(salvo.dias[diaDe(t)].ativos, ['discord:3']);
  // e o número continua aparecendo na série
  const s = m.serie(41);
  assert.strictEqual(s[0].ativos, 2);
});

test('grava e lê de volta (inclusive quem esteve ativo hoje)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'met-'));
  const arquivo = path.join(dir, 'metricas.json');
  const m = criarMetricas({ arquivo, agora: () => T0, log: silencioso });
  m.atividade('discord:1', '3.9.1'); m.contar('logins'); m.amostra({ online: 2 }); m.registrarDownloads(120);
  m.gravarAgora();
  const m2 = criarMetricas({ arquivo, agora: () => T0 + HORA, log: silencioso });
  m2.atividade('discord:1');
  assert.strictEqual(m2.pessoasDiferentes(1), 1);
  const hoje = m2.serie(1)[0];
  assert.strictEqual(hoje.logins, 1);
  assert.strictEqual(hoje.downloadsTotal, 120);
  assert.strictEqual(hoje.novos, 1);
  assert.strictEqual(m2.amostrasRecentes(24).length, 1);
  assert.deepStrictEqual(m2.versoesEmUso(), [{ versao: '3.9.1', pessoas: 1 }]);
});

test('arquivo estragado: recomeça sem derrubar o servidor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'met-'));
  const arquivo = path.join(dir, 'metricas.json');
  fs.writeFileSync(arquivo, '{isso não é json');
  const m = criarMetricas({ arquivo, agora: () => T0, log: silencioso });
  m.atividade('discord:1');
  assert.strictEqual(m.pessoasDiferentes(1), 1);
});

test('primeira vez: quem já usava não conta como pessoa nova', () => {
  let t = T0;
  const m = criarMetricas({ agora: () => t, log: silencioso });
  assert.strictEqual(m.semear([{ usuario: 'discord:1', desde: T0 - 20 * DIA }, { usuario: 'discord:2' }, { usuario: 'lixo' }]), true);
  assert.strictEqual(m.semear([{ usuario: 'discord:5' }]), false); // só vale uma vez
  m.atividade('discord:1'); m.atividade('discord:2'); m.atividade('discord:3');
  const s = m.serie(30);
  assert.strictEqual(s[29].novos, 1);   // só o 3 é novo hoje
  assert.strictEqual(s[9].novos, 1);    // o 1 entrou há 20 dias
  assert.strictEqual(m.resumo(7).conhecidos, 3);
});

test('apagar a conta tira a pessoa das listas, mas os totais do dia ficam', () => {
  const m = criarMetricas({ agora: () => T0, log: silencioso });
  m.atividade('discord:1', '3.9.1'); m.atividade('discord:2'); m.contar('msgCanal', 3);
  assert.deepStrictEqual(m.dadosDe('discord:1'), { primeiroDiaDeUso: '2026-10-13', versaoDoAppUsada: '3.9.1', diasDeUsoNosUltimos31Dias: ['2026-10-13'] });
  assert.strictEqual(m.apagarDe('discord:1'), true);
  assert.deepStrictEqual(m.dadosDe('discord:1'), { primeiroDiaDeUso: null, versaoDoAppUsada: null, diasDeUsoNosUltimos31Dias: [] });
  assert.strictEqual(m.pessoasDiferentes(1), 1);
  assert.deepStrictEqual(m.versoesEmUso(), []);
  assert.strictEqual(m.serie(1)[0].msgCanal, 3);
  assert.strictEqual(m.resumo(1).conhecidos, 1);
});

test('downloads: guarda o total do dia (o último vale)', () => {
  let t = T0;
  const m = criarMetricas({ agora: () => t, log: silencioso });
  m.registrarDownloads(100); m.registrarDownloads(105);
  t += DIA; m.registrarDownloads(130);
  const s = m.serie(2);
  assert.strictEqual(s[0].downloadsTotal, 105);
  assert.strictEqual(s[1].downloadsTotal, 130);
});

test('dias antes do início da coleta vêm como "sem dado" (null), não como zero', () => {
  const m = criarMetricas({ agora: () => T0, log: silencioso });
  const s = m.serie(3);
  assert.strictEqual(s[0].coletado, false);
  assert.strictEqual(s[0].msgCanal, null);
  assert.strictEqual(s[0].ativos, null);
  assert.strictEqual(s[2].coletado, true);
  assert.strictEqual(s[2].msgCanal, 0);
});

test('erro dentro das estatísticas nunca chega no app (só vira uma linha no log)', () => {
  let t = T0;
  const avisos = [];
  const m = criarMetricas({ agora: () => t, log: { error: (...a) => avisos.push(a.join(' ')) } });
  t = NaN; // relógio quebrado: as contas de data falham por dentro
  assert.doesNotThrow(() => m.atividade('discord:1', '3.9.1'));
  assert.doesNotThrow(() => m.contar('msgCanal'));
  assert.doesNotThrow(() => m.amostra({ online: 1 }));
  assert.doesNotThrow(() => m.registrarDownloads(10));
  assert.ok(avisos.length >= 1 && avisos.length <= 2, 'avisos: ' + avisos.length);
  t = T0;
  m.atividade('discord:1');
  assert.strictEqual(m.pessoasDiferentes(1), 1);
});

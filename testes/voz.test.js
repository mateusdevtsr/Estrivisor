'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../voz');

const SR = 16000;
// Voz de mentira: harmônicos do tom com inclinação (tilt maior = mais abafada) e um silêncio no meio.
function voz(f0, tilt, seg = 6) {
  const n = SR * seg, x = new Float32Array(n);
  for (let k = 1; k * f0 < 7500; k++) {
    const amp = 1 / Math.pow(k, tilt);
    for (let i = 0; i < n; i++) x[i] += amp * Math.sin(2 * Math.PI * k * f0 * i / SR);
  }
  for (let i = 0; i < n; i++) { const t = i / SR; if (t > 2.5 && t < 3.2) x[i] = 0; x[i] *= 0.25; }
  return x;
}

test('mede o tom da voz com boa precisão', () => {
  for (const f of [100, 140, 220, 300]) {
    const a = V.analisar(voz(f, 1.2), SR);
    assert.ok(Math.abs(a.f0 - f) / f < 0.03, f + ' -> ' + a.f0);
    assert.ok(a.confiavel && a.vozSeg > 4, 'voz ' + a.vozSeg);
  }
});

test('silêncio e ruído não viram voz', () => {
  const quieto = V.analisar(new Float32Array(SR * 3), SR);
  assert.strictEqual(quieto.confiavel, false);
  const ruido = new Float32Array(SR * 3).map(() => (Math.random() - 0.5) * 0.3);
  assert.strictEqual(V.analisar(ruido, SR).confiavel, false);
});

test('voz mais brilhante tem mais agudo do que a abafada (curva sem o volume)', () => {
  const clara = V.analisar(voz(150, 0.6), SR), abafada = V.analisar(voz(150, 1.8), SR);
  const alta = (a) => a.bandas.slice(-5).reduce((s, v) => s + v, 0) / 5;
  assert.ok(alta(clara) > alta(abafada) + 6, alta(clara) + ' vs ' + alta(abafada));
  assert.ok(Math.abs(clara.bandas.reduce((s, v) => s + v, 0) / V.N_BANDAS) < 1e-6);
});

test('perfil: tom da voz alvo mais agudo dá fator > 1; timbre mais brilhante dá ganho positivo nos agudos', () => {
  const base = V.analisar(voz(120, 1.8), SR), alvo = V.analisar(voz(200, 0.6), SR);
  const p = V.criarPerfil(base, alvo);
  assert.ok(p.bruto > 1.5 && p.bruto < 1.8, 'bruto ' + p.bruto);
  assert.strictEqual(p.fator, 1.35, 'limitado ao natural');
  assert.ok(/limitei a mudança de tom/.test(V.resumo(base, alvo, p)));
  const agudos = p.bandas.filter((b) => b.f >= 3000);
  assert.ok(agudos.reduce((s, b) => s + b.g, 0) / agudos.length > 2, 'agudos');
  assert.ok(p.bandas.every((b) => Math.abs(b.g) <= V.GANHO_MAX_DB));
  assert.ok(/mais aguda/.test(V.resumo(base, alvo, p)));
});

test('vozes iguais quase não mudam nada', () => {
  const a = V.analisar(voz(150, 1.2), SR);
  const p = V.criarPerfil(a, a);
  assert.ok(Math.abs(p.fator - 1) < 0.001);
  assert.ok(p.bandas.every((b) => Math.abs(b.g) < 0.5));
});

test('combinar várias gravações dá mais peso a quem tem mais fala', () => {
  const longa = V.analisar(voz(180, 1.0, 8), SR), curta = V.analisar(voz(260, 1.0, 4), SR);
  const c = V.combinar([longa, curta]);
  assert.ok(c.vozSeg > longa.vozSeg && c.f0 > 150);
  assert.strictEqual(V.combinar([]), null);
});

test('perfil vindo de fora é conferido', () => {
  const base = V.analisar(voz(120, 1.8), SR), alvo = V.analisar(voz(200, 0.6), SR);
  const p = V.criarPerfil(base, alvo);
  assert.ok(V.perfilValido(JSON.parse(JSON.stringify(p))));
  assert.strictEqual(V.perfilValido({ fator: 1, bandas: [] }), null);
  assert.strictEqual(V.perfilValido(null), null);
  const ruim = JSON.parse(JSON.stringify(p)); ruim.bandas[3].g = 999; ruim.fator = 99;
  const ok = V.perfilValido(ruim);
  assert.ok(ok.bandas[3].g === V.GANHO_MAX_DB && ok.fator === 2);
  assert.strictEqual(V.criarPerfil(null, alvo), null);
});

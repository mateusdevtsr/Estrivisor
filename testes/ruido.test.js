const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const R = require('../ruido');
const { montar } = require('../ruido/montar');

const raiz = path.join(__dirname, '..');
const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

test('limiar da porta: conversão bate com a escala da barra do medidor', () => {
  assert.equal(R.picoParaPorcentagem(R.porcentagemParaPico(12)), 12);
  assert.equal(R.picoParaPorcentagem(R.porcentagemParaPico(100)), 100);
  assert.equal(R.porcentagemParaPico(-5), 0);
  assert.equal(R.porcentagemParaPico('lixo'), 0);
  assert.ok(R.porcentagemParaPico(14) > 0.099 && R.porcentagemParaPico(14) < 0.101);
});

test('limiarValido: lixo vira padrão e valores ficam entre 1 e 100', () => {
  assert.equal(R.limiarValido('x'), 12);
  assert.equal(R.limiarValido(undefined, 20), 20);
  assert.equal(R.limiarValido(0), 1);
  assert.equal(R.limiarValido(500), 100);
  assert.equal(R.limiarValido(33.6), 34);
});

test('pacote do filtro está atualizado (rode: node ruido/montar.js)', () => {
  assert.equal(ler('ruido/ruido-pacote.js'), montar(path.join(raiz, 'ruido')));
});

test('o pacote não depende de import/export (blob não resolve caminhos)', () => {
  const fonte = ler('ruido/ruido-pacote.js');
  const texto = JSON.parse(fonte.slice(fonte.indexOf('= ') + 2, fonte.lastIndexOf(';')));
  assert.ok(!/^\s*import\s/m.test(texto));
  assert.ok(!/^\s*export\s/m.test(texto));
  assert.ok(!texto.includes('import.meta'));
});

test('app instalado leva os arquivos do filtro e a página os carrega com a política de segurança certa', () => {
  const pkg = JSON.parse(ler('package.json'));
  for (const f of ['ruido.js', 'ruido/ruido-pacote.js']) assert.ok(pkg.build.files.includes(f), f);
  const html = ler('index.html');
  assert.ok(html.includes('./ruido/ruido-pacote.js') && html.includes('./ruido.js'));
  assert.ok(html.indexOf('ruido.js') < html.indexOf('estrivisor-app.js'));
  const csp = html.match(/Content-Security-Policy" content="([^"]*)"/)[1];
  const script = csp.split(';').map(s => s.trim()).find(s => s.startsWith('script-src'));
  assert.ok(script.includes('blob:') && script.includes("'wasm-unsafe-eval'"));
  assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"));
});

// Roda o processador de verdade (sem RNNoise) para testar a porta de ruído.
function criarProcessador() {
  let Classe = null;
  const ctx = {
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage() {}, onmessage: null }; } },
    registerProcessor: (_, c) => { Classe = c; },
    sampleRate: 48000, Float32Array, Math, Promise, Error, String,
    createRNNWasmModuleSync: () => ({ ready: new Promise(() => {}) }) // nunca fica pronto: só a porta é testada
  };
  const fonte = ler('ruido/ruido-worklet.js').replace("import criarModuloRnnoise from './rnnoise-sync.js';", 'const criarModuloRnnoise = createRNNWasmModuleSync;');
  vm.runInNewContext(fonte, ctx);
  return new Classe();
}
function bloco(amp) { return new Float32Array(128).fill(amp); }
function passar(p, amp, quantos) {
  let ultima = null;
  for (let i = 0; i < quantos; i++) { const s = new Float32Array(128); p.process([[bloco(amp)]], [[s]]); ultima = s; }
  return ultima[127];
}

test('porta de ruído: fecha no silêncio, abre na voz e segura um pouco depois', () => {
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: true, limiar: 0.1 } });
  assert.ok(Math.abs(passar(p, 0.5, 10) - 0.5) < 0.01, 'voz passa');
  assert.ok(passar(p, 0.01, 20) > 0.005, 'ainda segurando logo depois da fala (~53 ms)');
  assert.ok(passar(p, 0.01, 200) < 0.0001, 'depois de um tempo fecha');
  assert.ok(Math.abs(passar(p, 0.5, 5) - 0.5) < 0.01, 'reabre quando falar de novo');
});

test('porta desligada deixa tudo passar', () => {
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: false, limiar: 0.9 } });
  assert.ok(Math.abs(passar(p, 0.01, 300) - 0.01) < 1e-6);
});

test('efeitos de voz: lista e validação', () => {
  assert.deepEqual(Object.keys(R.EFEITOS), ['nenhum', 'robo', 'grave', 'agudo', 'radio', 'megafone', 'caverna', 'alien', 'demonio', 'agua', 'bebado']);
  assert.equal(R.efeitoValido('robo'), 'robo');
  assert.equal(R.efeitoValido('x'), 'nenhum');
  assert.equal(R.efeitoValido(undefined), 'nenhum');
  assert.equal(R.efeitoValido('__proto__'), 'nenhum');
});

// Passa uma senoide de 200 Hz pelo processador e mede a frequência que sai (cruzamentos por zero).
function frequenciaDeSaida(efeito) {
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: false, efeito } });
  const sr = 48000, total = sr; // 1 s
  const saida = new Float32Array(total);
  for (let i = 0; i < total; i += 128) {
    const ent = new Float32Array(128);
    for (let k = 0; k < 128; k++) ent[k] = 0.4 * Math.sin(2 * Math.PI * 200 * (i + k) / sr);
    const s = new Float32Array(128);
    p.process([[ent]], [[s]]);
    saida.set(s, i);
  }
  let cruz = 0;
  for (let i = Math.floor(sr * 0.3) + 1; i < total; i++) if (saida[i - 1] < 0 && saida[i] >= 0) cruz++;
  return { freq: cruz / 0.7, pico: Math.max(...saida.map(Math.abs)), saida };
}

test('efeito voz grossa baixa o tom e voz fina sobe o tom', () => {
  const normal = frequenciaDeSaida('nenhum').freq;
  const grave = frequenciaDeSaida('grave').freq;
  const agudo = frequenciaDeSaida('agudo').freq;
  assert.ok(Math.abs(normal - 200) < 6, 'normal ' + normal);
  assert.ok(grave > 135 && grave < 155, 'grave ' + grave);   // ~200 x 0,72
  assert.ok(agudo > 275 && agudo < 305, 'agudo ' + agudo);   // ~200 x 1,45
});

test('efeitos nunca estouram o volume', () => {
  for (const ef of ['robo', 'grave', 'agudo', 'radio', 'megafone', 'caverna', 'alien', 'demonio', 'agua', 'bebado']) assert.ok(frequenciaDeSaida(ef).pico <= 1, ef);
});

test('bêbado: o tom oscila (varia ao longo do tempo) e a voz continua audível', () => {
  const { saida } = frequenciaDeSaida('bebado');
  const sr = 48000;
  const freqs = [];
  for (let ini = Math.floor(sr * 0.2); ini + 4800 <= saida.length; ini += 4800) {
    let c = 0; for (let i = ini + 1; i < ini + 4800; i++) if (saida[i - 1] < 0 && saida[i] >= 0) c++;
    freqs.push(c / 0.1);
  }
  assert.ok(Math.max(...freqs) - Math.min(...freqs) > 12, 'oscilação ' + freqs.join(','));
  assert.ok(Math.max(...saida.slice(sr * 0.3 | 0).map(Math.abs)) > 0.1);
});

// Amplitude (pico) que sai quando entra uma senoide de "hz" com amplitude 0,3.
function amplitudeParaFrequencia(efeito, hz) {
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: false, efeito } });
  const sr = 48000, total = sr / 2;
  let pico = 0;
  for (let i = 0; i < total; i += 128) {
    const ent = new Float32Array(128);
    for (let k = 0; k < 128; k++) ent[k] = 0.3 * Math.sin(2 * Math.PI * hz * (i + k) / sr);
    const s = new Float32Array(128);
    p.process([[ent]], [[s]]);
    if (i > sr * 0.2) pico = Math.max(pico, ...s.map(Math.abs));
  }
  return pico;
}

test('rádio e megafone cortam graves; água corta agudos', () => {
  for (const ef of ['radio', 'megafone']) {
    const grave = amplitudeParaFrequencia(ef, 80), meio = amplitudeParaFrequencia(ef, 1200);
    assert.ok(grave < meio * 0.35, ef + ' grave ' + grave + ' meio ' + meio);
  }
  const med = amplitudeParaFrequencia('agua', 200), agudo = amplitudeParaFrequencia('agua', 5000);
  assert.ok(agudo < med * 0.12, 'agua ' + agudo + ' vs ' + med);
});

test('demônio fica bem mais grave que a voz normal', () => {
  const f = frequenciaDeSaida('demonio').freq;
  assert.ok(f > 95 && f < 130, 'demonio ' + f); // ~200 x 0,55
});

test('caverna continua soando depois da voz e some aos poucos', () => {
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: false, efeito: 'caverna' } });
  passar(p, 0.5, 40);
  let cedo = 0, tarde = 0;
  for (let b = 0; b < 1500; b++) {
    const s = new Float32Array(128);
    p.process([[new Float32Array(128)]], [[s]]);
    const pico = Math.max(...s.map(Math.abs));
    if (b >= 20 && b < 120) cedo = Math.max(cedo, pico);
    if (b >= 1300) tarde = Math.max(tarde, pico);
  }
  assert.ok(cedo > 0.02, 'cauda ' + cedo);
  assert.ok(tarde < cedo * 0.5, 'some ' + tarde + ' vs ' + cedo);
});

test('trocar de efeito não deixa lixo do anterior', () => {
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: false, efeito: 'caverna' } });
  passar(p, 0.5, 40);
  p.port.onmessage({ data: { efeito: 'nenhum' } });
  const s = new Float32Array(128);
  p.process([[new Float32Array(128)]], [[s]]);
  assert.ok(Math.max(...s.map(Math.abs)) === 0);
});

test('voz criada: id válido, perfil conferido e o efeito aplica tom e equalizador', () => {
  assert.equal(R.efeitoValido('voz:abc123xyz'), 'voz:abc123xyz');
  assert.equal(R.efeitoValido('voz:../x'), 'nenhum');
  assert.equal(R.efeitoValido('voz:'), 'nenhum');
  const bandas = Array.from({ length: 16 }, (_, i) => ({ f: Math.round(100 * Math.pow(70, i / 15)), g: 0 }));
  assert.ok(R.perfilDeVoz({ fator: 1, bandas }));
  assert.equal(R.perfilDeVoz({ fator: 1, bandas: bandas.slice(1) }), null);
  assert.equal(R.perfilDeVoz({ fator: NaN, bandas }), null);
  assert.equal(R.perfilDeVoz({ fator: 9, bandas: bandas.map((b) => ({ ...b, g: 99 })) }).bandas[0].g, 14);

  const com = (fator, ganho1k, hz) => {
    const p = criarProcessador();
    const b = bandas.map((x) => ({ f: x.f, g: Math.abs(x.f - 1000) < 200 ? ganho1k : 0 }));
    p.port.onmessage({ data: { rnnoise: false, porta: false, efeito: 'personalizado', perfil: { fator, bandas: b } } });
    const sr = 48000; let pico = 0; const saida = new Float32Array(128 * 188);
    for (let i = 0; i < saida.length; i += 128) {
      const ent = new Float32Array(128); for (let k = 0; k < 128; k++) ent[k] = 0.2 * Math.sin(2 * Math.PI * hz * (i + k) / sr);
      const s = new Float32Array(128); p.process([[ent]], [[s]]); saida.set(s, i);
    }
    let cruz = 0; for (let i = Math.floor(sr * 0.2) + 1; i < saida.length; i++) { if (saida[i - 1] < 0 && saida[i] >= 0) cruz++; pico = Math.max(pico, Math.abs(saida[i])); }
    return { freq: cruz / 0.3, pico };
  };
  const plano = com(1, 0, 200), grave = com(0.75, 0, 200);
  assert.ok(grave.freq > plano.freq * 0.65 && grave.freq < plano.freq * 0.85, 'tom ' + grave.freq + ' vs ' + plano.freq);
});

// Voz de mentira (harmônicos de f0) passada por um efeito; devolve o sinal de saída (48 kHz).
function passarVoz(efeito, perfil, f0, seg = 1.5) {
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: false, efeito, perfil } });
  const sr = 48000, total = 128 * Math.floor(sr * seg / 128), saida = new Float32Array(total);
  for (let i = 0; i < total; i += 128) {
    const ent = new Float32Array(128);
    for (let k = 0; k < 128; k++) { let v = 0; for (let h = 1; h * f0 < 6000; h++) v += Math.sin(2 * Math.PI * h * f0 * (i + k) / sr) / h; ent[k] = 0.25 * v; }
    const s = new Float32Array(128); p.process([[ent]], [[s]]); saida.set(s, i);
  }
  return saida;
}
function tomPorAutocorrelacao(x, ini, tam) {
  const sr = 48000; let melhor = 0, lagM = 0;
  for (let lag = Math.floor(sr / 500); lag < Math.floor(sr / 70); lag++) {
    let s = 0; for (let i = 0; i < tam; i++) s += x[ini + i] * x[ini + i + lag];
    if (s > melhor) { melhor = s; lagM = lag; }
  }
  return sr / lagM;
}
function oscilacaoDoVolume(x) { // (máx - mín) / média do volume em janelas de ~5 ms, depois do começo
  const j = 240, v = [];
  for (let ini = 48000 * 0.5; ini + j < x.length; ini += j) { let e = 0; for (let i = 0; i < j; i++) e += x[ini + i] * x[ini + i]; v.push(Math.sqrt(e / j)); }
  const media = v.reduce((a, b) => a + b, 0) / v.length;
  return (Math.max(...v) - Math.min(...v)) / media;
}
const PERFIL_PLANO = (fator) => ({ fator, bandas: Array.from({ length: 16 }, (_, i) => ({ f: Math.round(100 * Math.pow(70, i / 15)), g: 0 })) });

test('voz criada usa mudança de tom suave: tom certo e volume bem mais estável que o método simples', () => {
  for (const [fator, f0] of [[1.5, 120], [0.7, 200]]) {
    const x = passarVoz('personalizado', PERFIL_PLANO(fator), f0);
    const tom = tomPorAutocorrelacao(x, 48000, 4800);
    assert.ok(Math.abs(tom - f0 * fator) / (f0 * fator) < 0.04, `fator ${fator}: tom ${tom} esperado ${f0 * fator}`);
    assert.ok(Math.max(...x.map(Math.abs)) <= 1.0001 && Math.max(...x.slice(48000)) > 0.1, 'volume');
  }
  const novo = oscilacaoDoVolume(passarVoz('personalizado', PERFIL_PLANO(1.45), 120));
  const velho = oscilacaoDoVolume(passarVoz('agudo', undefined, 120));
  assert.ok(novo < velho * 0.6, `oscilação novo ${novo.toFixed(2)} vs velho ${velho.toFixed(2)}`);
});

test('voz criada com tom exagerado (efeito antigo) é limitada pra não virar "voz de gato"', () => {
  const bandas = Array.from({ length: 16 }, (_, i) => ({ f: Math.round(100 * Math.pow(70, i / 15)), g: 0 }));
  assert.equal(R.perfilDeVoz({ fator: 2, bandas }).fator, 1.45);
  assert.equal(R.perfilDeVoz({ fator: 0.5, bandas }).fator, 0.7);
  assert.equal(R.perfilDeVoz({ fator: 1.2, bandas }).fator, 1.2);
});

// ---- Efeito criado à mão: cada controle muda a voz, nada estoura e valores ruins são limitados ----
test('efeito à mão: validação do formato novo e compatibilidade com o antigo', () => {
  const p = R.perfilDeVoz({ versao: 2, tom: 30, graves: -99, distorcao: 'x', ecoAtraso: 5, volume: 999 });
  assert.equal(p.tom, 12); assert.equal(p.fator, 2); assert.equal(p.graves, -12);
  assert.equal(p.distorcao, 0); assert.equal(p.ecoAtraso, 50); assert.equal(p.volume, 200);
  assert.deepEqual(p.bandas, []);
  assert.equal(R.perfilDeVoz({ versao: 2, tom: -7 }).fator.toFixed(4), Math.pow(2, -7 / 12).toFixed(4));
  const antigo = R.perfilDeVoz(PERFIL_PLANO(1.2));
  assert.equal(antigo.versao, 1); assert.equal(antigo.distorcao, 0); assert.equal(antigo.volume, 100); assert.equal(antigo.bandas.length, 16);
  for (const nome of Object.keys(R.MODELOS_EFEITO)) assert.equal(R.perfilDoModelo(nome).versao, 2, nome);
  assert.equal(R.perfilDeVoz(null), null);
});

test('efeito à mão: cada controle muda o som, sem estourar nem gerar NaN', () => {
  const energia = (x) => { let e = 0; for (let i = 24000; i < x.length; i++) e += x[i] * x[i]; return Math.sqrt(e / (x.length - 24000)); };
  const neutro = passarVoz('personalizado', R.perfilDeVoz({ versao: 2 }), 150, 1);
  const base = energia(neutro);
  // neutro = passa a voz igual (sem tom, sem filtro)
  assert.ok(Math.abs(base - energia(passarVoz('nenhum', undefined, 150, 1))) / base < 0.05, 'neutro deveria soar igual');
  const casos = {
    tom: { tom: 5 }, graves: { graves: 12 }, agudos: { agudos: -12 }, cortaGraves: { cortaGraves: 900 }, cortaAgudos: { cortaAgudos: 900 },
    distorcao: { distorcao: 90 }, robo: { roboInt: 100 }, vibrato: { vibInt: 100, vibVel: 8 }, tremolo: { tremInt: 100, tremVel: 6 },
    eco: { ecoVol: 80, ecoRep: 60, ecoAtraso: 120 }, ambiente: { ambiente: 100 }, volume: { volume: 50 }
  };
  for (const [nome, ajustes] of Object.entries(casos)) {
    const x = passarVoz('personalizado', R.perfilDeVoz({ versao: 2, ...ajustes }), 150, 1);
    assert.ok(x.every(Number.isFinite), nome + ': NaN');
    assert.ok(Math.max(...x.map(Math.abs)) <= 1.0001, nome + ': estourou');
    let dif = 0; for (let i = 24000; i < x.length; i++) dif += (x[i] - neutro[i]) ** 2;
    assert.ok(Math.sqrt(dif / (x.length - 24000)) > base * 0.08, nome + ': não mudou nada');
  }
  // tudo no máximo ao mesmo tempo continua seguro
  const max = {}; for (const [k, v] of Object.entries(R.AJUSTES_EFEITO)) max[k] = v[1];
  const x = passarVoz('personalizado', R.perfilDeVoz({ versao: 2, ...max }), 150, 1);
  assert.ok(x.every(Number.isFinite) && Math.max(...x.map(Math.abs)) <= 1.0001);
});

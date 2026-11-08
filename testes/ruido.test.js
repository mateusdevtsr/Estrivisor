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
  assert.deepEqual(Object.keys(R.EFEITOS), ['nenhum', 'robo', 'grave', 'agudo', 'eco']);
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

test('efeitos nunca estouram o volume e o eco continua soando depois da voz', () => {
  for (const ef of ['robo', 'grave', 'agudo', 'eco']) assert.ok(frequenciaDeSaida(ef).pico <= 1, ef);
  const p = criarProcessador();
  p.port.onmessage({ data: { rnnoise: false, porta: false, efeito: 'eco' } });
  passar(p, 0.5, 40);                        // voz (~107 ms)
  let antes = 0, depois = 0;
  for (let b = 0; b < 160; b++) {            // silêncio depois da voz
    const s = new Float32Array(128);
    p.process([[new Float32Array(128)]], [[s]]);
    const pico = Math.max(...s.map(Math.abs));
    if (b < 60) antes = Math.max(antes, pico);       // antes do atraso do eco (280 ms): silêncio
    else if (b >= 70 && b < 100) depois = Math.max(depois, pico); // a repetição da voz chega aqui
  }
  assert.ok(antes < 0.001, 'antes ' + antes);
  assert.ok(depois > 0.1, 'eco ' + depois);
});

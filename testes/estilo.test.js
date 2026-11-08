const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../estilo');

test('padrão reproduz as cores atuais do app', () => {
  const p = E.estadoPadrao();
  assert.equal(p.cores.painel, '#14171b');
  assert.equal(p.cores.sinal, '#ff4d4d');
  const v = E.variaveis(p);
  assert.equal(v['--bg'], '#0b0d10');
  assert.equal(v['--raio'], '6px');
  assert.equal(v['--painel-rgb'], '20,23,27');
});

test('validar: lixo vira padrão', () => {
  for (const x of [null, undefined, 5, 'x', [], {}, { tema: 'inexistente' }, { fonte: '__proto__' }, { avatar: 'constructor' }]) {
    const e = E.validar(x);
    assert.equal(e.tema, 'padrao');
    assert.equal(e.fonte, 'padrao');
    assert.equal(e.avatar, 'circulo');
    assert.equal(e.raio, 6);
    assert.equal(e.zoom, 100);
  }
});

test('validar: limites de raio e zoom', () => {
  assert.equal(E.validar({ raio: 20 }).raio, 20);
  assert.equal(E.validar({ raio: 21 }).raio, 6);
  assert.equal(E.validar({ raio: -1 }).raio, 6);
  assert.equal(E.validar({ raio: '10' }).raio, 6);
  assert.equal(E.validar({ zoom: 150 }).zoom, 150);
  assert.equal(E.validar({ zoom: 79 }).zoom, 100);
  assert.equal(E.validar({ zoom: 1e9 }).zoom, 100);
  assert.equal(E.validar({ zoom: NaN }).zoom, 100);
});

test('validar: só aceita cores #rrggbb no tema personalizado', () => {
  const ruim = ['red', '#fff', '#12345', 'url(x)', '#gggggg', '#ffffff;background:red', 'javascript:1', 5, null, { a: 1 }];
  for (const c of ruim) {
    const e = E.validar({ tema: 'personalizado', cores: { sinal: c, bg: c, painel: c, texto: c } });
    assert.equal(e.cores.sinal, '#ff4d4d', String(c));
    assert.equal(e.cores.bg, '#0b0d10', String(c));
  }
  const ok = E.validar({ tema: 'personalizado', cores: { sinal: '#AABBCC' } });
  assert.equal(ok.cores.sinal, '#aabbcc');
  // fora do tema personalizado as cores guardadas são ignoradas (vale o tema)
  assert.equal(E.validar({ tema: 'roxo', cores: { sinal: '#000000' } }).cores.sinal, E.TEMAS.roxo.cores.sinal);
});

test('variáveis só têm valores seguros', () => {
  for (const id of Object.keys(E.TEMAS)) {
    const v = E.variaveis(E.validar({ tema: id, raio: 12, avatar: 'quadrado' }));
    for (const [k, val] of Object.entries(v)) {
      assert.match(k, /^--[a-z0-9-]+$/);
      assert.match(val, /^(#[0-9a-f]{6}|\d+,\d+,\d+|\d+px|\d+%)$/, k + '=' + val);
    }
  }
  for (const f of Object.values(E.FONTES)) assert.ok(!/[;{}<>]/.test(f.css));
});

test('derivar: cores calculadas ficam entre as bases e são válidas', () => {
  const d = E.derivar({ bg: '#000000', painel: '#101010', texto: '#ffffff', sinal: '#00ff00' });
  for (const k of E.CHAVES_COR) assert.match(d[k], /^#[0-9a-f]{6}$/, k);
  assert.equal(E.misturar('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(E.misturar('#123456', '#123456', 1), '#123456');
});

test('estilo.js está no instalador e carregado antes do app', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('estilo.js'));
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.indexOf('estilo.js') > 0 && html.indexOf('estilo.js') < html.indexOf('estrivisor-app.js'));
});

// Todo tema pronto precisa ser legível (contraste do texto, do texto fraco e da cor de destaque sobre o painel).
test('temas prontos têm contraste legível', () => {
  const lum = (h) => {
    const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  assert.ok(Object.keys(E.TEMAS).length >= 12);
  for (const [id, t] of Object.entries(E.TEMAS)) {
    const c = t.cores;
    for (const k of E.CHAVES_COR) assert.match(c[k], /^#[0-9a-f]{6}$/, id + ' ' + k);
    assert.ok(contraste(c.texto, c.painel) >= 7, id + ' texto');
    assert.ok(contraste(c.textoFraco, c.painel) >= 4.5, id + ' texto fraco');
    assert.ok(contraste(c.sinal, c.painel) >= 4.5, id + ' destaque');
  }
});

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('../areas');

test('arquivos: só tipos aceitos e até 30 MB', () => {
  for (const t of ['image/gif', 'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'video/mp4', 'video/webm']) {
    assert.equal(A.validarArquivo({ type: t, size: 1000 }).ok, true, t);
  }
  for (const t of ['image/svg+xml', 'text/html', 'application/javascript', 'video/x-matroska', '', undefined, 'image/gif; x=1']) {
    assert.equal(A.validarArquivo({ type: t, size: 1000 }).ok, false, String(t));
  }
  assert.equal(A.validarArquivo({ type: 'image/gif', size: A.MAX_BYTES }).ok, true);
  assert.equal(A.validarArquivo({ type: 'image/gif', size: A.MAX_BYTES + 1 }).ok, false);
  assert.equal(A.validarArquivo({ type: 'image/gif', size: 0 }).ok, false);
  assert.equal(A.validarArquivo({ type: 'image/gif', size: NaN }).ok, false);
  assert.equal(A.validarArquivo(null).ok, false);
});

test('ajustes: limites e valores conhecidos', () => {
  assert.deepEqual(A.validarAjustes({ escuro: 90, ajuste: 'fill' }), { escuro: 90, ajuste: 'fill' });
  assert.deepEqual(A.validarAjustes({ escuro: 91, ajuste: 'x' }), { escuro: 40, ajuste: 'cover' });
  assert.deepEqual(A.validarAjustes({ escuro: -5 }), { escuro: 40, ajuste: 'cover' });
  assert.equal(A.validarAjustes({ escuro: 33 }).escuro, 35);
  for (const x of [null, 5, 'a', [], { escuro: '50' }]) assert.deepEqual(A.validarAjustes(x), { escuro: 40, ajuste: 'cover' });
});

test('meta: só áreas conhecidas, tipos válidos, nome limpo', () => {
  const m = A.validarMeta({
    principal: { tipo: 'image/gif', nome: 'fundo\n<b>.gif' + 'x'.repeat(200), escuro: 20, ajuste: 'contain' },
    inventada: { tipo: 'image/gif', nome: 'x' },
    canais: { tipo: 'text/html', nome: 'x' },
    membros: 'lixo',
    __proto__: { voz: { tipo: 'image/gif' } },
  });
  assert.deepEqual(Object.keys(m), ['principal']);
  assert.ok(m.principal.nome.length <= 80);
  assert.ok(!/[\n\r]/.test(m.principal.nome));
  assert.equal(m.principal.escuro, 20);
  for (const x of [null, undefined, 5, 'x', []]) assert.deepEqual(A.validarMeta(x), {});
});

test('vídeo só para tipos de vídeo aceitos', () => {
  assert.equal(A.ehVideo('video/mp4'), true);
  assert.equal(A.ehVideo('video/avi'), false);
  assert.equal(A.ehVideo('image/gif'), false);
  assert.equal(A.ehVideo(null), false);
});

test('toda área tem seletor (ou é o fundo fixo) e o app só usa os ids certos', () => {
  const ids = new Set();
  for (const a of A.AREAS) {
    assert.ok(!ids.has(a.id)); ids.add(a.id);
    assert.ok(a.fixa === true || /^\.[a-z-]+$/.test(a.seletor), a.id);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const a of A.AREAS) if (a.seletor) assert.ok(html.includes('class="' + a.seletor.slice(1)) || html.includes(a.seletor.slice(1)), a.id);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('areas.js'));
  assert.ok(html.indexOf('areas.js') > 0 && html.indexOf('areas.js') < html.indexOf('estrivisor-app.js'));
});

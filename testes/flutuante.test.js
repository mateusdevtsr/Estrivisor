const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../flutuante');

test('estado que não é de uma sala vira vazio', () => {
  for (const x of [null, undefined, 5, 'x', [], {}, { naVoz: 'sim' }]) {
    const e = F.limparEstado(x);
    assert.equal(e.naVoz, false);
    assert.deepEqual(e.participantes, []);
  }
});

test('limpa textos, limita tamanhos e quantidade de pessoas', () => {
  const muitos = Array.from({ length: 30 }, (_, i) => ({ id: 'u' + i, nome: 'Pessoa ' + i }));
  const e = F.limparEstado({ naVoz: true, canal: 'Sala\n<b>x</b>' + 'a'.repeat(100), participantes: muitos, total: 30, microfone: true });
  assert.equal(e.participantes.length, F.MAX_PESSOAS);
  assert.ok(e.canal.length <= 40);
  assert.ok(!/[\n\r]/.test(e.canal));
  assert.equal(e.total, 30);
  assert.equal(e.microfone, true);
  assert.equal(e.surdo, false);
});

test('campos com tipo errado não passam', () => {
  const e = F.limparEstado({ naVoz: true, total: 'muitos', participantes: [null, 3, { nome: { a: 1 }, falando: 'sim', mic: 1, avatar: { x: 1 } }, { nome: '', mic: true }] });
  assert.equal(e.participantes.length, 2);
  assert.equal(e.participantes[0].falando, false);
  assert.equal(e.participantes[0].mic, false);
  assert.equal(e.participantes[0].avatar, '');
  assert.equal(e.participantes[1].nome, '?');
  assert.equal(e.total, 2);
});

test('avatar: só https do cdn do Discord', () => {
  assert.ok(F.urlAvatar('https://cdn.discordapp.com/avatars/1/a.png?size=64'));
  for (const u of ['http://cdn.discordapp.com/a.png', 'https://evil.com/a.png', 'https://cdn.discordapp.com.evil.com/a.png', 'https://u:p@cdn.discordapp.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 5, null, 'https://cdn.discordapp.com/' + 'a'.repeat(400)]) {
    assert.equal(F.urlAvatar(u), '', String(u));
  }
});

test('só aceita os três comandos', () => {
  for (const c of ['mic', 'surdo', 'sair']) assert.equal(F.comandoValido(c), true);
  for (const c of ['', 'MIC', 'eval', '__proto__', 'constructor', null, undefined, 1, {}, ['mic']]) assert.equal(F.comandoValido(c), false);
});

test('altura cresce com a lista e tem limites', () => {
  assert.equal(F.alturaDaJanela(0), F.alturaDaJanela(1));
  assert.ok(F.alturaDaJanela(5) > F.alturaDaJanela(2));
  assert.equal(F.alturaDaJanela(500), F.alturaDaJanela(F.MAX_PESSOAS));
  assert.equal(F.alturaDaJanela('abc'), F.alturaDaJanela(1));
});

test('posição guardada só vale se aparece em algum monitor', () => {
  const areas = [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: 1920, y: 0, width: 1280, height: 1024 }];
  assert.deepEqual(F.posicaoValida({ x: 100, y: 50 }, areas), { x: 100, y: 50 });
  assert.deepEqual(F.posicaoValida({ x: 2000, y: 10 }, areas), { x: 2000, y: 10 });
  assert.equal(F.posicaoValida({ x: 5000, y: 50 }, areas), null); // monitor desligado
  assert.equal(F.posicaoValida({ x: -900, y: 50 }, areas), null);
  assert.equal(F.posicaoValida({ x: 100, y: 5000 }, areas), null);
  assert.equal(F.posicaoValida({ x: NaN, y: 1 }, areas), null);
  assert.equal(F.posicaoValida(null, areas), null);
  assert.equal(F.posicaoValida({ x: 1, y: 1 }, []), null);
});

test('posição padrão fica no canto de cima à direita', () => {
  const p = F.posicaoPadrao({ x: 0, y: 0, width: 1920, height: 1040 });
  assert.equal(p.x, 1920 - F.LARGURA - 20);
  assert.equal(p.y, 20);
});

test('grava e lê a posição; arquivo ruim é ignorado', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'flut-'));
  assert.equal(F.lerPosicao(pasta), null);
  F.gravarPosicao(pasta, { x: 10.4, y: 20.6 });
  assert.deepEqual(F.lerPosicao(pasta), { x: 10, y: 21 });
  F.gravarPosicao(pasta, { x: 'a', y: 1 }); // não sobrescreve com lixo
  assert.deepEqual(F.lerPosicao(pasta), { x: 10, y: 21 });
  fs.writeFileSync(path.join(pasta, 'flutuante.json'), '{lixo');
  assert.equal(F.lerPosicao(pasta), null);
  fs.rmSync(pasta, { recursive: true });
});

test('configuração: flutuanteAtiva começa desligada e só aceita verdadeiro/falso', () => {
  const C = require('../configuracao');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  assert.equal(C.lerConfiguracao(pasta).flutuanteAtiva, false);
  assert.equal(C.salvarConfiguracao(pasta, { flutuanteAtiva: 'sim' }).flutuanteAtiva, false);
  assert.equal(C.salvarConfiguracao(pasta, { flutuanteAtiva: true }).flutuanteAtiva, true);
  assert.equal(C.lerConfiguracao(pasta).flutuanteAtiva, true);
  fs.rmSync(pasta, { recursive: true });
});

test('páginas da janela flutuante: CSP fechada, sem script inline e sem innerHTML', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'flutuante.html'), 'utf8');
  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'script inline');
  assert.ok(!/\son\w+\s*=/i.test(html), 'handler inline');
  const tela = fs.readFileSync(path.join(__dirname, '..', 'flutuante-tela.js'), 'utf8');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function/.test(tela));
});

test('arquivos novos estão na lista do instalador', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const f of ['flutuante.js', 'flutuante.html', 'flutuante.css', 'flutuante-tela.js', 'preload-flutuante.js']) {
    assert.ok(pkg.build.files.includes(f), f);
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), f);
  }
});

test('limitarAArea mantém a janela inteira dentro da tela', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const L = F.LARGURA, A = 200;
  assert.deepEqual(F.limitarAArea({ x: 100, y: 100 }, L, A, area), { x: 100, y: 100 });
  assert.deepEqual(F.limitarAArea({ x: -50, y: -30 }, L, A, area), { x: 0, y: 0 });
  assert.deepEqual(F.limitarAArea({ x: 5000, y: 5000 }, L, A, area), { x: 1920 - L, y: 1040 - A });
  assert.deepEqual(F.limitarAArea({ x: 1900, y: 1000 }, L, A, area), { x: 1920 - L, y: 1040 - A });
  // segundo monitor com origem deslocada
  const m2 = { x: 1920, y: -200, width: 1280, height: 1024 };
  assert.deepEqual(F.limitarAArea({ x: 1000, y: 0 }, L, A, m2), { x: 1920, y: 0 });
  // janela maior que a área: gruda no canto de cima
  assert.deepEqual(F.limitarAArea({ x: 50, y: 50 }, L, 2000, area), { x: 50, y: 0 });
});

test('opções da janela flutuante: só tipos e limites certos', () => {
  assert.deepEqual(F.limparOpcoes({ ativa: true, atalho: false, opacidade: 60 }), { flutuanteAtiva: true, flutuanteAtalho: false, flutuanteOpacidade: 60 });
  assert.deepEqual(F.limparOpcoes({ ativa: 'sim', atalho: 1, opacidade: '60' }), {});
  for (const o of [10, 29, 101, 55.5, NaN, Infinity, null, -5]) assert.deepEqual(F.limparOpcoes({ opacidade: o }), {}, String(o));
  assert.deepEqual(F.limparOpcoes({ opacidade: 30 }), { flutuanteOpacidade: 30 });
  assert.deepEqual(F.limparOpcoes({ opacidade: 100, extra: 'x', __proto__: { ativa: true } }), { flutuanteOpacidade: 100 });
  for (const o of [null, undefined, 'x', 5, []]) assert.deepEqual(F.limparOpcoes(o), {});
});

test('configuração: atalho liga por padrão, opacidade tem limite', () => {
  const C = require('../configuracao');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg2-'));
  let c = C.lerConfiguracao(pasta);
  assert.equal(c.flutuanteAtalho, true);
  assert.equal(c.flutuanteOpacidade, 100);
  assert.equal(C.salvarConfiguracao(pasta, { flutuanteOpacidade: 55 }).flutuanteOpacidade, 55);
  assert.equal(C.salvarConfiguracao(pasta, { flutuanteOpacidade: 5 }).flutuanteOpacidade, 55);
  assert.equal(C.salvarConfiguracao(pasta, { flutuanteOpacidade: true }).flutuanteOpacidade, 55);
  assert.equal(C.salvarConfiguracao(pasta, { flutuanteAtalho: 'x' }).flutuanteAtalho, true);
  fs.writeFileSync(path.join(pasta, 'configuracao.json'), JSON.stringify({ flutuanteOpacidade: 9999, flutuanteAtalho: false, fecharParaBandeja: 3 }));
  c = C.lerConfiguracao(pasta);
  assert.equal(c.flutuanteOpacidade, 100);
  assert.equal(c.flutuanteAtalho, false);
  assert.equal(c.fecharParaBandeja, true);
  fs.rmSync(pasta, { recursive: true });
});

test('layouts: menu e cada layout têm HTML e CSS correspondentes', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'estrivisor-app.js'), 'utf8');
  assert.match(html, /id="grupo-layouts"/);
  assert.match(html, /id="lista-layouts"/);
  assert.match(html, /id="festa-voz"/);
  for (const id of ['classico', 'espelhado', 'compacto', 'cinema', 'duas', 'festa']) {
    assert.ok(app.includes(`id: '${id}'`), id);
    if (id !== 'classico') assert.ok(html.includes(`body.layout-${id}`), 'css ' + id);
  }
});

test('mensagem e aviso da janela flutuante: limpos e limitados', () => {
  const e = F.limparEstado({ naVoz: true, mensagem: { autor: 'Ana\n', texto: 'oi '.repeat(100) }, aviso: { id: 3, texto: 'Beto entrou' } });
  assert.equal(e.mensagem.autor, 'Ana');
  assert.ok(e.mensagem.texto.length <= 90);
  assert.deepEqual(e.aviso, { id: 3, texto: 'Beto entrou' });
  for (const m of [null, 5, 'x', { texto: '' }, { texto: '   ' }, { autor: 'a' }]) assert.equal(F.limparEstado({ naVoz: true, mensagem: m }).mensagem, null);
  for (const a of [null, { id: 'x', texto: 'a' }, { id: 1.5, texto: 'a' }, { id: 1, texto: '' }, 'x']) assert.equal(F.limparEstado({ naVoz: true, aviso: a }).aviso, null);
  assert.equal(F.limparEstado({ naVoz: false, mensagem: { texto: 'x' } }).mensagem, null);
  assert.ok(F.alturaDaJanela(3, true) > F.alturaDaJanela(3, false));
});

test('opções novas: clique, chat e avisos só aceitam verdadeiro/falso', () => {
  assert.deepEqual(F.limparOpcoes({ clique: true, chat: false, avisos: true }), { flutuanteClique: true, flutuanteChat: false, flutuanteAvisos: true });
  assert.deepEqual(F.limparOpcoes({ clique: 'sim', chat: 1, avisos: null }), {});
  const C = require('../configuracao');
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg3-'));
  const c = C.lerConfiguracao(pasta);
  assert.equal(c.flutuanteClique, false);
  assert.equal(c.flutuanteChat, false);   // privacidade: chat na janela só se a pessoa ligar
  assert.equal(c.flutuanteAvisos, true);
  fs.rmSync(pasta, { recursive: true });
});

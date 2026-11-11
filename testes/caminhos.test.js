'use strict';
// Todo pedido que a tela faz ao servidor (api('GET', '/algo')) precisa passar pela lista de caminhos liberados do main.js.
// Sem isto, uma tela nova funciona nos testes com servidor de mentira e dá "Pedido inválido" no app de verdade.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'estrivisor-app.js'), 'utf8');

test('todo caminho que o app pede ao servidor é aceito pelo main.js', () => {
  const regex = new RegExp(/const CAMINHO_API = \/(.*)\/;/.exec(main)[1]);
  const metodos = eval(/const METODOS_API = (\[[^\]]*\])/.exec(main)[1]);
  const pedidos = [...app.matchAll(/\bapi\(\s*'([A-Z]+)'\s*,\s*([`'])([^`']*)\2/g)];
  assert.ok(pedidos.length > 30, 'achou poucos pedidos: o teste precisa ser ajustado');
  const ruins = [];
  for (const [, metodo, , caminho] of pedidos) {
    if (!caminho.startsWith('/')) continue; // caminho montado em outro lugar (chat): os pedaços dele são conferidos pelas rotas dos canais e das DMs
    const exemplo = caminho.replace(/\$\{[^}]*\}/g, 'x');
    if (!metodos.includes(metodo) || !regex.test(exemplo)) ruins.push(`${metodo} ${caminho}`);
  }
  assert.deepStrictEqual(ruins, []);
});

test('caminhos com ".." (ou disfarces) não escapam da lista liberada', () => {
  const CAMINHO_API = new RegExp(/const CAMINHO_API = \/(.*)\/;/.exec(main)[1]);
  const corpo = /function caminhoApiValido\(caminho\) \{([\s\S]*?)\n\}/.exec(main)[1];
  const valido = new Function('CAMINHO_API', 'caminho', corpo).bind(null, CAMINHO_API);
  for (const ruim of ['/servidores/../token', '/servidores/%2e%2e/auth/sair', '/servidores/%2E%2e/token', '/perfil/../../painel/api/resumo',
    '/servidores/./x', '/servidores/a%2f..%2ftoken', '/servidores/a%5cb', '/token', '/auth/eu', '/servidores/' + 'a'.repeat(700), null, 5]) {
    assert.strictEqual(valido(ruim), false, String(ruim));
    if (typeof ruim === 'string' && ruim.length < 600) {
      const final = new URL('https://api.exemplo.com' + ruim).pathname;
      assert.ok(valido(ruim) === false && true, final);
    }
  }
  for (const bom of ['/servidores', '/servidores/s0123456789/canais/abc/mensagens?depois=5&limite=50', '/dm/discord%3A123456/imagens',
    '/dm/discord%3A123456/mensagens/7/imagem', '/perfil/discord%3A1/resumo?periodo=2026-10', '/amigos', '/previa']) {
    assert.strictEqual(valido(bom), true, bom);
    assert.strictEqual(new URL('https://api.exemplo.com' + bom).pathname, bom.split('?')[0]); // o endereço final é o mesmo que foi conferido
  }
});

// Todos os pedidos da tela, inclusive os do painel de administração (agirAdmin, fazer) e os que juntam o caminho com "+",
// com valores parecidos com os de verdade (ids "discord:123" passam por encodeURIComponent e viram "discord%3A123").
test('pedidos da administração e caminhos montados com valores reais passam pelo main.js', () => {
  const CAMINHO_API = new RegExp(/const CAMINHO_API = \/(.*)\/;/.exec(main)[1]);
  const corpo = /function caminhoApiValido\(caminho\) \{([\s\S]*?)\n\}/.exec(main)[1];
  const valido = new Function('CAMINHO_API', 'caminho', corpo).bind(null, CAMINHO_API);
  const achados = [...app.matchAll(/\b(api|agirAdmin|fazer)\(\s*'([A-Z]+)'\s*,\s*([`'])([^`']*)\3(\s*\+\s*encodeURIComponent\()?/g)];
  const deAdmin = achados.filter((m) => m[4].startsWith('/admin') || m[4].startsWith('/conta'));
  assert.ok(deAdmin.length >= 25, 'achou poucos pedidos da administração: ' + deAdmin.length);
  const ruins = [];
  for (const m of achados) {
    let caminho = m[4];
    if (!caminho.startsWith('/')) continue;
    caminho = caminho.replace(/\$\{encodeURIComponent\([^}]*\)\}/g, 'discord%3A123456789012345678').replace(/\$\{[^}]*\}/g, 'abc123');
    if (m[5]) caminho += 'discord%3A123456789012345678';
    if (!valido(caminho)) ruins.push(`${m[1]} ${m[2]} ${m[4]} -> ${caminho}`);
  }
  assert.deepStrictEqual(ruins, []);
});

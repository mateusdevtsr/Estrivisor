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

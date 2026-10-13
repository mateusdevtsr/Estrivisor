'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { criarAmigos } = require('../amigos');

test('apagarDe remove amizades, pedidos e cadastro da pessoa', () => {
  const a = criarAmigos({ log: { error() {} } });
  a.registrar('discord:1', { nome: 'Um' });
  a.registrar('discord:2', { nome: 'Dois' });
  a.registrar('discord:3', { nome: 'Tres' });
  a.pedir('discord:1', 'discord:2');
  a.aceitar('discord:2', 'discord:1');
  a.pedir('discord:3', 'discord:1');
  assert.strictEqual(a.saoAmigos('discord:1', 'discord:2'), true);
  assert.strictEqual(a.apagarDe('discord:1'), 1);
  assert.strictEqual(a.saoAmigos('discord:1', 'discord:2'), false);
  assert.strictEqual(a.listar('discord:3').enviados.length, 0);
  assert.strictEqual(a.existe('discord:1'), false);
});

test('código de amigo é sorteado, estável e único; o código antigo (calculado do ID) deixa de valer', () => {
  const crypto = require('node:crypto');
  const antigo = (usuario) => {
    const h = crypto.createHash('sha256').update('estrivisor-amigo:' + usuario).digest();
    const al = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let c = '';
    for (let i = 0; i < 8; i++) c += al[h[i] % al.length];
    return c.slice(0, 4) + '-' + c.slice(4);
  };
  const a = criarAmigos({ log: { error() {} } });
  a.registrar('discord:111111', { nome: 'Um' });
  a.registrar('discord:222222', { nome: 'Dois' });
  const c1 = a.meuCodigo('discord:111111');
  assert.match(c1, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.notStrictEqual(c1, antigo('discord:111111'));
  assert.notStrictEqual(c1, a.meuCodigo('discord:222222'));
  a.registrar('discord:111111', { nome: 'Um Novo Nome' }); // mudar de nome não troca o código
  assert.strictEqual(a.meuCodigo('discord:111111'), c1);
  assert.strictEqual(a.porCodigo(c1), 'discord:111111');
  assert.strictEqual(a.porCodigo(c1.toLowerCase().replace('-', ' ')), 'discord:111111');
  assert.strictEqual(a.porCodigo(antigo('discord:111111')), null);
  assert.strictEqual(a.meuCodigo('discord:999'), '');
});

test('cadastro antigo ganha código sorteado na primeira leitura e as amizades continuam', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amigos-'));
  const arq = path.join(dir, 'amigos.json');
  fs.writeFileSync(arq, JSON.stringify({
    versao: 1,
    usuarios: { 'discord:1': { nome: 'Um', avatar: '', codigo: 'AAAA-AAAA' }, 'discord:2': { nome: 'Dois', avatar: '', codigo: 'BBBB-BBBB' } },
    amizades: ['discord:1|discord:2'], pedidos: [],
  }));
  const a = criarAmigos({ arquivo: arq, log: { error() {} } });
  assert.notStrictEqual(a.meuCodigo('discord:1'), 'AAAA-AAAA');
  assert.strictEqual(a.porCodigo('AAAA-AAAA'), null);
  assert.strictEqual(a.saoAmigos('discord:1', 'discord:2'), true);
  const guardado = JSON.parse(fs.readFileSync(arq, 'utf8'));
  assert.strictEqual(guardado.usuarios['discord:1'].codigo, a.meuCodigo('discord:1'));
  const b = criarAmigos({ arquivo: arq, log: { error() {} } }); // reabrir mantém o mesmo código
  assert.strictEqual(b.meuCodigo('discord:1'), a.meuCodigo('discord:1'));
  fs.rmSync(dir, { recursive: true, force: true });
});

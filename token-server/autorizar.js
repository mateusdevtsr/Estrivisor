#!/usr/bin/env node
'use strict';
// Linha de comando pra liberar/bloquear gente com o servidor ligado.
//   docker compose exec token-server node autorizar.js listar
//   docker compose exec token-server node autorizar.js adicionar 123456789012345678 [nome]
//   docker compose exec token-server node autorizar.js remover 123456789012345678
//   docker compose exec token-server node autorizar.js banir 123456789012345678 [motivo]
//   docker compose exec token-server node autorizar.js desbanir 123456789012345678
const path = require('path');
const { criarAcesso } = require('./acesso');

const arquivoDados = process.env.DATA_FILE || '/data/servidores.json';
const acesso = criarAcesso({ arquivo: process.env.ACESSO_FILE || path.join(path.dirname(arquivoDados), 'acesso.json'), restrito: true });
const [, , comando, idBruto, ...resto] = process.argv;
const normalizar = (id) => (/^\d{5,25}$/.test(String(id || '')) ? `discord:${id}` : String(id || ''));

if (comando === 'listar') {
  const l = acesso.listar();
  console.log('\nAUTORIZADOS (' + l.autorizados.length + '):');
  l.autorizados.forEach((a) => console.log(`  ${a.usuario.padEnd(30)} ${a.nome}${a.admin ? '  [admin]' : ''}`));
  console.log('\nPEDIDOS ESPERANDO (' + l.pedidos.length + '):');
  l.pedidos.forEach((p) => console.log(`  ${p.usuario.padEnd(30)} ${p.nome}`));
  console.log('\nPUNIDOS (' + l.punidos.filter((p) => p.vigente).length + '):');
  l.punidos.filter((p) => p.vigente).forEach((p) => console.log(`  ${p.usuario.padEnd(30)} ${p.nome} - ${p.tipo === 'ban' ? 'banido' : 'suspenso até ' + new Date(p.ate).toLocaleString('pt-BR')}${p.motivo ? ' (' + p.motivo + ')' : ''}`));
  console.log('');
} else if (comando === 'banir' && idBruto) {
  acesso.punir(normalizar(idBruto), { tipo: 'ban', motivo: resto.join(' '), por: 'linha-de-comando' });
  console.log('Banido:', normalizar(idBruto));
} else if (comando === 'desbanir' && idBruto) {
  console.log(acesso.desfazerPunicao(normalizar(idBruto)) ? 'Punição desfeita: ' + normalizar(idBruto) : 'Essa pessoa não estava punida.');
} else if (comando === 'adicionar' && idBruto) {
  acesso.autorizarPorId(normalizar(idBruto), resto.join(' '), 'linha-de-comando');
  console.log('Liberado:', normalizar(idBruto));
} else if (comando === 'remover' && idBruto) {
  console.log(acesso.revogar(normalizar(idBruto)) ? 'Removido: ' + normalizar(idBruto) : 'Essa pessoa não estava na lista.');
} else {
  console.log('Uso: node autorizar.js listar | adicionar <id> [nome] | remover <id> | banir <id> [motivo] | desbanir <id>');
  process.exitCode = 1;
}

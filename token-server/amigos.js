'use strict';
// ============================================================
// Amigos: diretório de pessoas, pedidos de amizade e amizades.
//
// Todo mundo tem um "código de amigo" (ex.: K7M2-9QXA) calculado a partir do próprio
// ID — ninguém escolhe, ninguém adivinha só pelo nome. Pra adicionar alguém você usa o
// código dela (ou clica na pessoa dentro de um servidor em comum). O pedido só vira
// amizade quando a outra pessoa aceita.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIMITES = { amigos: 100, pedidosEnviados: 30 };
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

class ErroAmigos extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

function codigoDe(usuario) {
  const h = crypto.createHash('sha256').update('estrivisor-amigo:' + usuario).digest();
  let c = '';
  for (let i = 0; i < 8; i++) c += ALFABETO[h[i] % ALFABETO.length];
  return c.slice(0, 4) + '-' + c.slice(4);
}
function normalizarCodigo(codigo) {
  const c = typeof codigo === 'string' ? codigo.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  return c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : '';
}
const par = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function criarAmigos({ arquivo = null, agora = () => Date.now(), log = console, gravarApos = 1500 } = {}) {
  let dados = { versao: 1, usuarios: {}, amizades: [], pedidos: [] };
  let sujo = false, relogio = null;

  function tentarLer(caminho) {
    try {
      const l = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (l && l.usuarios && Array.isArray(l.amizades) && Array.isArray(l.pedidos)) return l;
    } catch (e) { /* cai no return abaixo */ }
    return null;
  }
  if (arquivo && fs.existsSync(arquivo)) {
    const l = tentarLer(arquivo) || (fs.existsSync(arquivo + '.bak') ? tentarLer(arquivo + '.bak') : null);
    if (l) dados = l; else log.error('[amigos] arquivo ilegível; a lista de amigos começa vazia.');
  }
  function gravarAgora() {
    if (relogio) { clearTimeout(relogio); relogio = null; }
    if (!sujo || !arquivo) { sujo = false; return; }
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      const tmp = arquivo + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(dados));
      if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
      fs.renameSync(tmp, arquivo);
      sujo = false;
    } catch (e) { log.error('[amigos] não consegui gravar:', e.message); }
  }
  function marcarSujo() {
    sujo = true;
    if (!relogio && arquivo) { relogio = setTimeout(gravarAgora, gravarApos); if (relogio.unref) relogio.unref(); }
  }

  // Chamado a cada pedido autenticado: mantém nome e foto atualizados (só grava se mudou).
  function registrar(usuario, perfil) {
    const nome = String((perfil && perfil.nome) || '').slice(0, 40);
    const avatar = (perfil && perfil.avatar) || '';
    const atual = dados.usuarios[usuario];
    if (atual && atual.nome === nome && atual.avatar === avatar) return;
    dados.usuarios[usuario] = { nome, avatar, codigo: codigoDe(usuario) };
    marcarSujo();
  }
  const pessoa = (usuario) => {
    const u = dados.usuarios[usuario];
    return { usuario, nome: u ? u.nome : usuario, avatar: u ? u.avatar : '' };
  };
  const existe = (usuario) => Boolean(dados.usuarios[usuario]);
  const meuCodigo = (usuario) => codigoDe(usuario);

  function porCodigo(codigo) {
    const c = normalizarCodigo(codigo);
    if (!c) return null;
    return Object.keys(dados.usuarios).find((u) => dados.usuarios[u].codigo === c) || null;
  }

  const saoAmigos = (a, b) => dados.amizades.includes(par(a, b));
  const amigosDe = (usuario) => dados.amizades
    .map((p) => p.split('|')).filter((p) => p.includes(usuario)).map((p) => (p[0] === usuario ? p[1] : p[0]));

  // Devolve "pedido" (enviado) ou "amigos" (a outra pessoa já tinha pedido: vira amizade na hora).
  function pedir(de, para) {
    if (de === para) throw new ErroAmigos(400, 'Esse é o seu próprio código.');
    if (!existe(para)) throw new ErroAmigos(404, 'Não encontrei ninguém com esse código.');
    if (saoAmigos(de, para)) throw new ErroAmigos(409, 'Vocês já são amigos.');
    if (dados.pedidos.some((p) => p.de === para && p.para === de)) { aceitar(de, para); return 'amigos'; }
    if (dados.pedidos.some((p) => p.de === de && p.para === para)) throw new ErroAmigos(409, 'Você já enviou um pedido pra essa pessoa.');
    if (dados.pedidos.filter((p) => p.de === de).length >= LIMITES.pedidosEnviados) throw new ErroAmigos(429, 'Você tem pedidos demais esperando resposta.');
    if (amigosDe(de).length >= LIMITES.amigos) throw new ErroAmigos(409, `Limite de ${LIMITES.amigos} amigos atingido.`);
    dados.pedidos.push({ de, para, ts: agora() });
    marcarSujo();
    return 'pedido';
  }
  function aceitar(eu, de) {
    const i = dados.pedidos.findIndex((p) => p.de === de && p.para === eu);
    if (i < 0) throw new ErroAmigos(404, 'Esse pedido não existe mais.');
    if (amigosDe(eu).length >= LIMITES.amigos || amigosDe(de).length >= LIMITES.amigos) throw new ErroAmigos(409, `Limite de ${LIMITES.amigos} amigos atingido.`);
    dados.pedidos.splice(i, 1);
    if (!saoAmigos(eu, de)) dados.amizades.push(par(eu, de));
    marcarSujo();
  }
  // Recusa um pedido recebido ou cancela um enviado.
  function recusar(eu, outro) {
    const antes = dados.pedidos.length;
    dados.pedidos = dados.pedidos.filter((p) => !((p.de === outro && p.para === eu) || (p.de === eu && p.para === outro)));
    if (dados.pedidos.length !== antes) marcarSujo();
  }
  function remover(eu, outro) {
    const antes = dados.amizades.length;
    dados.amizades = dados.amizades.filter((p) => p !== par(eu, outro));
    if (dados.amizades.length !== antes) marcarSujo();
  }
  function listar(usuario) {
    return {
      amigos: amigosDe(usuario).map(pessoa),
      recebidos: dados.pedidos.filter((p) => p.para === usuario).map((p) => pessoa(p.de)),
      enviados: dados.pedidos.filter((p) => p.de === usuario).map((p) => pessoa(p.para)),
    };
  }

  const todos = () => Object.keys(dados.usuarios).map((u) => ({ usuario: u, nome: dados.usuarios[u].nome }));

  // Apaga a pessoa da lista de amigos: amizades, pedidos e o cadastro dela. Devolve quantas amizades tinha.
  function apagarDe(usuario) {
    const antes = dados.amizades.length;
    dados.amizades = dados.amizades.filter((p) => !p.split('|').includes(usuario));
    dados.pedidos = dados.pedidos.filter((p) => p.de !== usuario && p.para !== usuario);
    const tinha = Boolean(dados.usuarios[usuario]);
    delete dados.usuarios[usuario];
    const n = antes - dados.amizades.length;
    if (n || tinha) marcarSujo();
    return n;
  }

  return { apagarDe, todos, registrar, existe, meuCodigo, porCodigo, saoAmigos, amigosDe, pedir, aceitar, recusar, remover, listar, pessoa, gravarAgora };
}

module.exports = { criarAmigos, ErroAmigos, codigoDe, normalizarCodigo };

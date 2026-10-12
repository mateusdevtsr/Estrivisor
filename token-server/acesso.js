'use strict';
// ============================================================
// Controle de acesso: quem pode usar o Estrivisor.
//
// Com o acesso restrito ligado, só entra quem estiver na lista de "autorizados".
// Quem faz login com o Discord e ainda não está na lista vira um "pedido de acesso" que
// o administrador vê e libera (ou nega). Remover alguém da lista bloqueia a pessoa na hora:
// todos os pedidos dela passam a ser recusados.
//
// Também guarda: o aceite dos termos (quem aceitou qual versão e quando), as punições (suspensão com
// data de fim e banimento até o administrador desfazer) e a última vez que cada pessoa foi vista.
//
// O arquivo é conferido a cada uso (muda de data = relê), então dá pra mexer nele pela
// linha de comando (autorizar.js) com o servidor ligado.
// ============================================================
const fs = require('fs');
const path = require('path');

const MAX_PEDIDOS = 100;

function criarAcesso({ arquivo = null, restrito = true, admins = [], agora = () => Date.now(), log = console } = {}) {
  let dados = { versao: 1, autorizados: {}, pedidos: {}, aceites: {}, punicoes: {}, vistos: {} };
  let mtime = 0;
  const arquivoExistia = Boolean(arquivo && fs.existsSync(arquivo));
  const listaAdmins = new Set(admins);

  function tentarLer(caminho) {
    try {
      const l = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (l && l.autorizados && typeof l.autorizados === 'object' && l.pedidos && typeof l.pedidos === 'object') {
        // arquivos antigos não tinham estes campos
        ['aceites', 'punicoes', 'vistos'].forEach((k) => { if (!l[k] || typeof l[k] !== 'object') l[k] = {}; });
        return l;
      }
    } catch (e) { /* cai no return abaixo */ }
    return null;
  }
  function ler() {
    if (!arquivo) return;
    let m = 0;
    try { m = fs.statSync(arquivo).mtimeMs; } catch (e) { return; }
    if (m === mtime) return;
    const l = tentarLer(arquivo) || (fs.existsSync(arquivo + '.bak') ? tentarLer(arquivo + '.bak') : null);
    if (l) { dados = l; mtime = m; }
    else log.error('[acesso] arquivo ilegível; mantendo a lista que já estava na memória.');
  }
  function gravar() {
    if (!arquivo) return;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 1));
    if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
    fs.renameSync(tmp, arquivo);
    try { mtime = fs.statSync(arquivo).mtimeMs; } catch (e) {}
  }
  ler();

  // Primeira vez com o acesso restrito: libera quem já usava (amigos atuais não ficam de fora).
  function semear(pessoas) {
    if (arquivoExistia) return false;
    (pessoas || []).forEach((p) => {
      if (p && p.usuario && !dados.autorizados[p.usuario]) {
        dados.autorizados[p.usuario] = { nome: String(p.nome || '').slice(0, 40), desde: agora(), por: 'migracao' };
      }
    });
    gravar();
    return true;
  }

  const ehAdmin = (usuario) => listaAdmins.has(usuario);

  // Punição em vigor (ou null). Suspensão que já passou do fim deixa de valer sozinha.
  function punicao(usuario) {
    ler();
    const p = dados.punicoes[usuario];
    if (!p) return null;
    if (p.tipo === 'suspensao' && p.ate && p.ate <= agora()) return null;
    return p;
  }

  // Situação da pessoa: 'ok' | 'nao-liberado' | 'banido' | 'suspenso' (+ a punição, se houver).
  // Administradores nunca ficam bloqueados.
  function situacao(usuario) {
    if (ehAdmin(usuario)) return { estado: 'ok' };
    const p = punicao(usuario);
    if (p) return { estado: p.tipo === 'ban' ? 'banido' : 'suspenso', punicao: p };
    if (!restrito) return { estado: 'ok' };
    ler();
    return dados.autorizados[usuario] ? { estado: 'ok' } : { estado: 'nao-liberado' };
  }
  const permitido = (usuario) => situacao(usuario).estado === 'ok';

  function punir(usuario, { tipo, ate = null, motivo = '', por = 'admin', nome = '' } = {}) {
    if (tipo !== 'ban' && tipo !== 'suspensao') throw new Error('tipo de punição inválido');
    ler();
    const conhecido = dados.autorizados[usuario] || dados.pedidos[usuario] || dados.punicoes[usuario];
    dados.punicoes[usuario] = {
      tipo, ate: tipo === 'suspensao' ? ate : null, motivo: String(motivo || '').slice(0, 200), por, ts: agora(),
      nome: String(nome || (conhecido && conhecido.nome) || '').slice(0, 40),
    };
    delete dados.pedidos[usuario];
    gravar();
    return dados.punicoes[usuario];
  }
  function desfazerPunicao(usuario) {
    ler();
    if (!dados.punicoes[usuario]) return false;
    delete dados.punicoes[usuario];
    gravar();
    return true;
  }

  // ---- Aceite dos termos ----
  function aceitar(usuario, versaoTermos) {
    ler();
    dados.aceites[usuario] = { versao: versaoTermos, ts: agora() };
    gravar();
  }
  function aceiteDe(usuario) { ler(); return dados.aceites[usuario] || null; }
  const aceitou = (usuario, versaoTermos) => { const a = aceiteDe(usuario); return Boolean(a && a.versao >= versaoTermos); };

  // ---- Última vez vista (grava no disco no máximo a cada 10 minutos por pessoa) ----
  function marcarVisto(usuario) {
    const t = agora();
    const antes = dados.vistos[usuario] || 0;
    if (t - antes < 10 * 60 * 1000) return;
    ler();
    dados.vistos[usuario] = t;
    gravar();
  }

  // Devolve true se o pedido ficou registrado (ou já existia), false se não coube.
  function registrarPedido(usuario, perfil) {
    ler();
    if (punicao(usuario)) return false; // banido/suspenso não vira pedido
    if (!dados.pedidos[usuario] && Object.keys(dados.pedidos).length >= MAX_PEDIDOS) {
      // Fila cheia: some com os pedidos parados há mais de 30 dias e tenta de novo.
      const limite = agora() - 30 * 24 * 60 * 60 * 1000;
      for (const [u, p] of Object.entries(dados.pedidos)) if (!p.ts || p.ts < limite) delete dados.pedidos[u];
      if (Object.keys(dados.pedidos).length >= MAX_PEDIDOS) { gravar(); return false; }
    }
    dados.pedidos[usuario] = { nome: String((perfil && perfil.nome) || '').slice(0, 40), avatar: (perfil && perfil.avatar) || '', ts: agora() };
    gravar();
    return true;
  }
  function autorizar(usuario, por) {
    ler();
    const p = dados.pedidos[usuario];
    dados.autorizados[usuario] = { nome: (p && p.nome) || (dados.autorizados[usuario] && dados.autorizados[usuario].nome) || '', desde: agora(), por: por || 'admin' };
    delete dados.pedidos[usuario];
    gravar();
  }
  function autorizarPorId(usuario, nome, por) {
    ler();
    dados.autorizados[usuario] = { nome: String(nome || '').slice(0, 40), desde: agora(), por: por || 'admin' };
    delete dados.pedidos[usuario];
    gravar();
  }
  function negar(usuario) { ler(); if (dados.pedidos[usuario]) { delete dados.pedidos[usuario]; gravar(); } }
  function revogar(usuario) { ler(); if (dados.autorizados[usuario]) { delete dados.autorizados[usuario]; gravar(); return true; } return false; }
  function ultimaVez(usuario) { ler(); return dados.vistos[usuario] || null; }

  function listar() {
    ler();
    return {
      pedidos: Object.entries(dados.pedidos).map(([usuario, p]) => ({ usuario, ...p })).sort((a, b) => b.ts - a.ts),
      autorizados: Object.entries(dados.autorizados).map(([usuario, a]) => ({ usuario, ...a, admin: ehAdmin(usuario) })).sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR')),
      punidos: Object.entries(dados.punicoes).map(([usuario, p]) => ({ usuario, ...p, vigente: Boolean(punicao(usuario)) })).sort((a, b) => b.ts - a.ts),
    };
  }

  // Dados de acesso da própria pessoa (pra exportar) e apagar. Punições NÃO são apagadas
  // (apagar a conta não pode servir pra escapar de um banimento).
  function dadosDe(usuario) {
    ler();
    const a = dados.autorizados[usuario] || null;
    return {
      liberadoDesde: a ? a.desde : null,
      aceiteDosTermos: dados.aceites[usuario] || null,
      ultimaVezVisto: dados.vistos[usuario] || null,
      punicaoRegistrada: dados.punicoes[usuario] ? { tipo: dados.punicoes[usuario].tipo, ate: dados.punicoes[usuario].ate, motivo: dados.punicoes[usuario].motivo, ts: dados.punicoes[usuario].ts } : null,
    };
  }
  function apagarDe(usuario) {
    ler();
    delete dados.autorizados[usuario];
    delete dados.pedidos[usuario];
    delete dados.aceites[usuario];
    delete dados.vistos[usuario];
    gravar();
  }

  return {
    dadosDe, apagarDe,
    restrito, arquivoExistia, semear, permitido, situacao, ehAdmin, registrarPedido, autorizar, autorizarPorId, negar, revogar, listar,
    punicao, punir, desfazerPunicao, aceitar, aceiteDe, aceitou, marcarVisto, ultimaVez,
  };
}

module.exports = { criarAcesso };

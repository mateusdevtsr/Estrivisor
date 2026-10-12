'use strict';
// ============================================================
// Sessões de login.
//
// Depois que a pessoa entra (com Discord ou "sem Discord"), o servidor entrega uma
// chave de sessão aleatória. O app manda essa chave em todo pedido, e é ELA que diz
// quem é a pessoa — o app não consegue mais simplesmente "dizer" quem é.
//
// No arquivo só fica o hash (SHA-256) de cada chave: quem copiar o arquivo não
// consegue usar as sessões. As alterações são gravadas do mesmo jeito seguro dos
// servidores (arquivo temporário + cópia .bak + troca de nome).
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALIDADE_MS = 180 * 24 * 60 * 60 * 1000;   // 6 meses sem precisar entrar de novo
const MAX_SESSOES_POR_PESSOA = 10;                // um por PC, com folga
const GRAVAR_USO_A_CADA_MS = 60 * 60 * 1000;      // "último uso" vai pro disco no máximo 1x por hora

const hash = (chave) => crypto.createHash('sha256').update(String(chave)).digest('hex');

function criarSessoes({ arquivo = null, agora = () => Date.now(), log = console } = {}) {
  let dados = { versao: 1, sessoes: [] };

  function tentarLer(caminho) {
    try {
      const lido = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (lido && Array.isArray(lido.sessoes)) return lido;
    } catch (e) { /* cai no return abaixo */ }
    return null;
  }

  function salvar() {
    if (!arquivo) return;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const temporario = arquivo + '.tmp';
    fs.writeFileSync(temporario, JSON.stringify(dados));
    if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
    fs.renameSync(temporario, arquivo);
  }

  if (arquivo && fs.existsSync(arquivo)) {
    const lido = tentarLer(arquivo) || (fs.existsSync(arquivo + '.bak') ? tentarLer(arquivo + '.bak') : null);
    if (lido) dados = lido;
    else log.error('[sessoes] arquivo ilegível; todo mundo vai precisar entrar de novo.');
  }

  function limparVencidas() {
    const t = agora();
    const antes = dados.sessoes.length;
    dados.sessoes = dados.sessoes.filter((s) => s.expiraEm > t);
    return dados.sessoes.length !== antes;
  }

  // Cria uma sessão e devolve a chave (só aparece aqui, uma vez).
  function criar({ usuario, tipo, perfil }) {
    limparVencidas();
    const chave = 'est_' + crypto.randomBytes(32).toString('base64url');
    const t = agora();
    const sessao = {
      hash: hash(chave),
      usuario,
      tipo,
      perfil: { nome: String(perfil && perfil.nome || '').slice(0, 40), avatar: (perfil && perfil.avatar) || null },
      criadaEm: t,
      expiraEm: t + VALIDADE_MS,
      ultimoUso: t,
    };
    // Muitas sessões da mesma pessoa (vários PCs, reinstalações): mantém só as mais recentes.
    const daPessoa = dados.sessoes.filter((s) => s.usuario === usuario).sort((a, b) => b.ultimoUso - a.ultimoUso);
    const sobrando = new Set(daPessoa.slice(MAX_SESSOES_POR_PESSOA - 1).map((s) => s.hash));
    dados.sessoes = dados.sessoes.filter((s) => !sobrando.has(s.hash));
    dados.sessoes.push(sessao);
    salvar();
    return { chave, sessao: { ...sessao } };
  }

  // Devolve a sessão da chave (ou null se não existe / venceu).
  function validar(chave) {
    if (typeof chave !== 'string' || chave.length < 20 || chave.length > 200) return null;
    const h = hash(chave);
    const sessao = dados.sessoes.find((s) => s.hash === h);
    if (!sessao) return null;
    const t = agora();
    if (sessao.expiraEm <= t) return null;
    if (t - sessao.ultimoUso > GRAVAR_USO_A_CADA_MS) {
      sessao.ultimoUso = t;
      try { salvar(); } catch (e) { /* não impede o uso */ }
    }
    return { ...sessao };
  }

  function revogar(chave) {
    const h = hash(chave);
    const antes = dados.sessoes.length;
    dados.sessoes = dados.sessoes.filter((s) => s.hash !== h);
    if (dados.sessoes.length !== antes) salvar();
  }

  // Encerra TODAS as sessões da pessoa (todos os PCs).
  function revogarDe(usuario) {
    const antes = dados.sessoes.length;
    dados.sessoes = dados.sessoes.filter((s) => s.usuario !== usuario);
    if (dados.sessoes.length !== antes) salvar();
  }

  // Quem já tem sessão (usado só pra liberar o pessoal que já usava, quando o acesso passa a ser restrito).
  function todos() {
    const mapa = new Map();
    dados.sessoes.forEach((x) => { if (!mapa.has(x.usuario)) mapa.set(x.usuario, { usuario: x.usuario, nome: x.perfil && x.perfil.nome }); });
    return [...mapa.values()];
  }

  return { criar, validar, revogar, revogarDe, todos };
}

module.exports = { criarSessoes, VALIDADE_MS };

'use strict';
// ============================================================
// Moderação: denúncias dos usuários e registro das ações do administrador.
//
// Denúncia: guarda uma CÓPIA do trecho da conversa (a mensagem e algumas ao redor), assim o
// administrador vê o contexto mesmo se a mensagem for apagada depois. É a única forma de o
// administrador ver conteúdo de mensagens diretas: só o que a pessoa denunciou.
//
// Auditoria: cada ação do administrador (liberar, banir, apagar servidor...) vira uma linha.
// ============================================================
const fs = require('fs');
const path = require('path');

const MAX_DENUNCIAS = 500;
const MAX_AUDITORIA = 1000;
const MAX_POR_HORA = 5;
const MOTIVOS = ['assedio', 'sexual-menores', 'golpe', 'pirataria', 'ilegal', 'outro'];

class ErroModeracao extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

function arquivoJson(arquivo, padrao) {
  let dados = padrao();
  function tentar(c) {
    try { const l = JSON.parse(fs.readFileSync(c, 'utf8')); if (l && typeof l === 'object') return l; } catch (e) { /* tenta o backup */ }
    return null;
  }
  if (arquivo) dados = tentar(arquivo) || (fs.existsSync(arquivo + '.bak') ? tentar(arquivo + '.bak') : null) || dados;
  function gravar() {
    if (!arquivo) return;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 1));
    if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
    fs.renameSync(tmp, arquivo);
  }
  return { get dados() { return dados; }, gravar };
}

function criarModeracao({ arquivoDenuncias = null, arquivoAuditoria = null, agora = () => Date.now() } = {}) {
  const den = arquivoJson(arquivoDenuncias, () => ({ versao: 1, seq: 0, itens: [] }));
  const aud = arquivoJson(arquivoAuditoria, () => ({ versao: 1, itens: [] }));
  if (!Array.isArray(den.dados.itens)) den.dados.itens = [];
  if (!Array.isArray(aud.dados.itens)) aud.dados.itens = [];

  // ---- Denúncias ----
  function denunciar({ de, deNome, alvo, alvoNome, motivo, detalhe, origem, contexto }) {
    if (!MOTIVOS.includes(motivo)) throw new ErroModeracao(400, 'Escolha um motivo para a denúncia.');
    if (!alvo || alvo === de) throw new ErroModeracao(400, 'Não dá para denunciar a si mesmo.');
    const itens = den.dados.itens;
    const t = agora();
    if (itens.filter((x) => x.de === de && t - x.ts < 3600 * 1000).length >= MAX_POR_HORA) {
      throw new ErroModeracao(429, 'Você já enviou várias denúncias na última hora. Tente de novo mais tarde.');
    }
    // A mesma mensagem denunciada pela mesma pessoa não vira duas denúncias.
    const repetida = origem && origem.seq && itens.find((x) => x.de === de && x.estado === 'aberta' && x.origem && x.origem.chave === origem.chave && x.origem.seq === origem.seq);
    if (repetida) return repetida;
    den.dados.seq++;
    const item = {
      id: den.dados.seq, ts: t, de, deNome: String(deNome || '').slice(0, 40), alvo, alvoNome: String(alvoNome || '').slice(0, 40),
      motivo, detalhe: String(detalhe || '').slice(0, 500), origem: origem || null,
      contexto: (contexto || []).slice(0, 15).map((m) => ({ seq: m.seq, usuario: m.usuario, nome: m.nome, texto: String(m.texto || '').slice(0, 2000), ts: m.ts })),
      estado: 'aberta',
    };
    itens.push(item);
    if (itens.length > MAX_DENUNCIAS) {
      // descarta primeiro as já resolvidas, as mais antigas
      const i = itens.findIndex((x) => x.estado !== 'aberta');
      itens.splice(i >= 0 ? i : 0, 1);
    }
    den.gravar();
    return item;
  }
  const listarDenuncias = () => den.dados.itens.slice().sort((a, b) => b.id - a.id);
  const denuncia = (id) => den.dados.itens.find((x) => x.id === Number(id)) || null;
  const abertas = () => den.dados.itens.filter((x) => x.estado === 'aberta').length;
  function resolverDenuncia(id, { acao, por, nota = '' }) {
    const d = denuncia(id);
    if (!d) throw new ErroModeracao(404, 'Denúncia não encontrada.');
    d.estado = acao === 'ignorar' ? 'ignorada' : 'resolvida';
    d.resolucao = { acao, por, nota: String(nota || '').slice(0, 200), ts: agora() };
    den.gravar();
    return d;
  }

  // ---- Auditoria ----
  function registrar({ por, porNome = '', acao, alvo = '', alvoNome = '', detalhe = '' }) {
    aud.dados.itens.push({ ts: agora(), por, porNome: String(porNome).slice(0, 40), acao, alvo, alvoNome: String(alvoNome).slice(0, 40), detalhe: String(detalhe).slice(0, 300) });
    if (aud.dados.itens.length > MAX_AUDITORIA) aud.dados.itens.splice(0, aud.dados.itens.length - MAX_AUDITORIA);
    aud.gravar();
  }
  const historico = (limite = 200) => aud.dados.itens.slice(-limite).reverse();

  return { MOTIVOS, denunciar, listarDenuncias, denuncia, abertas, resolverDenuncia, registrar, historico };
}

module.exports = { criarModeracao, ErroModeracao, MOTIVOS };

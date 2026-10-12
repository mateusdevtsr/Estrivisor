'use strict';
// ============================================================
// Mensagens de texto (canais dos servidores e conversas privadas).
//
// Cada conversa tem uma "chave" (ex.: "c:s1a2b3c4d5:geral-texto" ou "d:discord:1|discord:2")
// e uma lista de mensagens numeradas (seq 1, 2, 3...). O app guarda o último número que
// viu e pergunta "o que veio depois do N?". Ficam no disco (gravação segura: arquivo
// temporário + cópia .bak + troca de nome) e cada conversa guarda só as últimas
// MAX_MENSAGENS, pra o arquivo não crescer pra sempre.
// ============================================================
const fs = require('fs');
const path = require('path');

const MAX_MENSAGENS = 1000;   // por conversa
const MAX_TEXTO = 2000;
const GRAVAR_APOS_MS = 1500;  // junta várias mensagens seguidas numa gravação só

class ErroConversa extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

function criarConversas({ arquivo = null, agora = () => Date.now(), log = console, gravarApos = GRAVAR_APOS_MS } = {}) {
  let dados = { versao: 1, conversas: {} };
  let sujo = false;
  let relogio = null;

  function tentarLer(caminho) {
    try {
      const lido = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (lido && typeof lido === 'object' && lido.conversas && typeof lido.conversas === 'object') return lido;
    } catch (e) { /* cai no return abaixo */ }
    return null;
  }
  if (arquivo && fs.existsSync(arquivo)) {
    const lido = tentarLer(arquivo) || (fs.existsSync(arquivo + '.bak') ? tentarLer(arquivo + '.bak') : null);
    if (lido) dados = lido;
    else log.error('[conversas] arquivo ilegível; o histórico começa vazio.');
  }

  function gravarAgora() {
    if (relogio) { clearTimeout(relogio); relogio = null; }
    if (!sujo || !arquivo) { sujo = false; return; }
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      const temporario = arquivo + '.tmp';
      fs.writeFileSync(temporario, JSON.stringify(dados));
      if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
      fs.renameSync(temporario, arquivo);
      sujo = false;
    } catch (e) { log.error('[conversas] não consegui gravar:', e.message); }
  }
  function marcarSujo() {
    sujo = true;
    if (!relogio && arquivo) { relogio = setTimeout(gravarAgora, gravarApos); if (relogio.unref) relogio.unref(); }
  }

  const conversa = (chave) => dados.conversas[chave] || null;

  function enviar(chave, { usuario, nome, avatar, texto }) {
    const t = typeof texto === 'string' ? texto.slice(0, MAX_TEXTO) : '';
    if (!t.trim()) throw new ErroConversa(400, 'Escreva alguma coisa.');
    const c = dados.conversas[chave] || (dados.conversas[chave] = { seq: 0, msgs: [] });
    c.seq++;
    const msg = { seq: c.seq, usuario, nome: String(nome || '').slice(0, 40), avatar: avatar || '', texto: t, ts: agora() };
    c.msgs.push(msg);
    if (c.msgs.length > MAX_MENSAGENS) c.msgs.splice(0, c.msgs.length - MAX_MENSAGENS);
    marcarSujo();
    return { ...msg };
  }

  // depois: só as mais novas que esse número. antes: as anteriores a esse número (rolar pra cima).
  // Sem nenhum dos dois: as últimas "limite".
  function listar(chave, { depois, antes, limite = 50 } = {}) {
    const c = conversa(chave);
    if (!c) return { mensagens: [], ultimaSeq: 0, temMais: false };
    const lim = Math.max(1, Math.min(100, Number(limite) || 50));
    let lista;
    let temMais = false;
    if (Number.isFinite(depois)) {
      lista = c.msgs.filter((m) => m.seq > depois).slice(0, 200);
    } else if (Number.isFinite(antes)) {
      const anteriores = c.msgs.filter((m) => m.seq < antes);
      temMais = anteriores.length > lim;
      lista = anteriores.slice(-lim);
    } else {
      temMais = c.msgs.length > lim;
      lista = c.msgs.slice(-lim);
    }
    return { mensagens: lista.map((m) => ({ ...m })), ultimaSeq: c.seq, temMais };
  }

  function editar(chave, seq, usuario, texto) {
    const c = conversa(chave);
    const msg = c && c.msgs.find((m) => m.seq === seq);
    if (!msg) throw new ErroConversa(404, 'Mensagem não encontrada.');
    if (msg.usuario !== usuario) throw new ErroConversa(403, 'Você só pode editar as suas mensagens.');
    const t = typeof texto === 'string' ? texto.slice(0, MAX_TEXTO) : '';
    if (!t.trim()) throw new ErroConversa(400, 'Escreva alguma coisa.');
    msg.texto = t;
    msg.editadoEm = agora();
    marcarSujo();
    return { ...msg };
  }

  // Quem escreveu apaga a sua; "podeApagarQualquer" é o dono do servidor (moderação).
  function apagar(chave, seq, usuario, podeApagarQualquer = false) {
    const c = conversa(chave);
    const i = c ? c.msgs.findIndex((m) => m.seq === seq) : -1;
    if (i < 0) throw new ErroConversa(404, 'Mensagem não encontrada.');
    if (c.msgs[i].usuario !== usuario && !podeApagarQualquer) throw new ErroConversa(403, 'Você não pode apagar esta mensagem.');
    c.msgs.splice(i, 1);
    marcarSujo();
    return { ok: true };
  }

  // A mensagem "seq" e até "n" de cada lado (usado pelas denúncias).
  function contexto(chave, seq, n = 5) {
    const c = conversa(chave);
    const i = c ? c.msgs.findIndex((m) => m.seq === seq) : -1;
    if (i < 0) return null;
    return c.msgs.slice(Math.max(0, i - n), i + n + 1).map((m) => ({ ...m }));
  }

  const ultimaSeq = (chave) => (conversa(chave) ? conversa(chave).seq : 0);

  function apagarConversa(chave) {
    if (dados.conversas[chave]) { delete dados.conversas[chave]; marcarSujo(); }
  }
  function apagarPrefixo(prefixo) {
    let mudou = false;
    for (const chave of Object.keys(dados.conversas)) {
      if (chave.startsWith(prefixo)) { delete dados.conversas[chave]; mudou = true; }
    }
    if (mudou) marcarSujo();
  }

  return { enviar, listar, editar, apagar, contexto, ultimaSeq, apagarConversa, apagarPrefixo, gravarAgora };
}

module.exports = { criarConversas, ErroConversa, MAX_MENSAGENS, MAX_TEXTO };

'use strict';
// ============================================================
// Reações, status personalizado e prévia de links: só as regras (sem tocar na tela nem na rede),
// para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Social.
// ============================================================
(function (raiz) {
  // Tem que ser igual à lista do servidor (token-server/conversas.js): ele recusa qualquer outra.
  const EMOJIS_REACAO = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '👀', '💀', '😡', '✅'];
  const MAX_STATUS = 60;
  const PERIGOSOS = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;

  function limparStatus(texto) {
    if (typeof texto !== 'string') return '';
    return texto.replace(PERIGOSOS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_STATUS);
  }

  // [{ emoji, qtd, minha }] na ordem da lista fixa; ignora lixo vindo do servidor.
  function resumoReacoes(reacoes, eu) {
    if (!reacoes || typeof reacoes !== 'object') return [];
    const saida = [];
    for (const emoji of EMOJIS_REACAO) {
      const lista = Array.isArray(reacoes[emoji]) ? reacoes[emoji].filter((u) => typeof u === 'string') : [];
      if (lista.length) saida.push({ emoji, qtd: lista.length, minha: lista.includes(eu) });
    }
    return saida;
  }
  // Assinatura curta das reações, para o app perceber que mudaram (mensagem antiga recebeu reação).
  function assinaturaReacoes(reacoes) {
    return resumoReacoes(reacoes, '').map((r) => r.emoji + r.qtd).join('');
  }

  // O primeiro link http(s) público da mensagem (a prévia mostra só um por mensagem).
  const REGEX_LINK = /https?:\/\/[^\s<>"']+/gi;
  function primeiroLink(texto) {
    for (const achado of String(texto || '').matchAll(REGEX_LINK)) {
      const url = achado[0].replace(/[.,;:!?)\]]+$/, '');
      try {
        const u = new URL(url);
        if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && url.length <= 600) return url;
      } catch (e) { /* tenta o próximo */ }
    }
    return null;
  }

  // Confere o que o servidor devolveu antes de desenhar (tudo vira texto puro na tela).
  function previaValida(p) {
    if (!p || typeof p !== 'object') return null;
    const t = (v, max) => (typeof v === 'string' ? v.replace(PERIGOSOS, ' ').trim().slice(0, max) : '');
    const r = { url: t(p.url, 600), dominio: t(p.dominio, 80), titulo: t(p.titulo, 120), descricao: t(p.descricao, 220), site: t(p.site, 60) };
    if (!r.url || !(r.titulo || r.descricao)) return null;
    return r;
  }

  const Social = { EMOJIS_REACAO, MAX_STATUS, limparStatus, resumoReacoes, assinaturaReacoes, primeiroLink, previaValida };
  if (typeof module !== 'undefined' && module.exports) module.exports = Social;
  else raiz.Social = Social;
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';
// ============================================================
// Sala de cinema sincronizada: cada pessoa abre o MESMO arquivo de vídeo no próprio computador, e o app mantém
// todo mundo no mesmo ponto do filme. Quem iniciou (o "dono da sessão") controla play, pausa e avanço.
// O filme nunca viaja pela internet: só mensagens curtinhas ("estou em 12:30, tocando").
// Aqui ficam só as regras (formato das mensagens, conferência do arquivo, conta do ajuste), sem rede nem tela,
// para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Cinema.
// ============================================================
(function (raiz) {
  const TOPICO = 'estrivisor-cinema';
  const TIPOS = ['oferta', 'pronto', 'estado', 'fim'];
  const MAX_DURACAO_S = 24 * 3600;
  const PERIGOSOS = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;
  const ID = /^[a-z0-9]{8,16}$/;
  const EXTENSOES = ['mp4', 'webm', 'mkv', 'm4v', 'mov', 'ogv'];

  function novoId() {
    const letras = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 12; i++) s += letras[Math.floor(Math.random() * letras.length)];
    return s;
  }
  const limpaNome = (t) => String(t || '').replace(/[\\/]/g, ' ').replace(PERIGOSOS, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

  function criarMensagem(tipo, campos = {}) {
    if (!TIPOS.includes(tipo)) throw new Error('tipo inválido');
    const m = { v: 1, t: tipo, id: String(campos.id || '') };
    if (tipo === 'oferta') { m.nome = limpaNome(campos.nome); m.tamanho = Math.round(campos.tamanho); m.duracao = Math.round(campos.duracao * 10) / 10; }
    if (tipo === 'estado') { m.pos = Math.round(campos.pos * 100) / 100; m.tocando = !!campos.tocando; }
    return JSON.stringify(m);
  }
  // Valida a mensagem que veio de outra pessoa; devolve null se estiver errada.
  function lerMensagem(texto) {
    if (typeof texto !== 'string' || texto.length > 600) return null;
    let o = null;
    try { o = JSON.parse(texto); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== 1 || !TIPOS.includes(o.t) || typeof o.id !== 'string' || !ID.test(o.id)) return null;
    if (o.t === 'oferta') {
      const nome = limpaNome(o.nome);
      if (!nome || !Number.isInteger(o.tamanho) || o.tamanho <= 0 || !Number.isFinite(o.duracao) || o.duracao <= 0 || o.duracao > MAX_DURACAO_S) return null;
      return { t: 'oferta', id: o.id, nome, tamanho: o.tamanho, duracao: o.duracao };
    }
    if (o.t === 'estado') {
      if (!Number.isFinite(o.pos) || o.pos < 0 || o.pos > MAX_DURACAO_S || typeof o.tocando !== 'boolean') return null;
      return { t: 'estado', id: o.id, pos: o.pos, tocando: o.tocando };
    }
    return { t: o.t, id: o.id };
  }

  const extensaoOk = (nome) => EXTENSOES.includes(String(nome || '').split('.').pop().toLowerCase());

  // O arquivo que a pessoa escolheu é o mesmo da oferta? Mesmo tamanho e duração (até 1 s de diferença).
  // O nome pode mudar (ela pode ter renomeado), então só avisa.
  function arquivoCombina(oferta, arquivo, duracao) {
    if (arquivo.tamanho !== oferta.tamanho) return { ok: false, motivo: 'Este arquivo tem um tamanho diferente do que foi oferecido. Todos precisam usar exatamente o mesmo arquivo.' };
    if (!Number.isFinite(duracao) || Math.abs(duracao - oferta.duracao) > 1) return { ok: false, motivo: 'A duração deste vídeo não bate com a do arquivo oferecido.' };
    return { ok: true, nomeDiferente: limpaNome(arquivo.nome).toLowerCase() !== oferta.nome.toLowerCase() };
  }

  // Quanto este computador precisa mexer para acompanhar quem controla.
  //  local: { pos, tocando }   estado: { pos, tocando }   desdeMs: há quanto tempo o estado chegou
  // Devolve { seek: segundos|null, tocando: bool, taxa: 1 | 0.95 | 1.05 }
  function ajuste(local, estado, desdeMs) {
    const esperado = estado.tocando ? estado.pos + Math.max(0, desdeMs) / 1000 : estado.pos;
    const diff = esperado - local.pos; // positivo = estou atrasado
    let seek = null; let taxa = 1;
    if (!estado.tocando) { if (Math.abs(diff) > 0.2) seek = esperado; }
    else if (Math.abs(diff) > 1.2) seek = esperado;
    else if (diff > 0.3) taxa = 1.05;
    else if (diff < -0.3) taxa = 0.95;
    return { seek, tocando: estado.tocando, taxa };
  }

  function formatarTempo(s) {
    const t = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), seg = t % 60;
    const dois = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${dois(m)}:${dois(seg)}` : `${m}:${dois(seg)}`;
  }

  const Cinema = { TOPICO, EXTENSOES, novoId, criarMensagem, lerMensagem, extensaoOk, arquivoCombina, ajuste, formatarTempo };
  if (typeof module !== 'undefined' && module.exports) module.exports = Cinema;
  else raiz.Cinema = Cinema;
})(typeof window !== 'undefined' ? window : globalThis);

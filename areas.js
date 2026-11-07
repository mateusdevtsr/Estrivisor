'use strict';
// ============================================================
// Imagens e animações por área da tela (GIF, WebP animado, vídeo curto em loop...).
// Aqui ficam só as regras (áreas, tipos aceitos, limites, validação), sem tocar na tela,
// para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Areas.
// ============================================================
(function (raiz) {
  const AREAS = [
    { id: 'app',       nome: 'Fundo de tudo',           desc: 'Atrás de todas as barras (elas ficam translúcidas).', fixa: true },
    { id: 'barra',     nome: 'Barra de servidores',     desc: 'A faixa estreita com os ícones dos servidores.', seletor: '.barra-servidores' },
    { id: 'canais',    nome: 'Lista de canais',         desc: 'A coluna com os canais de texto e de voz.', seletor: '.coluna-canais' },
    { id: 'principal', nome: 'Área central',            desc: 'Tudo o que fica no meio (chat e transmissões).', seletor: '.coluna-principal' },
    { id: 'texto',     nome: 'Chat',                    desc: 'Atrás das mensagens.', seletor: '.area-texto' },
    { id: 'voz',       nome: 'Sala de voz',             desc: 'Atrás das transmissões e dos rostos.', seletor: '.area-voz' },
    { id: 'membros',   nome: 'Coluna da direita',       desc: 'Membros e quem está na voz.', seletor: '.coluna-membros' },
    { id: 'usuario',   nome: 'Painel do seu usuário',   desc: 'O cartão com seu nome e os botões de microfone.', seletor: '.painel-usuario' },
  ];
  const TIPOS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'];
  const MAX_BYTES = 30 * 1024 * 1024;
  const AJUSTES = ['cover', 'contain', 'fill'];
  const PADRAO = { escuro: 40, ajuste: 'cover' };

  const ehVideo = (tipo) => typeof tipo === 'string' && tipo.startsWith('video/') && TIPOS.includes(tipo);
  const idsConhecidos = () => AREAS.map((a) => a.id);

  function validarArquivo(arq) {
    if (!arq || typeof arq !== 'object') return { ok: false, erro: 'Escolha um arquivo.' };
    if (!TIPOS.includes(arq.type)) return { ok: false, erro: 'Tipo não aceito. Use PNG, JPG, GIF, WebP, AVIF, MP4 ou WebM.' };
    if (!Number.isFinite(arq.size) || arq.size <= 0) return { ok: false, erro: 'Arquivo vazio.' };
    if (arq.size > MAX_BYTES) return { ok: false, erro: 'Arquivo grande demais (máximo de 30 MB). Escolha um menor.' };
    return { ok: true };
  }

  function validarAjustes(b) {
    const o = b && typeof b === 'object' ? b : {};
    const escuro = Number.isInteger(o.escuro) && o.escuro >= 0 && o.escuro <= 90 ? Math.round(o.escuro / 5) * 5 : PADRAO.escuro;
    const ajuste = typeof o.ajuste === 'string' && AJUSTES.includes(o.ajuste) ? o.ajuste : PADRAO.ajuste;
    return { escuro, ajuste };
  }

  // O que fica no localStorage (a imagem em si fica no IndexedDB): só áreas conhecidas.
  function validarMeta(bruto) {
    const saida = {};
    const b = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    for (const id of idsConhecidos()) {
      if (!Object.prototype.hasOwnProperty.call(b, id)) continue;
      const m = b[id];
      if (!m || typeof m !== 'object' || !TIPOS.includes(m.tipo)) continue;
      const nome = String(m.nome === undefined || m.nome === null ? '' : m.nome).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
      saida[id] = { ...validarAjustes(m), tipo: m.tipo, nome };
    }
    return saida;
  }

  const api = { AREAS, TIPOS, MAX_BYTES, AJUSTES, PADRAO, ehVideo, validarArquivo, validarAjustes, validarMeta };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Areas = api;
})(typeof window !== 'undefined' ? window : globalThis);

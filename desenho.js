'use strict';
// ============================================================
// Anotar na tela transmitida (caneta e seta que todo mundo vê e que somem sozinhas).
// Aqui ficam só as regras (formato e validação das mensagens, contas de posição, vida dos traços), sem tocar na
// tela nem na rede, para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Desenho.
// Posições viajam de 0 a 1 em relação à IMAGEM da transmissão (não à janela), então batem em qualquer tamanho.
// ============================================================
(function (raiz) {
  const TOPICO = 'estrivisor-desenho';
  const MODOS = ['livre', 'seta', 'limpar'];
  const ORIGENS = ['tela', 'camera'];
  const MAX_PONTOS_MSG = 60;         // pontos por mensagem
  const MAX_PONTOS_TRACO = 1500;     // pontos por traço
  const MAX_TRACOS_POR_AUTOR = 40;
  const MAX_AUTORES = 20;
  const VIDA_MS = 8000;              // quanto tempo o traço fica
  const DESVANECE_MS = 1500;         // últimos instantes: some devagar

  const num01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

  // alvo = identidade de quem transmite. id = identifica o traço (o mesmo traço chega em vários pedaços).
  function criarMensagem({ alvo, origem, modo, id, pontos }) {
    return JSON.stringify({ v: 1, alvo: String(alvo), origem, modo, id: String(id || ''), p: (pontos || []).map((n) => Math.round(n * 10000) / 10000) });
  }
  function lerMensagem(texto) {
    if (typeof texto !== 'string' || texto.length > 2500) return null;
    let o = null;
    try { o = JSON.parse(texto); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    if (typeof o.alvo !== 'string' || !o.alvo || o.alvo.length > 120) return null;
    if (!ORIGENS.includes(o.origem) || !MODOS.includes(o.modo)) return null;
    if (typeof o.id !== 'string' || o.id.length > 24) return null;
    if (!Array.isArray(o.p) || o.p.length > MAX_PONTOS_MSG * 2 || o.p.length % 2 !== 0) return null;
    if (!o.p.every(num01)) return null;
    if (o.modo !== 'limpar' && (!o.id || o.p.length === 0)) return null;
    return { alvo: o.alvo, origem: o.origem, modo: o.modo, id: o.id, pontos: o.p };
  }

  // Onde a imagem realmente aparece dentro do quadro (o vídeo é "contain": sobram faixas pretas).
  function retanguloDaImagem(larguraQuadro, alturaQuadro, larguraVideo, alturaVideo) {
    if (!(larguraQuadro > 0 && alturaQuadro > 0)) return { x: 0, y: 0, w: 0, h: 0 };
    if (!(larguraVideo > 0 && alturaVideo > 0)) return { x: 0, y: 0, w: larguraQuadro, h: alturaQuadro };
    const escala = Math.min(larguraQuadro / larguraVideo, alturaQuadro / alturaVideo);
    const w = larguraVideo * escala, h = alturaVideo * escala;
    return { x: (larguraQuadro - w) / 2, y: (alturaQuadro - h) / 2, w, h };
  }
  const paraNormalizado = (px, py, r) => (r.w > 0 && r.h > 0 ? [(px - r.x) / r.w, (py - r.y) / r.h] : [0, 0]);
  const paraPixels = (nx, ny, r) => [r.x + nx * r.w, r.y + ny * r.h];

  // Cada pessoa desenha numa cor própria, sempre a mesma (sai do nome de identidade).
  function corDoAutor(identidade) {
    let h = 0;
    const t = String(identidade);
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return 'hsl(' + (h % 360) + ', 92%, 62%)';
  }

  // Traços ativos por (transmissão, autor). Cada um vive VIDA_MS depois do último ponto.
  function criarRegistro() {
    const tracos = new Map(); // chave "alvo|origem" -> Map(autor -> Map(id -> {modo, pontos, ultimo}))
    const chaveDe = (alvo, origem) => alvo + '|' + origem;
    return {
      adicionar(alvo, origem, autor, modo, id, pontos, agora) {
        const k = chaveDe(alvo, origem);
        if (!tracos.has(k)) tracos.set(k, new Map());
        const porAutor = tracos.get(k);
        if (!porAutor.has(autor)) { if (porAutor.size >= MAX_AUTORES) return false; porAutor.set(autor, new Map()); }
        const meus = porAutor.get(autor);
        if (!meus.has(id)) {
          if (meus.size >= MAX_TRACOS_POR_AUTOR) meus.delete(meus.keys().next().value); // descarta o mais antigo
          meus.set(id, { modo, pontos: [], ultimo: agora });
        }
        const t = meus.get(id);
        if (t.pontos.length / 2 + pontos.length / 2 > MAX_PONTOS_TRACO) return false;
        if (modo === 'seta') t.pontos = pontos.slice(0, 4); // seta: só começo e fim (o último mensagem vale)
        else t.pontos.push(...pontos);
        t.ultimo = agora;
        return true;
      },
      limpar(alvo, origem, autor) { const p = tracos.get(chaveDe(alvo, origem)); if (p) p.delete(autor); },
      removerAutor(autor) { tracos.forEach((p) => p.delete(autor)); },
      limparTudo() { tracos.clear(); },
      // Devolve o que desenhar agora, com a opacidade de cada traço, e joga fora o que já expirou.
      ativos(alvo, origem, agora) {
        const k = chaveDe(alvo, origem);
        const p = tracos.get(k);
        const saida = [];
        if (!p) return saida;
        p.forEach((meus, autor) => {
          meus.forEach((t, id) => {
            const idade = agora - t.ultimo;
            if (idade >= VIDA_MS) { meus.delete(id); return; }
            const alfa = idade < VIDA_MS - DESVANECE_MS ? 1 : (VIDA_MS - idade) / DESVANECE_MS;
            saida.push({ autor, id, modo: t.modo, pontos: t.pontos, alfa });
          });
          if (meus.size === 0) p.delete(autor);
        });
        if (p.size === 0) tracos.delete(k);
        return saida;
      },
      temAlgo() { return tracos.size > 0; }
    };
  }

  const Desenho = { TOPICO, MODOS, MAX_PONTOS_MSG, VIDA_MS, criarMensagem, lerMensagem, retanguloDaImagem, paraNormalizado, paraPixels, corDoAutor, criarRegistro };
  if (typeof module !== 'undefined' && module.exports) module.exports = Desenho;
  else raiz.Desenho = Desenho;
})(typeof window !== 'undefined' ? window : globalThis);

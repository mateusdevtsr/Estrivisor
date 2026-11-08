'use strict';
// ============================================================
// Estilo do app (cores, fonte, formato dos cantos e dos ícones, tamanho da interface).
// Aqui ficam só as regras (valores permitidos, conversões, validação), sem tocar na tela,
// para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Estilo.
// Nada daqui é executado como código: tudo vira só valor de variável CSS, depois de validado.
// ============================================================
(function (raiz) {
  const COR = /^#[0-9a-fA-F]{6}$/;
  const CHAVES_COR = ['bg', 'painel', 'painel2', 'borda', 'texto', 'textoFraco', 'sinal', 'acento', 'botao', 'campo'];
  const CHAVES_BASE = ['bg', 'painel', 'texto', 'sinal'];

  const TEMAS = {
    padrao:    { nome: 'Padrão',      cores: { bg: '#0b0d10', painel: '#14171b', painel2: '#181b1f', borda: '#23272c', texto: '#e8eaed', textoFraco: '#8a919a', sinal: '#ff4d4d', acento: '#ffb020', botao: '#262b31', campo: '#0e1013' } },
    meianoite: { nome: 'Meia-noite',  cores: { bg: '#070b14', painel: '#0d1424', painel2: '#111a2e', borda: '#1c2742', texto: '#e6ecff', textoFraco: '#8a96b8', sinal: '#4f8cff', acento: '#7cc4ff', botao: '#1a2540', campo: '#0a101d' } },
    floresta:  { nome: 'Floresta',    cores: { bg: '#0a0f0c', painel: '#111a14', painel2: '#15201a', borda: '#1f2e25', texto: '#e6f0e9', textoFraco: '#86a092', sinal: '#3bd671', acento: '#d9c24a', botao: '#1d2b22', campo: '#0c130e' } },
    porsol:    { nome: 'Pôr do sol',  cores: { bg: '#120a10', painel: '#1c1018', painel2: '#22141d', borda: '#34202c', texto: '#f5e8ee', textoFraco: '#b08a9c', sinal: '#ff5c8a', acento: '#ffb347', botao: '#2f1b28', campo: '#160c13' } },
    roxo:      { nome: 'Roxo',        cores: { bg: '#0d0a14', painel: '#151020', painel2: '#1a1428', borda: '#2a2040', texto: '#ece6ff', textoFraco: '#9a8bb8', sinal: '#a06bff', acento: '#ff9ad5', botao: '#231a38', campo: '#0f0b18' } },
    grafite:   { nome: 'Grafite',     cores: { bg: '#101010', painel: '#1a1a1a', painel2: '#202020', borda: '#2c2c2c', texto: '#eeeeee', textoFraco: '#999999', sinal: '#d0d0d0', acento: '#ffb020', botao: '#2a2a2a', campo: '#131313' } },
    // Os temas abaixo partem de 4 cores e o resto é derivado (as bordas, botões etc. acompanham).
    oceano:    { nome: 'Oceano',      cores: derivar({ bg: '#06101a', painel: '#0c1c2b', texto: '#e4f3fb', sinal: '#17b8c4' }) },
    neon:      { nome: 'Neon',        cores: derivar({ bg: '#07050d', painel: '#110b1d', texto: '#f3eaff', sinal: '#ff2fd0' }) },
    vampiro:   { nome: 'Vampiro',     cores: derivar({ bg: '#14080b', painel: '#220e13', texto: '#f6e6e8', sinal: '#f0495d' }) },
    rosa:      { nome: 'Rosa',        cores: derivar({ bg: '#150a12', painel: '#241320', texto: '#fbe9f4', sinal: '#ff7ab8' }) },
    cafe:      { nome: 'Café',        cores: derivar({ bg: '#120d09', painel: '#1e1610', texto: '#f1e7dc', sinal: '#d08a4a' }) },
    contraste: { nome: 'Alto contraste', cores: { ...derivar({ bg: '#000000', painel: '#0a0a0a', texto: '#ffffff', sinal: '#ffe600' }), textoFraco: '#d0d0d0', borda: '#5a5a5a' } },
  };

  // Só fontes que já vêm no Windows (o app não baixa fontes de fora).
  const FONTES = {
    padrao:   { nome: 'Padrão do app', css: '-apple-system, "Segoe UI", Inter, sans-serif' },
    segoe:    { nome: 'Segoe UI',      css: '"Segoe UI", sans-serif' },
    arial:    { nome: 'Arial',         css: 'Arial, Helvetica, sans-serif' },
    verdana:  { nome: 'Verdana',       css: 'Verdana, Geneva, sans-serif' },
    tahoma:   { nome: 'Tahoma',        css: 'Tahoma, Geneva, sans-serif' },
    trebuchet:{ nome: 'Trebuchet MS',  css: '"Trebuchet MS", sans-serif' },
    georgia:  { nome: 'Georgia (com serifa)', css: 'Georgia, "Times New Roman", serif' },
    consolas: { nome: 'Consolas (código)',    css: 'Consolas, "Courier New", monospace' },
    comic:    { nome: 'Comic Sans',    css: '"Comic Sans MS", "Comic Sans", cursive' },
  };

  const AVATARES = { circulo: '50%', arredondado: '28%', quadrado: '6px' };
  const LIMITES = { raio: [0, 20, 6], zoom: [80, 150, 100] };

  function hexParaRgb(hex) {
    return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  }
  function rgbParaHex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  // Mistura duas cores (parte = quanto da segunda, de 0 a 1).
  function misturar(a, b, parte) {
    const x = hexParaRgb(a), y = hexParaRgb(b);
    return rgbParaHex(x.map((v, i) => v + (y[i] - v) * parte));
  }

  // Quando a pessoa muda uma das 4 cores principais, as outras (bordas, botões...) acompanham.
  function derivar(base) {
    const { bg, painel, texto, sinal } = base;
    return {
      bg, painel, texto, sinal,
      painel2: misturar(painel, '#ffffff', 0.017),
      borda: misturar(painel, '#ffffff', 0.065),
      botao: misturar(painel, '#ffffff', 0.078),
      campo: misturar(bg, '#ffffff', 0.015),
      textoFraco: misturar(texto, painel, 0.42),
      acento: misturar(sinal, '#ffffff', 0.35),
    };
  }

  const limitar = (v, [min, max, padrao]) => (Number.isInteger(v) && v >= min && v <= max ? v : padrao);

  function estadoPadrao() {
    return { tema: 'padrao', cores: { ...TEMAS.padrao.cores }, fonte: 'padrao', raio: LIMITES.raio[2], avatar: 'circulo', zoom: LIMITES.zoom[2] };
  }

  // Aceita qualquer coisa vinda do armazenamento e devolve um estado seguro.
  function validar(bruto) {
    const padrao = estadoPadrao();
    const b = bruto && typeof bruto === 'object' ? bruto : {};
    const tema = typeof b.tema === 'string' && (TEMAS[b.tema] || b.tema === 'personalizado') ? b.tema : 'padrao';
    const cores = TEMAS[tema] ? { ...TEMAS[tema].cores } : { ...padrao.cores };
    if (tema === 'personalizado' && b.cores && typeof b.cores === 'object') {
      for (const k of CHAVES_COR) if (typeof b.cores[k] === 'string' && COR.test(b.cores[k])) cores[k] = b.cores[k].toLowerCase();
    }
    return {
      tema,
      cores,
      fonte: typeof b.fonte === 'string' && Object.prototype.hasOwnProperty.call(FONTES, b.fonte) ? b.fonte : 'padrao',
      raio: limitar(b.raio, LIMITES.raio),
      avatar: typeof b.avatar === 'string' && Object.prototype.hasOwnProperty.call(AVATARES, b.avatar) ? b.avatar : 'circulo',
      zoom: limitar(b.zoom, LIMITES.zoom),
    };
  }

  const rgbTexto = (hex) => hexParaRgb(hex).join(',');

  // Variáveis CSS que o estado produz (só valores já validados).
  function variaveis(e) {
    const c = e.cores;
    return {
      '--bg': c.bg, '--painel': c.painel, '--painel2': c.painel2, '--borda': c.borda, '--texto': c.texto,
      '--texto-fraco': c.textoFraco, '--sinal': c.sinal, '--acento': c.acento, '--botao': c.botao, '--campo': c.campo,
      '--painel-rgb': rgbTexto(c.painel), '--painel2-rgb': rgbTexto(c.painel2),
      '--raio': e.raio + 'px', '--raio-grande': Math.round(e.raio * 1.6) + 'px', '--raio-avatar': AVATARES[e.avatar],
    };
  }

  const api = { TEMAS, FONTES, AVATARES, LIMITES, CHAVES_COR, CHAVES_BASE, misturar, derivar, validar, variaveis, estadoPadrao };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Estilo = api;
})(typeof window !== 'undefined' ? window : globalThis);

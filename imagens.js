// Imagens, GIFs e prints no chat: regras puras (sem tela), testadas em testes/imagens.test.js.
(function (raiz) {
    'use strict';
    const MAX_BYTES = 6 * 1024 * 1024;       // o servidor recusa acima disso
    const LIMITE_SEM_REDUZIR = 1.5 * 1024 * 1024;
    const LADO_MAXIMO = 1920;                // imagens maiores que isso são reduzidas antes de enviar
    const LADO_SEM_REDUZIR = 2560;
    const TIPOS = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

    // Descobre o formato pelos primeiros bytes (Uint8Array). Devolve o tipo ou null.
    function tipoPorBytes(u8) {
        if (!u8 || u8.length < 16) return null;
        const txt = (i, n) => String.fromCharCode.apply(null, Array.from(u8.slice(i, i + n)));
        if (u8[0] === 0x89 && txt(1, 3) === 'PNG') return 'image/png';
        if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
        const g = txt(0, 6);
        if (g === 'GIF87a' || g === 'GIF89a') return 'image/gif';
        if (txt(0, 4) === 'RIFF' && txt(8, 4) === 'WEBP') return 'image/webp';
        return null;
    }

    // Tamanho final ao reduzir: o maior lado vira no máximo "max", mantendo a proporção.
    function dimensoesAlvo(w, h, max) {
        const lim = max || LADO_MAXIMO;
        if (!(w > 0) || !(h > 0)) return { w: 0, h: 0, mudou: false };
        const maior = Math.max(w, h);
        if (maior <= lim) return { w, h, mudou: false };
        const f = lim / maior;
        return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)), mudou: true };
    }

    // GIF nunca é refeito (perderia a animação); o resto só é refeito se for pesado ou enorme.
    function deveReencodar({ tipo, bytes, w, h }) {
        if (tipo === 'image/gif') return false;
        return bytes > LIMITE_SEM_REDUZIR || Math.max(w || 0, h || 0) > LADO_SEM_REDUZIR;
    }

    function formatarTamanho(bytes) {
        const n = Number(bytes) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
        return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
    }

    function nomeDoArquivo(tipo, base) {
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[tipo] || 'img';
        const limpo = String(base || 'imagem').replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 40) || 'imagem';
        return limpo + '.' + ext;
    }

    // Tamanho da miniatura no chat (cabe numa caixa de max × max, sem ampliar).
    function caixaDeExibicao(w, h, maxW, maxH) {
        const mw = maxW || 420, mh = maxH || 320;
        if (!(w > 0) || !(h > 0)) return null;
        const f = Math.min(1, mw / w, mh / h);
        return { w: Math.max(1, Math.round(w * f)), h: Math.max(1, Math.round(h * f)) };
    }

    // O que o servidor mandou sobre a imagem da mensagem; null se vier algo estranho.
    function imagemRecebida(img) {
        if (!img || typeof img !== 'object' || !TIPOS.includes(img.tipo)) return null;
        const inteiro = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : null);
        return { tipo: img.tipo, bytes: Number(img.bytes) || 0, w: inteiro(img.w), h: inteiro(img.h) };
    }

    // De uma lista de itens da área de transferência (ou arquivos), qual é a imagem? Só pega se não houver texto:
    // copiar um trecho de página traz texto + imagem, e nesse caso colar o texto é o que a pessoa quer.
    function escolherImagemColada(itens) {
        const lista = Array.from(itens || []);
        if (lista.some((i) => i.kind === 'string' && i.type === 'text/plain')) return null;
        return lista.find((i) => i.kind === 'file' && TIPOS.includes(i.type)) || null;
    }

    const api = { MAX_BYTES, LADO_MAXIMO, TIPOS, tipoPorBytes, dimensoesAlvo, deveReencodar, formatarTamanho, nomeDoArquivo, caixaDeExibicao, imagemRecebida, escolherImagemColada };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.Imagens = api;
})(typeof window !== 'undefined' ? window : globalThis);

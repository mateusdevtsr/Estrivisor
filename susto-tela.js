'use strict';
// Tela do susto: mostra a imagem por cima de tudo, toca o som e fecha sozinha
// (no tempo do som, entre 3 e 8 segundos; sem som, 4 segundos). Clique ou Esc fecha antes.
(function () {
  const img = document.getElementById('imagem');
  let timer = null;
  const fechar = () => window.sustoAPI.fechar();
  const fecharEm = (ms) => { clearTimeout(timer); timer = setTimeout(fechar, ms); };
  document.addEventListener('click', fechar);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') fechar(); });
  window.sustoAPI.aoReceber((d) => {
    if (!d || typeof d.imagem !== 'string' || !/^data:image\/(png|jpeg|gif|webp);base64,/.test(d.imagem)) return fechar();
    img.src = d.imagem;
    fecharEm(4000);
    if (typeof d.som === 'string' && /^data:audio\/(mpeg|ogg|wav);base64,/.test(d.som) && !d.mudo) {
      const a = new Audio(d.som);
      a.volume = 0.85;
      a.addEventListener('loadedmetadata', () => {
        const s = Number.isFinite(a.duration) ? a.duration * 1000 + 300 : 4000;
        fecharEm(Math.min(8000, Math.max(3000, s)));
      });
      a.play().catch(() => {});
    }
  });
})();

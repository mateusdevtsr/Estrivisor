// ============================================================
// Tela do celular: a mesma tela do PC, reorganizada para uma coluna.
// - Canais (com a barra de servidores) e Membros viram gavetas que abrem pelos botões ☰ e 👥.
// - Quem está numa chamada ganha uma barrinha embaixo com microfone, som e sair (são os mesmos
//   botões do PC, só "apertados" daqui).
// - O botão Voltar do Android fecha o que estiver aberto (janela, gaveta) antes de sair do app.
// O visual fica em celular.css.
// ============================================================
export function iniciarTelaCelular({ App }) {
  document.documentElement.classList.add('celular');
  const pronto = () => {
    document.body.classList.add('celular');
    montar();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pronto);
  else pronto();

  function montar() {
    const corpo = document.body;
    const botao = (id, texto, rotulo) => {
      const b = document.createElement('button');
      b.type = 'button'; b.id = id; b.textContent = texto;
      b.setAttribute('aria-label', rotulo); b.title = rotulo;
      return b;
    };
    const veu = document.createElement('div'); veu.id = 'celular-veu';
    const menu = botao('celular-menu', '☰', 'Servidores e canais');
    const pessoas = botao('celular-pessoas', '👥', 'Pessoas');
    corpo.append(veu, menu, pessoas);

    const fecharGavetas = () => corpo.classList.remove('celular-canais-aberto', 'celular-membros-aberto');
    const abrir = (qual) => { fecharGavetas(); corpo.classList.add(qual); };
    menu.addEventListener('click', () => (corpo.classList.contains('celular-canais-aberto') ? fecharGavetas() : abrir('celular-canais-aberto')));
    pessoas.addEventListener('click', () => (corpo.classList.contains('celular-membros-aberto') ? fecharGavetas() : abrir('celular-membros-aberto')));
    veu.addEventListener('click', fecharGavetas);

    // Escolheu um canal (ou abriu Amigos/DMs): fecha a gaveta e mostra a conversa.
    document.addEventListener('click', (e) => {
      if (!corpo.classList.contains('celular-canais-aberto')) return;
      if (e.target.closest('.coluna-canais .item-canal, .barra-servidores .btn-servidor[title^="Amigos"]')) setTimeout(fecharGavetas, 120);
    }, true);

    // Arrastar da borda esquerda abre os canais; arrastar a gaveta pro lado fecha.
    let toque = null;
    document.addEventListener('touchstart', (e) => {
      const t = e.touches[0]; toque = { x: t.clientX, y: t.clientY, tempo: Date.now() };
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!toque) return;
      const t = e.changedTouches[0], dx = t.clientX - toque.x, dy = Math.abs(t.clientY - toque.y);
      const rapido = Date.now() - toque.tempo < 600;
      if (rapido && Math.abs(dx) > 70 && dy < 50 && !document.querySelector('.tela-config[style*="flex"], [role="dialog"][style*="flex"]')) {
        if (dx > 0 && toque.x < 30) abrir('celular-canais-aberto');
        else if (dx < 0 && corpo.classList.contains('celular-canais-aberto')) fecharGavetas();
        else if (dx > 0 && corpo.classList.contains('celular-membros-aberto')) fecharGavetas();
      }
      toque = null;
    }, { passive: true });

    // Barrinha da chamada (embaixo da conversa): espelha os botões do rodapé do PC.
    const barra = document.createElement('div'); barra.id = 'celular-voz';
    const nome = document.createElement('span'); nome.className = 'celular-voz-nome';
    const espelhos = [
      ['btn-microfone-rodape', 'Microfone'],
      ['btn-surdo-rodape', 'Som'],
      ['btn-sair-voz', 'Sair da chamada']
    ].map(([id, rotulo]) => {
      const original = document.getElementById(id);
      const b = botao('celular-' + id, original ? original.textContent : '•', rotulo);
      b.addEventListener('click', () => { const o = document.getElementById(id); if (o && !o.disabled) o.click(); });
      if (original) {
        const copiar = () => { b.textContent = original.textContent; b.className = original.className; b.disabled = original.disabled; };
        copiar();
        new MutationObserver(copiar).observe(original, { attributes: true, childList: true, characterData: true, subtree: true });
      }
      return b;
    });
    barra.append(nome, ...espelhos);
    const coluna = document.querySelector('.coluna-principal');
    if (coluna) coluna.appendChild(barra);
    const status = document.getElementById('status-voz-persistente');
    const atualizarBarra = () => {
      const emVoz = status && status.style.display !== 'none';
      corpo.classList.toggle('celular-em-voz', Boolean(emVoz));
      const canal = document.getElementById('texto-canal-voz');
      nome.textContent = emVoz && canal ? '🔊 ' + canal.textContent : '';
    };
    if (status) new MutationObserver(atualizarBarra).observe(status, { attributes: true, subtree: true, childList: true, characterData: true });
    atualizarBarra();

    // Amigos e mensagens diretas: no celular mostra a lista OU a conversa, com um botão de voltar.
    const telaAmigos = document.getElementById('tela-amigos');
    const chatDmTela = document.getElementById('amigos-chat');
    const cabAmigos = telaAmigos && telaAmigos.querySelector('.amigos-cab');
    if (telaAmigos && chatDmTela && cabAmigos) {
      const voltarDm = botao('celular-voltar-dm', '‹', 'Voltar para a lista de amigos');
      voltarDm.addEventListener('click', () => {
        // Fecha e reabre a tela de amigos: a conversa é fechada direitinho (conta como lida, etc.).
        if (typeof window.fecharAmigos === 'function' && typeof window.abrirAmigos === 'function') { window.fecharAmigos(); window.abrirAmigos(); }
      });
      cabAmigos.prepend(voltarDm);
      const marcar = () => telaAmigos.classList.toggle('celular-com-conversa', chatDmTela.style.display === 'flex');
      new MutationObserver(marcar).observe(chatDmTela, { attributes: true, attributeFilter: ['style'] });
      marcar();
    }

    // Abriu uma conversa pela notificação: mostra a conversa (sem gaveta por cima).
    let abertoPorAviso = false;
    document.addEventListener('estrivisor-abriu-conversa', () => { abertoPorAviso = true; fecharGavetas(); });

    // Sem nenhum canal aberto (começo): já mostra a lista de canais.
    setTimeout(() => {
      const vazio = document.getElementById('area-vazia');
      if (!abertoPorAviso && vazio && getComputedStyle(vazio).display !== 'none') abrir('celular-canais-aberto');
    }, 1500);

    // Botão Voltar do Android.
    const algoAberto = () => [...document.querySelectorAll('[role="dialog"], .tela-config, .tela-amigos, .menu-contexto, #lightbox-imagem')]
      .some((el) => el.isConnected && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
    App.addListener('backButton', () => {
      if (document.querySelector('.menu-contexto')) { document.querySelector('.menu-contexto').remove(); return; }
      const vDm = document.getElementById('celular-voltar-dm');
      if (vDm && telaAmigos && getComputedStyle(telaAmigos).display !== 'none' && telaAmigos.classList.contains('celular-com-conversa')) { vDm.click(); return; }
      if (algoAberto()) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      if (corpo.classList.contains('celular-membros-aberto')) { fecharGavetas(); return; }
      // Na lista de canais (a "tela inicial"), Voltar manda o app pro fundo. A chamada continua.
      if (corpo.classList.contains('celular-canais-aberto')) { App.minimizeApp(); return; }
      abrir('celular-canais-aberto');
    });
  }
}

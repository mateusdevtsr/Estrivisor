'use strict';
// ============================================================
// "O que há de novo": a lista de novidades de cada versão e a regra de quando mostrar.
// A janela aparece uma vez depois de cada atualização (e fica em Configurações > Sobre).
// Aqui ficam só os dados e as regras, sem tocar na tela, para dar para testar com "node --test".
// A CADA VERSÃO NOVA: acrescente um bloco no TOPO da lista NOVIDADES (a versão do package.json tem que bater).
// ============================================================
(function (raiz) {
  // i = ícone, t = título curto, d = o que é, c = como usar / onde fica
  // Escrito para quem USA o app: curto, no tom de conversa, com detalhe técnico só quando ajuda a usar
  // (formato, limite, atalho, onde fica). Nada sobre servidor, código ou como foi feito por dentro.
  const NOVIDADES = [
    {
      versao: '3.15.2', titulo: 'Ajustes e o app do celular no site',
      itens: [
        { i: '📱', t: 'Android direto no site', d: 'Agora dá pra baixar o Estrivisor para Android no site, do lado do botão do Windows. É só mandar o link pros amigos.', c: 'estrivisor.com.br > "Baixar para Android".' },
        { i: '📰', t: 'Novidades mais fáceis de ler', d: 'Esta tela ficou mais curta e direta. E as próximas novidades também vão aparecer no canal de atualizações do Discord.', c: 'Configurações > Sobre > O que há de novo.' }
      ]
    },
    {
      versao: '3.15.1', titulo: 'Estrivisor no celular',
      itens: [
        { i: '📱', t: 'Agora tem app para Android', d: 'Entre com o mesmo Discord e está tudo lá: servidores, canais, mensagens, amigos e chamadas de voz com quem está no PC. Dá pra usar os efeitos de voz também. A chamada continua mesmo com a tela apagada.', c: 'Baixe em estrivisor.com.br, no botão "Baixar para Android", e instale no celular.' },
        { i: '🔔', t: 'Avisos no celular', d: 'Com o app fechado, o celular avisa quando chega mensagem direta ou quando alguém te marca com @ (ex.: "@Mateus bora?"). Se quiser, dá pra receber tudo dos canais também. Tocar no aviso abre a conversa.', c: 'No app do celular: Configurações > Sons do app > Notificações no celular.' }
      ]
    },
    {
      versao: '3.15.0', titulo: 'Imagens no chat, pedaleira de efeitos e configurações novas',
      itens: [
        { i: '🖼️', t: 'Imagens, GIFs e prints no chat', d: 'Mande foto, print ou GIF nos canais e nas mensagens diretas, com legenda se quiser. Quem entrar depois também vê. Aceita PNG, JPG, GIF e WEBP de até 6 MB, e prints grandes ficam menores sozinhos.', c: 'Botão 🖼️ ao lado da caixa de texto, Ctrl+V com um print copiado (Win+Shift+S) ou arraste a imagem pro chat.' },
        { i: '🔍', t: 'Ver a imagem grande', d: 'Clique numa imagem pra ampliar. Lá dá pra copiar ou salvar no computador.', c: 'Clique na imagem da mensagem.' },
        { i: '🎛️', t: 'Crie o seu efeito de voz', d: 'Uma pedaleira com tom, graves e agudos, robô, distorção, vibrato, eco, ambiente e mais. Gire os botões e ouça na hora. Dá pra começar de um modelo pronto e segurar "sem efeito" pra comparar com a sua voz.', c: 'Configurações > Voz e áudio > Efeito de voz > "Criar efeito".' },
        { i: '🎭', t: 'Efeitos de voz novos', d: 'Rádio antigo, Megafone, Caverna, Alienígena, Demônio, Debaixo d\'água e Bêbado. E dá pra trocar o efeito direto na chamada: botão direito no seu nome.', c: 'Botão direito no seu nome na chamada > Efeito de voz.' },
        { i: '⚙️', t: 'Configurações mais fáceis de achar', d: 'As opções estão mais organizadas e tem uma busca: digite "ruído", por exemplo, e vá direto na opção. Os filtros de áudio mais técnicos ficaram em "Avançado".', c: 'Configurações (Ctrl + ,) > "Procurar configuração", no topo.' },
        { i: '🎙️', t: 'Entra na chamada já falando', d: 'O microfone liga sozinho quando você entra numa chamada. Prefere entrar mudo? É só desligar.', c: 'Configurações > Voz e áudio > Ao entrar numa chamada.' },
        { i: '🎧', t: 'Mexer no áudio sem cair', d: 'Trocar o microfone ou os filtros no meio da chamada não te deixa mais mudo. E se você parar de ouvir alguém, dá pra consertar sem sair da sala.', c: 'Setinha ao lado do fone, no rodapé > "Não ouço alguém: refazer o áudio".' },
        { i: '🖱️', t: 'Menu no nome das pessoas', d: 'Clique no nome de alguém (online ou não) pra ver o perfil, mandar mensagem, adicionar amigo, entrar na mesma chamada ou denunciar. Na chamada, o botão direito no nome ajusta o volume daquela pessoa e da transmissão dela.', c: 'Lista de membros, à direita, ou a lista da chamada.' },
        { i: '🔱', t: 'Cargos à vista', d: 'Embaixo do nome aparecem os cargos: 🔱 Fundador, 🛡️ Moderador e 👑 Dono do servidor.', c: 'Lista de membros, à direita.' },
        { i: '🛡️', t: 'Mais segurança', d: 'Quem foi expulso de um servidor não volta com convite. E se o apelido de alguém for diferente do nome da conta, o nome da conta aparece entre parênteses, pra ninguém se passar por outra pessoa.', c: 'Ajustes do servidor > Membros.' },
        { i: '📋', t: 'Copiar e colar', d: 'O botão direito agora tem Copiar e Colar nos textos e nos links, e cada mensagem tem um botão pra copiar o texto inteiro.', c: 'Botão direito no texto, ou o 📋 que aparece ao passar o mouse na mensagem.' }
      ]
    },
    {
      versao: '3.14.0', titulo: 'Soundboard e sala de cinema',
      itens: [
        { i: '🔊', t: 'Soundboard do servidor', d: 'Cada servidor tem os seus sons pra tocar na chamada, e qualquer um pode mandar um novo (até 6 segundos, em mp3, ogg, webm ou m4a).', c: 'Na chamada, botão 🔈 na barra de baixo.' },
        { i: '🏅', t: 'Medalhas na lista', d: 'As conquistas de cada pessoa aparecem embaixo do nome. Passe o mouse pra ver qual é qual.', c: 'Lista de membros, à direita.' },
        { i: '🎬', t: 'Sala de cinema', d: 'Assistam o mesmo vídeo juntos e no mesmo ponto. Cada um abre o mesmo arquivo no próprio PC, e quem começou controla o play e a pausa. Funciona melhor com mp4 ou webm.', c: 'Na chamada, botão 🎬 na barra de baixo.' }
      ]
    },
    {
      versao: '3.13.0', titulo: 'Perfil, conquistas e resumo',
      itens: [
        { i: '👤', t: 'Perfil', d: 'Veja quanto tempo alguém passou em chamada, quantas mensagens mandou, com quem mais fala e os jogos que mais transmite.', c: 'Clique na pessoa na lista e escolha "Ver perfil". O seu fica na sua foto, no canto de baixo.' },
        { i: '🏆', t: 'Conquistas', d: 'Medalhas engraçadas, tipo "Coruja de plantão" (chamada de madrugada) e "Inseparáveis" (horas com a mesma pessoa). As que faltam mostram quanto falta.', c: 'No perfil.' },
        { i: '📊', t: 'Meu resumo', d: 'O seu mês ou o seu ano em números, estilo "Wrapped": horas em chamada, dia mais falante, jogo mais transmitido e mais.', c: 'No seu perfil > "Meu resumo".' },
        { i: '🔒', t: 'Você escolhe o que mostra', d: 'Dá pra deixar o perfil privado. Registrar o jogo que você transmite é opcional e vem desligado.', c: 'Configurações > Privacidade.' },
        { i: '🔗', t: 'Prévia de links consertada', d: 'O cartão com título e descrição do link voltou a aparecer.', c: 'Aparece sozinho quando alguém manda um link.' }
      ]
    },
    {
      versao: '3.12.0', titulo: 'Reações, status e prévia de links',
      itens: [
        { i: '😀', t: 'Reações', d: 'Reaja a qualquer mensagem com um emoji. Clique numa reação que já está lá pra reagir também.', c: 'Passe o mouse na mensagem e clique no 😀.' },
        { i: '💬', t: 'Status', d: 'Uma frase curta embaixo do seu nome, tipo "🎮 jogando Wardogs". Todo mundo do servidor vê.', c: 'Clique no seu nome, no canto de baixo à esquerda.' },
        { i: '🔗', t: 'Prévia de links', d: 'Link no chat vira um cartão com título e descrição da página. O site não fica sabendo do seu IP.', c: 'Pra desligar: Configurações > Privacidade > Mensagens.' }
      ]
    },
    {
      versao: '3.11.0', titulo: 'Temas, efeitos de voz e desenho na tela',
      itens: [
        { i: '🎨', t: 'Temas prontos', d: 'Troque o visual com um clique: Oceano, Neon, Vampiro, Rosa, Café e Alto contraste.', c: 'Configurações > Aparência.' },
        { i: '🤖', t: 'Efeitos de voz', d: 'Fale como robô, com voz grossa ou voz fina. Todo mundo na chamada ouve.', c: 'Configurações > Voz e áudio > Efeito de voz.' },
        { i: '👀', t: 'Quem está vendo sua tela', d: 'Quando você transmite, aparece no canto quem está assistindo.', c: 'Etiqueta 👀 no canto da sua transmissão.' },
        { i: '✏️', t: 'Desenhar na tela de alguém', d: 'Aponte, circule ou desenhe na transmissão. Todo mundo vê, e o desenho some sozinho em alguns segundos.', c: 'Abra a transmissão em tela grande e clique no ✏️.' }
      ]
    },
    {
      versao: '3.10.1', titulo: 'Voz mais limpa e arquivos na chamada',
      itens: [
        { i: '🎙️', t: 'Adeus barulho de teclado', d: 'Um filtro novo tira teclado, mouse, ventilador e conversa de fundo do seu microfone. Já vem ligado.', c: 'Configurações > Voz e áudio. Use "Testar microfone" (com fone) pra ouvir a diferença.' },
        { i: '🚪', t: 'Porta de ruído', d: 'Corta o microfone quando você não está falando.', c: 'Configurações > Voz e áudio > Avançado > Porta de ruído.' },
        { i: '📎', t: 'Mandar arquivos na chamada', d: 'Foto, vídeo ou qualquer arquivo de até 100 MB pra quem está na chamada. Cada um escolhe se aceita.', c: 'Na chamada, botão 📎 na barra de baixo, ou arraste o arquivo pra janela.' },
        { i: '👥', t: 'Quem está offline', d: 'A lista da direita também mostra quem não está online, mais apagado.', c: 'Lista de membros, seção "OFFLINE".' }
      ]
    },
    {
      versao: '3.10.0', titulo: 'Janela flutuante e personalização',
      itens: [
        { i: '🪟', t: 'Janela flutuante', d: 'Uma janelinha por cima do jogo mostra quem está falando, sem precisar sair do jogo.', c: 'Configurações > Janela flutuante. Ctrl+Shift+F mostra e esconde de qualquer programa.' },
        { i: '🎨', t: 'Cores e imagens', d: 'Mude as cores do app e coloque imagens ou animações em cada parte da tela.', c: 'Configurações > Aparência.' },
        { i: '🔊', t: 'Seus sons', d: 'Troque o som de cada aviso do app ou desligue os que não quiser.', c: 'Configurações > Sons do app.' }
      ]
    }
  ];

  function partesDaVersao(v) {
    return String(v == null ? '' : v).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10)).map((n) => (Number.isFinite(n) ? n : 0));
  }
  // Compara "3.10.1" com "3.9.0" número por número (devolve >0 se a > b).
  function compararVersoes(a, b) {
    const x = partesDaVersao(a), y = partesDaVersao(b);
    for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // Quais novidades mostrar: as versões depois da última que a pessoa viu, até a versão atual.
  // Sem registro de "última vista" (primeira vez com este recurso) mostra só a mais recente. No máximo 3.
  function novidadesParaMostrar(ultimaVista, versaoAtual, lista = NOVIDADES) {
    const ate = lista.filter((n) => compararVersoes(n.versao, versaoAtual) <= 0);
    if (!ate.length) return [];
    if (!ultimaVista) return ate.slice(0, 1);
    return ate.filter((n) => compararVersoes(n.versao, ultimaVista) > 0).slice(0, 3);
  }

  const Novidades = { NOVIDADES, compararVersoes, novidadesParaMostrar };
  if (typeof module !== 'undefined' && module.exports) module.exports = Novidades;
  else raiz.Novidades = Novidades;
})(typeof window !== 'undefined' ? window : globalThis);

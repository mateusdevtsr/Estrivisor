'use strict';
// ============================================================
// "O que há de novo": a lista de novidades de cada versão e a regra de quando mostrar.
// A janela aparece uma vez depois de cada atualização (e fica em Configurações > Sobre).
// Aqui ficam só os dados e as regras, sem tocar na tela, para dar para testar com "node --test".
// A CADA VERSÃO NOVA: acrescente um bloco no TOPO da lista NOVIDADES (a versão do package.json tem que bater).
// ============================================================
(function (raiz) {
  // i = ícone, t = título curto, d = o que é, c = como usar / onde fica
  const NOVIDADES = [
    {
      versao: '3.15.1', titulo: 'Ajuste da pedaleira de efeitos',
      itens: [
        { i: '🧹', t: 'Mais simples', d: 'Saiu o cartão do VB-CABLE (cabo de áudio virtual) da tela de criar efeito. A pedaleira de efeitos continua igual.', c: 'Configurações > Voz e áudio > Efeito de voz > "Criar efeito".' }
      ]
    },
    {
      versao: '3.15.0', titulo: 'Imagens no chat e configurações mais fáceis',
      itens: [
        { i: '⚙️', t: 'Configurações reorganizadas', d: 'Nada mudou no que você já tinha escolhido, só o lugar. Nova seção Privacidade (perfil privado, registrar jogo, prévia de links e seus dados) e Janela flutuante com seção própria. Em Voz e áudio ficaram primeiro o básico; os filtros de ruído, eco e qualidade estão em "Avançado". E tem uma busca: digite o que procura (ex.: "ruído") e clique no resultado para ir direto na opção.', c: 'Configurações (Ctrl + ,) > campo "Procurar configuração" no topo da lista.' },
        { i: '🖼️', t: 'Enviar imagens, GIFs e prints', d: 'Mande PNG, JPG, GIF (animado) e WEBP nos canais e nas mensagens diretas, com legenda se quiser. As imagens ficam guardadas no servidor, como os sons: quem entrar depois ainda vê. Prints grandes são reduzidos sozinhos antes de enviar (máximo de 6 MB). Nenhuma imagem é apagada por falta de espaço: quando o servidor enche, as mais antigas ficam numa versão reduzida e continuam abrindo.', c: 'Botão 🖼️ ao lado da caixa de texto, ou Ctrl+V com um print copiado (Win+Shift+S), ou arraste a imagem pra cima do chat.' },
        { i: '🔍', t: 'Ampliar, copiar e salvar', d: 'Clique numa imagem do chat pra ver grande. Lá dá pra copiar a imagem (pra colar em outro lugar) ou salvar no computador.', c: 'Clique na imagem da mensagem.' },
        { i: '🎛️', t: 'Pedaleira de efeitos de voz', d: 'Crie o seu próprio efeito numa pedaleira: tom, equalizador, filtros (rádio, telefone, abafada), robô, distorção, vibrato, volume pulsando, eco, ambiente e volume final. Cada pedal liga e desliga, os botões giram com o mouse, e um monitor mostra o som na hora. Dá pra começar de um modelo (robô, demônio, estádio...) e segurar "sem efeito" para comparar com a sua voz normal.', c: 'Configurações > Voz e áudio > Efeito de voz > "Criar efeito" (ou botão direito no seu nome na chamada > Efeito de voz).' },
        { i: '🎤', t: 'Mudar o áudio sem derrubar nada', d: 'Trocar supressão de ruído, eco, volume automático ou o microfone no meio da chamada não muda mais o microfone para mudo e não faz os outros pararem de te ouvir. Se alguém parar de ouvir outra pessoa, tem um botão para refazer o áudio sem sair da chamada.', c: 'Setinha ao lado do fone no rodapé > "Não ouço alguém: refazer o áudio".' },
        { i: '🎭', t: 'Sete efeitos de voz novos', d: 'Rádio antigo, Megafone, Caverna, Alienígena, Demônio, Debaixo d\'água e Bêbado, além de Robô, Voz grossa e Voz fina que já existiam. (O Eco saiu.) Todo mundo na chamada ouve o efeito.', c: 'Configurações > Voz > Efeito de voz. Teste com fone em "Testar microfone".' },
        { i: '🛡️', t: 'Mais segurança', d: 'Quem é expulso de um servidor não volta mais com convite (o dono pode liberar depois, em Ajustes do servidor > Expulsos). Quando o apelido de alguém é diferente do nome da conta, o nome da conta aparece ao lado, entre parênteses, pra ninguém se passar por outra pessoa.', c: 'Ajustes do servidor > Membros > Expulsar, e a lista "Expulsos" logo abaixo.' },
        { i: '🧰', t: 'Painel de administração maior', d: 'Para quem administra o Estrivisor: liberar pessoa pelo ID do Discord, ficha completa de cada pessoa (com notas internas), advertência, encerrar sessões, aviso geral para todos, chamadas ao vivo, gerenciar um servidor por dentro, espaço usado por imagens e sons, modo manutenção, limites e recursos que ligam e desligam na hora, moderadores com poderes limitados e busca nas listas. Para todo mundo: avisos da administração aparecem numa faixa no topo.', c: 'Configurações > Administração (só aparece para administradores e moderadores).' },
        { i: '🔱', t: 'Cargos à vista', d: 'Embaixo do nome, junto das medalhas, aparecem os cargos: 🔱 Fundador (quem criou e administra o Estrivisor), 🛡️ Moderador e 👑 Dono do servidor. Também aparecem na lista da chamada. Quem vira moderador recebe um aviso, e a opção Administração aparece na hora.', c: 'Lista de membros, à direita.' },
        { i: '🖱️', t: 'Menu completo no nome das pessoas', d: 'Clicar (ou clicar com o botão direito) no nome de alguém, online ou offline, abre um menu: ver perfil, mandar mensagem ou adicionar amigo, entrar na mesma chamada, copiar o nome ou o ID do Discord e denunciar. O dono do servidor também pode dar o servidor ou expulsar dali, e a administração vê a ficha, advertir e tornar moderador.', c: 'Lista de membros, à direita.' },
        { i: '🎙️', t: 'Entrar já com o microfone ligado', d: 'Ao entrar numa chamada, o microfone liga sozinho assim que conecta (se você estiver ensurdecido, continua mudo). Prefere entrar mudo? Dá pra desligar a opção.', c: 'Configurações > Voz > Ao entrar numa chamada.' },
        { i: '🎧', t: 'Menu de voz e transmissão na chamada', d: 'Botão direito no nome de quem está na chamada: silenciar só pra você, volume da voz, volume e mudo do som da transmissão, ver a transmissão em tela cheia ou numa janelinha por cima de tudo, e voltar os volumes ao normal. O dono do servidor também pode mutar o microfone pra todos, parar a transmissão e tirar da chamada. No seu próprio nome: microfone, ensurdecer, testar o microfone, transmitir ou parar, sair da chamada e trocar o efeito de voz direto numa lista ao lado, sem abrir as configurações.', c: 'Botão direito no nome, na lista da chamada.' },
        { i: '📋', t: 'Copiar e colar textos', d: 'O botão direito agora tem Recortar, Copiar e Colar nos campos de texto, Copiar no texto selecionado e Copiar endereço nos links. Cada mensagem também tem um botão pra copiar o texto todo.', c: 'Botão direito em qualquer texto, ou o 📋 que aparece ao passar o mouse na mensagem.' },
      ]
    },
    {
      versao: '3.14.0', titulo: 'Soundboard do servidor e sala de cinema',
      itens: [
        { i: '🔊', t: 'Soundboard compartilhado', d: 'Cada servidor tem uma lista de sons que todo mundo pode tocar na chamada. Qualquer membro pode enviar sons novos (até 6 segundos e 140 KB, em mp3, ogg, webm ou m4a). Quem enviou apaga o seu, e o dono do servidor apaga qualquer um.', c: 'Na chamada, clique no 🔈 da barra de baixo. Lá estão os sons do servidor e o botão "Enviar um som".' },
        { i: '🏅', t: 'Medalhas na lista de membros', d: 'As conquistas de cada pessoa aparecem como ícones embaixo do nome, na coluna da direita (passe o mouse para ver o nome de cada uma). Quem deixou o perfil privado não mostra medalhas.', c: 'Coluna da direita, embaixo do nome.' },
        { i: '🎬', t: 'Sala de cinema sincronizada', d: 'Assistam o mesmo vídeo juntos. Quem inicia escolhe o arquivo; os outros escolhem o mesmo arquivo no PC deles e o app mantém todo mundo no mesmo ponto. Quem iniciou controla o play, a pausa e o avanço. O filme não passa pela internet e o som toca em cada PC, sem eco na chamada.', c: 'Na chamada, clique no 🎬 da barra de baixo e escolha o vídeo. Quem recebe o convite clica em "Escolher o arquivo". Todos precisam ter exatamente o mesmo arquivo (mp4 com H.264 ou webm funcionam melhor).' }
      ]
    },
    {
      versao: '3.13.0', titulo: 'Perfil, conquistas e resumo',
      itens: [
        { i: '👤', t: 'Cartão de perfil', d: 'Veja o perfil de qualquer pessoa do servidor: tempo em chamada, mensagens, quem mais te acompanha nas chamadas e os jogos mais transmitidos. O servidor mede tudo sozinho.', c: 'Clique na pessoa na lista de online ou offline e escolha "Ver perfil". Para ver o seu, clique na sua foto no canto de baixo.' },
        { i: '🏆', t: 'Conquistas', d: 'Medalhas engraçadas como "Coruja de plantão" (chamada de madrugada) e "Inseparáveis" (horas com a mesma pessoa). As que faltam mostram o progresso.', c: 'No cartão de perfil.' },
        { i: '📊', t: 'Meu resumo', d: 'Um resumo do seu mês passado, do mês atual ou do ano, no estilo "Wrapped": horas em chamada, dia mais falante, jogo mais transmitido e mais.', c: 'No seu perfil, botão "Meu resumo".' },
        { i: '🔒', t: 'Você controla', d: 'Dá para deixar o perfil privado (só você vê). Registrar o nome do jogo que você transmite é opcional e vem desligado.', c: 'Configurações > Privacidade > Perfil e estatísticas.' },
        { i: '🔗', t: 'Prévia de links funcionando de verdade', d: 'Corrigimos o servidor: agora o cartão com título e descrição aparece quando alguém manda um link.', c: 'Configurações > Privacidade > Mensagens.' }
      ]
    },
    {
      versao: '3.12.0', titulo: 'Reações, status e prévia de links',
      itens: [
        { i: '😀', t: 'Reações nas mensagens', d: 'Reaja a qualquer mensagem com um emoji (👍 ❤️ 😂 🔥 e mais). Clique numa reação que já existe para reagir também ou para tirar a sua.', c: 'Passe o mouse sobre a mensagem e clique no 😀.' },
        { i: '💬', t: 'Status personalizado', d: 'Escreva uma frase curta embaixo do seu nome, como "🎮 jogando Wardogs". Todo mundo do servidor vê na lista de online.', c: 'Clique no seu nome no canto de baixo à esquerda. Para tirar, marque "Remover o meu status".' },
        { i: '🔗', t: 'Prévia de links', d: 'Quando alguém manda um link, aparece um cartão com o título e a descrição da página. Quem abre a página é o servidor do Estrivisor, então o seu computador não acessa o site.', c: 'Para desligar: Configurações > Privacidade (seção "Mensagens") > "Mostrar prévia dos links no chat".' }
      ]
    },
    {
      versao: '3.11.0', titulo: 'Temas, efeitos de voz e desenho na tela',
      itens: [
        { i: '🎨', t: 'Temas prontos', d: 'Novos temas para trocar o visual do app com um clique: Oceano, Neon, Vampiro, Rosa, Café e Alto contraste.', c: 'Configurações > Aparência > Temas.' },
        { i: '🤖', t: 'Efeitos de voz', d: 'Fale como robô, com voz grossa, voz fina ou com eco. Todo mundo na chamada ouve o efeito.', c: 'Configurações > Voz e áudio > "Efeito de voz". Com o teste de microfone (use fone) dá para ouvir antes.' },
        { i: '👀', t: 'Quem está vendo sua transmissão', d: 'Quando você transmite a tela, aparece no canto o nome de quem está assistindo. Só mostra quem usa o app.', c: 'Etiqueta "👀" no canto da sua transmissão.' },
        { i: '✏️', t: 'Anotar na tela transmitida', d: 'Desenhe, aponte com seta ou circule algo na tela de alguém. Todos veem o desenho por alguns segundos e ele some sozinho.', c: 'Abra a transmissão em tela grande e clique no ✏️. Cada pessoa tem uma cor.' }
      ]
    },
    {
      versao: '3.10.1', titulo: 'Voz mais limpa, arquivos na chamada e lista de offline',
      itens: [
        { i: '🎙️', t: 'Supressão de ruído avançada', d: 'Um filtro por inteligência artificial que tira clique de teclado e mouse, ventilador, chiado e voz de fundo muito melhor que o filtro comum. Já vem ligado.', c: 'Configurações > Voz e áudio. Use "Testar microfone" (com fone) para ouvir a diferença. Quem fala precisa estar com esta versão.' },
        { i: '🚪', t: 'Porta de ruído', d: 'Corta o microfone quando você não está falando, para não vazar barulho nenhum.', c: 'Configurações > Voz e áudio > "Porta de ruído". Com o teste ligado, arraste o controle "Limite" até a marca branca ficar acima do barulho e abaixo da sua voz.' },
        { i: '📎', t: 'Enviar arquivos pela chamada', d: 'Mande foto, vídeo ou qualquer arquivo (até 100 MB) para quem está na chamada. Cada pessoa escolhe se aceita, e nada é salvo ou aberto sozinho.', c: 'Dentro de uma chamada, clique no 📎 da barra de baixo ou arraste o arquivo para a janela. Quem recebe clica em Aceitar e depois em Salvar.' },
        { i: '👥', t: 'Quem está offline também aparece', d: 'A coluna da direita agora mostra os membros do servidor que não estão online, mais apagados, embaixo de quem está.', c: 'Coluna da direita, seção "OFFLINE".' },
        { i: '🔔', t: 'Aba Som nas configurações', d: 'Os sons do app (mensagem, entrar e sair da sala, microfone) ganharam uma aba própria.', c: 'Configurações > Som. Dá para trocar cada som por um arquivo seu.' }
      ]
    },
    {
      versao: '3.10.0', titulo: 'Janela flutuante e personalização',
      itens: [
        { i: '🪟', t: 'Janela flutuante', d: 'Uma janelinha por cima do jogo mostra quem está falando na sala de voz, sem precisar sair do jogo.', c: 'Ligue nas configurações do Discord/jogo. Ctrl+Shift+F esconde e mostra de qualquer programa.' },
        { i: '🎨', t: 'Cores e imagens por área', d: 'Mude as cores do app e coloque imagens ou animações (GIF, WebP, vídeo curto) em cada área da tela.', c: 'Configurações > Aparência.' },
        { i: '🔊', t: 'Sons personalizados', d: 'Escolha o som de cada evento do app ou desligue os que não quiser.', c: 'Configurações > Som.' }
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

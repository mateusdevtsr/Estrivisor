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
        { i: '🔒', t: 'Você controla', d: 'Dá para deixar o perfil privado (só você vê). Registrar o nome do jogo que você transmite é opcional e vem desligado.', c: 'Configurações > Aparência > Perfil e estatísticas.' },
        { i: '🔗', t: 'Prévia de links funcionando de verdade', d: 'Corrigimos o servidor: agora o cartão com título e descrição aparece quando alguém manda um link.', c: 'Configurações > Aparência > Mensagens.' }
      ]
    },
    {
      versao: '3.12.0', titulo: 'Reações, status e prévia de links',
      itens: [
        { i: '😀', t: 'Reações nas mensagens', d: 'Reaja a qualquer mensagem com um emoji (👍 ❤️ 😂 🔥 e mais). Clique numa reação que já existe para reagir também ou para tirar a sua.', c: 'Passe o mouse sobre a mensagem e clique no 😀.' },
        { i: '💬', t: 'Status personalizado', d: 'Escreva uma frase curta embaixo do seu nome, como "🎮 jogando Wardogs". Todo mundo do servidor vê na lista de online.', c: 'Clique no seu nome no canto de baixo à esquerda. Para tirar, marque "Remover o meu status".' },
        { i: '🔗', t: 'Prévia de links', d: 'Quando alguém manda um link, aparece um cartão com o título e a descrição da página. Quem abre a página é o servidor do Estrivisor, então o seu computador não acessa o site.', c: 'Para desligar: Configurações > Aparência (seção "Mensagens") > "Mostrar prévia dos links no chat".' }
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

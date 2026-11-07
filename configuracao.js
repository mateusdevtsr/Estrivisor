const fs = require('fs');
const path = require('path');

// Preferências do app que o processo principal precisa saber ANTES de a janela abrir
// (por isso não ficam no localStorage da tela). Guardadas num arquivo JSON simples na
// pasta de dados do app.
//
//   fecharParaBandeja:    ao clicar no X, o app continua rodando na bandeja do sistema
//   avisoBandejaMostrado: já mostramos o aviso "continua aberto na bandeja" uma vez
//   flutuanteAtiva:       janela pequena por cima do jogo com a sala de voz (Configurações > Visual)
//   flutuanteAtalho:      atalho de teclado (Ctrl+Shift+F) pra mostrar/esconder a janela flutuante
//   flutuanteOpacidade:   quanto da janela flutuante aparece (30 a 100, em %)
//   flutuanteClique:      o clique atravessa a janela flutuante (ela só mostra, não responde ao mouse)
//   flutuanteChat:        mostra a última mensagem do chat na janela flutuante
//   flutuanteAvisos:      avisa na janela flutuante quando alguém entra ou sai da sala
const PADRAO = { fecharParaBandeja: true, avisoBandejaMostrado: false, flutuanteAtiva: false, flutuanteAtalho: true, flutuanteOpacidade: 100, flutuanteClique: false, flutuanteChat: false, flutuanteAvisos: true };
// Valores numéricos aceitos (com limites); qualquer outro tipo ou fora do limite é ignorado.
const LIMITES = { flutuanteOpacidade: [30, 100] };
const valorValido = (chave, v) => (LIMITES[chave]
  ? Number.isInteger(v) && v >= LIMITES[chave][0] && v <= LIMITES[chave][1]
  : typeof v === 'boolean');
const NOME_ARQUIVO = 'configuracao.json';

function lerConfiguracao(pasta) {
  const config = { ...PADRAO };
  try {
    const dados = JSON.parse(fs.readFileSync(path.join(pasta, NOME_ARQUIVO), 'utf8'));
    // Só aceita as chaves conhecidas, com o tipo certo (e dentro dos limites); o resto é ignorado.
    for (const chave of Object.keys(PADRAO)) {
      if (valorValido(chave, dados[chave])) config[chave] = dados[chave];
    }
  } catch (e) {
    // Sem arquivo (primeira vez) ou arquivo ilegível: usa o padrão.
  }
  return config;
}

function salvarConfiguracao(pasta, parcial) {
  const config = { ...lerConfiguracao(pasta) };
  for (const chave of Object.keys(PADRAO)) {
    if (parcial && valorValido(chave, parcial[chave])) config[chave] = parcial[chave];
  }
  try {
    fs.mkdirSync(pasta, { recursive: true });
    // Grava num arquivo temporário e troca de nome: se o app fechar no meio, o arquivo
    // antigo não fica pela metade.
    const destino = path.join(pasta, NOME_ARQUIVO);
    const temporario = destino + '.tmp';
    fs.writeFileSync(temporario, JSON.stringify(config, null, 2));
    fs.renameSync(temporario, destino);
  } catch (e) {
    console.warn('[configuração] não foi possível salvar:', e.message);
  }
  return config;
}

module.exports = { lerConfiguracao, salvarConfiguracao, PADRAO };

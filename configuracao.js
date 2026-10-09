const fs = require('fs');
const path = require('path');

// Preferências do app que o processo principal precisa saber ANTES de a janela abrir
// (por isso não ficam no localStorage da tela). Guardadas num arquivo JSON simples na
// pasta de dados do app.
//
//   fecharParaBandeja:    ao clicar no X, o app continua rodando na bandeja do sistema
//   avisoBandejaMostrado: já mostramos o aviso "continua aberto na bandeja" uma vez
const PADRAO = { fecharParaBandeja: true, avisoBandejaMostrado: false };
const NOME_ARQUIVO = 'configuracao.json';

function lerConfiguracao(pasta) {
  const config = { ...PADRAO };
  try {
    const dados = JSON.parse(fs.readFileSync(path.join(pasta, NOME_ARQUIVO), 'utf8'));
    // Só aceita as chaves conhecidas e só valores verdadeiro/falso; o resto é ignorado.
    for (const chave of Object.keys(PADRAO)) {
      if (typeof dados[chave] === 'boolean') config[chave] = dados[chave];
    }
  } catch (e) {
    // Sem arquivo (primeira vez) ou arquivo ilegível: usa o padrão.
  }
  return config;
}

function salvarConfiguracao(pasta, parcial) {
  const config = { ...lerConfiguracao(pasta) };
  for (const chave of Object.keys(PADRAO)) {
    if (parcial && typeof parcial[chave] === 'boolean') config[chave] = parcial[chave];
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

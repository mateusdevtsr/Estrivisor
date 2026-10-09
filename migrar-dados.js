const fs = require('fs');
const path = require('path');

// Nomes de pasta que o app pode ter usado ANTES de se chamar "Estrivisor".
// O Electron guarda os dados (nome salvo, canais) numa pasta com o nome do
// app; ao trocar o nome, a pasta nova começa vazia. Este módulo copia o
// armazenamento local (onde ficam o nome e os canais) da pasta antiga.
//
// Pode apagar este arquivo (e a chamada no main.js) quando todo mundo já
// tiver aberto o app novo pelo menos uma vez.
const NOMES_ANTIGOS = ['Concord', 'concord-desktop-pro'];

function migrarDadosAntigos(appDataDir, pastaNova) {
  try {
    const destino = path.join(pastaNova, 'Local Storage');
    if (fs.existsSync(destino)) return 'ja-migrado';

    // Se existir mais de uma pasta antiga, usa a mexida mais recentemente.
    const candidatos = NOMES_ANTIGOS
      .map((nome) => path.join(appDataDir, nome, 'Local Storage'))
      .filter((p) => fs.existsSync(p))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    if (candidatos.length === 0) return 'nada-para-migrar';

    fs.mkdirSync(pastaNova, { recursive: true });
    fs.cpSync(candidatos[0], destino, { recursive: true });
    return 'migrado';
  } catch (err) {
    // Nunca pode derrubar o app: no pior caso, a pessoa digita o nome de novo.
    console.warn('[migração] não foi possível copiar os dados antigos:', err.message);
    return 'erro';
  }
}

module.exports = { migrarDadosAntigos };

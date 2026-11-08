'use strict';
// Gera ruido/ruido-pacote.js: junta o RNNoise + o processador de áudio num texto só.
// Por quê: no app instalado a página abre por file://, e o navegador não deixa o AudioWorklet carregar arquivos
// por aí. O texto vira um "blob" na hora de usar (ver ruido.js). Rode `node ruido/montar.js` se mexer em
// ruido-worklet.js (ou rode `npm test`, que avisa quando o pacote estiver velho).
const fs = require('fs');
const path = require('path');

function montar(dir = __dirname) {
  let rnnoise = fs.readFileSync(path.join(dir, 'rnnoise-sync.js'), 'utf8');
  rnnoise = rnnoise.replace('var _scriptDir = import.meta.url;', 'var _scriptDir = "";').replace('export default createRNNWasmModuleSync;', '');
  let worklet = fs.readFileSync(path.join(dir, 'ruido-worklet.js'), 'utf8');
  worklet = worklet.replace("import criarModuloRnnoise from './rnnoise-sync.js';", 'const criarModuloRnnoise = createRNNWasmModuleSync;');
  const fonte = rnnoise + '\n;\n' + worklet;
  return '// ARQUIVO GERADO por ruido/montar.js — não edite à mão.\nwindow.RuidoFonteWorklet = ' + JSON.stringify(fonte) + ';\n';
}

if (require.main === module) {
  fs.writeFileSync(path.join(__dirname, 'ruido-pacote.js'), montar());
  console.log('ruido-pacote.js gerado.');
}
module.exports = { montar };

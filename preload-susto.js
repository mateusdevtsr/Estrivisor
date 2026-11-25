const { contextBridge, ipcRenderer } = require('electron');

// A tela do susto só recebe a imagem/som e só pode pedir pra fechar.
contextBridge.exposeInMainWorld('sustoAPI', {
  aoReceber: (callback) => { ipcRenderer.on('susto-dados', (evento, dados) => callback(dados)); },
  fechar: () => ipcRenderer.invoke('susto-fechar')
});

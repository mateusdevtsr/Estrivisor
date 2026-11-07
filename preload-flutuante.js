const { contextBridge, ipcRenderer } = require('electron');

// A janela flutuante só recebe o estado da sala e só pode pedir três coisas: ligar/desligar
// o microfone, ensurdecer e sair da sala (mais esconder a si mesma). Quem faz de verdade é a
// janela principal; o processo principal confere cada pedido.
contextBridge.exposeInMainWorld('flutuanteAPI', {
  aoEstado: (callback) => {
    ipcRenderer.on('flutuante-estado', (evento, estado) => callback(estado));
  },
  comando: (nome) => ipcRenderer.invoke('flutuante-comando', nome),
  esconder: () => ipcRenderer.invoke('flutuante-esconder')
});

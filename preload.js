const { contextBridge, ipcRenderer } = require('electron');

// Com contextIsolation habilitado, o renderer NÃO tem acesso direto ao Node
// nem ao módulo 'electron'. Expomos aqui apenas o mínimo necessário.
//
// desktopCapturer.getSources() não pode mais ser chamado aqui: desde o
// Electron 17 essa API só funciona no processo principal (main.js), então
// esse pedido também vira uma chamada IPC.
contextBridge.exposeInMainWorld('electronAPI', {
  gerarToken: (dados) => ipcRenderer.invoke('gerar-token-seguro', dados),
  obterUrlServidor: () => ipcRenderer.invoke('obter-url-servidor'),
  listarFontes: () => ipcRenderer.invoke('listar-fontes'),
  definirFonte: (id) => ipcRenderer.invoke('definir-fonte', id),

  // Sala de espera / aprovação de entrada
  tornarDono: (dados) => ipcRenderer.invoke('tornar-dono', dados),
  listarPendentes: (dados) => ipcRenderer.invoke('listar-pendentes', dados),
  decidirPendente: (dados) => ipcRenderer.invoke('decidir-pendente', dados)
});

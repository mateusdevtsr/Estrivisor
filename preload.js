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
  decidirPendente: (dados) => ipcRenderer.invoke('decidir-pendente', dados),

  // Servidores, canais, convites e presença (tudo passa pelo processo principal)
  apiServidor: (dados) => ipcRenderer.invoke('api-servidor', dados),

  // Perfil do Discord (nome e avatar de quem está logado no Discord aberto)
  obterUsuarioDiscord: () => ipcRenderer.invoke('obter-usuario-discord'),
  aoReceberUsuarioDiscord: (callback) => {
    ipcRenderer.on('usuario-discord', (_evento, usuario) => callback(usuario));
  },

  // Rich Presence do Discord (null limpa o status)
  definirAtividadeDiscord: (atividade) => ipcRenderer.invoke('definir-atividade-discord', atividade),

  // Salas ativas e moderação (parar transmissão de outra pessoa)
  listarSalasAtivas: () => ipcRenderer.invoke('listar-salas-ativas'),
  forcarPararTransmissao: (dados) => ipcRenderer.invoke('forcar-parar-transmissao', dados),
  forcarMutarMicrofone: (dados) => ipcRenderer.invoke('forcar-mutar-microfone', dados)
});

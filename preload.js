const { contextBridge, ipcRenderer } = require('electron');

// Com contextIsolation habilitado, a tela NÃO tem acesso direto ao Node nem ao módulo
// 'electron'. Expomos aqui apenas o mínimo necessário. A chave de sessão (login) nunca
// passa por aqui: ela fica só no processo principal.
contextBridge.exposeInMainWorld('electronAPI', {
  // Conta / login
  contaAtual: () => ipcRenderer.invoke('conta-atual'),
  loginDiscord: () => ipcRenderer.invoke('login-discord'),
  cancelarLogin: () => ipcRenderer.invoke('cancelar-login'),
  loginLocal: (nome) => ipcRenderer.invoke('login-local', nome),
  sairDaConta: () => ipcRenderer.invoke('sair-da-conta'),
  aoExpirarSessao: (callback) => {
    ipcRenderer.on('sessao-expirou', () => callback());
  },

  // Canais (tokens do LiveKit) e transmissão
  gerarToken: (dados) => ipcRenderer.invoke('gerar-token-seguro', dados),
  obterUrlServidor: () => ipcRenderer.invoke('obter-url-servidor'),
  listarFontes: () => ipcRenderer.invoke('listar-fontes'),
  definirFonte: (id) => ipcRenderer.invoke('definir-fonte', id),

  // Sala de espera / aprovação de entrada (só o dono do servidor)
  listarPendentes: (dados) => ipcRenderer.invoke('listar-pendentes', dados),
  decidirPendente: (dados) => ipcRenderer.invoke('decidir-pendente', dados),

  // Servidores, canais, convites e presença (tudo passa pelo processo principal)
  apiServidor: (dados) => ipcRenderer.invoke('api-servidor', dados),

  // Rich Presence do Discord (null limpa o status)
  definirAtividadeDiscord: (atividade) => ipcRenderer.invoke('definir-atividade-discord', atividade),

  // Moderação (só o dono do servidor; o servidor confere)
  forcarPararTransmissao: (dados) => ipcRenderer.invoke('forcar-parar-transmissao', dados),
  forcarMutarMicrofone: (dados) => ipcRenderer.invoke('forcar-mutar-microfone', dados)
});

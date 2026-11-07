const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Com contextIsolation habilitado, a tela NÃO tem acesso direto ao Node nem ao módulo
// 'electron'. Expomos aqui apenas o mínimo necessário. A chave de sessão (login) nunca
// passa por aqui: ela fica só no processo principal.
contextBridge.exposeInMainWorld('electronAPI', {
  // Tamanho da interface (Configurações > Aparência). Só aceita de 80% a 150%.
  definirZoom: (fator) => {
    const n = Number(fator);
    if (Number.isFinite(n) && n >= 0.8 && n <= 1.5) webFrame.setZoomFactor(n);
  },
  versaoApp: () => ipcRenderer.invoke('obter-versao'),
  abrirLink: (url) => ipcRenderer.invoke('abrir-link', url),
  exportarMeusDados: () => ipcRenderer.invoke('exportar-meus-dados'),
  apagarMinhaConta: () => ipcRenderer.invoke('apagar-minha-conta'),

  // Conta / login
  contaAtual: () => ipcRenderer.invoke('conta-atual'),
  loginDiscord: () => ipcRenderer.invoke('login-discord'),
  cancelarLogin: () => ipcRenderer.invoke('cancelar-login'),
  loginLocal: (nome) => ipcRenderer.invoke('login-local', nome),
  sairDaConta: () => ipcRenderer.invoke('sair-da-conta'),
  aoExpirarSessao: (callback) => {
    ipcRenderer.on('sessao-expirou', (evento, mensagem) => callback(mensagem));
  },

  // Canais (tokens do LiveKit) e transmissão
  gerarToken: (dados) => ipcRenderer.invoke('gerar-token-seguro', dados),
  obterUrlServidor: () => ipcRenderer.invoke('obter-url-servidor'),
  listarFontes: () => ipcRenderer.invoke('listar-fontes'),
  definirFonte: (id, comSom) => ipcRenderer.invoke('definir-fonte', id, comSom),

  // Sala de espera / aprovação de entrada (só o dono do servidor)
  listarPendentes: (dados) => ipcRenderer.invoke('listar-pendentes', dados),
  decidirPendente: (dados) => ipcRenderer.invoke('decidir-pendente', dados),

  // Servidores, canais, convites e presença (tudo passa pelo processo principal)
  apiServidor: (dados) => ipcRenderer.invoke('api-servidor', dados),

  // Rich Presence do Discord (null limpa o status)
  definirAtividadeDiscord: (atividade) => ipcRenderer.invoke('definir-atividade-discord', atividade),

  // Moderação (só o dono do servidor; o servidor confere)
  forcarPararTransmissao: (dados) => ipcRenderer.invoke('forcar-parar-transmissao', dados),
  forcarMutarMicrofone: (dados) => ipcRenderer.invoke('forcar-mutar-microfone', dados),

  // Janela flutuante (sala de voz por cima do jogo)
  flutuanteLer: () => ipcRenderer.invoke('flutuante-ler'),
  flutuanteDefinir: (ativa) => ipcRenderer.invoke('flutuante-definir', ativa),
  flutuanteEstado: (estado) => ipcRenderer.invoke('flutuante-estado', estado),
  aoComandoFlutuante: (callback) => {
    ipcRenderer.on('flutuante-comando', (evento, comando) => callback(comando));
  },
  aoFlutuanteMudou: (callback) => {
    ipcRenderer.on('flutuante-mudou', (evento, ativa) => callback(ativa === true));
  }
});

'use strict';
// ============================================================
// Envio de arquivos pela chamada. Aqui ficam só as regras (limite, nome seguro, formato das mensagens de
// oferta/resposta), sem tocar na rede, para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Arquivos.
// Como funciona: quem envia manda uma OFERTA (nome e tamanho) para a sala; cada pessoa decide ACEITAR ou RECUSAR;
// só então o arquivo é enviado, e só para quem aceitou. Nada é salvo nem aberto sem a pessoa clicar em "Salvar".
// ============================================================
(function (raiz) {
  const LIMITE_BYTES = 100 * 1024 * 1024; // 100 MB por arquivo
  const TOPICOS = { oferta: 'estrivisor-oferta', resposta: 'estrivisor-resposta', arquivo: 'estrivisor-arquivo' };
  const MAX_OFERTAS_PENDENTES = 5;

  // Tipos que rodam programas ao abrir: o app avisa em vermelho antes de salvar.
  const EXTENSOES_PERIGOSAS = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'lnk', 'reg', 'dll', 'cpl', 'msc', 'appx', 'msix', 'apk', 'sh', 'app', 'dmg']);
  const NOMES_RESERVADOS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

  // Deixa só o nome do arquivo, sem pasta, sem caracteres proibidos no Windows e sem tamanho absurdo.
  function nomeSeguro(nome) {
    let n = String(nome == null ? '' : nome);
    n = n.split(/[\\/]/).pop();
    n = n.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/[\u202a-\u202e\u2066-\u2069]/g, ''); // inclui setas que invertem o texto
    n = n.replace(/^[\s.]+|[\s.]+$/g, '');
    if (!n) return 'arquivo';
    if (n.length > 100) {
      const i = n.lastIndexOf('.');
      const ext = i > 0 && n.length - i <= 12 ? n.slice(i) : '';
      n = n.slice(0, 100 - ext.length) + ext;
    }
    const base = n.replace(/\.[^.]*$/, '');
    if (NOMES_RESERVADOS.test(base)) n = '_' + n;
    return n;
  }

  function extensao(nome) {
    const m = /\.([^.\s]+)$/.exec(String(nome || '').trim());
    return m ? m[1].toLowerCase() : '';
  }
  function extensaoPerigosa(nome) {
    // Pega também a extensão "escondida" (foto.jpg.exe) e extensões com espaços no fim.
    return EXTENSOES_PERIGOSAS.has(extensao(nomeSeguro(nome)));
  }

  function formatarTamanho(bytes) {
    const b = Number(bytes);
    if (!Number.isFinite(b) || b < 0) return '?';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10 * 1024 ? 1 : 0) + ' KB';
    if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    return (b / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  function novoId() {
    const a = new Uint8Array(8);
    (raiz.crypto || require('crypto').webcrypto).getRandomValues(a);
    return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  const ID_VALIDO = /^[0-9a-f]{16}$/;
  function lerJson(texto) {
    if (typeof texto !== 'string' || texto.length > 2000) return null;
    try { const o = JSON.parse(texto); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; }
  }

  function criarOferta({ id, nome, tamanho, tipo }) {
    return JSON.stringify({ v: 1, id, nome: String(nome), tamanho: Number(tamanho), tipo: String(tipo || '') });
  }
  // Valida uma oferta que veio de outra pessoa. Devolve null se estiver errada ou grande demais.
  function lerOferta(texto) {
    const o = lerJson(texto);
    if (!o || o.v !== 1 || typeof o.id !== 'string' || !ID_VALIDO.test(o.id)) return null;
    if (typeof o.nome !== 'string' || !o.nome || o.nome.length > 300) return null;
    if (!Number.isInteger(o.tamanho) || o.tamanho < 0 || o.tamanho > LIMITE_BYTES) return null;
    return { id: o.id, nomeOriginal: o.nome, nome: nomeSeguro(o.nome), tamanho: o.tamanho, tipo: typeof o.tipo === 'string' ? o.tipo.slice(0, 100) : '' };
  }

  function criarResposta(id, aceito) { return JSON.stringify({ v: 1, id, aceito: Boolean(aceito) }); }
  function lerResposta(texto) {
    const o = lerJson(texto);
    if (!o || o.v !== 1 || typeof o.id !== 'string' || !ID_VALIDO.test(o.id) || typeof o.aceito !== 'boolean') return null;
    return { id: o.id, aceito: o.aceito };
  }

  // Valida o arquivo escolhido para enviar. Devolve texto de erro ou null se estiver ok.
  function problemaNoEnvio(arquivo) {
    if (!arquivo || typeof arquivo.size !== 'number') return 'Arquivo inválido.';
    if (arquivo.size === 0) return 'O arquivo está vazio.';
    if (arquivo.size > LIMITE_BYTES) return 'O arquivo tem ' + formatarTamanho(arquivo.size) + '. O limite é ' + formatarTamanho(LIMITE_BYTES) + '.';
    return null;
  }

  const Arquivos = { LIMITE_BYTES, TOPICOS, MAX_OFERTAS_PENDENTES, nomeSeguro, extensaoPerigosa, formatarTamanho, novoId, criarOferta, lerOferta, criarResposta, lerResposta, problemaNoEnvio };
  if (typeof module !== 'undefined' && module.exports) module.exports = Arquivos;
  else raiz.Arquivos = Arquivos;
})(typeof window !== 'undefined' ? window : globalThis);

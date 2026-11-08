'use strict';
// ============================================================
// Soundboard compartilhado: conferências do arquivo antes de enviar e organização da lista.
// Só regras (sem tocar na tela, no áudio nem na rede), para dar para testar com "node --test".
// O servidor confere tudo de novo; aqui é para avisar a pessoa na hora, sem gastar internet à toa.
// ============================================================
(function (raiz) {
  const MAX_BYTES = 140 * 1024;
  const MAX_SEGUNDOS = 6;
  const MAX_NOME = 24;
  const EXTENSOES = ['mp3', 'ogg', 'oga', 'opus', 'webm', 'm4a', 'mp4', 'aac'];
  const PERIGOSOS = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;

  // Devolve um texto explicando o problema, ou '' se pode enviar. duracao = segundos (já decodificada).
  function problemaNoArquivo({ nome, tamanho }, duracao) {
    const ext = String(nome || '').split('.').pop().toLowerCase();
    if (!EXTENSOES.includes(ext)) return wavOuOutro(ext);
    if (!(tamanho > 0)) return 'O arquivo está vazio.';
    if (tamanho > MAX_BYTES) return `O som pode ter no máximo 140 KB (este tem ${Math.ceil(tamanho / 1024)} KB). Use um mp3 curto ou comprima o arquivo.`;
    if (duracao !== undefined && !(duracao > 0)) return 'Não consegui ler o áudio deste arquivo.';
    if (duracao > MAX_SEGUNDOS + 0.2) return `O som pode ter no máximo ${MAX_SEGUNDOS} segundos (este tem ${duracao.toFixed(1).replace('.', ',')}).`;
    return '';
  }
  function wavOuOutro(ext) {
    if (ext === 'wav') return 'Arquivos .wav costumam ser grandes demais. Converta para mp3 e tente de novo.';
    return 'Formato não aceito. Use mp3, ogg, webm ou m4a.';
  }

  function nomeSugerido(nomeArquivo) {
    const base = String(nomeArquivo || '').replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ');
    return base.replace(PERIGOSOS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOME);
  }

  // Confere o que o servidor devolveu na lista (ordem: mais antigos primeiro) e deixa só o que o app usa.
  function validarLista(d) {
    const lista = d && Array.isArray(d.sons) ? d.sons : [];
    return lista.slice(0, 20).map((s) => ({
      id: /^[0-9a-f]{12}$/.test(String(s && s.id)) ? s.id : '',
      nome: String((s && s.nome) || '').replace(PERIGOSOS, ' ').trim().slice(0, MAX_NOME),
      por: String((s && s.por) || '').slice(0, 100),
      porNome: String((s && s.porNome) || '').replace(PERIGOSOS, ' ').trim().slice(0, 40),
      segundos: Math.min(MAX_SEGUNDOS, Math.max(0, Number(s && s.segundos) || 0)),
    })).filter((s) => s.id && s.nome);
  }

  function paraBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'latin1').toString('base64');
  }
  function deBase64(texto) {
    const bin = typeof atob === 'function' ? atob(texto) : Buffer.from(texto, 'base64').toString('latin1');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  const SomBoard = { MAX_BYTES, MAX_SEGUNDOS, MAX_NOME, problemaNoArquivo, nomeSugerido, validarLista, paraBase64, deBase64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = SomBoard;
  else raiz.SomBoard = SomBoard;
})(typeof window !== 'undefined' ? window : globalThis);

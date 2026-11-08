'use strict';
// ============================================================
// "Quem está vendo a minha transmissão". Quem assiste avisa quem transmite por uma mensagem curta
// (o servidor de vídeo não conta isso para o app). Aqui ficam só as regras (formato da mensagem e a lista
// de quem está vendo), sem rede, para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Espectadores.
// Limite: só aparece quem usa o app; um programa modificado poderia assistir sem avisar.
// ============================================================
(function (raiz) {
  const TOPICO = 'estrivisor-assistindo';
  const ORIGENS = ['tela', 'camera'];
  const MAX_ESPECTADORES = 50;

  function criarMensagem(acao, origem) {
    return JSON.stringify({ v: 1, acao: acao === 'saiu' ? 'saiu' : 'entrou', origem: ORIGENS.includes(origem) ? origem : 'tela' });
  }
  // Valida a mensagem que veio de outra pessoa; devolve null se estiver errada.
  function lerMensagem(texto) {
    if (typeof texto !== 'string' || texto.length > 200) return null;
    let o = null;
    try { o = JSON.parse(texto); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || o.v !== 1) return null;
    if (o.acao !== 'entrou' && o.acao !== 'saiu') return null;
    if (!ORIGENS.includes(o.origem)) return null;
    return { acao: o.acao, origem: o.origem };
  }

  // Quem está vendo agora: identidade -> { nome, origens:Set }.
  function criarRegistro() {
    const mapa = new Map();
    return {
      entrou(identidade, nome, origem) {
        const id = String(identidade);
        if (!mapa.has(id) && mapa.size >= MAX_ESPECTADORES) return false;
        const e = mapa.get(id) || { nome: String(nome || id).slice(0, 40), origens: new Set() };
        e.nome = String(nome || id).slice(0, 40);
        e.origens.add(origem);
        mapa.set(id, e);
        return true;
      },
      saiu(identidade, origem) {
        const e = mapa.get(String(identidade));
        if (!e) return;
        e.origens.delete(origem);
        if (e.origens.size === 0) mapa.delete(String(identidade));
      },
      removerPessoa(identidade) { mapa.delete(String(identidade)); },
      limpar() { mapa.clear(); },
      nomes() { return [...mapa.values()].map((e) => e.nome).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })); },
      total() { return mapa.size; }
    };
  }

  // Texto curto do selo: "Andy", "Andy e Ana", "Andy, Ana e +2".
  function resumo(nomes, maxNomes = 2) {
    if (!nomes.length) return '';
    if (nomes.length <= maxNomes) return nomes.length === 1 ? nomes[0] : nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
    return nomes.slice(0, maxNomes).join(', ') + ' e +' + (nomes.length - maxNomes);
  }

  const Espectadores = { TOPICO, criarMensagem, lerMensagem, criarRegistro, resumo };
  if (typeof module !== 'undefined' && module.exports) module.exports = Espectadores;
  else raiz.Espectadores = Espectadores;
})(typeof window !== 'undefined' ? window : globalThis);

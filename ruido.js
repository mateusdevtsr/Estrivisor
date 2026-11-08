'use strict';
// ============================================================
// Supressão de ruído avançada (RNNoise, o mesmo tipo de filtro por IA usado em apps de chamada) + porta de ruído.
// A parte pesada roda na pasta ruido/ (AudioWorklet). Aqui ficam as regras simples (testáveis com "node --test")
// e a montagem da cadeia de áudio. Na tela, estrivisor-app.js usa window.Ruido.
// O filtro roda no PC de quem fala: cada pessoa precisa estar com a versão nova do app.
// ============================================================
(function (raiz) {
  // A barra do medidor mostra pico*140 (em %). O limiar do slider usa a mesma escala, então a marca
  // desenhada na barra bate exatamente com o ponto em que a porta abre.
  const ESCALA_BARRA = 140;
  const limitar = (v, min, max) => Math.min(max, Math.max(min, v));

  function porcentagemParaPico(pct) { return limitar(Number(pct) || 0, 0, 100) / ESCALA_BARRA; }
  function picoParaPorcentagem(pico) { return limitar(Math.round((Number(pico) || 0) * ESCALA_BARRA), 0, 100); }
  // Efeitos de voz de brincadeira (rodam no mesmo filtro do ruído).
  const EFEITOS = {
    nenhum: { nome: 'Sem efeito' },
    robo:   { nome: '🤖 Robô' },
    grave:  { nome: '🎙️ Voz grossa' },
    agudo:  { nome: '🐿️ Voz fina' },
    eco:    { nome: '🏔️ Eco' }
  };
  function efeitoValido(v) { return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EFEITOS, v) ? v : 'nenhum'; }

  function limiarValido(v, padrao = 12) {
    const n = Number(v);
    return Number.isFinite(n) ? limitar(Math.round(n), 1, 100) : padrao;
  }

  // O app instalado abre por file://, e o AudioWorklet não carrega arquivo por aí. Por isso o código do filtro
  // vem num texto (ruido/ruido-pacote.js, gerado por ruido/montar.js) e é entregue como "blob".
  async function carregarWorklet(contexto) {
    if (typeof raiz.RuidoFonteWorklet !== 'string') throw new Error('Arquivo do filtro de ruído não foi carregado.');
    const url = raiz.URL.createObjectURL(new raiz.Blob([raiz.RuidoFonteWorklet], { type: 'text/javascript' }));
    try { await contexto.audioWorklet.addModule(url); } finally { raiz.URL.revokeObjectURL(url); }
  }

  // Monta: entrada -> filtro -> saída. Devolve { stream, trilha, no, contexto, ajustar(), parar() }.
  async function criarCadeia(trilhaOuStream, opcoes) {
    const Contexto = raiz.AudioContext || raiz.webkitAudioContext;
    if (!Contexto || !raiz.AudioWorkletNode) throw new Error('Este sistema não tem suporte ao filtro avançado.');
    const contexto = new Contexto({ sampleRate: 48000, latencyHint: 'interactive' });
    try {
      await carregarWorklet(contexto);
      const entrada = trilhaOuStream instanceof raiz.MediaStream
        ? trilhaOuStream
        : new raiz.MediaStream([trilhaOuStream]);
      const fonte = contexto.createMediaStreamSource(entrada);
      const no = new raiz.AudioWorkletNode(contexto, 'estrivisor-ruido', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const destino = contexto.createMediaStreamDestination();
      let erro = null;
      const aviso = new Promise((resolve) => {
        no.port.onmessage = (e) => {
          const m = e.data || {};
          if (m.pronto) resolve(true);
          if (m.erro) { erro = m.erro; resolve(false); }
        };
        setTimeout(() => resolve(false), 4000);
      });
      fonte.connect(no); no.connect(destino);
      const ajustar = (o) => no.port.postMessage({ rnnoise: o.rnnoise !== false, porta: Boolean(o.porta), limiar: porcentagemParaPico(o.limiar), efeito: efeitoValido(o.efeito) });
      ajustar(opcoes || {});
      if (!(await aviso)) throw new Error(erro || 'O filtro de ruído não iniciou.');
      if (contexto.state === 'suspended') await contexto.resume();
      return {
        stream: destino.stream,
        trilha: destino.stream.getAudioTracks()[0],
        no, contexto, ajustar,
        parar() {
          try { fonte.disconnect(); no.disconnect(); } catch (e) {}
          try { contexto.close(); } catch (e) {}
        }
      };
    } catch (err) {
      try { contexto.close(); } catch (e) {}
      throw err;
    }
  }

  // Processador no formato que o LiveKit entende (track.setProcessor).
  function criarProcessadorLiveKit(lerOpcoes) {
    let cadeia = null;
    return {
      name: 'estrivisor-ruido',
      processedTrack: undefined,
      async init(opts) {
        if (cadeia) cadeia.parar();
        cadeia = await criarCadeia(opts.track, lerOpcoes());
        this.processedTrack = cadeia.trilha;
      },
      async restart(opts) { return this.init(opts); },
      async destroy() { if (cadeia) cadeia.parar(); cadeia = null; this.processedTrack = undefined; },
      ajustar(o) { if (cadeia) cadeia.ajustar(o); }
    };
  }

  const Ruido = { EFEITOS, efeitoValido, ESCALA_BARRA, porcentagemParaPico, picoParaPorcentagem, limiarValido, criarCadeia, criarProcessadorLiveKit };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ruido;
  else raiz.Ruido = Ruido;
})(typeof window !== 'undefined' ? window : globalThis);

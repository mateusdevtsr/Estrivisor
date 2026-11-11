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
    radio:  { nome: '📻 Rádio antigo' },
    megafone: { nome: '📢 Megafone' },
    caverna: { nome: '🕳️ Caverna' },
    alien:  { nome: '👽 Alienígena' },
    demonio: { nome: '😈 Demônio' },
    agua:   { nome: '🌊 Debaixo d\'água' },
    bebado: { nome: '🥴 Bêbado' }
  };
  // Além dos efeitos prontos, vale "voz:<id>" (uma voz criada pela pessoa a partir de uma gravação; os números ficam no PC dela).
  const ID_VOZ_CRIADA = /^voz:[a-z0-9]{6,12}$/;
  function efeitoValido(v) {
    if (typeof v !== 'string') return 'nenhum';
    if (ID_VOZ_CRIADA.test(v)) return v;
    return Object.prototype.hasOwnProperty.call(EFEITOS, v) ? v : 'nenhum';
  }
  // Efeito criado à mão (Configurações > Voz > Criar efeito). Cada ajuste: [mínimo, máximo, padrão].
  const AJUSTES_EFEITO = {
    tom: [-12, 12, 0],            // semitons
    graves: [-12, 12, 0],         // dB
    medios: [-12, 12, 0],
    agudos: [-12, 12, 0],
    cortaGraves: [0, 1000, 0],    // Hz (0 = desligado)
    cortaAgudos: [800, 12000, 12000], // Hz (12000 = desligado)
    distorcao: [0, 100, 0],       // %
    roboVel: [10, 300, 70],       // Hz
    roboInt: [0, 100, 0],
    vibVel: [0.5, 12, 5],         // Hz
    vibInt: [0, 100, 0],
    tremVel: [0.5, 15, 4],        // Hz
    tremInt: [0, 100, 0],
    ecoAtraso: [50, 800, 250],    // ms
    ecoRep: [0, 85, 35],          // %
    ecoVol: [0, 100, 0],
    ambiente: [0, 100, 0],
    volume: [0, 200, 100]         // %
  };
  function ajustesPadrao() { const o = {}; for (const [k, v] of Object.entries(AJUSTES_EFEITO)) o[k] = v[2]; return o; }
  function bandasValidas(lista) {
    if (!Array.isArray(lista) || lista.length !== 16) return null;
    const bandas = [];
    for (const b of lista) {
      if (!b || !Number.isFinite(b.f) || !Number.isFinite(b.g) || b.f < 20 || b.f > 20000) return null;
      bandas.push({ f: b.f, g: limitar(b.g, -14, 14) });
    }
    return bandas;
  }
  // Confere e limita o efeito antes de mandar pro filtro. Aceita o formato novo (versao 2, feito à mão)
  // e o antigo (fator de tom + 16 faixas, das vozes criadas a partir de gravação), que continua funcionando.
  function perfilDeVoz(p) {
    if (!p || typeof p !== 'object') return null;
    const out = ajustesPadrao();
    if (p.versao === 2) {
      for (const [k, [min, max, padrao]] of Object.entries(AJUSTES_EFEITO)) {
        const n = Number(p[k]);
        out[k] = Number.isFinite(n) ? limitar(n, min, max) : padrao;
      }
      out.tom = Math.round(out.tom * 2) / 2;
      out.versao = 2;
      out.fator = Math.pow(2, out.tom / 12);
      out.bandas = bandasValidas(p.bandas) || [];
      return out;
    }
    if (!Number.isFinite(p.fator)) return null;
    const bandas = bandasValidas(p.bandas);
    if (!bandas) return null;
    out.versao = 1;
    out.fator = limitar(p.fator, 0.7, 1.45); // acima disso a voz soa artificial (efeitos antigos também entram no limite)
    out.tom = Math.round(12 * Math.log2(out.fator) * 2) / 2;
    out.bandas = bandas;
    return out;
  }
  // Modelos para começar o efeito (parecidos com os efeitos prontos).
  const MODELOS_EFEITO = {
    zero: { nome: 'Do zero (voz normal)', ajustes: {} },
    robo: { nome: '🤖 Robô', ajustes: { roboInt: 75, roboVel: 70, distorcao: 15 } },
    grave: { nome: '🎙️ Voz grossa', ajustes: { tom: -5, graves: 3 } },
    agudo: { nome: '🐿️ Voz fina', ajustes: { tom: 6 } },
    radio: { nome: '📻 Rádio antigo', ajustes: { cortaGraves: 450, cortaAgudos: 3200, distorcao: 25 } },
    megafone: { nome: '📢 Megafone', ajustes: { cortaGraves: 550, cortaAgudos: 2800, distorcao: 70, medios: 4 } },
    caverna: { nome: '🕳️ Caverna', ajustes: { ambiente: 80, ecoVol: 20, ecoAtraso: 180, ecoRep: 30 } },
    alien: { nome: '👽 Alienígena', ajustes: { vibVel: 9, vibInt: 90, tom: 2 } },
    demonio: { nome: '😈 Demônio', ajustes: { tom: -10, distorcao: 45, graves: 4, ambiente: 25 } },
    agua: { nome: '🌊 Debaixo d\'água', ajustes: { cortaAgudos: 900, vibVel: 3.2, vibInt: 40, volume: 140 } },
    bebado: { nome: '🥴 Bêbado', ajustes: { vibVel: 1, vibInt: 100, tremVel: 1.3, tremInt: 25, cortaAgudos: 2600 } },
    estadio: { nome: '🏟️ Estádio (eco)', ajustes: { ecoVol: 55, ecoAtraso: 380, ecoRep: 45, ambiente: 35 } }
  };
  function perfilDoModelo(nome) { const m = MODELOS_EFEITO[nome] || MODELOS_EFEITO.zero; return perfilDeVoz({ versao: 2, ...m.ajustes }); }

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
      const ajustar = (o) => no.port.postMessage({ rnnoise: o.rnnoise !== false, porta: Boolean(o.porta), limiar: porcentagemParaPico(o.limiar), efeito: ID_VOZ_CRIADA.test(efeitoValido(o.efeito)) ? 'personalizado' : efeitoValido(o.efeito), perfil: ID_VOZ_CRIADA.test(efeitoValido(o.efeito)) ? (perfilDeVoz(o.perfil) || undefined) : undefined });
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

  // Passa um sinal (Float32Array 48 kHz) pelo MESMO filtro da chamada, só que fora de tempo real (sem microfone).
  // Usado pela criação de voz pra conferir e corrigir o efeito. Só o efeito de voz criada, sem RNNoise.
  async function processarOffline(sinal, perfil) {
    const Offline = raiz.OfflineAudioContext;
    if (!Offline || !raiz.AudioWorkletNode) throw new Error('Este sistema não tem suporte ao filtro avançado.');
    const contexto = new Offline(1, sinal.length, 48000);
    await carregarWorklet(contexto);
    const buffer = contexto.createBuffer(1, sinal.length, 48000);
    buffer.copyToChannel(sinal, 0);
    const fonte = contexto.createBufferSource(); fonte.buffer = buffer;
    const no = new raiz.AudioWorkletNode(contexto, 'estrivisor-ruido', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    no.port.postMessage({ rnnoise: false, porta: false, limiar: 0, efeito: 'personalizado', perfil: perfilDeVoz(perfil) || undefined });
    await new Promise((ok) => setTimeout(ok, 150)); // deixa a mensagem chegar antes de começar a processar
    fonte.connect(no); no.connect(contexto.destination);
    fonte.start();
    const pronto = await contexto.startRendering();
    return pronto.getChannelData(0);
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

  const Ruido = { EFEITOS, efeitoValido, perfilDeVoz, AJUSTES_EFEITO, MODELOS_EFEITO, perfilDoModelo, processarOffline, ESCALA_BARRA, porcentagemParaPico, picoParaPorcentagem, limiarValido, criarCadeia, criarProcessadorLiveKit };
  if (typeof module !== 'undefined' && module.exports) module.exports = Ruido;
  else raiz.Ruido = Ruido;
})(typeof window !== 'undefined' ? window : globalThis);

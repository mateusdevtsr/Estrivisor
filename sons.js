'use strict';
// ============================================================
// Sons do app (nova mensagem, alguém entrou na sala, microfone...).
// Aqui ficam só as regras (lista de eventos, sons padrão, validação), sem tocar nada,
// para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Sons.
// Os sons padrão são gerados na hora (nada de arquivo de áudio); a pessoa pode trocar cada
// um por um arquivo dela (guardado só neste computador).
// ============================================================
(function (raiz) {
  // Cada nota: f = frequência (Hz), t = início (s), d = duração (s), o = onda, v = volume (0 a 1)
  const n = (f, t, d, o = 'sine', v = 0.5) => ({ f, t, d, o, v });
  const EVENTOS = [
    { id: 'mensagem',      nome: 'Nova mensagem',                 desc: 'Chegou mensagem num canal de texto.',               notas: [n(880, 0, 0.09, 'sine', 0.5), n(1175, 0.09, 0.14, 'sine', 0.45)] },
    { id: 'dm',            nome: 'Mensagem direta',               desc: 'Um amigo mandou mensagem direta.',                  notas: [n(784, 0, 0.1), n(988, 0.1, 0.1), n(1319, 0.2, 0.2, 'sine', 0.45)] },
    { id: 'entrou',        nome: 'Alguém entrou na sala',         desc: 'Outra pessoa entrou na sala em que você está.',     notas: [n(523, 0, 0.1, 'triangle'), n(784, 0.1, 0.18, 'triangle')] },
    { id: 'saiu',          nome: 'Alguém saiu da sala',           desc: 'Outra pessoa saiu da sala em que você está.',       notas: [n(784, 0, 0.1, 'triangle'), n(523, 0.1, 0.18, 'triangle')] },
    { id: 'voceEntrou',    nome: 'Você entrou na sala',           desc: 'Quando a conexão de voz é feita.',                  notas: [n(523, 0, 0.1, 'triangle'), n(659, 0.1, 0.1, 'triangle'), n(784, 0.2, 0.22, 'triangle')] },
    { id: 'voceSaiu',      nome: 'Você saiu da sala',             desc: 'Quando você sai da chamada.',                       notas: [n(784, 0, 0.1, 'triangle'), n(659, 0.1, 0.1, 'triangle'), n(523, 0.2, 0.22, 'triangle')] },
    { id: 'micLigado',     nome: 'Microfone ligado',              desc: 'Você ligou o microfone.',                           notas: [n(1000, 0, 0.08, 'sine', 0.4), n(1300, 0.07, 0.08, 'sine', 0.4)] },
    { id: 'micDesligado',  nome: 'Microfone desligado',           desc: 'Você desligou o microfone.',                        notas: [n(1300, 0, 0.08, 'sine', 0.4), n(800, 0.07, 0.1, 'sine', 0.4)] },
    { id: 'surdoLigado',   nome: 'Áudio silenciado',              desc: 'Você silenciou tudo o que ouve (ensurdecer).',      notas: [n(600, 0, 0.1, 'square', 0.25), n(400, 0.1, 0.14, 'square', 0.25)] },
    { id: 'surdoDesligado',nome: 'Áudio reativado',               desc: 'Você voltou a ouvir.',                              notas: [n(400, 0, 0.1, 'square', 0.25), n(600, 0.1, 0.14, 'square', 0.25)] },
    { id: 'transmissao',   nome: 'Alguém começou a transmitir',   desc: 'Outra pessoa começou a compartilhar a tela.',       notas: [n(440, 0, 0.08, 'sawtooth', 0.25), n(660, 0.08, 0.08, 'sawtooth', 0.25), n(880, 0.16, 0.16, 'sawtooth', 0.25)] },
  ];
  const IDS = EVENTOS.map((e) => e.id);
  const TIPOS_AUDIO = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac'];
  const MAX_BYTES = 1024 * 1024; // 1 MB
  const MAX_SEGUNDOS = 6;
  const PADRAO = { ativo: true, volume: 60 };

  function validarArquivo(arq) {
    if (!arq || typeof arq !== 'object') return { ok: false, erro: 'Escolha um arquivo.' };
    if (!TIPOS_AUDIO.includes(arq.type)) return { ok: false, erro: 'Use um arquivo de áudio MP3, WAV ou OGG.' };
    if (!Number.isFinite(arq.size) || arq.size <= 0) return { ok: false, erro: 'Arquivo vazio.' };
    if (arq.size > MAX_BYTES) return { ok: false, erro: 'Arquivo grande demais (máximo de 1 MB). Use um som curto.' };
    return { ok: true };
  }

  function validar(bruto) {
    const b = bruto && typeof bruto === 'object' ? bruto : {};
    const eventos = {};
    const custom = {};
    const bEv = b.eventos && typeof b.eventos === 'object' ? b.eventos : {};
    const bCu = b.custom && typeof b.custom === 'object' && !Array.isArray(b.custom) ? b.custom : {};
    for (const id of IDS) {
      eventos[id] = Object.prototype.hasOwnProperty.call(bEv, id) && typeof bEv[id] === 'boolean' ? bEv[id] : true;
      const c = Object.prototype.hasOwnProperty.call(bCu, id) ? bCu[id] : null;
      if (c && typeof c === 'object' && TIPOS_AUDIO.includes(c.tipo)) {
        custom[id] = { tipo: c.tipo, nome: String(c.nome === undefined || c.nome === null ? '' : c.nome).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60) };
      }
    }
    return {
      ativo: typeof b.ativo === 'boolean' ? b.ativo : PADRAO.ativo,
      volume: Number.isInteger(b.volume) && b.volume >= 0 && b.volume <= 100 ? b.volume : PADRAO.volume,
      eventos,
      custom,
    };
  }

  const evento = (id) => EVENTOS.find((e) => e.id === id) || null;

  const api = { EVENTOS, IDS, TIPOS_AUDIO, MAX_BYTES, MAX_SEGUNDOS, PADRAO, validarArquivo, validar, evento };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.Sons = api;
})(typeof window !== 'undefined' ? window : globalThis);

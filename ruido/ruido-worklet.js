// Roda na thread de áudio (AudioWorklet). Tira ruído de fundo com RNNoise e, se ligada, aplica a porta de ruído.
// RNNoise trabalha em blocos de 480 amostras a 48 kHz (10 ms); o áudio chega em blocos de 128, por isso o buffer.
// Este arquivo é junto com rnnoise-sync.js pelo montar.js (gera ruido-pacote.js, que é o que o app carrega).
import criarModuloRnnoise from './rnnoise-sync.js';

const TAMANHO_BLOCO = 480;

// Efeitos de voz (brincadeira). Rodam depois do filtro de ruído e antes da porta.
//  robo  : modulação em anel (voz metálica)      grave/agudo : muda o tom sem mudar a velocidade
//  eco   : repete a voz com atraso
const TAM_PITCH = 4096;          // memória do mudador de tom (~85 ms)
const JANELA_PITCH = 2048;       // ~43 ms
const TAM_ECO = 16384;           // ~340 ms
const FATOR_TOM = { grave: 0.72, agudo: 1.45 };

class ProcessadorRuido extends AudioWorkletProcessor {
    constructor() {
        super();
        this.rnnoiseLigado = true;
        this.portaLigada = false;
        this.limiar = 0;          // pico (0 a 1) abaixo do qual a porta fecha
        this.ganhoPorta = 1;
        this.segurar = 0;         // amostras que a porta continua aberta depois da voz
        this.entrada = new Float32Array(TAMANHO_BLOCO);
        this.nEntrada = 0;
        this.saida = new Float32Array(TAMANHO_BLOCO * 4);
        this.iniSaida = 0; this.fimSaida = 0;   // fila circular de saída
        this.pronto = false;
        this.efeito = 'nenhum';
        this.faseRobo = 0;
        this.bufTom = new Float32Array(TAM_PITCH); this.escTom = 0; this.atrasoTom = 0;
        this.bufEco = new Float32Array(TAM_ECO); this.escEco = 0;
        this.port.onmessage = (e) => {
            const m = e.data || {};
            if (typeof m.rnnoise === 'boolean') this.rnnoiseLigado = m.rnnoise;
            if (typeof m.porta === 'boolean') this.portaLigada = m.porta;
            if (typeof m.limiar === 'number') this.limiar = Math.max(0, Math.min(1, m.limiar));
            if (typeof m.efeito === 'string') this.trocarEfeito(m.efeito);
        };
        try {
            const modulo = criarModuloRnnoise();
            Promise.resolve(modulo.ready || modulo).then((mod) => {
                this.mod = mod;
                this.estado = mod._rnnoise_create(0);
                this.ptrEntrada = mod._malloc(TAMANHO_BLOCO * 4);
                this.ptrSaida = mod._malloc(TAMANHO_BLOCO * 4);
                this.pronto = true;
                this.port.postMessage({ pronto: true });
            }).catch((err) => this.port.postMessage({ erro: String((err && err.message) || err) }));
        } catch (err) { this.port.postMessage({ erro: String((err && err.message) || err) }); }
    }

    trocarEfeito(nome) {
        if (!['nenhum', 'robo', 'grave', 'agudo', 'eco'].includes(nome) || nome === this.efeito) return;
        this.efeito = nome;
        this.bufTom.fill(0); this.bufEco.fill(0); this.atrasoTom = 0; this.faseRobo = 0;
    }

    aplicarEfeito(sai) {
        const n = sai.length;
        if (this.efeito === 'robo') {
            const passo = (2 * Math.PI * 70) / sampleRate;
            for (let i = 0; i < n; i++) {
                this.faseRobo += passo; if (this.faseRobo > 2 * Math.PI) this.faseRobo -= 2 * Math.PI;
                sai[i] = sai[i] * (0.25 + 0.75 * Math.sin(this.faseRobo)) * 1.6;
            }
        } else if (this.efeito === 'grave' || this.efeito === 'agudo') {
            // Duas leituras no mesmo buffer, defasadas pela metade da janela, com fade entre elas.
            const passo = 1 - FATOR_TOM[this.efeito];
            for (let i = 0; i < n; i++) {
                this.bufTom[this.escTom] = sai[i];
                this.atrasoTom += passo;
                if (this.atrasoTom >= JANELA_PITCH) this.atrasoTom -= JANELA_PITCH;
                else if (this.atrasoTom < 0) this.atrasoTom += JANELA_PITCH;
                let saida = 0;
                for (let k = 0; k < 2; k++) {
                    let d = this.atrasoTom + k * (JANELA_PITCH / 2);
                    if (d >= JANELA_PITCH) d -= JANELA_PITCH;
                    const peso = Math.sin(Math.PI * d / JANELA_PITCH); // some nas pontas da janela
                    let pos = this.escTom - d; if (pos < 0) pos += TAM_PITCH;
                    const i0 = Math.floor(pos), fr = pos - i0;
                    const a = this.bufTom[i0 % TAM_PITCH], b = this.bufTom[(i0 + 1) % TAM_PITCH];
                    saida += (a + (b - a) * fr) * peso * peso;
                }
                sai[i] = saida;
                this.escTom = (this.escTom + 1) % TAM_PITCH;
            }
        } else if (this.efeito === 'eco') {
            const atraso = Math.round(sampleRate * 0.28);
            for (let i = 0; i < n; i++) {
                const ler = (this.escEco - atraso + TAM_ECO) % TAM_ECO;
                const eco = this.bufEco[ler];
                this.bufEco[this.escEco] = sai[i] + eco * 0.42;
                sai[i] = sai[i] + eco * 0.55;
                this.escEco = (this.escEco + 1) % TAM_ECO;
            }
        }
        for (let i = 0; i < n; i++) { const v = sai[i]; sai[i] = v > 1 ? 1 : (v < -1 ? -1 : v); } // nunca estoura
    }

    processarBloco() {
        const mod = this.mod;
        const heap = mod.HEAPF32;
        const ie = this.ptrEntrada >> 2, is = this.ptrSaida >> 2;
        for (let i = 0; i < TAMANHO_BLOCO; i++) heap[ie + i] = this.entrada[i] * 32768;
        mod._rnnoise_process_frame(this.estado, this.ptrSaida, this.ptrEntrada);
        const cap = this.saida.length;
        for (let i = 0; i < TAMANHO_BLOCO; i++) {
            this.saida[this.fimSaida] = heap[is + i] / 32768;
            this.fimSaida = (this.fimSaida + 1) % cap;
        }
    }

    process(entradas, saidas) {
        const ent = entradas[0] && entradas[0][0];
        const sai = saidas[0] && saidas[0][0];
        if (!sai) return true;
        const n = sai.length;
        if (!ent) { sai.fill(0); return true; }

        if (!this.pronto || !this.rnnoiseLigado) {
            for (let i = 0; i < n; i++) sai[i] = ent[i];
        } else {
            const cap = this.saida.length;
            for (let i = 0; i < n; i++) {
                this.entrada[this.nEntrada++] = ent[i];
                if (this.nEntrada === TAMANHO_BLOCO) { this.processarBloco(); this.nEntrada = 0; }
            }
            let disponivel = (this.fimSaida - this.iniSaida + cap) % cap;
            for (let i = 0; i < n; i++) {
                if (disponivel > 0) { sai[i] = this.saida[this.iniSaida]; this.iniSaida = (this.iniSaida + 1) % cap; disponivel--; }
                else sai[i] = 0;
            }
        }

        if (this.efeito !== 'nenhum') this.aplicarEfeito(sai);

        if (this.portaLigada) {
            let pico = 0;
            for (let i = 0; i < n; i++) { const a = Math.abs(sai[i]); if (a > pico) pico = a; }
            const sr = sampleRate;
            if (pico >= this.limiar) this.segurar = Math.round(sr * 0.25); // mantém aberta 250 ms depois da fala
            else this.segurar = Math.max(0, this.segurar - n);
            const alvo = this.segurar > 0 ? 1 : 0;
            const passo = alvo === 1 ? 1 / (sr * 0.005) : 1 / (sr * 0.06); // abre em 5 ms, fecha em 60 ms
            for (let i = 0; i < n; i++) {
                if (this.ganhoPorta < alvo) this.ganhoPorta = Math.min(alvo, this.ganhoPorta + passo);
                else if (this.ganhoPorta > alvo) this.ganhoPorta = Math.max(alvo, this.ganhoPorta - passo);
                sai[i] *= this.ganhoPorta;
            }
        } else this.ganhoPorta = 1;
        return true;
    }
}
registerProcessor('estrivisor-ruido', ProcessadorRuido);

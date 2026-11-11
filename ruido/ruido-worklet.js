// Roda na thread de áudio (AudioWorklet). Tira ruído de fundo com RNNoise e, se ligada, aplica a porta de ruído.
// RNNoise trabalha em blocos de 480 amostras a 48 kHz (10 ms); o áudio chega em blocos de 128, por isso o buffer.
// Este arquivo é junto com rnnoise-sync.js pelo montar.js (gera ruido-pacote.js, que é o que o app carrega).
import criarModuloRnnoise from './rnnoise-sync.js';

const TAMANHO_BLOCO = 480;

// Efeitos de voz (brincadeira). Rodam depois do filtro de ruído e antes da porta.
//  robo  : modulação em anel (voz metálica)      grave/agudo : muda o tom sem mudar a velocidade
//  radio/megafone/agua : filtros   caverna : reverberação   alien/bebado : vibrato (linha de atraso que balança)
const TAM_PITCH = 4096;          // memória do mudador de tom (~85 ms)
const JANELA_PITCH = 2048;       // ~43 ms
const FATOR_TOM = { grave: 0.72, agudo: 1.45, demonio: 0.55 };
const EFEITOS_VALIDOS = ['nenhum', 'robo', 'grave', 'agudo', 'radio', 'megafone', 'caverna', 'alien', 'demonio', 'agua', 'bebado', 'personalizado'];
const TAM_VIBRATO = 4096;

// Filtro de 2 polos (passa-baixa / passa-alta), usado pelos efeitos de rádio, megafone e água.
class Biquad {
    constructor(tipo, freq, q) {
        const w0 = 2 * Math.PI * freq / sampleRate, c = Math.cos(w0), alfa = Math.sin(w0) / (2 * q);
        const a0 = 1 + alfa;
        if (tipo === 'baixa') { this.b0 = (1 - c) / 2; this.b1 = 1 - c; this.b2 = (1 - c) / 2; }
        else { this.b0 = (1 + c) / 2; this.b1 = -(1 + c); this.b2 = (1 + c) / 2; }
        this.b0 /= a0; this.b1 /= a0; this.b2 /= a0; this.a1 = (-2 * c) / a0; this.a2 = (1 - alfa) / a0;
        this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    }
    passar(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        return y;
    }
}
// Filtro de realce/corte numa faixa (equalizador): usado pelas vozes criadas a partir de uma gravação.
class Faixa {
    constructor(freq, ganhoDb, q) {
        const A = Math.pow(10, ganhoDb / 40), w0 = 2 * Math.PI * Math.min(freq, sampleRate * 0.45) / sampleRate;
        const c = Math.cos(w0), alfa = Math.sin(w0) / (2 * q), a0 = 1 + alfa / A;
        this.b0 = (1 + alfa * A) / a0; this.b1 = (-2 * c) / a0; this.b2 = (1 - alfa * A) / a0;
        this.a1 = (-2 * c) / a0; this.a2 = (1 - alfa / A) / a0;
        this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
    }
    passar(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
        return y;
    }
}
// Mudança de tom de boa qualidade pra voz (WSOLA): estica/encolhe o som alinhando as ondas de cada pedaço
// (sem o "tremido" do método simples) e depois lê mais rápido/devagar pra mudar o tom. Latência ~40 ms.
class Wsola {
    constructor(fator) {
        this.r = fator;
        this.N = 1024; this.Hs = 512; this.tol = 320;
        this.Ha = this.Hs / fator;                 // quanto a entrada avança por pedaço
        this.mascE = 16383; this.ent = new Float32Array(16384); this.wIn = 0;
        this.mascA = 4095; this.acc = new Float32Array(4096); this.outPos = 0;   // soma dos pedaços (overlap-add)
        this.mascQ = 8191; this.q = new Float32Array(8192); this.wq = 0; this.rp = 0; // saída do estágio 1
        this.janela = new Float32Array(this.N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / this.N));
        this.iniciado = false; this.nominal = 0; this.cont = 0; this.primeiro = true;
    }
    lerEnt(i) { return this.ent[i & this.mascE]; }
    gerarPedaco() {
        const { N, Hs, tol } = this;
        const nom = Math.round(this.nominal);
        if (this.wIn < nom + tol + N + 1) return false;       // ainda não chegou áudio suficiente
        let melhor = nom;
        if (!this.primeiro) {
            let maiorPontos = -Infinity;
            for (let d = -tol; d <= tol; d += 2) {
                const s = nom + d; if (s < 0) continue;
                let dot = 0, en = 1e-9;
                for (let i = 0; i < Hs; i += 4) { const a = this.lerEnt(s + i); dot += a * this.lerEnt(this.cont + i); en += a * a; }
                const pontos = dot / Math.sqrt(en);
                if (pontos > maiorPontos) { maiorPontos = pontos; melhor = s; }
            }
        }
        this.primeiro = false;
        for (let i = 0; i < N; i++) this.acc[(this.outPos + i) & this.mascA] += this.janela[i] * this.lerEnt(melhor + i);
        for (let i = 0; i < Hs; i++) { const k = (this.outPos + i) & this.mascA; this.q[(this.wq + i) & this.mascQ] = this.acc[k]; this.acc[k] = 0; }
        this.wq += Hs; this.outPos += Hs;
        this.cont = melhor + Hs; this.nominal += this.Ha;
        return true;
    }
    passar(x) {
        this.ent[this.wIn & this.mascE] = x; this.wIn++;
        if (!this.iniciado) {
            if (this.wIn < this.N + this.tol + this.Ha + 700) return 0;   // enchendo o começo
            this.iniciado = true; this.nominal = 0;
        }
        while (this.rp + 2 >= this.wq) { if (!this.gerarPedaco()) return 0; }
        const i0 = Math.floor(this.rp), fr = this.rp - i0;
        const a = this.q[i0 & this.mascQ], b = this.q[(i0 + 1) & this.mascQ];
        this.rp += this.r;
        return a + (b - a) * fr;
    }
}
// Reverberação simples (4 "pentes" + 2 "passa-tudo"): som de caverna.
class Reverb {
    constructor() {
        const f = sampleRate / 44100;
        this.pentes = [1557, 1617, 1491, 1422].map((t) => ({ buf: new Float32Array(Math.round(t * f * 1.7)), pos: 0, filtro: 0 }));
        this.tudo = [225, 556].map((t) => ({ buf: new Float32Array(Math.round(t * f)), pos: 0 }));
    }
    passar(x) {
        let soma = 0;
        for (const p of this.pentes) {
            const saida = p.buf[p.pos];
            p.filtro = saida * 0.65 + p.filtro * 0.35;           // abafa os agudos a cada volta
            p.buf[p.pos] = x * 0.3 + p.filtro * 0.86;
            p.pos = (p.pos + 1) % p.buf.length;
            soma += saida;
        }
        let y = soma * 0.5;
        for (const a of this.tudo) {
            const b = a.buf[a.pos];
            const novo = y + b * 0.5;
            a.buf[a.pos] = novo;
            a.pos = (a.pos + 1) % a.buf.length;
            y = b - novo * 0.5;
        }
        return y;
    }
}

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
        this.filtros = []; this.reverb = null;
        this.eqPerfil = []; this.fatorPerfil = 1; this.cp = null; this.fpPerfil = [];
        this.bufEco = new Float32Array(48000); this.escEco = 0; this.reverbPerfil = null; this.faseRoboP = 0; this.faseTremP = 0;
        this.bufVib = new Float32Array(TAM_VIBRATO); this.escVib = 0; this.faseVib = 0;
        this.port.onmessage = (e) => {
            const m = e.data || {};
            if (typeof m.rnnoise === 'boolean') this.rnnoiseLigado = m.rnnoise;
            if (typeof m.porta === 'boolean') this.portaLigada = m.porta;
            if (typeof m.limiar === 'number') this.limiar = Math.max(0, Math.min(1, m.limiar));
            if (m.perfil) this.definirPerfil(m.perfil);
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

    // Efeito criado pela pessoa (números já conferidos pela tela, em ruido.js > perfilDeVoz). Cada ajuste novo
    // tem padrão "desligado", então perfis antigos (só tom + faixas) soam exatamente como antes.
    definirPerfil(p) {
        if (!p || !Number.isFinite(p.fator)) return;
        const num = (v, min, max, padrao) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : padrao);
        const fator = Math.max(0.5, Math.min(2, p.fator));
        if (fator !== this.fatorPerfil || !this.cp) this.wsola = Math.abs(fator - 1) > 0.001 ? new Wsola(fator) : null;
        this.fatorPerfil = fator;
        const cp = {
            graves: num(p.graves, -12, 12, 0), medios: num(p.medios, -12, 12, 0), agudos: num(p.agudos, -12, 12, 0),
            cortaGraves: num(p.cortaGraves, 0, 1000, 0), cortaAgudos: num(p.cortaAgudos, 800, 12000, 12000),
            distorcao: num(p.distorcao, 0, 100, 0) / 100,
            roboVel: num(p.roboVel, 10, 300, 70), roboInt: num(p.roboInt, 0, 100, 0) / 100,
            vibVel: num(p.vibVel, 0.5, 12, 5), vibInt: num(p.vibInt, 0, 100, 0) / 100,
            tremVel: num(p.tremVel, 0.5, 15, 4), tremInt: num(p.tremInt, 0, 100, 0) / 100,
            ecoAtraso: num(p.ecoAtraso, 50, 800, 250), ecoRep: num(p.ecoRep, 0, 85, 35) / 100, ecoVol: num(p.ecoVol, 0, 100, 0) / 100,
            ambiente: num(p.ambiente, 0, 100, 0) / 100, volume: num(p.volume, 0, 200, 100) / 100
        };
        cp.drive = 1 + cp.distorcao * 14;
        cp.ecoAmostras = Math.round(cp.ecoAtraso * sampleRate / 1000);
        this.cp = cp;
        const eq = Array.isArray(p.bandas) ? p.bandas.filter((b) => b && Number.isFinite(b.f) && Number.isFinite(b.g))
            .slice(0, 24).map((b) => new Faixa(b.f, Math.max(-10, Math.min(10, b.g)), 1.6)) : [];
        if (cp.graves) eq.push(new Faixa(150, cp.graves, 0.7));
        if (cp.medios) eq.push(new Faixa(1000, cp.medios, 0.8));
        if (cp.agudos) eq.push(new Faixa(4500, cp.agudos, 0.7));
        this.eqPerfil = eq;
        this.fpPerfil = [];
        if (cp.cortaGraves > 0) this.fpPerfil.push(new Biquad('alta', cp.cortaGraves, 0.75));
        if (cp.cortaAgudos < 12000) this.fpPerfil.push(new Biquad('baixa', cp.cortaAgudos, 0.75));
        if (cp.ambiente > 0 && !this.reverbPerfil) this.reverbPerfil = new Reverb();
        if (cp.ecoVol === 0) this.bufEco.fill(0);
    }

    // Um efeito criado à mão, amostra por amostra: tom > filtros > timbre > robô > distorção > vibrato > tremolo > eco > ambiente > volume.
    passarPerfil(x) {
        const cp = this.cp;
        let v = this.wsola ? this.wsola.passar(x) : x;
        for (const f of this.fpPerfil) v = f.passar(v);
        for (const f of this.eqPerfil) v = f.passar(v);
        if (!cp) return v;
        const DOIS_PI = 2 * Math.PI;
        if (cp.roboInt > 0) {
            this.faseRoboP += (DOIS_PI * cp.roboVel) / sampleRate; if (this.faseRoboP > DOIS_PI) this.faseRoboP -= DOIS_PI;
            v = v * ((1 - cp.roboInt) + cp.roboInt * 1.4 * Math.sin(this.faseRoboP));
        }
        if (cp.distorcao > 0) v = Math.tanh(v * cp.drive) / Math.sqrt(cp.drive) * 1.2;
        if (cp.vibInt > 0) { const prof = cp.vibInt * 120; v = this.vibrato(v, cp.vibVel, prof, prof + 30); }
        if (cp.tremInt > 0) {
            this.faseTremP += (DOIS_PI * cp.tremVel) / sampleRate; if (this.faseTremP > DOIS_PI) this.faseTremP -= DOIS_PI;
            v *= 1 - cp.tremInt * (0.5 - 0.5 * Math.sin(this.faseTremP));
        }
        if (cp.ecoVol > 0) {
            const tam = this.bufEco.length;
            let pos = this.escEco - cp.ecoAmostras; if (pos < 0) pos += tam;
            const atrasado = this.bufEco[pos];
            this.bufEco[this.escEco] = v + atrasado * cp.ecoRep;
            this.escEco = (this.escEco + 1) % tam;
            v += atrasado * cp.ecoVol;
        }
        if (cp.ambiente > 0 && this.reverbPerfil) v = v * (1 - cp.ambiente * 0.35) + this.reverbPerfil.passar(v) * cp.ambiente * 0.9;
        return v * cp.volume;
    }

    trocarEfeito(nome) {
        if (!EFEITOS_VALIDOS.includes(nome) || nome === this.efeito) return;
        this.efeito = nome;
        this.bufTom.fill(0); this.bufVib.fill(0); this.atrasoTom = 0; this.faseRobo = 0; this.faseVib = 0; this.faseVib2 = 0; this.faseTrem = 0;
        this.filtros = nome === 'radio' ? [new Biquad('alta', 450, 0.8), new Biquad('baixa', 3200, 0.8)]
            : nome === 'megafone' ? [new Biquad('alta', 550, 0.9), new Biquad('baixa', 2800, 0.9)]
            
            : nome === 'agua' ? [new Biquad('baixa', 650, 0.9)]
            : nome === 'bebado' ? [new Biquad('baixa', 2600, 0.8)] : [];
        this.reverb = nome === 'caverna' ? new Reverb() : null;
    }

    // Linha de atraso que balança (vibrato): "profundidade" e "atraso" em amostras, "freq" em Hz.
    vibrato(x, freq, profundidade, atrasoBase) {
        this.bufVib[this.escVib] = x;
        this.faseVib += (2 * Math.PI * freq) / sampleRate; if (this.faseVib > 2 * Math.PI) this.faseVib -= 2 * Math.PI;
        const d = atrasoBase + profundidade * Math.sin(this.faseVib);
        let pos = this.escVib - d; if (pos < 0) pos += TAM_VIBRATO;
        const i0 = Math.floor(pos), fr = pos - i0;
        const a = this.bufVib[i0 % TAM_VIBRATO], b = this.bufVib[(i0 + 1) % TAM_VIBRATO];
        this.escVib = (this.escVib + 1) % TAM_VIBRATO;
        return a + (b - a) * fr;
    }

    aplicarEfeito(sai) {
        const n = sai.length;
        if (this.efeito === 'robo') {
            const passo = (2 * Math.PI * 70) / sampleRate;
            for (let i = 0; i < n; i++) {
                this.faseRobo += passo; if (this.faseRobo > 2 * Math.PI) this.faseRobo -= 2 * Math.PI;
                sai[i] = sai[i] * (0.25 + 0.75 * Math.sin(this.faseRobo)) * 1.6;
            }
        } else if (this.efeito === 'personalizado') {
            for (let i = 0; i < n; i++) sai[i] = this.passarPerfil(sai[i]);
        } else if (this.efeito === 'radio' || this.efeito === 'megafone') {
            const forte = this.efeito === 'megafone';
            for (let i = 0; i < n; i++) {
                let v = sai[i];
                for (const f of this.filtros) v = f.passar(v);
                sai[i] = forte ? Math.tanh(v * 6) * 0.7 : Math.tanh(v * 2.2) * 0.9;
            }
        } else if (this.efeito === 'caverna') {
            for (let i = 0; i < n; i++) sai[i] = sai[i] * 0.75 + this.reverb.passar(sai[i]) * 0.9;
        } else if (this.efeito === 'alien') {
            for (let i = 0; i < n; i++) sai[i] = this.vibrato(sai[i], 9, 110, 160);
        } else if (this.efeito === 'bebado') {
            // Tom que sobe e desce devagar (como quem arrasta as palavras), tremida rápida e volume oscilando.
            for (let i = 0; i < n; i++) {
                this.bufVib[this.escVib] = this.filtros[0].passar(sai[i]);
                this.faseVib += (2 * Math.PI * 0.45) / sampleRate; if (this.faseVib > 2 * Math.PI) this.faseVib -= 2 * Math.PI;
                this.faseVib2 += (2 * Math.PI * 5.5) / sampleRate; if (this.faseVib2 > 2 * Math.PI) this.faseVib2 -= 2 * Math.PI;
                this.faseTrem += (2 * Math.PI * 1.3) / sampleRate; if (this.faseTrem > 2 * Math.PI) this.faseTrem -= 2 * Math.PI;
                const d = 1900 + 1500 * Math.sin(this.faseVib) + 40 * Math.sin(this.faseVib2);
                let pos = this.escVib - d; if (pos < 0) pos += TAM_VIBRATO;
                const i0 = Math.floor(pos), fr = pos - i0;
                const a = this.bufVib[i0 % TAM_VIBRATO], b = this.bufVib[(i0 + 1) % TAM_VIBRATO];
                this.escVib = (this.escVib + 1) % TAM_VIBRATO;
                sai[i] = (a + (b - a) * fr) * (0.8 + 0.2 * Math.sin(this.faseTrem));
            }
        } else if (this.efeito === 'agua') {
            for (let i = 0; i < n; i++) sai[i] = this.vibrato(this.filtros[0].passar(sai[i]), 3.2, 45, 70) * 1.6;
        } else if (this.efeito === 'grave' || this.efeito === 'agudo' || this.efeito === 'demonio') {
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
                sai[i] = this.efeito === 'demonio' ? Math.tanh(saida * 2.4) * 0.8 : saida;
                this.escTom = (this.escTom + 1) % TAM_PITCH;
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

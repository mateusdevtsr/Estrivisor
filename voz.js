// "Criar efeito a partir de uma voz": mede o tom e o timbre de uma gravação e monta, sozinho, um efeito que aproxima
// a sua voz dessa voz. Tudo aqui é conta pura (sem tela, sem rede), testada em testes/voz.test.js.
// O áudio nunca sai do computador; do efeito guardamos só números (fator de tom + ganho por faixa de frequência).
(function (raiz) {
    'use strict';
    const TAXA = 16000;                 // as gravações são convertidas pra 16 kHz antes de entrar aqui
    const TAM_FFT = 1024;               // 64 ms
    const SALTO = 512;
    const F0_MIN = 70, F0_MAX = 500;
    const N_BANDAS = 16;
    const FREQ_INI = 100, FREQ_FIM = 7000;
    const MIN_VOZ_SEG = 3;              // abaixo disso a medida não é confiável
    const GANHO_MAX_DB = 14;
    const FATOR_MIN = 0.5, FATOR_MAX = 2;          // o que um perfil guardado pode ter
    const FATOR_NATURAL_MIN = 0.75, FATOR_NATURAL_MAX = 1.35; // acima disso a voz vira "chiado de gato": o timbre fica por conta do equalizador

    // Frequências centrais das faixas (espaço logarítmico).
    const BANDAS_HZ = Array.from({ length: N_BANDAS }, (_, i) => Math.round(FREQ_INI * Math.pow(FREQ_FIM / FREQ_INI, i / (N_BANDAS - 1))));

    const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
    const mediana = (l) => { if (!l.length) return 0; const o = l.slice().sort((a, b) => a - b); const m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2; };

    // FFT simples (radix-2, in-place) sobre partes real e imaginária.
    function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < len / 2; k++) {
                    const a = i + k, b = i + k + len / 2;
                    const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
                    re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
                    const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
                }
            }
        }
    }

    // Tom de um trecho (autocorrelação). Devolve { f0, forca } ou null se não for voz.
    function medirTom(x, ini, tam, taxa) {
        const lagMin = Math.floor(taxa / F0_MAX), lagMax = Math.min(Math.floor(taxa / F0_MIN), tam - 1);
        let r0 = 0;
        for (let i = 0; i < tam; i++) r0 += x[ini + i] * x[ini + i];
        if (r0 < 1e-9) return null;
        const r = new Float32Array(lagMax + 2);
        let melhor = 0;
        for (let lag = lagMin; lag <= lagMax + 1; lag++) {
            let s = 0;
            for (let i = 0; i + lag < tam; i++) s += x[ini + i] * x[ini + i + lag];
            r[lag] = s / r0;
            if (lag <= lagMax && r[lag] > melhor) melhor = r[lag];
        }
        if (melhor < 0.55) return null;
        // Prefere o menor atraso quase tão bom quanto o melhor (evita pegar a metade do tom).
        let lagEscolhido = -1;
        for (let lag = lagMin + 1; lag < lagMax; lag++) {
            if (r[lag] >= melhor * 0.9 && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) { lagEscolhido = lag; break; }
        }
        if (lagEscolhido < 0) return null;
        const a = r[lagEscolhido - 1], b = r[lagEscolhido], c = r[lagEscolhido + 1];
        const den = a - 2 * b + c;
        const desloc = den !== 0 ? 0.5 * (a - c) / den : 0;
        return { f0: taxa / (lagEscolhido + limitar(desloc, -1, 1)), forca: melhor };
    }

    // Analisa uma gravação (Float32Array mono em 16 kHz). Devolve { f0, bandas (dB, média zero), vozSeg, duracao, confiavel }.
    function analisar(amostras, taxa) {
        const sr = taxa || TAXA;
        const total = amostras.length;
        const duracao = total / sr;
        const janela = new Float32Array(TAM_FFT).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (TAM_FFT - 1)));
        // Nível de referência: só consideramos "voz" trechos com energia razoável perto do mais forte.
        let maxRms = 0;
        const rmsDe = (ini) => { let s = 0; for (let i = 0; i < TAM_FFT; i++) s += amostras[ini + i] * amostras[ini + i]; return Math.sqrt(s / TAM_FFT); };
        for (let ini = 0; ini + TAM_FFT <= total; ini += SALTO) maxRms = Math.max(maxRms, rmsDe(ini));
        const tons = [];
        const soma = new Float64Array(N_BANDAS);
        const cont = new Float64Array(N_BANDAS);
        let quadros = 0;
        const re = new Float32Array(TAM_FFT), im = new Float32Array(TAM_FFT);
        const resolucao = sr / TAM_FFT;
        const limites = BANDAS_HZ.map((f, i) => {
            const ant = i === 0 ? f / Math.pow(FREQ_FIM / FREQ_INI, 1 / (N_BANDAS - 1)) : BANDAS_HZ[i - 1];
            const prox = i === N_BANDAS - 1 ? f * Math.pow(FREQ_FIM / FREQ_INI, 1 / (N_BANDAS - 1)) : BANDAS_HZ[i + 1];
            return [Math.sqrt(ant * f), Math.sqrt(f * prox)];
        });
        for (let ini = 0; ini + TAM_FFT <= total; ini += SALTO) {
            if (maxRms === 0 || rmsDe(ini) < maxRms * 0.12) continue;
            const t = medirTom(amostras, ini, TAM_FFT, sr);
            if (!t) continue;
            tons.push(t.f0); quadros++;
            for (let i = 0; i < TAM_FFT; i++) { re[i] = amostras[ini + i] * janela[i]; im[i] = 0; }
            fft(re, im);
            for (let b = 0; b < N_BANDAS; b++) {
                const k0 = Math.max(1, Math.floor(limites[b][0] / resolucao)), k1 = Math.min(TAM_FFT / 2 - 1, Math.max(k0, Math.ceil(limites[b][1] / resolucao)));
                let p = 0, n = 0;
                for (let k = k0; k <= k1; k++) { p += re[k] * re[k] + im[k] * im[k]; n++; }
                if (n) { soma[b] += p / n; cont[b]++; }
            }
        }
        const vozSeg = quadros * SALTO / sr;
        const db = Array.from({ length: N_BANDAS }, (_, b) => (cont[b] ? 10 * Math.log10(soma[b] / cont[b] + 1e-12) : -120));
        const media = db.reduce((a, v) => a + v, 0) / N_BANDAS;
        return { f0: mediana(tons), bandas: db.map((v) => v - media), vozSeg, duracao, confiavel: vozSeg >= MIN_VOZ_SEG && tons.length > 0 };
    }

    // Junta várias análises (da mesma voz) numa só, dando mais peso a quem tem mais fala.
    function combinar(lista) {
        const boas = (lista || []).filter((a) => a && a.vozSeg > 0);
        if (!boas.length) return null;
        const peso = boas.map((a) => a.vozSeg);
        const tot = peso.reduce((a, v) => a + v, 0);
        const bandas = Array.from({ length: N_BANDAS }, (_, b) => boas.reduce((s, a, i) => s + a.bandas[b] * peso[i], 0) / tot);
        const media = bandas.reduce((a, v) => a + v, 0) / N_BANDAS;
        const f0s = boas.map((a) => a.f0).filter((v) => v > 0);
        return { f0: f0s.length ? mediana(f0s) : 0, bandas: bandas.map((v) => v - media), vozSeg: tot, duracao: boas.reduce((s, a) => s + a.duracao, 0), confiavel: tot >= MIN_VOZ_SEG && f0s.length > 0 };
    }

    // Valor da curva (dB) numa frequência qualquer, interpolando entre as faixas (em escala de frequência logarítmica).
    function valorNaFrequencia(bandas, hz) {
        if (hz <= BANDAS_HZ[0]) return bandas[0];
        if (hz >= BANDAS_HZ[N_BANDAS - 1]) return bandas[N_BANDAS - 1];
        for (let i = 0; i < N_BANDAS - 1; i++) {
            if (hz <= BANDAS_HZ[i + 1]) {
                const t = Math.log(hz / BANDAS_HZ[i]) / Math.log(BANDAS_HZ[i + 1] / BANDAS_HZ[i]);
                return bandas[i] + (bandas[i + 1] - bandas[i]) * t;
            }
        }
        return bandas[N_BANDAS - 1];
    }

    // Monta o efeito: fator de tom (alvo ÷ sua voz) + ganho por faixa. Como mudar o tom também desloca o timbre,
    // o ganho é calculado em cima do timbre que a sua voz TERÁ depois de mudar o tom, pra não corrigir duas vezes.
    function criarPerfil(base, alvo) {
        if (!base || !alvo || !(base.f0 > 0) || !(alvo.f0 > 0)) return null;
        const bruto = alvo.f0 / base.f0;
        const fator = limitar(bruto, FATOR_NATURAL_MIN, FATOR_NATURAL_MAX);
        const bandas = BANDAS_HZ.map((f, i) => {
            const baseDeslocada = valorNaFrequencia(base.bandas, f / fator);
            return { f, g: Math.round(limitar((alvo.bandas[i] - baseDeslocada) * 0.85, -GANHO_MAX_DB, GANHO_MAX_DB) * 10) / 10 };
        });
        return { fator: Math.round(fator * 1000) / 1000, bruto: Math.round(bruto * 1000) / 1000, bandas };
    }

    // Confere um perfil vindo do disco (ou da tela) antes de mandar pro filtro.
    function perfilValido(p) {
        if (!p || typeof p !== 'object' || !Number.isFinite(p.fator) || !Array.isArray(p.bandas) || p.bandas.length !== N_BANDAS) return null;
        const bandas = [];
        for (let i = 0; i < N_BANDAS; i++) {
            const b = p.bandas[i];
            if (!b || !Number.isFinite(b.g)) return null;
            bandas.push({ f: BANDAS_HZ[i], g: limitar(b.g, -GANHO_MAX_DB, GANHO_MAX_DB) });
        }
        return { fator: limitar(p.fator, FATOR_MIN, FATOR_MAX), bandas };
    }

    // Texto simples do que foi medido.
    function resumo(base, alvo, perfil) {
        if (!base || !alvo || !perfil) return '';
        const pct = Math.round(Math.abs(perfil.fator - 1) * 100);
        const hz = ` (a sua: ${Math.round(base.f0)} Hz; a alvo: ${Math.round(alvo.f0)} Hz)`;
        let tom = pct < 4 ? 'O tom das duas vozes é parecido.' : `A voz alvo é cerca de ${Math.round(Math.abs(perfil.bruto - 1) * 100)}% ${perfil.bruto < 1 ? 'mais grave' : 'mais aguda'} que a sua${hz}.`;
        if (pct < 4) tom += hz;
        if (perfil.bruto && (perfil.bruto < FATOR_NATURAL_MIN || perfil.bruto > FATOR_NATURAL_MAX)) tom += ' A diferença é grande: limitei a mudança de tom pra a voz não ficar artificial, e o resto do parecido fica por conta do timbre.';
        if (alvo.f0 > 330 || alvo.f0 < 75 || base.f0 > 330 || base.f0 < 75) tom += ' ⚠ Um dos tons medidos parece fora do normal pra fala: o áudio pode ter música ou barulho. Prefira um trecho só com a pessoa falando.';
        const ag = perfil.bandas.filter((b) => b.f >= 3000).reduce((s, b) => s + b.g, 0) / perfil.bandas.filter((b) => b.f >= 3000).length;
        const gr = perfil.bandas.filter((b) => b.f <= 400).reduce((s, b) => s + b.g, 0) / perfil.bandas.filter((b) => b.f <= 400).length;
        const frases = [];
        if (ag > 2) frases.push('mais brilho nos agudos'); else if (ag < -2) frases.push('agudos mais suaves');
        if (gr > 2) frases.push('mais corpo nos graves'); else if (gr < -2) frases.push('graves mais leves');
        return tom + (frases.length ? ' O efeito vai dar ' + frases.join(' e ') + '.' : '');
    }

    // ---- Refinamento automático ("aprender" a ficar parecido) ----
    // Gera uma voz de teste com o SEU tom e timbre (harmônicos com a curva medida), passa pelo efeito, mede de novo
    // e corrige o que ainda difere da voz alvo. Repete até parar de melhorar. Nenhum áudio real é usado nem guardado.
    const TAXA_FILTRO = 48000;
    function sinalDeTeste(base, seg) {
        const n = Math.round(TAXA_FILTRO * (seg || 3.6)), x = new Float32Array(n);
        const f0 = base.f0;
        const harmonicas = [];
        for (let h = 1; h * f0 < 7000; h++) harmonicas.push({ f: h * f0, a: Math.pow(10, valorNaFrequencia(base.bandas, h * f0) / 20) });
        let pico = 0;
        for (let i = 0; i < n; i++) {
            const t = i / TAXA_FILTRO;
            const fase0 = 2 * Math.PI * f0 * (t + 0.0006 * Math.sin(2 * Math.PI * 4.5 * t) / (2 * Math.PI * 4.5)); // vibrato bem leve
            let v = 0;
            for (let k = 0; k < harmonicas.length; k++) v += harmonicas[k].a * Math.sin((k + 1) * fase0 + k * 0.7);
            x[i] = v; if (Math.abs(v) > pico) pico = Math.abs(v);
        }
        const g = pico > 0 ? 0.3 / pico : 1;
        for (let i = 0; i < n; i++) x[i] *= g;
        return x;
    }
    function para16k(x48) {
        const r = Math.floor(TAXA_FILTRO / TAXA), y = new Float32Array(Math.floor(x48.length / r));
        for (let i = 0; i < y.length; i++) { let s = 0; for (let k = 0; k < r; k++) s += x48[i * r + k]; y[i] = s / r; }
        return y;
    }
    function distancia(a, b) { let s = 0; for (let i = 0; i < N_BANDAS; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return Math.sqrt(s / N_BANDAS); }

    // processar(perfil, sinal48k) -> Promise<Float32Array 48k> (roda o MESMO filtro da chamada). Devolve { perfil, antes, depois, voltas }.
    async function refinar(base, alvo, perfilInicial, processar, aoProgresso) {
        const sinal = sinalDeTeste(base);
        const corte = Math.round(TAXA_FILTRO * 0.8); // ignora o começo (o filtro ainda está "enchendo")
        const medir = async (perfil) => {
            const saida = await processar(perfil, sinal);
            return analisar(para16k(saida.subarray(corte)), TAXA);
        };
        let atual = JSON.parse(JSON.stringify(perfilInicial));
        let m = await medir(atual);
        const antes = m.bandas ? distancia(m.bandas, alvo.bandas) : 99;
        let melhor = { perfil: JSON.parse(JSON.stringify(atual)), d: antes };
        let voltas = 0;
        for (let v = 1; v <= 6; v++) {
            if (aoProgresso) aoProgresso(v, 6);
            if (!m.bandas || !(m.vozSeg > 0)) break;
            atual = { ...atual, bandas: atual.bandas.map((b, i) => ({ f: b.f, g: Math.round(limitar(b.g + 0.75 * (alvo.bandas[i] - m.bandas[i]), -10, 10) * 10) / 10 })) };
            m = await medir(atual);
            voltas = v;
            const d = m.bandas ? distancia(m.bandas, alvo.bandas) : 99;
            if (d < melhor.d - 0.02) melhor = { perfil: JSON.parse(JSON.stringify(atual)), d };
            else if (v >= 2) break;                       // parou de melhorar
            if (d < 1) break;
        }
        return { perfil: melhor.perfil, antes, depois: melhor.d, voltas };
    }

    const api = { TAXA, N_BANDAS, BANDAS_HZ, MIN_VOZ_SEG, GANHO_MAX_DB, analisar, combinar, criarPerfil, perfilValido, resumo, valorNaFrequencia, sinalDeTeste, refinar, distancia };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else raiz.Voz = api;
})(typeof window !== 'undefined' ? window : globalThis);

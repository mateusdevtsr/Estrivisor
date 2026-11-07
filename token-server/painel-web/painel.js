'use strict';
// Painel do Estrivisor: busca /painel/api/resumo e desenha os números, gráficos e tabelas.
// Sem bibliotecas: os gráficos são SVG desenhados aqui. Todo texto vindo do servidor entra
// com textContent (nunca como HTML).
(function () {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const estado = { dias: 30, dados: null, ultimaCarga: 0, pedido: 0, relogio: null };
  const tabelasAbertas = new Set();
  const graficos = new Map(); // id do cartão -> { area, desenhar }

  // ---------- preferências do navegador (só conveniência; funciona sem) ----------
  function lerPref(chave) { try { return localStorage.getItem('painel-' + chave); } catch (e) { return null; } }
  function gravarPref(chave, valor) { try { localStorage.setItem('painel-' + chave, valor); } catch (e) { /* sem armazenamento */ } }

  // ---------- formatação (pt-BR, horário de Brasília) ----------
  const nf = new Intl.NumberFormat('pt-BR');
  const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
  const vazio = (v) => v === null || v === undefined || Number.isNaN(v);
  const num = (v) => (vazio(v) ? '–' : nf.format(v));
  function compacto(v) {
    if (vazio(v)) return '–';
    const a = Math.abs(v);
    if (a >= 1e6) return nf1.format(v / 1e6) + ' mi';
    if (a >= 1e4) return nf1.format(v / 1e3) + ' mil';
    return a < 10 && !Number.isInteger(v) ? nf2.format(v) : nf.format(Math.round(v));
  }
  function horas(min) {
    if (vazio(min)) return '–';
    if (min < 60) return `${Math.round(min)} min`;
    const h = min / 60;
    return (h >= 100 ? nf.format(Math.round(h)) : nf1.format(h)) + ' h';
  }
  const pct = (v) => (vazio(v) ? '–' : nf.format(Math.round(v)) + '%');
  const pl = (n, um, varios) => `${num(n)} ${n === 1 ? um : varios}`;
  const FUSO = { timeZone: 'America/Sao_Paulo' };
  const fmtDiaCurto = (dia) => { const p = dia.split('-'); return `${p[2]}/${p[1]}`; };
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const semanaDoDia = (dia) => SEMANA[new Date(dia + 'T12:00:00Z').getUTCDay()];
  const fmtHora = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { ...FUSO, hour: '2-digit', minute: '2-digit' });
  const fmtData = (ts) => new Date(ts).toLocaleDateString('pt-BR', FUSO);
  const fmtDataHora = (ts) => new Date(ts).toLocaleString('pt-BR', { ...FUSO, dateStyle: 'short', timeStyle: 'short' });
  const fmtDiaHora = (ts) => `${fmtData(ts).slice(0, 5)} às ${fmtHora(ts)}`;
  function haQuanto(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return 'agora há pouco';
    if (s < 3600) return `há ${Math.round(s / 60)} min`;
    if (s < 36 * 3600) return `há ${Math.round(s / 3600)} h`;
    return `há ${Math.round(s / 86400)} dias`;
  }
  function duracao(seg) {
    const d = Math.floor(seg / 86400); const h = Math.floor((seg % 86400) / 3600); const m = Math.floor((seg % 3600) / 60);
    if (d) return `${d} d ${h} h`;
    if (h) return `${h} h ${m} min`;
    return `${m} min`;
  }
  function compararVersoes(a, b) {
    const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
    return 0;
  }

  // ---------- criar elementos ----------
  function el(tag, props, ...filhos) {
    const e = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'classe') e.className = v;
        else if (k === 'texto') e.textContent = v;
        else e.setAttribute(k, v === true ? '' : String(v));
      }
    }
    for (const f of filhos.flat()) {
      if (f === null || f === undefined || f === false) continue;
      e.append(f instanceof Node ? f : document.createTextNode(String(f)));
    }
    return e;
  }
  function s(tag, attrs, texto) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) e.setAttribute(k, String(v));
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  // ---------- dica flutuante (tooltip) ----------
  const dica = $('dica');
  function preencherDica(titulo, linhas, nota) {
    dica.textContent = '';
    dica.append(el('div', { classe: 'dica-titulo', texto: titulo }));
    const comChave = linhas.some((l) => l.cor);
    for (const l of linhas) {
      dica.append(el('div', { classe: 'dica-linha' },
        l.cor ? el('i', { classe: 'chave b' + l.cor }) : (comChave ? el('i', { classe: 'chave' }) : null),
        el('strong', { texto: l.valor }),
        el('span', { texto: l.nome })));
    }
    if (nota) dica.append(el('div', { classe: 'dica-nota', texto: nota }));
  }
  function posicionarDica(x, y) {
    dica.hidden = false;
    const r = dica.getBoundingClientRect();
    let esq = x + 14; let topo = y + 14;
    if (esq + r.width > window.innerWidth - 8) esq = x - r.width - 14;
    if (topo + r.height > window.innerHeight - 8) topo = y - r.height - 14;
    dica.style.left = Math.max(8, esq) + 'px';
    dica.style.top = Math.max(8, topo) + 'px';
  }
  const esconderDica = () => { dica.hidden = true; };
  // Só um gráfico fica com a dica aberta por vez. No celular a dica fica aberta depois do toque
  // e fecha ao tocar fora do gráfico ou ao rolar a página.
  let graficoAtivo = null;
  const fecharDica = () => { if (graficoAtivo) graficoAtivo.sair(); else esconderDica(); };
  window.addEventListener('scroll', fecharDica, { passive: true });
  document.addEventListener('pointerdown', (e) => {
    if (graficoAtivo && !(e.target instanceof Element && e.target.closest('.grafico svg'))) graficoAtivo.sair();
  });

  // ---------- escala dos eixos ----------
  function escalaY(max, inteiro) {
    if (!(max > 0)) return { max: inteiro ? 4 : 1, passos: inteiro ? [0, 1, 2, 3, 4] : [0, 0.25, 0.5, 0.75, 1] };
    const bruto = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    const n = bruto / mag;
    let passo = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    if (inteiro) passo = Math.max(1, Math.ceil(passo));
    const topo = Math.ceil(max / passo - 1e-9) * passo;
    const passos = [];
    for (let i = 0; i * passo <= topo + 1e-9; i++) passos.push(Math.round(i * passo * 1000) / 1000);
    return { max: topo, passos };
  }
  const larguraTexto = (t) => String(t).length * 6.4;

  // Retângulo com a ponta (topo, ou direita) arredondada e a base reta.
  function barraVertical(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function barraHorizontal(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, h / 2, w));
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  // Liga o mouse e o teclado a um gráfico: indice(evt) diz qual item está sob o ponteiro.
  function interativo(svg, area, total, { indice, mostrar, esconder, posicao, inicial }) {
    let atual = null;
    const controle = { sair };
    function ir(i, x, y) {
      if (i === null || i < 0 || i >= total) return;
      if (graficoAtivo && graficoAtivo !== controle) graficoAtivo.sair();
      graficoAtivo = controle;
      atual = i;
      area.classList.add('com-foco');
      mostrar(i);
      posicionarDica(x, y);
    }
    function sair() {
      atual = null; area.classList.remove('com-foco'); esconder(); esconderDica();
      if (graficoAtivo === controle) graficoAtivo = null;
    }
    svg.addEventListener('pointermove', (e) => ir(indice(e), e.clientX, e.clientY));
    svg.addEventListener('pointerdown', (e) => ir(indice(e), e.clientX, e.clientY));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') sair(); });
    svg.addEventListener('blur', sair);
    svg.addEventListener('focus', () => { const i = atual === null ? inicial : atual; const p = posicao(i); ir(i, p.x, p.y); });
    svg.addEventListener('keydown', (e) => {
      const passo = e.shiftKey ? 10 : 1;
      let i = atual === null ? inicial : atual;
      if (e.key === 'ArrowLeft') i = Math.max(0, i - passo);
      else if (e.key === 'ArrowRight') i = Math.min(total - 1, i + passo);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = total - 1;
      else if (e.key === 'Escape') { sair(); return; } else return;
      e.preventDefault();
      const p = posicao(i);
      ir(i, p.x, p.y);
    });
  }
  function larguraDe(area) {
    return Math.max(260, Math.floor(area.clientWidth || (area.parentElement && area.parentElement.clientWidth) || 600));
  }

  // ---------- gráfico de colunas (por dia, por hora...), simples ou empilhado ----------
  function desenharColunas(area, cfg) {
    const { categorias, series, rotulos, formatar = num, inteiro = true, altura = 220 } = cfg;
    area.textContent = '';
    const n = categorias.length;
    const tem = (i) => series.some((se) => !vazio(se.valores[i]));
    if (!n || !categorias.some((_, i) => tem(i))) { area.append(el('div', { classe: 'vazio', texto: cfg.vazio || 'Ainda sem dados neste período.' })); return; }
    const somas = categorias.map((_, i) => series.reduce((t, se) => t + (se.valores[i] || 0), 0));
    const esc = escalaY(Math.max(...somas), inteiro);
    const W = larguraDe(area); const H = altura;
    const M = { t: cfg.anotacao !== undefined && cfg.anotacao !== null ? 24 : 10, r: 6, b: 26, l: Math.max(26, Math.max(...esc.passos.map((v) => larguraTexto(compacto(v)))) + 10) };
    const pw = W - M.l - M.r; const ph = H - M.t - M.b;
    const banda = pw / n;
    const largura = Math.max(1, Math.min(24, banda >= 5 ? Math.min(banda * 0.72, banda - 2) : banda - 1));
    const y = (v) => M.t + ph - (v / esc.max) * ph;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: 0, 'aria-label': cfg.descricao || '' });

    for (const v of esc.passos) {
      const yy = Math.round(y(v)) + 0.5;
      svg.append(s('line', { x1: M.l, x2: W - M.r, y1: yy, y2: yy, class: v === 0 ? 'linha-base' : 'linha-grade' }));
      svg.append(s('text', { x: M.l - 6, y: yy + 3.5, 'text-anchor': 'end', class: 'eixo-texto' }, compacto(v)));
    }
    const maxRotulos = Math.max(1, Math.floor(pw / (cfg.larguraRotulo || 44)));
    const passoRotulo = Math.ceil(n / maxRotulos);
    for (let i = n - 1; i >= 0; i -= passoRotulo) {
      svg.append(s('text', { x: M.l + banda * (i + 0.5), y: H - 8, 'text-anchor': 'middle', class: 'eixo-texto' }, rotulos[i]));
    }
    if (cfg.anotacao !== undefined && cfg.anotacao !== null && cfg.anotacao > 0 && cfg.anotacao < n) {
      const xa = Math.round(M.l + banda * cfg.anotacao) + 0.5;
      svg.append(s('line', { x1: xa, x2: xa, y1: M.t - 6, y2: M.t + ph, class: 'linha-anotacao' }));
      const perto = xa > W - 120;
      svg.append(s('text', { x: perto ? xa - 5 : xa + 5, y: M.t - 10, 'text-anchor': perto ? 'end' : 'start', class: 'rotulo-anotacao' }, cfg.textoAnotacao || ''));
    }

    const grupos = [];
    for (let i = 0; i < n; i++) {
      const g = s('g', { class: 'marca-dado' + (cfg.estimado && cfg.estimado[i] ? ' estimado' : '') });
      const xi = M.l + banda * i + (banda - largura) / 2;
      let topo = -1;
      series.forEach((se, k) => { if ((se.valores[i] || 0) > 0) topo = k; });
      let acumulado = 0; let temAbaixo = false;
      series.forEach((se, k) => {
        const v = se.valores[i] || 0;
        if (v <= 0) return;
        const yBase = y(acumulado); const yTopo = y(acumulado + v);
        acumulado += v;
        let h = yBase - yTopo - (temAbaixo ? 2 : 0); // 2px de folga entre partes empilhadas
        if (h < 1) h = 1;
        const r = k === topo && largura >= 6 ? 4 : (k === topo ? largura / 2 : 0);
        g.append(s('path', { d: barraVertical(xi, yTopo, largura, h, r), class: 'f' + se.cor }));
        temAbaixo = true;
      });
      svg.append(g);
      grupos.push(g);
    }
    const alvos = s('rect', { x: M.l, y: M.t, width: pw, height: ph, class: 'alvo' });
    svg.append(alvos);
    area.append(svg);

    const ultimo = (() => { for (let i = n - 1; i >= 0; i--) if (tem(i)) return i; return n - 1; })();
    interativo(svg, area, n, {
      inicial: ultimo,
      indice: (e) => {
        const r = svg.getBoundingClientRect(); const esc2 = W / r.width;
        const x = (e.clientX - r.left) * esc2;
        if (x < M.l || x > W - M.r) return null;
        return Math.min(n - 1, Math.max(0, Math.floor((x - M.l) / banda)));
      },
      posicao: (i) => { const r = svg.getBoundingClientRect(); const k = r.width / W; return { x: r.left + (M.l + banda * (i + 0.5)) * k, y: r.top + y(somas[i]) * k }; },
      mostrar: (i) => {
        grupos.forEach((g, k) => g.classList.toggle('ativa', k === i));
        const linhas = series.map((se) => ({ valor: vazio(se.valores[i]) ? 'sem dados' : formatar(se.valores[i]), nome: se.nome, cor: series.length > 1 ? se.cor : null }));
        if (series.length > 1 && series.every((se) => !vazio(se.valores[i]))) linhas.push({ valor: formatar(somas[i]), nome: 'no total' });
        const extra = cfg.extra ? cfg.extra(i) : [];
        preencherDica(cfg.tituloDica ? cfg.tituloDica(i) : rotulos[i], linhas.concat(extra), cfg.notaDica ? cfg.notaDica(i) : null);
      },
      esconder: () => grupos.forEach((g) => g.classList.remove('ativa')),
    });
  }

  // ---------- gráfico de linhas no tempo (últimas 24 h) ----------
  // Junta as fotos por minuto em blocos (1, 2, 5, 10, 15, 30 ou 60 min), conforme a largura:
  // por bloco, "max" pega o maior valor (picos), "media" a média por minuto e "soma" soma tudo.
  function agruparAmostras(amostras, minutos, campos) {
    const tam = minutos * 60e3;
    const blocos = new Map();
    for (const a of amostras) {
      const k = Math.floor(a.ts / tam) * tam;
      let b = blocos.get(k);
      if (!b) { b = { ts: k, n: 0, soma: {}, max: {}, livekitOk: true, latSoma: 0, latN: 0 }; blocos.set(k, b); }
      b.n++;
      for (const c of campos) { const v = a[c] || 0; b.soma[c] = (b.soma[c] || 0) + v; b.max[c] = Math.max(b.max[c] || 0, v); }
      if (!a.livekitOk) b.livekitOk = false;
      if (!vazio(a.latencia)) { b.latSoma += a.latencia; b.latN++; }
    }
    return [...blocos.values()].sort((p, q) => p.ts - q.ts);
  }
  function valorDoBloco(b, campo, modo) {
    if (modo === 'soma') return b.soma[campo] || 0;
    if (modo === 'media') return Math.round(((b.soma[campo] || 0) / b.n) * 10) / 10;
    return b.max[campo] || 0;
  }
  function desenharLinhas(area, cfg) {
    const { amostras, series, inicio, fim, formatar = num, altura = 230 } = cfg;
    area.textContent = '';
    if (!amostras.length) { area.append(el('div', { classe: 'vazio', texto: cfg.vazio || 'As medições começam alguns minutos depois de o servidor ligar.' })); return; }
    const W = larguraDe(area); const H = altura;
    const pwAprox = W - 50;
    const minutosNaJanela = (fim - inicio) / 60e3;
    const minutos = [1, 2, 5, 10, 15, 30, 60].find((m) => minutosNaJanela / m <= Math.max(48, pwAprox / 3)) || 60;
    const blocos = agruparAmostras(amostras, minutos, series.map((se) => se.campo).concat(cfg.camposExtras || []));
    const tempos = blocos.map((b) => b.ts + (minutos * 60e3) / 2);
    const valores = series.map((se) => blocos.map((b) => valorDoBloco(b, se.campo, se.modo || 'max')));
    const maxV = Math.max(0, ...valores.flat());
    const esc = escalaY(maxV, cfg.inteiro !== false);
    const M = { t: 10, r: 10, b: 26, l: Math.max(26, Math.max(...esc.passos.map((v) => larguraTexto(compacto(v)))) + 10) };
    const pw = W - M.l - M.r; const ph = H - M.t - M.b;
    const x = (t) => M.l + ((t - inicio) / (fim - inicio)) * pw;
    const y = (v) => M.t + ph - (v / esc.max) * ph;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: 0, 'aria-label': cfg.descricao || '' });
    for (const v of esc.passos) {
      const yy = Math.round(y(v)) + 0.5;
      svg.append(s('line', { x1: M.l, x2: W - M.r, y1: yy, y2: yy, class: v === 0 ? 'linha-base' : 'linha-grade' }));
      svg.append(s('text', { x: M.l - 6, y: yy + 3.5, 'text-anchor': 'end', class: 'eixo-texto' }, compacto(v)));
    }
    // marcas a cada 3 h (ou 6 h em tela estreita), no horário de Brasília
    const passoH = pw < 420 ? 6 : 3; const passoMs = passoH * 3600e3; const fusoMs = 3 * 3600e3;
    for (let t = Math.ceil((inicio - fusoMs) / passoMs) * passoMs + fusoMs; t <= fim; t += passoMs) {
      if (t < inicio) continue;
      svg.append(s('text', { x: x(t), y: H - 8, 'text-anchor': 'middle', class: 'eixo-texto' }, fmtHora(t)));
    }
    // linhas (com buraco onde faltou medição: servidor desligado)
    const buraco = minutos * 60e3 * 1.5 + 2 * 60e3;
    series.forEach((se, k) => {
      let d = ''; let anterior = null; const trechos = []; let trecho = [];
      tempos.forEach((t, i) => {
        const quebra = anterior === null || t - anterior > buraco;
        if (quebra && trecho.length) { trechos.push(trecho); trecho = []; }
        d += `${quebra ? 'M' : 'L'}${x(t).toFixed(1)},${y(valores[k][i]).toFixed(1)}`;
        trecho.push([t, valores[k][i]]);
        anterior = t;
      });
      if (trecho.length) trechos.push(trecho);
      if (cfg.preencher && series.length === 1) {
        for (const tr of trechos) {
          if (tr.length < 2) continue;
          const z = `M${x(tr[0][0]).toFixed(1)},${y(0)}` + tr.map((p) => `L${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('') + `L${x(tr[tr.length - 1][0]).toFixed(1)},${y(0)}Z`;
          svg.append(s('path', { d: z, class: 'lavagem f' + se.cor }));
        }
      }
      svg.append(s('path', { d, class: 'linha t' + se.cor }));
    });
    const mira = s('line', { x1: 0, x2: 0, y1: M.t, y2: M.t + ph, class: 'mira', visibility: 'hidden' });
    svg.append(mira);
    const pontos = series.map((se) => { const c = s('circle', { r: 4, cx: 0, cy: 0, class: 'ponto f' + se.cor, visibility: 'hidden' }); svg.append(c); return c; });
    svg.append(s('rect', { x: M.l, y: M.t, width: pw, height: ph, class: 'alvo' }));
    area.append(svg);

    function maisPerto(t) {
      let lo = 0; let hi = tempos.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tempos[m] < t) lo = m; else hi = m; }
      return Math.abs(tempos[lo] - t) <= Math.abs(tempos[hi] - t) ? lo : hi;
    }
    interativo(svg, area, tempos.length, {
      inicial: tempos.length - 1,
      indice: (e) => {
        const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width);
        if (px < M.l - 4 || px > W - M.r + 4) return null;
        return maisPerto(inicio + ((px - M.l) / pw) * (fim - inicio));
      },
      posicao: (i) => { const r = svg.getBoundingClientRect(); const k = r.width / W; return { x: r.left + x(tempos[i]) * k, y: r.top + (M.t + 20) * k }; },
      mostrar: (i) => {
        const xx = Math.round(x(tempos[i])) + 0.5;
        mira.setAttribute('x1', xx); mira.setAttribute('x2', xx); mira.setAttribute('visibility', 'visible');
        series.forEach((se, k) => {
          pontos[k].setAttribute('cx', x(tempos[i])); pontos[k].setAttribute('cy', y(valores[k][i])); pontos[k].setAttribute('visibility', 'visible');
        });
        const b = blocos[i];
        const titulo = minutos === 1 ? fmtDataHora(b.ts) : `${fmtHora(b.ts)} – ${fmtHora(b.ts + minutos * 60e3)}`;
        const linhas = series.map((se, k) => ({ valor: formatar(valores[k][i]), nome: se.nome, cor: se.cor }));
        preencherDica(titulo, linhas.concat(cfg.extra ? cfg.extra(b) : []), minutos > 1 ? (cfg.notaAgrupado ? cfg.notaAgrupado(minutos) : `Maior valor em cada ${minutos} min.`) : null);
      },
      esconder: () => { mira.setAttribute('visibility', 'hidden'); pontos.forEach((p) => p.setAttribute('visibility', 'hidden')); },
    });
  }

  // ---------- barras deitadas (versões, downloads por versão) ----------
  function desenharDeitadas(area, cfg) {
    const { itens, formatar = num } = cfg;
    area.textContent = '';
    if (!itens.length) { area.append(el('div', { classe: 'vazio', texto: cfg.vazio || 'Ainda sem dados.' })); return; }
    const W = larguraDe(area);
    const linhaH = 30; const espessura = 14;
    const H = itens.length * linhaH + 6;
    const larguraRotulo = Math.min(W * 0.42, Math.max(...itens.map((it) => larguraTexto(it.rotulo))) + 12);
    const larguraValor = Math.max(...itens.map((it) => larguraTexto(formatar(it.valor)))) + 10;
    const pw = Math.max(20, W - larguraRotulo - larguraValor - 4);
    const max = Math.max(1, ...itens.map((it) => it.valor || 0));
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: 0, 'aria-label': cfg.descricao || '' });
    svg.append(s('line', { x1: larguraRotulo + 0.5, x2: larguraRotulo + 0.5, y1: 2, y2: H - 2, class: 'linha-base' }));
    const grupos = [];
    itens.forEach((it, i) => {
      const yc = 3 + i * linhaH + linhaH / 2;
      svg.append(s('text', { x: larguraRotulo - 8, y: yc + 4, 'text-anchor': 'end', class: 'rotulo-dado' }, it.rotulo));
      const w = Math.max(it.valor > 0 ? 2 : 0, ((it.valor || 0) / max) * pw);
      const g = s('g', { class: 'marca-dado' });
      if (w > 0) g.append(s('path', { d: barraHorizontal(larguraRotulo + 1, yc - espessura / 2, w, espessura, 4), class: 'f' + (it.cor || cfg.cor || 1) }));
      svg.append(g); grupos.push(g);
      svg.append(s('text', { x: larguraRotulo + 1 + w + 6, y: yc + 4, class: 'rotulo-dado' }, formatar(it.valor)));
    });
    svg.append(s('rect', { x: 0, y: 0, width: W, height: H, class: 'alvo' }));
    area.append(svg);
    interativo(svg, area, itens.length, {
      inicial: 0,
      indice: (e) => { const r = svg.getBoundingClientRect(); const py = (e.clientY - r.top) * (H / r.height); const i = Math.floor((py - 3) / linhaH); return i >= 0 && i < itens.length ? i : null; },
      posicao: (i) => { const r = svg.getBoundingClientRect(); const k = r.width / W; return { x: r.left + (larguraRotulo + 40) * k, y: r.top + (3 + i * linhaH + linhaH) * k }; },
      mostrar: (i) => {
        grupos.forEach((g, k) => g.classList.toggle('ativa', k === i));
        preencherDica(itens[i].rotulo, [{ valor: formatar(itens[i].valor), nome: cfg.nomeValor || '' }].concat(itens[i].extra || []), itens[i].nota || null);
      },
      esconder: () => grupos.forEach((g) => g.classList.remove('ativa')),
    });
  }

  // ---------- cartões ----------
  function tabela(colunas, linhas) {
    const t = el('table');
    t.append(el('thead', null, el('tr', null, colunas.map((c) => el('th', { classe: c.num ? 'num' : null, scope: 'col', texto: c.nome })))));
    const corpo = el('tbody');
    for (const l of linhas) corpo.append(el('tr', null, l.map((v, i) => el('td', { classe: colunas[i].num ? 'num' : null }, v instanceof Node ? v : String(v)))));
    t.append(corpo);
    return t;
  }
  function legenda(itens, tipo) {
    return el('ul', { classe: 'legenda', 'aria-label': 'Legenda' },
      itens.map((it) => el('li', null, el('i', { classe: (tipo === 'linha' ? 'chave-linha' : 'chave-barra') + ' b' + it.cor }), it.nome)));
  }
  // Monta um cartão com título, legenda, gráfico e a tabela equivalente (botão "Ver tabela").
  function cartaoGrafico(id, cfg) {
    const raiz = $(id);
    raiz.textContent = '';
    const aberta = () => tabelasAbertas.has(id);
    const botao = el('button', { classe: 'alternar-tabela', type: 'button' });
    raiz.append(el('div', { classe: 'cartao-topo' },
      el('div', null, el('h3', { texto: cfg.titulo }), cfg.sub ? el('p', { classe: 'cartao-sub', texto: cfg.sub }) : null),
      cfg.tabela ? botao : null));
    if (cfg.legenda && cfg.legenda.length > 1) raiz.append(legenda(cfg.legenda, cfg.tipoLegenda));
    const area = el('div', { classe: 'grafico' });
    const areaTabela = el('div', { classe: 'tabela-rolagem tabela-grafico' });
    raiz.append(area, areaTabela);
    if (cfg.nota) raiz.append(el('p', { classe: 'nota', texto: cfg.nota }));
    const desenhar = () => { if (!aberta()) cfg.desenhar(area); };
    function aplicar() {
      area.hidden = aberta(); areaTabela.hidden = !aberta();
      botao.textContent = aberta() ? 'Ver gráfico' : 'Ver tabela';
      botao.setAttribute('aria-expanded', String(aberta()));
    }
    botao.addEventListener('click', () => { if (aberta()) tabelasAbertas.delete(id); else tabelasAbertas.add(id); aplicar(); desenhar(); });
    if (cfg.tabela) areaTabela.append(cfg.tabela());
    aplicar();
    graficos.set(id, { desenhar });
    desenhar();
  }

  function kpi({ rotulo, valor, detalhe, destaque, pequeno, status, medidor, titulo }) {
    const v = status
      ? el('p', { classe: 'kpi-valor pequeno' }, el('span', { classe: 'status status-' + status.nivel, texto: status.texto }))
      : el('p', { classe: 'kpi-valor' + (pequeno ? ' pequeno' : ''), texto: valor });
    const caixa = el('div', { classe: 'kpi' + (destaque ? ' kpi-destaque' : ''), title: titulo || null },
      el('p', { classe: 'kpi-rotulo', texto: rotulo }), v, detalhe ? el('p', { classe: 'kpi-detalhe', texto: detalhe }) : null);
    if (medidor) {
      const barra = el('span');
      barra.style.width = Math.max(0, Math.min(100, medidor.pct)) + '%';
      caixa.append(el('div', { classe: 'medidor' + (medidor.nivel ? ' ' + medidor.nivel : ''), role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(medidor.pct), 'aria-label': rotulo }, barra));
    }
    return caixa;
  }
  function kpis(id, lista) { const raiz = $(id); raiz.textContent = ''; lista.filter(Boolean).forEach((k) => raiz.append(kpi(k))); }

  // ---------- seções ----------
  function desenharAgora(d) {
    const lk = d.agora.livekit;
    kpis('kpis-agora', [
      { rotulo: 'Online agora', valor: num(d.agora.online), destaque: true, detalhe: pl(d.pessoas.ativasHoje, 'pessoa usou hoje', 'pessoas usaram hoje') },
      { rotulo: 'Em chamada', valor: vazio(d.agora.emChamada) ? '–' : num(d.agora.emChamada), detalhe: vazio(d.agora.salasAtivas) ? 'sem medição recente' : pl(d.agora.salasAtivas, 'canal de voz com gente', 'canais de voz com gente') },
      { rotulo: 'Transmitindo a tela', valor: vazio(d.agora.transmitindo) ? '–' : num(d.agora.transmitindo) },
      { rotulo: 'Servidor de voz', status: !lk ? { nivel: 'alerta', texto: 'Sem medição' } : lk.ok ? { nivel: 'bom', texto: 'Funcionando' } : { nivel: 'critico', texto: 'Sem resposta' }, detalhe: lk && lk.ok && !vazio(lk.latenciaMs) ? `responde em ${num(lk.latenciaMs)} ms` : (lk ? `medido ${haQuanto(lk.em)}` : 'aguardando a primeira medição') },
    ]);
    const a = d.ultimas24h;
    cartaoGrafico('g-24h', {
      titulo: 'Últimas 24 horas', sub: 'Pessoas com o app aberto, em chamada e transmitindo (medido a cada minuto).',
      legenda: [{ nome: 'Online', cor: 1 }, { nome: 'Em chamada', cor: 2 }, { nome: 'Transmitindo', cor: 3 }], tipoLegenda: 'linha',
      nota: 'Buracos na linha = minutos sem medição (servidor desligado ou reiniciando).',
      desenhar: (area) => desenharLinhas(area, {
        amostras: a, inicio: d.geradoEm - 24 * 3600e3, fim: d.geradoEm,
        series: [{ nome: 'online', cor: 1, campo: 'online' }, { nome: 'em chamada', cor: 2, campo: 'voz' }, { nome: 'transmitindo', cor: 3, campo: 'telas' }],
        descricao: 'Pessoas online, em chamada e transmitindo nas últimas 24 horas',
      }),
      tabela: () => tabela([{ nome: 'Meia hora a partir de' }, { nome: 'Online (máx.)', num: true }, { nome: 'Em chamada (máx.)', num: true }, { nome: 'Transmitindo (máx.)', num: true }],
        agruparAmostras(a, 30, ['online', 'voz', 'telas']).reverse().map((b) => [fmtDataHora(b.ts), num(b.max.online), num(b.max.voz), num(b.max.telas)])),
    });
  }

  function rotulosDias(serie) { return serie.map((r) => fmtDiaCurto(r.dia)); }
  const tituloDia = (serie) => (i) => `${semanaDoDia(serie[i].dia)}, ${fmtDiaCurto(serie[i].dia)}`;
  function indiceInicio(serie) {
    if (!serie.length || serie[0].coletado) return null;
    const i = serie.findIndex((r) => r.coletado);
    return i > 0 ? i : null;
  }
  const notaSemColeta = (serie) => (i) => (serie[i].coletado ? null : 'Antes do início das estatísticas.');

  function desenharPessoas(d) {
    const p = d.pessoas;
    kpis('kpis-pessoas', [
      { rotulo: 'Ativas hoje', valor: num(p.ativasHoje) },
      { rotulo: 'Ativas em 7 dias', valor: num(p.ativas7) },
      { rotulo: 'Ativas em 30 dias', valor: num(p.ativas30), detalhe: p.ativas30 ? `${pct((p.ativasHoje / p.ativas30) * 100)} delas usaram hoje` : null },
      { rotulo: `Novas em ${d.periodoDias} dias`, valor: num(p.novasNoPeriodo), detalhe: 'usaram pela primeira vez' },
      { rotulo: 'Contas cadastradas', valor: num(p.cadastradas), detalhe: 'já entraram com o Discord' },
      { rotulo: `Logins em ${d.periodoDias} dias`, valor: num(p.loginsNoPeriodo), detalhe: 'entradas com o Discord' },
    ]);
    const serie = d.serie;
    const anot = indiceInicio(serie);
    cartaoGrafico('g-ativos', {
      titulo: 'Pessoas ativas por dia', sub: 'Pessoas diferentes que usaram o Estrivisor em cada dia.',
      desenhar: (area) => desenharColunas(area, {
        categorias: serie.map((r) => r.dia), rotulos: rotulosDias(serie), series: [{ nome: 'pessoas ativas', cor: 1, valores: serie.map((r) => r.ativos) }],
        anotacao: anot, textoAnotacao: 'início das estatísticas', tituloDica: tituloDia(serie), notaDica: notaSemColeta(serie),
        extra: (i) => (serie[i].coletado ? [{ valor: num(serie[i].picoOnline), nome: 'no pico (ao mesmo tempo)' }] : []),
        descricao: 'Pessoas ativas por dia',
      }),
      tabela: () => tabela([{ nome: 'Dia' }, { nome: 'Ativas', num: true }, { nome: 'Novas', num: true }, { nome: 'Pico online', num: true }, { nome: 'Logins', num: true }],
        serie.slice().reverse().map((r) => [`${semanaDoDia(r.dia)} ${fmtDiaCurto(r.dia)}`, num(r.ativos), num(r.novos), num(r.picoOnline), num(r.logins)])),
    });
    cartaoGrafico('g-novos', {
      titulo: 'Pessoas novas por dia', sub: 'Primeiro dia em que cada pessoa usou o Estrivisor.',
      desenhar: (area) => desenharColunas(area, {
        categorias: serie.map((r) => r.dia), rotulos: rotulosDias(serie), series: [{ nome: 'pessoas novas', cor: 1, valores: serie.map((r) => r.novos) }],
        tituloDica: tituloDia(serie), extra: (i) => (serie[i].coletado ? [{ valor: num(serie[i].logins), nome: 'logins' }, { valor: num(serie[i].pedidosAcesso), nome: 'pedidos de acesso' }] : []),
        descricao: 'Pessoas novas por dia',
      }),
      tabela: () => tabela([{ nome: 'Dia' }, { nome: 'Novas', num: true }, { nome: 'Logins', num: true }, { nome: 'Pedidos de acesso', num: true }],
        serie.slice().reverse().map((r) => [`${semanaDoDia(r.dia)} ${fmtDiaCurto(r.dia)}`, num(r.novos), num(r.logins), num(r.pedidosAcesso)])),
      nota: 'Quem já usava antes das estatísticas aparece no dia em que foi liberado (quando dá para saber).',
    });
  }

  function desenharMensagens(d) {
    const m = d.mensagens;
    kpis('kpis-mensagens', [
      { rotulo: 'Hoje', valor: num(m.hoje) },
      { rotulo: `Em ${d.periodoDias} dias`, valor: num(m.noPeriodo), detalhe: `${num(m.canaisNoPeriodo)} em canais · ${num(m.dmNoPeriodo)} diretas` },
      { rotulo: 'Desde o começo', valor: num(m.desdeSempre), detalhe: 'nas conversas que ainda existem' },
      { rotulo: 'Conversas diretas', valor: num(m.conversasDm), detalhe: 'pares de amigos que já conversaram' },
      { rotulo: 'Canais de texto usados', valor: num(m.canaisComMensagens) },
    ]);
    const serie = d.serie;
    const temEstimado = serie.some((r) => r.msgEstimado && (r.msgCanal || r.msgDm));
    cartaoGrafico('g-mensagens', {
      titulo: 'Mensagens por dia', sub: 'Mensagens enviadas em canais de servidores e em conversas diretas.',
      legenda: [{ nome: 'Em canais', cor: 1 }, { nome: 'Diretas', cor: 2 }],
      nota: temEstimado ? 'Barras mais fracas: dias antes do início das estatísticas, contados pelas mensagens guardadas (as que foram apagadas não entram).' : null,
      desenhar: (area) => desenharColunas(area, {
        categorias: serie.map((r) => r.dia), rotulos: rotulosDias(serie),
        series: [{ nome: 'em canais', cor: 1, valores: serie.map((r) => r.msgCanal) }, { nome: 'diretas', cor: 2, valores: serie.map((r) => r.msgDm) }],
        estimado: serie.map((r) => r.msgEstimado), anotacao: temEstimado ? indiceInicio(serie) : null, textoAnotacao: 'início das estatísticas',
        tituloDica: tituloDia(serie), notaDica: (i) => (serie[i].msgEstimado ? 'Estimado pelas mensagens guardadas.' : null),
        extra: (i) => (serie[i].coletado ? [{ valor: num(serie[i].msgEditadas), nome: 'editadas' }, { valor: num(serie[i].msgApagadas), nome: 'apagadas' }] : []),
        descricao: 'Mensagens por dia, em canais e diretas',
      }),
      tabela: () => tabela([{ nome: 'Dia' }, { nome: 'Em canais', num: true }, { nome: 'Diretas', num: true }, { nome: 'Total', num: true }, { nome: 'Editadas', num: true }, { nome: 'Apagadas', num: true }],
        serie.slice().reverse().map((r) => [`${semanaDoDia(r.dia)} ${fmtDiaCurto(r.dia)}${r.msgEstimado ? ' (estimado)' : ''}`, num(r.msgCanal), num(r.msgDm), num((r.msgCanal || 0) + (r.msgDm || 0)), num(r.msgEditadas), num(r.msgApagadas)])),
    });
    const horasR = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);
    cartaoGrafico('g-horas', {
      titulo: 'Horário das mensagens', sub: 'Por hora do dia, nos últimos 30 dias (horário de Brasília).',
      desenhar: (area) => desenharColunas(area, {
        categorias: horasR, rotulos: horasR, larguraRotulo: 36, series: [{ nome: 'mensagens', cor: 1, valores: m.porHora }],
        tituloDica: (i) => `das ${horasR[i]} às ${String((i + 1) % 24).padStart(2, '0')}h`, descricao: 'Mensagens por hora do dia',
      }),
      tabela: () => tabela([{ nome: 'Hora' }, { nome: 'Mensagens', num: true }], horasR.map((h, i) => [h, num(m.porHora[i])])),
    });
    cartaoGrafico('g-semana', {
      titulo: 'Dias da semana', sub: 'Mensagens por dia da semana, nos últimos 30 dias.',
      desenhar: (area) => desenharColunas(area, {
        categorias: SEMANA, rotulos: SEMANA, series: [{ nome: 'mensagens', cor: 1, valores: m.porSemana }],
        tituloDica: (i) => SEMANA_LONGA[i], descricao: 'Mensagens por dia da semana',
      }),
      tabela: () => tabela([{ nome: 'Dia' }, { nome: 'Mensagens', num: true }], SEMANA_LONGA.map((dd, i) => [dd, num(m.porSemana[i])])),
    });
  }

  function desenharChamadas(d) {
    const c = d.chamadas;
    kpis('kpis-chamadas', [
      { rotulo: `Tempo em chamada (${d.periodoDias} dias)`, valor: horas(c.minutosNoPeriodo), detalhe: 'somando todas as pessoas' },
      { rotulo: 'Tempo transmitindo a tela', valor: horas(c.minutosTelaNoPeriodo) },
      { rotulo: 'Entradas em canais de voz', valor: num(c.entradasNoPeriodo) },
      { rotulo: 'Pico de gente em chamada', valor: num(c.picoNoPeriodo), detalhe: 'ao mesmo tempo, no período' },
      { rotulo: 'Barrados em canal cheio', valor: num(c.salasCheiasNoPeriodo), detalhe: `limite: ${num(d.config.maxPorSala)} por canal` },
    ]);
    const serie = d.serie;
    cartaoGrafico('g-voz', {
      titulo: 'Tempo em chamada por dia', sub: 'Horas somadas de todas as pessoas em canais de voz.',
      desenhar: (area) => desenharColunas(area, {
        categorias: serie.map((r) => r.dia), rotulos: rotulosDias(serie), inteiro: false, formatar: (h) => horas(h * 60),
        series: [{ nome: 'em chamada', cor: 1, valores: serie.map((r) => (vazio(r.minutosVoz) ? null : r.minutosVoz / 60)) }],
        tituloDica: tituloDia(serie), notaDica: notaSemColeta(serie),
        extra: (i) => (serie[i].coletado ? [{ valor: horas(serie[i].minutosTela), nome: 'transmitindo a tela' }, { valor: num(serie[i].entradasVoz), nome: 'entradas em canais' }] : []),
        descricao: 'Tempo em chamada por dia',
      }),
      tabela: () => tabela([{ nome: 'Dia' }, { nome: 'Em chamada', num: true }, { nome: 'Transmitindo', num: true }, { nome: 'Entradas', num: true }, { nome: 'Canal cheio', num: true }],
        serie.slice().reverse().map((r) => [`${semanaDoDia(r.dia)} ${fmtDiaCurto(r.dia)}`, horas(r.minutosVoz), horas(r.minutosTela), num(r.entradasVoz), num(r.salasCheias)])),
    });
    cartaoGrafico('g-pico-voz', {
      titulo: 'Pico de pessoas em chamada', sub: 'Maior número de pessoas em canais de voz ao mesmo tempo, por dia.',
      desenhar: (area) => desenharColunas(area, {
        categorias: serie.map((r) => r.dia), rotulos: rotulosDias(serie),
        series: [{ nome: 'pessoas ao mesmo tempo', cor: 1, valores: serie.map((r) => r.picoVoz) }],
        tituloDica: tituloDia(serie), notaDica: notaSemColeta(serie),
        extra: (i) => (serie[i].coletado ? [{ valor: num(serie[i].picoTela), nome: 'transmitindo no pico' }] : []),
        descricao: 'Pico de pessoas em chamada por dia',
      }),
      tabela: () => tabela([{ nome: 'Dia' }, { nome: 'Pico em chamada', num: true }, { nome: 'Pico transmitindo', num: true }],
        serie.slice().reverse().map((r) => [`${semanaDoDia(r.dia)} ${fmtDiaCurto(r.dia)}`, num(r.picoVoz), num(r.picoTela)])),
    });
  }

  function desenharDownloads(d) {
    const dl = d.downloads;
    $('downloads-sub').textContent = dl.atualizadoEm
      ? `Números das versões no GitHub, consultados ${haQuanto(dl.atualizadoEm)}.`
      : 'Números das versões no GitHub.';
    const versoes = dl.versoes || [];
    const nova = versoes.find((v) => !v.preRelease) || versoes[0];
    const t = dl.total || {};
    kpis('kpis-downloads', [
      dl.erro && !dl.total ? { rotulo: 'GitHub', status: { nivel: 'alerta', texto: 'Sem resposta' }, detalhe: dl.erro } : null,
      !dl.erro && !dl.total ? { rotulo: 'GitHub', status: { nivel: 'alerta', texto: 'Consultando…' }, detalhe: 'os números aparecem na próxima atualização (em até 1 minuto)' } : null,
      { rotulo: 'Downloads do instalador', valor: num(t.instalador), detalhe: 'desde a primeira versão (inclui atualizações)' },
      nova ? { rotulo: 'Versão mais nova', valor: nova.versao, pequeno: true, detalhe: `${pl(nova.instalador, 'download', 'downloads')}${nova.publicadaEm ? ' · publicada em ' + fmtData(nova.publicadaEm) : ''}` } : null,
      { rotulo: `Downloads em ${d.periodoDias} dias`, valor: vazio(dl.noPeriodo) ? '–' : num(dl.noPeriodo), detalhe: vazio(dl.noPeriodo) ? 'começa a contar a partir de amanhã' : 'desde que o painel começou a anotar' },
      { rotulo: 'Verificações de atualização', valor: num(t.verificacoes), detalhe: 'vezes que o app conferiu se tinha versão nova' },
    ]);
    const lista = versoes.slice(0, 10);
    cartaoGrafico('g-downloads-versao', {
      titulo: 'Downloads do instalador por versão', sub: 'Cada versão conta o site e as atualizações automáticas para ela.',
      desenhar: (area) => desenharDeitadas(area, {
        itens: lista.map((v) => ({ rotulo: v.versao, valor: v.instalador, extra: [{ valor: num(v.blockmap), nome: 'atualizações parciais' }, { valor: num(v.verificacoes), nome: 'verificações' }], nota: v.publicadaEm ? 'Publicada em ' + fmtData(v.publicadaEm) : null })),
        nomeValor: 'downloads do instalador',
        vazio: dl.erro ? 'Não consegui consultar o GitHub: ' + dl.erro : (dl.total ? 'Nenhuma versão publicada.' : 'Consultando o GitHub… os números aparecem em até 1 minuto.'),
        descricao: 'Downloads do instalador por versão',
      }),
      tabela: () => tabela([{ nome: 'Versão' }, { nome: 'Publicada' }, { nome: 'Instalador', num: true }, { nome: 'Parciais', num: true }, { nome: 'Verificações', num: true }],
        versoes.map((v) => [v.versao, v.publicadaEm ? fmtData(v.publicadaEm) : '–', num(v.instalador), num(v.blockmap), num(v.verificacoes)])),
    });
    const serie = d.serie;
    cartaoGrafico('g-downloads-dia', {
      titulo: 'Downloads por dia', sub: 'Diferença do total do GitHub de um dia para o outro.',
      desenhar: (area) => desenharColunas(area, {
        categorias: serie.map((r) => r.dia), rotulos: rotulosDias(serie), series: [{ nome: 'downloads', cor: 1, valores: serie.map((r) => r.downloads) }],
        tituloDica: tituloDia(serie), vazio: 'Os downloads por dia aparecem depois do primeiro dia inteiro de anotações.', descricao: 'Downloads por dia',
      }),
      tabela: () => tabela([{ nome: 'Dia' }, { nome: 'Downloads', num: true }], serie.slice().reverse().map((r) => [`${semanaDoDia(r.dia)} ${fmtDiaCurto(r.dia)}`, num(r.downloads)])),
    });
  }

  function desenharVersoes(d) {
    const minima = d.config.versaoMinima;
    $('versoes-sub').textContent = 'Última versão usada por cada pessoa nos últimos 30 dias' + (minima ? ` (mínima exigida: ${minima}).` : '.');
    const itens = d.versoes.map((v) => {
      const abaixo = minima && compararVersoes(v.versao, minima) < 0;
      return { rotulo: v.versao + (abaixo ? ' (antiga)' : ''), valor: v.pessoas, cor: abaixo ? 2 : 1, nota: abaixo ? 'Abaixo da versão mínima: o servidor pede para atualizar.' : null };
    });
    cartaoGrafico('g-versoes', {
      titulo: 'Pessoas por versão do app', sub: 'Conta cada pessoa uma vez (a versão mais recente que ela usou).',
      legenda: itens.some((i) => i.cor === 2) ? [{ nome: 'Em dia', cor: 1 }, { nome: 'Abaixo da mínima', cor: 2 }] : null,
      desenhar: (area) => desenharDeitadas(area, { itens, nomeValor: 'pessoas', vazio: 'Ainda não deu tempo de ver ninguém usando o app.', descricao: 'Pessoas por versão do app' }),
      tabela: () => tabela([{ nome: 'Versão' }, { nome: 'Pessoas', num: true }], d.versoes.map((v) => [v.versao, num(v.pessoas)])),
    });
    const ap = d.aparelhos;
    const raiz = $('c-aparelhos');
    raiz.textContent = '';
    raiz.append(el('div', { classe: 'cartao-topo' }, el('div', null, el('h3', { texto: 'Aparelhos com login' }), el('p', { classe: 'cartao-sub', texto: 'Cada PC onde alguém entrou com o Discord (o login vale 6 meses).' }))));
    const dl = el('dl', { classe: 'lista-chave-valor' });
    [['PCs com login salvo', ap.validas], ['Pessoas com login salvo', ap.pessoas], ['PCs usados nos últimos 7 dias', ap.usadas7d], ['PCs usados nos últimos 30 dias', ap.usadas30d], ['Logins novos nos últimos 30 dias', ap.criadas30d]]
      .forEach(([k, v]) => dl.append(el('dt', { texto: k }), el('dd', { texto: num(v) })));
    raiz.append(dl, el('p', { classe: 'nota', texto: 'O "último uso" de cada PC é anotado no máximo uma vez por hora.' }));
  }

  function desenharServidores(d) {
    const sv = d.servidores;
    kpis('kpis-servidores', [
      { rotulo: 'Servidores', valor: num(sv.total) },
      { rotulo: 'Membros (somando)', valor: num(sv.membros) },
      { rotulo: 'Canais de texto', valor: num(sv.canaisTexto) },
      { rotulo: 'Canais de voz', valor: num(sv.canaisVoz) },
      { rotulo: `Criados em ${d.periodoDias} dias`, valor: num(sv.criadosNoPeriodo) },
    ]);
    const raiz = $('t-servidores');
    raiz.textContent = '';
    raiz.append(el('div', { classe: 'cartao-topo' }, el('div', null, el('h3', { texto: 'Todos os servidores' }), el('p', { classe: 'cartao-sub', texto: `Mensagens contadas pelas guardadas (até 1.000 por canal). Período: ${d.periodoDias} dias.` }))));
    if (!sv.lista.length) { raiz.append(el('div', { classe: 'vazio', texto: 'Nenhum servidor criado ainda.' })); return; }
    raiz.append(el('div', { classe: 'tabela-rolagem' }, tabela(
      [{ nome: 'Servidor' }, { nome: 'Dono' }, { nome: 'Membros', num: true }, { nome: 'Online agora', num: true }, { nome: `Mensagens (${d.periodoDias} dias)`, num: true }, { nome: 'Última mensagem' }, { nome: 'Canais (texto + voz)', num: true }, { nome: 'Convites ativos', num: true }, { nome: 'Criado em' }],
      sv.lista.map((x) => [x.nome, x.dono, num(x.membros), num(x.onlineAgora), num(x.mensagensPeriodo), x.ultimaMensagem ? haQuanto(x.ultimaMensagem) : '–', `${num(x.canaisTexto)} + ${num(x.canaisVoz)}`, num(x.convitesAtivos), x.criadoEm ? fmtData(x.criadoEm) : '–']),
    )));
  }

  function desenharSaude(d) {
    const h = d.saude;
    const hoje = d.serie[d.serie.length - 1] || {};
    const lk = d.agora.livekit;
    const erros = hoje.erros || 0;
    const disco = h.disco;
    const usoDisco = disco ? (1 - disco.livreGB / disco.totalGB) * 100 : null;
    const mem = h.memoriaNotebook;
    const usoMem = mem ? (1 - mem.livreGB / mem.totalGB) * 100 : null;
    const temp = h.temperaturaC;
    const carga = h.carga && h.nucleos ? (h.carga[0] / h.nucleos) * 100 : null;
    const b = h.backup || {};
    let backup;
    if (!b.configurado) backup = { rotulo: 'Último backup', status: { nivel: 'alerta', texto: 'Não configurado' }, detalhe: 'falta montar a pasta de backups (veja as instruções)' };
    else if (b.erro) backup = { rotulo: 'Último backup', status: { nivel: 'alerta', texto: 'Sem informação' }, detalhe: b.erro };
    else if (!b.ultimo) backup = { rotulo: 'Último backup', status: { nivel: 'critico', texto: 'Nenhum backup' }, detalhe: 'a pasta de backups está vazia' };
    else {
      const idadeDias = (Date.now() - b.ultimo.ts) / 86400e3;
      const vps = b.status && b.status.vps;
      const vpsFalhou = Boolean(vps) && vps !== 'ok' && vps !== 'pendente';
      const nivel = idadeDias > 8 || vpsFalhou ? 'critico' : 'bom';
      backup = {
        rotulo: 'Último backup', status: { nivel, texto: fmtDiaHora(b.ultimo.ts) },
        detalhe: pl(b.quantidade, 'cópia no notebook', 'cópias no notebook') + (vps ? ` · cópia na VPS: ${vps === 'ok' ? 'ok' : vps === 'pendente' ? 'em andamento' : 'FALHOU'}` : '') + (idadeDias > 8 ? ' · atrasado' : ''),
      };
    }
    kpis('kpis-saude', [
      { rotulo: 'Servidor no ar há', valor: duracao((Date.now() - h.inicioProcesso) / 1000), pequeno: true, detalhe: 'desde o último reinício' },
      { rotulo: 'Erros hoje', status: erros === 0 ? { nivel: 'bom', texto: 'Nenhum' } : { nivel: erros < 20 ? 'alerta' : 'critico', texto: num(erros) }, detalhe: 'respostas com erro interno (5xx)' },
      { rotulo: 'Servidor de voz', status: !lk ? { nivel: 'alerta', texto: 'Sem medição' } : lk.ok ? { nivel: 'bom', texto: 'Funcionando' } : { nivel: 'critico', texto: 'Sem resposta' }, detalhe: hoje.falhasLivekit ? pl(hoje.falhasLivekit, 'minuto sem resposta hoje', 'minutos sem resposta hoje') : 'nenhuma falha hoje' },
      backup,
      disco ? { rotulo: 'Disco livre', valor: `${nf1.format(disco.livreGB)} GB`, pequeno: true, detalhe: `de ${nf1.format(disco.totalGB)} GB`, medidor: { pct: usoDisco, nivel: usoDisco > 95 ? 'critico' : usoDisco > 85 ? 'alerta' : null } } : null,
      mem ? { rotulo: 'Memória do notebook', valor: pct(usoMem), pequeno: true, detalhe: `${nf1.format(mem.totalGB - mem.livreGB)} de ${nf1.format(mem.totalGB)} GB em uso · o servidor usa ${num(h.memoriaProcessoMB)} MB`, medidor: { pct: usoMem, nivel: usoMem > 95 ? 'critico' : usoMem > 85 ? 'alerta' : null } } : null,
      carga !== null ? { rotulo: 'Processador', valor: pct(carga), pequeno: true, detalhe: `média do último minuto (${num(h.nucleos)} núcleos)`, medidor: { pct: carga, nivel: carga > 90 ? 'critico' : carga > 70 ? 'alerta' : null } } : null,
      temp !== null ? { rotulo: 'Temperatura', status: { nivel: temp >= 85 ? 'critico' : temp >= 70 ? 'alerta' : 'bom', texto: `${nf1.format(temp)} °C` }, detalhe: 'sensor mais quente do notebook' } : null,
    ]);
    const a = d.ultimas24h;
    cartaoGrafico('g-pedidos', {
      titulo: 'Pedidos ao servidor por minuto', sub: 'Últimas 24 horas. Mostra o movimento e quando o servidor ficou fora.',
      desenhar: (area) => desenharLinhas(area, {
        amostras: a, inicio: d.geradoEm - 24 * 3600e3, fim: d.geradoEm, preencher: true,
        series: [{ nome: 'pedidos por minuto', cor: 1, campo: 'requisicoes', modo: 'media' }], camposExtras: ['erros'],
        extra: (b) => [{ valor: num(b.soma.erros || 0), nome: 'com erro' }, { valor: b.livekitOk ? (b.latN ? `${num(Math.round(b.latSoma / b.latN))} ms` : 'ok') : 'falhou', nome: 'servidor de voz' }],
        notaAgrupado: (m) => `Média por minuto em cada ${m} min.`,
        descricao: 'Pedidos ao servidor por minuto nas últimas 24 horas',
      }),
      tabela: () => tabela([{ nome: 'Meia hora a partir de' }, { nome: 'Pedidos por minuto (média)', num: true }, { nome: 'Erros', num: true }, { nome: 'Servidor de voz' }],
        agruparAmostras(a, 30, ['requisicoes', 'erros']).reverse().map((b) => [fmtDataHora(b.ts), num(Math.round(b.soma.requisicoes / b.n)), num(b.soma.erros), b.livekitOk ? 'ok' : 'falhou'])),
    });
    const raiz = $('c-arquivos');
    raiz.textContent = '';
    raiz.append(el('div', { classe: 'cartao-topo' }, el('div', null, el('h3', { texto: 'Arquivos de dados' }), el('p', { classe: 'cartao-sub', texto: 'Tamanho de cada arquivo na pasta dados do notebook.' }))));
    raiz.append(el('div', { classe: 'tabela-rolagem' }, tabela([{ nome: 'Arquivo' }, { nome: 'Tamanho', num: true }],
      h.arquivos.map((f) => [f.nome, vazio(f.kb) ? '–' : (f.kb >= 1024 ? `${nf1.format(f.kb / 1024)} MB` : `${num(f.kb)} KB`)]))));
    const dl = el('dl', { classe: 'lista-chave-valor' });
    [['Estatísticas desde', fmtData(d.inicioColeta)], ['Node.js', h.node], ['Acesso', d.config.acessoRestrito ? 'restrito (só quem você libera)' : 'livre'], ['Aceite dos termos', d.config.exigirAceite ? `exigido (versão ${d.config.versaoTermos})` : 'não exigido'], ['Versão mínima do app', d.config.versaoMinima || 'nenhuma']]
      .forEach(([k, v]) => dl.append(el('dt', { texto: k }), el('dd', { texto: v })));
    raiz.append(dl);
  }

  function desenharModeracao(d) {
    const p = d.pessoas; const mo = d.moderacao; const q = d.qualidade; const am = d.amizades;
    kpis('kpis-moderacao', [
      d.config.acessoRestrito ? { rotulo: 'Pedidos de acesso', status: p.pedidosPendentes ? { nivel: 'alerta', texto: `${num(p.pedidosPendentes)} esperando` } : { nivel: 'bom', texto: 'Nenhum' }, detalhe: pl(p.liberadas, 'pessoa liberada', 'pessoas liberadas') } : { rotulo: 'Acesso', valor: 'Livre', pequeno: true, detalhe: 'qualquer pessoa com o app entra' },
      { rotulo: 'Denúncias abertas', status: mo.denunciasAbertas ? { nivel: 'alerta', texto: num(mo.denunciasAbertas) } : { nivel: 'bom', texto: 'Nenhuma' }, detalhe: `${pl(mo.denunciasNoPeriodo, 'recebida', 'recebidas')} em ${d.periodoDias} dias` },
      { rotulo: 'Punições em vigor', valor: num(p.punidas), detalhe: 'suspensões e banimentos' },
      { rotulo: `Ações suas em ${d.periodoDias} dias`, valor: num(mo.acoesAdminNoPeriodo), detalhe: 'liberar, punir, apagar...' },
      { rotulo: 'Tentativas no painel', status: mo.tentativasNoPainel ? { nivel: 'alerta', texto: num(mo.tentativasNoPainel) } : { nivel: 'bom', texto: 'Nenhuma' }, detalhe: `contas não-admin em ${d.periodoDias} dias (veja o Histórico no app)` },
      { rotulo: 'Aceitaram os termos atuais', valor: `${num(p.aceitaramTermos)} de ${num(p.cadastradas)}` },
      { rotulo: 'Amizades', valor: num(am.total), detalhe: `${pl(am.pedidosPendentes, 'pedido esperando', 'pedidos esperando')} · ${pl(am.novasNoPeriodo, 'nova no período', 'novas no período')}` },
      { rotulo: 'Chaves de qualidade', valor: `${num(q.chavesUsadas)} de ${num(q.chavesGeradas)}`, detalhe: `usadas · ${pl(q.contasComNivel, 'conta com nível ativo', 'contas com nível ativo')}` },
    ]);
  }

  function desenharTudo() {
    const d = estado.dados;
    if (!d) return;
    const aviso = $('aviso-coleta');
    const inicioNoPeriodo = d.inicioColeta > d.geradoEm - d.periodoDias * 86400e3;
    aviso.hidden = !inicioNoPeriodo;
    if (inicioNoPeriodo) aviso.textContent = `As estatísticas começaram em ${fmtDataHora(d.inicioColeta)}. Antes disso, só as mensagens têm números (contados pelas mensagens guardadas).`;
    fecharDica();
    // Cada seção desenha sozinha: se uma der problema, as outras aparecem normalmente.
    const falhas = [];
    for (const [nome, fn] of [['Agora', desenharAgora], ['Pessoas', desenharPessoas], ['Mensagens', desenharMensagens], ['Chamadas', desenharChamadas],
      ['Downloads', desenharDownloads], ['Versões', desenharVersoes], ['Servidores', desenharServidores], ['Saúde', desenharSaude], ['Moderação', desenharModeracao]]) {
      try { fn(d); } catch (e) { falhas.push(nome); console.error('[painel] erro ao desenhar ' + nome + ':', e); }
    }
    const caixaErro = $('erro-carga');
    caixaErro.hidden = !falhas.length;
    if (falhas.length) caixaErro.textContent = 'Algumas partes não puderam ser mostradas: ' + falhas.join(', ') + '. Os outros números estão certos.';
    $('atualizado').textContent = 'Atualizado às ' + fmtHora(d.geradoEm);
    $('rodape').textContent = `Estatísticas desde ${fmtData(d.inicioColeta)} · horários de Brasília · o painel só mostra números, nunca o conteúdo das conversas.`;
  }

  // ---------- dados ----------
  async function api(caminho, opcoes) {
    const r = await fetch(caminho, Object.assign({ credentials: 'same-origin', headers: { Accept: 'application/json' } }, opcoes || {}));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { const e = new Error(j.erro || 'login'); e.login = true; e.configurado = j.login !== false; throw e; }
    if (!r.ok) throw new Error(j.erro || `Erro ${r.status}`);
    return j;
  }
  async function carregar() {
    const meu = ++estado.pedido; // se trocar o período no meio, só a resposta mais nova é desenhada
    const main = $('conteudo');
    main.classList.add('carregando');
    try {
      const dados = await api(`/painel/api/resumo?dias=${estado.dias}`);
      if (meu !== estado.pedido) return;
      estado.dados = dados;
      estado.ultimaCarga = Date.now();
      $('erro-carga').hidden = true;
      desenharTudo();
    } catch (e) {
      if (meu !== estado.pedido) return;
      if (e.login) { pararAtualizacao(); mostrarEntrar(e.configurado); return; }
      const caixa = $('erro-carga');
      caixa.hidden = false;
      const motivo = e instanceof TypeError ? 'sem conexão com o servidor' : e.message;
      caixa.textContent = 'Não consegui atualizar os números: ' + motivo + (estado.dados ? ' (mostrando os últimos que carregaram).' : '.');
    } finally {
      if (meu === estado.pedido) main.classList.remove('carregando');
    }
  }
  function pararAtualizacao() { if (estado.relogio) { clearInterval(estado.relogio); estado.relogio = null; } }

  function mostrarEntrar(configurado) {
    $('app').hidden = true;
    $('tela-entrar').hidden = false;
    $('entrar-dica').textContent = configurado === false
      ? 'O login do painel ainda não foi configurado no servidor (falta PAINEL_REDIRECT_URI no server.env).'
      : 'Você vai para o Discord e volta para cá. A sessão do painel dura 12 horas.';
  }

  function baixarCsv() {
    const d = estado.dados;
    if (!d) return;
    const cols = [['dia', 'dia'], ['ativos', 'pessoas_ativas'], ['novos', 'pessoas_novas'], ['logins', 'logins'], ['pedidosAcesso', 'pedidos_acesso'],
      ['msgCanal', 'mensagens_canais'], ['msgDm', 'mensagens_diretas'], ['msgEstimado', 'mensagens_estimadas'], ['entradasVoz', 'entradas_voz'],
      ['minutosVoz', 'minutos_chamada'], ['minutosTela', 'minutos_tela'], ['picoOnline', 'pico_online'], ['picoVoz', 'pico_chamada'],
      ['salasCheias', 'barrados_canal_cheio'], ['servidoresCriados', 'servidores_criados'], ['downloads', 'downloads'], ['requisicoes', 'pedidos_servidor'], ['erros', 'erros']];
    const linhas = [cols.map((c) => c[1]).join(';')];
    for (const r of d.serie) {
      linhas.push(cols.map(([k]) => {
        const v = r[k];
        if (k === 'msgEstimado') return v ? 'sim' : 'não';
        return vazio(v) ? '' : String(v);
      }).join(';'));
    }
    const blob = new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `estrivisor-${d.hoje}-${d.periodoDias}dias.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- tema ----------
  const TEMAS = ['auto', 'claro', 'escuro'];
  const NOMES_TEMA = { auto: 'automático', claro: 'claro', escuro: 'escuro' };
  function aplicarTema(t) {
    if (t === 'auto') delete document.documentElement.dataset.tema; else document.documentElement.dataset.tema = t;
    $('btn-tema').textContent = 'Tema: ' + NOMES_TEMA[t];
  }

  // ---------- início ----------
  async function iniciar() {
    $('sem-script').hidden = true;
    const temaSalvo = TEMAS.includes(lerPref('tema')) ? lerPref('tema') : 'auto';
    aplicarTema(temaSalvo);
    const diasSalvo = Number(lerPref('dias'));
    if ([7, 30, 90].includes(diasSalvo)) estado.dias = diasSalvo;
    document.querySelectorAll('#periodo button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.dias) === estado.dias)));

    let eu;
    try { eu = await api('/painel/api/eu'); } catch (e) {
      if (e.login) { mostrarEntrar(e.configurado); return; }
      mostrarEntrar(true);
      $('entrar-dica').textContent = 'Não consegui falar com o servidor: ' + (e instanceof TypeError ? 'sem conexão' : e.message) + '. Tente de novo daqui a pouco.';
      return;
    }
    $('tela-entrar').hidden = true;
    $('app').hidden = false;
    $('eu-nome').textContent = eu.nome || '';
    $('eu-avatar').addEventListener('error', () => { $('eu-avatar').hidden = true; });
    if (typeof eu.avatar === 'string' && /^https:\/\/cdn\.discordapp\.com\//.test(eu.avatar)) $('eu-avatar').src = eu.avatar;
    else $('eu-avatar').hidden = true;

    $('btn-atualizar').addEventListener('click', carregar);
    $('btn-csv').addEventListener('click', baixarCsv);
    $('btn-tema').addEventListener('click', () => {
      const atual = TEMAS.includes(lerPref('tema')) ? lerPref('tema') : (document.documentElement.dataset.tema || 'auto');
      const prox = TEMAS[(TEMAS.indexOf(atual) + 1) % TEMAS.length];
      gravarPref('tema', prox); aplicarTema(prox);
    });
    $('btn-sair').addEventListener('click', async () => {
      pararAtualizacao();
      try { await api('/painel/api/sair', { method: 'POST' }); } catch (e) { /* já estava fora */ }
      mostrarEntrar(true);
    });
    $('periodo').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-dias]');
      if (!b) return;
      estado.dias = Number(b.dataset.dias);
      gravarPref('dias', String(estado.dias));
      document.querySelectorAll('#periodo button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      carregar();
    });
    $('periodo').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const bs = [...document.querySelectorAll('#periodo button')];
      const i = bs.findIndex((x) => x.getAttribute('aria-checked') === 'true');
      const j = Math.max(0, Math.min(bs.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
      bs[j].focus(); bs[j].click();
    });
    // Redesenha os gráficos quando a LARGURA muda (no celular a barra de endereço some e volta
    // ao rolar, mudando só a altura; isso não precisa redesenhar nada).
    let espera = null; let larguraAntes = window.innerWidth;
    window.addEventListener('resize', () => {
      if (window.innerWidth === larguraAntes) return;
      larguraAntes = window.innerWidth;
      clearTimeout(espera);
      espera = setTimeout(() => { fecharDica(); graficos.forEach((g) => g.desenhar()); }, 150);
    });
    estado.relogio = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (estado.relogio && document.visibilityState === 'visible' && Date.now() - estado.ultimaCarga > 60 * 1000) carregar();
    });
    await carregar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
}());

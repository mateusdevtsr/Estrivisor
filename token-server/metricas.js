'use strict';
// ============================================================
// Estatísticas de uso (só para o painel do administrador).
//
// O que fica guardado (em /data/metricas.json):
//  - números por dia: logins, mensagens enviadas, entradas em canais de voz, minutos em
//    chamada, picos de pessoas online, total de downloads do instalador...
//  - QUEM esteve ativo em cada dia, só dos últimos 31 dias (é o que permite contar pessoas
//    diferentes em 7 e em 30 dias). Depois disso, sobra só o número.
//  - o dia em que cada pessoa apareceu pela primeira vez e a versão do app que ela usou por último.
//  - uma "foto" por minuto das últimas 24 horas (online, em chamada, transmitindo tela...).
//
// O conteúdo das mensagens nunca passa por aqui. Quem apaga a conta some daqui também.
// As alterações vão pro disco juntas (no máximo uma gravação a cada 5 minutos) e na hora
// em que o servidor desliga.
// ============================================================
const fs = require('fs');
const path = require('path');

const DIA_MS = 24 * 60 * 60 * 1000;
const FUSO_MS = -3 * 60 * 60 * 1000;   // horário de Brasília (o Brasil não tem mais horário de verão)
const DIAS_COM_LISTA = 31;             // dias em que guardamos a lista de quem esteve ativo
const MAX_DIAS = 800;                  // histórico por dia (pouco mais de 2 anos)
const MAX_AMOSTRAS = 24 * 60;          // 24 h de fotos por minuto
const ESQUECER_VERSAO_DIAS = 90;       // versão do app de quem sumiu há mais de 90 dias é esquecida
const GRAVAR_APOS_MS = 5 * 60 * 1000;

const CONTADORES = Object.freeze([
  'logins', 'pedidosAcesso', 'msgCanal', 'msgDm', 'msgEditadas', 'msgApagadas',
  'entradasVoz', 'salasCheias', 'servidoresCriados', 'convitesUsados', 'amizades', 'denuncias',
  'requisicoes', 'erros', 'minutosVoz', 'minutosTela',
]);
const PICOS = Object.freeze(['picoOnline', 'picoVoz', 'picoTela', 'picoSalas']);

const ID_OK = /^(discord|local):[A-Za-z0-9-]{1,40}$/;
const DIA_OK = /^\d{4}-\d{2}-\d{2}$/;
const VERSAO_OK = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

// Datas sempre no horário de Brasília.
const diaDe = (ts) => new Date(ts + FUSO_MS).toISOString().slice(0, 10);
const horaDe = (ts) => new Date(ts + FUSO_MS).getUTCHours();
const semanaDe = (ts) => new Date(ts + FUSO_MS).getUTCDay(); // 0 = domingo
function somarDias(dia, n) {
  return new Date(Date.parse(dia + 'T00:00:00Z') + n * DIA_MS).toISOString().slice(0, 10);
}
// Compara versões "3.10.0" > "3.9.1" (do jeito certo, número por número).
function compararVersoes(a, b) {
  const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}
const tem = (obj, chave) => Object.prototype.hasOwnProperty.call(obj, chave);
const numeroOk = (x) => typeof x === 'number' && Number.isFinite(x);

function criarMetricas({ arquivo = null, agora = () => Date.now(), log = console, gravarApos = GRAVAR_APOS_MS } = {}) {
  let dados = { versao: 1, inicio: agora(), dias: {}, conhecidos: {}, versoes: {}, amostras: [] };
  const ativos = new Map(); // dia -> Set(usuario), só os últimos DIAS_COM_LISTA dias
  let arquivoNovo = true;
  let sujo = false;
  let relogio = null;

  // ---------- leitura (descarta qualquer coisa fora do formato esperado) ----------
  function tentarLer(caminho) {
    try {
      const l = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (l && typeof l === 'object' && l.dias && typeof l.dias === 'object') return l;
    } catch (e) { /* cai no return abaixo */ }
    return null;
  }
  function carregar(l) {
    const d = { versao: 1, inicio: numeroOk(l.inicio) ? l.inicio : agora(), dias: {}, conhecidos: {}, versoes: {}, amostras: [] };
    for (const [dia, v] of Object.entries(l.dias)) {
      if (!DIA_OK.test(dia) || !v || typeof v !== 'object') continue;
      const r = { c: {} };
      if (v.c && typeof v.c === 'object') for (const nome of CONTADORES) if (numeroOk(v.c[nome])) r.c[nome] = v.c[nome];
      for (const campo of [...PICOS, 'nAtivos', 'downloads', 'falhasLivekit']) if (numeroOk(v[campo])) r[campo] = v[campo];
      d.dias[dia] = r;
      if (Array.isArray(v.ativos)) ativos.set(dia, new Set(v.ativos.filter((u) => typeof u === 'string' && ID_OK.test(u))));
    }
    if (l.conhecidos && typeof l.conhecidos === 'object') {
      for (const [u, dia] of Object.entries(l.conhecidos)) {
        if (ID_OK.test(u) && (dia === null || (typeof dia === 'string' && DIA_OK.test(dia)))) d.conhecidos[u] = dia;
      }
    }
    if (l.versoes && typeof l.versoes === 'object') {
      for (const [u, v] of Object.entries(l.versoes)) {
        if (ID_OK.test(u) && v && typeof v.v === 'string' && VERSAO_OK.test(v.v) && numeroOk(v.ts)) d.versoes[u] = { v: v.v, ts: v.ts };
      }
    }
    if (Array.isArray(l.amostras)) {
      d.amostras = l.amostras.filter((a) => Array.isArray(a) && a.length >= 9 && numeroOk(a[0])).slice(-MAX_AMOSTRAS);
    }
    return d;
  }
  if (arquivo && fs.existsSync(arquivo)) {
    const lido = tentarLer(arquivo) || (fs.existsSync(arquivo + '.bak') ? tentarLer(arquivo + '.bak') : null);
    if (lido) { dados = carregar(lido); arquivoNovo = false; }
    else log.error('[metricas] arquivo ilegível; as estatísticas recomeçam do zero.');
  }

  // ---------- gravação segura (temporário + .bak + troca de nome) ----------
  function paraTexto() {
    const dias = {};
    for (const [dia, r] of Object.entries(dados.dias)) {
      const s = ativos.get(dia);
      dias[dia] = s ? { ...r, ativos: [...s] } : r;
    }
    return JSON.stringify({ ...dados, dias });
  }
  function gravarAgora() {
    if (relogio) { clearTimeout(relogio); relogio = null; }
    if (!sujo || !arquivo) { sujo = false; return; }
    try {
      fs.mkdirSync(path.dirname(arquivo), { recursive: true });
      const tmp = arquivo + '.tmp';
      fs.writeFileSync(tmp, paraTexto());
      if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
      fs.renameSync(tmp, arquivo);
      sujo = false;
    } catch (e) { log.error('[metricas] não consegui gravar:', e.message); }
  }
  function marcarSujo() {
    sujo = true;
    if (!relogio && arquivo) { relogio = setTimeout(gravarAgora, gravarApos); if (relogio.unref) relogio.unref(); }
  }

  // ---------- limpeza do que ficou velho ----------
  function podar() {
    const hoje = diaDe(agora());
    const limiteLista = somarDias(hoje, -(DIAS_COM_LISTA - 1));
    for (const [dia, s] of ativos) {
      if (dia < limiteLista) {
        const r = dados.dias[dia] || (dados.dias[dia] = { c: {} });
        r.nAtivos = s.size; // daqui pra frente só o número
        ativos.delete(dia);
      }
    }
    const limiteDias = somarDias(hoje, -MAX_DIAS);
    for (const dia of Object.keys(dados.dias)) if (dia < limiteDias) delete dados.dias[dia];
    const limiteVersao = agora() - ESQUECER_VERSAO_DIAS * DIA_MS;
    for (const [u, v] of Object.entries(dados.versoes)) if (v.ts < limiteVersao) delete dados.versoes[u];
  }
  podar();

  // O registro do dia (cria se ainda não existe; dia novo = boa hora pra limpar o que venceu).
  function registroDo(dia) {
    let r = dados.dias[dia];
    if (!r) { r = dados.dias[dia] = { c: {} }; podar(); }
    return r;
  }

  // ---------- coleta ----------
  // A pessoa usou o servidor (qualquer pedido com login). versao = o que o app mandou em x-app-versao.
  function atividade(usuario, versao) {
    if (typeof usuario !== 'string' || !ID_OK.test(usuario)) return;
    const t = agora();
    const dia = diaDe(t);
    let s = ativos.get(dia);
    if (!s) { registroDo(dia); s = new Set(); ativos.set(dia, s); }
    if (!s.has(usuario)) { s.add(usuario); marcarSujo(); }
    if (!tem(dados.conhecidos, usuario)) { dados.conhecidos[usuario] = dia; marcarSujo(); }
    const v = typeof versao === 'string' ? versao.trim() : '';
    if (VERSAO_OK.test(v)) {
      const atual = tem(dados.versoes, usuario) ? dados.versoes[usuario] : null;
      if (!atual || atual.v !== v || t - atual.ts > 60 * 60 * 1000) { dados.versoes[usuario] = { v, ts: t }; marcarSujo(); }
    }
  }

  function contar(nome, n = 1) {
    if (!CONTADORES.includes(nome) || !numeroOk(n) || n <= 0) return;
    const r = registroDo(diaDe(agora()));
    r.c[nome] = (r.c[nome] || 0) + n;
    marcarSujo();
  }

  // Uma foto por minuto. minutos = quanto tempo esta foto representa (pra somar minutos em chamada).
  function amostra({ online = 0, voz = 0, salas = 0, telas = 0, livekitOk = true, latencia = null, requisicoes = 0, erros = 0, minutos = 1 } = {}) {
    const t = agora();
    const n = (x) => (numeroOk(x) && x >= 0 ? Math.round(x) : 0);
    const a = [t, n(online), n(voz), n(salas), n(telas), livekitOk ? 1 : 0, livekitOk && numeroOk(latencia) ? Math.round(latencia) : null, n(requisicoes), n(erros)];
    dados.amostras.push(a);
    if (dados.amostras.length > MAX_AMOSTRAS) dados.amostras.splice(0, dados.amostras.length - MAX_AMOSTRAS);
    const r = registroDo(diaDe(t));
    r.picoOnline = Math.max(r.picoOnline || 0, a[1]);
    r.picoVoz = Math.max(r.picoVoz || 0, a[2]);
    r.picoSalas = Math.max(r.picoSalas || 0, a[3]);
    r.picoTela = Math.max(r.picoTela || 0, a[4]);
    const m = numeroOk(minutos) && minutos > 0 ? minutos : 1;
    if (a[2]) r.c.minutosVoz = (r.c.minutosVoz || 0) + a[2] * m;
    if (a[4]) r.c.minutosTela = (r.c.minutosTela || 0) + a[4] * m;
    if (a[7]) r.c.requisicoes = (r.c.requisicoes || 0) + a[7];
    if (a[8]) r.c.erros = (r.c.erros || 0) + a[8];
    if (!livekitOk) r.falhasLivekit = (r.falhasLivekit || 0) + 1;
    marcarSujo();
  }

  // Total de downloads do instalador (o número que o GitHub mostra). Guardado 1x por dia
  // (o último do dia vale), pra dar pra calcular quantos downloads teve em cada dia.
  function registrarDownloads(total) {
    if (!numeroOk(total) || total < 0) return;
    const r = registroDo(diaDe(agora()));
    if (r.downloads !== total) { r.downloads = Math.round(total); marcarSujo(); }
  }

  // Só na primeira vez (arquivo novo): quem já usava o Estrivisor não conta como "pessoa nova".
  // pessoas: [{ usuario, desde }] (desde = quando foi liberada, se souber).
  function semear(pessoas) {
    if (!arquivoNovo) return false;
    arquivoNovo = false;
    for (const p of pessoas || []) {
      if (!p || typeof p.usuario !== 'string' || !ID_OK.test(p.usuario)) continue;
      const dia = numeroOk(p.desde) ? diaDe(p.desde) : null;
      if (!tem(dados.conhecidos, p.usuario)) dados.conhecidos[p.usuario] = dia;
      else if (dia && (dados.conhecidos[p.usuario] === null || dia < dados.conhecidos[p.usuario])) dados.conhecidos[p.usuario] = dia;
    }
    marcarSujo();
    return true;
  }

  // A pessoa apagou a conta: some de tudo que tem o identificador dela (os totais por dia ficam).
  function apagarDe(usuario) {
    let mudou = false;
    if (tem(dados.conhecidos, usuario)) { delete dados.conhecidos[usuario]; mudou = true; }
    if (tem(dados.versoes, usuario)) { delete dados.versoes[usuario]; mudou = true; }
    for (const s of ativos.values()) if (s.delete(usuario)) mudou = true;
    if (mudou) marcarSujo();
    return mudou;
  }

  // O que as estatísticas guardam com o identificador da pessoa (pra "Exportar meus dados").
  function dadosDe(usuario) {
    const dias = [...ativos.entries()].filter(([, s]) => s.has(usuario)).map(([dia]) => dia).sort();
    return {
      primeiroDiaDeUso: tem(dados.conhecidos, usuario) ? dados.conhecidos[usuario] : null,
      versaoDoAppUsada: tem(dados.versoes, usuario) ? dados.versoes[usuario].v : null,
      diasDeUsoNosUltimos31Dias: dias,
    };
  }

  // ---------- leitura pro painel ----------
  function pessoasDiferentes(nDias) {
    const hoje = diaDe(agora());
    const u = new Set();
    for (let i = 0; i < nDias; i++) { const s = ativos.get(somarDias(hoje, -i)); if (s) s.forEach((x) => u.add(x)); }
    return u.size;
  }

  // Um item por dia (do mais antigo pro de hoje). Dias sem dado nenhum vêm com null.
  function serie(nDias) {
    const hoje = diaDe(agora());
    const inicioDia = diaDe(dados.inicio);
    const novosPorDia = new Map();
    for (const dia of Object.values(dados.conhecidos)) if (dia) novosPorDia.set(dia, (novosPorDia.get(dia) || 0) + 1);
    const lista = [];
    for (let i = nDias - 1; i >= 0; i--) {
      const dia = somarDias(hoje, -i);
      const r = dados.dias[dia] || null;
      const s = ativos.get(dia);
      const coletado = dia >= inicioDia;
      const item = { dia, coletado, novos: novosPorDia.get(dia) || 0 };
      item.ativos = s ? s.size : (r && numeroOk(r.nAtivos) ? r.nAtivos : (coletado ? 0 : null));
      for (const nome of CONTADORES) item[nome] = coletado ? ((r && r.c[nome]) || 0) : null;
      for (const campo of PICOS) item[campo] = coletado ? ((r && r[campo]) || 0) : null;
      item.downloadsTotal = r && numeroOk(r.downloads) ? r.downloads : null;
      item.falhasLivekit = coletado ? ((r && r.falhasLivekit) || 0) : null;
      lista.push(item);
    }
    return lista;
  }

  // Versões do app de quem usou nos últimos "dias" dias: [{ versao, pessoas }], da mais nova pra mais velha.
  function versoesEmUso(dias = 30) {
    const limite = agora() - dias * DIA_MS;
    const cont = new Map();
    for (const v of Object.values(dados.versoes)) if (v.ts >= limite) cont.set(v.v, (cont.get(v.v) || 0) + 1);
    return [...cont.entries()].map(([versao, pessoas]) => ({ versao, pessoas })).sort((a, b) => compararVersoes(b.versao, a.versao));
  }

  // Fotos por minuto das últimas "horas" horas.
  function amostrasRecentes(horas = 24) {
    const limite = agora() - horas * 60 * 60 * 1000;
    return dados.amostras.filter((a) => a[0] >= limite).map((a) => ({
      ts: a[0], online: a[1], voz: a[2], salas: a[3], telas: a[4], livekitOk: a[5] === 1, latencia: a[6], requisicoes: a[7], erros: a[8],
    }));
  }

  function resumo(nDias = 30) {
    return {
      inicio: dados.inicio,
      ativos: { hoje: pessoasDiferentes(1), dias7: pessoasDiferentes(7), dias30: pessoasDiferentes(30) },
      conhecidos: Object.keys(dados.conhecidos).length,
      serie: serie(nDias),
      versoes: versoesEmUso(30),
      amostras: amostrasRecentes(24),
    };
  }

  // As estatísticas nunca podem atrapalhar o app: erro aqui vira só uma linha no log
  // (no máximo uma por minuto) e o pedido da pessoa segue normalmente.
  let ultimoAviso = 0;
  const seguro = (fn, seDerErro) => (...args) => {
    try { return fn(...args); } catch (e) {
      const t = Date.now();
      if (t - ultimoAviso > 60000) { ultimoAviso = t; log.error('[metricas] erro ignorado:', (e && e.message) || e); }
      return seDerErro;
    }
  };

  return {
    atividade: seguro(atividade), contar: seguro(contar), amostra: seguro(amostra),
    registrarDownloads: seguro(registrarDownloads), semear: seguro(semear, false), apagarDe: seguro(apagarDe, false),
    dadosDe: seguro(dadosDe, null), gravarAgora: seguro(gravarAgora),
    // leitura pro painel (erros aqui aparecem como erro no painel, não no app)
    resumo, serie, versoesEmUso, amostrasRecentes, pessoasDiferentes,
  };
}

module.exports = { criarMetricas, CONTADORES, diaDe, horaDe, semanaDe, somarDias, compararVersoes, DIA_MS };

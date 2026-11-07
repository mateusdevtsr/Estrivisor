'use strict';
// ============================================================
// Painel de monitoramento: https://api.SEU-DOMINIO/painel (só administradores).
//
// Login pelo Discord, no navegador: usa o mesmo app do Discord do Estrivisor, com um segundo
// endereço de retorno (PAINEL_REDIRECT_URI, cadastrado no Developer Portal). Só entra quem
// está em ADMIN_DISCORD_IDS. A sessão do painel fica num cookie (HttpOnly, Secure,
// SameSite=Strict, só no caminho /painel), vale 12 horas e fica só na memória: reiniciar o
// servidor desconecta o painel.
//
// O painel só LÊ números. Liberar, punir e moderar continuam no app.
// Nada daqui mostra o texto das mensagens.
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { diaDe, horaDe, semanaDe, DIA_MS } = require('./metricas');
const { ErroDiscord } = require('./discord');

const PASTA_WEB = path.join(__dirname, 'painel-web');
const COOKIE_SESSAO = '__Secure-painel';
const COOKIE_ESTADO = '__Secure-painel-estado';
const VALIDADE_SESSAO_MS = 12 * 60 * 60 * 1000;
const VALIDADE_ESTADO_MS = 10 * 60 * 1000;
const MAX_SESSOES = 20;
const MAX_ESTADOS = 2000;
const PERIODOS = [7, 30, 90];
// Limite próprio do login do painel (não gasta o limite dos logins do app).
const LIMITE_LOGIN_IP = 20;      // por minuto, por IP
const LIMITE_LOGIN_GERAL = 100;  // por minuto, no painel todo
// O que aparece no Histórico do app ("Mateus entrou no painel de monitoramento").
const ACAO_ENTROU = 'entrou no painel de monitoramento';
const ACAO_TENTOU = 'tentou entrar no painel de monitoramento (não é administrador)';

const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: https://cdn.discordapp.com",
  "connect-src 'self'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

const hash = (x) => crypto.createHash('sha256').update(String(x)).digest('hex');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function lerCookies(req) {
  const saida = {};
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    const nome = parte.slice(0, i).trim();
    if (!nome || Object.prototype.hasOwnProperty.call(saida, nome)) continue;
    try { saida[nome] = decodeURIComponent(parte.slice(i + 1).trim()); } catch (e) { /* cookie mal escrito: ignora */ }
  }
  return saida;
}
function cookie(nome, valor, { maxAge, sameSite }) {
  return `${nome}=${valor}; Path=/painel; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;
}
const apagarCookie = (nome, sameSite) => `${nome}=; Path=/painel; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=0`;

function criarPainel(ctx) {
  const agora = ctx.agora || (() => Date.now());
  const log = ctx.log || console;
  const router = express.Router();
  const estados = new Map();   // state do OAuth -> vence em
  const sessoes = new Map();   // hash do cookie -> { usuario, nome, avatar, expira }
  const cache = new Map();     // período -> { em, dados }
  const contadores = new Map(); // limite de logins: chave -> { inicio, n }
  const tentativas = new Map(); // conta não-admin -> última vez que foi pro Histórico
  let tentativasNaHora = { inicio: 0, n: 0 };

  // Arquivos da página (lidos uma vez; não serve nada além destes três).
  const web = {};
  for (const [nome, tipo] of [['index.html', 'text/html; charset=utf-8'], ['painel.css', 'text/css; charset=utf-8'], ['painel.js', 'text/javascript; charset=utf-8']]) {
    try { web[nome] = { corpo: fs.readFileSync(path.join(PASTA_WEB, nome)), tipo }; } catch (e) { log.error(`[painel] faltou o arquivo painel-web/${nome}`); }
  }

  // ---------- só por HTTPS ----------
  // A Cloudflare diz em "cf-visitor" se a pessoa abriu com http ou https. Por http os cookies
  // seguros não funcionam, então manda pro mesmo endereço com https.
  let origemHttps = null;
  try { if (ctx.redirectUri) origemHttps = new URL(ctx.redirectUri).origin; } catch (e) { /* endereço mal escrito */ }
  router.use((req, res, next) => {
    const esquema = (/"scheme"\s*:\s*"(https?)"/.exec(String(req.get('cf-visitor') || '')) || [])[1];
    if (esquema === 'http' && origemHttps && origemHttps.startsWith('https://') && (req.method === 'GET' || req.method === 'HEAD')) {
      return res.redirect(301, origemHttps + req.originalUrl);
    }
    if (esquema === 'https') res.set('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  // ---------- cabeçalhos de segurança em tudo que é do painel ----------
  router.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    next();
  });

  function pagina(res, status, titulo, texto, { voltar = true } = {}) {
    res.status(status).type('html').send(
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<meta name="robots" content="noindex"><title>${esc(titulo)} · Painel do Estrivisor</title><link rel="stylesheet" href="/painel/painel.css"></head>` +
      `<body class="pagina-aviso"><main class="aviso-cartao"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p>` +
      `${voltar ? '<p><a class="botao botao-principal" href="/painel">Voltar ao painel</a></p>' : ''}</main></body></html>`,
    );
  }

  function servir(nome) {
    return (req, res) => {
      const a = web[nome];
      if (!a) return pagina(res, 500, 'Painel incompleto', 'Faltam arquivos do painel no servidor (pasta painel-web).', { voltar: false });
      res.type(a.tipo).send(a.corpo);
    };
  }
  router.get('/', servir('index.html'));
  router.get('/painel.css', servir('painel.css'));
  router.get('/painel.js', servir('painel.js'));

  // ---------- login com Discord ----------
  const loginConfigurado = () => Boolean(ctx.clientId && ctx.clientSecret && ctx.redirectUri);

  function podar() {
    const t = agora();
    for (const [k, v] of estados) if (v <= t) estados.delete(k);
    for (const [k, s] of sessoes) if (s.expira <= t) sessoes.delete(k);
    for (const [k, c] of contadores) if (t - c.inicio > 60000) contadores.delete(k);
    while (estados.size > MAX_ESTADOS) estados.delete(estados.keys().next().value);
    while (sessoes.size > MAX_SESSOES) sessoes.delete(sessoes.keys().next().value);
  }

  // Freio de logins do painel: por IP e no total (separado do app).
  function contar(chave, limite) {
    const t = agora();
    let c = contadores.get(chave);
    if (!c || t - c.inicio > 60000) { c = { inicio: t, n: 0 }; contadores.set(chave, c); }
    c.n++;
    return c.n <= limite;
  }
  function loginLiberado(req) {
    if (contadores.size > 5000) podar();
    return contar('ip:' + ctx.ipDe(req), LIMITE_LOGIN_IP) && contar('geral', LIMITE_LOGIN_GERAL);
  }

  // Conta que não é admin tentou entrar: vai pro Histórico no máximo 1x por hora por conta
  // (e no máximo 30 por hora no total), pra ninguém conseguir encher o Histórico.
  function registrarTentativa(usuario, nome) {
    const t = agora();
    if (t - (tentativas.get(usuario) || 0) < 3600e3) return;
    if (t - tentativasNaHora.inicio > 3600e3) tentativasNaHora = { inicio: t, n: 0 };
    if (tentativasNaHora.n >= 30) return;
    tentativasNaHora.n++;
    tentativas.set(usuario, t);
    if (tentativas.size > 1000) tentativas.delete(tentativas.keys().next().value);
    ctx.auditar(usuario, nome, ACAO_TENTOU, '');
  }

  router.get('/entrar', (req, res) => {
    if (!loginConfigurado()) return pagina(res, 503, 'Login do painel desligado', 'Falta configurar PAINEL_REDIRECT_URI (e o login do Discord) no server.env.', { voltar: false });
    if (!loginLiberado(req)) return pagina(res, 429, 'Muitas tentativas', 'Espere um minuto e tente de novo.');
    podar();
    const estado = crypto.randomBytes(24).toString('base64url');
    estados.set(estado, agora() + VALIDADE_ESTADO_MS);
    res.append('Set-Cookie', cookie(COOKIE_ESTADO, estado, { maxAge: VALIDADE_ESTADO_MS / 1000, sameSite: 'Lax' }));
    const p = new URLSearchParams({
      client_id: ctx.clientId, response_type: 'code', scope: 'identify', redirect_uri: ctx.redirectUri, state: estado, prompt: 'none',
    });
    res.redirect(302, `https://discord.com/oauth2/authorize?${p}`);
  });

  router.get('/retorno', async (req, res) => {
    try {
      await retorno(req, res);
    } catch (e) {
      // Nada pode escapar daqui (erro sem tratamento numa rota assíncrona derrubaria o servidor).
      log.error('[painel] erro no retorno do login:', e);
      if (!res.headersSent) pagina(res, 500, 'Não deu para entrar', 'Algo deu errado no servidor. Tente de novo.');
    }
  });
  async function retorno(req, res) {
    res.append('Set-Cookie', apagarCookie(COOKIE_ESTADO, 'Lax'));
    if (!loginConfigurado()) return pagina(res, 503, 'Login do painel desligado', 'Falta configurar PAINEL_REDIRECT_URI no server.env.', { voltar: false });
    if (!loginLiberado(req)) return pagina(res, 429, 'Muitas tentativas', 'Espere um minuto e tente de novo.');
    const { code, state, error } = req.query;
    const doCookie = lerCookies(req)[COOKIE_ESTADO];
    const vence = typeof state === 'string' ? estados.get(state) : undefined;
    if (typeof state !== 'string' || !vence || vence <= agora() || doCookie !== state) {
      return pagina(res, 400, 'Login expirado', 'O login demorou demais ou não começou por aqui. Tente entrar de novo.');
    }
    estados.delete(state);
    if (error) {
      log.error('[painel] o Discord voltou sem autorizar:', String(error).replace(/[^\w.-]/g, '').slice(0, 60));
      return pagina(res, 400, 'Login cancelado', 'O Discord não autorizou o login. Tente de novo se quiser entrar.');
    }
    if (typeof code !== 'string' || !/^[A-Za-z0-9_-]{10,200}$/.test(code)) return pagina(res, 400, 'Login inválido', 'O Discord não devolveu um código válido. Tente de novo.');
    let perfil;
    try {
      perfil = await ctx.contaDoCodigo({ codigo: code, redirectUri: ctx.redirectUri, clientId: ctx.clientId, clientSecret: ctx.clientSecret, buscar: ctx.buscarDiscord() });
    } catch (e) {
      if (!(e instanceof ErroDiscord)) log.error('[painel] erro no login:', e);
      // 401, e não 502: a Cloudflare troca toda página 502/504 que vem do servidor pela página
      // dela de "Bad gateway", e a explicação do que aconteceu se perderia.
      return pagina(res, 401, 'Não deu para entrar', e instanceof ErroDiscord ? e.message : 'O Discord não confirmou o login. Tente de novo.');
    }
    const usuario = `discord:${perfil.id}`;
    if (!ctx.ehAdmin(usuario)) {
      registrarTentativa(usuario, perfil.nome);
      return pagina(res, 403, 'Painel só do administrador', 'Esta conta do Discord não é administradora do Estrivisor.', { voltar: false });
    }
    podar();
    const token = 'pnl_' + crypto.randomBytes(32).toString('base64url');
    sessoes.set(hash(token), { usuario, nome: perfil.nome, avatar: perfil.avatar || '', expira: agora() + VALIDADE_SESSAO_MS });
    try { ctx.auditar(usuario, perfil.nome, ACAO_ENTROU, ''); } catch (e) { log.error('[painel] não consegui anotar no Histórico:', e.message); }
    res.append('Set-Cookie', cookie(COOKIE_SESSAO, token, { maxAge: VALIDADE_SESSAO_MS / 1000, sameSite: 'Strict' }));
    return res.redirect(302, '/painel');
  }

  function sessaoDe(req) {
    const token = lerCookies(req)[COOKIE_SESSAO];
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    const s = sessoes.get(hash(token));
    if (!s) return null;
    if (s.expira <= agora() || !ctx.ehAdmin(s.usuario)) { sessoes.delete(hash(token)); return null; }
    return s;
  }

  // Tudo em /painel/api exige a sessão do painel.
  router.use('/api', (req, res, next) => {
    const s = sessaoDe(req);
    if (!s) return res.status(401).json({ erro: 'Entre com o Discord para ver o painel.', login: loginConfigurado() });
    req.painel = s;
    next();
  });

  router.get('/api/eu', (req, res) => {
    res.json({ nome: req.painel.nome, avatar: req.painel.avatar, expira: req.painel.expira });
  });

  router.post('/api/sair', (req, res) => {
    // Só aceita vindo da própria página (o cookie já é SameSite=Strict; isto é uma segunda trava).
    const site = req.get('sec-fetch-site');
    if (site && site !== 'same-origin') return res.status(403).json({ erro: 'Pedido de outro site.' });
    const token = lerCookies(req)[COOKIE_SESSAO];
    if (token) sessoes.delete(hash(token));
    res.append('Set-Cookie', apagarCookie(COOKIE_SESSAO, 'Strict'));
    res.json({ ok: true });
  });

  router.get('/api/resumo', (req, res) => {
    const dias = PERIODOS.includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    const c = cache.get(dias);
    if (c && agora() - c.em < 5000) return res.json(c.dados); // várias abas abertas não recalculam tudo
    try {
      const dados = montarResumo(dias);
      cache.set(dias, { em: agora(), dados });
      res.json(dados);
    } catch (e) {
      log.error('[painel] erro ao montar o resumo:', e);
      res.status(500).json({ erro: 'Erro ao calcular os números.' });
    }
  });

  // ---------- os números ----------
  function montarResumo(nDias) {
    const t = agora();
    const hoje = diaDe(t);
    const m = ctx.metricas.resumo(nDias);
    const inicioDia = diaDe(m.inicio);
    const limitePeriodo = t - nDias * DIA_MS;
    const limite30 = t - 30 * DIA_MS;

    // Mensagens guardadas: por dia (pra estimar os dias antes da coleta), por hora, por dia da semana e por servidor.
    const guardadasPorDia = new Map();
    const porHora = new Array(24).fill(0);
    const porSemana = new Array(7).fill(0);
    const porServidor = new Map();
    const nomesDosDias = new Map(); // nº do dia -> "2026-10-13"
    const diaRapido = (ts) => {
      const n = Math.floor((ts - 3 * 3600e3) / DIA_MS);
      let d = nomesDosDias.get(n);
      if (!d) { d = diaDe(ts); nomesDosDias.set(n, d); }
      return d;
    };
    ctx.conversas.percorrer((chave, ts) => {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) return;
      const dm = chave.startsWith('d:');
      const d = diaRapido(ts);
      const g = guardadasPorDia.get(d) || { canal: 0, dm: 0 };
      if (dm) g.dm++; else g.canal++;
      guardadasPorDia.set(d, g);
      if (ts >= limite30) { porHora[horaDe(ts)]++; porSemana[semanaDe(ts)]++; }
      if (!dm) {
        const sid = chave.split(':')[1];
        const s = porServidor.get(sid) || { guardadas: 0, periodo: 0, ultima: null };
        s.guardadas++;
        if (ts >= limitePeriodo) s.periodo++;
        if (!s.ultima || ts > s.ultima) s.ultima = ts;
        porServidor.set(sid, s);
      }
    });

    // Série por dia: antes da coleta, as mensagens vêm das guardadas (estimativa); depois, do contador.
    let ultimoTotalDownloads = null;
    const serie = m.serie.map((r) => {
      const g = guardadasPorDia.get(r.dia) || { canal: 0, dm: 0 };
      let msgCanal = r.msgCanal; let msgDm = r.msgDm; let msgEstimado = false;
      if (r.dia < inicioDia) { msgCanal = g.canal; msgDm = g.dm; msgEstimado = true; }
      else if (r.dia === inicioDia) { msgCanal = Math.max(msgCanal || 0, g.canal); msgDm = Math.max(msgDm || 0, g.dm); }
      let downloads = null;
      if (r.downloadsTotal !== null) {
        if (ultimoTotalDownloads !== null) downloads = Math.max(0, r.downloadsTotal - ultimoTotalDownloads);
        ultimoTotalDownloads = r.downloadsTotal;
      }
      return {
        dia: r.dia, coletado: r.coletado, ativos: r.ativos, novos: r.novos, logins: r.logins, pedidosAcesso: r.pedidosAcesso,
        msgCanal, msgDm, msgEstimado, msgEditadas: r.msgEditadas, msgApagadas: r.msgApagadas,
        entradasVoz: r.entradasVoz, salasCheias: r.salasCheias, minutosVoz: r.minutosVoz, minutosTela: r.minutosTela,
        picoOnline: r.picoOnline, picoVoz: r.picoVoz, picoTela: r.picoTela,
        servidoresCriados: r.servidoresCriados, convitesUsados: r.convitesUsados, amizades: r.amizades, denuncias: r.denuncias,
        requisicoes: r.requisicoes, erros: r.erros, falhasLivekit: r.falhasLivekit, downloads,
      };
    });
    const somaSerie = (campo) => serie.reduce((n, r) => n + (r[campo] || 0), 0);
    const deHoje = serie[serie.length - 1];

    // Agora (presença do app + última foto do LiveKit, de no máximo 3 minutos atrás).
    const presenca = ctx.presencaAgora();
    const ultima = m.amostras.length ? m.amostras[m.amostras.length - 1] : null;
    const fotoRecente = ultima && t - ultima.ts < 3 * 60 * 1000 ? ultima : null;

    // Pessoas e acesso.
    const acessoLista = ctx.acesso.listar();
    const diretorio = ctx.amigos.todos();
    const aceitaram = diretorio.filter((p) => ctx.acesso.aceitou(p.usuario, ctx.versaoTermos)).length;
    const amizades = ctx.amigos.contagem();

    // Servidores.
    const nomeDoDono = (s) => { const n = ctx.nomeConhecido(s.dono); return n && n !== s.dono ? n : (s.donoNome || 'desconhecido'); };
    const servidores = ctx.repo.listarTodos().map((s) => {
      const bruto = ctx.repo.servidorPorId(s.id) || {};
      const canais = Array.isArray(bruto.canais) ? bruto.canais : [];
      const convites = Array.isArray(bruto.convites) ? bruto.convites.filter((c) => c.expiraEm > t).length : 0;
      const msg = porServidor.get(s.id) || { guardadas: 0, periodo: 0, ultima: null };
      return {
        nome: s.nome, dono: nomeDoDono(s), membros: s.membros,
        canaisTexto: canais.filter((c) => c.tipo === 'texto').length, canaisVoz: canais.filter((c) => c.tipo === 'voz').length,
        convitesAtivos: convites, criadoEm: s.criadoEm, mensagensPeriodo: msg.periodo, mensagensGuardadas: msg.guardadas,
        ultimaMensagem: msg.ultima, onlineAgora: presenca.porServidor.get(s.id) || 0,
      };
    }).sort((a, b) => b.onlineAgora - a.onlineAgora || b.mensagensPeriodo - a.mensagensPeriodo || b.membros - a.membros);

    // Moderação.
    const historico = ctx.moderacao.historico(500);
    const chavesLista = ctx.chaves.listar();
    const totaisMsg = ctx.conversas.totais();
    const downloads = ctx.downloads.obter();

    return {
      geradoEm: t,
      periodoDias: nDias,
      inicioColeta: m.inicio,
      config: {
        acessoRestrito: ctx.acessoRestrito, exigirAceite: ctx.exigirAceite, versaoTermos: ctx.versaoTermos,
        versaoMinima: ctx.versaoMinima || null, maxPorSala: ctx.maxPorSala,
      },
      agora: {
        online: presenca.online,
        emChamada: fotoRecente ? fotoRecente.voz : null,
        salasAtivas: fotoRecente ? fotoRecente.salas : null,
        transmitindo: fotoRecente ? fotoRecente.telas : null,
        livekit: fotoRecente ? { ok: fotoRecente.livekitOk, latenciaMs: fotoRecente.latencia, em: fotoRecente.ts } : null,
      },
      pessoas: {
        ativasHoje: m.ativos.hoje, ativas7: m.ativos.dias7, ativas30: m.ativos.dias30,
        novasNoPeriodo: somaSerie('novos'), conhecidas: m.conhecidos, cadastradas: amizades.pessoas,
        liberadas: acessoLista.autorizados.length, pedidosPendentes: acessoLista.pedidos.length,
        punidas: acessoLista.punidos.filter((p) => p.vigente).length, aceitaramTermos: aceitaram,
        loginsNoPeriodo: somaSerie('logins'),
      },
      aparelhos: ctx.sessoes.estatisticas(),
      mensagens: {
        hoje: deHoje ? (deHoje.msgCanal || 0) + (deHoje.msgDm || 0) : 0,
        noPeriodo: somaSerie('msgCanal') + somaSerie('msgDm'),
        canaisNoPeriodo: somaSerie('msgCanal'), dmNoPeriodo: somaSerie('msgDm'),
        desdeSempre: totaisMsg.enviadas, guardadas: totaisMsg.guardadas,
        conversasDm: totaisMsg.conversasDm, canaisComMensagens: totaisMsg.conversasCanal,
        porHora, porSemana,
      },
      chamadas: {
        minutosNoPeriodo: somaSerie('minutosVoz'), minutosTelaNoPeriodo: somaSerie('minutosTela'),
        entradasNoPeriodo: somaSerie('entradasVoz'), salasCheiasNoPeriodo: somaSerie('salasCheias'),
        picoNoPeriodo: Math.max(0, ...serie.map((r) => r.picoVoz || 0)),
      },
      servidores: {
        total: servidores.length,
        membros: servidores.reduce((n, s) => n + s.membros, 0),
        canaisTexto: servidores.reduce((n, s) => n + s.canaisTexto, 0),
        canaisVoz: servidores.reduce((n, s) => n + s.canaisVoz, 0),
        criadosNoPeriodo: somaSerie('servidoresCriados'),
        lista: servidores,
      },
      amizades: { total: amizades.amizades, pedidosPendentes: amizades.pedidos, novasNoPeriodo: somaSerie('amizades') },
      moderacao: {
        denunciasAbertas: ctx.moderacao.abertas(),
        denunciasNoPeriodo: somaSerie('denuncias'),
        acoesAdminNoPeriodo: historico.filter((h) => h.ts >= limitePeriodo && ctx.ehAdmin(h.por) && h.acao !== ACAO_ENTROU && h.acao !== ACAO_TENTOU).length,
        tentativasNoPainel: historico.filter((h) => h.ts >= limitePeriodo && h.acao === ACAO_TENTOU).length,
      },
      qualidade: {
        chavesGeradas: chavesLista.chaves.length,
        chavesUsadas: chavesLista.chaves.filter((c) => c.usadaPor).length,
        contasComNivel: chavesLista.concedidos.filter((c) => !c.vencido).length,
      },
      versoes: m.versoes,
      downloads: {
        ok: downloads.ok, erro: downloads.erro, atualizadoEm: downloads.atualizadoEm,
        total: downloads.total, versoes: downloads.versoes.slice(0, 15),
        noPeriodo: serie.some((r) => r.downloads !== null) ? somaSerie('downloads') : null,
      },
      serie,
      ultimas24h: m.amostras.map((a) => ({ ts: a.ts, online: a.online, voz: a.voz, telas: a.telas, salas: a.salas, requisicoes: a.requisicoes, erros: a.erros, livekitOk: a.livekitOk, latencia: a.latencia })),
      saude: lerSaude(),
      hoje,
    };
  }

  function tamanhoKB(arquivo) {
    try { return Math.round(fs.statSync(arquivo).size / 1024); } catch (e) { return null; }
  }

  function lerBackup() {
    if (!ctx.pastaBackups) return { configurado: false };
    try {
      const lista = fs.readdirSync(ctx.pastaBackups)
        .filter((n) => /^dados-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(n))
        .map((n) => { const st = fs.statSync(path.join(ctx.pastaBackups, n)); return { arquivo: n, ts: st.mtimeMs, kb: Math.round(st.size / 1024) }; })
        .sort((a, b) => b.ts - a.ts);
      let status = null;
      try {
        const texto = fs.readFileSync(path.join(ctx.pastaBackups, 'status.txt'), 'utf8').slice(0, 2000);
        status = {};
        for (const linha of texto.split('\n')) {
          const mm = /^(data|local|vps)=([\w :.-]{0,40})$/.exec(linha.trim());
          if (mm) status[mm[1]] = mm[2];
        }
      } catch (e) { /* o backup.sh antigo não escrevia o status */ }
      return { configurado: true, quantidade: lista.length, ultimo: lista[0] || null, status };
    } catch (e) {
      return { configurado: true, erro: 'Não consegui ler a pasta de backups.' };
    }
  }

  function lerSaude() {
    const mem = process.memoryUsage();
    let disco = null;
    try {
      const s = fs.statfsSync(ctx.pastaDados);
      disco = { totalGB: (s.blocks * s.bsize) / 1e9, livreGB: (s.bavail * s.bsize) / 1e9 };
    } catch (e) { /* sem informação de disco */ }
    let temperaturaC = null;
    try {
      for (const z of fs.readdirSync('/sys/class/thermal')) {
        if (!z.startsWith('thermal_zone')) continue;
        const v = Number(fs.readFileSync(path.join('/sys/class/thermal', z, 'temp'), 'utf8').trim());
        if (Number.isFinite(v) && v > 0 && v < 150000) temperaturaC = Math.max(temperaturaC || 0, Math.round(v / 100) / 10);
      }
    } catch (e) { /* sem sensor visível */ }
    const arquivos = [];
    try {
      for (const nome of fs.readdirSync(ctx.pastaDados)) {
        if (/^[a-z0-9_-]+\.json$/i.test(nome)) arquivos.push({ nome, kb: tamanhoKB(path.join(ctx.pastaDados, nome)) });
      }
    } catch (e) { /* pasta de dados inacessível */ }
    arquivos.sort((a, b) => (b.kb || 0) - (a.kb || 0));
    return {
      inicioProcesso: Math.round(t0()),
      memoriaProcessoMB: Math.round(mem.rss / 1048576),
      memoriaNotebook: { totalGB: os.totalmem() / 1e9, livreGB: os.freemem() / 1e9 },
      carga: os.loadavg().map((x) => Math.round(x * 100) / 100),
      nucleos: os.cpus().length,
      disco, temperaturaC, arquivos, backup: lerBackup(), node: process.version,
    };
  }
  const t0 = () => Date.now() - process.uptime() * 1000;

  return router;
}

module.exports = { criarPainel, lerCookies, ACAO_ENTROU, ACAO_TENTOU };

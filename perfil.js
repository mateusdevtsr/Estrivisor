'use strict';
// ============================================================
// Perfil, conquistas e resumo (estilo "Wrapped"): só formatação e conferência dos dados que vêm do servidor
// (sem tocar na tela nem na rede), para dar para testar com "node --test". Na tela, estrivisor-app.js usa window.Perfil.
// ============================================================
(function (raiz) {
  const PERIGOSOS = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g;
  const texto = (v, max) => (typeof v === 'string' ? v.replace(PERIGOSOS, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const inteiro = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0);

  // 59 -> "59 s", 600 -> "10 min", 5400 -> "1 h 30 min", 90000 -> "25 h"
  function formatarDuracao(segundos) {
    const s = inteiro(segundos);
    if (s < 60) return s + ' s';
    const min = Math.floor(s / 60);
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }

  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  // Períodos que o resumo oferece, no horário de Brasília (o mesmo que o servidor usa).
  function periodos(agora = Date.now()) {
    const d = new Date(agora - 3 * 3600 * 1000);
    const ano = d.getUTCFullYear(), mes = d.getUTCMonth();
    const id = (a, m) => `${a}-${String(m + 1).padStart(2, '0')}`;
    const passadoAno = mes === 0 ? ano - 1 : ano, passadoMes = mes === 0 ? 11 : mes - 1;
    return [
      { id: id(ano, mes), rotulo: 'Este mês', nome: `${MESES[mes]} de ${ano}` },
      { id: id(passadoAno, passadoMes), rotulo: 'Mês passado', nome: `${MESES[passadoMes]} de ${passadoAno}` },
      { id: String(ano), rotulo: 'Este ano', nome: String(ano) },
    ];
  }

  function validarPerfil(d) {
    if (!d || typeof d !== 'object' || !d.perfil || typeof d.perfil !== 'object') return null;
    const n = d.numeros || {};
    return {
      perfil: { usuario: texto(d.perfil.usuario, 100), nome: texto(d.perfil.nome, 40) || '?', avatar: typeof d.perfil.avatar === 'string' ? d.perfil.avatar : '', desde: inteiro(d.perfil.desde), meu: d.perfil.meu === true, privado: d.perfil.privado === true },
      numeros: { voz: inteiro(n.voz), tela: inteiro(n.tela), msgs: inteiro(n.msgs), reacoes: inteiro(n.reacoes), maiorSessao: inteiro(n.maiorSessao), diasAtivos: inteiro(n.diasAtivos), sequenciaAtual: inteiro(n.sequenciaAtual), maiorSequencia: inteiro(n.maiorSequencia) },
      topJogos: (Array.isArray(d.topJogos) ? d.topJogos : []).slice(0, 3).map((j) => ({ nome: texto(j && j.nome, 40), s: inteiro(j && j.s) })).filter((j) => j.nome),
      topParceiros: (Array.isArray(d.topParceiros) ? d.topParceiros : []).slice(0, 3).map((p) => ({ nome: texto(p && p.nome, 40), s: inteiro(p && p.s) })).filter((p) => p.nome),
      conquistas: (Array.isArray(d.conquistas) ? d.conquistas : []).slice(0, 30).map((c) => ({
        id: texto(c && c.id, 30), icone: texto(c && c.icone, 8), titulo: texto(c && c.titulo, 40), desc: texto(c && c.desc, 120),
        unidade: c && c.unidade === 'tempo' ? 'tempo' : (c && c.unidade === 'dias' ? 'dias' : 'n'),
        meta: Math.max(1, inteiro(c && c.meta)), valor: inteiro(c && c.valor), ganha: !!(c && c.ganha),
      })).filter((c) => c.id && c.titulo),
    };
  }

  function validarResumo(d) {
    const r = d && d.resumo;
    if (!r || typeof r !== 'object') return null;
    const md = r.melhorDia && /^\d{4}-\d{2}-\d{2}$/.test(String(r.melhorDia.dia)) ? { dia: r.melhorDia.dia, voz: inteiro(r.melhorDia.voz) } : null;
    return {
      periodo: texto(r.periodo, 8), voz: inteiro(r.voz), tela: inteiro(r.tela), msgs: inteiro(r.msgs), reacoes: inteiro(r.reacoes), diasAtivos: inteiro(r.diasAtivos),
      melhorDia: md, dadosCompletos: r.dadosCompletos === true,
      topJogos: (Array.isArray(r.topJogos) ? r.topJogos : []).slice(0, 3).map((j) => ({ nome: texto(j && j.nome, 40), s: inteiro(j && j.s) })).filter((j) => j.nome),
      topParceiros: (Array.isArray(r.topParceiros) ? r.topParceiros : []).slice(0, 3).map((p) => ({ nome: texto(p && p.nome, 40), s: inteiro(p && p.s) })).filter((p) => p.nome),
    };
  }

  const dataCurta = (iso) => { const [a, m, d] = iso.split('-'); return `${d}/${m}`; };

  // As "manchetes" do resumo: [{ icone, titulo, texto }], só as que têm algo pra contar.
  function manchetes(r) {
    const saida = [];
    if (r.voz > 0) {
      const filmes = r.voz / 7200;
      const piada = filmes >= 1 ? ` Dava pra ver ${filmes >= 10 || Number.isInteger(filmes) ? Math.round(filmes) : filmes.toFixed(1).replace('.', ',')} filmes seguidos.` : '';
      saida.push({ icone: '🎙️', titulo: formatarDuracao(r.voz), texto: 'em chamadas de voz.' + piada });
    }
    if (r.tela > 0) saida.push({ icone: '📺', titulo: formatarDuracao(r.tela), texto: 'transmitindo a tela.' });
    if (r.msgs > 0) saida.push({ icone: '💬', titulo: r.msgs + (r.msgs === 1 ? ' mensagem' : ' mensagens'), texto: 'enviadas no chat.' });
    if (r.reacoes > 0) saida.push({ icone: '😂', titulo: r.reacoes + (r.reacoes === 1 ? ' reação' : ' reações'), texto: 'dadas nas mensagens dos amigos.' });
    if (r.melhorDia) saida.push({ icone: '📅', titulo: dataCurta(r.melhorDia.dia), texto: `foi o seu dia mais falante: ${formatarDuracao(r.melhorDia.voz)} em chamada.` });
    if (r.topJogos[0]) saida.push({ icone: '🎮', titulo: r.topJogos[0].nome, texto: `foi o que você mais transmitiu (${formatarDuracao(r.topJogos[0].s)}).` });
    if (r.topParceiros[0]) saida.push({ icone: '🤝', titulo: r.topParceiros[0].nome, texto: `é quem mais te acompanhou em chamadas (${formatarDuracao(r.topParceiros[0].s)} no total).` });
    if (r.diasAtivos > 0) saida.push({ icone: '🔥', titulo: r.diasAtivos + (r.diasAtivos === 1 ? ' dia' : ' dias'), texto: 'com atividade no app.' });
    return saida;
  }

  const Perfil = { formatarDuracao, periodos, validarPerfil, validarResumo, manchetes, dataCurta };
  if (typeof module !== 'undefined' && module.exports) module.exports = Perfil;
  else raiz.Perfil = Perfil;
})(typeof window !== 'undefined' ? window : globalThis);

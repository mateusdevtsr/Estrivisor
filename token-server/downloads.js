'use strict';
// ============================================================
// Downloads do app (números públicos das versões no GitHub), pro painel do administrador.
//
// O GitHub conta cada vez que um arquivo de uma versão é baixado:
//  - Estrivisor-Setup.exe ......... instalador (baixado pelo site E pelas atualizações automáticas)
//  - Estrivisor-Setup.exe.blockmap  usado pelas atualizações automáticas (só baixa o que mudou)
//  - latest.yml ................... o app confere se tem versão nova (cada vez que abre)
// Por isso o número do instalador mistura instalações novas com atualizações.
// A consulta é guardada por 30 minutos (o GitHub limita 60 consultas por hora sem login).
// ============================================================

function criarDownloads({ repo = 'mateusdevtsr/Estrivisor', buscar = (...a) => fetch(...a), agora = () => Date.now(), validadeMs = 30 * 60 * 1000, log = console } = {}) {
  // GITHUB_REPO=desligado: não consulta o GitHub (o painel mostra "sem dados" nos downloads).
  if (!repo || repo === 'desligado') {
    const desligado = { ok: false, erro: 'Consulta ao GitHub desligada (GITHUB_REPO=desligado).', atualizadoEm: null, tentouEm: null, total: null, versoes: [] };
    return { atualizar: async () => desligado, obter: () => desligado };
  }
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) {
    log.error('[downloads] GITHUB_REPO inválido (use dono/repositorio); a consulta ao GitHub fica desligada.');
    return criarDownloads({ repo: 'desligado' });
  }
  // erro null + total null = ainda consultando (logo depois de ligar o servidor)
  let estado = { ok: false, erro: null, atualizadoEm: null, tentouEm: null, total: null, versoes: [] };
  let emAndamento = null;

  function somar(assets, teste) {
    return assets
      .filter((a) => a && typeof a.name === 'string' && teste(a.name.toLowerCase()))
      .reduce((n, a) => n + (Number.isFinite(Number(a.download_count)) ? Number(a.download_count) : 0), 0);
  }

  async function atualizar() {
    if (emAndamento) return emAndamento;
    emAndamento = (async () => {
      const t = agora();
      try {
        const r = await buscar(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
          headers: { 'User-Agent': 'estrivisor-painel', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? 'O GitHub limitou as consultas. Tento de novo mais tarde.' : `O GitHub respondeu ${r.status}.`);
        const lista = await r.json();
        if (!Array.isArray(lista)) throw new Error('Resposta inesperada do GitHub.');
        const versoes = lista.filter((x) => x && typeof x === 'object' && !x.draft).map((x) => {
          const assets = Array.isArray(x.assets) ? x.assets : [];
          return {
            versao: String(x.tag_name || x.name || '?').replace(/^v/i, '').slice(0, 30),
            publicadaEm: Date.parse(x.published_at || x.created_at) || null,
            preRelease: Boolean(x.prerelease),
            instalador: somar(assets, (n) => n.endsWith('.exe')),
            blockmap: somar(assets, (n) => n.endsWith('.blockmap')),
            verificacoes: somar(assets, (n) => n.endsWith('.yml')),
          };
        }).sort((a, b) => (b.publicadaEm || 0) - (a.publicadaEm || 0));
        const total = versoes.reduce((s, v) => ({
          instalador: s.instalador + v.instalador, blockmap: s.blockmap + v.blockmap, verificacoes: s.verificacoes + v.verificacoes,
        }), { instalador: 0, blockmap: 0, verificacoes: 0 });
        estado = { ok: true, erro: null, atualizadoEm: t, tentouEm: t, total, versoes };
      } catch (e) {
        const msg = e && e.name === 'TimeoutError' ? 'O GitHub demorou demais para responder.' : String((e && e.message) || 'Falha ao consultar o GitHub.').slice(0, 200);
        estado = { ...estado, ok: false, erro: msg, tentouEm: t };
        log.error('[downloads]', msg);
      } finally {
        emAndamento = null;
      }
      return estado;
    })();
    return emAndamento;
  }

  // Devolve o que já tem e, se estiver velho, manda atualizar em segundo plano.
  function obter() {
    const t = agora();
    const velho = !estado.atualizadoEm || t - estado.atualizadoEm > validadeMs;
    const tentouAgora = estado.tentouEm && t - estado.tentouEm < 5 * 60 * 1000;
    if (velho && !tentouAgora) atualizar().catch(() => {});
    return estado;
  }

  return { atualizar, obter };
}

module.exports = { criarDownloads };

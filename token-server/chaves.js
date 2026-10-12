'use strict';
// ============================================================
// Chaves de qualidade da transmissão de tela.
//
// Por padrão todo mundo transmite até 720p a 30 fps. Quem recebe uma chave do administrador
// ativa um nível maior na PRÓPRIA conta:
//   hd30  → até 1080p a 30 fps
//   hd60  → até 1080p a 60 fps (inclui o hd30)
//   max   → até 4K a 60 fps    (inclui os anteriores)
//
// Cada chave vale para UMA conta (quando é ativada, fica presa a quem ativou) e pode ter validade
// (a contar da ativação) ou ser permanente. O administrador também pode revogar a qualquer hora.
//
// No arquivo só fica o hash (SHA-256) de cada chave: quem copiar o arquivo não consegue usá-las.
// A chave em si só aparece UMA vez, na hora em que o administrador a gera.
// Gravação do mesmo jeito seguro dos outros arquivos (temporário + cópia .bak + troca de nome).
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIA_MS = 24 * 60 * 60 * 1000;
// Limites de cada nível. "bitrate" em Mbps. O app usa estes mesmos números pra travar o envio.
const NIVEIS = {
  livre: { rank: 0, nome: '720p30 (padrão)', limites: { largura: 1280, altura: 720, fps: 30, bitrate: 4 } },
  hd30:  { rank: 1, nome: '1080p30',         limites: { largura: 1920, altura: 1080, fps: 30, bitrate: 8 } },
  hd60:  { rank: 2, nome: '1080p60',         limites: { largura: 1920, altura: 1080, fps: 60, bitrate: 12 } },
  max:   { rank: 3, nome: 'Máxima (até 4K)', limites: { largura: 3840, altura: 2160, fps: 60, bitrate: 50 } },
};
const NIVEIS_DE_CHAVE = ['hd30', 'hd60', 'max'];
const MAX_POR_VEZ = 20;
const MAX_CHAVES = 500;
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0, 1 (confundem)

class ErroChave extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

const normalizar = (texto) => String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^ESTR/, '');
const hash = (corpo) => crypto.createHash('sha256').update(corpo).digest('hex');

function gerarCorpo() {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}
const formatar = (corpo) => `ESTR-${corpo.slice(0, 4)}-${corpo.slice(4, 8)}-${corpo.slice(8, 12)}`;

function criarChaves({ arquivo = null, agora = () => Date.now(), log = console } = {}) {
  let dados = { versao: 1, chaves: {}, concedidos: {} };

  function tentarLer(caminho) {
    try {
      const l = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (l && l.chaves && typeof l.chaves === 'object' && l.concedidos && typeof l.concedidos === 'object') return l;
    } catch (e) { /* cai no return abaixo */ }
    return null;
  }
  if (arquivo) {
    const l = tentarLer(arquivo) || (fs.existsSync(arquivo + '.bak') ? tentarLer(arquivo + '.bak') : null);
    if (l) dados = l;
    else if (fs.existsSync(arquivo)) log.error('[chaves] arquivo ilegível; começando vazio (o original foi mantido).');
  }
  function gravar() {
    if (!arquivo) return;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const tmp = arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados, null, 1));
    if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
    fs.renameSync(tmp, arquivo);
  }

  // O nível que a conta tem AGORA (concessão vencida volta pro padrão). Administrador sempre tem tudo.
  function nivelDe(usuario, ehAdmin = false) {
    if (ehAdmin) return resumo('max', null, true);
    const c = dados.concedidos[usuario];
    if (c && NIVEIS[c.nivel] && (!c.ate || c.ate > agora())) return resumo(c.nivel, c.ate || null, false);
    return resumo('livre', null, false);
  }
  function resumo(nivel, ate, admin) {
    const n = NIVEIS[nivel];
    return { nivel, rank: n.rank, nome: n.nome, limites: n.limites, ate, admin };
  }

  // Gera "quantidade" chaves. Devolve o texto de cada uma (é a única vez que ele existe).
  function gerar({ nivel, validadeDias = null, quantidade = 1, nota = '', por = '' }) {
    if (!NIVEIS_DE_CHAVE.includes(nivel)) throw new ErroChave(400, 'Nível de chave inválido.');
    const q = Math.floor(Number(quantidade));
    if (!Number.isFinite(q) || q < 1 || q > MAX_POR_VEZ) throw new ErroChave(400, `Gere de 1 a ${MAX_POR_VEZ} chaves por vez.`);
    let dias = null;
    if (validadeDias !== null && validadeDias !== undefined && validadeDias !== '') {
      dias = Math.floor(Number(validadeDias));
      if (!Number.isFinite(dias) || dias < 1 || dias > 365) throw new ErroChave(400, 'A validade deve ser de 1 a 365 dias (ou permanente).');
    }
    if (Object.keys(dados.chaves).length + q > MAX_CHAVES) throw new ErroChave(409, 'Há chaves demais guardadas. Apague as que não foram usadas.');
    const texto = String(nota || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    const criadas = [];
    for (let i = 0; i < q; i++) {
      let corpo; let h;
      do { corpo = gerarCorpo(); h = hash(corpo); } while (Object.values(dados.chaves).some((c) => c.hash === h));
      const id = crypto.randomBytes(4).toString('hex');
      dados.chaves[id] = { id, hash: h, nivel, validadeDias: dias, criadaEm: agora(), criadaPor: por, nota: texto, usadaPor: null, usadaEm: null };
      criadas.push({ id, chave: formatar(corpo), nivel, validadeDias: dias, nota: texto });
    }
    gravar();
    return criadas;
  }

  // A pessoa digita a chave: se for válida e ainda não usada, o nível passa a valer na conta dela.
  // Devolve { ok, concedido } ou lança ErroChave. Erro de chave errada é sempre a mesma mensagem.
  function resgatar(usuario, textoDaChave, ehAdmin = false) {
    const corpo = normalizar(textoDaChave);
    const invalida = new ErroChave(404, 'Chave inválida ou já usada.');
    if (!/^[A-Z2-9]{12}$/.test(corpo)) throw invalida;
    const h = hash(corpo);
    const chave = Object.values(dados.chaves).find((c) => c.hash === h);
    if (!chave || chave.usadaPor) throw invalida;
    const atual = nivelDe(usuario, ehAdmin);
    if (atual.rank >= NIVEIS[chave.nivel].rank) {
      throw new ErroChave(409, `Sua conta já tem ${atual.nome} ou mais. Essa chave não foi gasta.`);
    }
    const t = agora();
    chave.usadaPor = usuario;
    chave.usadaEm = t;
    dados.concedidos[usuario] = {
      nivel: chave.nivel, desde: t, ate: chave.validadeDias ? t + chave.validadeDias * DIA_MS : null, chaveId: chave.id,
    };
    gravar();
    return { chaveId: chave.id, nivel: nivelDe(usuario, ehAdmin) };
  }

  function revogar(usuario) {
    const c = dados.concedidos[usuario];
    if (!c) return false;
    const chave = dados.chaves[c.chaveId];
    if (chave) chave.revogadaEm = agora();
    delete dados.concedidos[usuario];
    gravar();
    return true;
  }

  // Só chave que ninguém usou pode ser apagada (pra tirar de alguém, use revogar).
  function apagar(id) {
    const c = dados.chaves[id];
    if (!c) throw new ErroChave(404, 'Chave não encontrada.');
    if (c.usadaPor) throw new ErroChave(409, 'Essa chave já foi usada. Para tirar o acesso da pessoa, revogue o acesso dela.');
    delete dados.chaves[id];
    gravar();
  }

  function listar() {
    const t = agora();
    return {
      niveis: Object.entries(NIVEIS).map(([id, n]) => ({ id, rank: n.rank, nome: n.nome, limites: n.limites })),
      chaves: Object.values(dados.chaves)
        .map(({ hash: _h, ...c }) => c)
        .sort((a, b) => b.criadaEm - a.criadaEm),
      concedidos: Object.entries(dados.concedidos)
        .map(([usuario, c]) => ({ usuario, ...c, vencido: Boolean(c.ate && c.ate <= t) }))
        .sort((a, b) => b.desde - a.desde),
    };
  }

  // Apagar a conta tira o nível da pessoa (a chave usada continua marcada como usada).
  function apagarDe(usuario) {
    if (!dados.concedidos[usuario]) return false;
    delete dados.concedidos[usuario];
    gravar();
    return true;
  }

  return { nivelDe, gerar, resgatar, revogar, apagar, listar, apagarDe };
}

module.exports = { criarChaves, ErroChave, NIVEIS, NIVEIS_DE_CHAVE, normalizar };

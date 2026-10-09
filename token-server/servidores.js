'use strict';
// ============================================================
// Servidores, canais, membros e convites (regras + armazenamento).
//
// Este módulo não conhece HTTP: só guarda os dados, aplica as regras e
// devolve resultados (ou lança ErroRegra com o código HTTP adequado).
// Os dados ficam num arquivo JSON, gravado de forma segura: escreve num
// arquivo temporário, guarda uma cópia (.bak) do anterior e só então troca.
// Se algo falhar no meio de uma operação, o estado volta ao que era antes.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIMITES = {
  servidores: 100,           // total no servidor de tokens (proteção contra abuso)
  membros: 50,               // por servidor
  servidoresPorPessoa: 10,   // em quantos servidores uma pessoa pode estar
  canais: 30,                // por servidor
  convitesAtivos: 20,        // por servidor
  nome: 30,                  // nome do servidor e dos canais
  validadeConviteMs: 7 * 24 * 60 * 60 * 1000,
  iconeMaxChars: 40000,      // data URL do ícone (um 128x128 em WebP tem ~5-10 mil)
};

class ErroRegra extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

// ---------- Validação e limpeza de textos vindos dos apps ----------
// Remove caracteres de controle e os que invertem a direção do texto (usados pra enganar).
const CARACTERES_PERIGOSOS = /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

function limparTexto(texto, max) {
  if (typeof texto !== 'string') return '';
  return texto.replace(CARACTERES_PERIGOSOS, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Só aceita imagens do CDN do Discord (mesma regra que já existia pro avatar).
const REGEX_AVATAR = /^https:\/\/cdn\.discordapp\.com\/[A-Za-z0-9_\-\/\.]+(\?[A-Za-z0-9_=&\-]*)?$/;
function limparAvatar(url) {
  if (typeof url !== 'string' || url.length > 250) return '';
  return REGEX_AVATAR.test(url) ? url : '';
}

function exigirUsuario(usuario) {
  if (typeof usuario !== 'string' || usuario.length < 1 || usuario.length > 100 || usuario.replace(CARACTERES_PERIGOSOS, '') !== usuario) {
    throw new ErroRegra(400, 'O campo usuario é obrigatório e precisa ser válido.');
  }
  return usuario;
}

function slug(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'canal';
}

// Ícone: só imagem pequena em WebP/PNG/JPEG. Confere os primeiros bytes do arquivo
// (assinatura), então um SVG ou outro tipo disfarçado não passa.
function validarIcone(icone) {
  if (icone === null) return null;
  const invalido = new ErroRegra(400, 'Ícone inválido ou grande demais.');
  if (typeof icone !== 'string' || icone.length > LIMITES.iconeMaxChars) throw invalido;
  const m = /^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+\/]+={0,2})$/.exec(icone);
  if (!m) throw invalido;
  const bytes = Buffer.from(m[2], 'base64');
  const ok =
    (m[1] === 'webp' && bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') ||
    (m[1] === 'png' && bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (m[1] === 'jpeg' && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8);
  if (!ok) throw invalido;
  return icone;
}

function validarCor(cor) {
  if (cor === null) return null;
  if (typeof cor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(cor)) throw new ErroRegra(400, 'Cor inválida (use o formato #rrggbb).');
  return cor.toLowerCase();
}

// ---------- Convites ----------
// Sem 0/O/1/I/L pra não confundir quando alguém digita o código.
const ALFABETO_CONVITE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function gerarCodigoConvite() {
  let codigo = '';
  for (let i = 0; i < 8; i++) codigo += ALFABETO_CONVITE[crypto.randomInt(ALFABETO_CONVITE.length)];
  return codigo;
}

function normalizarCodigo(codigo) {
  if (typeof codigo !== 'string') return '';
  return codigo.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatarCodigo(codigo) {
  return codigo.slice(0, 4) + '-' + codigo.slice(4);
}

// ---------- Nome da sala do LiveKit de um canal ----------
const REGEX_SALA_SERVIDOR = /^(s[0-9a-f]{10})__([a-z0-9][a-z0-9-]{0,62})$/;

function salaDoCanal(servidorId, canalId) {
  return `${servidorId}__${canalId}`;
}

function interpretarSala(sala) {
  const m = typeof sala === 'string' ? REGEX_SALA_SERVIDOR.exec(sala) : null;
  return m ? { servidorId: m[1], canalId: m[2] } : null;
}

// ============================================================
function criarRepositorio({ arquivo = null, agora = () => Date.now(), log = console } = {}) {
  let dados = { versao: 1, servidores: [] };

  // ---------- Armazenamento ----------
  function tentarLer(caminho) {
    try {
      const lido = JSON.parse(fs.readFileSync(caminho, 'utf8'));
      if (lido && typeof lido === 'object' && Array.isArray(lido.servidores)) return lido;
    } catch (e) { /* cai no return abaixo */ }
    return null;
  }

  function salvarArquivo() {
    if (!arquivo) return;
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    const temporario = arquivo + '.tmp';
    fs.writeFileSync(temporario, JSON.stringify(dados));
    if (fs.existsSync(arquivo)) fs.copyFileSync(arquivo, arquivo + '.bak');
    fs.renameSync(temporario, arquivo);
  }

  function carregar() {
    if (!arquivo || !fs.existsSync(arquivo)) return;
    const lido = tentarLer(arquivo);
    if (lido) { dados = lido; return; }

    // Arquivo principal corrompido: separa ele e tenta a cópia anterior.
    const destino = `${arquivo}.corrompido-${agora()}`;
    fs.renameSync(arquivo, destino);
    log.error(`[servidores] arquivo corrompido, guardado em ${destino}`);
    const backup = fs.existsSync(arquivo + '.bak') ? tentarLer(arquivo + '.bak') : null;
    if (backup) {
      dados = backup;
      salvarArquivo();
      log.warn('[servidores] dados recuperados da cópia (.bak).');
    }
  }
  carregar();

  // Executa uma alteração; se qualquer coisa falhar (inclusive gravar no disco),
  // volta tudo ao estado anterior pra memória e arquivo nunca ficarem diferentes.
  function transacao(fn) {
    const antes = JSON.stringify(dados);
    try {
      const resultado = fn();
      salvarArquivo();
      return resultado;
    } catch (erro) {
      dados = JSON.parse(antes);
      throw erro;
    }
  }

  // ---------- Consultas ----------
  function servidorPorId(id) {
    return typeof id === 'string' ? dados.servidores.find((s) => s.id === id) || null : null;
  }

  const ehMembro = (servidor, usuario) => servidor.membros.some((m) => m.usuario === usuario);
  const servidorDoDono = (usuario) => dados.servidores.find((s) => s.dono === usuario) || null;

  function exigirServidor(id) {
    const servidor = servidorPorId(id);
    if (!servidor) throw new ErroRegra(404, 'Servidor não encontrado.');
    return servidor;
  }
  function exigirMembro(id, usuario) {
    const servidor = exigirServidor(id);
    if (!ehMembro(servidor, usuario)) throw new ErroRegra(403, 'Você não é membro deste servidor.');
    return servidor;
  }
  function exigirDono(id, usuario) {
    const servidor = exigirMembro(id, usuario);
    if (servidor.dono !== usuario) throw new ErroRegra(403, 'Só o dono do servidor pode fazer isso.');
    return servidor;
  }

  // O que os apps podem ver de um servidor (sem convites).
  function visao(servidor, usuario) {
    return {
      id: servidor.id,
      nome: servidor.nome,
      icone: servidor.icone,
      cor: servidor.cor,
      dono: servidor.dono,
      souDono: servidor.dono === usuario,
      versao: servidor.versao,
      criadoEm: servidor.criadoEm,
      canais: servidor.canais.map((c) => ({ id: c.id, tipo: c.tipo, nome: c.nome, aprovacao: c.aprovacao === true })),
      membros: servidor.membros.map((m) => ({ usuario: m.usuario, nome: m.nome, dono: m.usuario === servidor.dono })),
    };
  }

  function listarMeus(usuario) {
    exigirUsuario(usuario);
    return dados.servidores
      .filter((s) => ehMembro(s, usuario))
      .sort((a, b) => a.criadoEm - b.criadoEm)
      .map((s) => visao(s, usuario));
  }

  function obter(id, usuario) {
    exigirUsuario(usuario);
    return visao(exigirMembro(id, usuario), usuario);
  }

  // ---------- Servidor ----------
  function criarServidor({ usuario, nomeUsuario, nome, icone, cor }) {
    exigirUsuario(usuario);
    if (!/^discord:\d{1,25}$/.test(usuario)) throw new ErroRegra(403, 'Só quem usa o Discord no Estrivisor pode criar um servidor.');
    const nomeServidor = limparTexto(nome, LIMITES.nome);
    if (!nomeServidor) throw new ErroRegra(400, 'Dê um nome ao servidor.');
    const iconeOk = icone === undefined ? null : validarIcone(icone);
    const corOk = cor === undefined ? null : validarCor(cor);

    return transacao(() => {
      if (servidorDoDono(usuario)) throw new ErroRegra(409, 'Você já tem um servidor. Cada pessoa pode ter só 1.');
      if (dados.servidores.length >= LIMITES.servidores) throw new ErroRegra(503, 'Limite de servidores deste serviço atingido.');
      if (dados.servidores.filter((s) => ehMembro(s, usuario)).length >= LIMITES.servidoresPorPessoa) {
        throw new ErroRegra(409, `Você já está em ${LIMITES.servidoresPorPessoa} servidores. Saia de algum antes.`);
      }

      let id;
      do { id = 's' + crypto.randomBytes(5).toString('hex'); } while (servidorPorId(id));

      const servidor = {
        id,
        nome: nomeServidor,
        icone: iconeOk,
        cor: corOk,
        dono: usuario,
        criadoEm: agora(),
        versao: 1,
        canais: [
          { id: 'geral-texto', tipo: 'texto', nome: 'geral', aprovacao: false },
          { id: 'geral-voz', tipo: 'voz', nome: 'Geral', aprovacao: false },
        ],
        membros: [{ usuario, nome: limparTexto(nomeUsuario, 40) || usuario, entrouEm: agora() }],
        convites: [],
      };
      dados.servidores.push(servidor);
      return visao(servidor, usuario);
    });
  }

  function atualizarServidor(id, usuario, { nome, icone, cor }) {
    exigirUsuario(usuario);
    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      if (nome !== undefined) {
        const novo = limparTexto(nome, LIMITES.nome);
        if (!novo) throw new ErroRegra(400, 'Dê um nome ao servidor.');
        servidor.nome = novo;
      }
      if (icone !== undefined) servidor.icone = validarIcone(icone);
      if (cor !== undefined) servidor.cor = validarCor(cor);
      servidor.versao++;
      return visao(servidor, usuario);
    });
  }

  // Devolve as salas dos canais (o chamador fecha elas no LiveKit, pra ninguém ficar conectado).
  function apagarServidor(id, usuario) {
    exigirUsuario(usuario);
    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      const salas = servidor.canais.map((c) => salaDoCanal(servidor.id, c.id));
      dados.servidores = dados.servidores.filter((s) => s.id !== servidor.id);
      return { salas };
    });
  }

  function sair(id, usuario) {
    exigirUsuario(usuario);
    return transacao(() => {
      const servidor = exigirMembro(id, usuario);
      if (servidor.dono === usuario) throw new ErroRegra(409, 'O dono não pode sair. Transfira o servidor pra outra pessoa ou apague-o.');
      servidor.membros = servidor.membros.filter((m) => m.usuario !== usuario);
      servidor.versao++;
      return { salas: servidor.canais.map((c) => salaDoCanal(servidor.id, c.id)) };
    });
  }

  function expulsar(id, usuario, alvo) {
    exigirUsuario(usuario);
    exigirUsuario(alvo);
    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      if (alvo === servidor.dono) throw new ErroRegra(409, 'O dono não pode ser expulso.');
      if (!ehMembro(servidor, alvo)) throw new ErroRegra(404, 'Essa pessoa não está no servidor.');
      servidor.membros = servidor.membros.filter((m) => m.usuario !== alvo);
      servidor.versao++;
      return { salas: servidor.canais.map((c) => salaDoCanal(servidor.id, c.id)) };
    });
  }

  function transferir(id, usuario, novoDono) {
    exigirUsuario(usuario);
    exigirUsuario(novoDono);
    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      if (novoDono === usuario) throw new ErroRegra(400, 'Escolha outra pessoa.');
      if (!ehMembro(servidor, novoDono)) throw new ErroRegra(404, 'Essa pessoa não está no servidor.');
      if (servidorDoDono(novoDono)) throw new ErroRegra(409, 'Essa pessoa já é dona de outro servidor (o limite é 1 por pessoa).');
      servidor.dono = novoDono;
      servidor.versao++;
      return visao(servidor, usuario);
    });
  }

  // ---------- Canais ----------
  function criarCanal(id, usuario, { tipo, nome, aprovacao }) {
    exigirUsuario(usuario);
    if (tipo !== 'texto' && tipo !== 'voz') throw new ErroRegra(400, 'O tipo do canal deve ser "texto" ou "voz".');
    const nomeCanal = limparTexto(nome, LIMITES.nome);
    if (!nomeCanal) throw new ErroRegra(400, 'Dê um nome ao canal.');

    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      if (servidor.canais.length >= LIMITES.canais) throw new ErroRegra(409, `Limite de ${LIMITES.canais} canais atingido.`);
      const canalId = `${slug(nomeCanal)}-${tipo}`;
      if (servidor.canais.some((c) => c.id === canalId)) {
        throw new ErroRegra(409, `Já existe um canal ${tipo === 'voz' ? 'de voz' : 'de texto'} com esse nome.`);
      }
      const canal = { id: canalId, tipo, nome: nomeCanal, aprovacao: tipo === 'voz' && aprovacao === true };
      servidor.canais.push(canal);
      servidor.versao++;
      return canal;
    });
  }

  // Renomear só muda o nome mostrado: o id (e portanto a sala) continua o mesmo.
  function editarCanal(id, usuario, canalId, { nome, aprovacao }) {
    exigirUsuario(usuario);
    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      const canal = servidor.canais.find((c) => c.id === canalId);
      if (!canal) throw new ErroRegra(404, 'Canal não encontrado.');
      if (nome !== undefined) {
        const novo = limparTexto(nome, LIMITES.nome);
        if (!novo) throw new ErroRegra(400, 'Dê um nome ao canal.');
        canal.nome = novo;
      }
      if (aprovacao !== undefined && canal.tipo === 'voz') canal.aprovacao = aprovacao === true;
      servidor.versao++;
      return { ...canal };
    });
  }

  function apagarCanal(id, usuario, canalId) {
    exigirUsuario(usuario);
    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      const canal = servidor.canais.find((c) => c.id === canalId);
      if (!canal) throw new ErroRegra(404, 'Canal não encontrado.');
      servidor.canais = servidor.canais.filter((c) => c.id !== canalId);
      servidor.versao++;
      return { sala: salaDoCanal(servidor.id, canal.id) };
    });
  }

  // ---------- Convites ----------
  function limparConvitesVencidos(servidor) {
    const t = agora();
    servidor.convites = servidor.convites.filter((c) => c.expiraEm > t);
  }

  // Qualquer membro pode gerar. Vale 7 dias e o dono pode cancelar.
  function criarConvite(id, usuario) {
    exigirUsuario(usuario);
    return transacao(() => {
      const servidor = exigirMembro(id, usuario);
      limparConvitesVencidos(servidor);
      if (servidor.convites.length >= LIMITES.convitesAtivos) {
        throw new ErroRegra(409, 'Há convites demais ativos. O dono pode cancelar alguns.');
      }
      let codigo;
      do { codigo = gerarCodigoConvite(); } while (dados.servidores.some((s) => s.convites.some((c) => c.codigo === codigo)));
      const convite = { codigo, criadoPor: usuario, criadoEm: agora(), expiraEm: agora() + LIMITES.validadeConviteMs };
      servidor.convites.push(convite);
      return { codigo, formatado: formatarCodigo(codigo), expiraEm: convite.expiraEm };
    });
  }

  function listarConvites(id, usuario) {
    exigirUsuario(usuario);
    const servidor = exigirDono(id, usuario);
    const t = agora();
    return servidor.convites
      .filter((c) => c.expiraEm > t)
      .map((c) => {
        const autor = servidor.membros.find((m) => m.usuario === c.criadoPor);
        return { codigo: c.codigo, formatado: formatarCodigo(c.codigo), criadoPor: autor ? autor.nome : c.criadoPor, expiraEm: c.expiraEm };
      });
  }

  function revogarConvite(id, usuario, codigo) {
    exigirUsuario(usuario);
    const alvo = normalizarCodigo(codigo);
    return transacao(() => {
      const servidor = exigirDono(id, usuario);
      const antes = servidor.convites.length;
      servidor.convites = servidor.convites.filter((c) => c.codigo !== alvo);
      if (servidor.convites.length === antes) throw new ErroRegra(404, 'Convite não encontrado.');
      return { ok: true };
    });
  }

  function usarConvite({ usuario, nomeUsuario, codigo }) {
    exigirUsuario(usuario);
    const alvo = normalizarCodigo(codigo);
    // Mesma resposta pra "não existe" e "venceu", pra não dar pista a quem tenta adivinhar.
    const invalido = new ErroRegra(404, 'Convite inválido ou expirado.');
    if (alvo.length !== 8) throw invalido;

    return transacao(() => {
      const t = agora();
      const servidor = dados.servidores.find((s) => s.convites.some((c) => c.codigo === alvo && c.expiraEm > t));
      if (!servidor) throw invalido;

      if (ehMembro(servidor, usuario)) return visao(servidor, usuario); // já estava dentro: tudo certo
      if (servidor.membros.length >= LIMITES.membros) throw new ErroRegra(409, 'Esse servidor está cheio.');
      if (dados.servidores.filter((s) => ehMembro(s, usuario)).length >= LIMITES.servidoresPorPessoa) {
        throw new ErroRegra(409, `Você já está em ${LIMITES.servidoresPorPessoa} servidores. Saia de algum antes.`);
      }
      servidor.membros.push({ usuario, nome: limparTexto(nomeUsuario, 40) || usuario, entrouEm: t });
      servidor.versao++;
      return visao(servidor, usuario);
    });
  }

  // ---------- Acesso às salas ----------
  // Salas de servidor ("sXXXXXXXXXX__canal") só liberam pra membros. Qualquer outro
  // nome de sala é o modo antigo (aberto), então devolve null.
  function verificarAcessoSala(sala, usuario) {
    const alvo = interpretarSala(sala);
    if (!alvo) return null;
    const servidor = servidorPorId(alvo.servidorId);
    if (!servidor) throw new ErroRegra(404, 'Servidor não encontrado.');
    if (!ehMembro(servidor, usuario)) throw new ErroRegra(403, 'Você não é membro deste servidor.');
    const canal = servidor.canais.find((c) => c.id === alvo.canalId);
    if (!canal) throw new ErroRegra(404, 'Canal não encontrado.');
    return { servidor, canal };
  }

  // Quem manda no servidor dono da sala (null se a sala não é de servidor ou não existe mais).
  function donoDaSala(sala) {
    const alvo = interpretarSala(sala);
    const servidor = alvo ? servidorPorId(alvo.servidorId) : null;
    return servidor ? servidor.dono : null;
  }

  return {
    listarMeus, obter, criarServidor, atualizarServidor, apagarServidor, sair, expulsar, transferir,
    criarCanal, editarCanal, apagarCanal,
    criarConvite, listarConvites, revogarConvite, usarConvite,
    verificarAcessoSala, donoDaSala,
    // usados pela presença
    servidorPorId, servidoresDe: (usuario) => dados.servidores.filter((s) => ehMembro(s, usuario)),
  };
}

module.exports = {
  criarRepositorio, ErroRegra, LIMITES,
  limparTexto, limparAvatar, interpretarSala, salaDoCanal, normalizarCodigo,
};

'use strict';
// ============================================================
// Janela flutuante (fica por cima do jogo e mostra a sala de voz).
// Aqui ficam só as regras, sem Electron, para dar para testar com "node --test".
//
// O que a janela recebe vem da tela principal (que é quem está na chamada) e passa pelo
// processo principal. Tudo é conferido e limpo aqui antes de ir para a janela flutuante.
// ============================================================
const fs = require('fs');
const path = require('path');

const LARGURA = 248;
const ALTURA_BASE = 90;   // topo + botões + espaços
const ALTURA_LINHA = 34;  // cada pessoa da lista
const ALTURA_MENSAGEM = 44; // linha da última mensagem do chat
const MAX_PESSOAS = 12;
const COMANDOS = new Set(['mic', 'surdo', 'sair']);
const ARQUIVO_POSICAO = 'flutuante.json';

function texto(valor, max) {
  return String(valor === undefined || valor === null ? '' : valor)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// Só foto de perfil do Discord (a mesma regra do resto do app).
function urlAvatar(valor) {
  if (typeof valor !== 'string' || valor.length > 300) return '';
  try {
    const u = new URL(valor);
    if (u.protocol === 'https:' && u.hostname === 'cdn.discordapp.com' && !u.username && !u.password) return u.href;
  } catch (e) { /* endereço inválido */ }
  return '';
}

const ESTADO_VAZIO = () => ({ naVoz: false, canal: '', total: 0, participantes: [], microfone: false, surdo: false, mensagem: null, aviso: null });

// Transforma o que a tela mandou (pode vir qualquer coisa) no estado que a janela mostra.
function limparEstado(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  if (b.naVoz !== true) return ESTADO_VAZIO();
  const lista = Array.isArray(b.participantes) ? b.participantes.slice(0, MAX_PESSOAS) : [];
  const participantes = lista
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      id: texto(p.id, 80),
      nome: texto(p.nome, 40) || '?',
      avatar: urlAvatar(p.avatar),
      falando: p.falando === true,
      mic: p.mic === true,
      voce: p.voce === true,
      transmitindo: p.transmitindo === true,
    }));
  const total = Number.isInteger(b.total) && b.total >= participantes.length && b.total <= 1000 ? b.total : participantes.length;
  // Última mensagem do chat e aviso de entrada/saída (a tela principal só manda se a pessoa ligou).
  const m = b.mensagem && typeof b.mensagem === 'object' ? b.mensagem : null;
  const mensagem = m && texto(m.texto, 90) ? { autor: texto(m.autor, 30) || '?', texto: texto(m.texto, 90) } : null;
  const a = b.aviso && typeof b.aviso === 'object' ? b.aviso : null;
  const aviso = a && Number.isInteger(a.id) && texto(a.texto, 60) ? { id: a.id, texto: texto(a.texto, 60) } : null;
  return { naVoz: true, canal: texto(b.canal, 40), total, participantes, microfone: b.microfone === true, surdo: b.surdo === true, mensagem, aviso };
}

// Opções que a tela principal pode mudar. Só passa o que tem o tipo certo.
function limparOpcoes(bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const proprio = (k) => Object.prototype.hasOwnProperty.call(b, k) ? b[k] : undefined;
  const o = {};
  if (typeof proprio('ativa') === 'boolean') o.flutuanteAtiva = b.ativa;
  if (typeof proprio('atalho') === 'boolean') o.flutuanteAtalho = b.atalho;
  const op = proprio('opacidade');
  if (Number.isInteger(op) && op >= 30 && op <= 100) o.flutuanteOpacidade = op;
  if (typeof proprio('clique') === 'boolean') o.flutuanteClique = b.clique;
  if (typeof proprio('chat') === 'boolean') o.flutuanteChat = b.chat;
  if (typeof proprio('avisos') === 'boolean') o.flutuanteAvisos = b.avisos;
  return o;
}

function comandoValido(comando) {
  return typeof comando === 'string' && COMANDOS.has(comando);
}

function alturaDaJanela(quantidade, comMensagem) {
  const n = Math.min(MAX_PESSOAS, Math.max(1, Math.floor(Number(quantidade)) || 0));
  return ALTURA_BASE + ALTURA_LINHA * n + (comMensagem ? ALTURA_MENSAGEM : 0);
}

// A posição guardada só vale se a janela ainda aparece em algum monitor
// (o monitor pode ter sido desligado ou a resolução mudado).
function posicaoValida(pos, areas) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  const cx = x + Math.round(LARGURA / 2);
  const cy = y + 20;
  const dentro = (Array.isArray(areas) ? areas : []).some((a) => a && cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height);
  return dentro ? { x, y } : null;
}

// Mantém a janela inteira dentro da área útil do monitor (sem sair da tela nem ficar
// debaixo da barra de tarefas). Se a janela for maior que a área, gruda no canto de cima à esquerda.
function limitarAArea(pos, largura, altura, area) {
  const maxX = area.x + Math.max(0, area.width - largura);
  const maxY = area.y + Math.max(0, area.height - altura);
  return {
    x: Math.round(Math.min(Math.max(pos.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, area.y), maxY)),
  };
}

// Canto de cima, à direita da área útil do monitor principal.
function posicaoPadrao(area) {
  return { x: area.x + area.width - LARGURA - 20, y: area.y + 20 };
}

function lerPosicao(pasta) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(pasta, ARQUIVO_POSICAO), 'utf8'));
    if (d && Number.isFinite(d.x) && Number.isFinite(d.y)) return { x: Math.round(d.x), y: Math.round(d.y) };
  } catch (e) { /* sem posição guardada */ }
  return null;
}

function gravarPosicao(pasta, pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
  try {
    fs.mkdirSync(pasta, { recursive: true });
    const destino = path.join(pasta, ARQUIVO_POSICAO);
    const temporario = destino + '.tmp';
    fs.writeFileSync(temporario, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) }));
    fs.renameSync(temporario, destino);
  } catch (e) {
    console.warn('[janela flutuante] não consegui guardar a posição:', e.message);
  }
}

module.exports = {
  limparOpcoes, limitarAArea, LARGURA, MAX_PESSOAS, COMANDOS, limparEstado, comandoValido, alturaDaJanela, posicaoValida, posicaoPadrao, lerPosicao, gravarPosicao, urlAvatar,
};

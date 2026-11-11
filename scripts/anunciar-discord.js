#!/usr/bin/env node
// ============================================================
// Manda o "O que há de novo" de uma versão para um canal de texto do Discord (por webhook).
// Roda sozinho no GitHub quando uma versão é publicada (.github/workflows/discord-novidades.yml).
//
// Uso:  DISCORD_WEBHOOK_URL=... node scripts/anunciar-discord.js            -> versão do package.json
//       DISCORD_WEBHOOK_URL=... node scripts/anunciar-discord.js 3.14.0     -> uma versão específica
//       DISCORD_WEBHOOK_URL=... node scripts/anunciar-discord.js --todas    -> histórico inteiro (da mais antiga pra mais nova)
//       node scripts/anunciar-discord.js 3.15.1 --mostrar                   -> só mostra a mensagem, não manda
// O endereço do webhook é secreto (quem tem ele posta no canal): fica só nos segredos do GitHub.
// ============================================================
'use strict';
const path = require('path');
const { NOVIDADES, compararVersoes } = require('../novidades.js');

const SITE = 'https://estrivisor.com.br';
const COR = 0xe5484d;
const cortar = (t, n) => { const s = String(t || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Uma versão -> mensagem do Discord (um "embed"). O Discord aceita até 4096 letras na descrição.
function mensagemDaVersao(n, { maisNova = false } = {}) {
  const linhas = [];
  let usados = 0, sobra = 0;
  for (const it of n.itens) {
    const bloco = `**${it.i} ${it.t}**\n${it.d}\n📍 ${it.c}`;
    if (usados + bloco.length + 2 > 3780) { sobra++; continue; }
    linhas.push(bloco); usados += bloco.length + 2;
  }
  if (sobra) linhas.push(`_…e mais ${sobra} novidade${sobra > 1 ? 's' : ''} dentro do app._`);
  // Sempre o site do Estrivisor (lá tem o PC e o Android, com os termos de uso antes de baixar).
  if (maisNova) linhas.push(`[⬇️ Baixar em estrivisor.com.br](${SITE})\nQuem já tem o Estrivisor no PC recebe a atualização sozinho.`);
  return {
    username: 'Estrivisor',
    allowed_mentions: { parse: [] }, // nunca marca @everyone / ninguém, mesmo se o texto tiver "@"
    embeds: [{
      title: cortar(`🆕 Estrivisor ${n.versao} — ${n.titulo}`, 256),
      description: linhas.join('\n\n'),
      color: COR,
      footer: { text: 'O que há de novo' }
    }]
  };
}

function escolher(args, versaoPacote) {
  const ordem = [...NOVIDADES].sort((a, b) => compararVersoes(a.versao, b.versao)); // mais antiga primeiro
  const maisNova = ordem[ordem.length - 1];
  if (args.includes('--todas')) return ordem.map((n) => ({ n, maisNova: n === maisNova }));
  const pedida = args.find((a) => /^\d+\.\d+\.\d+$/.test(a)) || versaoPacote;
  const n = NOVIDADES.find((x) => x.versao === pedida);
  if (!n) throw new Error(`A versão ${pedida} não tem "O que há de novo" escrito em novidades.js.`);
  return [{ n, maisNova: n === maisNova }];
}

async function mandar(url, corpo, buscar = fetch) {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const r = await buscar(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    if (r.ok) return;
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise((ok) => setTimeout(ok, (Number(j.retry_after) || 2) * 1000)); continue; }
    throw new Error(`O Discord recusou a mensagem (${r.status}): ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
  throw new Error('O Discord pediu pra esperar demais (limite de mensagens).');
}

async function principal() {
  const args = process.argv.slice(2);
  const versaoPacote = require(path.join(__dirname, '..', 'package.json')).version;
  const lista = escolher(args, versaoPacote);
  if (args.includes('--mostrar')) { for (const { n, maisNova } of lista) console.log(JSON.stringify(mensagemDaVersao(n, { maisNova }), null, 2)); return; }
  const url = String(process.env.DISCORD_WEBHOOK_URL || '').trim();
  if (!/^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(url)) {
    throw new Error('Falta o DISCORD_WEBHOOK_URL (o endereço do webhook do canal), ou ele está incompleto.');
  }
  for (const { n, maisNova } of lista) {
    await mandar(url, mensagemDaVersao(n, { maisNova }));
    console.log(`Anunciada a versão ${n.versao}.`);
    if (lista.length > 1) await new Promise((ok) => setTimeout(ok, 2500));
  }
}

if (require.main === module) principal().catch((e) => { console.error('[anunciar] ' + e.message); process.exit(1); });
module.exports = { mensagemDaVersao, escolher, mandar };

'use strict';
// ============================================================
// Login com Discord (OAuth2, "authorization code").
//
// O app abre o Discord no navegador; depois que a pessoa autoriza, o Discord devolve
// um código pro app, que repassa pra cá. Só este servidor conhece o Client Secret:
// é ele que troca o código pela conta da pessoa e confirma o ID dela direto com o
// Discord. Nenhum token do Discord é guardado — só o ID, o nome e o avatar.
// ============================================================

const URL_TOKEN = 'https://discord.com/api/oauth2/token';
const URL_EU = 'https://discord.com/api/users/@me';

class ErroDiscord extends Error {}

// Mesmo formato de perfil que o app sempre usou: { id, nome, avatar }.
function montarPerfilDiscord(usuario) {
  if (!usuario || usuario.id === undefined || usuario.id === null) return null;
  const id = String(usuario.id);
  if (!/^\d{5,25}$/.test(id)) return null;

  const nome = String(usuario.global_name || usuario.username || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 32);
  if (!nome) return null;

  let avatar;
  const hashAvatar = usuario.avatar ? String(usuario.avatar) : '';
  if (hashAvatar && /^[A-Za-z0-9_]+$/.test(hashAvatar)) {
    avatar = `https://cdn.discordapp.com/avatars/${id}/${hashAvatar}.png?size=64`;
  } else {
    // Sem foto: o Discord usa um dos avatares padrão (contas novas escolhem pelo ID).
    const disc = String(usuario.discriminator || '0');
    const indice = disc !== '0' && /^\d+$/.test(disc) ? Number(disc) % 5 : Number((BigInt(id) >> 22n) % 6n);
    avatar = `https://cdn.discordapp.com/embed/avatars/${indice}.png`;
  }
  return { id, nome, avatar };
}

// Troca o código pela conta da pessoa. "buscar" é o fetch (trocável nos testes).
async function contaDoCodigo({ codigo, redirectUri, clientId, clientSecret, buscar = fetch }) {
  const credenciais = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let resposta;
  try {
    resposta = await buscar(URL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credenciais}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: codigo, redirect_uri: redirectUri }).toString(),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new ErroDiscord('Não consegui falar com o Discord. Tente de novo.');
  }
  if (!resposta.ok) throw new ErroDiscord('O Discord não confirmou o login (o código venceu ou já foi usado). Tente de novo.');
  const { access_token: tokenAcesso } = await resposta.json().catch(() => ({}));
  if (!tokenAcesso) throw new ErroDiscord('Resposta estranha do Discord. Tente de novo.');

  let eu;
  try {
    eu = await buscar(URL_EU, { headers: { Authorization: `Bearer ${tokenAcesso}` }, signal: AbortSignal.timeout(10000) });
  } catch (e) {
    throw new ErroDiscord('Não consegui falar com o Discord. Tente de novo.');
  }
  if (!eu.ok) throw new ErroDiscord('O Discord não liberou os dados da conta. Tente de novo.');
  const perfil = montarPerfilDiscord(await eu.json().catch(() => null));
  if (!perfil) throw new ErroDiscord('Não consegui ler a sua conta do Discord.');
  return perfil;
}

module.exports = { montarPerfilDiscord, contaDoCodigo, ErroDiscord };

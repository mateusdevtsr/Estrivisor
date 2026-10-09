// Converte o usuário que o Discord desktop informa (via conexão local) num
// perfil simples e validado: { id, nome, avatar }.
//
// - nome: o nome de exibição (o apelido que aparece no Discord); se a pessoa
//   não tiver um, usa o @ (username).
// - avatar: URL da imagem no CDN do Discord (o avatar da pessoa, ou um dos
//   avatares padrão do Discord quando ela não tem foto).
// Retorna null se os dados vierem incompletos ou estranhos.

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
  const hash = usuario.avatar ? String(usuario.avatar) : '';
  if (hash && /^[A-Za-z0-9_]+$/.test(hash)) {
    avatar = `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=64`;
  } else {
    // Sem foto: o Discord usa um avatar padrão. Contas antigas escolhem pelo
    // número depois do # (discriminator); contas novas, pelo ID.
    const disc = String(usuario.discriminator || '0');
    const indice = disc !== '0' && /^\d+$/.test(disc)
      ? Number(disc) % 5
      : Number((BigInt(id) >> 22n) % 6n);
    avatar = `https://cdn.discordapp.com/embed/avatars/${indice}.png`;
  }

  return { id, nome, avatar };
}

module.exports = { montarPerfilDiscord };

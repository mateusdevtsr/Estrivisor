'use strict';
// Limite de pessoas por sala. Quem já está dentro (voltando depois de cair) não conta como "vaga nova".
function salaLotada(participantes, usuario, maximo) {
  if (!Number.isInteger(maximo) || maximo <= 0) return false; // 0 = sem limite
  const lista = Array.isArray(participantes) ? participantes : [];
  if (lista.some((p) => p && p.identity === usuario)) return false;
  return lista.length >= maximo;
}
module.exports = { salaLotada };

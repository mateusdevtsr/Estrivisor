#!/bin/bash
# Backup semanal dos dados do Estrivisor: cópia local (4 últimas) + cópia na VPS (8 últimas).
# Rodado todo domingo às 4h pelo /etc/cron.d/estrivisor-backup (como root).
set -e
cd /home/mateus/estrivisor
mkdir -p backups
ARQ="backups/dados-$(date +%F).tar.gz"
tar czf "$ARQ" dados
chown -R mateus:mateus backups
ls -1t backups/dados-*.tar.gz | tail -n +5 | xargs -r rm --
echo "$(date '+%F %T') cópia local ok: $ARQ"

# Cópia para fora do notebook. Se falhar, a cópia local continua valendo e o erro vai pro log.
DESTINO="${DESTINO_VPS:-estbackup@livekit.estrivisor.com.br}"
CHAVE=/home/mateus/.ssh/backup_vps
OPCOES="-i $CHAVE -o BatchMode=yes -o ConnectTimeout=20 -o UserKnownHostsFile=/home/mateus/.ssh/known_hosts"
# Como root (cron), usa a conta mateus, dona da chave. Como mateus, roda direto.
if [ "$(id -u)" = "0" ]; then COMO="runuser -u mateus --"; else COMO=""; fi

enviar() {
  $COMO scp -q $OPCOES "$ARQ" "$DESTINO:backups/" \
    && $COMO ssh $OPCOES "$DESTINO" 'ls -1t backups/dados-*.tar.gz | tail -n +9 | xargs -r rm --'
}
# A rede oscila de vez em quando: tenta até 3 vezes antes de desistir.
for tentativa in 1 2 3; do
  if enviar; then
    echo "$(date '+%F %T') cópia na VPS ok"
    exit 0
  fi
  echo "$(date '+%F %T') tentativa $tentativa de 3 falhou" >&2
  [ "$tentativa" -lt 3 ] && sleep 30
done
echo "$(date '+%F %T') ERRO: não consegui copiar para a VPS" >&2
exit 1

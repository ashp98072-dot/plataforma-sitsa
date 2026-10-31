#!/bin/bash
# PROPOSAL ONLY. Install root:root 0750 after Linux review; never run on hosting.
set -euo pipefail
umask 077
base=/var/backups/novalvion-ps-sandbox
socket=/run/novalvion-ps-db/mariadb.sock
# systemd Conflicts stops all runtime writers before this offline snapshot.
identity=$(/usr/bin/mariadb --no-defaults --protocol=socket --socket="$socket" --user=root --batch --skip-column-names sandbox_pricesmart --execute="SELECT DATABASE(),environment,sandbox_id FROM novalvion_environment WHERE id=1")
[[ "$identity" == $'sandbox_pricesmart\tsandbox\tpricesmart-qa' ]] || exit 1
if find -P /srv/novalvion-ps-sandbox/uploads \( ! -type f -a ! -type d \) -print -quit | grep -q .; then exit 1; fi
stage=$(mktemp -d "$base/staging.XXXXXXXX")
cleanup() {
  rm -f -- "$stage/db.sql" "$stage/uploads.tar" "$stage/isolation.json" "$stage/SHA256SUMS"
  rmdir -- "$stage"
}
trap cleanup EXIT
/usr/bin/mariadb-dump --no-defaults --protocol=socket --socket="$socket" --user=root --single-transaction --skip-lock-tables --hex-blob sandbox_pricesmart > "$stage/db.sql"
tar --acls --xattrs -cf "$stage/uploads.tar" -C /srv/novalvion-ps-sandbox uploads
cp -- /srv/novalvion-ps-sandbox/isolation.json "$stage/isolation.json"
(cd "$stage" && sha256sum db.sql uploads.tar isolation.json > SHA256SUMS)
out="$base/sandbox-$(date -u +%Y%m%dT%H%M%S)-$(basename "$stage").tar.age"
# The recipient is public; the private recovery key must NOT live on this VM.
set -o noclobber
tar -C "$stage" -cf - db.sql uploads.tar isolation.json SHA256SUMS | age -R /etc/novalvion-ps-sandbox/backup.recipients > "$out.partial"
mv -T -- "$out.partial" "$out"
sha256sum "$out" > "$out.sha256"
# No automatic restart: operator verifies output, then starts app/proxy manually.

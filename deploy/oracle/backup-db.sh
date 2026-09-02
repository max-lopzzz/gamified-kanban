#!/usr/bin/env bash
# Consistent SQLite backup (safe to run while the API is live).
# Install:
#   sudo cp deploy/oracle/backup-db.sh /usr/local/bin/kanban-backup
#   sudo chmod +x /usr/local/bin/kanban-backup
#   sudo crontab -e   # add:  17 3 * * *  /usr/local/bin/kanban-backup
set -euo pipefail

DB="${DB_PATH:-/mnt/data/gamified_kanban.sqlite}"
DEST="${BACKUP_DIR:-/mnt/data/backups}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$DEST"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
sqlite3 "$DB" ".backup '$DEST/kanban-$stamp.sqlite'"
gzip -f "$DEST/kanban-$stamp.sqlite"

# Prune old backups, keep the newest $KEEP.
ls -1t "$DEST"/kanban-*.sqlite.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "backup ok: $DEST/kanban-$stamp.sqlite.gz"

# Deploying the backend to an Oracle Cloud "Always Free" VM

End state: the Express API runs under `systemd`, the SQLite database lives on a
persistent block volume, and Caddy terminates HTTPS in front of it. Cost: $0,
permanently. No code changes — `better-sqlite3` and the file on disk, as-is.

Files in this directory:

| File | Goes to | Purpose |
|---|---|---|
| `gamified-kanban-api.service` | `/etc/systemd/system/` | runs `node server.js`, restarts on crash/reboot |
| `api.env.example` | copy to `/etc/gamified-kanban/api.env` | environment (DB path, JWT secret, CORS) |
| `Caddyfile` | `/etc/caddy/Caddyfile` | reverse proxy + automatic Let's Encrypt TLS |
| `backup-db.sh` | `/usr/local/bin/kanban-backup` | nightly consistent DB backup |

Assumptions used throughout: Ubuntu 22.04, repo at `/opt/gamified-kanban`,
data volume mounted at `/mnt/data`, service user `kanban`.

---

## 1. Create the VM

OCI console → **Compute → Instances → Create instance**:

- **Image:** Canonical Ubuntu 22.04.
- **Shape:** `VM.Standard.A1.Flex` (ARM, Always Free) — 1 OCPU / 6 GB RAM is
  plenty. If you get **"Out of host capacity"**, try a different Availability
  Domain, a different region, or retry over a day or two — ARM capacity is
  the one real hurdle of this whole process.
- Add your SSH public key.
- Leave it on the default public subnet with a public IPv4.

SSH in: `ssh ubuntu@<PUBLIC_IP>`

---

## 2. Attach and mount the persistent disk

OCI console → **Storage → Block Volumes → Create Block Volume** (e.g. 50 GB,
Always Free covers up to 200 GB total). Then **attach** it to the instance
(Instance → Attached block volumes → Attach → Paravirtualized is simplest).

On the VM:

```bash
lsblk                                  # find the new disk, e.g. /dev/sdb
sudo mkfs.ext4 /dev/sdb                 # ONLY if it's a brand-new blank volume
sudo mkdir -p /mnt/data
DISK_UUID=$(sudo blkid -s UUID -o value /dev/sdb)
echo "UUID=$DISK_UUID /mnt/data ext4 defaults,_netdev,nofail 0 2" | sudo tee -a /etc/fstab
sudo mount -a
df -h /mnt/data                         # confirm it's mounted
```

`_netdev,nofail` matters — without them a detached volume can block boot.

---

## 3. Open the firewall — BOTH layers

Oracle blocks inbound traffic in two independent places. You must open **80**
and **443** in each.

**Layer 1 — OCI Security List (console):**
VCN → Subnet → Security List → **Add Ingress Rules**:

| Source CIDR | Protocol | Dest port |
|---|---|---|
| `0.0.0.0/0` | TCP | 80 |
| `0.0.0.0/0` | TCP | 443 |

(Port 22 is already open.)

**Layer 2 — the VM's own iptables** (Oracle's Ubuntu image ships a restrictive
`INPUT` chain):

```bash
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Skipping layer 2 is the classic "it works with `curl localhost` but the
browser can't reach it" trap.

---

## 4. Install Node and build tools

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3 sqlite3
node -v      # v22.x
```

`build-essential` / `python3` are only needed if `better-sqlite3` has to
compile from source (usually it uses a prebuilt binary).

---

## 5. Get the code and install deps

```bash
sudo useradd --system --home /opt/gamified-kanban --shell /usr/sbin/nologin kanban
sudo git clone https://github.com/max-lopzzz/gamified-kanban.git /opt/gamified-kanban
cd /opt/gamified-kanban/backend
sudo npm ci
sudo mkdir -p /mnt/data/backups
sudo chown -R kanban:kanban /opt/gamified-kanban /mnt/data
```

---

## 6. Environment file

```bash
sudo mkdir -p /etc/gamified-kanban
sudo cp /opt/gamified-kanban/deploy/oracle/api.env.example /etc/gamified-kanban/api.env
sudo sed -i "s|replace-with-openssl-rand-hex-32|$(openssl rand -hex 32)|" /etc/gamified-kanban/api.env
sudo nano /etc/gamified-kanban/api.env      # set CORS_ORIGIN to your Vercel URL
sudo chown root:kanban /etc/gamified-kanban/api.env
sudo chmod 640 /etc/gamified-kanban/api.env
```

---

## 7. Start the service

```bash
sudo cp /opt/gamified-kanban/deploy/oracle/gamified-kanban-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now gamified-kanban-api
systemctl status gamified-kanban-api --no-pager
curl -s http://127.0.0.1:4000/api/health        # -> {"ok":true}
```

If it fails: `journalctl -u gamified-kanban-api -n 50 --no-pager`.

---

## 8. Caddy (HTTPS reverse proxy)

Pick a hostname first. No domain? Use `sslip.io`: take the VM's public IP,
replace dots with dashes — `203.0.113.45` becomes `203-0-113-45.sslip.io`.

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

sudo cp /opt/gamified-kanban/deploy/oracle/Caddyfile /etc/caddy/Caddyfile
sudo sed -i "s|api.example.com|YOUR-HOSTNAME-HERE|" /etc/caddy/Caddyfile
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
sudo systemctl reload caddy
journalctl -u caddy -n 30 --no-pager            # watch it get the certificate
```

Verify from your laptop: `curl https://YOUR-HOSTNAME/api/health` → `{"ok":true}`.

---

## 9. Point the frontend at it

- **Vercel** → project → Settings → Environment Variables →
  `VITE_API_URL = https://YOUR-HOSTNAME/api`  (keep the `/api`) → **Redeploy**.
- The `CORS_ORIGIN` you set in step 6 must be the exact Vercel origin
  (`https://gamified-kanban.vercel.app`, no trailing slash).

Register a fresh account on the deployed site — it now persists across
redeploys and reboots.

---

## 10. Updating after you push new code

```bash
cd /opt/gamified-kanban && sudo -u kanban git pull
cd backend && sudo -u kanban npm ci
sudo systemctl restart gamified-kanban-api
```

## 11. Backups

```bash
sudo cp /opt/gamified-kanban/deploy/oracle/backup-db.sh /usr/local/bin/kanban-backup
sudo chmod +x /usr/local/bin/kanban-backup
sudo crontab -e     # add:  17 3 * * *  /usr/local/bin/kanban-backup
```

Backups land in `/mnt/data/backups/` (14 kept). Restore = stop the service,
`gunzip` a backup over `DB_PATH`, start the service. For off-box copies, add an
`rclone`/`scp` line to the cron.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `curl localhost` works, browser/Vercel can't reach it | iptables (layer 2) not opened — step 3 |
| Caddy can't get a certificate | port 80 unreachable from internet (both firewall layers), or the hostname doesn't resolve to this IP |
| `502 Bad Gateway` from Caddy | API not running, or not on `127.0.0.1:4000` — check `systemctl status` and `HOST`/`PORT` in the env file |
| CORS error in the browser console | `CORS_ORIGIN` doesn't exactly match the frontend origin; restart the service after changing it |
| `better-sqlite3` build fails on `npm ci` | `sudo apt-get install -y build-essential python3`, then retry |
| Service won't start after reboot, DB path missing | volume didn't mount — check `/etc/fstab` has `_netdev,nofail` and `df -h /mnt/data` |

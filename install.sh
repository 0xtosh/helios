#!/usr/bin/env bash
# Install Helios as a systemd service on Debian / Ubuntu / Raspberry Pi OS.
#   sudo ./install.sh [--dir /opt/helios] [--user helios] [--port 3200] [--hub-ip <ip>]
set -euo pipefail

DIR=/opt/helios
APP_USER=helios
PORT=3200
HUB_IP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --user) APP_USER="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --hub-ip) HUB_IP="$2"; shift 2 ;;
    -h|--help) sed -n 2,3p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo ./install.sh)" >&2; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"

# Node.js >= 18
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Installing Node.js ..."
  apt-get update
  apt-get install -y nodejs
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Node.js 18+ required; install it from https://nodejs.org" >&2; exit 1; }
fi
NODE_BIN="$(command -v node)"

# service user and files
id "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DIR"
cp -r "$SRC/server.js" "$SRC/package.json" "$SRC/lib" "$SRC/public" "$SRC/scripts" "$DIR/"
chown -R "$APP_USER:$APP_USER" "$DIR"

# hub token (press the button on the hub when asked)
if [ ! -s "$DIR/token.txt" ]; then
  echo "Pairing with the DIRIGERA hub ..."
  TOKEN_FILE="$DIR/token.txt" "$NODE_BIN" "$DIR/scripts/get-token.js" $HUB_IP
fi
chown "$APP_USER:$APP_USER" "$DIR/token.txt"
chmod 600 "$DIR/token.txt"

# systemd unit
sed -e "s|/opt/helios|$DIR|g" \
    -e "s|^User=.*|User=$APP_USER|" -e "s|^Group=.*|Group=$APP_USER|" \
    -e "s|/usr/bin/node|$NODE_BIN|" \
    -e "s|^Environment=PORT=.*|Environment=PORT=$PORT|" \
    "$SRC/deploy/helios.service" > /etc/systemd/system/helios.service
[ -n "$HUB_IP" ] && sed -i "s|^# Environment=HUB_IP=.*|Environment=HUB_IP=$HUB_IP|" /etc/systemd/system/helios.service

systemctl daemon-reload
systemctl enable --now helios
sleep 2
systemctl --no-pager --lines=5 status helios || true
echo
echo "Helios is running on http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT/"

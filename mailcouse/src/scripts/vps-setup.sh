#!/bin/bash
set -e

echo "=== VPS Setup for mailcouse ==="
echo "Target: $(hostname) @ $(hostname -I | awk '{print $1}')"
echo ""

# Ensure we're root / have sudo
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root: sudo bash src/scripts/vps-setup.sh"
  exit 1
fi

# --- System packages ---
echo "[1/6] Updating system packages..."
apt update && apt upgrade -y

echo "[2/6] Installing Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git
node -v && npm -v

echo "[3/6] Installing PostgreSQL 16..."
apt install -y postgresql postgresql-contrib
systemctl enable postgresql
systemctl start postgresql

# Create database and user
sudo -u postgres psql <<SQL
CREATE USER mailcouse WITH PASSWORD 'postgres';
CREATE DATABASE mailcouse OWNER mailcouse;
ALTER USER mailcouse CREATEDB;
\c mailcouse
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
SQL
echo "  PostgreSQL: user=mailcouse, db=mailcouse, password=postgres"

echo "[4/6] Installing Redis..."
apt install -y redis-server
# Bind to localhost only (safe since app runs on same machine)
sed -i 's/^bind 127.0.0.1 ::1/bind 127.0.0.1/' /etc/redis/redis.conf
systemctl enable redis-server
systemctl start redis-server
echo "  Redis running on localhost:6379"

echo "[5/6] Opening port 3000 (API) and 25 (SMTP)..."
ufw allow 3000/tcp 2>/dev/null || echo "  ufw not available — configure firewall manually"
ufw allow 25/tcp 2>/dev/null || true
echo "  Done"

echo "[6/6] Setup complete!"
echo ""
echo "==========================================="
echo "  NEXT STEPS:"
echo "==========================================="
echo ""
echo "  1. Clone / copy the project to VPS:"
echo "     git clone <your-repo> /opt/mailcouse"
echo "     cd /opt/mailcouse"
echo ""
echo "  2. Install deps & build:"
echo "     npm install"
echo "     npm run build"
echo ""
echo "  3. Update .env if needed, then seed DB:"
echo "     npx ts-node src/scripts/seed-setup.ts"
echo ""
echo "  4. Provision DNS:"
echo "     npx ts-node src/scripts/provision-dns.ts"
echo ""
echo "  5. Start the server:"
echo "     npm start"
echo ""
echo "  Dashboard: http://$(hostname -I | awk '{print $1}'):3000/dashboard"
echo "  Health:    http://$(hostname -I | awk '{print $1}'):3000/health"
echo "==========================================="

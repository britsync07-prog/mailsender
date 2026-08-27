#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/opt/mailcouse}"
ENV_FILE="$APP_DIR/.env"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/dovecot/install.sh $APP_DIR" >&2
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# This is the application's own operator-managed environment file.
set -a
source "$ENV_FILE"
set +a

: "${DB_HOST:=127.0.0.1}"
: "${DB_PORT:=5432}"
: "${DB_NAME:=mailcouse}"
: "${DB_USER:=mailcouse}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"
: "${SMTP_TLS_CERT:=${SMTP_TLS_FULLCHAIN:-}}"
: "${SMTP_TLS_KEY:=${SMTP_TLS_PRIVKEY:-}}"
if [[ -z "$SMTP_TLS_CERT" || -z "$SMTP_TLS_KEY" ]]; then
  echo "SMTP_TLS_CERT/SMTP_TLS_KEY (or FULLCHAIN/PRIVKEY) must be set" >&2
  exit 1
fi

apt-get update
apt-get install -y dovecot-imapd dovecot-lmtpd dovecot-pgsql

getent group vmail >/dev/null || groupadd --gid 5000 vmail
id -u vmail >/dev/null 2>&1 || useradd --system --uid 5000 --gid vmail --home-dir /var/vmail --shell /usr/sbin/nologin vmail
install -d -o vmail -g vmail -m 0750 /var/vmail

cat >/etc/dovecot/conf.d/99-mailcouse.conf <<EOF
protocols = imap lmtp
listen = *, ::

ssl = required
ssl_cert = <$SMTP_TLS_CERT
ssl_key = <$SMTP_TLS_KEY
disable_plaintext_auth = yes
auth_mechanisms = plain login
auth_username_format = %Lu

mail_location = maildir:~/Maildir
first_valid_uid = 5000
last_valid_uid = 5000

namespace inbox {
  inbox = yes
  separator = /
  mailbox Drafts {
    special_use = \Drafts
    auto = subscribe
  }
  mailbox Junk {
    special_use = \Junk
    auto = subscribe
  }
  mailbox Trash {
    special_use = \Trash
    auto = subscribe
  }
  mailbox Sent {
    special_use = \Sent
    auto = subscribe
  }
  mailbox "Sent Messages" {
    special_use = \Sent
    auto = no
  }
  mailbox "Sent Items" {
    special_use = \Sent
    auto = no
  }
  mailbox Archive {
    special_use = \Archive
    auto = create
  }
}

passdb {
  driver = sql
  args = /etc/dovecot/mailcouse-sql.conf.ext
}
userdb {
  driver = sql
  args = /etc/dovecot/mailcouse-sql.conf.ext
}

service imap-login {
  inet_listener imap {
    port = 143
  }
  inet_listener imaps {
    port = 993
    ssl = yes
  }
}
service lmtp {
  user = vmail
  inet_listener lmtp {
    address = 127.0.0.1
    port = 24
  }
}
EOF

cat >/etc/dovecot/mailcouse-sql.conf.ext <<EOF
driver = pgsql
connect = host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER password=$DB_PASSWORD
default_pass_scheme = BLF-CRYPT
password_query = SELECT email AS user, password_hash AS password FROM mailbox_accounts WHERE LOWER(email) = LOWER('%u') AND active = true AND imap_enabled = true
user_query = SELECT 5000 AS uid, 5000 AS gid, '/var/vmail/' || split_part(email, '@', 2) || '/' || split_part(email, '@', 1) AS home FROM mailbox_accounts WHERE LOWER(email) = LOWER('%u') AND active = true
iterate_query = SELECT email AS username FROM mailbox_accounts WHERE active = true
EOF
chmod 0640 /etc/dovecot/mailcouse-sql.conf.ext
chown root:dovecot /etc/dovecot/mailcouse-sql.conf.ext

if grep -q '^MAILBOX_BACKEND=' "$ENV_FILE"; then
  sed -i 's/^MAILBOX_BACKEND=.*/MAILBOX_BACKEND=dovecot/' "$ENV_FILE"
else
  echo 'MAILBOX_BACKEND=dovecot' >>"$ENV_FILE"
fi
grep -q '^DOVECOT_LMTP_HOST=' "$ENV_FILE" || echo 'DOVECOT_LMTP_HOST=127.0.0.1' >>"$ENV_FILE"
grep -q '^DOVECOT_LMTP_PORT=' "$ENV_FILE" || echo 'DOVECOT_LMTP_PORT=24' >>"$ENV_FILE"

doveconf -n
systemctl enable dovecot
systemctl restart dovecot
ufw allow 143/tcp 2>/dev/null || true
ufw allow 993/tcp 2>/dev/null || true

echo 'Dovecot is installed. Export existing mail with:'
echo "  cd $APP_DIR && npx ts-node src/scripts/export-maildir.ts"
echo '  chown -R vmail:vmail /var/vmail'
echo 'Then restart the Mailcouse Node service so it releases IMAP ports and uses LMTP delivery.'

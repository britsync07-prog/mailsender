# Production IMAP service

The Node IMAP implementation is retained only for local development. Production
mailboxes must use Dovecot, which provides the full IMAP protocol expected by
Gmail, Outlook, Apple Mail, and Thunderbird.

Run the installer on the VPS as root after deploying this repository:

```bash
cd /opt/mailcouse
sudo bash deploy/dovecot/install.sh /opt/mailcouse
```

The installer creates a `vmail` user, configures Dovecot with PostgreSQL-backed
virtual users and Maildir storage, opens IMAP/IMAPS, and enables a local LMTP
listener. It reads database and TLS settings from the application's `.env` and
sets `MAILBOX_BACKEND=dovecot` so the Node process stops binding ports 143/993.

Existing messages stored in PostgreSQL must be exported to Maildir once before
the switchover:

```bash
cd /opt/mailcouse
sudo npx ts-node src/scripts/export-maildir.ts
sudo chown -R vmail:vmail /var/vmail
sudo systemctl restart dovecot
```

Finally restart the Mailcouse Node service. Incoming messages received by the
existing SMTP handler are then delivered to Dovecot through LMTP on localhost.

Never expose the LMTP port publicly. The installer binds it only to `127.0.0.1`.

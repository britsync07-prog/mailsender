import { CloudflareClient } from '../cloudflare/client';
import { query, closePool } from '../db/connection';
import { generateKeyPair, extractPublicKeyBase64 } from '../dkim/key-generator';
import { encryptPrivateKey } from '../dkim/key-store';
import { buildSPFRecord, buildDMARCRecord, buildMXRecord, buildDKIMRecordSpec } from '../dns/record-builder';

const TARGET_IP = '161.97.92.162';
const BOUNCE_HOST = 'live.noblecircle.online';

const DOMAINS = [
  { name: 'noblecircle.online',    zoneId: '47098ef7772397a7cee6c35186b945ca' },
  { name: 'exclusivesources.online', zoneId: 'e5da6c1e17f77ecdabef3da0049c5b10' },
];

async function main() {
  const cf = new CloudflareClient();
  console.log('=== DNS Provisioning ===\n');

  for (const zone of DOMAINS) {
    console.log(`--- ${zone.name} ---`);

    // 1. Ensure domain exists in DB
    let domainId: string;
    const existing = await query<{ id: string }>(
      'SELECT id FROM domains WHERE domain = $1',
      [zone.name]
    );
    if (existing.rows.length === 0) {
      const created = await query<{ id: string }>(
        `INSERT INTO domains (domain, registrar, cloudflare_zone_id, industry, status)
         VALUES ($1, 'cloudflare', $2, 'cybersecurity', 'provisioning')
         RETURNING id`,
        [zone.name, zone.zoneId]
      );
      domainId = created.rows[0].id;
      console.log(`  Domain created in DB with ID: ${domainId}`);
    } else {
      domainId = existing.rows[0].id;
      console.log(`  Domain exists in DB with ID: ${domainId}`);
    }

    // 2. Generate / reuse DKIM key pair
    let dkimSelector: string;
    let dkimPublicKeyBase64: string;

    const existingKey = await query<{ dkim_selector: string; dkim_private_key: string }>(
      'SELECT dkim_selector, dkim_private_key FROM subdomains WHERE domain_id = $1 AND dkim_private_key IS NOT NULL LIMIT 1',
      [domainId]
    );

    if (existingKey.rows.length > 0) {
      console.log(`  Reusing existing DKIM key (selector: ${existingKey.rows[0].dkim_selector})`);
      dkimSelector = existingKey.rows[0].dkim_selector;
      const regenerated = generateKeyPair(dkimSelector);
      dkimPublicKeyBase64 = extractPublicKeyBase64(regenerated.publicKey);
    } else {
      console.log(`  Generating new DKIM key pair...`);
      const key = generateKeyPair();
      dkimSelector = key.selector;
      dkimPublicKeyBase64 = extractPublicKeyBase64(key.publicKey);
      const encryptedKey = encryptPrivateKey(key.privateKey);

      await query(
        `UPDATE subdomains SET dkim_selector = $1, dkim_private_key = $2 WHERE domain_id = $3`,
        [dkimSelector, encryptedKey, domainId]
      );
      console.log(`  DKIM key stored (selector: ${dkimSelector})`);
    }

    // 3. DNS Records

    // Root A (proxied — for web dashboard)
    await cf.upsertDNSRecord(zone.zoneId, {
      type: 'A', name: zone.name, content: TARGET_IP, proxied: true, ttl: 120,
    });
    console.log('  A @ → (proxied)');

    // live A (non-proxied — SMTP endpoint)
    await cf.upsertDNSRecord(zone.zoneId, {
      type: 'A', name: `live.${zone.name}`, content: TARGET_IP, proxied: false, ttl: 120,
    });
    console.log(`  A live → (non-proxied)`);

    // Wildcard A (non-proxied — covers smtp001-200)
    await cf.upsertDNSRecord(zone.zoneId, {
      type: 'A', name: `*.${zone.name}`, content: TARGET_IP, proxied: false, ttl: 120,
    });
    console.log(`  A * → (non-proxied — wildcard)`);

    // SPF TXT
    const spfSpec = buildSPFRecord(zone.name, {
      ipAddresses: [TARGET_IP],
      policy: '~all',
    });
    await cf.upsertDNSRecord(zone.zoneId, {
      type: 'TXT', name: spfSpec.name, content: spfSpec.content, ttl: spfSpec.ttl,
    });
    console.log(`  TXT @ → SPF (ip4:${TARGET_IP})`);

    // DMARC TXT
    const dmarcSpec = buildDMARCRecord(zone.name, {
      policy: 'none',
      aggregateReportUri: `dmarc@${zone.name}`,
      percentage: 100,
    });
    await cf.upsertDNSRecord(zone.zoneId, {
      type: 'TXT', name: dmarcSpec.name, content: dmarcSpec.content, ttl: dmarcSpec.ttl,
    });
    console.log('  TXT _dmarc → DMARC (p=none)');

    // MX record (bounce handling)
    const mxSpec = buildMXRecord(zone.name, BOUNCE_HOST, 10);
    await cf.upsertDNSRecord(zone.zoneId, {
      type: 'MX', name: mxSpec.name, content: BOUNCE_HOST, ttl: mxSpec.ttl, priority: 10,
    });
    console.log(`  MX @ → 10 ${BOUNCE_HOST}`);

    // DKIM TXT record
    const dkimSpec = buildDKIMRecordSpec(zone.name, dkimSelector, dkimPublicKeyBase64);
    await cf.upsertDNSRecord(zone.zoneId, {
      type: 'TXT', name: dkimSpec.name, content: dkimSpec.content, ttl: dkimSpec.ttl,
    });
    console.log(`  TXT ${dkimSelector}._domainkey → DKIM public key`);

    // 4. Mark domain as provisioned
    await query(
      'UPDATE domains SET dns_provisioned = true, status = \'active\' WHERE id = $1',
      [domainId]
    );
    console.log(`  Domain ${zone.name} marked as provisioned.\n`);
  }

  console.log('✓ DNS provisioning complete.');
  console.log('7 records created per domain (A @, A live, A *, TXT SPF, TXT DMARC, MX, TXT DKIM)');
}

main()
  .catch((err) => {
    console.error('DNS provisioning failed:', err);
    process.exit(1);
  })
  .finally(() => {
    closePool().catch(() => {});
  });

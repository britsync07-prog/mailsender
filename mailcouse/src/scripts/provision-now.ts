import { CloudflareClient } from '../cloudflare/client';
import { generateKeyPair, extractPublicKeyBase64 } from '../dkim/key-generator';
import { encryptPrivateKey } from '../dkim/key-store';
import { config } from '../config';
import fs from 'fs';
import path from 'path';

const TARGET_IP = '161.97.92.162';
const BOUNCE_HOST = 'live.noblecircle.online';

const DOMAINS = [
  { name: 'noblecircle.online',    zoneId: '47098ef7772397a7cee6c35186b945ca' },
  { name: 'exclusivesources.online', zoneId: 'e5da6c1e17f77ecdabef3da0049c5b10' },
];

async function main() {
  const cf = new CloudflareClient();
  const keysOutput: Record<string, { selector: string; privateKeyEncrypted: string; publicKeyBase64: string }> = {};

  console.log('=== Creating DNS Records via Cloudflare API ===\n');

  for (const zone of DOMAINS) {
    console.log(`--- ${zone.name} ---`);

    // 1. Generate DKIM key pair
    console.log('  Generating DKIM key...');
    const dkimKey = generateKeyPair();
    const dkimPublicKeyBase64 = extractPublicKeyBase64(dkimKey.publicKey);
    const encryptedPrivateKey = encryptPrivateKey(dkimKey.privateKey);
    console.log(`  DKIM selector: ${dkimKey.selector}`);

    // 2. Root A (proxied — web dashboard)
    await cf.upsertDNSRecord(zone.zoneId, { type: 'A', name: zone.name, content: TARGET_IP, proxied: true, ttl: 120 });
    console.log('  ✅ A @ (proxied)');

    // 3. live A (non-proxied — SMTP endpoint)
    await cf.upsertDNSRecord(zone.zoneId, { type: 'A', name: `live.${zone.name}`, content: TARGET_IP, proxied: false, ttl: 120 });
    console.log('  ✅ A live (non-proxied)');

    // 4. Wildcard A (covers smtp001-200)
    await cf.upsertDNSRecord(zone.zoneId, { type: 'A', name: `*.${zone.name}`, content: TARGET_IP, proxied: false, ttl: 120 });
    console.log('  ✅ A * (wildcard)');

    // 5. SPF TXT
    await cf.upsertDNSRecord(zone.zoneId, { type: 'TXT', name: zone.name, content: `v=spf1 ip4:${TARGET_IP} ~all`, ttl: 300 });
    console.log('  ✅ TXT SPF');

    // 6. DMARC TXT
    await cf.upsertDNSRecord(zone.zoneId, { type: 'TXT', name: `_dmarc.${zone.name}`, content: `v=DMARC1; p=none; rua=mailto:dmarc@${zone.name}; pct=100`, ttl: 300 });
    console.log('  ✅ TXT DMARC');

    // 7. MX record
    await cf.upsertDNSRecord(zone.zoneId, { type: 'MX', name: zone.name, content: BOUNCE_HOST, ttl: 300, priority: 10 });
    console.log('  ✅ MX');

    // 8. DKIM TXT
    await cf.upsertDNSRecord(zone.zoneId, { type: 'TXT', name: `${dkimKey.selector}._domainkey.${zone.name}`, content: `v=DKIM1; k=rsa; p=${dkimPublicKeyBase64}`, ttl: 300 });
    console.log('  ✅ TXT DKIM');

    keysOutput[zone.name] = {
      selector: dkimKey.selector,
      privateKeyEncrypted: encryptedPrivateKey,
      publicKeyBase64: dkimPublicKeyBase64,
    };

    console.log('');
  }

  // Save DKIM keys to JSON file for later DB import
  const outPath = path.resolve(__dirname, '../../dkim-keys.json');
  fs.writeFileSync(outPath, JSON.stringify(keysOutput, null, 2));
  console.log(`\n✓ DKIM keys saved to: ${outPath}`);
  console.log('  Import into PostgreSQL later with: npm run seed');
  console.log('\n✓ DNS provisioning complete — 14 records created (7 per domain)');
  console.log('  All 400 subdomains resolve via wildcard A records.\n');
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});

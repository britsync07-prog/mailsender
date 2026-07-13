import { CloudflareClient } from '../cloudflare/client';
import { query, closePool } from '../db/connection';

const TARGET_IP = '161.97.92.162';
const DOMAINS = [
  { name: 'noblecircle.online',    zoneId: '47098ef7772397a7cee6c35186b945ca' },
  { name: 'exclusivesources.online', zoneId: 'e5da6c1e17f77ecdabef3da0049c5b10' },
];

function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

async function main() {
  const cf = new CloudflareClient();

  for (const zone of DOMAINS) {
    console.log(`\n=== ${zone.name} ===`);

    const existingRecords = await cf.listDNSRecords(zone.zoneId);
    const existingNames = new Set(existingRecords.map(r => r.name));

    let created = 0;
    let skipped = 0;

    for (let i = 1; i <= 200; i++) {
      const subdomain = `smtp${padNum(i, 3)}.${zone.name}`;

      if (existingNames.has(subdomain)) {
        skipped++;
        continue;
      }

      try {
        await cf.createDNSRecord(zone.zoneId, {
          type: 'A',
          name: subdomain,
          content: TARGET_IP,
          proxied: false,
          ttl: 120,
        });
        created++;
      } catch (err: any) {
        console.error(`  Failed ${subdomain}: ${err.message}`);
      }

      if (i % 50 === 0) {
        console.log(`  ${i}/200 processed (${created} created, ${skipped} skipped)`);
      }
    }

    console.log(`  Done: ${created} created, ${skipped} already exist`);
  }

  console.log('\nAll subdomain A records provisioned.');
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => closePool());

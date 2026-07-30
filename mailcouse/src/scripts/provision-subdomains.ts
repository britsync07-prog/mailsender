import { closePool, query } from '../db/connection';
import { provisionSubdomainBatch } from '../segmentation/subdomain-provisioner';

const TARGET_IP = process.env.TARGET_IP || '161.97.92.162';
const SUBDOMAIN_COUNT = parseInt(process.env.SUBDOMAIN_COUNT || '400');
const START_INDEX = parseInt(process.env.START_INDEX || '1');
const NAMING_SCHEME = process.env.NAMING_SCHEME || 'smtp';
const CREATE_DNS = process.env.CREATE_DNS === 'true';

async function main() {
  console.log(`Subdomain Provisioner
  Target IP: ${TARGET_IP}
  Per domain: ${SUBDOMAIN_COUNT} subdomains
  Naming: ${NAMING_SCHEME}XXX
  Create DNS: ${CREATE_DNS}
`);

  const domainResult = await query(
    'SELECT id, domain, cloudflare_zone_id FROM domains WHERE status = $1 ORDER BY created_at',
    ['active']
  );

  if (domainResult.rows.length === 0) {
    console.log('No active domains found. Creating default domain entry...');
    console.log('Please add a domain via the admin API first.');
    process.exit(1);
  }

  for (const domain of domainResult.rows) {
    console.log(`\n=== ${domain.domain} ===`);

    const result = await provisionSubdomainBatch({
      domainId: domain.id,
      rootDomain: domain.domain,
      cloudflareZoneId: domain.cloudflare_zone_id || undefined,
      count: SUBDOMAIN_COUNT,
      startIndex: START_INDEX,
      namingScheme: NAMING_SCHEME as any,
      targetIp: TARGET_IP,
      createDNS: CREATE_DNS && !!domain.cloudflare_zone_id,
    });

    console.log(`  Created: ${result.created}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Errors:  ${result.errors.length}`);
    if (result.errors.length > 0) {
      console.log(`  First error: ${result.errors[0]}`);
    }
  }

  const stats = await query(
    `SELECT d.domain, COUNT(s.id)::int as total,
            SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END)::int as active,
            SUM(CASE WHEN s.status = 'inactive' THEN 1 ELSE 0 END)::int as inactive
     FROM subdomains s JOIN domains d ON d.id = s.domain_id
     GROUP BY d.domain`
  );

  console.log('\n=== Summary ===');
  for (const row of stats.rows) {
    console.log(`  ${row.domain}: ${row.total} total, ${row.active} active, ${row.inactive} inactive`);
  }
}

main()
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  })
  .finally(() => closePool());
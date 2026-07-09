import { query } from './connection';

interface IndustryPoolRow {
  id: string;
  industry: string;
  domain: string;
  status: string;
  domain_id: string | null;
  assigned_at: Date;
}

interface SubdomainRow {
  id: string;
  domain_id: string;
}

interface DomainRow {
  id: string;
}

export async function migrateIndustryPools(): Promise<{
  domains_created: number;
  pools_linked: number;
  subdomains_remapped: number;
}> {
  let domainsCreated = 0;
  let poolsLinked = 0;
  let subdomainsRemapped = 0;

  // 1. Get all industry_domain_pools entries
  const pools = await query<IndustryPoolRow>(
    'SELECT * FROM industry_domain_pools ORDER BY assigned_at'
  );

  for (const pool of pools.rows) {
    // Check if a domains record already exists for this domain
    const existing = await query<DomainRow>(
      'SELECT id FROM domains WHERE domain = $1',
      [pool.domain]
    );

    let domainId: string;

    if (existing.rows.length === 0) {
      // Create new domains record
      const created = await query<DomainRow>(
        `INSERT INTO domains (id, domain, registrar, cloudflare_zone_id, industry, status, created_at)
         VALUES (uuid_generate_v4(), $1, 'migration', '', $2, $3, $4)
         RETURNING id`,
        [pool.domain, pool.industry, pool.status === 'active' ? 'active' : 'provisioning', pool.assigned_at]
      );
      domainId = created.rows[0].id;
      domainsCreated++;
    } else {
      domainId = existing.rows[0].id;
    }

    // 2. Link industry_domain_pools to domains
    if (pool.domain_id !== domainId) {
      await query(
        'UPDATE industry_domain_pools SET domain_id = $1 WHERE id = $2',
        [domainId, pool.id]
      );
      poolsLinked++;
    }
  }

  // 3. Remap subdomains that still point to old industry_domain_pools IDs
  const orphanedSubdomains = await query<SubdomainRow>(
    `SELECT s.id, s.domain_id
     FROM subdomains s
     LEFT JOIN domains d ON s.domain_id = d.id
     WHERE d.id IS NULL`
  );

  for (const sub of orphanedSubdomains.rows) {
    // Find the industry_domain_pools entry with this ID (old linkage)
    const pool = await query<{ domain_id: string | null }>(
      'SELECT domain_id FROM industry_domain_pools WHERE id = $1',
      [sub.domain_id]
    );

    if (pool.rows.length > 0 && pool.rows[0].domain_id) {
      await query(
        'UPDATE subdomains SET domain_id = $1 WHERE id = $2',
        [pool.rows[0].domain_id, sub.id]
      );
      subdomainsRemapped++;
    }
  }

  return { domains_created: domainsCreated, pools_linked: poolsLinked, subdomains_remapped: subdomainsRemapped };
}

async function main(): Promise<void> {
  console.log('[Migration] Starting industry_domain_pools → domains migration...');
  const result = await migrateIndustryPools();
  console.log(`[Migration] Complete: ${result.domains_created} domains created, ${result.pools_linked} pools linked, ${result.subdomains_remapped} subdomains remapped`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[Migration] Failed:', err);
    process.exit(1);
  });
}

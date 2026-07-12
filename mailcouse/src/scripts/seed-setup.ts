import { query, closePool } from '../db/connection';

const DOMAINS = [
  {
    name: 'noblecircle.online',
    zoneId: '47098ef7772397a7cee6c35186b945ca',
  },
  {
    name: 'exclusivesources.online',
    zoneId: 'e5da6c1e17f77ecdabef3da0049c5b10',
  },
];

const VPS_IP = '161.97.92.162';

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'Michael', 'Jennifer', 'David', 'Linda',
  'William', 'Elizabeth', 'Richard', 'Barbara', 'Joseph', 'Susan', 'Thomas', 'Jessica',
  'Christopher', 'Sarah', 'Charles', 'Karen', 'Daniel', 'Lisa', 'Matthew', 'Nancy',
  'Anthony', 'Betty', 'Mark', 'Margaret', 'Donald', 'Sandra', 'Steven', 'Ashley',
  'Paul', 'Kimberly', 'Andrew', 'Emily', 'Joshua', 'Donna', 'Kenneth', 'Michelle',
  'Kevin', 'Carol', 'Brian', 'Amanda', 'George', 'Dorothy', 'Timothy', 'Melissa',
  'Ronald', 'Deborah', 'Edward', 'Stephanie', 'Jason', 'Rebecca', 'Jeffrey', 'Sharon',
  'Ryan', 'Laura', 'Jacob', 'Cynthia', 'Gary', 'Kathleen', 'Nicholas', 'Amy',
  'Eric', 'Angela', 'Jonathan', 'Shirley', 'Stephen', 'Anna', 'Larry', 'Brenda',
  'Justin', 'Pamela', 'Scott', 'Emma', 'Brandon', 'Nicole', 'Benjamin', 'Helen',
  'Samuel', 'Samantha', 'Raymond', 'Katherine', 'Gregory', 'Christine', 'Frank', 'Debra',
  'Alexander', 'Rachel', 'Patrick', 'Carolyn', 'Jack', 'Janet', 'Dennis', 'Catherine',
  'Jerry', 'Maria', 'Tyler', 'Heather', 'Aaron', 'Diane', 'Jose', 'Ruth',
  'Nathan', 'Julie', 'Henry', 'Olivia', 'Douglas', 'Joyce', 'Peter', 'Victoria',
  'Adam', 'Kelly', 'Zachary', 'Christina', 'Walter', 'Lauren', 'Kyle', 'Megan',
  'Harold', 'Jacqueline', 'Carl', 'Teresa', 'Jeremy', 'Doris', 'Gerald', 'Kathryn',
  'Keith', 'Ann', 'Roger', 'Gloria', 'Arthur', 'Rose', 'Terry', 'Evelyn',
  'Lawrence', 'Jean', 'Sean', 'Cheryl', 'Christian', 'Mildred', 'Ethan', 'Andrea',
  'Austin', 'Martha', 'Joe', 'Diana', 'Albert', 'Beverly', 'Jesse', 'Olivia',
  'Willie', 'Theresa', 'Billy', 'Denise', 'Bryan', 'Tammy', 'Bruce', 'Irene',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young',
  'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell',
  'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz', 'Parker',
  'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales', 'Murphy',
  'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson', 'Bailey',
  'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
  'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza',
  'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers',
  'Long', 'Ross', 'Foster', 'Jimenez',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateSenderName(used: Set<string>): string {
  for (let attempt = 0; attempt < 500; attempt++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const name = `${first} ${last}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}-${Math.floor(Math.random() * 1000)}`;
}

function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

async function seed() {
  console.log('=== Seed Setup ===\n');

  const usedNames = new Set<string>();

  for (const domain of DOMAINS) {
    console.log(`--- Domain: ${domain.name} ---`);

    const domainResult = await query<{ id: string }>(
      `INSERT INTO domains (domain, registrar, cloudflare_zone_id, industry, status, dns_provisioned)
       VALUES ($1, 'cloudflare', $2, 'cybersecurity', 'provisioning', false)
       ON CONFLICT (domain) DO UPDATE SET cloudflare_zone_id = EXCLUDED.cloudflare_zone_id
       RETURNING id`,
      [domain.name, domain.zoneId]
    );
    const domainId = domainResult.rows[0].id;
    console.log(`  Domain ID: ${domainId}`);

    const existingCount = await query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM subdomains WHERE domain_id = $1',
      [domainId]
    );
    const already = parseInt(existingCount.rows[0].cnt, 10);
    if (already >= 200) {
      console.log(`  Already has ${already} subdomains, skipping.`);
      continue;
    }

    for (let i = 1; i <= 200; i++) {
      const padded = padNum(i, 3);
      const subdomainName = `smtp${padded}.${domain.name}`;
      const senderName = generateSenderName(usedNames);
      const dailyLimit = 3;

      await query(
        `INSERT INTO subdomains
         (domain_id, subdomain, sender_name, status, daily_limit, dns_verified, warmup_complete, emails_sent_today)
         VALUES ($1, $2, $3, 'warming', $4, false, false, 0)
         ON CONFLICT (subdomain) DO NOTHING`,
        [domainId, subdomainName, senderName, dailyLimit]
      );

      if (i % 50 === 0) {
        console.log(`  ${i}/200 subdomains created...`);
      }
    }
    console.log(`  200 subdomains seeded for ${domain.name}\n`);
  }

  // VDS server
  const vdsResult = await query<{ id: string }>(
    `INSERT INTO vds_servers (name, provider, ip_address, cpu, ram_gb, storage_gb, status)
     VALUES ('vps-main', 'linode', $1, 4, 8, 100, 'active')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [VPS_IP]
  );

  let vdsId: string;
  if (vdsResult.rows.length > 0) {
    vdsId = vdsResult.rows[0].id;
  } else {
    const existing = await query<{ id: string }>(
      'SELECT id FROM vds_servers WHERE ip_address = $1',
      [VPS_IP]
    );
    vdsId = existing.rows[0].id;
  }
  console.log(`VDS server ID: ${vdsId}`);

  // IP pool
  await query(
    `INSERT INTO ip_pool (ip_address, vds_server_id, status, blacklisted, priority, ptr_record)
     VALUES ($1, $2, 'active', false, 50, 'live.noblecircle.online')
     ON CONFLICT (ip_address) DO UPDATE SET
       vds_server_id = EXCLUDED.vds_server_id,
       status = 'active'`,
    [VPS_IP, vdsId]
  );
  console.log(`IP ${VPS_IP} added to pool.`);

  const ipResult = await query<{ id: string }>(
    'SELECT id FROM ip_pool WHERE ip_address = $1',
    [VPS_IP]
  );
  const ipId = ipResult.rows[0].id;

  const subdomainsWithoutIp = await query<{ id: string }>(
    'SELECT id FROM subdomains WHERE assigned_ip_id IS NULL'
  );
  for (const row of subdomainsWithoutIp.rows) {
    await query(
      'UPDATE subdomains SET assigned_ip_id = $1 WHERE id = $2',
      [ipId, row.id]
    );
  }
  console.log(`Linked ${subdomainsWithoutIp.rows.length} subdomains to IP pool.`);

  console.log('\n=== Seed complete! ===');
  console.log('2 domains, 400 subdomains, 1 VDS, 1 IP added.');
  console.log('Now run: npx ts-node src/scripts/provision-dns.ts');
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => closePool());

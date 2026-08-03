# Domain Connection and Subdomain Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audits and aligns the subdomain sending validation, normalizes DNS checks to support trailing dots, and integrates the Subdomains and Subdomain Pool views fully into the portal UI navigation.

**Architecture:** Refactors domain/subdomain lookup to resolve verified parents using a centralized database helper. Normalizes DNS records before comparison. Standardizes page EJS layout/navs to include Subdomains tabs.

**Tech Stack:** Node.js, Express, PostgreSQL, EJS, Jest

---

### Task 1: Refactor `domain-logic.ts` for Subdomain-Aware Lookups & DNS Normalization

**Files:**
- Modify: `src/api/domain-logic.ts`
- Test: Add a new unit test for parent-domain matching and DNS normalizations.

- [ ] **Step 1: Update `src/api/domain-logic.ts`**
  Add the `query` import at the top, implement the trailing-dot normalization in the MX/CNAME checks, and export the `findVerifiedDomainForAddress` helper.
  
  Replace lines 1-5:
  ```typescript
  import * as dns from 'dns';
  import { config } from '../config';
  import { query } from '../db/connection';
  ```

  Replace `checkMxRecords` and `checkReturnPathRecord` to normalize trailing dots:
  ```typescript
  export async function checkMxRecords(name: string): Promise<DNSStatus> {
    const records = await resolveMx(name);
    if (records.length === 0) {
      return { status: 'Missing', error: `There are no MX records for ${name}` };
    }
    const expected = config.dns.mxRecords.map((r) => r.toLowerCase().replace(/\.$/, ''));
    const present = records.map((r) => r.toLowerCase().replace(/\.$/, ''));
    const missing = expected.filter((r) => !present.includes(r));
    if (missing.length === 0) {
      return { status: 'OK', error: null };
    }
    if (missing.length === expected.length) {
      return { status: 'Missing', error: 'You have MX records but none of them point to us.' };
    }
    return {
      status: 'Invalid',
      error: `MX ${missing.length === 1 ? 'record' : 'records'} for ${missing.join(', ')} are missing and are required.`,
    };
  }

  export async function checkReturnPathRecord(name: string): Promise<DNSStatus> {
    const rpDomain = returnPathDomain(name);
    const records = await resolveCname(rpDomain);
    if (records.length === 0) {
      return { status: 'Missing', error: `There is no return path record at ${rpDomain}` };
    }
    const target = records[0].toLowerCase().replace(/\.$/, '');
    const expected = config.dns.returnPathDomain.toLowerCase().replace(/\.$/, '');
    if (target === expected) {
      return { status: 'OK', error: null };
    }
    return {
      status: 'Invalid',
      error: `There is a CNAME record at ${rpDomain} but it points to ${records[0]} which is incorrect. It should point to ${config.dns.returnPathDomain}.`,
    };
  }
  ```

  Add `findVerifiedDomainForAddress` at the bottom:
  ```typescript
  export async function findVerifiedDomainForAddress(
    domainOrEmail: string,
    orgId: string
  ): Promise<{ id: string; domain: string } | null> {
    const domainPart = domainOrEmail.includes('@') ? domainOrEmail.split('@')[1].toLowerCase().trim() : domainOrEmail.toLowerCase().trim();
    const parentDoms = parentDomains(domainPart);
    if (parentDoms.length === 0) return null;

    const placeholders = parentDoms.map((_, i) => `$${i + 2}`).join(', ');
    const result = await query<{ id: string; domain: string }>(
      `SELECT id, domain FROM customer_domains
       WHERE LOWER(domain) IN (${placeholders}) AND organization_id = $1 AND verified = true`,
      [orgId, ...parentDoms]
    );

    if (result.rows.length === 0) return null;
    const sorted = result.rows.sort((a, b) => b.domain.length - a.domain.length);
    return sorted[0];
  }
  ```

- [ ] **Step 2: Commit Task 1**
  ```bash
  git add src/api/domain-logic.ts
  git commit -m "feat: centralize subdomain matching and normalize trailing dots in DNS checks"
  ```

---

### Task 2: Integrate Subdomain Lookup into Portal Sending Routes

**Files:**
- Modify: `src/api/portal-routes.ts`

- [ ] **Step 1: Import the new helper at the top of `src/api/portal-routes.ts`**
  Add the import:
  ```typescript
  import {
    parentDomains,
    verificationEmailAddresses,
    generateVerificationToken,
    generateDKIMIdentifierString,
    spfRecord,
    dkimRecord,
    dkimRecordName,
    returnPathDomain,
    dnsVerificationString,
    checkDomainDNS,
    findVerifiedDomainForAddress,
  } from './domain-logic';
  ```

- [ ] **Step 2: Update `/send` endpoint to use subdomain-aware matching**
  Replace lines 275-283 in `src/api/portal-routes.ts`:
  ```typescript
    const customerDomain = await findVerifiedDomainForAddress(domainPart, orgId);
    if (!customerDomain) {
      return res.status(400).json({ error: `From domain ${domainPart} is not verified for this account` });
    }
  ```

- [ ] **Step 3: Commit Task 2**
  ```bash
  git add src/api/portal-routes.ts
  git commit -m "feat: use subdomain-aware resolver in portal email sending route"
  ```

---

### Task 3: Integrate Subdomain Lookup into SMTP Relay Server

**Files:**
- Modify: `src/smtp-relay.ts`

- [ ] **Step 1: Import `findVerifiedDomainForAddress` at the top of `src/smtp-relay.ts`**
  Add the import:
  ```typescript
  import { findVerifiedDomainForAddress } from './api/domain-logic';
  ```

- [ ] **Step 2: Update the `onData` handler to use subdomain-aware matching**
  Replace lines 122-131 in `src/smtp-relay.ts`:
  ```typescript
        const customerDomain = await findVerifiedDomainForAddress(domainPart, authUser.organizationId);
        if (!customerDomain) {
          return callback(new Error(`530 From domain ${domainPart} is not verified for this account`));
        }
  ```

- [ ] **Step 3: Commit Task 3**
  ```bash
  git add src/smtp-relay.ts
  git commit -m "feat: use subdomain-aware resolver in SMTP relay server domain validation"
  ```

---

### Task 4: Add Subdomains & Subdomain Pool to Main & Dashboard Navbar Layouts

**Files:**
- Modify: `src/views/partials/server-header.ejs`
- Modify: `src/views/dashboard.ejs`

- [ ] **Step 1: Add tabs to `src/views/partials/server-header.ejs`**
  Insert the subdomains navigation items into the `<nav class="navBar">` section (around lines 44-55):
  ```html
  <nav class="navBar">
    <ul>
      <li class="navBar__item"><a href="/portal/dashboard" class="navBar__link<%= activeNav === 'overview' ? ' is-active' : '' %>">Overview</a></li>
      <li class="navBar__item"><a href="/portal/messages" class="navBar__link<%= activeNav === 'messages' ? ' is-active' : '' %>">Messages</a></li>
      <li class="navBar__item"><a href="/portal/domains" class="navBar__link<%= activeNav === 'domains' ? ' is-active' : '' %>">Domains</a></li>
      <li class="navBar__item"><a href="/portal/subdomains" class="navBar__link<%= activeNav === 'subdomains' ? ' is-active' : '' %>">Subdomains</a></li>
      <li class="navBar__item"><a href="/portal/pool" class="navBar__link<%= activeNav === 'pool' ? ' is-active' : '' %>">Subdomain Pool</a></li>
      <li class="navBar__item"><a href="/portal/routes" class="navBar__link<%= activeNav === 'routing' ? ' is-active' : '' %>">Routing</a></li>
      <li class="navBar__item"><a href="/portal/credentials" class="navBar__link<%= activeNav === 'credentials' ? ' is-active' : '' %>">Credentials</a></li>
      <li class="navBar__item"><a href="/portal/webhooks" class="navBar__link<%= activeNav === 'webhooks' ? ' is-active' : '' %>">Webhooks</a></li>
      <li class="navBar__item"><a href="/portal/settings" class="navBar__link<%= activeNav === 'settings' ? ' is-active' : '' %>">Settings</a></li>
      <li class="navBar__item navBar__item--end"><a href="/portal/help/outgoing" class="navBar__link<%= activeNav === 'help' ? ' is-active' : '' %>">Help</a></li>
    </ul>
  </nav>
  ```

- [ ] **Step 2: Add tabs to `src/views/dashboard.ejs`**
  Insert the same navigation items into `src/views/dashboard.ejs` (around lines 44-55):
  ```html
  <nav class="navBar">
    <ul>
      <li class="navBar__item"><a href="/portal/dashboard" class="navBar__link is-active">Overview</a></li>
      <li class="navBar__item"><a href="/portal/messages" class="navBar__link">Messages</a></li>
      <li class="navBar__item"><a href="/portal/domains" class="navBar__link">Domains</a></li>
      <li class="navBar__item"><a href="/portal/subdomains" class="navBar__link">Subdomains</a></li>
      <li class="navBar__item"><a href="/portal/pool" class="navBar__link">Subdomain Pool</a></li>
      <li class="navBar__item"><a href="/portal/routes" class="navBar__link">Routing</a></li>
      <li class="navBar__item"><a href="/portal/credentials" class="navBar__link">Credentials</a></li>
      <li class="navBar__item"><a href="/portal/webhooks" class="navBar__link">Webhooks</a></li>
      <li class="navBar__item"><a href="/portal/settings" class="navBar__link">Settings</a></li>
      <li class="navBar__item navBar__item--end"><a href="/portal/help/outgoing" class="navBar__link">Help</a></li>
    </ul>
  </nav>
  ```

- [ ] **Step 3: Commit Task 4**
  ```bash
  git add src/views/partials/server-header.ejs src/views/dashboard.ejs
  git commit -m "ui: add Subdomains and Subdomain Pool navigation items to portals and dashboards"
  ```

---

### Task 5: Bind Server Header Stats and Embed Layout in Subdomains & Pool Views

**Files:**
- Modify: `src/index.ts`
- Modify: `src/views/subdomains.ejs`
- Modify: `src/views/pool.ejs`

- [ ] **Step 1: Update `/portal/subdomains` route in `src/index.ts`**
  Fetch and merge server header variables in the controller:
  ```typescript
  app.get('/portal/subdomains', async (req, res) => {
    const token = getToken(req);
    if (!token) return res.redirect('/login');
    try {
      const base = `http://localhost:${config.api.port}`;
      const [userRes, dataRes] = await Promise.all([
        fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${base}/api/portal/subdomains`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
      const userData = await userRes.json();
      const data = dataRes.ok ? await dataRes.json() : { subdomains: [] };
      const search = (req.query.search as string || '').toLowerCase();
      const filtered = data.subdomains.filter((s: any) => !search || s.subdomain.includes(search) || s.root_domain.includes(search));
      const header = await fetchServerHeader(token);
      res.render('subdomains', {
        layout: 'application',
        subdomains: filtered,
        title: 'Subdomains',
        activeNav: 'subdomains',
        email: userData.user?.email || '',
        token,
        search: req.query.search || '',
        ...header,
      });
    } catch { res.redirect('/login'); }
  });
  ```

- [ ] **Step 2: Update `/portal/pool` route in `src/index.ts`**
  Fetch and merge server header variables in the controller:
  ```typescript
  app.get('/portal/pool', async (req, res) => {
    const token = getToken(req);
    if (!token) return res.redirect('/login');
    try {
      const base = `http://localhost:${config.api.port}`;
      const [userRes, dataRes] = await Promise.all([
        fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${base}/api/portal/pool`, { headers: { 'Authorization': `Bearer ${token}` } }),
      ]);
      if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
      const userData = await userRes.json();
      const data = dataRes.ok ? await dataRes.json() : { pool: [] };
      const header = await fetchServerHeader(token);
      res.render('pool', {
        layout: 'application',
        ...data,
        title: 'Subdomain Pool',
        activeNav: 'pool',
        email: userData.user?.email || '',
        token,
        ...header,
      });
    } catch { res.redirect('/login'); }
  });
  ```

- [ ] **Step 3: Update `src/views/subdomains.ejs` to include server header**
  Replace the top lines of `src/views/subdomains.ejs` (lines 1-3) with the `server-header` include:
  ```html
  <%- include('partials/server-header', { activeNav: 'subdomains', serverMode, serverName, totalDomains, unverifiedDomains, badDnsDomains, heldMessages, queuedMessages, bounceRate, diskUsed, outgoingPct, outgoingMessages, incomingMessages, messageRate, sendLimit }) %>
  ```

- [ ] **Step 4: Update `src/views/pool.ejs` to include server header**
  Replace the top lines of `src/views/pool.ejs` (lines 1-6) with the `server-header` include:
  ```html
  <%- include('partials/server-header', { activeNav: 'pool', serverMode, serverName, totalDomains, unverifiedDomains, badDnsDomains, heldMessages, queuedMessages, bounceRate, diskUsed, outgoingPct, outgoingMessages, incomingMessages, messageRate, sendLimit }) %>
  ```

- [ ] **Step 5: Commit Task 5**
  ```bash
  git add src/index.ts src/views/subdomains.ejs src/views/pool.ejs
  git commit -m "ui: render server header with metrics on subdomains and pool views"
  ```

---

### Task 6: Verification

**Files:**
- Run: `npm run build` to verify TS compilation.
- Run: `npm test` to verify everything works and passes.

- [ ] **Step 1: Build project**
  Run: `npm run build`
  Expected: Successful compilation without TS errors.

- [ ] **Step 2: Run all tests**
  Run: `npm test`
  Expected: All 700+ tests pass successfully.

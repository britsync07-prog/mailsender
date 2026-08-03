# Spec: Domain Verification, Subdomain Relaying, and UI Navigation Alignment

This specification outlines the changes required to ensure that `mailcouse` behaves exactly like Postal for domain connection, verification, and mail sending, with enhanced support for sending from arbitrary subdomains of verified domains, and robust DNS record verification.

## 1. Subdomain Sending Permission & DKIM Signing
When sending an email (via Web UI/API or SMTP relay), the system must verify that the `From` address's domain is allowed.
*   **Behavior**:
    *   If `From: user@sub.example.com`, the system should allow sending if `sub.example.com` is verified, OR if `example.com` (or any other parent domain) is verified.
    *   If multiple parent/matching domains are verified, the most specific domain (the longest domain string) is chosen.
    *   The message will be signed with the DKIM key of the matched verified domain.
*   **Changes**:
    *   Add `findVerifiedDomainForAddress(email: string, orgId: string)` in `src/api/domain-logic.ts`.
    *   Update the `/send` endpoint in `src/api/portal-routes.ts` to use `findVerifiedDomainForAddress` to fetch the sending domain.
    *   Update the `onData` event handler in `src/smtp-relay.ts` to use `findVerifiedDomainForAddress`.

## 2. DNS Verification Trailing Dot Normalization
Ensure DNS check queries are immune to trailing dot variations returned by various name servers.
*   **Behavior**:
    *   Strip trailing dots from all CNAME target hostnames and MX exchanges before comparison.
*   **Changes**:
    *   Update `checkMxRecords` and `checkReturnPathRecord` in `src/api/domain-logic.ts` to normalize all hostnames by converting them to lowercase and removing trailing dots (`.replace(/\.$/, '')`).

## 3. UI Navigation & Headers for Subdomains & Pool
Integrate the orphaned Subdomains and Subdomain Pool views into the main navigation.
*   **Changes**:
    *   Update `src/views/partials/server-header.ejs` to include **Subdomains** (`/portal/subdomains`) and **Subdomain Pool** (`/portal/pool`) tabs in the `<nav class="navBar">` list.
    *   Update the inline navbar in `src/views/dashboard.ejs` to include these same tabs.
    *   Modify `/portal/subdomains` and `/portal/pool` endpoints in `src/index.ts` to fetch and render the server header statistics.
    *   Prepend `<%- include('partials/server-header', { ... }) %>` at the top of `src/views/subdomains.ejs` and `src/views/pool.ejs`.

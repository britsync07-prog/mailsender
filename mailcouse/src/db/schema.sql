-- Database schema for mailcouse — full TSD v3.0 compliant

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- DOMAINS (TSD §7.1 — was missing entirely)
-- ============================================================
CREATE TABLE IF NOT EXISTS domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    registrar VARCHAR(100) NOT NULL,
    cloudflare_zone_id VARCHAR(100) NOT NULL,
    dns_provisioned BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'provisioning',
    industry VARCHAR(50) NOT NULL,
    warmup_started_at TIMESTAMP,
    activated_at TIMESTAMP,
    postmaster_score INTEGER,
    complaint_rate_7d DECIMAL(6,4) DEFAULT 0,
    bounce_rate_7d DECIMAL(6,4) DEFAULT 0,
    total_sent BIGINT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP,
    retired_at TIMESTAMP,
    retirement_reason VARCHAR(200),
    last_checked TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
CREATE INDEX IF NOT EXISTS idx_domains_status ON domains(status);
CREATE INDEX IF NOT EXISTS idx_domains_industry ON domains(industry);
CREATE INDEX IF NOT EXISTS idx_domains_postmaster_score ON domains(postmaster_score);

-- ============================================================
-- INDUSTRY DOMAIN POOLS (kept for backward compat, linked to domains)
-- ============================================================
CREATE TABLE IF NOT EXISTS industry_domain_pools (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID REFERENCES domains(id) ON DELETE CASCADE,
    industry VARCHAR(50) NOT NULL,
    domain VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'warming',
    assigned_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_industry_domain_pools_domain_id ON industry_domain_pools(domain_id);
CREATE INDEX IF NOT EXISTS idx_industry_domain_pools_industry ON industry_domain_pools(industry);
CREATE INDEX IF NOT EXISTS idx_industry_domain_pools_domain ON industry_domain_pools(domain);
CREATE INDEX IF NOT EXISTS idx_industry_domain_pools_status ON industry_domain_pools(status);

-- ============================================================
-- SUBDOMAINS (TSD §7.2 — fixed: added missing columns)
-- ============================================================
CREATE TABLE IF NOT EXISTS subdomains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id UUID NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    subdomain VARCHAR(255) NOT NULL UNIQUE,
    dkim_selector VARCHAR(50),
    dkim_private_key TEXT,
    dns_verified BOOLEAN NOT NULL DEFAULT false,
    sender_name VARCHAR(100) NOT NULL,
    warmup_complete BOOLEAN NOT NULL DEFAULT false,
    warmup_started_at TIMESTAMP,
    daily_limit INTEGER NOT NULL DEFAULT 3,
    emails_sent_today INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'provisioning',
    assigned_ip_id UUID,
    total_sent INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    open_count INTEGER NOT NULL DEFAULT 0,
    complaint_count INTEGER NOT NULL DEFAULT 0,
    bounce_count INTEGER NOT NULL DEFAULT 0,
    bounce_rate DECIMAL(6,4) DEFAULT 0,
    engagement_score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subdomains_domain_id ON subdomains(domain_id);
CREATE INDEX IF NOT EXISTS idx_subdomains_subdomain ON subdomains(subdomain);
CREATE INDEX IF NOT EXISTS idx_subdomains_status ON subdomains(status);
CREATE INDEX IF NOT EXISTS idx_subdomains_warmup_complete ON subdomains(warmup_complete);
CREATE INDEX IF NOT EXISTS idx_subdomains_engagement_score ON subdomains(engagement_score);

-- ============================================================
-- LEADS (TSD §7.3 — added purchase_date, unsubscribed_at)
-- ============================================================
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(320) NOT NULL UNIQUE,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company VARCHAR(200),
    job_title VARCHAR(200),
    industry VARCHAR(50) NOT NULL,
    pain_point VARCHAR(500),
    source VARCHAR(100) NOT NULL,
    validated BOOLEAN NOT NULL DEFAULT false,
    validation_result VARCHAR(50),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    send_count INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    open_count INTEGER NOT NULL DEFAULT 0,
    click_count INTEGER NOT NULL DEFAULT 0,
    last_sent_at TIMESTAMP,
    replied_at TIMESTAMP,
    unsubscribed_at TIMESTAMP,
    purchase_date TIMESTAMP,
    engagement_score INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_industry ON leads(industry);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_validated ON leads(validated);
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON leads(created_at);

-- ============================================================
-- SUPPRESSION LIST (TSD §7.4)
-- ============================================================
CREATE TABLE IF NOT EXISTS suppression_list (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(320) NOT NULL UNIQUE,
    reason VARCHAR(50) NOT NULL,
    suppressed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    source_subdomain_id UUID REFERENCES subdomains(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_suppression_email ON suppression_list(email);
CREATE INDEX IF NOT EXISTS idx_suppression_reason ON suppression_list(reason);
CREATE INDEX IF NOT EXISTS idx_suppression_suppressed_at ON suppression_list(suppressed_at);

CREATE TABLE IF NOT EXISTS suppression_removals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(320) NOT NULL,
    removed_by VARCHAR(100) NOT NULL,
    removed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppression_removals_email ON suppression_removals(email);
CREATE INDEX IF NOT EXISTS idx_suppression_removals_removed_at ON suppression_removals(removed_at);

-- ============================================================
-- IP POOL (TSD §7.5)
-- ============================================================
CREATE TABLE IF NOT EXISTS vds_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    cpu INTEGER NOT NULL,
    ram_gb INTEGER NOT NULL,
    storage_gb INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vds_servers_provider ON vds_servers(provider);
CREATE INDEX IF NOT EXISTS idx_vds_servers_status ON vds_servers(status);

CREATE TABLE IF NOT EXISTS ip_pool (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ip_address INET NOT NULL UNIQUE,
    vds_server_id UUID NOT NULL REFERENCES vds_servers(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    blacklisted BOOLEAN NOT NULL DEFAULT false,
    last_blacklist_check TIMESTAMP,
    emails_today INTEGER NOT NULL DEFAULT 0,
    ptr_record VARCHAR(255) NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 50,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ip_pool_vds_server_id ON ip_pool(vds_server_id);
CREATE INDEX IF NOT EXISTS idx_ip_pool_status ON ip_pool(status);
CREATE INDEX IF NOT EXISTS idx_ip_pool_blacklisted ON ip_pool(blacklisted);
CREATE INDEX IF NOT EXISTS idx_ip_pool_priority ON ip_pool(priority);

-- ============================================================
-- SEND JOBS (TSD §7.6)
-- ============================================================
CREATE TABLE IF NOT EXISTS send_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    subdomain_id UUID NOT NULL REFERENCES subdomains(id) ON DELETE CASCADE,
    ip_id UUID NOT NULL REFERENCES ip_pool(id) ON DELETE CASCADE,
    template_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'queued',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    smtp_response VARCHAR(500),
    queued_at TIMESTAMP NOT NULL DEFAULT NOW(),
    scheduled_at TIMESTAMP,
    sent_at TIMESTAMP,
    failed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_send_jobs_lead_id ON send_jobs(lead_id);
CREATE INDEX IF NOT EXISTS idx_send_jobs_subdomain_id ON send_jobs(subdomain_id);
CREATE INDEX IF NOT EXISTS idx_send_jobs_status ON send_jobs(status);
CREATE INDEX IF NOT EXISTS idx_send_jobs_queued_at ON send_jobs(queued_at);
CREATE INDEX IF NOT EXISTS idx_send_jobs_sent_at ON send_jobs(sent_at);
CREATE INDEX IF NOT EXISTS idx_send_jobs_scheduled_at ON send_jobs(scheduled_at);

-- ============================================================
-- RDP INSTANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS rdp_instances (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    machine_id VARCHAR(100) NOT NULL UNIQUE,
    public_ip VARCHAR(45) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'starting',
    last_heartbeat TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    jobs_failed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rdp_instances_machine_id ON rdp_instances(machine_id);
CREATE INDEX IF NOT EXISTS idx_rdp_instances_status ON rdp_instances(status);
CREATE INDEX IF NOT EXISTS idx_rdp_instances_last_heartbeat ON rdp_instances(last_heartbeat);

-- ============================================================
-- TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    industry VARCHAR(50) NOT NULL,
    subject_spintax TEXT NOT NULL,
    body_spintax TEXT NOT NULL,
    format VARCHAR(20) NOT NULL DEFAULT 'plain',
    length_tier VARCHAR(20) NOT NULL DEFAULT 'medium',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);
CREATE INDEX IF NOT EXISTS idx_templates_industry ON templates(industry);
CREATE INDEX IF NOT EXISTS idx_templates_version ON templates(version);

-- ============================================================
-- IMPORT BATCHES
-- ============================================================
CREATE TABLE IF NOT EXISTS import_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source VARCHAR(100) NOT NULL,
    industry VARCHAR(50),
    total_received INTEGER NOT NULL,
    total_imported INTEGER NOT NULL,
    total_duplicates INTEGER NOT NULL DEFAULT 0,
    total_invalid INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP NOT NULL,
    duration_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_batches_source ON import_batches(source);
CREATE INDEX IF NOT EXISTS idx_import_batches_started_at ON import_batches(started_at);

-- ============================================================
-- CONTAMINATION ALERTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contamination_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    lead_industry VARCHAR(50) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    domain_industry VARCHAR(50) NOT NULL,
    detected_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contamination_alerts_lead_id ON contamination_alerts(lead_id);
CREATE INDEX IF NOT EXISTS idx_contamination_alerts_detected_at ON contamination_alerts(detected_at);

-- ============================================================
-- ENGAGEMENT EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    subdomain_id UUID REFERENCES subdomains(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_lead_id ON engagement_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_engagement_events_event_type ON engagement_events(event_type);
CREATE INDEX IF NOT EXISTS idx_engagement_events_created_at ON engagement_events(created_at);
CREATE INDEX IF NOT EXISTS idx_engagement_events_subdomain_id ON engagement_events(subdomain_id);

-- ============================================================
-- NEW: BOUNCE EVENTS (was missing - referenced by bounce/handler.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS bounce_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient VARCHAR(320) NOT NULL,
    bounce_type VARCHAR(50) NOT NULL,
    smtp_code INTEGER,
    diagnostic_code VARCHAR(200),
    message TEXT,
    subdomain_id UUID REFERENCES subdomains(id) ON DELETE SET NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bounce_events_recipient ON bounce_events(recipient);
CREATE INDEX IF NOT EXISTS idx_bounce_events_bounce_type ON bounce_events(bounce_type);
CREATE INDEX IF NOT EXISTS idx_bounce_events_timestamp ON bounce_events(timestamp);

-- ============================================================
-- NEW: COMPLAINT EVENTS (was missing - referenced by complaint/handler.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS complaint_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    complained_address VARCHAR(320) NOT NULL,
    source_ip VARCHAR(45),
    source_domain VARCHAR(255),
    source VARCHAR(50) NOT NULL,
    subdomain_id UUID REFERENCES subdomains(id) ON DELETE SET NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complaint_events_complained_address ON complaint_events(complained_address);
CREATE INDEX IF NOT EXISTS idx_complaint_events_timestamp ON complaint_events(timestamp);

-- ============================================================
-- NEW: REPLY EVENTS (was missing - referenced by reply/processor.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS reply_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    subdomain_id UUID REFERENCES subdomains(id) ON DELETE SET NULL,
    message_id VARCHAR(255),
    subject TEXT,
    body TEXT,
    from_address VARCHAR(320),
    classification VARCHAR(50) NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reply_events_lead_id ON reply_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_reply_events_classification ON reply_events(classification);
CREATE INDEX IF NOT EXISTS idx_reply_events_timestamp ON reply_events(timestamp);

-- ============================================================
-- NEW: CRM ENTRIES (was missing - referenced by crm-forwarder.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    lead_email VARCHAR(320) NOT NULL,
    reply_subject TEXT,
    reply_body TEXT,
    reply_from VARCHAR(320),
    reply_timestamp TIMESTAMP,
    subdomain_id UUID REFERENCES subdomains(id) ON DELETE SET NULL,
    forwarded BOOLEAN NOT NULL DEFAULT false,
    forwarded_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_entries_lead_id ON crm_entries(lead_id);
CREATE INDEX IF NOT EXISTS idx_crm_entries_forwarded ON crm_entries(forwarded);

-- ============================================================
-- NEW: DEAD LETTER (was missing - referenced by response/dead-letter.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS dead_letter (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL,
    lead_id UUID NOT NULL,
    last_response_code INTEGER,
    last_response_message TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    reason VARCHAR(255),
    moved_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_job_id ON dead_letter(job_id);
CREATE INDEX IF NOT EXISTS idx_dead_letter_moved_at ON dead_letter(moved_at);

-- ============================================================
-- NEW: SUBDOMAIN EVENTS (was missing - referenced by pauser.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS subdomain_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subdomain_id UUID NOT NULL REFERENCES subdomains(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subdomain_events_subdomain_id ON subdomain_events(subdomain_id);
CREATE INDEX IF NOT EXISTS idx_subdomain_events_event_type ON subdomain_events(event_type);
CREATE INDEX IF NOT EXISTS idx_subdomain_events_created_at ON subdomain_events(created_at);

-- ============================================================
-- NEW: DAILY STATS (was missing - referenced by midnight-reset.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL UNIQUE,
    total_sent INTEGER NOT NULL DEFAULT 0,
    total_bounces INTEGER NOT NULL DEFAULT 0,
    total_complaints INTEGER NOT NULL DEFAULT 0,
    total_replies INTEGER NOT NULL DEFAULT 0,
    archived_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);

-- ============================================================
-- NEW: REPORT LOGS (was missing - referenced by daily/weekly report)
-- ============================================================
CREATE TABLE IF NOT EXISTS report_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_type VARCHAR(50) NOT NULL,
    report_date DATE NOT NULL UNIQUE,
    report_data JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_logs_report_type ON report_logs(report_type);
CREATE INDEX IF NOT EXISTS idx_report_logs_report_date ON report_logs(report_date);

-- ============================================================
-- NEW: WEEKLY REPORTS (was missing - referenced by report-generator.ts)
-- ============================================================
CREATE TABLE IF NOT EXISTS weekly_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    week_start DATE NOT NULL,
    week_end DATE NOT NULL,
    report_data JSONB,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_week_start ON weekly_reports(week_start);

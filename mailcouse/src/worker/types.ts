// Worker types and interfaces for Plan 9

export type WorkerStatus = 'starting' | 'running' | 'draining' | 'stopped' | 'error';

export interface WorkerConfig {
  machine_id: string;
  public_ip: string;
  provider: string;
  concurrency: number; // Max simultaneous jobs (default: 50)
  heartbeat_interval_ms: number; // Default: 60000 (60 seconds)
  poll_interval_ms: number; // Default: 1000 (1 second)
}

export interface WorkerInstance {
  id: string;
  machine_id: string;
  public_ip: string;
  provider: string;
  status: WorkerStatus;
  last_heartbeat: Date;
  started_at: Date;
  jobs_processed: number;
  jobs_failed: number;
}

export interface JobProcessingResult {
  job_id: string;
  success: boolean;
  action: 'sent' | 'requeued' | 'suppressed' | 'failed';
  error?: string;
  smtp_response?: string;
  duration_ms: number;
}

export interface WorkerHeartbeat {
  worker_id: string;
  timestamp: Date;
  status: WorkerStatus;
  jobs_processed: number;
  jobs_failed: number;
}

export interface DrainResult {
  worker_id: string;
  in_progress_jobs: number;
  drain_time_ms: number;
  success: boolean;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  machine_id: '',
  public_ip: '',
  provider: 'unknown',
  concurrency: 50,
  heartbeat_interval_ms: 60000,
  poll_interval_ms: 1000,
};

// Anti-fingerprinting User-Agent strings
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
];

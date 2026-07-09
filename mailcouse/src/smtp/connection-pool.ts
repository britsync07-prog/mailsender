import * as net from 'net';
import * as tls from 'tls';
import { SMTPConfig, DEFAULT_SMTP_CONFIG } from './types';

interface PooledSocket {
  ip_id: string;
  ip_address: string;
  socket: net.Socket;
  host: string;
  port: number;
  secure: boolean;
  connected_at: Date;
  last_used: Date;
  is_healthy: boolean;
}

const pool = new Map<string, PooledSocket[]>();

export async function connect(
  host: string,
  port: number,
  ipId: string,
  ipAddress: string,
  config: SMTPConfig = DEFAULT_SMTP_CONFIG,
  useTls: boolean = false
): Promise<PooledSocket> {
  const existing = getExistingConnection(host, port, ipId);
  if (existing) {
    return existing;
  }

  return new Promise((resolve, reject) => {
    const rawSocket = new net.Socket();
    rawSocket.setTimeout(config.timeout_ms);

    const onError = (err: Error) => {
      cleanup(rawSocket);
      reject(err);
    };

    rawSocket.once('error', onError);
    rawSocket.once('timeout', () => {
      cleanup(rawSocket);
      reject(new Error('Connection timeout'));
    });

    rawSocket.connect(port, host, () => {
      rawSocket.removeListener('error', onError);

      let finalSocket: net.Socket = rawSocket;

      const doAdd = () => {
        const entry: PooledSocket = {
          ip_id: ipId,
          ip_address: ipAddress,
          socket: finalSocket,
          host,
          port,
          secure: useTls,
          connected_at: new Date(),
          last_used: new Date(),
          is_healthy: true,
        };
        addToPool(entry);
        resolve(entry);
      };

      if (useTls) {
        const tlsSocket = tls.connect({ socket: rawSocket, rejectUnauthorized: false }, () => {
          finalSocket = tlsSocket;
          doAdd();
        });
        tlsSocket.once('error', (err) => {
          cleanup(rawSocket);
          reject(err);
        });
      } else {
        doAdd();
      }
    });
  });
}

export function release(socket: PooledSocket, healthy: boolean = true): void {
  socket.is_healthy = healthy;
  socket.last_used = new Date();
}

export function remove(ipId: string, ipAddress: string, host: string): void {
  const key = `${ipId}:${ipAddress}`;
  const connections = pool.get(key) || [];
  const filtered = connections.filter((c) => c.host !== host);
  if (filtered.length === 0) {
    pool.delete(key);
  } else {
    pool.set(key, filtered);
  }
}

export function destroyAll(): void {
  for (const [, connections] of pool.entries()) {
    for (const c of connections) {
      cleanup(c.socket);
    }
  }
  pool.clear();
}

export function cleanStale(maxAgeMs: number = 300000): number {
  let removed = 0;
  const now = Date.now();

  for (const [key, connections] of pool.entries()) {
    const filtered = connections.filter((c) => {
      const age = now - c.last_used.getTime();
      if (age > maxAgeMs || !c.is_healthy) {
        cleanup(c.socket);
        removed++;
        return false;
      }
      return true;
    });
    if (filtered.length === 0) {
      pool.delete(key);
    } else {
      pool.set(key, filtered);
    }
  }

  return removed;
}

export function getPoolStats(): { total: number; healthy: number } {
  let total = 0;
  let healthy = 0;
  for (const [, connections] of pool.entries()) {
    total += connections.length;
    healthy += connections.filter((c) => c.is_healthy).length;
  }
  return { total, healthy };
}

function getExistingConnection(host: string, port: number, ipId: string): PooledSocket | undefined {
  for (const [, connections] of pool.entries()) {
    const found = connections.find(
      (c) => c.host === host && c.port === port && c.ip_id === ipId && c.is_healthy
    );
    if (found) {
      found.last_used = new Date();
      return found;
    }
  }
  return undefined;
}

function addToPool(entry: PooledSocket): void {
  const key = `${entry.ip_id}:${entry.ip_address}`;
  const connections = pool.get(key) || [];
  connections.push(entry);
  pool.set(key, connections);
}

function cleanup(s: net.Socket): void {
  try { s.destroy(); } catch {}
}

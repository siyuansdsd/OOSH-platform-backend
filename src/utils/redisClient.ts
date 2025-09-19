import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

let client: RedisClientType | null = null;

function buildUrl() {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT || '6379';
  const pwd = process.env.REDIS_PASSWORD;
  const tls = process.env.REDIS_TLS === 'true';
  const protocol = tls ? 'rediss' : 'redis';
  return pwd
    ? `${protocol}://${encodeURIComponent(pwd)}@${host}:${port}`
    : `${protocol}://${host}:${port}`;
}

export function getRedisClient(): RedisClientType {
  if (client) return client;
  const url = buildUrl();
  const tlsEnabled = process.env.REDIS_TLS === 'true';
  const opts: any = { url };
  if (tlsEnabled) opts.socket = { tls: true, rejectUnauthorized: false };
  client = createClient(opts);
  client.on('error', (err: unknown) => console.error('Redis client error', err));
  // connect lazily
  client.connect().catch((err: unknown) => console.error('Redis connect error', err));
  return client;
}

export async function redisSet(key: string, value: string, ttlSeconds?: number) {
  const c = getRedisClient();
  if (ttlSeconds) return c.set(key, value, { EX: ttlSeconds });
  return c.set(key, value);
}

export async function redisGet(key: string) {
  const c = getRedisClient();
  return c.get(key);
}

export async function redisDel(key: string) {
  const c = getRedisClient();
  return c.del(key);
}

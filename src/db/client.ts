import pkg from 'pg';
import type { Pool as PoolType } from 'pg';

const { Pool } = pkg;

let pool: PoolType | null = null;

/** Returns a pooled Postgres client, or null when DATABASE_URL is unset (persistence is optional). */
export function getPool(): PoolType | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

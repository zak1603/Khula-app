import 'server-only';
import { z } from 'zod';

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  RATE_LIMIT_PEPPER: z.string().min(16).default('dev-only-pepper-change-me'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

let cached: z.infer<typeof serverSchema> | null = null;

/** Lazily validated so builds don't need secrets; fails loudly on first use. */
export function serverEnv() {
  cached ??= serverSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    RATE_LIMIT_PEPPER: process.env.RATE_LIMIT_PEPPER,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (cached.NODE_ENV === 'production' && cached.RATE_LIMIT_PEPPER.startsWith('dev-only')) {
    throw new Error('RATE_LIMIT_PEPPER must be set in production');
  }
  return cached;
}

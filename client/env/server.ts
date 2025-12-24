import { config } from 'dotenv';
import { expand } from 'dotenv-expand';
import { z } from 'zod';

expand(config());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']),
  NEXT_PUBLIC_PEER_HOST: z.string(),
  NEXT_PUBLIC_PEER_PORT: z.string(),
  NEXT_PUBLIC_PEER_PATH: z.string(),
  NEXT_PUBLIC_PEER_SECURE: z.stringbool(),
  NEXT_PUBLIC_STUN_URL: z.string(),
  NEXT_PUBLIC_STUN_USERNAME: z.string(),
  NEXT_PUBLIC_STUN_CREDENTIAL: z.string(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error(z.treeifyError(parsed.error).properties);
  process.exit(1);
}

export const env = parsed.data;

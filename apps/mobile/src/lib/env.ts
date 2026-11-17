import { z } from 'zod';

const schema = z.object({
  supabaseUrl: z.url(),
  supabaseAnonKey: z.string().min(20),
  apiUrl: z.url(),
});

// EXPO_PUBLIC_* must be referenced literally so Metro can inline them.
export const env = schema.parse({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
});

if (!__DEV__ && !env.apiUrl.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_API_URL must use HTTPS in production builds');
}

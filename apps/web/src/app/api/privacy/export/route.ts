/** GET /api/privacy/export — POPIA s23 right of access (self-service). */
import { NextResponse } from 'next/server';
import { getRequestAuth } from '@/lib/supabase/server';
import { dbError, enforceLimit, jsonError } from '@/lib/server/api';

export async function GET(request: Request) {
  const { supabase, user } = await getRequestAuth(request);
  if (!user) return jsonError('AUTH_REQUIRED', 401);

  const limited = await enforceLimit('privacy', `export:${user.id}`);
  if (limited) return limited;

  const { data, error } = await supabase.rpc('export_client_data', {});
  if (error) return dbError(error);

  return new NextResponse(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="khula-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

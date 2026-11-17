import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DashboardShell } from '@/components/dashboard/shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');

  const { data: profile } = await supabase.from('profiles').select('full_name, role').eq('id', user.id).single();
  if (!profile || profile.role === 'client') {
    // Clients use the mobile app; the dashboard is for providers.
    redirect('/login?error=providers_only');
  }

  return (
    <DashboardShell userName={profile.full_name ?? user.email ?? 'Account'} role={profile.role}>
      {children}
    </DashboardShell>
  );
}

'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { BarChart3, CalendarDays, LogOut, Sprout, Tags, Users } from 'lucide-react';
import type { UserRole } from '@khula/shared';
import { useBusinesses } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Select, Skeleton } from '@/components/ui/primitives';
import { BeadStripe } from '@/components/ui/bead-stripe';
import { CreateBusinessForm } from './create-business-form';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: BarChart3 },
  { href: '/dashboard/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/dashboard/services', label: 'Services & Quotes', icon: Tags },
  { href: '/dashboard/staff', label: 'Staff & Commission', icon: Users },
];

export function DashboardShell({ children, userName, role }: { children: React.ReactNode; userName: string; role: UserRole }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: businesses, isLoading } = useBusinesses();
  const businessId = useDashboardStore((s) => s.businessId);
  const setBusinessId = useDashboardStore((s) => s.setBusinessId);

  // Keep the persisted selection valid (e.g. after losing access to a business).
  useEffect(() => {
    if (!businesses?.length) return;
    if (!businessId || !businesses.some((b) => b.id === businessId)) setBusinessId(businesses[0]!.id);
  }, [businesses, businessId, setBusinessId]);

  async function signOut() {
    await fetch('/api/auth/sign-out', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sand-200 bg-white md:flex">
        <BeadStripe className="mx-5 mt-4 h-0.5" />
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-900">
            <Sprout className="h-4 w-4 text-sun-400" aria-hidden />
          </span>
          <span className="text-lg font-extrabold tracking-tight">Khula</span>
          <span className="rounded bg-sun-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-sun-800">Business</span>
        </div>

        <div className="px-4 pb-4">
          {isLoading ? (
            <Skeleton className="h-10" />
          ) : businesses && businesses.length > 1 ? (
            <Select aria-label="Business" value={businessId ?? ''} onChange={(e) => setBusinessId(e.target.value)}>
              {businesses.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="truncate text-sm font-medium text-ink-muted">{businesses?.[0]?.name}</p>
          )}
        </div>

        <nav className="flex-1 space-y-1 px-3" aria-label="Dashboard">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/dashboard' ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium',
                  active ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:bg-sand-50 hover:text-ink',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sand-100 p-4">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="text-xs capitalize text-ink-subtle">{role.replace('_', ' ')}</p>
          <button onClick={signOut} className="mt-3 flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-sand-200 bg-white px-3 py-2 md:hidden" aria-label="Dashboard">
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-ink-muted aria-[current=page]:bg-brand-50 aria-[current=page]:text-brand-700" aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="mx-auto max-w-7xl p-4 md:p-8">
          {!isLoading && businesses?.length === 0 && role !== 'staff' ? <CreateBusinessForm /> : children}
        </div>
      </main>
    </div>
  );
}

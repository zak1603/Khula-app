'use client';

import Link from 'next/link';
import { Activity, CalendarCheck2, Clock, Gauge, Inbox, Wallet } from 'lucide-react';
import { formatDate, formatTime, formatZar, formatZarCompact, toSaDate, type DashboardStats } from '@khula/shared';
import { useDashboardStats, useRealtimeAppointments, useUpcomingAppointments } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Card, CardHeader, EmptyState, ErrorNotice, Skeleton, StatusBadge } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export function AnalyticsOverview() {
  const businessId = useDashboardStore((s) => s.businessId);
  const today = toSaDate();
  const stats = useDashboardStats(businessId, today);
  const upcoming = useUpcomingAppointments(businessId);
  useRealtimeAppointments(businessId);

  const s = stats.data;
  const isOwnerView = s?.revenue_today_cents !== null && s?.revenue_today_cents !== undefined;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Today</h1>
        <p className="text-sm text-ink-muted">{formatDate(new Date())} · updates live as bookings change</p>
      </header>

      <ErrorNotice error={stats.error} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key metrics">
        <KpiCard
          loading={stats.isLoading}
          icon={<Wallet className="h-5 w-5" />}
          label="Today's revenue"
          value={isOwnerView ? formatZar(s!.revenue_today_cents) : '—'}
          sub={isOwnerView ? `${formatZar(s!.scheduled_revenue_cents)} booked · ${formatZar(s!.collected_today_cents)} collected` : 'Visible to owners only'}
        />
        <KpiCard
          loading={stats.isLoading}
          icon={<CalendarCheck2 className="h-5 w-5" />}
          label="Active bookings"
          value={String(s?.active_bookings ?? 0)}
          sub={`${s?.completed_today ?? 0} completed today`}
        />
        <KpiCard
          loading={stats.isLoading}
          icon={<Gauge className="h-5 w-5" />}
          label="Utilisation"
          value={`${Math.round((s?.utilization_rate ?? 0) * 100)}%`}
          sub={`${Math.round((s?.booked_minutes ?? 0) / 60)}h of ${Math.round((s?.available_minutes ?? 0) / 60)}h staff time`}
          meter={s?.utilization_rate ?? 0}
        />
        <KpiCard
          loading={stats.isLoading}
          icon={<Inbox className="h-5 w-5" />}
          label="Needs action"
          value={String(s?.pending_requests ?? 0)}
          sub="Requests awaiting confirmation or a quote"
          href="/dashboard/services#quotes"
          highlight={(s?.pending_requests ?? 0) > 0}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Revenue — last 7 days" description="Completed appointments (gross)" />
          <div className="p-5">
            {stats.isLoading ? <Skeleton className="h-48" /> : isOwnerView ? <RevenueBars series={s!.revenue_series} /> : (
              <EmptyState icon={<Activity className="h-5 w-5" />} title="Owner-only insight" />
            )}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Up next" action={<Link href="/dashboard/calendar" className="text-sm font-medium text-brand-700 hover:underline">Calendar</Link>} />
          <ul className="divide-y divide-sand-100">
            {upcoming.isLoading &&
              Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="p-4">
                  <Skeleton className="h-10" />
                </li>
              ))}
            {upcoming.data?.length === 0 && (
              <li>
                <EmptyState icon={<Clock className="h-5 w-5" />} title="Nothing scheduled" />
              </li>
            )}
            {upcoming.data?.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <div className="w-14 shrink-0 text-center">
                  <p className="text-sm font-semibold">{formatTime(a.starts_at)}</p>
                  <p className="text-[11px] text-ink-subtle">{formatDate(a.starts_at).split(',')[0]}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.service?.title}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {a.client?.full_name ?? a.walk_in_name ?? 'Client'} · {a.staff?.display_name ?? 'Unassigned'}
                    {a.is_mobile && ' · on-site'}
                  </p>
                </div>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function KpiCard(props: {
  loading: boolean;
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  meter?: number;
  href?: string;
  highlight?: boolean;
}) {
  const body = (
    <Card className={cn('h-full p-5 transition-shadow', props.href && 'hover:shadow-md', props.highlight && 'ring-2 ring-sun-300')}>
      <div className="flex items-center justify-between text-ink-muted">
        <span className="text-sm font-medium">{props.label}</span>
        <span className="rounded-lg bg-brand-50 p-2 text-brand-700">{props.icon}</span>
      </div>
      {props.loading ? (
        <Skeleton className="mt-3 h-8 w-24" />
      ) : (
        <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums">{props.value}</p>
      )}
      {props.meter !== undefined && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sand-100" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(props.meter * 100)} aria-label={props.label}>
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${Math.min(100, props.meter * 100)}%` }} />
        </div>
      )}
      <p className="mt-2 text-xs text-ink-subtle">{props.sub}</p>
    </Card>
  );
  return props.href ? <Link href={props.href}>{body}</Link> : body;
}

/** Dependency-free accessible bar chart (SVG). */
function RevenueBars({ series }: { series: DashboardStats['revenue_series'] }) {
  const max = Math.max(1, ...series.map((p) => p.revenue_cents));
  const W = 560;
  const H = 180;
  const gap = 12;
  const barW = (W - gap * (series.length - 1)) / Math.max(1, series.length);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H + 24}`} className="h-52 w-full" role="img" aria-label="Revenue per day for the last seven days">
        {series.map((p, i) => {
          const h = Math.max(2, (p.revenue_cents / max) * H);
          const x = i * (barW + gap);
          const label = new Date(`${p.date}T12:00:00+02:00`).toLocaleDateString('en-ZA', { weekday: 'short' });
          return (
            <g key={p.date}>
              <title>{`${label}: ${formatZar(p.revenue_cents)}`}</title>
              <rect x={x} y={H - h} width={barW} height={h} rx={6} className={i === series.length - 1 ? 'fill-brand-600' : 'fill-brand-200'} />
              {p.revenue_cents > 0 && (
                <text x={x + barW / 2} y={H - h - 6} textAnchor="middle" className="fill-sand-500 text-[11px]">
                  {formatZarCompact(p.revenue_cents)}
                </text>
              )}
              <text x={x + barW / 2} y={H + 18} textAnchor="middle" className="fill-sand-500 text-[12px]">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="sr-only">
        {series.map((p) => `${p.date}: ${formatZar(p.revenue_cents)}`).join('; ')}
      </figcaption>
    </figure>
  );
}

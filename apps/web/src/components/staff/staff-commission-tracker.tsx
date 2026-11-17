'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MailPlus, Save, Users } from 'lucide-react';
import { z } from 'zod';
import {
  addDays,
  bpsToPercent,
  extractDbErrorCode,
  formatZar,
  messageForCode,
  percentToBps,
  staffMemberSchema,
  toSaDate,
  type StaffMember,
} from '@khula/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { qk, useStaff, useStaffEarnings } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorNotice, Field, Input, Skeleton, Switch } from '@/components/ui/primitives';

type StaffPatch = Partial<Pick<StaffMember, 'commission_bps' | 'can_view_client_notes' | 'can_manage_bookings' | 'is_active'>>;

const PERIODS = {
  this_month: () => {
    const today = toSaDate();
    return { from: `${today.slice(0, 8)}01`, to: today, label: 'This month' };
  },
  last_30: () => ({ from: addDays(toSaDate(), -29), to: toSaDate(), label: 'Last 30 days' }),
  last_7: () => ({ from: addDays(toSaDate(), -6), to: toSaDate(), label: 'Last 7 days' }),
} as const;

export function StaffCommissionTracker() {
  const businessId = useDashboardStore((s) => s.businessId);
  const qc = useQueryClient();
  const staff = useStaff(businessId);
  const [period, setPeriod] = useState<keyof typeof PERIODS>('this_month');
  const range = useMemo(() => PERIODS[period](), [period]);
  const earnings = useStaffEarnings(businessId, range.from, range.to);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [inviting, setInviting] = useState(false);

  const update = useMutation({
    mutationFn: async (v: { id: string; changes: StaffPatch }) => {
      const { error } = await getSupabaseBrowserClient().from('staff_members').update(v.changes).eq('id', v.id);
      if (error) throw new Error(messageForCode(extractDbErrorCode(error.message)));
    },
    onSuccess: (_d, v) => {
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== v.id)));
      void qc.invalidateQueries({ queryKey: qk.staff(businessId ?? '') });
      void qc.invalidateQueries({ queryKey: ['earnings', businessId ?? ''] });
    },
  });

  const earningsById = new Map(earnings.data?.map((e) => [e.staff_id, e]));
  const totals = earnings.data?.reduce(
    (t, e) => ({
      revenue: t.revenue + Number(e.service_revenue_cents),
      commission: t.commission + Number(e.commission_cents),
      tips: t.tips + Number(e.tips_cents),
    }),
    { revenue: 0, commission: 0, tips: 0 },
  );

  return (
    <Card>
      <CardHeader
        title="Staff & commission"
        description="Commission is the staff member's share of completed service revenue. It's snapshotted on each completed appointment, so changes only affect future work."
        action={
          <Button size="sm" onClick={() => setInviting(true)}>
            <MailPlus className="h-4 w-4" aria-hidden /> Add staff
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3">
        {(Object.keys(PERIODS) as Array<keyof typeof PERIODS>).map((k) => (
          <button
            key={k}
            onClick={() => setPeriod(k)}
            aria-pressed={period === k}
            className="rounded-full px-3 py-1 text-sm text-ink-muted aria-pressed:bg-brand-50 aria-pressed:font-medium aria-pressed:text-brand-700"
          >
            {PERIODS[k]().label}
          </button>
        ))}
        {totals && (
          <p className="ml-auto text-sm text-ink-muted">
            Revenue <strong className="text-ink">{formatZar(totals.revenue)}</strong> · Commission{' '}
            <strong className="text-ink">{formatZar(totals.commission)}</strong> · Tips <strong className="text-ink">{formatZar(totals.tips)}</strong>
          </p>
        )}
      </div>

      <ErrorNotice error={update.error ?? earnings.error} />

      {staff.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-24" />
        </div>
      ) : !staff.data?.length ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="No staff yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-5 py-2 font-medium">Team member</th>
                <th className="px-3 py-2 font-medium">Commission</th>
                <th className="px-3 py-2 text-right font-medium">Jobs</th>
                <th className="px-3 py-2 text-right font-medium">Revenue</th>
                <th className="px-3 py-2 text-right font-medium">Commission</th>
                <th className="px-3 py-2 text-right font-medium">Tips</th>
                <th className="px-3 py-2 text-right font-medium">Payout</th>
                <th className="px-3 py-2 font-medium">Client notes</th>
                <th className="px-5 py-2 font-medium">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staff.data.map((s) => {
                const e = earningsById.get(s.id);
                const draft = drafts[s.id];
                const current = bpsToPercent(s.commission_bps);
                const dirty = draft !== undefined && Number(draft) !== current;
                const invalid = draft !== undefined && (draft === '' || Number.isNaN(Number(draft)) || Number(draft) < 0 || Number(draft) > 100);
                return (
                  <tr key={s.id} className={s.is_active ? '' : 'opacity-60'}>
                    <td className="px-5 py-3">
                      <p className="font-medium">{s.display_name}</p>
                      <p className="text-xs text-ink-subtle">
                        {s.role_title ?? 'Team member'}
                        {s.profile_id === null && s.invite_email && <Badge tone="amber">Invite pending</Badge>}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <form
                        className="flex items-center gap-1"
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          if (!dirty || invalid) return;
                          update.mutate({ id: s.id, changes: { commission_bps: percentToBps(Number(draft)) } });
                        }}
                      >
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step={0.5}
                          className="h-8 w-20"
                          aria-label={`Commission percent for ${s.display_name}`}
                          aria-invalid={invalid}
                          value={draft ?? String(current)}
                          onChange={(ev) => setDrafts((d) => ({ ...d, [s.id]: ev.target.value }))}
                        />
                        <span className="text-ink-muted">%</span>
                        {dirty && (
                          <Button type="submit" size="sm" variant="secondary" disabled={invalid} loading={update.isPending && update.variables?.id === s.id} aria-label="Save commission">
                            <Save className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </form>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{e?.completed_appointments ?? 0}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatZar(Number(e?.service_revenue_cents ?? 0))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatZar(Number(e?.commission_cents ?? 0))}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{formatZar(Number(e?.tips_cents ?? 0))}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{formatZar(Number(e?.total_earnings_cents ?? 0))}</td>
                    <td className="px-3 py-3">
                      <Switch
                        label={`${s.display_name} can read private client notes`}
                        checked={s.can_view_client_notes}
                        onChange={(v) => update.mutate({ id: s.id, changes: { can_view_client_notes: v } })}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <Switch label={`${s.display_name} active`} checked={s.is_active} onChange={(v) => update.mutate({ id: s.id, changes: { is_active: v } })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InviteStaffDialog open={inviting} onClose={() => setInviting(false)} />
    </Card>
  );
}

type InviteIn = z.input<typeof staffMemberSchema>;
type InviteOut = z.output<typeof staffMemberSchema>;

function InviteStaffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const businessId = useDashboardStore((s) => s.businessId);
  const qc = useQueryClient();
  const form = useForm<InviteIn, unknown, InviteOut>({
    resolver: zodResolver(staffMemberSchema),
    defaultValues: { commissionPercent: 40, canViewClientNotes: false, canManageBookings: true },
  });
  const { register, handleSubmit, reset, formState: { errors } } = form;

  const create = useMutation({
    mutationFn: async (v: InviteOut) => {
      const { error } = await getSupabaseBrowserClient()
        .from('staff_members')
        .insert({
          business_id: businessId!,
          display_name: v.displayName,
          role_title: v.roleTitle ?? null,
          invite_email: v.inviteEmail ?? null,
          commission_bps: percentToBps(v.commissionPercent),
          can_view_client_notes: v.canViewClientNotes,
          can_manage_bookings: v.canManageBookings,
          working_hours: v.workingHours,
        });
      if (error) throw new Error(messageForCode(extractDbErrorCode(error.message)));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.staff(businessId ?? '') });
      reset();
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} title="Add team member">
      <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => create.mutate(v))}>
        <Field label="Display name" error={errors.displayName?.message}>
          {(p) => <Input {...p} {...register('displayName')} />}
        </Field>
        <Field label="Role (optional)" error={errors.roleTitle?.message}>
          {(p) => <Input {...p} placeholder="Senior stylist" {...register('roleTitle')} />}
        </Field>
        <Field
          label="Invite email (optional)"
          error={errors.inviteEmail?.message}
          hint="They get dashboard access only after signing in with this verified email and accepting. Leave blank for a calendar-only lane."
        >
          {(p) => <Input {...p} type="email" autoComplete="off" {...register('inviteEmail', { setValueAs: (v) => (v === '' ? undefined : v) })} />}
        </Field>
        <Field label="Commission %" error={errors.commissionPercent?.message}>
          {(p) => <Input {...p} type="number" min={0} max={100} step={0.5} {...register('commissionPercent')} />}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register('canManageBookings')} /> Can manage bookings
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...register('canViewClientNotes')} /> Can read private client notes
        </label>
        <ErrorNotice error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending}>
            Add
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

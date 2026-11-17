'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Receipt } from 'lucide-react';
import { z } from 'zod';
import { extractDbErrorCode, formatDateTime, formatZar, messageForCode, recordTipSchema } from '@khula/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { qk, useStaff, useTips } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorNotice, Field, Input, Select, Skeleton } from '@/components/ui/primitives';

type In = z.input<typeof recordTipSchema>;
type Out = z.output<typeof recordTipSchema>;

/**
 * Append-only tips ledger. Cash/card/EFT tips are recorded by the owner;
 * in-app tips arrive only through the signed payment webhook. Mistakes are
 * corrected with a new negative entry, never by editing history.
 */
export function TipsLedger() {
  const businessId = useDashboardStore((s) => s.businessId);
  const qc = useQueryClient();
  const staff = useStaff(businessId);
  const tips = useTips(businessId);
  const staffName = new Map(staff.data?.map((s) => [s.id, s.display_name]));

  const form = useForm<In, unknown, Out>({ resolver: zodResolver(recordTipSchema), defaultValues: { method: 'cash', amount: '' } });
  const { register, handleSubmit, reset, formState: { errors } } = form;

  const record = useMutation({
    mutationFn: async (v: Out) => {
      const client = getSupabaseBrowserClient();
      const { data: auth } = await client.auth.getUser();
      const { error } = await client.from('staff_tips').insert({
        business_id: businessId!,
        staff_id: v.staffId,
        appointment_id: v.appointmentId ?? null,
        amount_cents: v.amount,
        method: v.method,
        note: v.note ?? null,
        recorded_by: auth.user!.id,
      });
      if (error) throw new Error(messageForCode(extractDbErrorCode(error.message)));
    },
    onSuccess: async () => {
      reset({ method: 'cash', amount: '', staffId: undefined, note: '' });
      await qc.invalidateQueries({ queryKey: qk.tips(businessId ?? '') });
      await qc.invalidateQueries({ queryKey: ['earnings', businessId ?? ''] });
    },
  });

  return (
    <Card>
      <CardHeader title="Tips ledger" description="Every tip, by whom and how. Append-only for a clean audit trail." />
      <form className="grid gap-3 border-b border-slate-100 p-5 sm:grid-cols-5" noValidate onSubmit={handleSubmit((v) => record.mutate(v))}>
        <Field label="Team member" error={errors.staffId?.message}>
          {(p) => (
            <Select {...p} {...register('staffId')}>
              <option value="">Choose…</option>
              {staff.data?.filter((s) => s.is_active).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Amount (R)" error={errors.amount?.message}>
          {(p) => <Input {...p} inputMode="decimal" placeholder="50.00" {...register('amount')} />}
        </Field>
        <Field label="Method" error={errors.method?.message}>
          {(p) => (
            <Select {...p} {...register('method')}>
              <option value="cash">Cash</option>
              <option value="card">Card machine</option>
              <option value="eft">EFT</option>
            </Select>
          )}
        </Field>
        <Field label="Note (optional)" error={errors.note?.message}>
          {(p) => <Input {...p} maxLength={280} {...register('note')} />}
        </Field>
        <div className="flex items-end">
          <Button type="submit" className="w-full" loading={record.isPending}>
            <HandCoins className="h-4 w-4" aria-hidden /> Record tip
          </Button>
        </div>
        <div className="sm:col-span-5">
          <ErrorNotice error={record.error} />
        </div>
      </form>

      {tips.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-16" />
        </div>
      ) : !tips.data?.length ? (
        <EmptyState icon={<Receipt className="h-5 w-5" />} title="No tips recorded yet" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {tips.data.map((t) => (
            <li key={t.id} className="flex items-center gap-4 px-5 py-3 text-sm">
              <span className="w-40 shrink-0 text-ink-muted">{formatDateTime(t.created_at)}</span>
              <span className="flex-1 font-medium">{staffName.get(t.staff_id) ?? 'Former team member'}</span>
              <Badge tone={t.method === 'in_app' ? 'brand' : 'slate'}>{t.method === 'in_app' ? 'In-app' : t.method.toUpperCase()}</Badge>
              <span className="hidden flex-1 truncate text-ink-muted sm:block">{t.note}</span>
              <span className={`w-24 text-right font-semibold tabular-nums ${t.amount_cents < 0 ? 'text-red-600' : ''}`}>{formatZar(t.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

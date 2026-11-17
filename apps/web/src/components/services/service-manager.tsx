'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, MessageSquareQuote, Pencil, Plus, Tags, Zap } from 'lucide-react';
import { z } from 'zod';
import {
  centsToRandString,
  extractDbErrorCode,
  formatZar,
  messageForCode,
  serviceSchema,
  type PricingModel,
  type Service,
} from '@khula/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { qk, useServices } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorNotice, Field, Input, Select, Skeleton, Switch, Textarea } from '@/components/ui/primitives';

type In = z.input<typeof serviceSchema>;
type Out = z.output<typeof serviceSchema>;

function toDbError(error: { message?: string } | null) {
  return new Error(messageForCode(extractDbErrorCode(error?.message)));
}

export function ServiceManager() {
  const businessId = useDashboardStore((s) => s.businessId);
  const services = useServices(businessId);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Service | 'new' | null>(null);

  const patch = useMutation({
    mutationFn: async (v: { id: string; changes: { pricing_model?: PricingModel; is_active?: boolean } }) => {
      const { error } = await getSupabaseBrowserClient().from('services').update(v.changes).eq('id', v.id);
      if (error) throw toDbError(error);
    },
    // Optimistic toggle — instant feedback, rolled back on error.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.services(businessId ?? '') });
      const prev = qc.getQueryData<Service[]>(qk.services(businessId ?? ''));
      qc.setQueryData<Service[]>(qk.services(businessId ?? ''), (old) => old?.map((s) => (s.id === v.id ? { ...s, ...v.changes } : s)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(qk.services(businessId ?? ''), ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.services(businessId ?? '') }),
  });

  return (
    <Card>
      <CardHeader
        title="Services"
        description="Instant-book services take bookings straight into your calendar. Quote-required services let you price each job first."
        action={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden /> New service
          </Button>
        }
      />
      <ErrorNotice error={patch.error} />
      {services.isLoading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : !services.data?.length ? (
        <EmptyState icon={<Tags className="h-5 w-5" />} title="No services yet">
          Add what you offer — e.g. “Silk press · 90 min · R450” or “Geyser repair · quote”.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {services.data.map((s) => {
            const instant = s.pricing_model === 'instant_book';
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{s.title}</p>
                    {!s.is_active && <Badge>Hidden</Badge>}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden />
                      {s.duration_minutes} min{s.buffer_minutes ? ` + ${s.buffer_minutes} buffer` : ''}
                    </span>
                    <span>{s.price_cents !== null ? `${instant ? '' : 'from '}${formatZar(s.price_cents)}` : 'Price on quote'}</span>
                    {s.deposit_percent > 0 && <span>{s.deposit_percent}% deposit</span>}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Badge tone={instant ? 'brand' : 'violet'}>
                    {instant ? <Zap className="h-3 w-3" aria-hidden /> : <MessageSquareQuote className="h-3 w-3" aria-hidden />}
                    {instant ? 'Instant book' : 'Quote required'}
                  </Badge>
                  <Switch
                    label={`Instant book for ${s.title}`}
                    checked={instant}
                    disabled={patch.isPending || (!instant && s.price_cents === null)}
                    onChange={(on) => patch.mutate({ id: s.id, changes: { pricing_model: on ? 'instant_book' : 'quote_required' } })}
                  />
                  <Switch
                    label={`Visible to clients: ${s.title}`}
                    checked={s.is_active}
                    disabled={patch.isPending}
                    onChange={(on) => patch.mutate({ id: s.id, changes: { is_active: on } })}
                  />
                  <Button variant="ghost" size="sm" onClick={() => setEditing(s)} aria-label={`Edit ${s.title}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-ink-subtle">
        Switching to instant book requires a fixed price. Left switch: instant book · right switch: visible to clients.
      </p>

      <ServiceDialog businessId={businessId} service={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function ServiceDialog({ businessId, service, onClose }: { businessId: string | null; service: Service | 'new' | null; onClose: () => void }) {
  const qc = useQueryClient();
  const isNew = service === 'new';
  const existing = service && service !== 'new' ? service : null;

  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(serviceSchema),
    values: existing
      ? {
          title: existing.title,
          description: existing.description ?? '',
          pricingModel: existing.pricing_model,
          price: centsToRandString(existing.price_cents),
          durationMinutes: existing.duration_minutes,
          bufferMinutes: existing.buffer_minutes,
          depositPercent: existing.deposit_percent,
          isActive: existing.is_active,
        }
      : { title: '', pricingModel: 'instant_book', durationMinutes: 60, bufferMinutes: 0, depositPercent: 0, isActive: true, price: '' },
  });
  const { register, handleSubmit, formState: { errors } } = form;
  const pricingModel = useWatch({ control: form.control, name: 'pricingModel' });

  const save = useMutation({
    mutationFn: async (v: Out) => {
      const row = {
        title: v.title,
        description: v.description ?? null,
        pricing_model: v.pricingModel,
        price_cents: v.price ?? null,
        duration_minutes: v.durationMinutes,
        buffer_minutes: v.bufferMinutes,
        deposit_percent: v.depositPercent,
        is_active: v.isActive,
      };
      const client = getSupabaseBrowserClient();
      const { error } = existing
        ? await client.from('services').update(row).eq('id', existing.id)
        : await client.from('services').insert({ ...row, business_id: businessId! });
      if (error) throw toDbError(error);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.services(businessId ?? '') });
      onClose();
    },
  });

  return (
    <Dialog open={!!service} onClose={onClose} title={isNew ? 'New service' : 'Edit service'}>
      <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
        <Field label="Title" error={errors.title?.message}>
          {(p) => <Input {...p} {...register('title')} maxLength={120} />}
        </Field>
        <Field label="Description" error={errors.description?.message}>
          {(p) => <Textarea {...p} {...register('description')} maxLength={2000} />}
        </Field>
        <Field label="Pricing" error={errors.pricingModel?.message}>
          {(p) => (
            <Select {...p} {...register('pricingModel')}>
              <option value="instant_book">Instant book — fixed price, client picks a slot</option>
              <option value="quote_required">Quote required — I price each job</option>
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={pricingModel === 'instant_book' ? 'Price (R)' : '“From” price (R, optional)'} error={errors.price?.message}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="450.00" {...register('price')} />}
          </Field>
          <Field label="Deposit %" error={errors.depositPercent?.message} hint="Holds the slot; paid online.">
            {(p) => <Input {...p} type="number" min={0} max={100} {...register('depositPercent')} />}
          </Field>
          <Field label="Duration (min)" error={errors.durationMinutes?.message}>
            {(p) => <Input {...p} type="number" min={5} max={1440} step={5} {...register('durationMinutes')} />}
          </Field>
          <Field label="Buffer after (min)" error={errors.bufferMinutes?.message} hint="Clean-up or travel time.">
            {(p) => <Input {...p} type="number" min={0} max={240} step={5} {...register('bufferMinutes')} />}
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" {...register('isActive')} />
          Visible to clients
        </label>
        <ErrorNotice error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
            Save service
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

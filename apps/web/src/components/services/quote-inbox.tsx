'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CalendarClock, Inbox, MapPin, Send } from 'lucide-react';
import { formatDateTime, formatZar, saLocalToIso, submitQuoteSchema } from '@khula/shared';
import { useAppointmentActions, useQuoteInbox, useStaff } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, ErrorNotice, Field, Input, Select, Skeleton, StatusBadge, Textarea } from '@/components/ui/primitives';

// Form-level schema: date + time inputs are combined into proposedStartsAt on submit.
const quoteFormSchema = submitQuoteSchema.omit({ proposedStartsAt: true }).extend({
  proposedDate: z.preprocess((v) => (v === '' ? undefined : v), z.iso.date().optional()),
  proposedTime: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional()),
  proposedStaffId: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()),
});
type In = z.input<typeof quoteFormSchema>;
type Out = z.output<typeof quoteFormSchema>;

export function QuoteInbox() {
  const businessId = useDashboardStore((s) => s.businessId);
  const inbox = useQuoteInbox(businessId);
  const [quoting, setQuoting] = useState<string | null>(null);

  return (
    <Card id="quotes">
      <CardHeader title="Quote requests" description="Jobs that need your price before they're booked. Clients accept or decline in the app." />
      {inbox.isLoading ? (
        <div className="p-5">
          <Skeleton className="h-20" />
        </div>
      ) : !inbox.data?.length ? (
        <EmptyState icon={<Inbox className="h-5 w-5" />} title="No open quote requests" />
      ) : (
        <ul className="divide-y divide-slate-100">
          {inbox.data.map((a) => {
            const pending = a.quotes?.find((q) => q.status === 'pending');
            return (
              <li key={a.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{a.service?.title}</p>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-sm text-ink-muted">
                    {a.client?.full_name ?? 'Client'} · preferred {formatDateTime(a.starts_at)}
                  </p>
                  {a.is_mobile && a.client_suburb && (
                    <p className="flex items-center gap-1 text-xs text-ink-muted">
                      <MapPin className="h-3 w-3" aria-hidden /> {a.client_suburb}, {a.client_city}
                    </p>
                  )}
                  {a.client_message && <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-sm">“{a.client_message}”</p>}
                  {pending && (
                    <Badge tone="violet">
                      Sent {formatZar(pending.amount_cents)} · expires {formatDateTime(pending.valid_until)}
                    </Badge>
                  )}
                </div>
                <Button size="sm" variant={pending ? 'secondary' : 'primary'} onClick={() => setQuoting(a.id)}>
                  <Send className="h-4 w-4" aria-hidden /> {pending ? 'Revise quote' : 'Send quote'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <QuoteDialog appointmentId={quoting} onClose={() => setQuoting(null)} />
    </Card>
  );
}

function QuoteDialog({ appointmentId, onClose }: { appointmentId: string | null; onClose: () => void }) {
  const businessId = useDashboardStore((s) => s.businessId);
  const staff = useStaff(businessId);
  const { submitQuote } = useAppointmentActions(businessId);
  const form = useForm<In, unknown, Out>({
    resolver: zodResolver(quoteFormSchema),
    values: appointmentId ? { appointmentId, amount: '', validHours: 72, message: '', proposedDate: '', proposedTime: '', proposedStaffId: '' } : undefined,
  });
  const { register, handleSubmit, formState: { errors } } = form;

  return (
    <Dialog open={!!appointmentId} onClose={onClose} title="Send a quote">
      <form
        className="space-y-4"
        noValidate
        onSubmit={handleSubmit((v) =>
          submitQuote.mutate(
            {
              appointmentId: v.appointmentId,
              amountCents: v.amount,
              message: v.message,
              validHours: v.validHours,
              proposedStartsAt: v.proposedDate && v.proposedTime ? saLocalToIso(v.proposedDate, v.proposedTime) : undefined,
              proposedStaffId: v.proposedStaffId,
            },
            { onSuccess: onClose },
          ),
        )}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total price (R)" error={errors.amount?.message}>
            {(p) => <Input {...p} inputMode="decimal" placeholder="1 200.00" {...register('amount')} autoFocus />}
          </Field>
          <Field label="Valid for" error={errors.validHours?.message}>
            {(p) => (
              <Select {...p} {...register('validHours')}>
                <option value={24}>24 hours</option>
                <option value={72}>3 days</option>
                <option value={168}>7 days</option>
              </Select>
            )}
          </Field>
        </div>
        <Field label="Message to client" error={errors.message?.message} hint="What's included, parts, call-out fee, etc.">
          {(p) => <Textarea {...p} {...register('message')} maxLength={2000} />}
        </Field>
        <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
          <legend className="flex items-center gap-1 px-1 text-sm font-medium">
            <CalendarClock className="h-4 w-4" aria-hidden /> Propose a different time (optional)
          </legend>
          <div className="grid grid-cols-2 gap-3">
            <Input type="date" aria-label="Proposed date" {...register('proposedDate')} />
            <Input type="time" step={900} aria-label="Proposed time" {...register('proposedTime')} />
          </div>
          <Select aria-label="Assign staff" {...register('proposedStaffId')}>
            <option value="">Assign later</option>
            {staff.data?.filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>
                {s.display_name}
              </option>
            ))}
          </Select>
        </fieldset>
        <ErrorNotice error={submitQuote.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitQuote.isPending}>
            <Send className="h-4 w-4" aria-hidden /> Send quote
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

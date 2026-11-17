'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  formatZar,
  minutesIntoSaDay,
  optionalSaPhone,
  personName,
  randAmount,
  saLocalToIso,
  toSaDate,
  uuid,
  type Service,
  type StaffMember,
} from '@khula/shared';
import { useAppointmentActions } from '@/hooks/queries';
import { useDashboardStore } from '@/stores/dashboard-store';
import { Button, Dialog, ErrorNotice, Field, Input, Select } from '@/components/ui/primitives';

const formSchema = z
  .object({
    serviceId: uuid,
    staffId: uuid,
    date: z.iso.date(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    name: personName,
    phone: optionalSaPhone,
    price: z.preprocess((v) => (v === '' ? undefined : v), randAmount.optional()),
  })
  .strict();

type In = z.input<typeof formSchema>;
type Out = z.output<typeof formSchema>;

export function WalkInDialog({ staff, services }: { staff: StaffMember[]; services: Service[] }) {
  const businessId = useDashboardStore((s) => s.businessId);
  const draft = useDashboardStore((s) => s.walkInDraft);
  const openWalkIn = useDashboardStore((s) => s.openWalkIn);
  const { createWalkIn } = useAppointmentActions(businessId);

  const form = useForm<In, unknown, Out>({ resolver: zodResolver(formSchema) });
  const { register, handleSubmit, reset, watch, formState: { errors } } = form;

  useEffect(() => {
    if (!draft) return;
    const mins = minutesIntoSaDay(draft.startsAt);
    reset({
      staffId: draft.staffId,
      serviceId: services[0]?.id ?? '',
      date: toSaDate(new Date(draft.startsAt)),
      time: `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`,
      name: '',
      phone: '',
      price: '',
    });
    createWalkIn.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const selectedService = services.find((s) => s.id === watch('serviceId'));
  const close = () => openWalkIn(null);

  return (
    <Dialog open={!!draft} onClose={close} title="Add walk-in">
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit((v) =>
          createWalkIn.mutate(
            {
              serviceId: v.serviceId,
              staffId: v.staffId,
              startsAt: saLocalToIso(v.date, v.time),
              name: v.name,
              phone: v.phone,
              priceCents: v.price,
            },
            { onSuccess: close },
          ),
        )}
      >
        <Field label="Service" error={errors.serviceId?.message}>
          {(p) => (
            <Select {...p} {...register('serviceId')}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {s.duration_minutes} min · {s.price_cents !== null ? formatZar(s.price_cents) : 'quote'}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Staff member" error={errors.staffId?.message}>
          {(p) => (
            <Select {...p} {...register('staffId')}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" error={errors.date?.message}>
            {(p) => <Input {...p} type="date" {...register('date')} />}
          </Field>
          <Field label="Start time" error={errors.time?.message}>
            {(p) => <Input {...p} type="time" step={900} {...register('time')} />}
          </Field>
        </div>
        <Field label="Client name" error={errors.name?.message}>
          {(p) => <Input {...p} autoComplete="off" {...register('name')} />}
        </Field>
        <Field label="Client phone (optional)" error={errors.phone?.message} hint="Kept for 180 days, then deleted automatically.">
          {(p) => <Input {...p} type="tel" inputMode="tel" placeholder="082 123 4567" {...register('phone')} />}
        </Field>
        <Field
          label={selectedService?.price_cents === null ? 'Agreed price (R)' : 'Price override (R, optional)'}
          error={errors.price?.message}
        >
          {(p) => <Input {...p} inputMode="decimal" placeholder={selectedService?.price_cents != null ? (selectedService.price_cents / 100).toFixed(2) : '0.00'} {...register('price')} />}
        </Field>
        <ErrorNotice error={createWalkIn.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" loading={createWalkIn.isPending}>
            Add to calendar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

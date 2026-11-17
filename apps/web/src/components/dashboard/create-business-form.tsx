'use client';

import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crosshair, Store } from 'lucide-react';
import { z } from 'zod';
import { SA_PROVINCES, businessSchema, messageForCode, extractDbErrorCode } from '@khula/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { useCategories, qk } from '@/hooks/queries';
import { Button, Card, CardHeader, ErrorNotice, Field, Input, Select, Textarea } from '@/components/ui/primitives';

type FormIn = z.input<typeof businessSchema>;
type FormOut = z.output<typeof businessSchema>;

export function CreateBusinessForm() {
  const qc = useQueryClient();
  const { data: categories } = useCategories();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(businessSchema),
    defaultValues: { serviceModel: 'fixed_location', province: 'gauteng' },
  });
  const { register, handleSubmit, setValue, formState } = form;
  const errors = formState.errors;
  const serviceModel = useWatch({ control: form.control, name: 'serviceModel' });

  const create = useMutation({
    mutationFn: async (v: FormOut) => {
      const { error } = await getSupabaseBrowserClient()
        .from('businesses')
        .insert({
          name: v.name,
          slug: v.slug,
          description: v.description ?? null,
          category_id: v.categoryId,
          service_model: v.serviceModel,
          address_line1: v.addressLine1 ?? null,
          address_line2: v.addressLine2 ?? null,
          suburb: v.suburb,
          city: v.city,
          province: v.province,
          postal_code: v.postalCode,
          // EWKT — PostGIS parses it server-side; never string-built SQL.
          location: `SRID=4326;POINT(${v.lng} ${v.lat})`,
          travel_radius_km: v.serviceModel === 'mobile_onsite' ? (v.travelRadiusKm ?? null) : null,
          phone: v.phone ?? null,
          email: v.email ?? null,
        });
      if (error) throw new Error(error.code === '23505' ? 'That web address (slug) is taken.' : messageForCode(extractDbErrorCode(error.message)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.businesses }),
  });

  function fillMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (p) => {
        setValue('lat', Number(p.coords.latitude.toFixed(6)), { shouldValidate: true });
        setValue('lng', Number(p.coords.longitude.toFixed(6)), { shouldValidate: true });
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader title="Set up your business" description="Tell clients who you are and where you work. You can change this later." />
      <form onSubmit={handleSubmit((v) => create.mutate(v))} className="grid gap-4 p-5 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <Field label="Business name" error={errors.name?.message}>
            {(p) => <Input {...p} {...register('name')} placeholder="Thandi's Hair Studio" />}
          </Field>
        </div>
        <Field label="Web address" error={errors.slug?.message} hint="khula.co.za/b/your-name">
          {(p) => <Input {...p} {...register('slug')} placeholder="thandis-hair-studio" />}
        </Field>
        <Field label="Category" error={errors.categoryId?.message}>
          {(p) => (
            <Select {...p} {...register('categoryId')}>
              <option value="">Choose…</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <Field label="How do you work?" error={errors.serviceModel?.message}>
            {(p) => (
              <Select {...p} {...register('serviceModel')}>
                <option value="fixed_location">Clients come to me (salon, workshop, studio)</option>
                <option value="mobile_onsite">I go to clients (mobile / on-site)</option>
              </Select>
            )}
          </Field>
        </div>
        {serviceModel === 'mobile_onsite' && (
          <Field label="Travel radius (km)" error={errors.travelRadiusKm?.message} hint="Only bookings inside this distance are accepted.">
            {(p) => <Input {...p} type="number" min={1} max={250} {...register('travelRadiusKm')} />}
          </Field>
        )}
        <div className="sm:col-span-2">
          <Field
            label={serviceModel === 'mobile_onsite' ? 'Base address (kept private)' : 'Street address'}
            error={errors.addressLine1?.message}
          >
            {(p) => <Input {...p} {...register('addressLine1')} autoComplete="street-address" />}
          </Field>
        </div>
        <Field label="Suburb" error={errors.suburb?.message}>
          {(p) => <Input {...p} {...register('suburb')} />}
        </Field>
        <Field label="City" error={errors.city?.message}>
          {(p) => <Input {...p} {...register('city')} />}
        </Field>
        <Field label="Province" error={errors.province?.message}>
          {(p) => (
            <Select {...p} {...register('province')}>
              {SA_PROVINCES.map((pr) => (
                <option key={pr} value={pr}>
                  {pr.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Postal code" error={errors.postalCode?.message}>
          {(p) => <Input {...p} inputMode="numeric" maxLength={4} {...register('postalCode')} />}
        </Field>
        <Field label="Latitude" error={errors.lat?.message}>
          {(p) => <Input {...p} type="number" step="any" {...register('lat', { valueAsNumber: true })} />}
        </Field>
        <Field label="Longitude" error={errors.lng?.message}>
          {(p) => <Input {...p} type="number" step="any" {...register('lng', { valueAsNumber: true })} />}
        </Field>
        <div className="sm:col-span-2">
          <Button type="button" variant="secondary" size="sm" onClick={fillMyLocation}>
            <Crosshair className="h-4 w-4" aria-hidden /> Use my current location
          </Button>
        </div>
        <div className="sm:col-span-2">
          <Field label="About (optional)" error={errors.description?.message}>
            {(p) => <Textarea {...p} {...register('description')} maxLength={2000} />}
          </Field>
        </div>
        <div className="sm:col-span-2 space-y-3">
          <ErrorNotice error={create.error} />
          <Button type="submit" loading={create.isPending} className="w-full">
            <Store className="h-4 w-4" aria-hidden /> Create business
          </Button>
        </div>
      </form>
    </Card>
  );
}

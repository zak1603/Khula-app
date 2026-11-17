import { forwardRef } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type PressableProps, type TextInputProps } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { AppointmentStatus } from '@khula/shared';
import { STATUS_LABEL } from '@khula/shared';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variantBox: Record<Variant, string> = {
  primary: 'bg-brand-600 active:bg-brand-700',
  secondary: 'bg-white border border-slate-200 active:bg-slate-50',
  ghost: 'bg-transparent active:bg-slate-100',
  danger: 'bg-red-600 active:bg-red-700',
};
const variantText: Record<Variant, string> = {
  primary: 'text-white',
  secondary: 'text-slate-900',
  ghost: 'text-slate-600',
  danger: 'text-white',
};

export function Button({
  title,
  variant = 'primary',
  loading,
  disabled,
  icon,
  className,
  onPress,
  ...rest
}: PressableProps & { title: string; variant?: Variant; loading?: boolean; icon?: React.ReactNode; className?: string }) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      disabled={isDisabled}
      onPress={(e) => {
        void Haptics.selectionAsync();
        onPress?.(e);
      }}
      className={cx('h-12 flex-row items-center justify-center gap-2 rounded-xl px-4', variantBox[variant], isDisabled && 'opacity-50', className)}
      {...rest}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' || variant === 'danger' ? '#fff' : '#1a7e56'} /> : icon}
      <Text className={cx('text-base font-semibold', variantText[variant])}>{title}</Text>
    </Pressable>
  );
}

export const Input = forwardRef<React.ComponentRef<typeof TextInput>, TextInputProps & { label: string; error?: string; hint?: string }>(function Input(
  { label, error, hint, className, ...props },
  ref,
) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-slate-800">{label}</Text>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor="#94a3b8"
        className={cx(
          'min-h-12 rounded-xl border bg-white px-3.5 text-base text-slate-900',
          error ? 'border-red-500' : 'border-slate-300 focus:border-brand-500',
          className,
        )}
        {...props}
      />
      {error ? (
        <Text accessibilityRole="alert" className="text-xs text-red-600">
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-xs text-slate-400">{hint}</Text>
      ) : null}
    </View>
  );
});

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      className={cx('flex-row items-center gap-1.5 rounded-full border px-3.5 py-2', selected ? 'border-brand-600 bg-brand-600' : 'border-slate-200 bg-white')}
    >
      {icon}
      <Text className={cx('text-sm font-medium', selected ? 'text-white' : 'text-slate-700')}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <View className={cx('rounded-2xl border border-slate-200 bg-white p-4', className)}>{children}</View>;
}

const statusTone: Record<AppointmentStatus, string> = {
  requested: 'bg-amber-100 text-amber-800',
  quoted: 'bg-violet-100 text-violet-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-sky-100 text-sky-800',
  cancelled: 'bg-slate-100 text-slate-500',
};

export function StatusPill({ status }: { status: AppointmentStatus }) {
  const [bg, fg] = statusTone[status].split(' ');
  return (
    <View className={cx('self-start rounded-full px-2.5 py-1', bg)}>
      <Text className={cx('text-xs font-semibold', fg)}>{STATUS_LABEL[status]}</Text>
    </View>
  );
}

export function Pill({ children, tone = 'slate', icon }: { children: string; tone?: 'slate' | 'brand' | 'violet' | 'amber'; icon?: React.ReactNode }) {
  const tones = {
    slate: ['bg-slate-100', 'text-slate-600'],
    brand: ['bg-brand-50', 'text-brand-700'],
    violet: ['bg-violet-50', 'text-violet-700'],
    amber: ['bg-amber-50', 'text-amber-700'],
  } as const;
  return (
    <View className={cx('flex-row items-center gap-1 self-start rounded-full px-2 py-0.5', tones[tone][0])}>
      {icon}
      <Text className={cx('text-xs font-medium', tones[tone][1])}>{children}</Text>
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <View accessibilityRole="alert" className="rounded-xl border border-red-200 bg-red-50 p-3">
      <Text className="text-sm text-red-700">{error instanceof Error ? error.message : 'Something went wrong.'}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</Text>;
}

export function Empty({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <View className="items-center gap-2 px-8 py-16">
      <View className="rounded-full bg-slate-100 p-4">{icon}</View>
      <Text className="text-base font-semibold text-slate-800">{title}</Text>
      {subtitle && <Text className="text-center text-sm text-slate-500">{subtitle}</Text>}
    </View>
  );
}

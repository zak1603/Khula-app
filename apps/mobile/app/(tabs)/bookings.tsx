import { useMemo } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarX2, ChevronRight, MapPin } from 'lucide-react-native';
import { PROGRESS_LABEL, formatDateTime, formatZar } from '@khula/shared';
import { useMyBookings } from '@/hooks/queries';
import { useAuth } from '@/providers/auth-provider';
import { Button, Empty, ErrorText, StatusPill } from '@/components/ui';

export default function BookingsScreen() {
  const { status } = useAuth();
  const bookings = useMyBookings(); // includes a realtime subscription

  const sections = useMemo(() => {
    const all = bookings.data ?? [];
    const active = all
      .filter((a) => ['requested', 'quoted', 'confirmed'].includes(a.status))
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    return active.length ? [{ title: 'Active', data: active }] : [];
  }, [bookings.data]);

  if (status !== 'signed_in') {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-sand-50 p-8">
        <Text className="text-center text-base text-sand-600">Sign in to see and track your bookings.</Text>
        <Button title="Sign in" onPress={() => router.push('/(auth)/sign-in')} className="w-48" />
      </View>
    );
  }

  return (
    <SectionList
      className="flex-1 bg-sand-50"
      contentContainerClassName="p-4"
      sections={sections}
      keyExtractor={(a) => a.id}
      refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => void bookings.refetch()} tintColor="#146b4f" />}
      renderSectionHeader={({ section }) => <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-sand-400">{section.title}</Text>}
      ListHeaderComponent={<ErrorText error={bookings.error} />}
      ListEmptyComponent={
        bookings.isLoading ? (
          <ActivityIndicator className="mt-16" color="#146b4f" />
        ) : (
          <Empty icon={<CalendarX2 size={22} color="#7a6f5e" />} title="No active bookings" subtitle="Past bookings are under Profile → History." />
        )
      }
      renderItem={({ item: a }) => {
        const needsAction = a.status === 'quoted' || a.deposit_status === 'pending';
        return (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/booking/[id]', params: { id: a.id } })}
            className={needsAction ? 'mb-3 rounded-2xl border-2 border-violet-300 bg-white p-4' : 'mb-3 rounded-2xl border border-sand-200 bg-white p-4'}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold text-sand-900">{a.service?.title ?? 'Booking'}</Text>
                <Text className="text-sm text-sand-500">{formatDateTime(a.starts_at)}</Text>
                {a.is_mobile && a.status === 'confirmed' && a.progress !== 'not_started' && (
                  <View className="flex-row items-center gap-1">
                    <MapPin size={12} color="#6d28d9" />
                    <Text className="text-xs font-semibold text-violet-700">{PROGRESS_LABEL[a.progress]}</Text>
                  </View>
                )}
              </View>
              <View className="items-end gap-2">
                <StatusPill status={a.status} />
                {a.total_price_cents !== null && <Text className="text-sm font-semibold">{formatZar(a.total_price_cents)}</Text>}
              </View>
              <ChevronRight size={18} color="#a89c88" />
            </View>
            {needsAction && (
              <Text className="mt-2 text-xs font-semibold text-violet-700">
                {a.deposit_status === 'pending' ? 'Deposit due — tap to pay' : 'Quote received — tap to respond'}
              </Text>
            )}
          </Pressable>
        );
      }}
    />
  );
}

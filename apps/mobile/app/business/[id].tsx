import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { BadgeCheck, ChevronRight, Clock, MapPin, MessageSquareQuote, Store, Truck, Zap } from 'lucide-react-native';
import { formatZar } from '@khula/shared';
import { useBusinessPublic, useBusinessServices } from '@/hooks/queries';
import { useAuth } from '@/providers/auth-provider';
import { Card, ErrorText, Pill, SectionTitle } from '@/components/ui';

export default function BusinessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status } = useAuth();
  const business = useBusinessPublic(id);
  const services = useBusinessServices(id);
  const b = business.data;

  if (business.isLoading) return <ActivityIndicator className="mt-20" color="#146b4f" />;
  if (!b) return <ErrorText error={business.error ?? new Error('This business is no longer listed.')} />;
  const mobile = b.service_model === 'mobile_onsite';

  return (
    <ScrollView className="flex-1 bg-sand-50" contentContainerClassName="p-4 pb-12">
      <Stack.Screen options={{ title: b.name }} />
      <Card>
        <View className="flex-row items-center gap-2">
          <Text className="flex-shrink text-xl font-bold text-sand-900">{b.name}</Text>
          {b.is_verified && <BadgeCheck size={18} color="#146b4f" accessibilityLabel="Verified business" />}
        </View>
        <Text className="mt-1 text-sand-500">{b.category_name}</Text>
        <View className="mt-3 flex-row items-start gap-1.5">
          <MapPin size={15} color="#7a6f5e" />
          <Text className="flex-1 text-sm text-sand-600">
            {mobile ? `Based in ${b.suburb}, ${b.city}` : `${b.address_line1}, ${b.suburb}, ${b.city}`}
          </Text>
        </View>
        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {mobile ? (
            <Pill tone="violet" icon={<Truck size={12} color="#6d28d9" />}>{`Comes to you · up to ${Math.round(Number(b.travel_radius_km))} km`}</Pill>
          ) : (
            <Pill icon={<Store size={12} color="#5f564a" />}>Visit in-store</Pill>
          )}
          {!b.accepts_payments && <Pill tone="amber">Pay in person</Pill>}
        </View>
        {b.description && <Text className="mt-3 text-sm leading-5 text-sand-700">{b.description}</Text>}
      </Card>

      <SectionTitle>Services</SectionTitle>
      <ErrorText error={services.error} />
      <View className="gap-2">
        {services.data?.map((s) => {
          const instant = s.pricing_model === 'instant_book';
          return (
            <Pressable
              key={s.id}
              accessibilityRole="button"
              accessibilityLabel={`${s.title}, ${instant ? 'instant book' : 'request a quote'}`}
              onPress={() =>
                status === 'signed_in'
                  ? router.push({ pathname: '/book/[serviceId]', params: { serviceId: s.id } })
                  : router.push('/(auth)/sign-in')
              }
              className="flex-row items-center gap-3 rounded-2xl border border-sand-200 bg-white p-4 active:bg-sand-50"
            >
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold text-sand-900">{s.title}</Text>
                {s.description && (
                  <Text className="text-sm text-sand-500" numberOfLines={2}>
                    {s.description}
                  </Text>
                )}
                <View className="mt-1 flex-row flex-wrap items-center gap-2">
                  <View className="flex-row items-center gap-1">
                    <Clock size={12} color="#7a6f5e" />
                    <Text className="text-xs text-sand-500">{s.duration_minutes} min</Text>
                  </View>
                  {instant ? (
                    <Pill tone="brand" icon={<Zap size={11} color="#115641" />}>Instant book</Pill>
                  ) : (
                    <Pill tone="amber" icon={<MessageSquareQuote size={11} color="#b0540a" />}>Quote</Pill>
                  )}
                  {s.deposit_percent > 0 && <Pill>{`${s.deposit_percent}% deposit`}</Pill>}
                </View>
              </View>
              <View className="items-end gap-1">
                <Text className="font-semibold text-sand-900">
                  {s.price_cents !== null ? `${instant ? '' : 'from '}${formatZar(s.price_cents)}` : 'On quote'}
                </Text>
                <ChevronRight size={18} color="#a89c88" />
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

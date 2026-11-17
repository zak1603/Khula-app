import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BadgeCheck, MapPin, MessageSquareQuote, Store, Truck, Zap } from 'lucide-react-native';
import { formatDistance, formatZar, type BusinessSearchResult } from '@khula/shared';
import { Pill } from './ui';

export function BusinessCard({ business: b, index }: { business: BusinessSearchResult; index: number }) {
  const mobile = b.service_model === 'mobile_onsite';
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).springify().damping(18)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${b.name}, ${b.category_name}, ${mobile ? 'comes to you' : 'in-store'}`}
        onPress={() => router.push({ pathname: '/business/[id]', params: { id: b.id } })}
        className="mb-3 rounded-2xl border border-slate-200 bg-white p-4 active:bg-slate-50"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text className="flex-shrink text-base font-semibold text-slate-900" numberOfLines={1}>
                {b.name}
              </Text>
              {b.is_verified && <BadgeCheck size={16} color="#1a7e56" accessibilityLabel="Verified" />}
            </View>
            <Text className="mt-0.5 text-sm text-slate-500">{b.category_name}</Text>
          </View>
          {b.min_price_cents !== null && (
            <Text className="text-sm font-semibold text-slate-900">from {formatZar(b.min_price_cents)}</Text>
          )}
        </View>

        <View className="mt-2 flex-row items-center gap-1">
          <MapPin size={13} color="#64748b" />
          <Text className="text-xs text-slate-500">
            {b.suburb}, {b.city}
            {b.distance_km !== null && ` · ${formatDistance(b.distance_km)}`}
          </Text>
        </View>

        {/* Service-type indicators */}
        <View className="mt-3 flex-row flex-wrap gap-1.5">
          {mobile ? (
            <Pill tone="violet" icon={<Truck size={12} color="#6d28d9" />}>
              {b.travel_radius_km ? `Comes to you · ${Math.round(Number(b.travel_radius_km))} km` : 'Comes to you'}
            </Pill>
          ) : (
            <Pill tone="slate" icon={<Store size={12} color="#475569" />}>
              In-store
            </Pill>
          )}
          {b.has_instant_book && (
            <Pill tone="brand" icon={<Zap size={12} color="#156548" />}>
              Instant book
            </Pill>
          )}
          {b.has_quote_services && (
            <Pill tone="amber" icon={<MessageSquareQuote size={12} color="#b45309" />}>
              Free quotes
            </Pill>
          )}
          {mobile && b.services_your_area === false && <Pill tone="slate">Outside your area</Pill>}
        </View>
      </Pressable>
    </Animated.View>
  );
}

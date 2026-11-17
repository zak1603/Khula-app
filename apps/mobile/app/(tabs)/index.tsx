import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocateFixed, Search, SearchX, Store, Truck } from 'lucide-react-native';
import type { ServiceModel } from '@khula/shared';
import { brand, sand } from '@khula/shared/palette';
import { useBusinessSearch, useCategories } from '@/hooks/queries';
import { useDeviceLocation } from '@/hooks/use-location';
import { BusinessCard } from '@/components/business-card';
import { BeadStripe, Chip, Empty, ErrorText } from '@/components/ui';

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const LOCATION_MESSAGES: Record<string, string> = {
  denied: 'Location permission is off — showing all providers.',
  outside_sa: 'Khula is available in South Africa only.',
  error: "Couldn't get your location.",
};

// "Hello" in a different South African language each day.
const GREETINGS = ['Sawubona', 'Molo', 'Dumela', 'Hallo', 'Avuxeni', 'Lotjhani', 'Ndaa'] as const;
const greetingForToday = () => GREETINGS[Math.floor(Date.now() / 86_400_000) % GREETINGS.length];

const chipIcon = (selected: boolean) => (selected ? '#fff' : sand[700]);

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const [greeting] = useState(greetingForToday);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [serviceModel, setServiceModel] = useState<ServiceModel | undefined>();
  const location = useDeviceLocation();
  const q = useDebounced(query);
  const categories = useCategories();

  // Light status-bar icons over the dark hero; restore when leaving the tab.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      return () => setStatusBarStyle('dark');
    }, []),
  );

  const params = useMemo(
    () => ({ q: q.length >= 2 ? q : undefined, category, serviceModel, lat: location.point?.lat, lng: location.point?.lng }),
    [q, category, serviceModel, location.point],
  );
  const search = useBusinessSearch(params);
  const results = search.data?.pages.flat() ?? [];

  return (
    <View className="flex-1 bg-sand-50">
      <FlatList
        data={results}
        keyExtractor={(b) => b.id}
        renderItem={({ item, index }) => (
          <View className="px-4">
            <BusinessCard business={item} index={index} />
          </View>
        )}
        contentContainerClassName="pb-8"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={search.isRefetching} onRefresh={() => void search.refetch()} tintColor={brand[600]} />}
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View>
            {/* Hero */}
            <View className="rounded-b-3xl bg-brand-900 px-5 pb-6" style={{ paddingTop: insets.top + 20 }}>
              <Text className="text-xs font-bold uppercase tracking-widest text-sun-400">{greeting}</Text>
              <Text className="mt-2 text-3xl font-extrabold leading-tight tracking-tight text-white">
                Find a trusted pro,{'\n'}
                <Text className="text-sun-400">right here in Mzansi.</Text>
              </Text>
              <Text className="mt-2 text-sm leading-5 text-brand-100">From braids to burst geysers — book local, pay securely.</Text>

              <View className="mt-5 h-14 flex-row items-center gap-2.5 rounded-2xl bg-white px-4">
                <Search size={20} color={brand[700]} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Braids, plumber, maths tutor…"
                  placeholderTextColor={sand[400]}
                  className="flex-1 text-base text-ink"
                  returnKeyType="search"
                  maxLength={80}
                  accessibilityLabel="Search providers"
                />
              </View>

              <BeadStripe className="mt-6" />
            </View>

            {/* Filters */}
            <View className="gap-3 px-4 pb-3 pt-4">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                <Chip
                  label={location.point ? 'Near me' : 'Use my location'}
                  selected={!!location.point}
                  icon={location.status === 'loading' ? <ActivityIndicator size="small" /> : <LocateFixed size={14} color={chipIcon(!!location.point)} />}
                  onPress={() => (location.point ? location.clear() : location.request())}
                />
                <Chip label="In-store" selected={serviceModel === 'fixed_location'} icon={<Store size={14} color={chipIcon(serviceModel === 'fixed_location')} />} onPress={() => setServiceModel((m) => (m === 'fixed_location' ? undefined : 'fixed_location'))} />
                <Chip label="Comes to you" selected={serviceModel === 'mobile_onsite'} icon={<Truck size={14} color={chipIcon(serviceModel === 'mobile_onsite')} />} onPress={() => setServiceModel((m) => (m === 'mobile_onsite' ? undefined : 'mobile_onsite'))} />
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                <Chip label="All" selected={!category} onPress={() => setCategory(undefined)} />
                {categories.data?.map((c) => (
                  <Chip key={c.slug} label={c.name} selected={category === c.slug} onPress={() => setCategory((cur) => (cur === c.slug ? undefined : c.slug))} />
                ))}
              </ScrollView>

              {LOCATION_MESSAGES[location.status] && <Text className="text-xs text-sand-500">{LOCATION_MESSAGES[location.status]}</Text>}
              {location.point && <Text className="text-xs text-sand-500">Mobile providers are shown only if they travel to you.</Text>}
              <ErrorText error={search.error} />
            </View>
          </View>
        }
        ListEmptyComponent={
          search.isLoading ? (
            <ActivityIndicator className="mt-16" color={brand[600]} />
          ) : (
            <Empty icon={<SearchX size={22} color={sand[500]} />} title="No providers found" subtitle="Try another category, or widen your search." />
          )
        }
        ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : undefined}
      />
    </View>
  );
}

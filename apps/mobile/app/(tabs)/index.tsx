import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { LocateFixed, Search, SearchX, Store, Truck } from 'lucide-react-native';
import type { ServiceModel } from '@khula/shared';
import { useBusinessSearch, useCategories } from '@/hooks/queries';
import { useDeviceLocation } from '@/hooks/use-location';
import { BusinessCard } from '@/components/business-card';
import { Chip, Empty, ErrorText } from '@/components/ui';

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

export default function ExploreScreen() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [serviceModel, setServiceModel] = useState<ServiceModel | undefined>();
  const location = useDeviceLocation();
  const q = useDebounced(query);
  const categories = useCategories();

  const params = useMemo(
    () => ({ q: q.length >= 2 ? q : undefined, category, serviceModel, lat: location.point?.lat, lng: location.point?.lng }),
    [q, category, serviceModel, location.point],
  );
  const search = useBusinessSearch(params);
  const results = search.data?.pages.flat() ?? [];

  return (
    <View className="flex-1 bg-slate-50">
      <FlatList
        data={results}
        keyExtractor={(b) => b.id}
        renderItem={({ item, index }) => <BusinessCard business={item} index={index} />}
        contentContainerClassName="px-4 pb-8"
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
        }}
        refreshControl={<RefreshControl refreshing={search.isRefetching} onRefresh={() => void search.refetch()} tintColor="#1a7e56" />}
        keyboardDismissMode="on-drag"
        ListHeaderComponent={
          <View className="gap-3 pb-3 pt-2">
            <View className="h-12 flex-row items-center gap-2 rounded-xl border border-slate-200 bg-white px-3">
              <Search size={18} color="#64748b" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Braids, plumber, maths tutor…"
                placeholderTextColor="#94a3b8"
                className="flex-1 text-base text-slate-900"
                returnKeyType="search"
                maxLength={80}
                accessibilityLabel="Search providers"
              />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
              <Chip
                label={location.point ? 'Near me' : 'Use my location'}
                selected={!!location.point}
                icon={location.status === 'loading' ? <ActivityIndicator size="small" /> : <LocateFixed size={14} color={location.point ? '#fff' : '#334155'} />}
                onPress={() => (location.point ? location.clear() : location.request())}
              />
              <Chip label="In-store" selected={serviceModel === 'fixed_location'} icon={<Store size={14} color={serviceModel === 'fixed_location' ? '#fff' : '#334155'} />} onPress={() => setServiceModel((m) => (m === 'fixed_location' ? undefined : 'fixed_location'))} />
              <Chip label="Comes to you" selected={serviceModel === 'mobile_onsite'} icon={<Truck size={14} color={serviceModel === 'mobile_onsite' ? '#fff' : '#334155'} />} onPress={() => setServiceModel((m) => (m === 'mobile_onsite' ? undefined : 'mobile_onsite'))} />
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
              <Chip label="All" selected={!category} onPress={() => setCategory(undefined)} />
              {categories.data?.map((c) => (
                <Chip key={c.slug} label={c.name} selected={category === c.slug} onPress={() => setCategory((cur) => (cur === c.slug ? undefined : c.slug))} />
              ))}
            </ScrollView>

            {LOCATION_MESSAGES[location.status] && <Text className="text-xs text-slate-500">{LOCATION_MESSAGES[location.status]}</Text>}
            {location.point && <Text className="text-xs text-slate-500">Mobile providers are shown only if they travel to you.</Text>}
            <ErrorText error={search.error} />
          </View>
        }
        ListEmptyComponent={
          search.isLoading ? (
            <ActivityIndicator className="mt-16" color="#1a7e56" />
          ) : (
            <Empty icon={<SearchX size={22} color="#64748b" />} title="No providers found" subtitle="Try another category, or widen your search." />
          )
        }
        ListFooterComponent={search.isFetchingNextPage ? <ActivityIndicator className="my-4" /> : undefined}
      />
    </View>
  );
}

import '../global.css';
import { useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { KhulaApiError } from '@khula/shared';
import { AuthProvider, useAuth } from '@/providers/auth-provider';

// Refetch when the app returns to the foreground (React Query's "window focus" on native).
AppState.addEventListener('change', (s: AppStateStatus) => focusManager.setFocused(s === 'active'));
onlineManager.setOnline(true);

function RootNavigator() {
  const { status } = useAuth();
  const signedIn = status === 'signed_in';
  if (status === 'loading') return null; // splash stays up

  return (
    <Stack screenOptions={{ headerTintColor: '#115641', headerTitleStyle: { fontWeight: '600' }, contentStyle: { backgroundColor: '#faf8f5' } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="business/[id]" options={{ title: '' }} />

      {/* Booking & tracking require an account. */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="book/[serviceId]" options={{ title: 'Book', presentation: 'modal' }} />
        <Stack.Screen name="booking/[id]" options={{ title: 'Your booking' }} />
        <Stack.Screen name="payments/complete" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: (n, e) => !(e instanceof KhulaApiError && e.status > 0 && e.status < 500) && n < 2,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="dark" />
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

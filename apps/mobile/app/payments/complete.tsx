import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router } from 'expo-router';

/**
 * Deep-link landing for khula://payments/complete (Paystack callback).
 * Query params are NOT trusted — payment truth comes only from the signed
 * webhook, which flips the booking to "confirmed" and reaches the tracker
 * via realtime. This screen just returns the user to where they were.
 */
export default function PaymentComplete() {
  useEffect(() => {
    const t = setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/bookings')), 600);
    return () => clearTimeout(t);
  }, []);
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-white">
      <ActivityIndicator color="#146b4f" />
      <Text className="text-sand-500">Confirming your payment…</Text>
    </View>
  );
}

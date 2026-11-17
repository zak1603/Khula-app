import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerTintColor: '#115641', contentStyle: { backgroundColor: '#fff' } }}>
      <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
    </Stack>
  );
}

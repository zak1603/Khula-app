import { Tabs } from 'expo-router';
import { CalendarCheck2, Compass, UserRound } from 'lucide-react-native';
import { brand, ink, sand } from '@khula/shared/palette';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: brand[700],
        tabBarInactiveTintColor: sand[400],
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: sand[200] },
        tabBarLabelStyle: { fontWeight: '600' },
        headerStyle: { backgroundColor: sand[50] },
        headerTitleStyle: { fontWeight: '800', color: ink.DEFAULT },
        headerShadowVisible: false,
      }}
    >
      {/* Explore draws its own hero, so it has no navigation header. */}
      <Tabs.Screen name="index" options={{ title: 'Explore', headerShown: false, tabBarIcon: ({ color, size }) => <Compass color={color} size={size} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: ({ color, size }) => <CalendarCheck2 color={color} size={size} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }} />
    </Tabs>
  );
}

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { trackerSteps, type AppointmentStatus, type JobProgress } from '@khula/shared';

/** Live progress tracker. Animates whenever a realtime update moves the booking forward. */
export function StatusTimeline({ status, progress, isMobile }: { status: AppointmentStatus; progress: JobProgress; isMobile: boolean }) {
  const steps = trackerSteps(status, progress, isMobile);
  const doneCount = steps.filter((s) => s.done).length;
  const fraction = steps.length > 1 ? (doneCount - 1) / (steps.length - 1) : 0;

  const fill = useSharedValue(0);
  useEffect(() => {
    fill.value = withTiming(fraction, { duration: 700, easing: Easing.out(Easing.cubic) });
  }, [fraction, fill]);
  const fillStyle = useAnimatedStyle(() => ({ height: `${fill.value * 100}%` }));

  if (status === 'cancelled') {
    return (
      <View className="rounded-2xl bg-sand-100 p-4">
        <Text className="font-semibold text-sand-600">This booking was cancelled.</Text>
      </View>
    );
  }

  return (
    <View className="flex-row" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: steps.length, now: doneCount }}>
      <View className="mr-4 w-1 items-center">
        <View className="absolute bottom-4 top-4 w-1 overflow-hidden rounded-full bg-sand-200">
          <Animated.View className="w-1 bg-brand-500" style={fillStyle} />
        </View>
      </View>
      <View className="flex-1 gap-5">
        {steps.map((s) => (
          <View key={s.key} className="-ml-[26px] flex-row items-center gap-3">
            <StepDot done={s.done} current={s.current} />
            <Text className={s.current ? 'text-base font-semibold text-sand-900' : s.done ? 'text-base text-sand-700' : 'text-base text-sand-400'}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function StepDot({ done, current }: { done: boolean; current: boolean }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = current
      ? withRepeat(withSequence(withTiming(1.35, { duration: 650 }), withTiming(1, { duration: 650 })), -1)
      : withTiming(1);
  }, [current, pulse]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: current ? 2 - pulse.value : 0 }));

  return (
    <View className="h-6 w-6 items-center justify-center">
      <Animated.View className="absolute h-6 w-6 rounded-full bg-brand-200" style={ring} />
      <View className={done ? 'h-6 w-6 items-center justify-center rounded-full bg-brand-600' : 'h-6 w-6 rounded-full border-2 border-sand-300 bg-white'}>
        {done && <Check size={14} color="#fff" strokeWidth={3} />}
      </View>
    </View>
  );
}

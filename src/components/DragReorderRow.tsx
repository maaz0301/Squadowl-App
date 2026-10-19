import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

/**
 * A list row with a grip on the left: press and hold it, then drag. The row
 * follows the finger and, on release, lands where the finger left it (judged by
 * the neighbours' measured heights). The caller applies the new order.
 */
export function DragReorderRow({
  index,
  total,
  heightOf,
  onMeasure,
  onMove,
  gripColor,
  children,
}: {
  index: number;
  total: number;
  heightOf: (index: number) => number;
  onMeasure: (height: number) => void;
  onMove: (from: number, to: number) => void;
  gripColor: string;
  children: ReactNode;
}) {
  const translateY = useSharedValue(0);
  const lifted = useSharedValue(0);

  const drop = (dy: number) => {
    let target = index;
    let rest = dy;
    if (dy > 0) {
      for (let j = index + 1; j < total && rest > heightOf(j) / 2; j++) {
        rest -= heightOf(j);
        target = j;
      }
    } else {
      for (let j = index - 1; j >= 0 && -rest > heightOf(j) / 2; j--) {
        rest += heightOf(j);
        target = j;
      }
    }
    if (target !== index) onMove(index, target);
  };

  const pan = Gesture.Pan()
    .activateAfterLongPress(150)
    .onStart(() => {
      lifted.value = 1;
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
    })
    .onEnd((e) => {
      runOnJS(drop)(e.translationY);
    })
    .onFinalize(() => {
      lifted.value = 0;
      translateY.value = 0;
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: lifted.value ? 1.02 : 1 }],
    zIndex: lifted.value ? 10 : 0,
    opacity: lifted.value ? 0.92 : 1,
    elevation: lifted.value ? 4 : 0,
  }));

  return (
    <Animated.View onLayout={(e) => onMeasure(e.nativeEvent.layout.height)} className="flex-row items-stretch" style={style}>
      <GestureDetector gesture={pan}>
        <View accessibilityLabel="Hold and drag to reorder" hitSlop={8} className="pr-2 justify-center">
          <Text style={{ color: gripColor, fontSize: 20 }}>⠿</Text>
        </View>
      </GestureDetector>
      <View className="flex-1">{children}</View>
    </Animated.View>
  );
}

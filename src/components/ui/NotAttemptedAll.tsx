import { Alert, Pressable, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { allNotAttempted, withAllNotAttempted, withoutAnyNotAttempted } from '@/lib/notAttempted';

/**
 * One line above a skater's tests for the case where they took none of them: marks every test
 * as not attempted (N/A on reports, out of the overall score). Undo takes the marks back off.
 */
export function NotAttemptedAll({
  keys,
  scores,
  onChange,
}: {
  keys: string[];
  scores: Record<string, number> | undefined;
  onChange: (next: Record<string, number>) => void;
}) {
  const colors = useThemeColors();
  if (!keys.length) return null;
  const all = allNotAttempted(scores, keys);
  const hasResults = keys.some((k) => scores?.[k] != null);

  const markAll = () => {
    const go = () => onChange(withAllNotAttempted(scores, keys));
    if (!hasResults) return go();
    Alert.alert('Did not attempt anything?', 'The scores entered so far are cleared and every test is marked N/A.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Mark all N/A', style: 'destructive', onPress: go },
    ]);
  };

  return (
    <View className="flex-row items-center justify-between mb-3 rounded-lg border px-3 py-2" style={{ borderColor: colors.border }}>
      {all ? (
        <>
          <Text className="flex-1 text-xs font-bold" style={{ color: colors.inkMuted }}>N/A: did not attempt any test</Text>
          <Pressable onPress={() => onChange(withoutAnyNotAttempted(scores, keys))} hitSlop={8} accessibilityRole="button">
            <Text className="text-xs font-bold" style={{ color: colors.primary }}>Undo</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text className="flex-1 text-xs" style={{ color: colors.inkMuted }}>Skater took none of these tests?</Text>
          <Pressable onPress={markAll} hitSlop={8} accessibilityRole="button" accessibilityLabel="Mark every test as not attempted">
            <Text className="text-xs font-bold" style={{ color: colors.primary }}>Did not attempt anything</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

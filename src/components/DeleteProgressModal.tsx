import { ActivityIndicator, Modal as RNModal, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Blocking overlay for a bulk delete, so a big one visibly works instead of
 * looking frozen. Deliberately not dismissable: closing it would not stop the
 * delete, only hide it.
 */
export function DeleteProgressModal({
  visible,
  progress,
  noun = 'players',
}: {
  visible: boolean;
  progress: { done: number; total: number } | null;
  noun?: string;
}) {
  const colors = useThemeColors();
  const total = progress?.total ?? 0;
  const done = Math.min(progress?.done ?? 0, total);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const finishing = total > 0 && done >= total;

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View className="flex-1 items-center justify-center px-6" style={{ backgroundColor: colors.overlay }}>
        <View
          className="w-full items-center rounded-2xl border px-6 py-8"
          style={{ backgroundColor: colors.card, borderColor: colors.border, gap: 18 }}
        >
          <ActivityIndicator size="large" color={colors.primary} />

          <Text className="text-2xl font-display font-bold text-center" style={{ color: colors.ink }}>
            {finishing ? 'Finishing up...' : `Deleting ${noun}...`}
          </Text>

          <Text
            className="font-display font-bold"
            style={{ color: colors.primary, fontSize: 56, lineHeight: 62 }}
            accessibilityLabel={`${pct} percent`}
          >
            {pct}%
          </Text>

          <View
            style={{ width: '100%', height: 14, borderRadius: 999, overflow: 'hidden', backgroundColor: colors.tile }}
          >
            <View
              style={{
                width: `${Math.max(3, pct)}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: colors.primary,
              }}
            />
          </View>

          <Text className="text-lg font-bold text-center" style={{ color: colors.ink }}>
            {total > 0 ? `${done.toLocaleString()} of ${total.toLocaleString()} ${noun}` : 'Getting started...'}
          </Text>

          <Text className="text-base text-center" style={{ color: colors.inkMuted }}>
            Please keep the app open until this finishes.
          </Text>
        </View>
      </View>
    </RNModal>
  );
}

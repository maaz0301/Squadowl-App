import { Alert, Platform, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card } from '@/components/ui';
import { useSetSupportAccessMutation, useSupportAccessQuery } from '@/features/queries';

const formatDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const notify = (title: string, message: string) => {
  if (Platform.OS === 'web') (globalThis as any).alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
};

/**
 * The club decides whether SquadOwl support may "View as" its account to help
 * with a problem. Off by default; a grant lasts a few days and can be withdrawn
 * at any time. Every use is written to the audit log. Same card as web's
 * Manage Organization page.
 */
export function SupportAccessCard() {
  const colors = useThemeColors();
  const query = useSupportAccessQuery();
  const set = useSetSupportAccessMutation();

  const run = async (days: number) => {
    try {
      await set.mutateAsync(days);
      notify(days === 0 ? 'Access withdrawn' : 'Access allowed', days === 0 ? 'Support can no longer view your account.' : `Support can view your account for ${days} days.`);
    } catch (e: any) {
      notify('Could Not Update', e?.message || 'Something went wrong.');
    }
  };

  const until = query.data;
  return (
    <Card className="gap-2 mb-4">
      <View className="flex-row items-center gap-2">
        <Text className="font-bold" style={{ color: colors.ink }}>
          Support access
        </Text>
        {until ? <Badge label={`Allowed until ${formatDay(until)}`} variant="success" /> : <Badge label="Off" />}
      </View>
      <Text className="text-sm" style={{ color: colors.inkMuted }}>
        Let SquadOwl support look at your account, read only, to help fix a problem. Nothing can be changed while they
        look, and every visit is logged. It switches itself off when the time is up.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button label="Allow for 7 days" size="sm" variant="secondary" loading={set.isPending} onPress={() => run(7)} />
        {until ? <Button label="Withdraw access" size="sm" variant="ghost" loading={set.isPending} onPress={() => run(0)} /> : null}
      </View>
    </Card>
  );
}

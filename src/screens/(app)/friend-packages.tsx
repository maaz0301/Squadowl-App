import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Header, Screen } from '@/components/ui';

const PACKAGES = [
  {
    id: 'starter',
    name: 'Starter Gift',
    price: '$29.99',
    description: '1 year Coach plan for a fellow coach',
    seats: 1,
  },
  {
    id: 'club',
    name: 'Club Bundle',
    price: '$149.99',
    description: '3 Club plan seats — great for assistant coaches',
    seats: 3,
    highlight: true,
  },
  {
    id: 'team',
    name: 'Team Pack',
    price: '$399.99',
    description: 'Full season for an entire coaching staff (5 seats)',
    seats: 5,
  },
];

export default function FriendPackagesScreen() {
  const colors = useThemeColors();

  return (
    <Screen scroll>
      <Header title="Gift a Coach" subtitle="Friend packages" showBack />
      <Card accent className="mt-4 mb-4 gap-2">
        <Text className="font-display font-bold" style={{ color: colors.ink }}>
          Share Athlete Assessment
        </Text>
        <Text style={{ color: colors.inkMuted }}>
          Purchase plan gifts for assistant coaches, board members, or parent volunteers.
          Checkout is mocked for Phase 1 — no payment is processed.
        </Text>
      </Card>

      {PACKAGES.map((pkg) => (
        <Card key={pkg.id} accent={pkg.highlight} className="mb-3 gap-2">
          <View className="flex-row justify-between items-start">
            <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
              {pkg.name}
            </Text>
            <Badge label={`${pkg.seats} seat${pkg.seats > 1 ? 's' : ''}`} variant="brand" />
          </View>
          <Text style={{ color: colors.inkMuted }}>{pkg.description}</Text>
          <View className="flex-row items-baseline">
            <Text className="text-sm font-sans mr-1" style={{ color: colors.inkMuted }}>CAD</Text>
            <Text className="text-xl font-display font-bold" style={{ color: colors.primary }}>
              {pkg.price}
            </Text>
          </View>
          <Button label="Purchase (Demo)" variant={pkg.highlight ? 'primary' : 'secondary'} />
        </Card>
      ))}
    </Screen>
  );
}

import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors } from '@/theme/ThemeProvider';

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  right?: React.ReactNode;
}

export function Header({ title, subtitle, showBack, right }: HeaderProps) {
  const colors = useThemeColors();
  const router = useRouter();
  return (
    <View className="flex-row items-center justify-between py-4 gap-3">
      <View className="flex-row items-center flex-1 gap-3">
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            className="w-10 h-10 rounded-full items-center justify-center"
            style={{ backgroundColor: colors.tile }}
            hitSlop={8}
          >
            <Text style={{ color: colors.ink, fontSize: 20 }}>←</Text>
          </Pressable>
        ) : null}
        <View className="flex-1">
          <Text className="text-2xl font-display font-bold" style={{ color: colors.ink }}>
            {title}
          </Text>
          {subtitle ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {right}
    </View>
  );
}

import { Pressable, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
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
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="M15 19l-7-7 7-7"
                stroke={colors.ink}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
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

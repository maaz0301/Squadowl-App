import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Screen } from '@/components/ui';
import { useOnboardingStore } from '@/state/uiStore';
import { APP_CONFIG } from '@/config/app';

export default function WelcomeScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const skipWizard = useOnboardingStore((s) => s.skipWizard);

  return (
    <Screen className="justify-center">
      <View className="gap-6">
        <View className="gap-2">
          <Text className="text-3xl font-display font-bold" style={{ color: colors.ink }}>
            Welcome to {APP_CONFIG.appName}
          </Text>
          <Text className="text-base leading-relaxed" style={{ color: colors.inkMuted }}>
            Run athlete tryouts and evaluations from your phone. Score players rinkside, manage
            rosters, and share results, all in one place.
          </Text>
        </View>

        <View className="gap-3">
          {[
            'Create teams & evaluations',
            'QR athlete registration',
            'Rinkside rubric scoring',
            'Results & leaderboard',
          ].map((item) => (
            <View key={item} className="flex-row items-center gap-3">
              <View
                className="w-8 h-8 rounded-full items-center justify-center"
                style={{ backgroundColor: 'rgba(255,107,43,0.15)' }}
              >
                <Text style={{ color: colors.primary }}>✓</Text>
              </View>
              <Text className="text-base flex-1" style={{ color: colors.ink }}>
                {item}
              </Text>
            </View>
          ))}
        </View>

        <Button 
          label="Get Started" 
          onPress={() => {
            skipWizard();
            navigation.replace('App', { screen: 'DashboardMain' });
          }} 
        />
      </View>
    </Screen>
  );
}

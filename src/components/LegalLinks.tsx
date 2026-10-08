import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '@/config/app';
import { useThemeColors } from '@/theme/ThemeProvider';

async function open(url: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Could not open the page', `Please visit ${url} in your browser.`);
  }
}

/**
 * Privacy Policy and Terms of Service, shown under sign in and sign up and on
 * Profile. The pages are on the web app so the same text serves the store
 * listings and signed-out visitors.
 */
export function LegalLinks({ prefix = false }: { /** "By continuing you agree to..." wording, for the sign in and sign up screens. */ prefix?: boolean }) {
  const colors = useThemeColors();
  const link = (label: string, url: string) => (
    <Pressable onPress={() => open(url)} accessibilityRole="link" accessibilityLabel={label} hitSlop={8}>
      <Text className="text-xs font-bold underline" style={{ color: colors.primary }}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View
      className="flex-row flex-wrap items-center justify-center py-3"
      style={{ columnGap: 8, rowGap: 4 }}
    >
      {prefix ? (
        <Text className="text-xs" style={{ color: colors.inkMuted }}>
          By continuing you agree to the
        </Text>
      ) : null}
      {link('Terms of Service', TERMS_OF_SERVICE_URL)}
      <Text className="text-xs" style={{ color: colors.inkMuted }}>
        {prefix ? 'and' : '·'}
      </Text>
      {link('Privacy Policy', PRIVACY_POLICY_URL)}
    </View>
  );
}

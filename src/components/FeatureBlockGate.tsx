import { useState } from 'react';
import { Linking, Text } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button, Card } from '@/components/ui';
import { useAuthStore } from '@/state/authStore';
import { BLOCKABLE_FEATURE_LABEL, type BlockableFeature } from '@/lib/blockableFeatures';

interface Props {
  feature: BlockableFeature;
  /**
   * Show a Sign Out button here too — only where this notice could be the one
   * reachable screen left, e.g. Profile, which is normally where Sign Out lives.
   */
  allowSignOut?: boolean;
}

/**
 * Shown in place of one hub section's content when the founder has turned it
 * off for this account — same role as web's FeatureBlockedScreen (see
 * src/components/AccountAccessNotices.tsx in the web repo). A UI-level gate,
 * not a data boundary.
 */
export function FeatureBlockGate({ feature, allowSignOut }: Props) {
  const colors = useThemeColors();
  const logout = useAuthStore((s) => s.logout);
  const [signingOut, setSigningOut] = useState(false);

  return (
    <Card accent className="gap-3 my-4">
      <Text className="text-lg font-display font-bold" style={{ color: colors.ink }}>
        {BLOCKABLE_FEATURE_LABEL[feature]} is unavailable
      </Text>
      <Text style={{ color: colors.inkMuted }}>
        The rest of your account is unaffected, contact TryoutHQ if you think this is a mistake.
      </Text>
      <Button label="Email founder@tryout.ca" onPress={() => Linking.openURL('mailto:founder@tryout.ca')} />
      {allowSignOut ? (
        <Button
          label="Sign Out"
          variant="ghost"
          loading={signingOut}
          onPress={async () => {
            if (signingOut) return;
            setSigningOut(true);
            try {
              await logout();
            } finally {
              setSigningOut(false);
            }
          }}
        />
      ) : null}
    </Card>
  );
}

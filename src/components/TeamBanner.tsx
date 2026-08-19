import { Image, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Badge } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { Team } from '@/data/types';

/**
 * The team's identity strip, meant to sit at the top of every team-scoped
 * screen ("Banner at the top from screen to screen") so a coach who has drilled
 * into a schedule or a player card can still see whose team they're in.
 *
 * It renders from the team's own branding — uploaded logo plus the brand colour
 * chosen on the team settings screen — and falls back to the app theme when a
 * team hasn't personalized itself.
 */

interface TeamBannerProps {
  team: Pick<Team, 'id' | 'name' | 'season' | 'logoUrl' | 'brandColor' | 'managed'>;
  /** Right-hand actions (chat, edit). Rendered on the banner, tinted to match. */
  right?: React.ReactNode;
  /** Line under the team name; defaults to the season label. */
  subtitle?: string;
  /** Tapping the banner returns to the team hub. Off on the hub itself. */
  linkToHub?: boolean;
  className?: string;
}

export function TeamBanner({ team, right, subtitle, linkToHub = true, className }: TeamBannerProps) {
  const colors = useThemeColors();
  const navigation = useNavigation<any>();

  // The banner itself stays theme-coloured — only the screen background behind
  // it (Screen's `backgroundColor` prop, driven by teamBrandSurfaces.screenBg)
  // carries the team's brand colour. Keeps the identity strip readable on top
  // of any wash instead of doubling the colour.
  const bg = colors.tile;
  const ink = colors.ink;
  const inkMuted = colors.inkMuted;
  const line = subtitle ?? team.season;

  const body = (
    <View
      className="flex-row items-center gap-3 rounded-2xl px-4 py-3"
      style={{ backgroundColor: bg, borderWidth: 1, borderColor: colors.border }}
    >
      {team.logoUrl ? (
        <Image
          source={{ uri: team.logoUrl }}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)' }}
          resizeMode="cover"
        />
      ) : (
        <View
          className="w-11 h-11 rounded-full items-center justify-center"
          style={{ backgroundColor: colors.bgSecondary }}
        >
          <Text className="font-display font-bold text-lg" style={{ color: ink }}>
            {team.name.trim().slice(0, 1).toUpperCase() || 'T'}
          </Text>
        </View>
      )}

      <View className="flex-1">
        <Text numberOfLines={1} className="font-display font-bold text-lg" style={{ color: ink }}>
          {team.name}
        </Text>
        {line ? (
          <Text numberOfLines={1} className="text-xs" style={{ color: inkMuted }}>
            {line}
          </Text>
        ) : null}
      </View>

      {/* A delegated coach sees whose team this is, so a club-owned team is never
          mistaken for one of their own. */}
      {team.managed ? <Badge label="Managed" variant="info" /> : null}
      {right}
    </View>
  );

  if (!linkToHub) return <View className={className}>{body}</View>;

  return (
    <Pressable className={className} onPress={() => navigation.navigate('TeamDetail', { id: team.id })}>
      {body}
    </Pressable>
  );
}

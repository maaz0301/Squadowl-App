import { Image, Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { HubIcon } from './HubIcon';
import { HUB_ICONS, useHubSurfaces } from './hubTheme';

interface TeamHubHeaderProps {
  name: string;
  subtitle?: string;
  logoUrl?: string | null;
  onChat: () => void;
  /** Unread pill, drawn on the chat button's corner. */
  chatBadge?: React.ReactNode;
  /** Omitted for people who can't edit the team. */
  onEdit?: () => void;
}

/**
 * The hub's top row: back, crest, "<Team> Hub" with its season, then the two
 * pill actions. One compact line instead of a title bar plus a banner card.
 */
export function TeamHubHeader({ name, subtitle, logoUrl, onChat, chatBadge, onEdit }: TeamHubHeaderProps) {
  const colors = useThemeColors();
  const s = useHubSurfaces();
  const navigation = useNavigation<any>();

  const goBack = () => {
    const parent = navigation.getParent();
    if (parent?.canGoBack()) parent.goBack();
    else if (navigation.canGoBack()) navigation.goBack();
  };

  return (
    <View className="flex-row items-center gap-2 pt-3 pb-4">
      <Pressable
        onPress={goBack}
        hitSlop={8}
        className="items-center justify-center rounded-full"
        style={{ width: 30, height: 30, backgroundColor: s.panelBg, borderWidth: 1, borderColor: s.panelBorder }}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <HubIcon d={HUB_ICONS.chevronLeft} size={16} color={colors.ink} />
      </Pressable>

      <Image
        source={logoUrl ? { uri: logoUrl } : require('../../../assets/TryoutHQ-logo.png')}
        style={{ width: 38, height: 38, borderRadius: logoUrl ? 19 : 0 }}
        resizeMode={logoUrl ? 'cover' : 'contain'}
      />

      <View className="flex-1">
        <Text numberOfLines={1} className="text-lg font-display font-bold" style={{ color: colors.ink }}>
          {name} Hub
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="text-xs" style={{ color: colors.inkMuted }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={onChat}
        hitSlop={6}
        className="flex-row items-center gap-1.5 rounded-full px-3"
        style={{ height: 32, backgroundColor: s.panelBg, borderWidth: 1, borderColor: s.panelBorder }}
        accessibilityRole="button"
        accessibilityLabel="Team chat"
      >
        <HubIcon d={HUB_ICONS.chat} size={14} color={colors.ink} />
        <Text className="text-xs font-bold" style={{ color: colors.ink }}>
          Team Chat
        </Text>
        {chatBadge ? (
          <View className="absolute" style={{ top: -6, right: -4 }} pointerEvents="none">
            {chatBadge}
          </View>
        ) : null}
      </Pressable>

      {onEdit ? (
        <Pressable
          onPress={onEdit}
          hitSlop={6}
          className="items-center justify-center rounded-full px-4"
          style={{ height: 32, backgroundColor: s.orangeBg, borderWidth: 1, borderColor: colors.primary }}
          accessibilityRole="button"
          accessibilityLabel="Edit team"
        >
          <Text className="text-xs font-bold" style={{ color: colors.primary }}>
            Edit
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

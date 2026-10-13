import { useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { useLibraryQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';
import { VideoPlayerModal } from './VideoPlayerModal';

/** Library videos tagged to this player. Hidden when there are none. */
export function TaggedVideos({ athleteId }: { athleteId: string | undefined }) {
  const colors = useThemeColors();
  const library = useLibraryQuery({ enabled: !!athleteId });
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);

  const videos = (library.data ?? []).filter((i) => i.kind === 'video' && !!athleteId && i.athleteId === athleteId);
  if (!videos.length) return null;

  const play = async (item: (typeof videos)[number]) => {
    const stored = item.video?.url;
    if (stored) {
      setPlaying({ url: stored, title: item.title });
      return;
    }
    // A video hosted elsewhere (YouTube, Vimeo) opens in the browser.
    if (item.url && /^https?:\/\//i.test(item.url)) {
      await Linking.openURL(item.url).catch(() => Alert.alert('Could not open the video'));
    } else {
      Alert.alert('Nothing to play', 'This video has no playable address yet.');
    }
  };

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Videos tagged to this player
      </Text>
      {videos.map((item) => (
        <View key={item.id} className="flex-row items-center gap-2 rounded-xl border p-2.5" style={{ borderColor: colors.border }}>
          <Text className="flex-1 text-sm font-bold" style={{ color: colors.ink }} numberOfLines={1}>
            {item.title}
          </Text>
          <Button size="sm" variant="secondary" label="Play" onPress={() => play(item)} />
        </View>
      ))}
      <VideoPlayerModal url={playing?.url ?? null} title={playing?.title ?? ''} onClose={() => setPlaying(null)} />
    </View>
  );
}

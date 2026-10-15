import { useMemo, useState } from 'react';
import { Alert, Linking, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { useLibraryQuery, useSearchAthletesQuery } from '@/features/queries';
import { foldAthletes } from '@/data/duplicates';
import { useThemeColors } from '@/theme/ThemeProvider';
import { VideoPlayerModal } from './VideoPlayerModal';


/** Who the report card is for, to find their other athlete records by name. */
export interface TaggedPerson {
  first: string;
  last: string;
}

/**
 * Every athlete record that is this same person. A player added to several
 * evaluations has several records, and a video can be tagged to any one of them,
 * so a report card looks for tags on all of them, not only on its own record.
 */
function useSamePersonIds(athleteId: string | undefined, person: TaggedPerson | undefined, needed: boolean): Set<string> {
  const same = useSearchAthletesQuery(needed && person ? `${person.first} ${person.last}` : '');
  return useMemo(() => {
    const ids = new Set<string>(athleteId ? [athleteId] : []);
    if (!athleteId) return ids;
    const group = foldAthletes(same.data ?? []).find((g) => g.id === athleteId || g.alsoIds.includes(athleteId));
    if (group) for (const id of [group.id, ...group.alsoIds]) ids.add(id);
    return ids;
  }, [athleteId, same.data]);
}

/** Library videos tagged to this player, on any of their athlete records. Hidden when there are none. */
export function TaggedVideos({ athleteId, person }: { athleteId: string | undefined; person?: TaggedPerson }) {
  const colors = useThemeColors();
  const library = useLibraryQuery({ enabled: !!athleteId });
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);

  const tagged = (library.data ?? []).filter((i) => i.kind === 'video' && !!i.athleteId);
  // Only look for other records when a video is tagged to one that isn't this one.
  const ids = useSamePersonIds(athleteId, person, !!athleteId && tagged.some((i) => i.athleteId !== athleteId));
  const videos = tagged.filter((i) => ids.has(i.athleteId as string));
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

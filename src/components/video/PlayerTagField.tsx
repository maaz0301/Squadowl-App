import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Button, Input } from '@/components/ui';
import { useSearchAthletesQuery } from '@/features/queries';
import { foldAthletes } from '@/data/duplicates';
import type { Athlete } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

const MAX_RESULTS = 6;

/**
 * Tags a video (or any Library item) with a player. Searches the players in the
 * coach's teams and evaluations; the tagged item also shows on that player's
 * report card screen. Optional, so it starts empty.
 */
export function PlayerTagField({ value, onChange }: { value: string | null; onChange: (athleteId: string | null) => void }) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  // An account can hold tens of thousands of athletes, so matches come from a server
  // search, asked only once typing pauses.
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  const search = useSearchAthletesQuery(term);
  const [chosen, setChosen] = useState<Athlete | null>(null);

  const typed = query.trim().length >= 2;
  // One entry per person: a player on several evaluations has several athlete records.
  const matches = typed ? foldAthletes(search.data ?? []).slice(0, MAX_RESULTS) : [];
  const searching = typed && (term !== query || search.isFetching);
  const shown = chosen && chosen.id === value ? chosen : null;

  return (
    <View className="gap-1.5">
      <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Tag a player (optional)
      </Text>
      {value ? (
        <View className="flex-row items-center justify-between rounded-xl border px-3 py-2" style={{ borderColor: colors.primary }}>
          <Text className="flex-1 font-bold" style={{ color: colors.ink }} numberOfLines={1}>
            {shown ? `${shown.first} ${shown.last}` : 'Tagged player'}
            {shown?.currentTeam ? <Text className="font-normal" style={{ color: colors.inkMuted }}>{`  ${shown.currentTeam}`}</Text> : null}
          </Text>
          <Button size="sm" variant="ghost" label="Remove" onPress={() => onChange(null)} />
        </View>
      ) : (
        <>
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Search players by name"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.trim() && !typed ? (
            <Text className="text-xs" style={{ color: colors.inkMuted }}>Type at least 2 letters.</Text>
          ) : null}
          {typed && !matches.length ? (
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {searching ? 'Searching...' : search.isError ? 'Could not search players. Try again.' : 'No players match.'}
            </Text>
          ) : null}
          {matches.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => {
                setChosen(a);
                onChange(a.id);
                setQuery('');
                setTerm('');
              }}
              className="rounded-xl border px-3 py-2"
              style={{ borderColor: colors.border, backgroundColor: colors.tile }}
            >
              <Text className="font-bold" style={{ color: colors.ink }}>
                {a.first} {a.last}
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {[a.currentTeam, a.jersey ? `#${a.jersey}` : '', a.yearOfBirth].filter(Boolean).join(' · ') || 'No team yet'}
              </Text>
            </Pressable>
          ))}
        </>
      )}
      <Text className="text-xs" style={{ color: colors.inkMuted }}>
        The video also appears on this player's report card.
      </Text>
    </View>
  );
}

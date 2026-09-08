import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, Input, Modal } from '@/components/ui';
import { useUpdateTryoutMutation } from '@/features/queries';
import { generateId, playerDisplayName } from '@/data/rubrics';
import type { FriendPackage } from '@/data/teamBuilder';
import type { Player, Tryout } from '@/data/types';

/** A package needs at least two players to mean anything — one player is just a player. */
const MIN_MEMBERS = 2;

/**
 * One colour per package, cycled by position — the same device the team cards
 * use. The colour, not the name, is what makes a group scannable once there are
 * several of them stacked on a phone screen.
 */
const PACKAGE_ACCENTS = ['#38bdf8', '#22c55e', '#a78bfa', '#f472b6', '#facc15', '#2dd4bf'] as const;

interface Props {
  tryout: Tryout;
  /** Disabled while a split is generating, so the roster can't change under the build. */
  disabled?: boolean;
}

/**
 * Friend packages a coach builds by hand: pick the players who must end up on
 * the same team, name the group, and every Generate from here on keeps them
 * together.
 *
 * These sit alongside the groups the builder infers from the friend names on
 * registration forms — see resolveFriendPackages(), which puts the hand-built
 * ones first — so this card is for the cases the forms don't capture:
 * carpools, siblings with different surnames, a coach's own kid.
 */
export function FriendPackagesCard({ tryout, disabled }: Props) {
  const colors = useThemeColors();
  const updateTryout = useUpdateTryoutMutation();

  const [editing, setEditing] = useState<FriendPackage | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState('');

  const packages = useMemo(() => tryout.friendPackages ?? [], [tryout.friendPackages]);

  const playerById = useMemo(() => new Map(tryout.roster.map((p) => [p.id, p])), [tryout.roster]);

  // Players already spoken for by a *different* package. One player in two
  // packages would silently lose one of them at build time (buildTeams maps
  // each player to the first package that claims them), so the picker takes
  // them off the table instead and says which group has them.
  const claimedElsewhere = useMemo(() => {
    const map = new Map<string, string>();
    for (const pkg of packages) {
      if (pkg.id === editing?.id) continue;
      for (const id of pkg.playerIds) map.set(id, pkg.name);
    }
    return map;
  }, [packages, editing?.id]);

  const sortedRoster = useMemo(
    () => [...tryout.roster].sort((a, b) => `${a.last}${a.first}`.localeCompare(`${b.last}${b.first}`)),
    [tryout.roster],
  );

  const visibleRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRoster;
    return sortedRoster.filter((p) => playerDisplayName(p).toLowerCase().includes(q));
  }, [sortedRoster, search]);

  const save = async (next: FriendPackage[]) => {
    await updateTryout.mutateAsync({ id: tryout.id, updates: { friendPackages: next } });
  };

  const openNew = () => {
    setIsNew(true);
    setSearch('');
    setEditing({ id: generateId('pkg'), name: `Package ${packages.length + 1}`, playerIds: [] });
  };

  const openEdit = (pkg: FriendPackage) => {
    setIsNew(false);
    setSearch('');
    setEditing({ ...pkg, playerIds: [...pkg.playerIds] });
  };

  const toggleMember = (playerId: string) => {
    setEditing((cur) =>
      cur
        ? {
            ...cur,
            playerIds: cur.playerIds.includes(playerId)
              ? cur.playerIds.filter((id) => id !== playerId)
              : [...cur.playerIds, playerId],
          }
        : cur,
    );
  };

  const handleSave = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      Alert.alert('Name required', 'Give the package a name so you can recognise it later.');
      return;
    }
    if (editing.playerIds.length < MIN_MEMBERS) {
      Alert.alert(
        'Pick at least two players',
        'A friend package is the group that has to stay together, so it needs at least two players.',
      );
      return;
    }
    const saved: FriendPackage = { ...editing, name };
    const next = isNew ? [...packages, saved] : packages.map((p) => (p.id === saved.id ? saved : p));
    try {
      await save(next);
      setEditing(null);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'The package was not saved.');
    }
  };

  const handleDelete = (pkg: FriendPackage) => {
    Alert.alert(
      'Delete this package?',
      `"${pkg.name}" will no longer be kept together when you generate teams. The players stay on the roster.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await save(packages.filter((p) => p.id !== pkg.id));
            } catch (e: any) {
              Alert.alert('Could not delete', e?.message ?? 'The package was not deleted.');
            }
          },
        },
      ],
    );
  };

  const memberNames = (pkg: FriendPackage) =>
    pkg.playerIds
      .map((id) => playerById.get(id))
      .filter((p): p is Player => !!p)
      .map((p) => playerDisplayName(p));

  return (
    <>
      <Card accent className="mb-4 gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="font-display font-bold text-base" style={{ color: colors.ink }}>
            🤝 Friend Packages
          </Text>
          {packages.length > 0 ? (
            <Badge label={`${packages.length} kept together`} variant="success" />
          ) : null}
        </View>

        <Text className="text-sm" style={{ color: colors.inkMuted }}>
          Players in a package land on the same team when you generate. Groups picked up from
          friend names on registration forms are kept too, and a package you build here wins
          wherever the two disagree.
        </Text>

        {packages.length === 0 ? (
          <View
            className="items-center gap-1 rounded-lg border border-dashed px-4 py-6"
            style={{ borderColor: colors.border }}
          >
            <Text className="text-2xl">🤝</Text>
            <Text className="font-bold text-sm" style={{ color: colors.ink }}>
              No packages yet
            </Text>
            <Text className="text-xs text-center" style={{ color: colors.inkMuted }}>
              Group the players who have to stay together — carpools, siblings, a coach&apos;s own kid.
            </Text>
          </View>
        ) : (
          <View className="gap-2">
            {packages.map((pkg, index) => {
              const names = memberNames(pkg);
              // A package whose players have since left the roster is not
              // silently dropped here — resolveFriendPackages() ignores the
              // missing members at build time, and this says so out loud so the
              // coach can fix it rather than wonder why the group split up.
              const missing = pkg.playerIds.length - names.length;
              const accent = PACKAGE_ACCENTS[index % PACKAGE_ACCENTS.length];
              return (
                <View
                  key={pkg.id}
                  className="gap-2 overflow-hidden rounded-lg border p-3"
                  style={{
                    backgroundColor: colors.tile,
                    borderColor: `${accent}55`,
                    // The colour rail is what tells two packages apart faster
                    // than reading either name.
                    borderLeftWidth: 5,
                    borderLeftColor: accent,
                  }}
                >
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text className="font-bold text-sm" style={{ color: colors.ink }} numberOfLines={1}>
                        {pkg.name}
                      </Text>
                      <Text
                        className="text-xs"
                        style={{ color: missing > 0 ? colors.warning : colors.inkMuted }}
                      >
                        {names.length} player{names.length === 1 ? '' : 's'}
                        {missing > 0 ? ` · ${missing} no longer on the roster` : ''}
                      </Text>
                    </View>
                    <View className="flex-row gap-1">
                      <Button
                        label="Edit"
                        size="sm"
                        variant="secondary"
                        onPress={() => openEdit(pkg)}
                        disabled={disabled}
                      />
                      <Button
                        label="✕"
                        size="sm"
                        variant="ghost"
                        onPress={() => handleDelete(pkg)}
                        disabled={disabled}
                        style={{ borderColor: 'transparent' }}
                      />
                    </View>
                  </View>
                  <View className="flex-row flex-wrap gap-1">
                    {pkg.playerIds.map((id) => {
                      const p = playerById.get(id);
                      if (!p) return null;
                      return (
                        <View
                          key={id}
                          className="flex-row items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2"
                          style={{ borderColor: `${accent}55`, backgroundColor: `${accent}14` }}
                        >
                          <Avatar first={p.first} last={p.last} pos={p.pos} uri={p.avatarUrl} size={20} />
                          <Text className="text-xs" style={{ color: colors.ink }}>
                            {playerDisplayName(p)}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <Button
          label="＋ Create Friend Package"
          onPress={openNew}
          disabled={disabled || tryout.roster.length < MIN_MEMBERS}
        />
        {tryout.roster.length < MIN_MEMBERS ? (
          <Text className="text-xs" style={{ color: colors.inkFaint }}>
            Add at least two players to the roster first.
          </Text>
        ) : null}
      </Card>

      <Modal
        visible={!!editing}
        title={isNew ? 'Create Friend Package' : 'Edit Friend Package'}
        onClose={() => setEditing(null)}
        footer={
          <View className="flex-row justify-end gap-2">
            <Button label="Cancel" variant="ghost" onPress={() => setEditing(null)} />
            <Button label="Save Package" onPress={handleSave} loading={updateTryout.isPending} />
          </View>
        }
      >
        {editing ? (
          <View className="gap-3">
            <Input
              label="Package name"
              value={editing.name}
              onChangeText={(text) => setEditing({ ...editing, name: text })}
              placeholder="e.g. Carpool group"
            />

            <View className="flex-row items-center justify-between">
              <Text className="font-bold text-sm" style={{ color: colors.ink }}>
                Players
              </Text>
              <Badge
                label={`${editing.playerIds.length} selected`}
                variant={editing.playerIds.length >= MIN_MEMBERS ? 'success' : 'info'}
              />
            </View>

            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Search the roster..."
            />

            <ScrollView
              className="rounded-lg border"
              style={{ borderColor: colors.border, maxHeight: 320 }}
              nestedScrollEnabled
            >
              {visibleRoster.length === 0 ? (
                <Text className="p-3 text-xs" style={{ color: colors.inkMuted }}>
                  No players match &ldquo;{search}&rdquo;.
                </Text>
              ) : (
                visibleRoster.map((p) => {
                  const claimedBy = claimedElsewhere.get(p.id);
                  const selected = editing.playerIds.includes(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => !claimedBy && toggleMember(p.id)}
                      disabled={!!claimedBy}
                      className="flex-row items-center gap-2 border-b px-3 py-2"
                      style={{
                        borderColor: colors.border,
                        opacity: claimedBy ? 0.5 : 1,
                        // Picked rows are tinted rather than only ticked: with a
                        // long roster the tick column alone is easy to lose
                        // track of while scrolling.
                        backgroundColor: selected ? 'rgba(255,107,43,0.10)' : 'transparent',
                      }}
                    >
                      <View
                        className="h-5 w-5 items-center justify-center rounded"
                        style={{
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.primary : 'transparent',
                        }}
                      >
                        {selected ? <Text className="text-xs font-bold text-white">✓</Text> : null}
                      </View>
                      <Avatar first={p.first} last={p.last} pos={p.pos} uri={p.avatarUrl} size={26} />
                      <View className="flex-1">
                        <Text className="text-sm" style={{ color: colors.ink }} numberOfLines={1}>
                          {playerDisplayName(p)}
                        </Text>
                        {claimedBy ? (
                          <Text className="text-xs" style={{ color: colors.inkFaint }} numberOfLines={1}>
                            Already in &ldquo;{claimedBy}&rdquo;
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

import { useMemo, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';

import { RubricLibraryFormModal } from '@/components/RubricLibraryFormModal';
import { Badge, Button, Card, EmptyState, ErrorState, Header, Input, LoadingState, Screen } from '@/components/ui';
import { duplicateRubricName, matchesRubricSearch } from '@/data/rubricLibrary';
import { SCORING_TYPE_LABELS } from '@/data/rubrics';
import type { RubricLibraryInput, RubricLibraryItem } from '@/data/types';
import {
  useCreateRubricLibraryItemMutation,
  useDeleteRubricLibraryItemMutation,
  useRubricLibraryQuery,
  useUpdateRubricLibraryItemMutation,
} from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * The Rubrics Library: rubrics a coach builds once and reuses across teams and
 * evaluations. Build one here, then add it to any evaluation with "Add from Library".
 */
export default function RubricLibraryScreen() {
  const colors = useThemeColors();
  const libraryQuery = useRubricLibraryQuery();
  const create = useCreateRubricLibraryItemMutation();
  const update = useUpdateRubricLibraryItemMutation();
  const remove = useDeleteRubricLibraryItemMutation();
  const [term, setTerm] = useState('');
  const [form, setForm] = useState<{ item: RubricLibraryItem | null } | null>(null);

  const items = useMemo(() => (libraryQuery.data ?? []).filter((r) => matchesRubricSearch(r, term)), [libraryQuery.data, term]);

  const save = async (input: RubricLibraryInput) => {
    try {
      if (form?.item) await update.mutateAsync({ id: form.item.id, input });
      else await create.mutateAsync(input);
      setForm(null);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Could not save this rubric.');
    }
  };

  const duplicate = (item: RubricLibraryItem) => {
    const { createdAt: _c, updatedAt: _u, id: _id, ...rest } = item;
    create.mutate(
      { ...rest, name: duplicateRubricName(item.name, (libraryQuery.data ?? []).map((r) => r.name)) },
      { onError: (e: any) => Alert.alert('Could not duplicate', e?.message || 'Could not duplicate this rubric.') },
    );
  };

  const confirmDelete = (item: RubricLibraryItem) => {
    Alert.alert(
      'Delete rubric',
      `Delete "${item.name}" from your library? Evaluations that already use it keep their copy.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            remove.mutate(item.id, {
              onError: (e: any) => Alert.alert('Could not delete', e?.message || 'Could not delete this rubric.'),
            }),
        },
      ],
    );
  };

  const header = (
    <View className="px-4">
      <Header title="Rubrics Library" showBack />
      <View className="flex-row items-center gap-2 mb-2">
        <View className="flex-1">
          <Input placeholder="Search by name, sport or measure type" value={term} onChangeText={setTerm} autoCapitalize="none" />
        </View>
        <Button label="+ New" size="sm" onPress={() => setForm({ item: null })} />
      </View>
    </View>
  );

  if (libraryQuery.isLoading) return <LoadingState message="Loading your rubrics..." />;
  if (libraryQuery.isError) {
    return (
      <Screen padded={false}>
        {header}
        <ErrorState message="Could not load the Rubrics Library." onRetry={() => libraryQuery.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      {header}
      <FlatList
        data={items}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, flexGrow: 1 }}
        ListEmptyComponent={
          <EmptyState
            title={term ? 'No matches' : 'No saved rubrics yet'}
            message={
              term
                ? 'Try a different name, sport or measure type.'
                : 'Build rubrics here once, then add them to any evaluation with Add from Library.'
            }
          />
        }
        renderItem={({ item }) => (
          <Card className="mb-2 gap-2">
            <View className="flex-row items-center flex-wrap gap-2">
              <Text className="font-bold text-base" style={{ color: colors.ink }}>
                {item.name}
              </Text>
              <Badge label={SCORING_TYPE_LABELS[item.scoringType]} variant="brand" />
              {item.sport ? <Badge label={item.sport} /> : null}
              {item.definition.category ? <Badge label={item.definition.category} /> : null}
            </View>
            <Text className="text-xs" style={{ color: colors.inkMuted }}>
              {[
                item.definition.unit ? `Unit: ${item.definition.unit}` : item.definition.scale ? `${item.definition.scale} scale` : '',
                item.definition.rankingDirection === 'lower_is_better' ? 'Lowest ranks best' : '',
                item.definition.weight != null ? `Weight ${item.definition.weight}%` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <View className="flex-row gap-2">
              <Button label="Edit" size="sm" variant="secondary" onPress={() => setForm({ item })} />
              <Button label="Duplicate" size="sm" variant="secondary" onPress={() => duplicate(item)} />
              <Button label="Delete" size="sm" variant="ghost" onPress={() => confirmDelete(item)} />
            </View>
          </Card>
        )}
      />
      {form ? (
        <RubricLibraryFormModal
          key={form.item?.id ?? 'new'}
          visible
          item={form.item}
          saving={create.isPending || update.isPending}
          onClose={() => setForm(null)}
          onSave={(input) => void save(input)}
        />
      ) : null}
    </Screen>
  );
}

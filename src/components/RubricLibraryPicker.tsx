import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Badge, Button, Input, Modal } from '@/components/ui';
import { matchesRubricSearch } from '@/data/rubricLibrary';
import { SCORING_TYPE_LABELS } from '@/data/rubrics';
import type { RubricLibraryItem } from '@/data/types';
import { useRubricLibraryQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * A searchable list of the rubrics saved in the Rubrics Library. Pick one or
 * more and they are added to the evaluation, no rewriting needed.
 */
export function RubricLibraryPicker({
  visible,
  onClose,
  onPick,
  disabledNames = [],
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (items: RubricLibraryItem[]) => void;
  /** Names already on the evaluation, shown as added and not selectable. */
  disabledNames?: string[];
}) {
  const colors = useThemeColors();
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const libraryQuery = useRubricLibraryQuery({ enabled: visible });

  // Start fresh each time it opens: reset while rendering, the supported way to adjust state when a prop changes.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) {
      setTerm('');
      setSelected(new Set());
    }
  }

  const taken = new Set(disabledNames.map((n) => n.trim().toLowerCase()));
  const items = (libraryQuery.data ?? []).filter((r) => matchesRubricSearch(r, term));

  return (
    <Modal
      visible={visible}
      title="Add from Library"
      onClose={onClose}
      scroll={false}
      footer={
        <Button
          label={selected.size > 0 ? `Add ${selected.size} rubric${selected.size === 1 ? '' : 's'}` : 'Select rubrics to add'}
          disabled={selected.size === 0}
          onPress={() => onPick((libraryQuery.data ?? []).filter((r) => selected.has(r.id)))}
        />
      }
    >
      <Input placeholder="Search by name, sport or measure type" value={term} onChangeText={setTerm} autoCapitalize="none" />
      <FlatList
        style={{ maxHeight: 380, marginTop: 8 }}
        data={items}
        keyExtractor={(r) => r.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Text className="text-sm py-6 text-center" style={{ color: colors.inkMuted }}>
            {libraryQuery.isLoading
              ? 'Loading your library...'
              : libraryQuery.isError
                ? 'Could not load the library.'
                : (libraryQuery.data ?? []).length === 0
                  ? 'Your library is empty. Save rubrics to it from the Rubrics Library or any evaluation.'
                  : 'No rubrics match that search.'}
          </Text>
        }
        renderItem={({ item }) => {
          const added = taken.has(item.name.trim().toLowerCase());
          const on = selected.has(item.id);
          return (
            <Pressable
              disabled={added}
              onPress={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                })
              }
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: added }}
              className="flex-row items-center gap-3 py-2 border-b"
              style={{ borderColor: colors.border, opacity: added ? 0.5 : 1 }}
            >
              <View
                className="items-center justify-center rounded"
                style={{
                  width: 22,
                  height: 22,
                  borderWidth: 2,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primary : 'transparent',
                }}
              >
                {on ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
              </View>
              <View className="flex-1">
                <Text className="font-bold" style={{ color: colors.ink }}>
                  {item.name}
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }}>
                  {[SCORING_TYPE_LABELS[item.scoringType], item.sport, item.definition.unit].filter(Boolean).join(' · ')}
                </Text>
              </View>
              {added ? <Badge label="Added" /> : null}
            </Pressable>
          );
        }}
      />
    </Modal>
  );
}

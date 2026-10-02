import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Badge, Button, Chip, Input, Modal } from '@/components/ui';
import type { CustomRubric, Player } from '@/data/types';
import {
  SUGGEST_PRESELECT,
  headingMatches,
  type MeasureMapping,
  type RowResolutions,
  type ScoreImportRow,
} from '@/lib/scoreImport';
import { useThemeColors } from '@/theme/ThemeProvider';

const columnLabel = (header: string, index: number) => (header.trim() ? header.trim() : `Column ${index + 1}`);
const fullName = (p: Player) => `${p.first} ${p.last}`.trim();
const percent = (score: number) => `${Math.round(score * 100)}%`;

/** The choice for a conflict row: a player id, 'skip', or '' for not decided yet. */
type Choice = string;

/** Start from the best suggestion where it is a close match; anything less is left for the coach to pick. */
function initialChoices(rows: ScoreImportRow[]): Record<number, Choice> {
  const out: Record<number, Choice> = {};
  for (const r of rows) {
    if (!r.conflict) continue;
    const best = r.suggestions[0];
    out[r.line] = best && best.score >= SUGGEST_PRESELECT ? best.player.id : '';
  }
  return out;
}

/**
 * The window between "Import" and the scores being saved. It shows what was
 * guessed so the coach can correct it: which column feeds each measure, which
 * roster player each unrecognised or misspelled name is, and which cells could
 * not be read. Nothing is saved from here until Import is pressed in it.
 */
export function ImportReviewModal({
  headers,
  measures,
  mapping,
  onMappingChange,
  rows,
  roster,
  importing,
  playerLabel,
  onClose,
  onConfirm,
}: {
  headers: string[];
  measures: CustomRubric[];
  mapping: MeasureMapping;
  onMappingChange: (key: string, column: number | null) => void;
  /** Rows as matched so far, before any choice made in this window. */
  rows: ScoreImportRow[];
  roster: Player[];
  importing: boolean;
  /** "player" / "athlete" and so on, in the evaluation's own words. */
  playerLabel: string;
  onClose: () => void;
  /** Called with the decisions made here; the screen rebuilds the rows from them and saves. */
  onConfirm: (resolutions: RowResolutions) => void;
}) {
  const colors = useThemeColors();
  const conflicts = rows.filter((r) => r.conflict && !r.skipped);
  const [choices, setChoices] = useState<Record<number, Choice>>(() => initialChoices(rows));
  const [openHeading, setOpenHeading] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const matches = headingMatches(headers, measures, mapping);
  const withSkippedCells = rows.filter((r) => !r.conflict && r.errors.length === 0 && r.warnings.length > 0);

  const resolutions: RowResolutions = {};
  for (const r of conflicts) {
    const c = choices[r.line];
    if (c === 'skip') resolutions[r.line] = 'skip';
    else if (c) resolutions[r.line] = { playerId: c };
  }
  const undecided = conflicts.filter((r) => !choices[r.line]).length;
  const skipping = conflicts.filter((r) => choices[r.line] === 'skip').length;
  // Two rows pointed at one player would import the second over the first.
  const chosenIds = conflicts.map((r) => choices[r.line]).filter((c) => c && c !== 'skip');
  const duplicates = new Set(chosenIds.filter((id, i) => chosenIds.indexOf(id) !== i));

  const sortedRoster = useMemo(() => [...roster].sort((a, b) => fullName(a).localeCompare(fullName(b))), [roster]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? sortedRoster.filter((p) => fullName(p).toLowerCase().includes(q) || (p.jersey ?? '').includes(q)) : sortedRoster;
    return list.slice(0, 60);
  }, [sortedRoster, search]);

  const heading = (text: string) => (
    <Text className="mb-2 mt-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>{text}</Text>
  );

  return (
    <Modal visible title="Review before importing" onClose={onClose}>
      <View className="gap-4">
        <View>
          {heading('Headings: which column feeds each measure')}
          {matches.map(({ measure, kind }) => {
            const current = mapping[measure.key];
            const isOpen = openHeading === measure.key;
            return (
              <View key={measure.key} className="mb-1.5">
                <Pressable
                  onPress={() => setOpenHeading(isOpen ? null : measure.key)}
                  className="flex-row items-center justify-between rounded-md border px-3 py-2.5"
                  style={{ backgroundColor: colors.tile, borderColor: isOpen ? colors.primary : colors.border }}
                >
                  <View className="flex-1 pr-2 gap-1">
                    <Text className="text-sm font-semibold" style={{ color: colors.ink }}>{measure.label}</Text>
                    <View className="flex-row">
                      <Badge
                        label={kind === 'exact' ? 'Matches' : kind === 'close' ? 'Close match' : 'Not in file'}
                        variant={kind === 'exact' ? 'success' : kind === 'close' ? 'warning' : 'default'}
                      />
                    </View>
                  </View>
                  <Text className="text-sm" style={{ color: current == null ? colors.inkFaint : colors.primary }}>
                    {current == null ? 'not in this file' : columnLabel(headers[current] ?? '', current)}
                  </Text>
                </Pressable>
                {isOpen ? (
                  <View className="mt-1.5 flex-row flex-wrap">
                    <Chip
                      label="Not in this file"
                      active={current == null}
                      onPress={() => {
                        onMappingChange(measure.key, null);
                        setOpenHeading(null);
                      }}
                    />
                    {headers.map((h, i) => (
                      <Chip
                        key={`${measure.key}-${i}`}
                        label={columnLabel(h, i)}
                        active={current === i}
                        onPress={() => {
                          onMappingChange(measure.key, i);
                          setOpenHeading(null);
                        }}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>

        <View>
          {heading(
            conflicts.length === 0
              ? `Names: every row matched a ${playerLabel.toLowerCase()}`
              : `Names: ${conflicts.length} to confirm`,
          )}
          {conflicts.length === 0 ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              Every name in the file matched a {playerLabel.toLowerCase()} on the roster.
            </Text>
          ) : (
            conflicts.map((r) => {
              const chosen = choices[r.line] ?? '';
              const chosenPlayer = roster.find((p) => p.id === chosen);
              const clash = !!chosen && chosen !== 'skip' && duplicates.has(chosen);
              const set = (value: Choice) => setChoices((c) => ({ ...c, [r.line]: value }));
              return (
                <View
                  key={r.line}
                  className="mb-2 rounded-md border px-3 py-2.5 gap-1.5"
                  style={{ backgroundColor: colors.tile, borderColor: clash ? colors.danger : colors.border }}
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.ink }}>
                    "{r.label}"
                    <Text className="text-xs font-normal" style={{ color: colors.inkFaint }}>  row {r.line}</Text>
                  </Text>
                  <Text className="text-xs" style={{ color: clash ? colors.danger : colors.inkFaint }}>
                    {clash
                      ? 'Another row is already set to this player.'
                      : r.conflict === 'ambiguous'
                        ? 'More than one player has this name.'
                        : r.suggestions.length > 0
                          ? 'Not on the roster as written. Closest names are listed first.'
                          : 'Not on the roster, and no close name was found.'}
                  </Text>
                  <View className="flex-row flex-wrap">
                    {r.suggestions.map((s) => (
                      <Chip
                        key={s.player.id}
                        label={`${fullName(s.player)} (${percent(s.score)})`}
                        active={chosen === s.player.id}
                        onPress={() => set(s.player.id)}
                      />
                    ))}
                    <Chip label="Someone else…" active={!!chosenPlayer && !r.suggestions.some((s) => s.player.id === chosen)} onPress={() => { setSearch(''); setPickingFor(r.line); }} />
                    <Chip label="Leave out" active={chosen === 'skip'} onPress={() => set('skip')} />
                  </View>
                  {chosenPlayer && !r.suggestions.some((s) => s.player.id === chosen) ? (
                    <Text className="text-xs" style={{ color: colors.primary }}>Chosen: {fullName(chosenPlayer)}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {withSkippedCells.length > 0 ? (
          <View className="gap-1">
            {heading('Scores that could not be read')}
            {withSkippedCells.map((r) => (
              <Text key={r.line} className="text-sm" style={{ color: colors.inkMuted }}>
                <Text className="font-semibold" style={{ color: colors.ink }}>{r.player ? fullName(r.player) : r.label}</Text>
                {' '}(row {r.line}): {r.warnings.join('; ')}
              </Text>
            ))}
            <Text className="text-xs" style={{ color: colors.inkFaint }}>
              These cells are skipped; the rest of each row is still imported.
            </Text>
          </View>
        ) : null}

        {undecided > 0 || skipping > 0 ? (
          <Text className="text-sm" style={{ color: colors.inkMuted }}>
            {undecided + skipping} {undecided + skipping === 1 ? 'row' : 'rows'} will be left out
            {undecided > 0 ? ` (${undecided} with no ${playerLabel.toLowerCase()} chosen)` : ''}.
          </Text>
        ) : null}

        <View className="flex-row gap-2">
          <Button label="Back" variant="secondary" className="flex-1" onPress={onClose} disabled={importing} />
          <Button
            label="Import"
            className="flex-1"
            loading={importing}
            disabled={duplicates.size > 0}
            onPress={() => onConfirm(resolutions)}
          />
        </View>
      </View>

      <Modal visible={pickingFor != null} title={`Choose a ${playerLabel.toLowerCase()}`} onClose={() => setPickingFor(null)} scroll={false}>
        <View className="gap-2" style={{ flex: 1 }}>
          <Input placeholder="Search by name or jersey #" value={search} onChangeText={setSearch} autoCorrect={false} />
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 360 }}>
            {shown.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  if (pickingFor != null) setChoices((c) => ({ ...c, [pickingFor]: p.id }));
                  setPickingFor(null);
                }}
                className="border-b py-3"
                style={{ borderColor: colors.border }}
              >
                <Text className="text-base" style={{ color: colors.ink }}>
                  {fullName(p)}
                  {p.jersey ? <Text style={{ color: colors.inkMuted }}>  #{p.jersey}</Text> : null}
                </Text>
              </Pressable>
            ))}
            {shown.length === 0 ? <Text className="py-3" style={{ color: colors.inkMuted }}>No one matches.</Text> : null}
          </ScrollView>
        </View>
      </Modal>
    </Modal>
  );
}

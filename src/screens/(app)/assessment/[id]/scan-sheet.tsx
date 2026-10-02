import { useTerms } from '@/lib/terms';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, Chip, ErrorState, Header, LoadingState, Screen } from '@/components/ui';
import { useImportScanScoresMutation, useTryoutQuery } from '@/features/queries';
import { useAssessmentId } from '@/features/useAssessmentId';
import { DocumentPickerUnavailable, pickRosterFile } from '@/lib/documentPicker';
import { parseRosterBase64, type ParsedSheet } from '@/lib/rosterImport';
import { ImportReviewModal } from '@/components/assessment/ImportReviewModal';
import {
  IDENTITY_FIELDS,
  buildScoreImportRows,
  guessIdentityMapping,
  guessMeasureMapping,
  headingMatches,
  validateImportSetup,
  type IdentityMapping,
  type MeasureMapping,
  type RowResolutions,
  type ScoreImportRow,
} from '@/lib/scoreImport';

const SESSION_NAME = 'Excel Import';
const PREVIEW_ROWS = 10;

const columnLabel = (header: string, index: number) => (header.trim() ? header.trim() : `Column ${index + 1}`);

/**
 * Import evaluation results from a spreadsheet: pick a file, map its columns to
 * the measures already built into this evaluation, review, then save.
 */
export default function ScanSheetScreen() {
  const id = useAssessmentId();
  const colors = useThemeColors();
  const navigation = useNavigation<any>();
  const tryoutQuery = useTryoutQuery(id);
  const importScores = useImportScanScoresMutation();

  const [source, setSource] = useState<{ name: string; base64: string } | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [identity, setIdentity] = useState<IdentityMapping>({});
  const [mapping, setMapping] = useState<MeasureMapping>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const tryout = tryoutQuery.data;
  const terms = useTerms(tryout?.settings.customLabels);
  const measures = useMemo(() => tryout?.settings.customRubrics ?? [], [tryout]);

  const rows = useMemo(
    () => (sheet && tryout ? buildScoreImportRows(sheet, tryout.roster, identity, mapping, measures) : []),
    [sheet, tryout, identity, mapping, measures],
  );
  const ready = rows.filter((r) => r.errors.length === 0);
  const skipped = rows.filter((r) => r.errors.length > 0);
  const mappedMeasures = measures.filter((m) => mapping[m.key] != null).length;
  const issues = useMemo(
    () => (sheet ? validateImportSetup(sheet.headers, identity, mapping, measures) : []),
    [sheet, identity, mapping, measures],
  );
  const blocked = issues.some((i) => i.level === 'error');
  const cellWarnings = rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length;
  const conflicts = rows.filter((r) => r.conflict).length;
  // Anything the file did not say outright is put in front of the coach before saving.
  const needsReview =
    conflicts > 0 ||
    cellWarnings > 0 ||
    (sheet ? headingMatches(sheet.headers, measures, mapping).some((m) => m.kind === 'close') : false);

  const back = () => navigation.navigate('AssessmentRoster');

  if (tryoutQuery.isLoading) return <LoadingState message="Loading evaluation..." />;
  if (tryoutQuery.isError || !tryout) {
    return (
      <Screen scroll insideTabBar>
        <Header title="Import Scores" showBack onBack={back} />
        <ErrorState message="Could not load this evaluation." onRetry={() => tryoutQuery.refetch()} />
      </Screen>
    );
  }

  const load = (parsed: ParsedSheet, name: string, base64: string) => {
    const ident = guessIdentityMapping(parsed.headers);
    setSource({ name, base64 });
    setSheet(parsed);
    setIdentity(ident);
    setMapping(guessMeasureMapping(parsed.headers, measures, ident));
    setExpanded(null);
  };

  const choose = async () => {
    setReading(true);
    try {
      const picked = await pickRosterFile();
      if (picked) load(parseRosterBase64(picked.base64), picked.name, picked.base64);
    } catch (e) {
      if (e instanceof DocumentPickerUnavailable) Alert.alert('File Picker Not Available', e.message);
      else Alert.alert('Could not read that file', e instanceof Error ? e.message : 'Try a different file.');
    } finally {
      setReading(false);
    }
  };

  const switchSheet = (name: string) => {
    if (!source) return;
    try {
      load(parseRosterBase64(source.base64, name), source.name, source.base64);
    } catch (e) {
      Alert.alert('Could not read that sheet', e instanceof Error ? e.message : 'Try a different sheet.');
    }
  };

  const saveRows = async (toSave: ScoreImportRow[]) => {
    const importable = toSave.filter((r) => r.errors.length === 0 && r.player);
    const scores = importable.flatMap((r) =>
      Object.entries(r.scores).map(([rubricKey, value]) => ({ playerId: r.player!.id, rubricKey, value })),
    );
    try {
      await importScores.mutateAsync({ tryoutId: id!, scores, session: SESSION_NAME });
      setReviewing(false);
      setSavedCount(importable.length);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Nothing was saved. Try again.');
    }
  };

  /** Import was pressed: through the review window when anything was guessed, straight away when not. */
  const startImport = () => (needsReview ? setReviewing(true) : void saveRows(rows));

  /** The coach's choices in the window: rebuild the rows with them, then save exactly those. */
  const confirmReview = (resolutions: RowResolutions) =>
    void saveRows(buildScoreImportRows(sheet!, tryout.roster, identity, mapping, measures, resolutions));

  const picker = (key: string, current: number | null | undefined, onPick: (i: number | null) => void) =>
    expanded === key && sheet ? (
      <View className="mt-1.5 flex-row flex-wrap">
        <Chip label="Not in this file" active={current == null} onPress={() => { onPick(null); setExpanded(null); }} />
        {sheet.headers.map((h, i) => (
          <Chip
            key={`${key}-${i}`}
            label={columnLabel(h, i)}
            active={current === i}
            onPress={() => { onPick(i); setExpanded(null); }}
          />
        ))}
      </View>
    ) : null;

  const mapRow = (key: string, label: string, sub: string | undefined, current: number | null | undefined, onPick: (i: number | null) => void) => (
    <View key={key} className="mb-1.5">
      <Pressable
        onPress={() => setExpanded(expanded === key ? null : key)}
        className="flex-row items-center justify-between rounded-md border px-3 py-2.5"
        style={{ backgroundColor: colors.tile, borderColor: expanded === key ? colors.primary : colors.border }}
      >
        <View className="flex-1 pr-2">
          <Text className="text-sm font-semibold" style={{ color: colors.ink }}>{label}</Text>
          {sub ? <Text className="text-xs" style={{ color: colors.inkFaint }}>{sub}</Text> : null}
        </View>
        <Text className="text-sm" style={{ color: current == null ? colors.inkFaint : colors.primary }}>
          {current == null || !sheet ? 'not in this file' : columnLabel(sheet.headers[current], current)}
        </Text>
      </Pressable>
      {picker(key, current, onPick)}
    </View>
  );

  return (
    <Screen padded={false}>
      <View className="px-4">
        <Header title="Import Scores from Excel" showBack onBack={back} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }} keyboardShouldPersistTaps="handled">
        {measures.length === 0 ? (
          <Card accent className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>Add measures first</Text>
            <Text style={{ color: colors.inkMuted }}>
              Scores are imported into the measures created in this evaluation, and there are none yet.
            </Text>
            <Button label="Go to Measures" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentRubrics', params: { id } })} />
          </Card>
        ) : savedCount != null ? (
          <Card accent className="items-center gap-2 py-4">
            <Text className="font-display font-bold" style={{ color: colors.success }}>
              Scores imported for {savedCount} {(savedCount === 1 ? terms.player : terms.players).toLowerCase()}
            </Text>
            <Button label="View Results" onPress={() => navigation.navigate('AssessmentFlow', { screen: 'AssessmentResults', params: { id } })} />
          </Card>
        ) : !sheet ? (
          <Card accent className="gap-2">
            <Text className="font-display font-bold" style={{ color: colors.ink }}>Import results from a file</Text>
            <Text style={{ color: colors.inkMuted }}>
              Choose an Excel or CSV file with one row per player. You will match its columns to this
              evaluation's {measures.length} {measures.length === 1 ? 'measure' : 'measures'} before anything is saved.
            </Text>
            <Button label="Choose File" loading={reading} onPress={choose} />
          </Card>
        ) : (
          <>
            <Card className="gap-1">
              <Text className="font-bold" style={{ color: colors.ink }}>{source?.name}</Text>
              <Text className="text-sm" style={{ color: colors.inkMuted }}>
                {sheet.rows.length} rows below the headings on line {sheet.headerLine}
              </Text>
              <Button label="Choose a different file" variant="secondary" onPress={choose} />
            </Card>

            {sheet.sheetNames.length > 1 ? (
              <View>
                <Text className="mb-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Sheet</Text>
                <View className="flex-row flex-wrap">
                  {sheet.sheetNames.map((n) => (
                    <Chip key={n} label={n} active={n === sheet.sheetName} onPress={() => switchSheet(n)} />
                  ))}
                </View>
              </View>
            ) : null}

            <View>
              <Text className="mb-2 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Which column is the {terms.player.toLowerCase()}</Text>
              {IDENTITY_FIELDS.map((f) =>
                mapRow(`id-${f.key}`, f.key === 'jersey' ? terms.jersey : f.label, undefined, identity[f.key], (i) => setIdentity((m) => ({ ...m, [f.key]: i }))),
              )}
            </View>

            <View>
              <Text className="mb-2 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                Assign a column to each measure ({mappedMeasures}/{measures.length})
              </Text>
              {measures.map((m) =>
                mapRow(`m-${m.key}`, m.label, m.unit ? `Unit: ${m.unit}` : undefined, mapping[m.key], (i) =>
                  setMapping((prev) => ({ ...prev, [m.key]: i })),
                ),
              )}
            </View>

            {issues.length > 0 ? (
              <Card className="gap-1.5">
                <Text className="font-bold" style={{ color: colors.ink }}>Check before importing</Text>
                {issues.map((i, n) => (
                  <Text key={n} className="text-sm" style={{ color: i.level === 'error' ? colors.danger : colors.inkMuted }}>
                    {i.level === 'error' ? 'Fix: ' : 'Note: '}{i.message}
                  </Text>
                ))}
              </Card>
            ) : null}

            <View className="gap-1.5">
              <Text className="mb-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>Preview</Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Badge label={`${ready.length} ready`} variant="success" />
                {skipped.length > 0 ? <Badge label={`${skipped.length} left out`} variant="danger" /> : null}
                {cellWarnings > 0 ? <Badge label={`${cellWarnings} with skipped cells`} variant="warning" /> : null}
              </View>
              {rows.slice(0, PREVIEW_ROWS).map((r) => {
                const bad = r.errors.length > 0;
                return (
                  <Card key={r.line} className="gap-0.5">
                    <Text className="font-bold" style={{ color: bad ? colors.danger : colors.ink }}>
                      {r.player ? `${r.player.first} ${r.player.last}`.trim() : r.label}
                      <Text className="text-xs font-normal" style={{ color: colors.inkFaint }}>  row {r.line}</Text>
                    </Text>
                    {bad ? (
                      <Text className="text-sm" style={{ color: colors.danger }}>{r.errors.join('. ')}</Text>
                    ) : (
                      <Text className="text-sm" style={{ color: colors.inkMuted }}>
                        {measures.filter((m) => r.scores[m.key] != null).map((m) => `${m.label}: ${r.scores[m.key]}`).join('  ·  ')}
                      </Text>
                    )}
                    {r.warnings.length > 0 ? (
                      <Text className="text-xs" style={{ color: colors.inkFaint }}>Skipped cells: {r.warnings.join('; ')}</Text>
                    ) : null}
                  </Card>
                );
              })}
              {rows.length > PREVIEW_ROWS ? (
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  and {rows.length - PREVIEW_ROWS} more rows
                </Text>
              ) : null}
            </View>

            <Text className="text-xs" style={{ color: colors.inkFaint }}>
              Saved as the "{SESSION_NAME}" session. Importing again replaces that session's scores for the same players.
            </Text>
            <Button
              label={
                needsReview
                  ? 'Review and import'
                  : `Import ${ready.length} ${(ready.length === 1 ? terms.player : terms.players).toLowerCase()}`
              }
              loading={importScores.isPending}
              disabled={blocked || (ready.length === 0 && conflicts === 0) || mappedMeasures === 0}
              onPress={startImport}
            />
          </>
        )}
      </ScrollView>

      {reviewing && sheet ? (
        <ImportReviewModal
          headers={sheet.headers}
          measures={measures}
          mapping={mapping}
          onMappingChange={(key, column) => setMapping((prev) => ({ ...prev, [key]: column }))}
          rows={rows}
          roster={tryout.roster}
          importing={importScores.isPending}
          playerLabel={terms.player}
          onClose={() => setReviewing(false)}
          onConfirm={confirmReview}
        />
      ) : null}
    </Screen>
  );
}

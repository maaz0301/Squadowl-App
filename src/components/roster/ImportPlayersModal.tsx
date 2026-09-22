import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import Svg, { Path, Polyline } from 'react-native-svg';

import { Badge, Button, Chip, Modal } from '@/components/ui';
import {
  IMPORT_FIELDS,
  buildImportRows,
  guessMapping,
  parseRosterBase64,
  type ColumnMapping,
  type ImportFieldKey,
  type ImportRow,
  type ParsedSheet,
} from '@/lib/rosterImport';
import { DocumentPickerUnavailable, pickRosterFile, type PickedRosterFile } from '@/lib/documentPicker';
import type { AddPlayerForm, PlayerImportResult } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Rows previewed before importing — enough to spot a bad mapping, not a second spreadsheet. */
const PREVIEW_ROWS = 8;

function UploadIcon({ color }: { color: string }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Polyline points="17 8 12 3 7 8" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12 3v12" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Import a roster from a spreadsheet: choose a file, confirm which column is
 * which, see what comes out, then write it.
 *
 * The mapping step is the point of the whole thing — no two clubs head their
 * columns the same way, so the sheet is read, guessed at, and shown back rather
 * than assumed to be in some documented shape. Nothing is created until the
 * coach has seen the rows that are about to be.
 *
 * One way in on both platforms: the document picker, which reaches Files,
 * iCloud and Drive on iOS and the Storage Access Framework on Android, and
 * reads .xlsx and .xls as well as .csv.
 */
export function ImportPlayersModal({
  visible,
  onClose,
  target,
  onImport,
}: {
  visible: boolean;
  onClose: () => void;
  /** Names what the players are being added to, for the copy. */
  target: string;
  onImport: (
    rows: { line: number; form: AddPlayerForm }[],
    onProgress: (done: number) => void,
  ) => Promise<PlayerImportResult>;
}) {
  const colors = useThemeColors();

  const [source, setSource] = useState<{ name: string; base64?: string } | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [reading, setReading] = useState(false);
  const [expandedField, setExpandedField] = useState<ImportFieldKey | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<PlayerImportResult | null>(null);
  /**
   * File lines the coach has struck off the import, by line number.
   *
   * Dropped from the sheet *before* the rows are built rather than filtered out
   * of the result: the duplicate check inside buildImportRows keeps the first
   * occurrence and flags the rest, so removing the row a duplicate points at
   * has to let the survivor be rebuilt as the first one. Filtering afterwards
   * would leave it reading "Same player as row 4" against a row that is gone.
   */
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set());

  const kept = useMemo(
    () => (sheet ? { ...sheet, rows: sheet.rows.filter((r) => !removed.has(r.line)) } : null),
    [sheet, removed],
  );
  const rows = useMemo(() => (kept ? buildImportRows(kept, mapping) : []), [kept, mapping]);
  const ready = rows.filter((r) => r.errors.length === 0);
  const skipped = rows.filter((r) => r.errors.length > 0);
  const importing = progress !== null;

  const reset = () => {
    setSource(null);
    setSheet(null);
    setMapping({});
    setExpandedField(null);
    setProgress(null);
    setResult(null);
    setRemoved(new Set());
  };

  const close = () => {
    if (importing) return;
    reset();
    onClose();
  };

  const showRead = (parsed: ParsedSheet, name: string, base64?: string) => {
    setSource({ name, base64 });
    setSheet(parsed);
    setMapping(guessMapping(parsed.headers));
    setResult(null);
    // Line numbers mean nothing across a different file or a different tab of
    // the same workbook, so removals can't carry over. Re-mapping columns
    // deliberately *does* keep them — that is the same rows, read differently.
    setRemoved(new Set());
  };

  const failedToRead = (e: unknown) =>
    Alert.alert(
      'Could Not Read That File',
      `${e instanceof Error ? e.message : 'Unknown error'}\n\nExcel and CSV files can be read; a PDF cannot.`,
    );

  const chooseFile = async () => {
    setReading(true);
    try {
      const picked: PickedRosterFile | null = await pickRosterFile();
      // Null means the coach backed out of the picker — not an error to report.
      if (picked) showRead(parseRosterBase64(picked.base64), picked.name, picked.base64);
    } catch (e) {
      // A binary without the picker's native module isn't a bad file, so it
      // says what to do about the build rather than blaming the spreadsheet.
      if (e instanceof DocumentPickerUnavailable) {
        Alert.alert('File Picker Not Available', e.message);
      } else {
        failedToRead(e);
      }
    } finally {
      setReading(false);
    }
  };

  /** Re-read the same workbook against a different tab. */
  const switchSheet = (sheetName: string) => {
    if (!source?.base64) return;
    try {
      showRead(parseRosterBase64(source.base64, sheetName), source.name, source.base64);
    } catch (e) {
      failedToRead(e);
    }
  };

  const runImport = async () => {
    setProgress({ done: 0, total: ready.length });
    try {
      setResult(
        await onImport(
          ready.map(({ line, form }) => ({ line, form })),
          (done) => setProgress({ done, total: ready.length }),
        ),
      );
    } catch (e) {
      Alert.alert('Import Failed', e instanceof Error ? e.message : 'Could not import these players.');
    } finally {
      setProgress(null);
    }
  };

  const removeLines = (lines: number[]) =>
    setRemoved((prev) => {
      const next = new Set(prev);
      for (const line of lines) next.add(line);
      return next;
    });

  /** A blank heading still has to be pickable, and a column letter is how the coach sees it in Excel. */
  const columnLabel = (header: string, i: number) => header || `Column ${String.fromCharCode(65 + i)}`;

  return (
    <Modal
      visible={visible}
      title={`Import Players into ${target}`}
      onClose={close}
      footer={
        result || !sheet ? undefined : (
          <View className="mt-4 gap-2">
            {importing ? (
              <View className="flex-row items-center justify-center gap-2 py-3">
                <ActivityIndicator size="small" color={colors.primary} />
                <Text className="text-sm font-semibold" style={{ color: colors.ink }}>
                  Adding {progress.done} of {progress.total}…
                </Text>
              </View>
            ) : (
              <>
                <Button
                  label={
                    ready.length === 0
                      ? 'Nothing to import'
                      : `Import ${ready.length} ${ready.length === 1 ? 'player' : 'players'}`
                  }
                  disabled={ready.length === 0}
                  onPress={runImport}
                />
                <Button label="Start over" variant="secondary" onPress={reset} />
              </>
            )}
          </View>
        )
      }
    >
      {result ? (
        <ImportSummary result={result} onDone={close} onAgain={reset} colors={colors} />
      ) : !sheet ? (
        <View className="gap-4">
          <Pressable
            onPress={chooseFile}
            disabled={reading}
            className="items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-9 active:opacity-80"
            style={{
              borderColor: reading ? colors.primary : colors.borderStrong,
              backgroundColor: colors.tile,
            }}
            accessibilityRole="button"
            accessibilityLabel="Choose a roster file"
          >
            <View
              className="h-14 w-14 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
            >
              {reading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <UploadIcon color={colors.primary} />
              )}
            </View>
            <Text className="text-base font-bold" style={{ color: colors.ink }}>
              {reading ? 'Reading the file…' : 'Choose a roster file'}
            </Text>
            <Text className="text-center text-sm" style={{ color: colors.inkMuted }}>
              Excel or CSV — from Files and iCloud on iPhone, or your phone&apos;s storage and Drive on
              Android.
            </Text>
            <View className="flex-row gap-2 pt-1">
              {['.xlsx', '.xls', '.csv'].map((ext) => (
                <View
                  key={ext}
                  className="rounded-full border px-2.5 py-1"
                  style={{ borderColor: colors.border, backgroundColor: colors.card }}
                >
                  <Text className="font-mono text-xs" style={{ color: colors.inkMuted }}>
                    {ext}
                  </Text>
                </View>
              ))}
            </View>
          </Pressable>

          <Text className="text-xs" style={{ color: colors.inkFaint }}>
            One player per row, with a heading row above them. Whatever your columns are called, you&apos;ll
            match them up on the next step. PDFs can&apos;t be read — export the roster as CSV or Excel
            first.
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          <View>
            <Text className="font-bold" style={{ color: colors.ink }}>
              {source?.name}
            </Text>
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {removed.size > 0
                ? `${rows.length} of ${sheet.rows.length} rows kept — ${removed.size} removed`
                : `${rows.length} ${rows.length === 1 ? 'row' : 'rows'} below the headings on line ${sheet.headerLine}`}
            </Text>
          </View>

          {sheet.sheetNames.length > 1 && source?.base64 ? (
            <View>
              <Text className="mb-1 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                Sheet
              </Text>
              <View className="flex-row flex-wrap">
                {sheet.sheetNames.map((n) => (
                  <Chip
                    key={n}
                    label={n}
                    active={n === sheet.sheetName}
                    disabled={importing}
                    onPress={() => switchSheet(n)}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View>
            <Text className="mb-2 text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
              Which column is which
            </Text>
            {IMPORT_FIELDS.map((field) => {
              const index = mapping[field.key];
              const open = expandedField === field.key;
              return (
                <View key={field.key} className="mb-1.5">
                  <Pressable
                    disabled={importing}
                    onPress={() => setExpandedField(open ? null : field.key)}
                    className="flex-row items-center justify-between rounded-md border px-3 py-2.5"
                    style={{ backgroundColor: colors.tile, borderColor: open ? colors.primary : colors.border }}
                  >
                    <Text className="flex-1 text-sm font-semibold" style={{ color: colors.ink }}>
                      {field.label}
                    </Text>
                    <Text className="text-sm" style={{ color: index == null ? colors.inkFaint : colors.primary }}>
                      {index == null ? 'not in this file' : columnLabel(sheet.headers[index], index)}
                    </Text>
                  </Pressable>
                  {/* Expanded inline rather than in a second modal: a Modal
                      opened from inside this one stacks native sheets on iOS
                      and the mapping step is where a coach hops between fields
                      most. */}
                  {open ? (
                    <View className="mt-1.5 flex-row flex-wrap">
                      <Chip
                        label="— not in this file —"
                        active={index == null}
                        disabled={importing}
                        onPress={() => setMapping((m) => ({ ...m, [field.key]: null }))}
                      />
                      {sheet.headers.map((header, i) => (
                        <Chip
                          key={`${field.key}-${i}`}
                          label={columnLabel(header, i)}
                          active={index === i}
                          disabled={importing}
                          onPress={() => {
                            setMapping((m) => ({ ...m, [field.key]: i }));
                            setExpandedField(null);
                          }}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          <RowPreview
            rows={rows}
            colors={colors}
            disabled={importing}
            removedCount={removed.size}
            onRemove={removeLines}
            onRestore={() => setRemoved(new Set())}
          />

          {skipped.length > 0 && !importing ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              {skipped.length} {skipped.length === 1 ? 'row is' : 'rows are'} being left out — see above.
            </Text>
          ) : null}
        </View>
      )}
    </Modal>
  );
}

function RowPreview({
  rows,
  colors,
  disabled,
  removedCount,
  onRemove,
  onRestore,
}: {
  rows: ImportRow[];
  colors: ReturnType<typeof useThemeColors>;
  disabled: boolean;
  removedCount: number;
  /** Strike these file lines off the import. */
  onRemove: (lines: number[]) => void;
  /** Put every removed line back. */
  onRestore: () => void;
}) {
  // Bad rows first: they are the ones the coach has to decide about, and a
  // wrong column mapping shows up in them before anywhere else.
  const [showAll, setShowAll] = useState(false);
  const ordered = [...rows].sort((a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0));
  const shown = showAll ? ordered : ordered.slice(0, PREVIEW_ROWS);
  const incomplete = rows.filter((r) => r.errors.length > 0);

  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
          What will be added
        </Text>
        {rows.length > PREVIEW_ROWS ? (
          <Pressable
            disabled={disabled}
            onPress={() => setShowAll((prev) => !prev)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={showAll ? 'Show fewer rows' : `Show all ${rows.length} rows`}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
              {showAll ? 'Show fewer' : `Show all ${rows.length} rows`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {shown.length === 0 ? (
        <Text className="py-4 text-center text-sm" style={{ color: colors.inkMuted }}>
          Every row has been removed. Restore them, or start over.
        </Text>
      ) : (
        shown.map((row) => (
          <View
            key={row.line}
            className="mb-1.5 flex-row items-center gap-2 rounded-md border px-3 py-2"
            style={{ backgroundColor: colors.tile, borderColor: colors.border }}
          >
            <Text className="text-xs" style={{ color: colors.inkFaint, width: 26 }}>
              {row.line}
            </Text>
            <View className="flex-1">
              <Text className="text-sm font-bold" style={{ color: colors.ink }}>
                {row.display.name}
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {[row.display.email, row.form.jersey && `#${row.form.jersey}`, row.form.pos, row.form.yearOfBirth]
                  .filter(Boolean)
                  .join(' · ') || '—'}
              </Text>
              {row.errors.length > 0 ? (
                <Text className="mt-0.5 text-xs font-semibold" style={{ color: colors.danger }}>
                  {row.errors.join('; ')}
                </Text>
              ) : null}
            </View>
            {row.errors.length === 0 ? <Badge label="Ready" variant="success" /> : null}
            {/* Per row, so a Ready player the coach doesn't want can go too. */}
            <Pressable
              disabled={disabled}
              hitSlop={8}
              onPress={() => onRemove([row.line])}
              accessibilityLabel={`Remove row ${row.line}, ${row.display.name}`}
            >
              <Text className="text-lg" style={{ color: colors.inkMuted }}>
                ×
              </Text>
            </Pressable>
          </View>
        ))
      )}

      {rows.length > PREVIEW_ROWS ? (
        <View className="mt-1.5 flex-row items-center justify-between">
          <Text className="text-xs" style={{ color: colors.inkFaint }}>
            {showAll
              ? `Showing all ${rows.length} rows (${rows.filter((r) => r.errors.length === 0).length} ready to import)`
              : `Previewing ${shown.length} of ${rows.length} rows — all ${rows.filter((r) => r.errors.length === 0).length} ready rows will be imported`}
          </Text>
          <Pressable
            disabled={disabled}
            onPress={() => setShowAll((prev) => !prev)}
            hitSlop={8}
          >
            <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
              {showAll ? 'Show fewer' : `Show all ${rows.length}`}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <View className="mt-2 flex-row flex-wrap gap-2">
        {/* Clearing the unusable rows in one go is the common case: they are
            sorted to the top, so on a sheet with a few bad lines they are all
            the coach can see of the preview until they go. */}
        {incomplete.length > 0 ? (
          <Button
            label={`Remove ${incomplete.length} incomplete`}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onPress={() => onRemove(incomplete.map((r) => r.line))}
          />
        ) : null}
        {removedCount > 0 ? (
          <Button
            label={`Restore ${removedCount} removed`}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onPress={onRestore}
          />
        ) : null}
      </View>
    </View>
  );
}

function ImportSummary({
  result,
  onDone,
  onAgain,
  colors,
}: {
  result: PlayerImportResult;
  onDone: () => void;
  onAgain: () => void;
  colors: ReturnType<typeof useThemeColors>;
}) {
  return (
    <View className="gap-4">
      <Text className="text-lg font-bold" style={{ color: colors.ink }}>
        {result.added} {result.added === 1 ? 'player' : 'players'} added
      </Text>
      {result.failed.length > 0 ? (
        <View>
          <Text className="mb-2 text-sm font-bold" style={{ color: colors.danger }}>
            {result.failed.length} {result.failed.length === 1 ? 'row' : 'rows'} could not be added
          </Text>
          {result.failed.map((f) => (
            <Text key={`${f.line}-${f.name}`} className="mb-1 text-sm" style={{ color: colors.inkMuted }}>
              <Text className="font-bold" style={{ color: colors.ink }}>
                Row {f.line} · {f.name}
              </Text>
              {' — '}
              {f.message}
            </Text>
          ))}
        </View>
      ) : null}
      <View className="gap-2">
        <Button label="Done" onPress={onDone} />
        <Button label="Import more players" variant="secondary" onPress={onAgain} />
      </View>
    </View>
  );
}

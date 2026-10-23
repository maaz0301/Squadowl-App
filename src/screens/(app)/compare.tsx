import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import {
  Avatar,
  Button,
  Card,
  Chip,
  DateField,
  EmptyState,
  ErrorState,
  Header,
  Input,
  LoadingState,
  Modal,
  Screen,
  Tabs,
} from '@/components/ui';
import { BottomNav } from '@/components/BottomNav';
import {
  MAX_COMPARE_PLAYERS,
  MAX_COMPARE_TEAMS,
  addToSelection,
  buildComparison,
  candidateName,
  foldCompareCandidates,
  formatCompareDate,
  isTopPerformer,
  nextSort,
  sharedEvaluations,
  type CompareAssessment,
  type CompareCandidate,
  type CompareFilters,
  type CompareRow,
  type CompareSort,
  type SavedComparison,
} from '@/data/compare';
import { getDataSource } from '@/data';
import {
  useCompareAssessmentsQuery,
  useCompareBirthYearsQuery,
  useCompareCandidatesQuery,
  useDeleteSavedComparisonMutation,
  useSaveComparisonMutation,
  useSavedComparisonsQuery,
  useTeamsQuery,
  useUpdateSavedComparisonMutation,
} from '@/features/queries';
import { writeAndDeliverFile } from '@/lib/exportData';
import { buildCompareFile } from '@/lib/compareExport';
import { reportLogoUrls } from '@/lib/reportPdf';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';

type DobMode = 'year' | 'range';
type CompareTab = 'select' | 'results' | 'saved';

const RANK_W = 52;
const NAME_W = 150;
const EVAL_W = 150;
const SCORE_W = 88;

export default function CompareScreen() {
  const colors = useThemeColors();
  const user = useUser();

  const [tab, setTab] = useState<CompareTab>('select');

  // Filters
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [dobMode, setDobMode] = useState<DobMode>('year');
  const [year, setYear] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters: CompareFilters = useMemo(
    () => ({
      query: debounced || undefined,
      teamIds: teamIds.length ? teamIds : undefined,
      year: dobMode === 'year' && year ? year : undefined,
      from: dobMode === 'range' && from ? from : undefined,
      to: dobMode === 'range' && to ? to : undefined,
    }),
    [debounced, teamIds, dobMode, year, from, to],
  );

  // Selection. `known` keeps every player picked so far, so a chosen player stays
  // on the comparison after a filter change drops them from the picker.
  const [selected, setSelected] = useState<string[]>([]);
  const [known, setKnown] = useState<Map<string, CompareCandidate>>(new Map());
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<CompareSort>({ key: 'rank', dir: 'asc' });
  const [openSaved, setOpenSaved] = useState<SavedComparison | null>(null);

  const teamsQuery = useTeamsQuery();
  const yearsQuery = useCompareBirthYearsQuery();
  const candidatesQuery = useCompareCandidatesQuery(filters);
  // One entry per person: the same child filed under several records shows once.
  const pool = useMemo(
    () => foldCompareCandidates(candidatesQuery.data?.pages.flatMap((p) => p.rows) ?? []),
    [candidatesQuery.data],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const atLimit = selected.length >= MAX_COMPARE_PLAYERS;

  const toggle = useCallback((c: CompareCandidate) => {
    setKnown((prev) => (prev.has(c.id) ? prev : new Map(prev).set(c.id, c)));
    setSelected((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : addToSelection(prev, [c.id])));
  }, []);

  const [selectingAll, setSelectingAll] = useState(false);
  const selectAll = async () => {
    setSelectingAll(true);
    try {
      // The filtered pool can be larger than what has scrolled in, so ask for the first 100.
      const page = await getDataSource().listCompareCandidates(filters, 0, MAX_COMPARE_PLAYERS);
      const people = foldCompareCandidates(page.rows);
      setKnown((prev) => {
        const next = new Map(prev);
        for (const c of people) next.set(c.id, c);
        return next;
      });
      setSelected((prev) => addToSelection(prev, people.map((c) => c.id)));
      if (page.next != null) {
        Alert.alert('Selection limit', `Added the first ${MAX_COMPARE_PLAYERS} players. Narrow the filters to pick the rest.`);
      }
    } catch (e: any) {
      Alert.alert('Could not select', e?.message || 'Could not load the players.');
    } finally {
      setSelectingAll(false);
    }
  };
  const clearAll = () => {
    setSelected([]);
    setChoices({});
    setForAll(undefined);
    setOpenSaved(null);
  };
  const toggleTeam = (id: string) =>
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : prev.length < MAX_COMPARE_TEAMS ? [...prev, id] : prev));

  // Results
  const assessmentsQuery = useCompareAssessmentsQuery(tab === 'results' ? selected : []);
  // Two copies of one child picked separately still make one row.
  const candidates = useMemo(
    () => foldCompareCandidates(selected.map((id) => known.get(id)).filter((c): c is CompareCandidate => !!c)),
    [selected, known],
  );
  const rowIds = useMemo(() => candidates.map((c) => c.id), [candidates]);
  const [forAll, setForAll] = useState<string | undefined>(undefined);
  const [forAllOpen, setForAllOpen] = useState(false);
  const shared = useMemo(
    () => (assessmentsQuery.data ? sharedEvaluations(rowIds, assessmentsQuery.data) : []),
    [assessmentsQuery.data, rowIds],
  );
  const table = useMemo(
    () =>
      assessmentsQuery.data
        ? buildComparison({ candidates, assessments: assessmentsQuery.data, selectedIds: rowIds, choices, evaluationForAll: forAll, sort })
        : null,
    [assessmentsQuery.data, candidates, rowIds, choices, forAll, sort],
  );
  const [evalPicker, setEvalPicker] = useState<CompareRow | null>(null);

  // Saved comparisons
  const savedQuery = useSavedComparisonsQuery();
  const saveMutation = useSaveComparisonMutation();
  const updateMutation = useUpdateSavedComparisonMutation();
  const deleteMutation = useDeleteSavedComparisonMutation();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const savedInput = (name: string) => ({ name, athleteIds: selected, choices, filters, sort });
  const doSave = async (asNew: boolean) => {
    const name = saveName.trim();
    if (!name) {
      Alert.alert('Name needed', 'Give the comparison a name, like "U10 All Teams Oct 2026".');
      return;
    }
    try {
      if (openSaved && !asNew) {
        setOpenSaved(await updateMutation.mutateAsync({ id: openSaved.id, input: savedInput(name) }));
      } else {
        setOpenSaved(await saveMutation.mutateAsync(savedInput(name)));
      }
      setSaveOpen(false);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Could not save this comparison.');
    }
  };

  const openComparison = async (saved: SavedComparison) => {
    setSelected(saved.athleteIds);
    setChoices(saved.choices);
    setSort(saved.sort);
    setOpenSaved(saved);
    setSaveName(saved.name);
    // Names for the table come from the picker's cache; page through the list for any not seen yet.
    try {
      const ids = new Set(saved.athleteIds);
      const missing = saved.athleteIds.filter((id) => !known.has(id));
      if (missing.length) {
        const found = new Map<string, CompareCandidate>();
        let next: number | null = 0;
        while (found.size < missing.length && next != null) {
          const page = await getDataSource().listCompareCandidates({}, next, 200);
          page.rows.forEach((c) => ids.has(c.id) && found.set(c.id, c));
          next = page.next;
        }
        setKnown((prev) => {
          const m = new Map(prev);
          found.forEach((c, id) => m.set(id, c));
          return m;
        });
      }
    } catch {
      // The table still opens; players that could not be named are left out.
    }
    setTab('results');
  };

  const removeSaved = (saved: SavedComparison) => {
    Alert.alert('Delete comparison', `Delete "${saved.name}"? The players and their scores are not affected.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteMutation.mutate(saved.id, {
            onSuccess: () => {
              if (openSaved?.id === saved.id) setOpenSaved(null);
            },
            onError: (e: any) => Alert.alert('Could not delete', e?.message || 'Could not delete this comparison.'),
          }),
      },
    ]);
  };

  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const exportAs = async (format: 'pdf' | 'xlsx') => {
    if (!table) return;
    setExporting(format);
    try {
      const file = await buildCompareFile({
        title: openSaved?.name || saveName.trim() || 'Player comparison',
        table,
        format,
        logoUrls: reportLogoUrls({ club: user?.planTier === 'club', organizationLogoUrl: user?.organizationLogoUrl, appLogo: true }),
      });
      await writeAndDeliverFile(file.fileName, file.content, 'base64', file.mimeType, format);
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || 'Could not build the file.');
    } finally {
      setExporting(null);
    }
  };

  const label = (text: string) => (
    <Text className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
      {text}
    </Text>
  );

  const years = yearsQuery.data ?? [];

  const selectHeader = (
    <View className="px-4 pb-2">
      <Input
        label="Player name"
        placeholder="Search by first or last name"
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View className="mt-3">
        {label(`Teams (${teamIds.length} / ${MAX_COMPARE_TEAMS})`)}
        <View className="flex-row flex-wrap gap-2">
          {(teamsQuery.data ?? []).map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              active={teamIds.includes(t.id)}
              disabled={!teamIds.includes(t.id) && teamIds.length >= MAX_COMPARE_TEAMS}
              onPress={() => toggleTeam(t.id)}
            />
          ))}
          {teamsQuery.data && !teamsQuery.data.length ? (
            <Text className="text-sm" style={{ color: colors.inkMuted }}>
              No teams yet. Players from evaluations still appear below.
            </Text>
          ) : null}
        </View>
      </View>

      <View className="mt-3">
        <View className="mb-2 flex-row items-center gap-2">
          <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Birth date
          </Text>
          <Chip label="Year" active={dobMode === 'year'} onPress={() => setDobMode('year')} />
          <Chip label="Date range" active={dobMode === 'range'} onPress={() => setDobMode('range')} />
        </View>
        {dobMode === 'year' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <Chip label="Any year" active={!year} onPress={() => setYear('')} />
            {years.map((y) => (
              <Chip key={y} label={y} active={year === y} onPress={() => setYear(year === y ? '' : y)} />
            ))}
          </ScrollView>
        ) : (
          <View className="gap-2">
            <DateField label="From" value={from} onChange={setFrom} placeholder="Select a date" />
            <DateField label="To" value={to} onChange={setTo} placeholder="Select a date" minDate={from || undefined} />
          </View>
        )}
      </View>

      <View className="mt-4 flex-row flex-wrap items-center gap-2">
        <Text className="mr-auto text-base font-bold" style={{ color: colors.ink }}>
          {selected.length} / {MAX_COMPARE_PLAYERS} selected
        </Text>
        <Button label="Select all" size="sm" variant="secondary" loading={selectingAll} onPress={selectAll} />
        <Button label="Clear all" size="sm" variant="ghost" disabled={!selected.length} onPress={clearAll} />
      </View>
    </View>
  );

  return (
    <Screen padded={false}>
      <View className="px-4 pb-2">
        <Header title="Compare" showBack />
        <Tabs
          tabs={[
            { key: 'select', label: 'Select players', badge: selected.length || undefined },
            { key: 'results', label: 'Comparison' },
            { key: 'saved', label: 'Saved', badge: savedQuery.data?.length || undefined },
          ]}
          activeKey={tab}
          onChange={(k) => setTab(k as CompareTab)}
        />
      </View>

      {tab === 'select' ? (
        <>
          <FlatList
            data={pool}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={selectHeader}
            initialNumToRender={14}
            windowSize={9}
            maxToRenderPerBatch={14}
            onEndReachedThreshold={0.6}
            onEndReached={() => {
              if (candidatesQuery.hasNextPage && !candidatesQuery.isFetchingNextPage) candidatesQuery.fetchNextPage();
            }}
            contentContainerStyle={{ paddingBottom: 90, flexGrow: 1 }}
            ListEmptyComponent={
              candidatesQuery.isLoading ? (
                <LoadingState message="Loading players..." />
              ) : candidatesQuery.isError ? (
                <ErrorState message={(candidatesQuery.error as Error)?.message || 'Could not load players.'} onRetry={() => candidatesQuery.refetch()} />
              ) : (
                <EmptyState title="No players found" message="No players match these filters. Try a different name, team or birth date." />
              )
            }
            ListFooterComponent={candidatesQuery.isFetchingNextPage ? <ActivityIndicator color={colors.primary} style={{ margin: 16 }} /> : null}
            renderItem={({ item }) => {
              const checked = selectedSet.has(item.id);
              const blocked = !checked && atLimit;
              return (
                <Pressable
                  onPress={() => !blocked && toggle(item)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked, disabled: blocked }}
                  className="flex-row items-center gap-3 rounded-xl border px-3 py-2"
                  style={{
                    marginHorizontal: 16,
                    marginBottom: 8,
                    backgroundColor: checked ? 'rgba(255,107,43,0.08)' : colors.card,
                    borderColor: checked ? colors.primary : colors.border,
                    opacity: blocked ? 0.45 : 1,
                  }}
                >
                  <View
                    className="items-center justify-center rounded-md border"
                    style={{ width: 24, height: 24, borderColor: checked ? colors.primary : colors.inkMuted, backgroundColor: checked ? colors.primary : 'transparent' }}
                  >
                    {checked ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}
                  </View>
                  <Avatar first={item.first} last={item.last} uri={item.avatarUrl} size={36} />
                  <View className="flex-1">
                    <Text className="text-base font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                      {candidateName(item)}
                    </Text>
                    <Text className="text-xs" style={{ color: colors.inkMuted }} numberOfLines={1}>
                      {item.teams.length ? item.teams.map((t) => t.teamName).join(', ') : 'No team'}
                      {item.dateOfBirth ? ` · ${item.dateOfBirth}` : item.yearOfBirth ? ` · ${item.yearOfBirth}` : ''}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
          <View
            pointerEvents="box-none"
            style={{ position: 'absolute', left: 16, right: 16, bottom: 12 }}
          >
            <Button label={`Compare ${selected.length || ''} ${selected.length === 1 ? 'player' : 'players'}`.replace('  ', ' ')} disabled={selected.length < 1} onPress={() => setTab('results')} />
          </View>
        </>
      ) : null}

      {tab === 'results' ? (
        selected.length === 0 ? (
          <EmptyState title="No players selected" message="Pick the players to compare on the Select players tab." />
        ) : assessmentsQuery.isError ? (
          <ErrorState message="Could not load the comparison." onRetry={() => assessmentsQuery.refetch()} />
        ) : assessmentsQuery.isLoading || !table ? (
          <LoadingState message="Building the comparison..." />
        ) : (
          <View className="flex-1">
            <View className="flex-row flex-wrap items-center gap-2 px-4 pb-2">
              <Text className="mr-auto text-sm" style={{ color: colors.inkMuted }} numberOfLines={1}>
                {openSaved ? `${openSaved.name} · ` : ''}
                {table.rows.length} {table.rows.length === 1 ? 'player' : 'players'}
              </Text>
              <Button
                label="Save"
                size="sm"
                variant="secondary"
                onPress={() => {
                  if (!saveName) setSaveName(openSaved?.name ?? '');
                  setSaveOpen(true);
                }}
              />
              <Button label="PDF" size="sm" loading={exporting === 'pdf'} onPress={() => exportAs('pdf')} />
              <Button label="Excel" size="sm" loading={exporting === 'xlsx'} onPress={() => exportAs('xlsx')} />
            </View>
            {shared.length > 0 ? (
              <Pressable
                onPress={() => setForAllOpen(true)}
                className="mx-4 mb-2 flex-row items-center justify-between rounded-xl border px-3 py-2"
                style={{ borderColor: colors.border, backgroundColor: colors.tile }}
                accessibilityLabel="Choose the evaluation shown for everyone"
              >
                <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
                  Evaluation for everyone
                </Text>
                <Text className="ml-3 flex-1 text-right text-sm font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                  {forAll ? shared.find((o) => o.tryoutId === forAll)?.label ?? 'Automatic' : `Automatic · ${shared[0].label}`} ▾
                </Text>
              </Pressable>
            ) : null}
            <ResultsTable table={table} sort={sort} onSort={(key) => setSort((s) => nextSort(s, key))} onPickEval={setEvalPicker} />
          </View>
        )
      ) : null}

      {tab === 'saved' ? (
        savedQuery.isLoading ? (
          <LoadingState message="Loading saved comparisons..." />
        ) : savedQuery.isError ? (
          <ErrorState message="Could not load saved comparisons." onRetry={() => savedQuery.refetch()} />
        ) : !savedQuery.data?.length ? (
          <EmptyState title="No saved comparisons" message="Save a comparison from the Comparison tab to reopen it later." />
        ) : (
          <FlatList
            data={savedQuery.data}
            keyExtractor={(s) => s.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <Card className="mb-2 gap-2">
                <Text className="text-base font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="text-sm" style={{ color: colors.inkMuted }}>
                  Saved {new Date(item.updatedAt).toLocaleDateString()} · {item.athleteIds.length} players
                </Text>
                <View className="flex-row gap-2">
                  <Button label="Open" size="sm" onPress={() => openComparison(item)} />
                  <Button label="Delete" size="sm" variant="ghost" onPress={() => removeSaved(item)} />
                </View>
              </Card>
            )}
          />
        )
      ) : null}

      <Modal
        visible={saveOpen}
        title={openSaved ? 'Save comparison' : 'Name this comparison'}
        onClose={() => setSaveOpen(false)}
        footer={
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button label="Cancel" variant="ghost" onPress={() => setSaveOpen(false)} />
            {openSaved ? <Button label="Save as new" variant="secondary" onPress={() => doSave(true)} /> : null}
            <Button label={openSaved ? 'Update' : 'Save'} loading={saveMutation.isPending || updateMutation.isPending} onPress={() => doSave(false)} />
          </View>
        }
      >
        <Input label="Name" placeholder="U10 All Teams Oct 2026" value={saveName} onChangeText={setSaveName} maxLength={120} />
      </Modal>

      <Modal visible={forAllOpen} title="Evaluation for everyone" onClose={() => setForAllOpen(false)}>
        <View className="gap-2">
          <Text className="text-xs" style={{ color: colors.inkMuted }}>
            Shows this evaluation for every player who was scored in it. Players who were not keep their own.
          </Text>
          {[{ tryoutId: '', label: `Automatic (${shared[0]?.label ?? 'most shared'})`, date: undefined, players: 0 }, ...shared].map((o) => {
            const active = (forAll ?? '') === o.tryoutId;
            return (
              <Pressable
                key={o.tryoutId || 'auto'}
                onPress={() => {
                  setForAll(o.tryoutId || undefined);
                  setChoices({});
                  setForAllOpen(false);
                }}
                className="rounded-xl border px-4 py-3"
                style={{ backgroundColor: active ? 'rgba(255,107,43,0.12)' : colors.tile, borderColor: active ? colors.primary : colors.border }}
              >
                <Text className="text-base font-bold" style={{ color: colors.ink }}>
                  {o.label}
                </Text>
                {o.tryoutId ? (
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    {o.date ? formatCompareDate(o.date) : 'No date'} · {o.players} {o.players === 1 ? 'player' : 'players'}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>

      <EvaluationPicker
        row={evalPicker}
        onClose={() => setEvalPicker(null)}
        onChoose={(athleteId, tryoutId) => {
          setChoices((c) => ({ ...c, [athleteId]: tryoutId }));
          setEvalPicker(null);
        }}
      />

      <BottomNav active="compare" />
    </Screen>
  );
}

function EvaluationPicker({
  row,
  onClose,
  onChoose,
}: {
  row: CompareRow | null;
  onClose: () => void;
  onChoose: (athleteId: string, tryoutId: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <Modal visible={!!row} title={row ? `${row.name}: evaluation` : 'Evaluation'} onClose={onClose}>
      <View className="gap-2">
        {(row?.evaluations ?? []).map((a: CompareAssessment) => {
          const active = row?.assessment?.tryoutId === a.tryoutId;
          return (
            <Pressable
              key={a.tryoutId}
              onPress={() => row && onChoose(row.athleteId, a.tryoutId)}
              className="rounded-xl border px-4 py-3"
              style={{ backgroundColor: active ? 'rgba(255,107,43,0.12)' : colors.tile, borderColor: active ? colors.primary : colors.border }}
            >
              <Text className="text-base font-bold" style={{ color: colors.ink }}>
                {a.tryoutName}
              </Text>
              <Text className="text-xs" style={{ color: colors.inkMuted }}>
                {a.date ? formatCompareDate(a.date) : 'No date'} · {a.evalCount} {a.evalCount === 1 ? 'session' : 'sessions'} · overall {a.overall.toFixed(1)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}

function ResultsTable({
  table,
  sort,
  onSort,
  onPickEval,
}: {
  table: ReturnType<typeof buildComparison>;
  sort: CompareSort;
  onSort: (key: string) => void;
  onPickEval: (row: CompareRow) => void;
}) {
  const colors = useThemeColors();
  const width = RANK_W + NAME_W + EVAL_W + SCORE_W * (1 + table.columns.length);
  const arrow = (key: string) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const head = (key: string, text: string, w: number, sub?: string) => (
    <Pressable key={key} onPress={() => onSort(key)} style={{ width: w, paddingHorizontal: 8, paddingVertical: 8 }} accessibilityLabel={`Sort by ${text}`}>
      <Text className="text-xs font-bold uppercase" style={{ color: sort.key === key ? colors.primary : colors.inkMuted }} numberOfLines={2}>
        {text}
        {arrow(key)}
      </Text>
      {sub ? (
        <Text style={{ color: colors.inkMuted, fontSize: 10 }} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );

  if (!table.rows.length) return <EmptyState title="No players to show" message="None of the selected players could be loaded." />;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ flexGrow: 1 }}>
      <View style={{ width, flex: 1 }}>
        <View className="flex-row border-b" style={{ borderBottomColor: colors.border, backgroundColor: colors.card }}>
          {head('rank', 'Rank', RANK_W)}
          {head('name', 'Player', NAME_W)}
          <View style={{ width: EVAL_W, paddingHorizontal: 8, paddingVertical: 8 }}>
            <Text className="text-xs font-bold uppercase" style={{ color: colors.inkMuted }}>
              Evaluation
            </Text>
          </View>
          {head('overall', 'Overall', SCORE_W)}
          {table.columns.map((c) => head(c.id, c.label, SCORE_W, c.benchmark ? `benchmark ${c.benchmark}` : undefined))}
        </View>
        <FlatList
          data={table.rows}
          keyExtractor={(r) => r.athleteId}
          initialNumToRender={16}
          windowSize={9}
          contentContainerStyle={{ paddingBottom: 100 }}
          renderItem={({ item: r }) => (
            <View className="flex-row items-center border-b" style={{ borderBottomColor: colors.border }}>
              <Text style={{ width: RANK_W, paddingHorizontal: 8, color: colors.ink, fontWeight: '700' }}>{r.rank ?? '–'}</Text>
              <View style={{ width: NAME_W, paddingHorizontal: 8, paddingVertical: 8 }}>
                <Text className="text-sm font-bold" style={{ color: colors.ink }} numberOfLines={1}>
                  {r.name}
                </Text>
                <Text className="text-xs" style={{ color: colors.inkMuted }} numberOfLines={1}>
                  {r.teamNames.join(', ') || 'No team'}
                </Text>
              </View>
              <Pressable
                onPress={() => r.evaluations.length > 1 && onPickEval(r)}
                style={{ width: EVAL_W, paddingHorizontal: 8, paddingVertical: 8 }}
                accessibilityLabel={`Evaluation for ${r.name}`}
              >
                {r.assessment ? (
                  <>
                    <Text className="text-xs font-semibold" style={{ color: colors.ink }} numberOfLines={1}>
                      {r.assessment.tryoutName}
                    </Text>
                    <Text style={{ color: colors.inkMuted, fontSize: 11 }} numberOfLines={1}>
                      {r.assessment.date ? formatCompareDate(r.assessment.date) : 'No date'}
                      {r.evaluations.length > 1 ? ' · tap to switch' : ''}
                    </Text>
                  </>
                ) : (
                  <Text className="text-xs" style={{ color: colors.inkMuted }}>
                    Not evaluated
                  </Text>
                )}
              </Pressable>
              <ScoreCell value={r.overall} top={isTopPerformer(table, 'overall', r.overall)} bold />
              {table.columns.map((c) => (
                <ScoreCell key={c.id} value={r.scores[c.id] ?? null} top={isTopPerformer(table, c.id, r.scores[c.id])} />
              ))}
            </View>
          )}
        />
      </View>
    </ScrollView>
  );
}

function ScoreCell({ value, top, bold }: { value: number | null; top: boolean; bold?: boolean }) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        width: SCORE_W,
        alignSelf: 'stretch',
        justifyContent: 'center',
        paddingHorizontal: 8,
        backgroundColor: top ? 'rgba(34,197,94,0.14)' : undefined,
      }}
    >
      <Text style={{ color: value == null ? colors.inkMuted : top ? colors.success : colors.ink, fontWeight: top || bold ? '700' : '500' }}>
        {value == null ? '–' : value.toFixed(1)}
      </Text>
    </View>
  );
}

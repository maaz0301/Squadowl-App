import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { RosterFilter } from '@/state/sessionStore';
import { CheckSquareIcon, ChevronIcon, ClearIcon, PlayIcon, PlusIcon, SearchIcon, ToolsIcon, UploadIcon } from './icons';

/** The fixed filters, in the order they're offered; the sport's position categories follow them. */
const FILTERS: { key: RosterFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'scored', label: 'Scored' },
  { key: 'unscored', label: 'Unscored' },
];

/**
 * The big one. Scoring is what a coach opened this screen to do, so it gets the
 * full width and the brand fill, and says how much is left rather than making
 * them read that off the list.
 */
export function ScoreCta({
  total,
  scored,
  onPress,
  playersLabel = 'Players',
}: {
  total: number;
  scored: number;
  onPress: () => void;
  /** The evaluation's word for players, e.g. "Skaters". */
  playersLabel?: string;
}) {
  const colors = useThemeColors();
  const pct = total === 0 ? 0 : Math.round((scored / total) * 100);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Score ${playersLabel.toLowerCase()}`}
      accessibilityHint={`${scored} of ${total} ${playersLabel.toLowerCase()} scored`}
      className="relative flex-row items-center gap-3.5 overflow-hidden rounded-2xl px-4 py-4 active:opacity-85"
      style={{ backgroundColor: colors.primary }}
    >
      <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.18)' }}>
        <PlayIcon color="#fff" size={19} />
      </View>
      <View className="flex-1">
        <Text className="font-display text-lg font-bold" style={{ color: '#fff' }}>
          Score {playersLabel}
        </Text>
      </View>
      <ChevronIcon color="#fff" size={20} />

      {/* How far through the roster the scoring is, drawn along the bottom edge
          of the button itself: the same fact the filter chips carry as numbers,
          in the one form that costs no vertical space on a phone. */}
      <View className="absolute bottom-0 left-0 right-0 h-1.5" style={{ backgroundColor: 'rgba(0,0,0,0.22)' }}>
        <View className="h-full" style={{ width: `${pct}%`, backgroundColor: 'rgba(255,255,255,0.92)' }} />
      </View>
    </Pressable>
  );
}

/** Add, Import, Select and Tools: equal buttons, so none of them reads as the main one. */
export function RosterActions({
  onAdd,
  onImport,
  onSelect,
  onTools,
  onCompleteAssessing,
  completingAssessing,
}: {
  onAdd: () => void;
  onImport: () => void;
  onSelect: () => void;
  onTools: () => void;
  /** Assessors only — see useCompleteAssessing. Omitted entirely for anyone else. */
  onCompleteAssessing?: () => void;
  completingAssessing?: boolean;
}) {
  const colors = useThemeColors();
  const actions = [
    { label: 'Add', icon: PlusIcon, onPress: onAdd },
    { label: 'Import', icon: UploadIcon, onPress: onImport },
    { label: 'Select', icon: CheckSquareIcon, onPress: onSelect },
    { label: 'Tools', icon: ToolsIcon, onPress: onTools },
  ];

  // A 2x2 grid, not one row of four — four labels at the original single-row
  // size don't fit a phone-width screen without truncating.
  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap justify-between gap-2">
        {actions.map(({ label, icon: Icon, onPress }) => (
          <Pressable
            key={label}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            className="min-h-[56px] w-[48.5%] flex-row items-center justify-center gap-2.5 rounded-2xl border px-2 py-4 active:opacity-70"
            style={{ backgroundColor: colors.tile, borderColor: colors.border }}
          >
            <View
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: 'rgba(255,107,43,0.14)' }}
            >
              <Icon color={colors.primary} size={18} />
            </View>
            <Text className="text-lg font-bold" style={{ color: colors.ink }}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      {onCompleteAssessing ? (
        <Button
          label="Complete Assessing"
          variant="secondary"
          loading={completingAssessing}
          onPress={onCompleteAssessing}
        />
      ) : null}
    </View>
  );
}

/**
 * Replaces RosterActions once select mode is on: back out of select mode,
 * toggle all players in the current (filtered) list, or delete whichever ones
 * are checked. `count` is how many are currently selected — 0 disables Delete
 * rather than hiding it, so the button stays put as a coach starts checking rows.
 */
export function RosterSelectToolbar({
  allSelected,
  count,
  deleting,
  onBack,
  onToggleAll,
  onDeleteSelected,
  deleteLabel = 'Delete Selected',
}: {
  allSelected: boolean;
  count: number;
  deleting: boolean;
  /** Wording for the destructive button, so it can match the confirmation it opens. */
  deleteLabel?: string;
  onBack: () => void;
  onToggleAll: () => void;
  onDeleteSelected: () => void;
}) {
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      <Button label="← Back" variant="ghost" size="sm" onPress={onBack} disabled={deleting} />
      <Button
        label={allSelected ? 'Deselect All' : 'Select All'}
        variant="secondary"
        size="sm"
        onPress={onToggleAll}
        disabled={deleting}
      />
      <Button
        label={`${deleteLabel}${count ? ` (${count})` : ''}`}
        variant="danger"
        size="sm"
        disabled={count === 0}
        loading={deleting}
        onPress={onDeleteSelected}
        className="flex-1"
      />
    </View>
  );
}

/** Search, with the magnifier inside the field and a clear button once there's something to clear. */
export function RosterSearch({
  value,
  onChange,
  playersLabel = 'Players',
  jerseyLabel = 'Jersey #',
}: {
  value: string;
  onChange: (v: string) => void;
  playersLabel?: string;
  jerseyLabel?: string;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="min-h-[52px] flex-row items-center gap-2 rounded-2xl border px-3.5"
      style={{ backgroundColor: colors.field, borderColor: colors.border }}
    >
      <SearchIcon color={colors.inkFaint} size={18} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={`Search ${playersLabel.toLowerCase()} by name or ${jerseyLabel.toLowerCase()}`}
        placeholderTextColor={colors.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        className="flex-1 py-2.5 text-base"
        style={{ color: colors.ink }}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear search">
          <ClearIcon color={colors.inkMuted} size={18} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The filters, each carrying its own count.
 *
 * One scrolling row rather than a wrapping block: the counts are what a coach
 * is actually after here ("how many are still unscored?"), and a row that grows
 * a second line every time a label gets longer pushes the players themselves
 * off the screen.
 */
export function RosterFilters({
  active,
  counts,
  onSelect,
}: {
  active: RosterFilter;
  counts: Record<string, number>;
  onSelect: (f: RosterFilter) => void;
}) {
  const colors = useThemeColors();
  const filters: { key: RosterFilter; label: string }[] = [...FILTERS];
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 10, paddingLeft: 2, paddingRight: 8, paddingVertical: 2 }}
    >
      {filters.map(({ key, label }) => {
        const isActive = active === key;
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            className="min-h-[46px] flex-row items-center gap-2 rounded-full border active:opacity-70"
            style={{
              backgroundColor: isActive ? 'rgba(255,107,43,0.16)' : colors.tile,
              borderColor: isActive ? colors.primary : colors.border,
              paddingLeft: 20,
              paddingRight: 12,
              paddingVertical: 10,
            }}
          >
            <Text className="text-base font-semibold" style={{ color: isActive ? colors.primary : colors.inkMuted }}>
              {label}
            </Text>
            <View
              className="min-w-[28px] items-center rounded-full px-2 py-1"
              style={{ backgroundColor: isActive ? 'rgba(255,107,43,0.24)' : colors.border }}
            >
              <Text
                className="text-xs font-bold"
                style={{ color: isActive ? colors.primary : colors.inkFaint }}
              >
                {counts[key] ?? 0}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

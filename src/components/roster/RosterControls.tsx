import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import type { RosterFilter } from '@/state/sessionStore';
import { ChevronIcon, ClearIcon, PlayIcon, PlusIcon, SearchIcon, ToolsIcon, UploadIcon } from './icons';

/** The filters, in the order they're offered, with the label each one shows. */
const FILTERS: { key: RosterFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'scored', label: 'Scored' },
  { key: 'unscored', label: 'Unscored' },
  { key: 'skaters', label: 'Skaters' },
  { key: 'goalies', label: 'Goalies' },
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
}: {
  total: number;
  scored: number;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const remaining = total - scored;
  const pct = total === 0 ? 0 : Math.round((scored / total) * 100);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Score players"
      accessibilityHint={`${scored} of ${total} players scored`}
      className="relative flex-row items-center gap-3.5 overflow-hidden rounded-2xl px-4 py-4 active:opacity-85"
      style={{ backgroundColor: colors.primary }}
    >
      <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.18)' }}>
        <PlayIcon color="#fff" size={19} />
      </View>
      <View className="flex-1">
        <Text className="font-display text-lg font-bold" style={{ color: '#fff' }}>
          Score Players
        </Text>
        <Text className="mt-0.5 text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {remaining === 0 ? 'Everyone has been scored' : `${remaining} still to score`}
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

/** Add, Import and Tools: three equal buttons, so none of them reads as the main one. */
export function RosterActions({
  onAdd,
  onImport,
  onTools,
}: {
  onAdd: () => void;
  onImport: () => void;
  onTools: () => void;
}) {
  const colors = useThemeColors();
  const actions = [
    { label: 'Add', icon: PlusIcon, onPress: onAdd },
    { label: 'Import', icon: UploadIcon, onPress: onImport },
    { label: 'Tools', icon: ToolsIcon, onPress: onTools },
  ];

  return (
    <View className="flex-row gap-2">
      {actions.map(({ label, icon: Icon, onPress }) => (
        <Pressable
          key={label}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          className="min-h-[60px] flex-1 flex-row items-center justify-center gap-2.5 rounded-2xl border px-2 py-5 active:opacity-70"
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
  );
}

/** Search, with the magnifier inside the field and a clear button once there's something to clear. */
export function RosterSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
        placeholder="Search players by name"
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
  counts: Record<RosterFilter, number>;
  onSelect: (f: RosterFilter) => void;
}) {
  const colors = useThemeColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ gap: 10, paddingLeft: 2, paddingRight: 8, paddingVertical: 2 }}
    >
      {FILTERS.map(({ key, label }) => {
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
                {counts[key]}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

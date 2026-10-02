import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { MONTHS, buildDateOfBirth, daysInMonth, splitDateOfBirth, withYear } from '@/lib/birthDate';
import { Button } from './Button';
import { Modal } from './Modal';

interface BirthDateFieldProps {
  label?: string;
  /** The year of birth, "YYYY", always kept, whether or not the full date is known. */
  year?: string;
  /** The full date, "YYYY-MM-DD", or '' while the month or day is not chosen. */
  dateOfBirth?: string;
  onChange: (value: { year: string; dateOfBirth: string }) => void;
  error?: string;
}

interface Option {
  value: string;
  label: string;
}

/** One of the three pickers: a field that opens a grid of choices. */
function PickerField({
  title,
  placeholder,
  value,
  options,
  columns,
  onSelect,
  hasError,
}: {
  title: string;
  placeholder: string;
  value: string;
  options: Option[];
  columns: 2 | 3;
  onSelect: (value: string) => void;
  hasError?: boolean;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const chosen = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={title}
        className="flex-1 rounded-md px-3 py-3 border min-h-[48px] flex-row items-center justify-between"
        style={{ backgroundColor: colors.field, borderColor: hasError ? colors.danger : colors.border }}
      >
        <Text className="text-base" numberOfLines={1} style={{ color: chosen ? colors.ink : colors.placeholder }}>
          {chosen ? chosen.label : placeholder}
        </Text>
        <Text style={{ color: colors.inkMuted, fontSize: 14 }}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        title={title}
        onClose={() => setOpen(false)}
        footer={
          <View className="flex-row gap-2 mt-4">
            <Button
              label="Clear"
              variant="ghost"
              className="flex-1"
              onPress={() => {
                onSelect('');
                setOpen(false);
              }}
            />
          </View>
        }
      >
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator>
          <View className="flex-row flex-wrap justify-start gap-2 p-1">
            {options.map((o) => {
              const selected = o.value === value;
              return (
                <Pressable
                  key={o.value}
                  onPress={() => {
                    onSelect(o.value);
                    setOpen(false);
                  }}
                  className="rounded-lg items-center justify-center border"
                  style={{
                    width: columns === 3 ? '30%' : '47%',
                    height: 44,
                    backgroundColor: selected ? colors.primary : 'transparent',
                    borderColor: selected ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    className="text-base"
                    style={{ color: selected ? '#fff' : colors.ink, fontWeight: selected ? '700' : '400' }}
                  >
                    {o.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Modal>
    </>
  );
}

/**
 * Year, month and day of birth. The year alone is still a complete answer (the
 * month and day are optional); choosing all three records the full date.
 */
export function BirthDateField({ label, year = '', dateOfBirth = '', onChange, error }: BirthDateFieldProps) {
  const colors = useThemeColors();
  const parts = splitDateOfBirth(dateOfBirth);
  // A month and day picked before the date was complete live only here until all
  // three are set, so choosing them in any order does not lose the first.
  const [pending, setPending] = useState<{ month: string; day: string }>({ month: parts.month, day: parts.day });
  const month = parts.month || pending.month;
  const day = parts.day || pending.day;

  const years = useMemo<Option[]>(() => {
    const current = new Date().getFullYear();
    const list: Option[] = [];
    for (let y = current; y >= 1950; y--) list.push({ value: String(y), label: String(y) });
    return list;
  }, []);
  const months = useMemo<Option[]>(() => MONTHS.map((m, i) => ({ value: String(i + 1), label: m.slice(0, 3) })), []);
  const dayCount = year && month ? daysInMonth(Number(year), Number(month)) : 31;
  const days = useMemo<Option[]>(
    () => Array.from({ length: dayCount }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
    [dayCount],
  );

  const emit = (nextYear: string, nextMonth: string, nextDay: string) => {
    const fixed = withYear({ year, month: nextMonth, day: nextDay }, nextYear);
    setPending({ month: fixed.month, day: fixed.day });
    onChange({ year: nextYear, dateOfBirth: buildDateOfBirth(nextYear, fixed.month, fixed.day) });
  };

  return (
    <View className="gap-1">
      {label ? (
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      ) : null}
      <View className="flex-row gap-2">
        <PickerField
          title="Year of Birth"
          placeholder="Year"
          value={year}
          options={years}
          columns={3}
          hasError={!!error}
          onSelect={(v) => emit(v, month, day)}
        />
        <PickerField
          title="Month of Birth"
          placeholder="Month"
          value={month}
          options={months}
          columns={3}
          onSelect={(v) => emit(year, v, day)}
        />
        <PickerField
          title="Day of Birth"
          placeholder="Day"
          value={day}
          options={days}
          columns={3}
          onSelect={(v) => emit(year, month, v)}
        />
      </View>
      {error ? (
        <Text className="text-sm mt-1" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

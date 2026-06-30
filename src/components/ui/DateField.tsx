import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Modal } from './Modal';
import { Button } from './Button';

interface DateFieldProps {
  label?: string;
  value?: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function parse(value?: string): { y: number; m: number; d: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

function formatDisplay(value?: string): string | null {
  const p = parse(value);
  if (!p) return null;
  return `${MONTHS_SHORT[p.m]} ${p.d}, ${p.y}`;
}

export function DateField({ label, value, onChange, placeholder = 'Select a date' }: DateFieldProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const today = new Date();
  const parsed = parse(value);
  const [view, setView] = useState<{ y: number; m: number }>(() =>
    parsed ? { y: parsed.y, m: parsed.m } : { y: today.getFullYear(), m: today.getMonth() },
  );

  const display = formatDisplay(value);

  const cells = useMemo(() => {
    const firstWeekday = new Date(view.y, view.m, 1).getDay();
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const out: (number | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [view]);

  const shift = (delta: number) => {
    setView((v) => {
      const next = new Date(v.y, v.m + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() };
    });
  };

  const openPicker = () => {
    const p = parse(value);
    setView(p ? { y: p.y, m: p.m } : { y: today.getFullYear(), m: today.getMonth() });
    setOpen(true);
  };

  const select = (d: number) => {
    onChange(toKey(view.y, view.m, d));
    setOpen(false);
  };

  const isToday = (d: number) =>
    view.y === today.getFullYear() && view.m === today.getMonth() && d === today.getDate();
  const isSelected = (d: number) =>
    !!parsed && parsed.y === view.y && parsed.m === view.m && parsed.d === d;

  return (
    <View className="gap-1">
      {label ? (
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      ) : null}
      <Pressable
        onPress={openPicker}
        className="rounded-md px-4 py-3 border min-h-[48px] flex-row items-center justify-between"
        style={{ backgroundColor: colors.field, borderColor: colors.border }}
      >
        <Text className="text-base" style={{ color: display ? colors.ink : colors.placeholder }}>
          {display ?? placeholder}
        </Text>
        <Text style={{ color: colors.inkMuted, fontSize: 14 }}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        title="Select date"
        onClose={() => setOpen(false)}
        footer={
          <View className="flex-row gap-2 mt-4">
            <Button
              label="Clear"
              variant="ghost"
              className="flex-1"
              onPress={() => {
                onChange('');
                setOpen(false);
              }}
            />
            <Button
              label="Today"
              variant="secondary"
              className="flex-1"
              onPress={() => {
                onChange(toKey(today.getFullYear(), today.getMonth(), today.getDate()));
                setOpen(false);
              }}
            />
          </View>
        }
      >
        <View>
          <View className="flex-row items-center justify-between mb-4">
            <Pressable
              onPress={() => shift(-1)}
              hitSlop={12}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.tile }}
            >
              <Text style={{ color: colors.ink, fontSize: 18 }}>‹</Text>
            </Pressable>
            <Text className="text-base font-display font-bold" style={{ color: colors.ink }}>
              {MONTHS[view.m]} {view.y}
            </Text>
            <Pressable
              onPress={() => shift(1)}
              hitSlop={12}
              className="w-10 h-10 rounded-full items-center justify-center"
              style={{ backgroundColor: colors.tile }}
            >
              <Text style={{ color: colors.ink, fontSize: 18 }}>›</Text>
            </Pressable>
          </View>

          <View className="flex-row">
            {WEEKDAYS.map((w, i) => (
              <View key={i} className="items-center" style={{ width: `${100 / 7}%` }}>
                <Text className="text-xs font-semibold" style={{ color: colors.inkFaint }}>
                  {w}
                </Text>
              </View>
            ))}
          </View>

          <View className="flex-row flex-wrap mt-2">
            {cells.map((d, i) => (
              <View key={i} className="items-center justify-center py-1" style={{ width: `${100 / 7}%` }}>
                {d == null ? (
                  <View className="w-10 h-10" />
                ) : (
                  <Pressable
                    onPress={() => select(d)}
                    className="w-10 h-10 rounded-full items-center justify-center border"
                    style={{
                      backgroundColor: isSelected(d) ? colors.primary : 'transparent',
                      borderColor: isToday(d) && !isSelected(d) ? colors.primary : 'transparent',
                    }}
                  >
                    <Text
                      className="text-base"
                      style={{
                        color: isSelected(d) ? '#fff' : colors.ink,
                        fontWeight: isSelected(d) || isToday(d) ? '700' : '400',
                      }}
                    >
                      {d}
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

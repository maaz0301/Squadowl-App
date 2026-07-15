import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Modal } from './Modal';
import { Button } from './Button';

interface TimeFieldProps {
  label?: string;
  value?: string; // 24h "HH:MM"
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disablePast?: boolean;
  dateValue?: string; // YYYY-MM-DD
}

const pad = (n: number) => String(n).padStart(2, '0');

function parse(value?: string): { h24: number; min: number } | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h24 = Number(m[1]);
  const min = Number(m[2]);
  if (h24 > 23 || min > 59) return null;
  return { h24, min };
}

function to12(h24: number): { hour: number; period: 'AM' | 'PM' } {
  const period = h24 >= 12 ? 'PM' : 'AM';
  const hour = h24 % 12 === 0 ? 12 : h24 % 12;
  return { hour, period };
}
function to24(hour: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') return hour === 12 ? 0 : hour;
  return hour === 12 ? 12 : hour + 12;
}

function formatDisplay(value?: string): string | null {
  const p = parse(value);
  if (!p) return null;
  const { hour, period } = to12(p.h24);
  return `${hour}:${pad(p.min)} ${period}`;
}

const FACE = 248;
const CENTER = FACE / 2;
const RADIUS = CENTER - 26;
const CELL = 40;

export function TimeField({ label, value, onChange, placeholder = 'Select a time', error, disablePast, dateValue }: TimeFieldProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const parsed = parse(value);
  const init = parsed ? to12(parsed.h24) : { hour: 9, period: 'AM' as const };
  const [hour, setHour] = useState(init.hour);
  const [minute, setMinute] = useState(parsed?.min ?? 0);
  const [period, setPeriod] = useState<'AM' | 'PM'>(init.period);

  const display = formatDisplay(value);

  const openPicker = () => {
    const p = parse(value);
    const t = p ? to12(p.h24) : { hour: 9, period: 'AM' as const };
    let m = p?.min ?? 0;
    let newHour = t.hour;
    let newPeriod = t.period;

    if (!p && disablePast) {
      const now = new Date();
      let isToday = false;
      if (dateValue) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
        if (match) {
           const y = Number(match[1]);
           const mo = Number(match[2]) - 1;
           const d = Number(match[3]);
           if (y === now.getFullYear() && mo === now.getMonth() && d === now.getDate()) isToday = true;
        }
      } else {
        isToday = true;
      }

      if (isToday) {
        const h24 = to24(newHour, newPeriod);
        if (h24 < now.getHours() || (h24 === now.getHours() && m < now.getMinutes())) {
           let nextH24 = now.getHours() + 1;
           if (nextH24 > 23) {
             nextH24 = 23;
             m = 59;
           } else {
             m = 0;
           }
           const nextT12 = to12(nextH24);
           newHour = nextT12.hour;
           newPeriod = nextT12.period;
        }
      }
    }

    setHour(newHour);
    setMinute(m);
    setPeriod(newPeriod);
    setMode('hour');
    setOpen(true);
  };

  const confirm = (h = hour, m = minute, pd = period) => {
    onChange(`${pad(to24(h, pd))}:${pad(m)}`);
    setOpen(false);
  };

  const isCurrentStatePast = () => {
    if (!disablePast) return false;
    const now = new Date();
    let isToday = false;
    if (dateValue) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
      if (match) {
        const p = { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
        if (p.y < now.getFullYear() || (p.y === now.getFullYear() && p.m < now.getMonth()) || (p.y === now.getFullYear() && p.m === now.getMonth() && p.d < now.getDate())) return true;
        if (p.y === now.getFullYear() && p.m === now.getMonth() && p.d === now.getDate()) isToday = true;
      }
    } else {
      isToday = true;
    }
    
    if (!isToday) return false;

    const h24 = to24(hour, period);
    if (h24 < now.getHours()) return true;
    if (h24 === now.getHours()) return minute < now.getMinutes();
    return false;
  };

  // hand angle in degrees, 0 = pointing up
  const handAngle = mode === 'hour' ? (hour % 12) * 30 : minute * 6;

  const numbers = mode === 'hour'
    ? Array.from({ length: 12 }, (_, i) => i + 1)
    : Array.from({ length: 12 }, (_, i) => i * 5);

  const angleFor = (n: number) => (mode === 'hour' ? (n % 12) * 30 : n * 6);

  const isPastTime = (n: number) => {
    if (!disablePast) return false;
    const now = new Date();
    let isToday = false;
    if (dateValue) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
      if (match) {
        const p = { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
        if (p.y < now.getFullYear() || (p.y === now.getFullYear() && p.m < now.getMonth()) || (p.y === now.getFullYear() && p.m === now.getMonth() && p.d < now.getDate())) return true;
        if (p.y === now.getFullYear() && p.m === now.getMonth() && p.d === now.getDate()) isToday = true;
      }
    } else {
      isToday = true;
    }
    
    if (!isToday) return false;

    if (mode === 'hour') {
       const h24 = to24(n, period);
       return h24 < now.getHours();
    } else {
       const h24 = to24(hour, period);
       if (h24 < now.getHours()) return true;
       if (h24 === now.getHours()) return n < now.getMinutes();
       return false;
    }
  };

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
        style={{ backgroundColor: colors.field, borderColor: error ? colors.danger : colors.border }}
      >
        <Text className="text-base" style={{ color: display ? colors.ink : colors.placeholder }}>
          {display ?? placeholder}
        </Text>
        <Text style={{ color: colors.inkMuted, fontSize: 14 }}>▾</Text>
      </Pressable>
      {error ? (
        <Text className="text-xs mt-0.5" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}

      <Modal
        visible={open}
        title="Select time"
        onClose={() => setOpen(false)}
        footer={
          <View className="flex-row gap-2 mt-4">
            <Button label="Cancel" variant="ghost" className="flex-1" onPress={() => setOpen(false)} />
            <Button label="Done" className="flex-1" onPress={() => confirm()} disabled={isCurrentStatePast()} />
          </View>
        }
      >
        <View className="items-center">
          {/* Digital readout */}
          <View className="flex-row items-center gap-2 mb-4">
            <Pressable onPress={() => setMode('hour')}>
              <Text
                className="text-3xl font-display font-bold"
                style={{ color: mode === 'hour' ? colors.primary : colors.ink }}
              >
                {hour}
              </Text>
            </Pressable>
            <Text className="text-3xl font-display font-bold" style={{ color: colors.ink }}>
              :
            </Text>
            <Pressable onPress={() => setMode('minute')}>
              <Text
                className="text-3xl font-display font-bold"
                style={{ color: mode === 'minute' ? colors.primary : colors.ink }}
              >
                {pad(minute)}
              </Text>
            </Pressable>
            <View className="ml-3 rounded-md overflow-hidden border" style={{ borderColor: colors.border }}>
              {(['AM', 'PM'] as const).map((p) => (
                <Pressable
                  key={p}
                  onPress={() => setPeriod(p)}
                  className="px-3 py-1"
                  style={{ backgroundColor: period === p ? colors.primary : 'transparent' }}
                >
                  <Text
                    className="text-sm font-bold"
                    style={{ color: period === p ? '#fff' : colors.inkMuted }}
                  >
                    {p}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Clock face */}
          <View
            style={{
              width: FACE,
              height: FACE,
              borderRadius: FACE / 2,
              backgroundColor: colors.tile,
            }}
          >
            {/* hand */}
            <View
              style={{
                position: 'absolute',
                left: CENTER - 1,
                top: CENTER - RADIUS,
                width: 2,
                height: RADIUS,
                backgroundColor: colors.primary,
                transform: [{ rotate: `${handAngle}deg` }],
                transformOrigin: '50% 100%',
              }}
            />
            {/* center dot */}
            <View
              style={{
                position: 'absolute',
                left: CENTER - 4,
                top: CENTER - 4,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.primary,
              }}
            />
            {numbers.map((n) => {
              const theta = (angleFor(n) * Math.PI) / 180;
              const x = CENTER + RADIUS * Math.sin(theta) - CELL / 2;
              const y = CENTER - RADIUS * Math.cos(theta) - CELL / 2;
              const selected = mode === 'hour' ? n === hour : n === minute;
              return (
                <Pressable
                    key={n}
                    disabled={isPastTime(n)}
                    onPress={() => {
                      if (isPastTime(n)) return;
                      if (mode === 'hour') {
                        setHour(n);
                        setMode('minute');
                      } else {
                        setMinute(n);
                      }
                    }}
                    style={{
                      position: 'absolute',
                      left: x,
                      top: y,
                      width: CELL,
                      height: CELL,
                      borderRadius: CELL / 2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: selected ? colors.primary : 'transparent',
                      opacity: isPastTime(n) ? 0.3 : 1,
                    }}
                >
                  <Text
                    className="text-base"
                    style={{
                      color: selected ? '#fff' : colors.ink,
                      fontWeight: selected ? '700' : '400',
                    }}
                  >
                    {mode === 'minute' ? pad(n) : n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </View>
  );
}

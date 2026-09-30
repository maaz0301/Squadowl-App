import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { DURATION_OPTIONS, formatDuration } from '@/data/timeRange';
import { Modal } from './Modal';

interface DurationFieldProps {
  label?: string;
  value?: number; // minutes
  onChange: (minutes: number) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}

/** Picks how long an event runs, in 15-minute steps up to six hours. */
export function DurationField({
  label,
  value,
  onChange,
  placeholder = 'Select a duration',
  error,
  disabled,
}: DurationFieldProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);

  return (
    <View className="gap-1">
      {label ? (
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        className="rounded-md px-4 py-3 border min-h-[48px] flex-row items-center justify-between"
        style={{
          backgroundColor: colors.field,
          borderColor: error ? colors.danger : colors.border,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text className="text-base" style={{ color: value ? colors.ink : colors.placeholder }}>
          {value ? formatDuration(value) : placeholder}
        </Text>
        <Text style={{ color: colors.inkMuted, fontSize: 14 }}>▾</Text>
      </Pressable>
      {error ? (
        <Text className="text-xs mt-0.5" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}

      <Modal visible={open} title="Select duration" onClose={() => setOpen(false)}>
        <View className="gap-1">
          {DURATION_OPTIONS.map((minutes) => {
            const selected = minutes === value;
            return (
              <Pressable
                key={minutes}
                onPress={() => {
                  onChange(minutes);
                  setOpen(false);
                }}
                className="rounded-md px-4 py-3"
                style={{ backgroundColor: selected ? colors.primary : 'transparent' }}
              >
                <Text
                  className="text-base"
                  style={{ color: selected ? '#fff' : colors.ink, fontWeight: selected ? '700' : '400' }}
                >
                  {formatDuration(minutes)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

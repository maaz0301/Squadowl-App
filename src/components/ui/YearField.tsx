import { useMemo, useState } from 'react';
import { Pressable, Text, View, ScrollView } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Modal } from './Modal';
import { Button } from './Button';

interface YearFieldProps {
  label?: string;
  value?: string; // YYYY
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
}

export function YearField({ label, value, onChange, placeholder = 'Select year', error }: YearFieldProps) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  
  const currentYear = new Date().getFullYear();
  
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = currentYear; y >= 1950; y--) {
      list.push(y);
    }
    return list;
  }, [currentYear]);

  const select = (y: number) => {
    onChange(String(y));
    setOpen(false);
  };

  return (
    <View className="gap-1">
      {label ? (
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      ) : null}
      <Pressable
        onPress={() => setOpen(true)}
        className="rounded-md px-4 py-3 border min-h-[48px] flex-row items-center justify-between"
        style={{ backgroundColor: colors.field, borderColor: error ? colors.danger : colors.border }}
      >
        <Text className="text-base" style={{ color: value ? colors.ink : colors.placeholder }}>
          {value || placeholder}
        </Text>
        <Text style={{ color: colors.inkMuted, fontSize: 14 }}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        title="Select Year of Birth"
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
          </View>
        }
      >
        <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={true}>
          <View className="flex-row flex-wrap justify-start gap-2 p-1">
            {years.map((y) => {
              const isSelected = value === String(y);
              return (
                <Pressable
                  key={y}
                  onPress={() => select(y)}
                  className="rounded-lg items-center justify-center border"
                  style={{
                    width: '30%',
                    height: 44,
                    backgroundColor: isSelected ? colors.primary : 'transparent',
                    borderColor: isSelected ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    className="text-base"
                    style={{
                      color: isSelected ? '#fff' : colors.ink,
                      fontWeight: isSelected ? '700' : '400',
                    }}
                  >
                    {y}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </Modal>
      {error ? (
        <Text className="text-sm mt-1" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Input } from '@/components/ui/Input';
import { useThemeColors } from '@/theme/ThemeProvider';

interface MeasurementAssessmentProps {
  label: string;
  value?: number;
  unit?: string;
  onChange: (value: number | undefined) => void;
  error?: string;
}

export function MeasurementAssessment({ label, value, unit, onChange, error }: MeasurementAssessmentProps) {
  const colors = useThemeColors();
  const [internalValue, setInternalValue] = useState(value !== undefined ? String(value) : '');

  const handleChange = (text: string) => {
    // Only allow numbers and decimal point
    const sanitized = text.replace(/[^0-9.]/g, '');
    
    // Prevent multiple decimals
    const parts = sanitized.split('.');
    let finalValue = sanitized;
    if (parts.length > 2) {
      finalValue = parts[0] + '.' + parts.slice(1).join('');
    }

    setInternalValue(finalValue);

    const parsed = parseFloat(finalValue);
    if (!isNaN(parsed)) {
      onChange(parsed);
    } else if (finalValue === '') {
      onChange(undefined);
    }
  };

  return (
    <View className="mb-4">
      <View className="flex-row items-end gap-2">
        <View className="flex-1">
          <Input
            label={label}
            value={internalValue}
            onChangeText={handleChange}
            keyboardType="decimal-pad"
            placeholder="0"
            error={error}
          />
        </View>
        {unit ? (
          <View className="h-[48px] justify-center px-2">
            <Text className="text-base font-bold" style={{ color: colors.ink }}>
              {unit}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

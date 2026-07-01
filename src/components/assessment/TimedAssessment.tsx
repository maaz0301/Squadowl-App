import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Input } from '@/components/ui/Input';
import { useThemeColors } from '@/theme/ThemeProvider';

interface TimedAssessmentProps {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  error?: string;
}

export function TimedAssessment({ label, value, onChange, error }: TimedAssessmentProps) {
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
      <Input
        label={label}
        value={internalValue}
        onChangeText={handleChange}
        keyboardType="decimal-pad"
        placeholder="0.00"
        error={error}
      />
      <Text className="text-xs mt-1" style={{ color: colors.inkMuted }}>
        Enter time in seconds (e.g., 4.55)
      </Text>
    </View>
  );
}

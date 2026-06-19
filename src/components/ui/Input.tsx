import { cn } from '@/lib/cn';
import { TextInput, View, Text, type TextInputProps } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
}

export function Input({ label, error, containerClassName, style, ...props }: InputProps) {
  const colors = useThemeColors();
  return (
    <View className={cn('gap-1', containerClassName)}>
      {label ? (
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.placeholder}
        className="rounded-md px-4 py-3 text-base border min-h-[48px]"
        style={[
          {
            backgroundColor: colors.field,
            borderColor: error ? colors.danger : colors.border,
            color: colors.ink,
          },
          style,
        ]}
        {...props}
      />
      {error ? (
        <Text className="text-sm" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

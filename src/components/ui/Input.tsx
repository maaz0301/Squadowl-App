import { useState } from 'react';
import { TextInput, View, Text, Pressable, type TextInputProps } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerClassName?: string;
  isPassword?: boolean;
  rightAccessory?: React.ReactNode;
}

function EyeIcon({ visible, color }: { visible: boolean; color: string }) {
  if (visible) {
    return (
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle
          cx={12}
          cy={12}
          r={3}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function Input({
  label,
  error,
  containerClassName,
  style,
  isPassword = false,
  rightAccessory,
  secureTextEntry,
  ...props
}: InputProps) {
  const colors = useThemeColors();
  const [showPassword, setShowPassword] = useState(false);

  const isSecure = isPassword ? !showPassword : secureTextEntry;

  return (
    <View className={cn('gap-1', containerClassName)}>
      {label ? (
        <Text className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
          {label}
        </Text>
      ) : null}
      <View className="relative justify-center">
        <TextInput
          placeholderTextColor={colors.placeholder}
          className={cn('rounded-md px-4 py-3 text-base border min-h-[48px]', (isPassword || rightAccessory) && 'pr-12')}
          style={[
            {
              backgroundColor: colors.field,
              borderColor: error ? colors.danger : colors.border,
              color: colors.ink,
            },
            style,
          ]}
          secureTextEntry={isSecure}
          {...props}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setShowPassword((v) => !v)}
            className="absolute right-3 p-2 justify-center items-center"
            hitSlop={8}
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          >
            <EyeIcon visible={showPassword} color={colors.inkMuted} />
          </Pressable>
        ) : rightAccessory ? (
          <View className="absolute right-3 justify-center items-center">{rightAccessory}</View>
        ) : null}
      </View>
      {error ? (
        <Text className="text-sm" style={{ color: colors.danger }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

import { cn } from '@/lib/cn';
import { Pressable, Text } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  className?: string;
}

export function Chip({ label, active, onPress, className }: ChipProps) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      className={cn('px-3 py-2 rounded-full border mr-2 mb-2 min-h-[36px] justify-center', className)}
      style={{
        backgroundColor: active ? 'rgba(255,107,43,0.12)' : colors.tile,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: active ? colors.primary : colors.inkMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

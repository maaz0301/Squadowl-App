import { cn } from '@/lib/cn';
import { Pressable, Text } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

interface ChipProps {
  label: string;
  active?: boolean;
  highlight?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
}

export function Chip({ label, active, highlight, disabled, onPress, className }: ChipProps) {
  const colors = useThemeColors();
  
  let bgColor = colors.tile;
  let borderColor = colors.border;
  let textColor = colors.inkMuted;

  if (active) {
    bgColor = 'rgba(255,107,43,0.12)';
    borderColor = colors.primary;
    textColor = colors.primary;
  } else if (highlight) {
    bgColor = 'rgba(56,189,248,0.12)';
    borderColor = colors.info;
    textColor = colors.info;
  }

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      className={cn('px-3 py-2 rounded-full border mr-2 mb-2 min-h-[36px] justify-center', className)}
      style={{
        backgroundColor: bgColor,
        borderColor: borderColor,
        opacity: disabled ? 0.3 : 1,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: textColor }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

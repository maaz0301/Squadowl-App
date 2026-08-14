import { cn } from '@/lib/cn';
import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

type BadgeVariant = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info';
type BadgeSize = 'sm' | 'lg';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  className?: string;
}

const SIZE_STYLES: Record<BadgeSize, { pad: string; text: string }> = {
  sm: { pad: 'px-2 py-1', text: 'text-xs' },
  lg: { pad: 'px-4 py-2.5', text: 'text-base' },
};

export function Badge({ label, variant = 'default', size = 'sm', className }: BadgeProps) {
  const colors = useThemeColors();
  const styles: Record<BadgeVariant, { bg: string; text: string; border: string }> = {
    default: { bg: colors.tile, text: colors.inkMuted, border: colors.border },
    brand: { bg: 'rgba(255,107,43,0.12)', text: colors.primary, border: 'rgba(255,107,43,0.25)' },
    success: { bg: 'rgba(34,197,94,0.12)', text: colors.success, border: 'rgba(34,197,94,0.25)' },
    warning: { bg: 'rgba(251,146,60,0.12)', text: colors.warning, border: 'rgba(251,146,60,0.25)' },
    danger: { bg: 'rgba(248,113,113,0.12)', text: colors.danger, border: 'rgba(248,113,113,0.25)' },
    info: { bg: 'rgba(56,189,248,0.12)', text: colors.info, border: 'rgba(56,189,248,0.25)' },
  };
  const s = styles[variant];
  const sz = SIZE_STYLES[size];
  return (
    <View
      className={cn(sz.pad, 'rounded-full border self-start', className)}
      style={{ backgroundColor: s.bg, borderColor: s.border }}
    >
      <Text className={cn(sz.text, 'font-bold')} style={{ color: s.text }}>
        {label}
      </Text>
    </View>
  );
}

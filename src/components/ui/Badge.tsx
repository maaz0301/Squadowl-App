import { cn } from '@/lib/cn';
import { Text, View } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

type BadgeVariant = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ label, variant = 'default', className }: BadgeProps) {
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
  return (
    <View
      className={cn('px-2 py-1 rounded-full border self-start', className)}
      style={{ backgroundColor: s.bg, borderColor: s.border }}
    >
      <Text className="text-xs font-bold" style={{ color: s.text }}>
        {label}
      </Text>
    </View>
  );
}

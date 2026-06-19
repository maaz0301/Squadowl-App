import { cn } from '@/lib/cn';
import { ActivityIndicator, Pressable, Text, type PressableProps } from 'react-native';
import { useThemeColors } from '@/theme/ThemeProvider';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'nav';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends PressableProps {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
  textClassName?: string;
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-2 min-h-[36px]',
  md: 'px-4 py-3 min-h-[48px]',
  lg: 'px-5 py-4 min-h-[56px]',
};

export function Button({
  label,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  className,
  textClassName,
  ...props
}: ButtonProps) {
  const colors = useThemeColors();

  const variantClass: Record<ButtonVariant, string> = {
    primary: 'bg-brand',
    secondary: 'border',
    danger: 'bg-danger/20 border border-danger/30',
    ghost: 'bg-transparent',
    nav: 'bg-navy',
  };

  const textColor: Record<ButtonVariant, string> = {
    primary: 'text-white',
    secondary: '',
    danger: 'text-danger',
    ghost: '',
    nav: 'text-white',
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      className={cn(
        'rounded-md items-center justify-center flex-row active:opacity-80',
        sizeStyles[size],
        variantClass[variant],
        (disabled || loading) && 'opacity-50',
        className,
      )}
      style={
        variant === 'secondary'
          ? { borderColor: colors.border, backgroundColor: colors.tile }
          : variant === 'ghost'
            ? undefined
            : undefined
      }
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#fff' : colors.primary} />
      ) : (
        <Text
          className={cn('font-sans font-bold text-base', textColor[variant], textClassName)}
          style={
            variant === 'secondary' || variant === 'ghost'
              ? { color: colors.ink }
              : undefined
          }
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

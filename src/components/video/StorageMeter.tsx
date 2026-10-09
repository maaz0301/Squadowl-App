import { Pressable, Text, View } from 'react-native';
import { Card } from '@/components/ui';
import { useVideoStorageQuery } from '@/features/queries';
import {
  storageFraction,
  storageLevel,
  storageMeterLabel,
  type StorageLevel,
  type VideoStorageInfo,
} from '@/data/videoStorage';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Green while there is room, orange from 80% used, red when full. */
export const STORAGE_LEVEL_COLOR: Record<StorageLevel, string> = {
  ok: '#22c55e',
  warn: '#f97316',
  full: '#ef4444',
};

interface StorageMeterBarProps {
  info: Pick<VideoStorageInfo, 'usedBytes' | 'quotaBytes'>;
  onPress?: () => void;
  /** Smaller type and a thinner bar, for the dashboard. */
  compact?: boolean;
}

/** The bar and its "2.3 GB / 5 GB used" label. Tapping opens Account Settings -> Storage. */
export function StorageMeterBar({ info, onPress, compact }: StorageMeterBarProps) {
  const colors = useThemeColors();
  const level = storageLevel(info.usedBytes, info.quotaBytes);
  const color = STORAGE_LEVEL_COLOR[level];
  const fraction = storageFraction(info.usedBytes, info.quotaBytes);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Video storage, ${storageMeterLabel(info.usedBytes, info.quotaBytes)}`}
      className="gap-1.5"
    >
      <View className="flex-row items-center justify-between">
        <Text className={compact ? 'text-xs font-bold uppercase tracking-wider' : 'text-sm font-bold'} style={{ color: colors.inkMuted }}>
          Video storage
        </Text>
        <Text className={compact ? 'text-xs' : 'text-sm'} style={{ color: level === 'ok' ? colors.ink : color, fontWeight: '700' }}>
          {storageMeterLabel(info.usedBytes, info.quotaBytes)}
        </Text>
      </View>
      <View style={{ height: compact ? 6 : 10, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%`, height: '100%', backgroundColor: color }} />
      </View>
      {level === 'full' ? (
        <Text className="text-xs" style={{ color }}>
          Storage is full. Delete videos or choose a larger size to upload more.
        </Text>
      ) : level === 'warn' ? (
        <Text className="text-xs" style={{ color }}>
          Storage is almost full.
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The meter for the signed-in coach's own account, or nothing when the account
 * has no video storage (so the dashboard and Library stay clean for everyone
 * else). Pass `accountId` for another account the person works in.
 */
export function StorageMeter({ onPress, compact, accountId }: Omit<StorageMeterBarProps, 'info'> & { accountId?: string }) {
  const query = useVideoStorageQuery(accountId);
  const info = query.data;
  if (!info || !info.entitled || !info.canManage) return null;
  return <StorageMeterBar info={info} onPress={onPress} compact={compact} />;
}

/** The meter in a card with spacing below it, for the hub dashboard and the Library. Renders nothing when there is no storage. */
export function StorageMeterCard({ onPress, accountId }: { onPress?: () => void; accountId?: string }) {
  const query = useVideoStorageQuery(accountId);
  const info = query.data;
  if (!info || !info.entitled || !info.canManage) return null;
  return (
    <View className="mb-6">
      <Card>
        <StorageMeterBar info={info} onPress={onPress} />
      </Card>
    </View>
  );
}

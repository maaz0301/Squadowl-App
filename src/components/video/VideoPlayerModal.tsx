import { Text, View } from 'react-native';
import Video from 'react-native-video';
import { Modal } from '@/components/ui';
import { useThemeColors } from '@/theme/ThemeProvider';

interface VideoPlayerModalProps {
  /** Signed playback address, or null when closed. */
  url: string | null;
  title: string;
  onClose: () => void;
}

/**
 * Plays a stored video inside the app. There is deliberately no save or share
 * button: players and guardians can watch but not download unless the coach has
 * allowed it. (A screen recording can never be ruled out, this just does not
 * hand them the file.)
 */
export function VideoPlayerModal({ url, title, onClose }: VideoPlayerModalProps) {
  const colors = useThemeColors();
  return (
    <Modal visible={url !== null} title={title} onClose={onClose}>
      <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
        {url ? (
          <Video
            source={{ uri: url }}
            style={{ width: '100%', aspectRatio: 16 / 9 }}
            resizeMode="contain"
            controls
            paused={false}
            ignoreSilentSwitch="ignore"
            playInBackground={false}
          />
        ) : null}
      </View>
      <Text className="mt-2 text-xs" style={{ color: colors.inkMuted }}>
        Video plays in the app.
      </Text>
    </Modal>
  );
}

import { Dimensions, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom padding a bar pinned to the screen's bottom edge needs.
 *
 * `insets.bottom` is only right when the app window is drawn behind the system
 * navigation bar. Some Android devices report a bottom inset while the window
 * already stops above an opaque nav bar, and padding by that inset then leaves a
 * dead band under the bar's labels. When the window is shorter than the screen
 * by at least the reported inset, the nav bar is demonstrably outside the
 * window, so only a small fixed gap is used. Anywhere the window does reach the
 * bottom edge (edge-to-edge Android, iOS) the full inset still applies.
 */
export function useBottomInset(minimum = 12): number {
  const { bottom } = useSafeAreaInsets();
  if (Platform.OS !== 'android' || bottom <= 0) return Math.max(minimum, bottom);

  const screenH = Dimensions.get('screen').height;
  const windowH = Dimensions.get('window').height;
  const navBarOutsideWindow = screenH - windowH >= bottom - 4;
  return navBarOutsideWindow ? minimum : Math.max(minimum, bottom);
}

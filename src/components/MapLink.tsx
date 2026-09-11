import { Alert, Linking, Platform, Pressable, Text } from 'react-native';

import {
  appleDirectionsUrl,
  geoUri,
  googleMapsUrl,
  hasMappableLocation,
  looksAddressable,
} from '@/lib/mapLinks';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Open an event's location in whatever map app this device has.
 *
 * Platform-preferred rather than one universal URL like the web app's
 * MapLink: on a phone the native handler is already installed and already
 * signed in to the user's saved places, so iOS goes to Apple Maps and Android
 * to its default handler via `geo:`. Google's universal https URL is the
 * fallback in both cases — it opens the Google Maps app when installed and the
 * website when not, so this can never dead-end.
 *
 * Only the address is ever handed to a map provider — no event/venue name
 * folded into the query.
 */
export async function openInMaps(location: string): Promise<void> {
  const candidates =
    Platform.OS === 'ios'
      ? [appleDirectionsUrl(location), googleMapsUrl(location)]
      : Platform.OS === 'android'
        ? [geoUri(location), googleMapsUrl(location)]
        : [googleMapsUrl(location)];

  for (const url of candidates) {
    // canOpenURL is the check that makes the fallback meaningful: a geo: URI on
    // a device with no map app resolves to nothing at all, and openURL would
    // reject rather than fall through.
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Treat an unanswerable canOpenURL the same as a "no" and try the next.
    }
  }
  throw new Error('No map app available to open this location.');
}

/**
 * "Directions" for an event's location.
 *
 * Renders nothing when there is no usable location — including the "TBD" a
 * coach types before the venue is settled, which would otherwise send someone
 * confidently to whatever a map search makes of it.
 */
export function MapLink({
  location,
  label,
  size = 'md',
  variant = 'chip',
}: {
  location?: string | null;
  /** Venue or event name, used to name the pin. */
  label?: string;
  size?: 'sm' | 'md';
  /**
   * `chip` is the standalone button used beside "Add to calendar"; `inline`
   * turns the location text itself into the tappable target, for rows too
   * tight for another button.
   */
  variant?: 'chip' | 'inline';
}) {
  const colors = useThemeColors();
  if (!hasMappableLocation(location)) return null;

  // `label` (the event/venue name) never reaches the map provider — only the
  // address does. It is used below purely for the accessibility label, which
  // is read out but never sent anywhere.
  const place = location.trim();
  const a11yLabel = label ? `Directions to ${label}` : `Directions to ${place}`;
  const open = () => {
    openInMaps(place).catch((e: unknown) =>
      Alert.alert(
        'Could not open maps',
        e instanceof Error ? e.message : 'Please try again from your map app.',
      ),
    );
  };

  if (variant === 'inline') {
    return (
      <Text
        onPress={open}
        accessibilityRole="link"
        accessibilityLabel={a11yLabel}
        style={{ color: colors.primary, textDecorationLine: 'underline' }}
      >
        📍 {place}
      </Text>
    );
  }

  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={a11yLabel}
      className={`rounded-lg border ${size === 'sm' ? 'px-2.5 py-1.5' : 'px-3.5 py-2.5'}`}
      style={{ backgroundColor: colors.tile, borderColor: colors.border }}
    >
      <Text
        className={`font-bold ${size === 'sm' ? 'text-xs' : 'text-sm'}`}
        style={{ color: colors.ink }}
      >
        📍 Directions
      </Text>
    </Pressable>
  );
}

/**
 * The hint shown under a location field while an event is being created.
 *
 * A venue typed as "Rink A" is perfectly clear to the club and useless to a
 * map, and the moment to find that out is while the coach is still on the form
 * — not after the invite has gone out. It never blocks the save: a well-known
 * venue name maps fine and has none of the markers `looksAddressable` looks for.
 */
export function MapLocationHint({ location }: { location?: string | null }) {
  const colors = useThemeColors();
  const trimmed = location?.trim();
  if (!trimmed || !hasMappableLocation(trimmed)) return null;

  const vague = !looksAddressable(trimmed);

  return (
    <Text className="mt-1 text-xs" style={{ color: vague ? colors.warning : colors.inkMuted }}>
      {vague
        ? 'Add a street address so players can get directions. '
        : 'Players will get a directions link to this location. '}
      <Text
        className="font-bold underline"
        style={{ color: colors.primary }}
        onPress={() => {
          Linking.openURL(googleMapsUrl(trimmed)).catch(() => {
            Alert.alert('Could not open maps', 'Please try again from your map app.');
          });
        }}
      >
        Preview on map
      </Text>
    </Text>
  );
}

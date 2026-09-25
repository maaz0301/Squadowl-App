import { useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { Modal } from '@/components/ui';
import {
  appleDirectionsUrl,
  googleMapsUrl,
  hasMappableLocation,
  looksAddressable,
  wazeUrl,
} from '@/lib/mapLinks';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * "Directions" for an event's location — a picker over Apple Maps, Google
 * Maps and Waze, the three apps players and parents actually have installed.
 * An explicit choice rather than one auto-selected link (as this used to be,
 * silently preferring Apple on iOS and a `geo:` default elsewhere) because
 * there is no way to guess which of the three someone prefers, and a Waze
 * regular bounces off a button that always lands them in Apple/Google
 * instead. Mirrors AddToCalendar's own picker for the same reason it does:
 * one tap opens a small list of options rather than a menu of map brands.
 *
 * Only the address is ever handed to a map provider — no event/venue name
 * folded into the query.
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
  renderTrigger,
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
  /** Draws the button that opens the picker, for screens with their own styling. */
  renderTrigger?: (open: () => void) => React.ReactNode;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  if (!hasMappableLocation(location)) return null;

  // `label` (the event/venue name) never reaches the map provider — only the
  // address does. It is used below purely for the accessibility label, which
  // is read out but never sent anywhere.
  const place = location.trim();
  const a11yLabel = label ? `Directions to ${label}` : `Directions to ${place}`;

  const options = [
    { key: 'apple', label: 'Apple Maps', url: appleDirectionsUrl(place) },
    { key: 'google', label: 'Google Maps', url: googleMapsUrl(place) },
    { key: 'waze', label: 'Waze', url: wazeUrl(place) },
  ];

  const choose = async (url: string) => {
    setOpen(false);
    try {
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert(
        'Could not open maps',
        e instanceof Error ? e.message : 'Please try again from your map app.',
      );
    }
  };

  const picker = (
    <Modal visible={open} title="Get directions" onClose={() => setOpen(false)}>
      <View className="gap-2">
        {options.map((o) => (
          <Pressable
            key={o.key}
            onPress={() => choose(o.url)}
            className="rounded-xl border px-4 py-3"
            style={{ backgroundColor: colors.tile, borderColor: colors.border }}
          >
            <Text className="text-base font-bold" style={{ color: colors.ink }}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </Modal>
  );

  if (renderTrigger) {
    return (
      <>
        {renderTrigger(() => setOpen(true))}
        {picker}
      </>
    );
  }

  if (variant === 'inline') {
    return (
      <>
        <Text
          onPress={() => setOpen(true)}
          accessibilityRole="link"
          accessibilityLabel={a11yLabel}
          style={{ color: colors.primary, textDecorationLine: 'underline' }}
        >
          📍 {place}
        </Text>
        {picker}
      </>
    );
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="link"
        accessibilityLabel={a11yLabel}
        // min-h/justify-center at sm matches Button's own sm sizing (see
        // Button.tsx's sizeStyles) — without it, the 📍 emoji's taller line
        // height (a platform quirk, worst on Android) makes this chip render
        // visibly taller than a plain-text Button sitting right next to it.
        className={`rounded-lg border justify-center ${size === 'sm' ? 'px-2.5 py-1.5 min-h-[36px]' : 'px-3.5 py-2.5'}`}
        style={{ backgroundColor: colors.tile, borderColor: colors.border }}
      >
        <Text
          className={`font-bold ${size === 'sm' ? 'text-xs' : 'text-sm'}`}
          style={{ color: colors.ink }}
        >
          📍 Directions
        </Text>
      </Pressable>
      {picker}
    </>
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

import { useState } from 'react';
import { PanResponder, Pressable, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useThemeColors } from '@/theme/ThemeProvider';
import { hexToHsv, hsvToHex, readableInkOn } from '@/lib/teamBrand';

/**
 * Brand colours offered when personalizing a team. A fixed swatch set rather
 * than a free colour wheel: every one of these has been picked to stay legible
 * under the banner's black/white ink rule, and they cover the jersey colours
 * clubs actually use. `null` means "no brand colour" — the banner falls back to
 * the app theme. Clubs whose jersey isn't one of these get the full wheel via
 * the "Custom" tile below.
 */
export const TEAM_BRAND_COLORS = [
  '#ff6b2b', // brand orange
  '#e11d48', // red
  '#b91c1c', // maroon
  '#ea580c', // burnt orange
  '#f59e0b', // gold
  '#facc15', // yellow
  '#16a34a', // green
  '#047857', // forest
  '#0891b2', // teal
  '#0ea5e9', // sky
  '#2563eb', // royal blue
  '#1e3a8a', // navy
  '#6366f1', // indigo
  '#7c3aed', // purple
  '#db2777', // pink
  '#334155', // slate
] as const;

const HEX_RE = /^[0-9a-fA-F]{6}$/;

interface TeamColorPickerProps {
  value?: string | null;
  onChange: (color: string | null) => void;
  label?: string;
  className?: string;
}

/**
 * Sized in explicit style numbers rather than Tailwind width/height classes:
 * inside a wrapping flex row these swatches were collapsing to slivers, since
 * the class-driven width lost to the row's own sizing pass.
 */
const SWATCH = 46;
const SQUARE_SIZE = 200;
const HUE_HEIGHT = 28;
const THUMB = 26;

const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360].map((deg) => ({
  offset: deg / 360,
  color: hsvToHex(deg, 1, 1),
}));

export function TeamColorPicker({ value, onChange, label = 'Team colour', className }: TeamColorPickerProps) {
  const colors = useThemeColors();

  const isCustomActive = !!value && !(TEAM_BRAND_COLORS as readonly string[]).includes(value);
  const [expanded, setExpanded] = useState(isCustomActive);
  const [hexDraft, setHexDraft] = useState(value ? value.replace('#', '') : '');

  const seedHex = value && HEX_RE.test(value.replace('#', '')) ? value : '#ff6b2b';
  const [h, s, v] = hexToHsv(seedHex);
  const [panelWidth, setPanelWidth] = useState(280);

  const updateFromSV = (x: number, y: number) => {
    const ns = Math.max(0, Math.min(1, x / panelWidth));
    const nv = 1 - Math.max(0, Math.min(1, y / SQUARE_SIZE));
    const next = hsvToHex(h, ns, nv);
    onChange(next);
    setHexDraft(next.replace('#', ''));
  };

  const updateFromHue = (x: number) => {
    const nh = Math.max(0, Math.min(1, x / panelWidth)) * 360;
    const next = hsvToHex(nh, s, v);
    onChange(next);
    setHexDraft(next.replace('#', ''));
  };

  // Plain PanResponder rather than react-native-gesture-handler: this picker can be
  // embedded inside a core RN <Modal> (the team edit sheet), whose content mounts in
  // its own native root outside the app's single GestureHandlerRootView — a
  // GestureDetector there never activates and leaves the responder chain stuck,
  // freezing all touches. PanResponder is part of RN's own responder system and
  // works regardless of which native root it's mounted under.
  const svPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => updateFromSV(e.nativeEvent.locationX, e.nativeEvent.locationY),
    onPanResponderMove: (e) => updateFromSV(e.nativeEvent.locationX, e.nativeEvent.locationY),
  });

  const huePanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => updateFromHue(e.nativeEvent.locationX),
    onPanResponderMove: (e) => updateFromHue(e.nativeEvent.locationX),
  });

  const handleHexChange = (text: string) => {
    const clean = text.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    setHexDraft(clean);
    if (HEX_RE.test(clean)) onChange(`#${clean.toLowerCase()}`);
  };

  const swatch = (color: string | null) => {
    const selected = (value ?? null) === color;
    const check = color ? readableInkOn(color) : colors.ink;
    return (
      <Pressable
        key={color ?? 'none'}
        onPress={() => {
          onChange(color);
          setExpanded(false);
        }}
        accessibilityRole="button"
        accessibilityLabel={color ? `Team colour ${color}` : 'No team colour'}
        accessibilityState={{ selected }}
        hitSlop={4}
        style={{
          width: SWATCH,
          height: SWATCH,
          borderRadius: SWATCH / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color ?? colors.tile,
          borderWidth: selected ? 3 : 1,
          borderColor: selected ? colors.primary : colors.border,
        }}
      >
        {color === null ? (
          <Text className="text-[11px] font-bold" style={{ color: colors.inkMuted }}>
            None
          </Text>
        ) : selected ? (
          <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
            <Path
              d="M20 6L9 17l-5-5"
              stroke={check}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        ) : null}
      </Pressable>
    );
  };

  const customTile = () => (
    <Pressable
      key="custom"
      onPress={() => setExpanded((prev) => !prev)}
      accessibilityRole="button"
      accessibilityLabel="Custom team colour"
      accessibilityState={{ selected: isCustomActive, expanded }}
      hitSlop={4}
      style={{
        width: SWATCH,
        height: SWATCH,
        borderRadius: SWATCH / 2,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: isCustomActive ? value! : colors.tile,
        borderWidth: isCustomActive || expanded ? 3 : 1,
        borderColor: isCustomActive || expanded ? colors.primary : colors.border,
      }}
    >
      {isCustomActive ? (
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <Path
            d="M20 6L9 17l-5-5"
            stroke={readableInkOn(value!)}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : (
        <Svg width={SWATCH} height={SWATCH} viewBox={`0 0 ${SWATCH} ${SWATCH}`}>
          <Defs>
            <LinearGradient id="teamColorPickerCustomIcon" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#ff3b30" />
              <Stop offset="0.5" stopColor="#34c759" />
              <Stop offset="1" stopColor="#0a84ff" />
            </LinearGradient>
          </Defs>
          <Circle cx={SWATCH / 2} cy={SWATCH / 2} r={SWATCH / 2 - 3} fill="url(#teamColorPickerCustomIcon)" opacity={0.85} />
        </Svg>
      )}
    </Pressable>
  );

  const svThumbX = s * panelWidth;
  const svThumbY = (1 - v) * SQUARE_SIZE;
  const hueThumbX = (h / 360) * panelWidth;

  return (
    <View className={className}>
      <Text className="text-sm font-bold mb-2" style={{ color: colors.ink }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {swatch(null)}
        {TEAM_BRAND_COLORS.map((c) => swatch(c))}
        {customTile()}
      </View>

      {expanded ? (
        <View style={{ marginTop: 4 }} onLayout={(e) => setPanelWidth(e.nativeEvent.layout.width)}>
          <View
            {...svPanResponder.panHandlers}
            style={{ width: '100%', height: SQUARE_SIZE, borderRadius: 12, overflow: 'hidden' }}
          >
              <Svg width={panelWidth} height={SQUARE_SIZE}>
                <Defs>
                  <LinearGradient id="teamColorPickerSat" x1="0" y1="0" x2="1" y2="0">
                    <Stop offset="0" stopColor="#ffffff" />
                    <Stop offset="1" stopColor={hsvToHex(h, 1, 1)} />
                  </LinearGradient>
                  <LinearGradient id="teamColorPickerVal" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor="#000000" stopOpacity={0} />
                    <Stop offset="1" stopColor="#000000" stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={panelWidth} height={SQUARE_SIZE} fill="url(#teamColorPickerSat)" />
                <Rect x={0} y={0} width={panelWidth} height={SQUARE_SIZE} fill="url(#teamColorPickerVal)" />
              </Svg>
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: svThumbX - THUMB / 2,
                  top: svThumbY - THUMB / 2,
                  width: THUMB,
                  height: THUMB,
                  borderRadius: THUMB / 2,
                  borderWidth: 3,
                  borderColor: '#ffffff',
                  backgroundColor: seedHex,
                  shadowColor: '#000',
                  shadowOpacity: 0.4,
                  shadowRadius: 3,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 3,
                }}
              />
          </View>

          <View
            {...huePanResponder.panHandlers}
            style={{ width: '100%', height: HUE_HEIGHT, borderRadius: HUE_HEIGHT / 2, overflow: 'hidden', marginTop: 14 }}
          >
              <Svg width={panelWidth} height={HUE_HEIGHT}>
                <Defs>
                  <LinearGradient id="teamColorPickerHue" x1="0" y1="0" x2="1" y2="0">
                    {HUE_STOPS.map((stop) => (
                      <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
                    ))}
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={panelWidth} height={HUE_HEIGHT} fill="url(#teamColorPickerHue)" />
              </Svg>
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: hueThumbX - HUE_HEIGHT / 2,
                  top: 0,
                  width: HUE_HEIGHT,
                  height: HUE_HEIGHT,
                  borderRadius: HUE_HEIGHT / 2,
                  borderWidth: 3,
                  borderColor: '#ffffff',
                  backgroundColor: hsvToHex(h, 1, 1),
                  shadowColor: '#000',
                  shadowOpacity: 0.4,
                  shadowRadius: 3,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 3,
                }}
              />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                backgroundColor: seedHex,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingHorizontal: 12,
                height: 40,
                backgroundColor: colors.tile,
              }}
            >
              <Text style={{ color: colors.inkMuted, fontWeight: '700' }}>#</Text>
              <TextInput
                value={hexDraft}
                onChangeText={handleHexChange}
                placeholder="ff6b2b"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={6}
                style={{ flex: 1, marginLeft: 4, color: colors.ink, fontSize: 15, fontWeight: '600' }}
              />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

/**
 * Compact brand banner for the home screen. Deliberately short — a returning
 * user is here for the sections below it, so it stays a strip rather than a
 * full-screen splash. Always dark: the text is white in both themes.
 */
export function HomeHero() {
  return (
    <View className="rounded-xl overflow-hidden" style={{ minHeight: 132 }}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="homeHeroBg" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor="#0c1528" />
            <Stop offset="0.65" stopColor="#111f3a" />
            <Stop offset="1" stopColor="#1a2440" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#homeHeroBg)" />
      </Svg>
      {/* Angled brand streak along the right edge. */}
      <Svg
        width={120}
        height="100%"
        viewBox="0 0 120 100"
        preserveAspectRatio="none"
        style={{ position: 'absolute', right: 0, top: 0, bottom: 0 }}
      >
        <Path d="M120 0 L120 100 L60 100 Z" fill="#ff6b2b" fillOpacity={0.9} />
        <Path d="M120 0 L120 100 L88 100 Z" fill="#ff6b2b" />
      </Svg>

      <View className="p-4 justify-center" style={{ minHeight: 132, paddingRight: 96 }}>
        <View className="flex-row items-center gap-2 mb-2">
          <View style={{ width: 16, height: 2, backgroundColor: '#ff6b2b' }} />
          <Text className="text-xs font-bold uppercase tracking-widest" style={{ color: '#ff9a5c' }}>
            Organize · Evaluate · Compare
          </Text>
        </View>
        <Text className="text-xl font-display font-bold" style={{ color: '#ffffff' }}>
          Better Evaluations.
        </Text>
        <Text className="text-xl font-display font-bold" style={{ color: '#ff6b2b' }}>
          Stronger Teams.
        </Text>
        <Text className="text-xs mt-2" style={{ color: 'rgba(232,238,255,0.72)', lineHeight: 15 }}>
          Simplify your tryouts with powerful tools, real-time results and professional reports.
        </Text>
      </View>
    </View>
  );
}

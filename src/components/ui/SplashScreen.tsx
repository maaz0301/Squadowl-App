import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { LegalLinks } from '@/components/LegalLinks';
import { brand } from '@/theme/tokens';

/**
 * A white backdrop behind the light SquadOwl logo, so the tagline reads clearly
 * in light and dark mode alike. The logo is spun in code rather than played
 * from a video: there is no decoder to fail (the old clip could show a black
 * screen on some phones) and it always uses the light artwork.
 */
const SPLASH_BACKDROP = '#ffffff';

/** Full turns the emblem makes before it settles facing front. */
const TURNS = 2;
const SPIN_MS = 3000;

/**
 * Only the round owl emblem turns, as a solid coin: dark copies stacked behind
 * the face give it a rim, and each shifts sideways by its depth times
 * sin(angle) as it turns, like a real extruded disc. The wordmark and tagline
 * stay still underneath so they are always readable.
 */
const COIN = 190;
const EDGE_LAYERS = 12;
const THICKNESS = 22;
const EDGE_COLOR = '#0a2f73';

/** Longest the Enter button may stay hidden if the animation never reports it finished. */
const MAX_UNTIL_ENTER_MS = SPIN_MS + 1500;

type SplashScreenProps = {
  /** Called once when the user taps Enter. */
  onFinish?: () => void;
};

export function SplashScreen({ onFinish }: SplashScreenProps) {
  const [canEnter, setCanEnter] = useState(false);
  const hasFinished = useRef(false);
  const progress = useRef(new Animated.Value(0)).current;

  // A double tap on Enter must not fire onFinish twice.
  const finish = useCallback(() => {
    if (hasFinished.current) return;
    hasFinished.current = true;
    onFinish?.();
  }, [onFinish]);

  useEffect(() => {
    const spin = Animated.timing(progress, {
      toValue: 1,
      duration: SPIN_MS,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    });
    spin.start(({ finished }) => {
      if (finished) setCanEnter(true);
    });
    const timer = setTimeout(() => setCanEnter(true), MAX_UNTIL_ENTER_MS);
    return () => {
      spin.stop();
      clearTimeout(timer);
    };
  }, [progress]);

  // The turn is drawn by squashing the width to cos(angle), which flips the
  // face over without the 3D compositor, and shifting the rim by sin(angle).
  const steps = 120 * TURNS;
  const inputRange = Array.from({ length: steps + 1 }, (_, i) => i / steps);
  const angle = (t: number) => t * Math.PI * 2 * TURNS;
  const sinAngle = progress.interpolate({ inputRange, outputRange: inputRange.map((t) => Math.sin(angle(t))) });
  const cosAngle = progress.interpolate({ inputRange, outputRange: inputRange.map((t) => Math.cos(angle(t))) });
  // The rim never squashes fully flat, so edge-on it still reads as a solid strip.
  const rimCos = progress.interpolate({
    inputRange,
    outputRange: inputRange.map((t) => {
      const c = Math.cos(angle(t));
      return (c < 0 ? -1 : 1) * Math.max(Math.abs(c), 0.06);
    }),
  });
  const mark = require('../../../assets/SquadOwl-mark.png');

  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <StatusBar hidden />
      <View style={styles.coin}>
        {Array.from({ length: EDGE_LAYERS }, (_, i) => {
          const depth = ((i + 1) / EDGE_LAYERS) * THICKNESS;
          return (
            <Animated.View
              key={i}
              pointerEvents="none"
              style={[
                styles.layer,
                {
                  transform: [{ translateX: Animated.multiply(sinAngle, -depth) }, { scaleX: rimCos }],
                },
              ]}
            >
              <Image source={mark} style={[styles.fill, { tintColor: EDGE_COLOR }]} resizeMode="contain" />
            </Animated.View>
          );
        })}
        <Animated.View style={[styles.layer, { transform: [{ scaleX: cosAngle }] }]}>
          <Image source={mark} style={styles.fill} resizeMode="contain" accessibilityLabel="SquadOwl" />
        </Animated.View>
      </View>
      <Image source={require('../../../assets/SquadOwl-wordmark-onLight.png')} style={styles.wordmark} resizeMode="contain" />
      <Text style={[styles.tag, { color: '#0745A4' }]}>
        Smarter Assessments. Scheduling. Team Sorting.{'\n'}Clearer communication.
      </Text>
      <Text style={[styles.tag, { color: '#F45C10' }]}>Your All In One Team{'\n'}Management App</Text>
      {canEnter ? (
        <View style={styles.enterWrap} pointerEvents="box-none">
          <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel="Enter" style={styles.enter}>
            <Text style={styles.enterLabel}>Enter</Text>
          </Pressable>
        </View>
      ) : null}
      {/* Always visible, so the policies can be read before anyone signs in. */}
      <View style={styles.legal} pointerEvents="box-none">
        <LegalLinks prefix />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: SPLASH_BACKDROP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 120,
    alignItems: 'center',
  },
  enter: {
    minWidth: 180,
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 999,
    backgroundColor: brand.DEFAULT,
  },
  legal: { position: 'absolute', left: 16, right: 16, bottom: 44 },
  enterLabel: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  coin: { width: COIN, height: COIN, marginBottom: 18 },
  layer: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  fill: { width: '100%', height: '100%' },
  wordmark: { width: 250, height: 52, marginBottom: 14 },
  tag: { fontSize: 15, lineHeight: 20, fontWeight: '700', textAlign: 'center', marginTop: 4 },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import Video from 'react-native-video';
import { brand } from '@/theme/tokens';

/**
 * A white backdrop the brand animation sits on (the SquadOwl logo art is on
 * white), so it reads as one deliberate brand screen rather than a boxed-in video.
 * It also covers the gap between the native splash hiding and the first
 * video frame being decoded.
 */
const SPLASH_BACKDROP = '#ffffff';

/**
 * The clip is ~2.3s at full speed, which flew past before the tagline could be
 * read. Played at this rate it runs ~4s. Lower = slower.
 */
const PLAYBACK_RATE = 0.55;

/**
 * Longest the Enter button may stay hidden. The splash now waits for a tap, so
 * a decode stall or a device that never fires `onEnd` only needs to bring the
 * button up eventually, not push the user into the app.
 */
const MAX_UNTIL_ENTER_MS = 8000;

/** Same safety net when the video can't play and the static logo shows instead. */
const FALLBACK_UNTIL_ENTER_MS = 800;

type SplashScreenProps = {
  /** Called once when the user taps Enter. */
  onFinish?: () => void;
};

export function SplashScreen({ onFinish }: SplashScreenProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [canEnter, setCanEnter] = useState(false);
  const hasFinished = useRef(false);

  // A double tap on Enter must not fire onFinish twice.
  const finish = useCallback(() => {
    if (hasFinished.current) return;
    hasFinished.current = true;
    onFinish?.();
  }, [onFinish]);

  useEffect(() => {
    const timer = setTimeout(() => setCanEnter(true), MAX_UNTIL_ENTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!videoFailed) return;
    const timer = setTimeout(() => setCanEnter(true), FALLBACK_UNTIL_ENTER_MS);
    return () => clearTimeout(timer);
  }, [videoFailed]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <StatusBar hidden />
      {videoFailed ? (
        <Image
          source={require('../../../assets/SquadOwl-full-logo-light.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      ) : (
        <Video
          source={require('../../../assets/video/animation.mp4')}
          style={StyleSheet.absoluteFill}
          // The clip is 9:16, i.e. already phone-shaped — `cover` fills the
          // screen edge to edge and only trims the overscan on tablets.
          resizeMode="cover"
          muted
          controls={false}
          repeat={false}
          rate={PLAYBACK_RATE}
          playInBackground={false}
          // Don't take audio focus / duck other apps' audio for a muted clip.
          disableFocus
          ignoreSilentSwitch="ignore"
          onEnd={() => setCanEnter(true)}
          onError={() => setVideoFailed(true)}
        />
      )}
      {canEnter ? (
        <View style={styles.enterWrap} pointerEvents="box-none">
          <Pressable onPress={finish} accessibilityRole="button" accessibilityLabel="Enter" style={styles.enter}>
            <Text style={styles.enterLabel}>Enter</Text>
          </Pressable>
        </View>
      ) : null}
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
    bottom: 72,
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
  enterLabel: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  logo: {
    width: '70%',
    height: '40%',
  },
});

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, StatusBar, StyleSheet, View } from 'react-native';
import Video from 'react-native-video';

/**
 * A near-black backdrop the brand animation sits on, so it reads as one
 * deliberate brand screen rather than a boxed-in video on a white flash.
 * It also covers the gap between the native splash hiding and the first
 * video frame being decoded.
 */
const SPLASH_BACKDROP = '#080c16';

/**
 * Hard ceiling on how long the splash may hold the app back. The animation is
 * ~2.3s, but a decode stall or a device that never fires `onEnd` must not leave
 * the user staring at the splash forever.
 */
const MAX_SPLASH_MS = 5000;

/**
 * How long the static-logo fallback sits on screen when the video can't play
 * at all — long enough to read as brand, short enough not to feel broken.
 */
const FALLBACK_SPLASH_MS = 1200;

type SplashScreenProps = {
  /** Called once when the animation finishes (or is given up on). */
  onFinish?: () => void;
};

export function SplashScreen({ onFinish }: SplashScreenProps) {
  const [videoFailed, setVideoFailed] = useState(false);
  const hasFinished = useRef(false);

  // `onEnd`, the fallback timer and the safety timer can all race; whichever
  // lands first wins and the rest become no-ops.
  const finish = useCallback(() => {
    if (hasFinished.current) return;
    hasFinished.current = true;
    onFinish?.();
  }, [onFinish]);

  useEffect(() => {
    const timer = setTimeout(finish, MAX_SPLASH_MS);
    return () => clearTimeout(timer);
  }, [finish]);

  useEffect(() => {
    if (!videoFailed) return;
    const timer = setTimeout(finish, FALLBACK_SPLASH_MS);
    return () => clearTimeout(timer);
  }, [videoFailed, finish]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <StatusBar hidden />
      {videoFailed ? (
        <Image
          source={require('../../../assets/TryoutHQ--full-logo.png')}
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
          playInBackground={false}
          // Don't take audio focus / duck other apps' audio for a muted clip.
          disableFocus
          ignoreSilentSwitch="ignore"
          onEnd={finish}
          onError={() => setVideoFailed(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: SPLASH_BACKDROP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: '70%',
    height: '40%',
  },
});

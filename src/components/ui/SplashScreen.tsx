import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, Text, View } from 'react-native';

import { useThemeColors } from '@/theme/ThemeProvider';
import { APP_CONFIG } from '@/config/app';

/**
 * The clip runs ~4s. This is the hard ceiling that releases the app if it
 * stalls, fails to decode, or never reports onEnd — it must stay comfortably
 * above the real duration or it would cut the video off partway.
 */
const MAX_SPLASH_MS = 6500;

/**
 * The video is 1280x674 — landscape, on a portrait screen. It sits on its own
 * near-black backdrop, so the letterbox is painted the same near-black and the
 * whole thing reads as one screen rather than a boxed-in clip.
 */
const SPLASH_BACKDROP = '#080c16';

/**
 * Resolved lazily and defensively. react-native-video is a native module, so on
 * a binary built before it was added the component doesn't exist — and since the
 * splash is the first thing rendered, a throw here would take the app down on
 * launch with no way back. Missing module means we quietly show the text splash.
 */
let Video: any = null;
try {
  Video = require('react-native-video').default;
} catch {
  Video = null;
}

class VideoErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

interface SplashScreenProps {
  /** Fires once, when the video ends, errors, or the ceiling above is hit. */
  onFinish?: () => void;
}

export function SplashScreen({ onFinish }: SplashScreenProps) {
  const colors = useThemeColors();
  const [videoFailed, setVideoFailed] = useState(false);
  const finished = useRef(false);
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    onFinishRef.current?.();
  };

  const failVideo = () => {
    setVideoFailed(true);
    finish();
  };

  const showVideo = !!Video && !videoFailed;

  useEffect(() => {
    // Nothing to play — don't make the user sit through the ceiling.
    if (!showVideo) {
      finish();
      return;
    }
    const timer = setTimeout(finish, MAX_SPLASH_MS);
    return () => clearTimeout(timer);
  }, [showVideo]);

  if (!showVideo) {
    return (
      <View
        className="flex-1 items-center justify-center gap-6"
        style={{ backgroundColor: colors.bg }}
      >
        <Text className="text-4xl font-display font-bold" style={{ color: colors.primary }}>
          {APP_CONFIG.appName}
        </Text>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: SPLASH_BACKDROP }]}>
      <StatusBar hidden />
      <VideoErrorBoundary onError={failVideo}>
        <Video
          source={require('../../../assets/video/splash.mp4')}
          style={StyleSheet.absoluteFill}
          // 'contain' keeps the logo's real proportions. 'cover' would fill the
          // portrait screen by cropping away most of a 1.9:1 frame's width.
          resizeMode="contain"
          muted
          repeat={false}
          controls={false}
          playInBackground={false}
          ignoreSilentSwitch="obey"
          onEnd={finish}
          onError={failVideo}
        />
      </VideoErrorBoundary>
    </View>
  );
}

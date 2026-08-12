import { Image, StatusBar, StyleSheet, View } from 'react-native';

/**
 * A near-black backdrop the full-logo mark sits on, so it reads as one
 * deliberate brand screen rather than a boxed-in image on a white flash.
 */
const SPLASH_BACKDROP = '#080c16';

export function SplashScreen() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <StatusBar hidden />
      <Image
        source={require('../../../assets/TryoutHQ--full-logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
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

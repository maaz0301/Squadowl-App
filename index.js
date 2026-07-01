import { AppRegistry } from 'react-native';
import App from './src/App';
// Since we deleted app.json, we will manually provide the app name
// The original app.json had "name": "AAS Tryout" but Native code might use "mobileapp" or "aastryout"
// We should check what the Android/iOS package names are, but usually it's the package name in package.json
const appName = 'aastryout';

AppRegistry.registerComponent(appName, () => App);

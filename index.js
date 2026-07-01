import { AppRegistry } from 'react-native';
import App from './src/App';
// Since we deleted app.json, we will manually provide the app name
// The native iOS and Android projects were initialized with "temp_app"
const appName = 'temp_app';

AppRegistry.registerComponent(appName, () => App);

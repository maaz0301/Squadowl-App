const fs = require('fs');
const path = require('path');

const srcLogo = path.join(__dirname, '../assets/images/TryoutHQ T- logo.png');
const rootDir = path.join(__dirname, '..');

const targets = [
  'assets/images/icon.png',
  'assets/images/splash-icon.png',
  'android/app/src/main/res/mipmap-mdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png',
  'android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png',
  'android/app/src/main/res/mipmap-xhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
  'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png',
];

for (const targetRel of targets) {
  const targetPath = path.join(rootDir, targetRel);
  if (fs.existsSync(path.dirname(targetPath))) {
    fs.copyFileSync(srcLogo, targetPath);
    console.log('Updated icon:', targetRel);
  }
}

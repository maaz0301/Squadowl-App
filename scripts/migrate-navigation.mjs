import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

walkDir('./src/screens', function(filePath) {
  if (filePath.endsWith('.tsx') || filePath.endsWith('.ts')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;

    // Replace useRouter
    content = content.replace(/import\s+\{([^}]*)useRouter([^}]*)\}\s+from\s+['"]expo-router['"];?/, (match, p1, p2) => {
      let rest = (p1 + p2).replace(/,\s*,/g, ',').trim().replace(/(^,)|(,$)/g, '');
      let navImport = `import { useNavigation } from '@react-navigation/native';\n`;
      if (rest) navImport += `import { ${rest} } from 'expo-router';`; // temporary
      return navImport;
    });
    content = content.replace(/const\s+router\s*=\s*useRouter\(\);?/g, 'const navigation = useNavigation<any>();');
    content = content.replace(/router\.push\(([^)]+)\)/g, 'navigation.navigate($1)');
    content = content.replace(/router\.replace\(([^)]+)\)/g, 'navigation.replace($1)');
    content = content.replace(/router\.back\(\)/g, 'navigation.goBack()');

    // Replace useLocalSearchParams
    content = content.replace(/import\s+\{([^}]*)useLocalSearchParams([^}]*)\}\s+from\s+['"]expo-router['"];?/, (match, p1, p2) => {
      let rest = (p1 + p2).replace(/,\s*,/g, ',').trim().replace(/(^,)|(,$)/g, '');
      let routeImport = `import { useRoute } from '@react-navigation/native';\n`;
      if (rest) routeImport += `import { ${rest} } from 'expo-router';`;
      return routeImport;
    });
    content = content.replace(/const\s+(\{[^}]+\})\s*=\s*useLocalSearchParams(<[^>]+>)?\(\);?/g, 'const route = useRoute<any>();\n  const $1 = route.params || {};');
    content = content.replace(/const\s+([a-zA-Z0-9_]+)\s*=\s*useLocalSearchParams(<[^>]+>)?\(\);?/g, 'const route = useRoute<any>();\n  const $1 = route.params || {};');

    // Remove empty expo-router imports left over
    content = content.replace(/import\s+\{\s*\}\s+from\s+['"]expo-router['"];?\n?/g, '');

    // Link replacement (basic)
    // <Link href="/some"> -> <TouchableOpacity onPress={() => navigation.navigate('some')}>
    // This is too complex for simple regex, we will log files that still have Link

    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated: ', filePath);
    }
  }
});

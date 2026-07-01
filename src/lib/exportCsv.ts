// using inline require for expo-file-system
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { Tryout } from '@/data/types';
import { formatExportCsv } from '@/data/teamBuilder';

export async function exportTryoutToCsv(tryout: Tryout): Promise<void> {
  const csvString = formatExportCsv(tryout);
  const fileName = `${tryout.name.replace(/\s+/g, '_')}_results.csv`;

  if (Platform.OS === 'web') {
    // Web: Create a Blob and trigger a download link
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    // Mobile: Save to local filesystem and share
    const { File, Paths } = require('expo-file-system');
    const file = new File(Paths.cache, fileName);
    await file.write(csvString);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export Tryout Results',
        UTI: 'public.comma-separated-values-text',
      });
    } else {
      throw new Error('Sharing is not available on this device');
    }
  }
}

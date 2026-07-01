import RNFS from 'react-native-fs';
import Share from 'react-native-share';
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
    const path = `${RNFS.CachesDirectoryPath}/${fileName}`;
    await RNFS.writeFile(path, csvString, 'utf8');

    try {
      await Share.open({
        url: `file://${path}`,
        type: 'text/csv',
        filename: fileName,
        title: 'Export Tryout Results'
      });
    } catch (e: any) {
      if (e.message !== 'User did not share') {
        throw new Error('Sharing failed: ' + e.message);
      }
    }
  }
}

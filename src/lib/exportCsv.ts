import { Platform, Share } from 'react-native';
import RNFS from 'react-native-fs';
import RNShare from 'react-native-share';

/**
 * Cross-platform CSV export: a download on web, the native share sheet on
 * iOS/Android (falling back to RN's plain Share API if a share sheet isn't
 * available), and always writing under caches so nothing lingers.
 */
export async function exportCsvFile(filename: string, csv: string): Promise<void> {
  if (Platform.OS === 'web') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }

  const path = `${RNFS.CachesDirectoryPath}/${filename}`;
  await RNFS.writeFile(path, csv, 'utf8');
  try {
    await RNShare.open({
      url: `file://${path}`,
      type: 'text/csv',
      filename,
      title: `Export ${filename}`,
    });
  } catch (e: any) {
    if (e.message !== 'User did not share') {
      await Share.share({ message: csv, title: filename });
    }
  }
}

/** Escapes a value for a CSV cell — wraps in quotes and doubles any embedded quotes if needed. */
export function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Turns name parts into a lowercase, hyphenated, filename-safe slug. */
export function slugify(...parts: (string | undefined)[]): string {
  return (
    parts
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'export'
  );
}

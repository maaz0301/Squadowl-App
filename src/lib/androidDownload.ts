import { NativeModules, Platform } from 'react-native';

interface AADownloadModule {
  saveToDownloads: (sourcePath: string, fileName: string, mimeType: string) => Promise<string>;
  openDownloadedFile: (uri: string, mimeType: string) => Promise<boolean>;
}

const nativeModule: AADownloadModule | undefined = NativeModules.AADownloadModule;

/**
 * Save `sourcePath` (a plain filesystem path, e.g. a file already written to
 * the cache dir) straight into the device's public Downloads collection via
 * MediaStore, then try to open it in whatever app the device already has for
 * that MIME type.
 *
 * Throws on Android < 10 (no MediaStore.Downloads there) or on a JS-only
 * build missing the native module — the caller is expected to fall back to
 * the share sheet in that case. `opened: false` in the resolved value is not
 * a failure: the file is saved either way, there's just nothing installed
 * that can view it.
 */
export async function saveAndOpenInDownloads(
  sourcePath: string,
  fileName: string,
  mimeType: string,
): Promise<{ opened: boolean }> {
  if (Platform.OS !== 'android' || !nativeModule) {
    throw new Error('Direct Downloads save is only available on Android.');
  }
  const uri = await nativeModule.saveToDownloads(sourcePath, fileName, mimeType);
  const opened = await nativeModule.openDownloadedFile(uri, mimeType);
  return { opened };
}

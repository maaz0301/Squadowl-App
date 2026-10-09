import RNFS from 'react-native-fs';
import { launchImageLibrary } from 'react-native-image-picker';
import { getDataSource } from '@/data';
import type { AccountVideo, LocalVideoFile, VideoContext, VideoUploadProgress } from '@/data/videoStorage';

/**
 * Picking, compressing and uploading a video for the Video Storage Add-On.
 *
 * Raw phone video is far too large to store, so every upload is compressed to
 * 720p MP4 (H.264) on the device first, with the coach seeing
 * Compressing -> Uploading -> Done. The file never passes through JavaScript
 * memory: the compressor writes a new file and the upload streams it from disk.
 */

/** Thrown when the compressor's native module isn't in the running binary. */
export class VideoCompressorUnavailable extends Error {
  constructor() {
    super(
      'Compressing videos needs a newer build of the app. Update to the latest version and try again. ' +
        'If you built this one yourself, run `npm install` and reinstall the app so the compressor is included.',
    );
    this.name = 'VideoCompressorUnavailable';
  }
}

/** The longer edge, in pixels, of a 720p frame in either orientation. */
const MAX_LONG_EDGE = 1280;

/** `react-native-compressor`, resolved at call time so an older binary degrades to a message rather than a crash. */
function loadCompressor(): { compress: (uri: string, options: Record<string, unknown>, onProgress?: (p: number) => void) => Promise<string> } {
  try {
    const mod = require('react-native-compressor');
    const video = mod?.Video ?? mod?.default?.Video;
    if (video?.compress) return video;
  } catch {
    // Fall through to the typed error below.
  }
  throw new VideoCompressorUnavailable();
}

const stripFileScheme = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** Opens the gallery for one video. Null when the person backs out. */
export async function pickVideo(): Promise<LocalVideoFile | null> {
  const result = await launchImageLibrary({ mediaType: 'video', selectionLimit: 1, videoQuality: 'high' });
  if (result.didCancel) return null;
  if (result.errorCode) throw new Error(result.errorMessage || 'Could not open the gallery.');
  const asset = result.assets?.[0];
  if (!asset?.uri) return null;
  return {
    uri: asset.uri,
    name: asset.fileName || 'video.mp4',
    type: asset.type || 'video/mp4',
    size: asset.fileSize ?? 0,
    durationSeconds: asset.duration,
  };
}

/** Re-encodes to 720p H.264 MP4. `onProgress` is 0 to 1. */
export async function compressVideo(file: LocalVideoFile, onProgress?: (fraction: number) => void): Promise<LocalVideoFile> {
  const compressor = loadCompressor();
  let outUri: string;
  try {
    outUri = await compressor.compress(
      file.uri,
      {
        // 'manual' with maxSize caps the longer edge at 1280 px, so landscape comes out
        // 1280x720 and portrait 720x1280. Quality is left to the encoder's bitrate for that size.
        compressionMethod: 'manual',
        maxSize: MAX_LONG_EDGE,
        // Re-encode even a small clip, so every stored file is the same H.264 MP4.
        minimumFileSizeForCompress: 0,
      },
      (p) => onProgress?.(Math.max(0, Math.min(1, p))),
    );
  } catch (e) {
    // The JS side loads fine on an older binary, then throws when the native half is missing.
    const msg = e instanceof Error ? e.message : String(e);
    if (/Compressor|linked|undefined/i.test(msg)) throw new VideoCompressorUnavailable();
    throw e;
  }
  const stat = await RNFS.stat(stripFileScheme(outUri));
  const base = file.name.replace(/\.[^.]+$/, '') || 'video';
  return {
    uri: outUri.startsWith('file://') ? outUri : `file://${outUri}`,
    name: `${base}.mp4`,
    type: 'video/mp4',
    size: Number(stat.size),
    durationSeconds: file.durationSeconds,
  };
}

/** Frees the compressed copy once it is uploaded (or the upload failed). */
async function discardLocal(file: LocalVideoFile) {
  try {
    await RNFS.unlink(stripFileScheme(file.uri));
  } catch {
    // Already gone, or in a cache the OS will clear.
  }
}

/**
 * Compress a picked video and upload it into the account's storage. The result
 * is not attached to anything yet: call attachAccountVideo once the thing it
 * belongs to exists (or use ContextVideos, which does both).
 */
export async function compressAndUploadVideo(args: {
  file: LocalVideoFile;
  context: VideoContext;
  title?: string;
  accountId?: string;
  onProgress?: (p: VideoUploadProgress) => void;
}): Promise<AccountVideo> {
  const { onProgress } = args;
  onProgress?.({ phase: 'compressing', fraction: 0 });
  const compressed = await compressVideo(args.file, (fraction) => onProgress?.({ phase: 'compressing', fraction }));
  try {
    onProgress?.({ phase: 'uploading', fraction: 0 });
    const video = await getDataSource().uploadAccountVideo({
      file: compressed,
      context: args.context,
      title: args.title,
      accountId: args.accountId,
      onProgress: (fraction) => onProgress?.({ phase: 'uploading', fraction }),
    });
    onProgress?.({ phase: 'done', fraction: 1 });
    return video;
  } finally {
    await discardLocal(compressed);
  }
}

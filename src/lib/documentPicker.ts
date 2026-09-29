import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import RNFS from 'react-native-fs';

export interface PickedRosterFile {
  name: string;
  /** File contents as base64 — what XLSX.read needs to survive a binary .xlsx. */
  base64: string;
}

/** Thrown when the picker's native module isn't in the running binary. */
export class DocumentPickerUnavailable extends Error {
  constructor() {
    super(
      'Choosing a file needs a newer build of the app. Update to the latest version and try again, ' +
        'if you built this one yourself, reinstall it after `npm install` so the file picker is included.',
    );
    this.name = 'DocumentPickerUnavailable';
  }
}

/**
 * `@react-native-documents/picker`, resolved at call time.
 *
 * Required lazily, and inside a try, because it is a native module: a JS-only
 * build (Metro against an older binary, or a device that hasn't taken the
 * rebuild that added the pod) has the JS but not the native side, and a
 * top-level import would take the whole screen down on load rather than one
 * button when it's tapped.
 */
interface PickerModule {
  pick: (opts: Record<string, unknown>) => Promise<unknown>;
  types?: Record<string, string | readonly string[]>;
  errorCodes?: Record<string, string>;
  isErrorWithCode?: (e: unknown) => e is { code: string };
  keepLocalCopy?: (opts: Record<string, unknown>) => Promise<
    ({ status: 'success'; localUri: string } | { status: 'error'; copyError: string })[]
  >;
}

/** The name the picker's iOS and Android modules are both registered under. */
const NATIVE_MODULE_NAME = 'RNDocumentPicker';

/**
 * Whether the native side is actually in this binary.
 *
 * Asked before the JS is required, and with the *non*-enforcing lookups,
 * because the package reaches its own native module through
 * `TurboModuleRegistry.getEnforcing` at module scope: by the time requiring it
 * would tell us anything, it has already thrown. `get` returns null in the same
 * situation, and the `NativeModules` fallback covers the old architecture,
 * where the picker is a plain bridge module rather than a TurboModule.
 */
function nativePickerPresent(): boolean {
  try {
    if (TurboModuleRegistry.get(NATIVE_MODULE_NAME)) return true;
  } catch {
    // A registry that throws on a lookup is a registry that hasn't got it.
  }
  return Boolean(NativeModules?.[NATIVE_MODULE_NAME]);
}

/** True for the error `getEnforcing` raises when the module isn't registered. */
function isMissingNativeModuleError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e ?? '');
  return message.includes(NATIVE_MODULE_NAME) && message.includes('could not be found');
}

function loadPicker(): PickerModule {
  if (!nativePickerPresent()) throw new DocumentPickerUnavailable();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-documents/picker');
    if (!mod?.pick) throw new Error('no pick()');
    return mod;
  } catch {
    throw new DocumentPickerUnavailable();
  }
}

/**
 * The file types the picker offers.
 *
 * Flattened because `types.csv` is two MIME types on Android and a single UTI
 * on iOS, and a nested array reaches the native side as a type nobody matches —
 * which shows up as every .csv on the device greyed out.
 *
 * `octet-stream` is Android-only and deliberate: a spreadsheet that arrived by
 * download or over Bluetooth routinely has no better MIME type recorded, and
 * without it those files can't be selected at all. The bytes are parsed either
 * way, so a wrong pick fails with a message rather than being unpickable.
 */
function rosterFileTypes(picker: PickerModule): string[] {
  const t = picker.types ?? {};
  const wanted = [t.xlsx, t.xls, t.csv, t.plainText].flat().filter((v): v is string => typeof v === 'string');
  return Platform.OS === 'android' ? [...wanted, 'application/octet-stream'] : wanted;
}

/**
 * Let the coach choose a roster file, and hand back its bytes.
 *
 * Resolves to null when they back out of the picker — that is a normal way to
 * leave the sheet, not a failure worth an alert.
 *
 * `keepLocalCopy` runs on both platforms, for the same reason on each: what the
 * picker returns is a handle, not a readable path. On iOS it is a
 * security-scoped URL inside the provider's container (iCloud, Drive); on
 * Android it is a `content://` URI. Copying into the app's cache first is what
 * makes RNFS able to read either one — and on Android it is also what turns a
 * Google Sheet into a real .xlsx (see `convertVirtualFileToType`).
 */
export async function pickRosterFile(): Promise<PickedRosterFile | null> {
  const picker = loadPicker();

  let picked: any;
  try {
    const results = await picker.pick({
      type: rosterFileTypes(picker),
      allowMultiSelection: false,
      // Android: a roster living in Drive as a Google Sheet has no bytes to
      // read until it is exported. Allowing it here, and naming an export type
      // below, is what makes "the roster is in Drive" work instead of failing
      // on an empty file.
      allowVirtualFiles: true,
    });
    picked = Array.isArray(results) ? results[0] : results;
  } catch (e) {
    if (picker.isErrorWithCode?.(e) && e.code === picker.errorCodes?.OPERATION_CANCELED) return null;
    // The package resolves its native module lazily, so a binary without it
    // gets all the way here before failing. Reported as the build problem it
    // is rather than as an unreadable file.
    if (isMissingNativeModuleError(e)) throw new DocumentPickerUnavailable();
    throw e;
  }
  if (!picked?.uri) return null;

  const name: string = picked.name || 'Roster';
  let readUri: string = picked.uri;

  if (typeof picker.keepLocalCopy === 'function') {
    // Google Sheets and the like export to whichever of our readable types the
    // provider offers; xlsx first because it survives a sheet with formatting,
    // CSV as the fallback.
    const convertible: { mimeType: string }[] = picked.convertibleToMimeTypes ?? [];
    const exportType = picked.isVirtual
      ? (convertible.find((c) => c.mimeType.includes('spreadsheetml')) ?? convertible.find((c) => c.mimeType.includes('csv')) ?? convertible[0])?.mimeType
      : undefined;

    const [copy] = await picker.keepLocalCopy({
      files: [{ uri: picked.uri, fileName: name, ...(exportType ? { convertVirtualFileToType: exportType } : {}) }],
      destination: 'cachesDirectory',
    });
    if (copy?.status === 'success') {
      readUri = copy.localUri;
    } else if (picked.isVirtual) {
      // A virtual file has nothing to fall back to: without the export there
      // are no bytes at that URI at all.
      throw new Error(
        `${name} is a Google Sheet, and it could not be exported. Open it in Drive, ` +
          'download it as .xlsx or .csv, and pick that file instead.',
      );
    }
  }

  // RNFS wants a path, not a percent-encoded file:// URL; Android's content://
  // URIs it reads as-is on the versions that still get here.
  const path = readUri.startsWith('file://') ? decodeURIComponent(readUri.replace('file://', '')) : readUri;
  const base64 = await RNFS.readFile(path, 'base64');
  if (!base64) throw new Error(`${name} is empty.`);
  return { name, base64 };
}

export interface PickedAttachment {
  uri: string;
  name: string;
  type: string;
  size: number;
}

/**
 * Choose any single file (PDF, image, doc, spreadsheet) to attach somewhere.
 * Same local-copy step as the roster picker, for the same reason: what the
 * picker returns is a handle, not a path RNFS can read. Null = backed out.
 */
export async function pickAttachment(): Promise<PickedAttachment | null> {
  const picker = loadPicker();
  let picked: any;
  try {
    const results = await picker.pick({ allowMultiSelection: false });
    picked = Array.isArray(results) ? results[0] : results;
  } catch (e) {
    if (picker.isErrorWithCode?.(e) && e.code === picker.errorCodes?.OPERATION_CANCELED) return null;
    if (isMissingNativeModuleError(e)) throw new DocumentPickerUnavailable();
    throw e;
  }
  if (!picked?.uri) return null;

  const name: string = picked.name || 'File';
  let uri: string = picked.uri;
  if (typeof picker.keepLocalCopy === 'function') {
    const [copy] = await picker.keepLocalCopy({
      files: [{ uri: picked.uri, fileName: name }],
      destination: 'cachesDirectory',
    });
    if (copy?.status === 'success') uri = copy.localUri;
  }
  return { uri, name, type: picked.type ?? '', size: Number(picked.size ?? 0) };
}

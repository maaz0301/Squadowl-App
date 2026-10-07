import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { Alert, Platform } from 'react-native';
import { Tryout, ExportFormat, type TeamRosterPlayer } from '@/data/types';
import { buildTeamBuilderExportRows, type TeamBuilderState } from '@/data/teamBuilder';
import { buildFullResultsCsvRows, buildPlayerFullResults, buildReportDocInfo } from '@/data/resultsExport';
import { csvCell, slugify } from '@/lib/exportCsv';
import { renderPlayerReportPdf, type PlayerReportPdfInput } from '@/lib/playerReportPdf';
import {
  LOGO_BAND,
  drawLogoStrip,
  embedLogos,
  renderCompactResults,
  type ReportPdfOptions,
} from '@/lib/reportPdf';
import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import * as XLSX from 'xlsx';

/**
 * Column widths for the full-results sheet: the first column holds row labels
 * ("CAT/CRITERIA SCORE-RANK" is the widest), and the columns after it carry
 * scores and free-text notes, so they get room before Excel clips them.
 */
function fullResultsColumnWidths(rows: (string | number)[][]): { wch: number }[] {
  const widest = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return Array.from({ length: widest }, (_, i) => ({ wch: i === 0 ? 26 : 18 }));
}

/**
 * The standard PDF fonts encode WinAnsi (cp1252) only, and pdf-lib *throws*
 * the moment it is asked to draw a character outside it — so a single accented
 * or emoji character anywhere in a roster name or a coach's notes killed the
 * whole PDF export. Fold what we can (accents -> base letter), replace the rest.
 */
const WIN_ANSI_HIGH = '\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178';

function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return c === 10 || c === 13 || (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN_ANSI_HIGH.includes(ch);
}

/** Characters NFD can't fold, because the stroke is part of the glyph. */
const TRANSLITERATE: Record<string, string> = {
  '\u0141': 'L', // L with stroke
  '\u0142': 'l',
  '\u0110': 'D', // D with stroke
  '\u0111': 'd',
  '\u0126': 'H',
  '\u0127': 'h',
  '\u0166': 'T',
  '\u0167': 't',
  '\u0131': 'i', // dotless i
  '\u0132': 'IJ',
  '\u0133': 'ij',
  '\u014a': 'N',
  '\u014b': 'n',
  '\u2032': "'", // prime / double prime (feet & inches in heights)
  '\u2033': '"',
};

function pdfSafe(text: string): string {
  if (!text) return text ?? '';
  let out = '';
  for (const ch of text) {
    if (ch === '\t') {
      out += ' ';
    } else if (TRANSLITERATE[ch] !== undefined) {
      out += TRANSLITERATE[ch];
    } else if (isWinAnsi(ch)) {
      out += ch;
    } else {
      const folded =
        typeof ch.normalize === 'function' ? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
      const kept = Array.from(folded).filter(isWinAnsi).join('');
      out += kept || '?';
    }
  }
  return out;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const PAGE_BORDER_INSET = 24;
const GRAY = rgb(0.45, 0.45, 0.45);
const BLACK = rgb(0, 0, 0);
const RULE = rgb(0.8, 0.8, 0.8);
const BLUE = rgb(0.1, 0.32, 0.6);

/** Breaks `text` into lines no wider than `maxWidth` at `size` in font `f`. */
function wrapText(text: string, f: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && f.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

interface TextSegment {
  text: string;
  color?: ReturnType<typeof rgb>;
}

/** Wraps mixed-color `segments` (e.g. a black label followed by a colored value) into lines no wider than `maxWidth`, one word per entry so color survives the wrap. */
function wrapSegments(segments: TextSegment[], f: PDFFont, size: number, maxWidth: number): TextSegment[][] {
  const spaceWidth = f.widthOfTextAtSize(' ', size);
  const words: TextSegment[] = [];
  for (const seg of segments) {
    for (const w of seg.text.split(' ')) {
      if (w) words.push({ text: w, color: seg.color });
    }
  }
  const lines: TextSegment[][] = [];
  let current: TextSegment[] = [];
  let width = 0;
  for (const w of words) {
    const wWidth = f.widthOfTextAtSize(w.text, size);
    const addWidth = current.length ? spaceWidth + wWidth : wWidth;
    if (current.length && width + addWidth > maxWidth) {
      lines.push(current);
      current = [w];
      width = wWidth;
    } else {
      current.push(w);
      width += addWidth;
    }
  }
  if (current.length) lines.push(current);
  return lines.length ? lines : [[]];
}

/**
 * Full printable results report: by default one page per roster player with a
 * metric/score/rank table (ranked against the whole roster) and every
 * evaluation's raw scores condensed onto a couple of dense lines. With
 * `playersPerPage` above 1, several players share a page (scores and ranks
 * only), and `logoUrls` prints a team or organization logo on every page.
 */
async function renderFullResultsPdf(tryout: Tryout, opts: ReportPdfOptions = {}): Promise<string> {
  const docInfo = buildReportDocInfo(tryout);
  const cards = buildPlayerFullResults(tryout, opts.sortBy);

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logos = await embedLogos(pdfDoc, opts.logoUrls);

  const perPage = opts.playersPerPage ?? 1;
  if (perPage !== 1) {
    renderCompactResults(pdfDoc, { font, bold: fontBold }, docInfo, cards, perPage, logos);
    return pdfDoc.saveAsBase64();
  }

  // Where content starts on every page, lower when a logo strip sits above it.
  const TOP = PAGE_HEIGHT - MARGIN - (logos.length ? LOGO_BAND : 0);

  /** Adds a page and frames it with the report's border. */
  const newPage = () => {
    const p = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    p.drawRectangle({
      x: PAGE_BORDER_INSET,
      y: PAGE_BORDER_INSET,
      width: PAGE_WIDTH - PAGE_BORDER_INSET * 2,
      height: PAGE_HEIGHT - PAGE_BORDER_INSET * 2,
      borderColor: BLACK,
      borderWidth: 1,
    });
    if (logos.length) drawLogoStrip(p, logos, MARGIN);
    return p;
  };

  let page = newPage();
  let y = TOP;

  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = newPage();
      y = TOP;
    }
  };

  const drawLine = (
    text: string,
    opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    const f = opts.f ?? font;
    ensureSpace(size + 4);
    page.drawText(pdfSafe(text), { x: opts.x ?? MARGIN, y, size, font: f, color: opts.color ?? BLACK });
    y -= opts.gap ?? size + 4;
  };

  const drawWrapped = (
    text: string,
    opts: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number; gap?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    const f = opts.f ?? font;
    const x = opts.x ?? MARGIN;
    const maxWidth = opts.maxWidth ?? PAGE_WIDTH - MARGIN - x;
    for (const line of wrapText(pdfSafe(text), f, size, maxWidth)) {
      drawLine(line, { size, f, color: opts.color, x, gap: opts.gap ?? size + 3 });
    }
  };

  const drawSegments = (
    segments: TextSegment[],
    opts: { size?: number; f?: PDFFont; x?: number; maxWidth?: number; gap?: number } = {},
  ) => {
    const size = opts.size ?? 9;
    const f = opts.f ?? font;
    const x = opts.x ?? MARGIN;
    const maxWidth = opts.maxWidth ?? PAGE_WIDTH - MARGIN - x;
    const spaceWidth = f.widthOfTextAtSize(' ', size);
    const safe = segments.map((seg) => ({ ...seg, text: pdfSafe(seg.text) }));
    for (const line of wrapSegments(safe, f, size, maxWidth)) {
      ensureSpace(size + 4);
      let cx = x;
      for (const word of line) {
        page.drawText(word.text, { x: cx, y, size, font: f, color: word.color ?? BLACK });
        cx += f.widthOfTextAtSize(word.text, size) + spaceWidth;
      }
      y -= opts.gap ?? size + 3;
    }
  };

  drawLine(docInfo.title, { size: 18, f: fontBold, gap: 24 });
  drawWrapped(docInfo.subtitle, { size: 9, color: GRAY, gap: 13 });
  y -= 10;

  const scoreX = MARGIN + 260;
  const rankX = MARGIN + 380;

  cards.forEach((card, idx) => {
    if (idx > 0) {
      if (opts.continuous) {
        // Next player starts right below the last, divided by a rule. The
        // header and score table are kept together, so a player never starts
        // with a name stranded at the bottom of a page.
        y -= 6;
        ensureSpace(120);
        page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: RULE });
        y -= 18;
      } else {
        page = newPage();
        y = TOP;
      }
    }

    const meta = pdfSafe(
      `#${card.jersey || '-'} • ${card.pos || '-'} • Shoots ${card.shoots || '-'} • Evals ${card.evalCount}`,
    );
    page.drawText(pdfSafe(card.name), { x: MARGIN, y, size: 15, font: fontBold, color: BLACK });
    const metaWidth = font.widthOfTextAtSize(meta, 9);
    page.drawText(meta, { x: PAGE_WIDTH - MARGIN - metaWidth, y: y + 3, size: 9, font, color: GRAY });
    y -= 26;

    drawLine('Scoring and Ranking', { size: 11, f: fontBold, gap: 16 });

    const metricRows = [{ label: 'Overall Score', score: card.overallScore, rank: card.overallRank }, ...card.metrics];

    const tableLeft = MARGIN;
    const tableRight = PAGE_WIDTH - MARGIN;
    const col2X = scoreX - 10;
    const col3X = rankX - 10;
    const headerHeight = 24;
    const rowHeight = 24;
    const tableHeight = headerHeight + rowHeight * metricRows.length;

    ensureSpace(tableHeight + 8);
    const tableTop = y + 9;
    const tableBottom = tableTop - tableHeight;

    page.drawRectangle({ x: tableLeft, y: tableBottom, width: tableRight - tableLeft, height: tableHeight, borderColor: BLACK, borderWidth: 1 });
    page.drawLine({ start: { x: col2X, y: tableTop }, end: { x: col2X, y: tableBottom }, thickness: 0.75, color: BLACK });
    page.drawLine({ start: { x: col3X, y: tableTop }, end: { x: col3X, y: tableBottom }, thickness: 0.75, color: BLACK });
    page.drawLine({ start: { x: tableLeft, y: tableTop - headerHeight }, end: { x: tableRight, y: tableTop - headerHeight }, thickness: 1, color: BLACK });

    const headerTextY = tableTop - headerHeight + 8;
    page.drawText('METRIC', { x: MARGIN + 6, y: headerTextY, size: 10, font: fontBold, color: GRAY });
    page.drawText('SCORE', { x: scoreX, y: headerTextY, size: 10, font: fontBold, color: GRAY });
    page.drawText('RANK', { x: rankX, y: headerTextY, size: 10, font: fontBold, color: GRAY });

    let rowTop = tableTop - headerHeight;
    metricRows.forEach((m, i) => {
      // Scores are the thing people read off the page, so they are bold and larger than the labels.
      const rowTextY = rowTop - rowHeight + 7;
      page.drawText(pdfSafe(m.label), { x: MARGIN + 6, y: rowTextY, size: 11, font, color: BLACK });
      page.drawText(pdfSafe(m.score), { x: scoreX, y: rowTextY - 1, size: 14, font: fontBold, color: BLACK });
      page.drawText(pdfSafe(m.rank), { x: rankX, y: rowTextY, size: 11, font, color: BLACK });
      rowTop -= rowHeight;
      if (i < metricRows.length - 1) {
        page.drawLine({ start: { x: tableLeft, y: rowTop }, end: { x: tableRight, y: rowTop }, thickness: 0.5, color: RULE });
      }
    });

    y = tableBottom - 12;

    drawSegments(
      [{ text: 'Recommendation: ' }, { text: card.recommendation || '-', color: BLUE }],
      { size: 9.5, gap: 13 },
    );
    drawWrapped(`Strengths: ${card.strengths || '-'}`, { size: 9.5, gap: 13 });
    drawWrapped(`Improve: ${card.improve || '-'}`, { size: 9.5, gap: 13 });
    y -= 10;

    for (const ev of card.evals) {
      ensureSpace(36);
      const header = `Eval ${ev.index} • ${ev.date} • ${ev.evaluator} • ${ev.session}`;
      const scoreLine = ev.values.map((v) => `${v.abbr}:${v.text || '-'}`).join(' • ');
      drawWrapped(header, { size: 10, f: fontBold, color: BLUE, gap: 14 });
      drawWrapped(scoreLine, { size: 9.5, color: BLUE, gap: 13 });
      drawSegments(
        [
          { text: 'Rec: ' },
          { text: `${ev.recommendation || '-'} |`, color: BLUE },
          { text: `Str: ${ev.strengths || '-'} | Imp: ${ev.improve || '-'}` },
        ],
        { size: 9.5, gap: 13 },
      );
      y -= 6;
    }
  });

  return pdfDoc.saveAsBase64();
}

/**
 * Shared tail of every export: hand the generated file to the OS. On Android
 * this writes to the cache dir, saves a real copy into the device's public
 * Downloads collection, and opens that copy; on iOS it writes to the cache
 * dir and opens the share sheet; on web it triggers a blob download via a
 * hidden anchor.
 *
 * Android used to only offer the cache-dir file through the share sheet,
 * which read as "the export button just sends you to email" with no actual
 * file landing on the phone. `saveAndOpenInDownloads` (native `DownloadModule`,
 * API 29+) fixes that by inserting into `MediaStore.Downloads` — the one way
 * to create a new file in shared storage without WRITE_EXTERNAL_STORAGE on a
 * scoped-storage device — then opening it with a read-permission-scoped
 * ACTION_VIEW intent. It can fail (older OS, JS-only build missing the native
 * module, no viewer app for the MIME type), in which case this falls back to
 * the old share-sheet behavior below so the export still reaches the user.
 *
 * `showAppsToView` is what makes "open it here" possible on that fallback. A
 * plain chooser is built from ACTION_SEND alone, so the only things it can
 * offer are apps that *send* a file — mail and messaging — which is the same
 * "sends you to email" problem. This seeds the chooser with ACTION_VIEW
 * targets as well (EXTRA_INITIAL_INTENTS, so they sit at the top): the PDF
 * reader and spreadsheet apps already on the device, opening the file in
 * place. Send targets stay where they were, so emailing a copy still works
 * exactly as before. No-op on iOS, whose share sheet already carries Quick
 * Look, Books, Files and "open in" for a file URL.
 *
 * The cache-dir file stays in place deliberately: react-native-share's
 * FileProvider only publishes `cache-path` and external `Download/`
 * (share_download_paths.xml), so writing anywhere else — Documents included —
 * leaves it unable to mint a content:// URI and breaks both viewing and sharing.
 */
async function writeAndDeliverFile(
  fileName: string,
  content: string,
  encoding: 'utf8' | 'base64',
  mimeType: string,
  format: string,
): Promise<void> {
  if (Platform.OS === 'web') {
    let url: string;
    if (encoding === 'base64') {
      const byteCharacters = atob(content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      url = URL.createObjectURL(blob);
    } else {
      const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
      url = URL.createObjectURL(blob);
    }
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    const path = `${RNFS.CachesDirectoryPath}/${fileName}`;
    await RNFS.writeFile(path, content, encoding);

    if (Platform.OS === 'android') {
      try {
        const { saveAndOpenInDownloads } = await import('./androidDownload');
        const { opened } = await saveAndOpenInDownloads(path, fileName, mimeType);
        Alert.alert(
          'Saved to Downloads',
          opened
            ? `${fileName} was saved to your Downloads folder and opened.`
            : `${fileName} was saved to your Downloads folder. Open your Files app to view it.`,
        );
        return;
      } catch {
        // API < 29, a JS-only build missing the native module, or the write
        // itself failed — fall through to the share sheet below so the
        // export still reaches the user one way or another.
      }
    }

    try {
      await Share.open({
        url: `file://${path}`,
        type: mimeType,
        filename: fileName,
        title: `Open or share ${format.toUpperCase()}`,
        showAppsToView: true,
        // Dismissing the chooser is a normal outcome, not an error. This used to
        // be caught below by string-matching the message, which silently turns
        // into a thrown "export failed" the day that wording changes.
        failOnCancel: false,
      });
    } catch (e: any) {
      if (e.message !== 'User did not share') {
        throw new Error('Sharing failed: ' + e.message);
      }
    }
  }
}

export async function exportTryoutData(
  tryout: Tryout,
  format: ExportFormat,
  pdfOptions?: ReportPdfOptions,
): Promise<void> {
  const safeName = tryout.name.replace(/\s+/g, '_');
  const fileName = `${safeName}_results.${format}`;
  let fileContent = '';
  let encoding: 'utf8' | 'base64' = 'utf8';
  let mimeType = 'text/plain';

  if (format === 'csv') {
    const { infoLines, playerBlocks } = buildFullResultsCsvRows(tryout);
    const blocks = playerBlocks.map((rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n'));
    fileContent = [
      infoLines.map((r) => r.map(csvCell).join(',')).join('\n'),
      '',
      blocks.join('\n\n'),
    ].join('\n');
    mimeType = 'text/csv';
  } else if (format === 'xlsx') {
    // The full-results rows: the info header, then each player's
    // PLYR/CAT/STR/IMP rows and eval tables, blocks separated by a blank row so
    // one player's card stays readable on a printed page — same layout as the
    // CSV export.
    const { infoLines, playerBlocks } = buildFullResultsCsvRows(tryout);
    const rows: (string | number)[][] = [...infoLines, []];
    playerBlocks.forEach((block, i) => {
      if (i > 0) rows.push([]);
      rows.push(...block);
    });

    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = fullResultsColumnWidths(rows);
    XLSX.utils.book_append_sheet(wb, sheet, 'Full Results');

    fileContent = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    encoding = 'base64';
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (format === 'pdf') {
    fileContent = await renderFullResultsPdf(tryout, pdfOptions);
    encoding = 'base64';
    mimeType = 'application/pdf';
  }

  await writeAndDeliverFile(fileName, fileContent, encoding, mimeType, format);
}

/** The player report card as a PDF, handed to the OS like the other exports. */
export async function exportPlayerReportCard(input: PlayerReportPdfInput): Promise<void> {
  const safeName = input.card.name.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || 'player';
  await writeAndDeliverFile(
    `${safeName}_report_card.pdf`,
    await renderPlayerReportPdf(input),
    'base64',
    'application/pdf',
    'pdf',
  );
}

/**
 * Export a Team Builder result (all teams, or just one via `opts.teamId`) as
 * XLSX or PDF — grouped by team so it's easy to print and double-check.
 */
export async function exportTeamBuilderData(
  tryout: Tryout,
  state: TeamBuilderState,
  format: 'xlsx' | 'pdf',
  opts?: { teamId?: string },
): Promise<void> {
  const { headers, rows } = buildTeamBuilderExportRows(tryout, state, opts);
  const singleTeam = opts?.teamId ? state.teams.find((t) => t.id === opts.teamId) : undefined;

  const safeName = tryout.name.replace(/\s+/g, '_');
  const suffix = singleTeam ? `_${singleTeam.name.replace(/\s+/g, '_')}` : '_teams';
  const fileName = `${safeName}${suffix}.${format}`;
  let fileContent = '';
  let encoding: 'utf8' | 'base64' = 'utf8';
  let mimeType = 'text/plain';

  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Team Builder');
    fileContent = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    encoding = 'base64';
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([600, 800]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const title = singleTeam ? `${tryout.name}: ${singleTeam.name}` : `${tryout.name}: Team Builder`;
    page.drawText(pdfSafe(title), { x: 50, y: 750, size: 20, font: fontBold });

    let y = 700;
    const xOffsets = [50, 170, 320, 380, 430, 500];

    headers.forEach((h, i) => {
      page.drawText(pdfSafe(h), { x: xOffsets[i], y, size: 10, font: fontBold });
    });
    y -= 20;

    for (const row of rows) {
      if (y < 50) {
        page = pdfDoc.addPage([600, 800]);
        y = 750;
      }
      row.forEach((cell, i) => {
        page.drawText(pdfSafe(cell), { x: xOffsets[i], y, size: 10, font });
      });
      y -= 15;
    }

    fileContent = await pdfDoc.saveAsBase64();
    encoding = 'base64';
    mimeType = 'application/pdf';
  }

  await writeAndDeliverFile(fileName, fileContent, encoding, mimeType, format);
}

/**
 * The columns of a team roster export, in order. Contact details a coach needs
 * to reach a family are here; medical information is deliberately not — it is a
 * sensitive field with its own permission on the roster read, and a shared
 * spreadsheet or PDF outlives that permission.
 */
export const TEAM_ROSTER_EXPORT_HEADERS = [
  'Jersey',
  'First Name',
  'Last Name',
  'Position',
  'Year of Birth',
  'Player Email',
  'Guardian Name',
  'Guardian Email',
  'Guardian Phone',
  'Fee Status',
  'Evaluation',
] as const;

const FEE_STATUS_LABEL: Record<'unpaid' | 'paid' | 'waived', string> = {
  unpaid: 'Unpaid',
  paid: 'Paid',
  waived: 'Waived',
};

/** One row per player, ordered by last then first name so a printed copy reads like a roll call. */
export function buildTeamRosterExportRows(players: TeamRosterPlayer[]): string[][] {
  return [...players]
    .sort(
      (a, b) =>
        (a.last || '').localeCompare(b.last || '', undefined, { sensitivity: 'base' }) ||
        (a.first || '').localeCompare(b.first || '', undefined, { sensitivity: 'base' }),
    )
    .map((p) => [
      p.jersey ?? '',
      p.first ?? '',
      p.last ?? '',
      p.pos ?? '',
      p.yearOfBirth != null ? String(p.yearOfBirth) : '',
      p.playerEmail ?? '',
      p.guardianName ?? '',
      p.guardianEmail ?? '',
      p.guardianPhone ?? '',
      p.feeStatus ? FEE_STATUS_LABEL[p.feeStatus] : '',
      p.sourceTryoutName ?? '',
    ]);
}

/**
 * Export a team's roster as Excel or PDF. Takes the whole roster rather than a
 * page of it — the Players tab only ever holds 50 rows of a large team.
 */
export async function exportTeamRosterData(
  team: { name: string; season?: string },
  players: TeamRosterPlayer[],
  format: 'xlsx' | 'pdf',
): Promise<void> {
  const headers = [...TEAM_ROSTER_EXPORT_HEADERS] as string[];
  const rows = buildTeamRosterExportRows(players);
  const fileName = `${slugify(team.name, 'roster')}.${format}`;
  const title = team.season ? `${team.name} (${team.season})` : team.name;

  let fileContent = '';
  let mimeType = 'text/plain';

  if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [8, 14, 16, 10, 13, 26, 20, 26, 16, 11, 22].map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    // Sheet names are capped at 31 characters and can't hold : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, 'Roster');
    fileContent = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    // Landscape: eleven columns don't fit a portrait page at a readable size.
    const PAGE_W = 842;
    const PAGE_H = 595;
    const MARGIN = 36;
    const widths = [34, 62, 70, 42, 46, 118, 84, 118, 68, 46, 98];
    const scale = (PAGE_W - MARGIN * 2) / widths.reduce((sum, w) => sum + w, 0);
    const colX: number[] = [];
    let x = MARGIN;
    for (const w of widths) {
      colX.push(x);
      x += w * scale;
    }
    const colWidth = widths.map((w) => w * scale - 4);
    const SIZE = 8;

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    /** Cut a cell to its column instead of letting it run into the next one. */
    const fit = (text: string, width: number, f: PDFFont): string => {
      let out = pdfSafe(text);
      if (f.widthOfTextAtSize(out, SIZE) <= width) return out;
      while (out.length > 1 && f.widthOfTextAtSize(out + '...', SIZE) > width) out = out.slice(0, -1);
      return out + '...';
    };

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    // 16pt headline: long names are trimmed by width so they can't run off the page.
    let headline = pdfSafe(title);
    while (headline.length > 1 && fontBold.widthOfTextAtSize(headline, 16) > PAGE_W - MARGIN * 2) headline = headline.slice(0, -1);
    page.drawText(headline, { x: MARGIN, y: y - 6, size: 16, font: fontBold });
    y -= 26;
    page.drawText(pdfSafe(`Roster - ${players.length} ${players.length === 1 ? 'player' : 'players'}`), {
      x: MARGIN,
      y,
      size: 10,
      font,
    });
    y -= 22;

    const drawHeader = () => {
      headers.forEach((h, i) => page.drawText(fit(h, colWidth[i], fontBold), { x: colX[i], y, size: SIZE, font: fontBold }));
      y -= 14;
    };
    drawHeader();

    for (const row of rows) {
      if (y < MARGIN) {
        page = pdfDoc.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGIN;
        drawHeader();
      }
      row.forEach((cell, i) => page.drawText(fit(cell, colWidth[i], font), { x: colX[i], y, size: SIZE, font }));
      y -= 13;
    }

    fileContent = await pdfDoc.saveAsBase64();
    mimeType = 'application/pdf';
  }

  await writeAndDeliverFile(fileName, fileContent, 'base64', mimeType, format);
}

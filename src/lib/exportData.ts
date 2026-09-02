import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { Platform } from 'react-native';
import { Tryout, ExportFormat } from '@/data/types';
import { computePlayerResults } from '@/data/scoring';
import { buildTeamBuilderExportRows, type TeamBuilderState } from '@/data/teamBuilder';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

/**
 * Shared tail of every export: hand the generated file to the OS. On native
 * this writes to the cache dir and opens the share sheet; on web it triggers
 * a blob download via a hidden anchor.
 *
 * `showAppsToView` is what makes "open it here" possible on Android. A plain
 * chooser is built from ACTION_SEND alone, so the only things it can offer are
 * apps that *send* a file — mail and messaging — which is why exporting read as
 * "the button sends you to email" with no way to just look at the results. This
 * seeds the chooser with ACTION_VIEW targets as well (EXTRA_INITIAL_INTENTS, so
 * they sit at the top): the PDF reader and spreadsheet apps already on the
 * device, opening the file in place. Send targets stay where they were, so
 * emailing a copy still works exactly as before. No-op on iOS, whose share sheet
 * already carries Quick Look, Books, Files and "open in" for a file URL.
 *
 * The file stays in the cache dir deliberately: react-native-share's
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

export async function exportTryoutData(tryout: Tryout, format: ExportFormat): Promise<void> {
  const results = computePlayerResults(tryout);
  const headers = ['Rank', 'First', 'Last', 'Jersey', 'Pos', 'Overall', 'Recommendation'];
  const rows = results
    .sort((a: any, b: any) => b.overall - a.overall)
    .map((r: any, i: number) => [
      String(i + 1),
      r.player.first,
      r.player.last,
      r.player.jersey ?? '',
      r.player.pos ?? '',
      r.overall.toFixed(2),
      r.latestRecommendation,
    ]);

  const safeName = tryout.name.replace(/\s+/g, '_');
  let fileName = `${safeName}_results.${format}`;
  let fileContent = '';
  let encoding: 'utf8' | 'base64' = 'utf8';
  let mimeType = 'text/plain';

  if (format === 'csv') {
    const csvString = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    fileContent = csvString;
    mimeType = 'text/csv';
  } else if (format === 'xlsx') {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tryout Results");
    fileContent = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    encoding = 'base64';
    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else if (format === 'pdf') {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([600, 800]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    page.drawText(`Tryout Results: ${tryout.name}`, { x: 50, y: 750, size: 20, font: fontBold });
    
    let y = 700;
    const xOffsets = [50, 90, 180, 280, 330, 380, 440];
    
    headers.forEach((h, i) => {
      page.drawText(h, { x: xOffsets[i], y, size: 10, font: fontBold });
    });
    y -= 20;
    
    for (const row of rows) {
      if (y < 50) {
        page = pdfDoc.addPage([600, 800]);
        y = 750;
      }
      row.forEach((cell: string, i: number) => {
        page.drawText(cell, { x: xOffsets[i], y, size: 10, font });
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
    page.drawText(title, { x: 50, y: 750, size: 20, font: fontBold });

    let y = 700;
    const xOffsets = [50, 170, 320, 380, 430, 500];

    headers.forEach((h, i) => {
      page.drawText(h, { x: xOffsets[i], y, size: 10, font: fontBold });
    });
    y -= 20;

    for (const row of rows) {
      if (y < 50) {
        page = pdfDoc.addPage([600, 800]);
        y = 750;
      }
      row.forEach((cell, i) => {
        page.drawText(cell, { x: xOffsets[i], y, size: 10, font });
      });
      y -= 15;
    }

    fileContent = await pdfDoc.saveAsBase64();
    encoding = 'base64';
    mimeType = 'application/pdf';
  }

  await writeAndDeliverFile(fileName, fileContent, encoding, mimeType, format);
}

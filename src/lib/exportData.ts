import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { Platform } from 'react-native';
import { Tryout, ExportFormat } from '@/data/types';
import { computePlayerResults } from '@/data/scoring';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

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

  if (Platform.OS === 'web') {
    let url: string;
    if (encoding === 'base64') {
      const byteCharacters = atob(fileContent);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      url = URL.createObjectURL(blob);
    } else {
      const blob = new Blob([fileContent], { type: `${mimeType};charset=utf-8;` });
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
    await RNFS.writeFile(path, fileContent, encoding);
    try {
      await Share.open({
        url: `file://${path}`,
        type: mimeType,
        filename: fileName,
        title: `Export ${format.toUpperCase()}`
      });
    } catch (e: any) {
      if (e.message !== 'User did not share') {
        throw new Error('Sharing failed: ' + e.message);
      }
    }
  }
}

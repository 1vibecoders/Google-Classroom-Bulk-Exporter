// Text of course documents: Word and PowerPoint files are unzipped and their
// XML read in order; PDFs are parsed; Google exports are plain text; anything
// without text is reported, never guessed.
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DOCX, GOOGLE_DOC, PDF, PPTX, documentText } from '../../src/lib/documents/text';

/** A one-page PDF showing `line` (offsets computed so the file is well formed). */
function pdf(line: string): Uint8Array {
  const content = `BT /F1 12 Tf 72 712 Td (${line}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(out);
}

describe('documentText', () => {
  it('reads Word paragraphs, tabs and entities', async () => {
    const xml =
      '<w:document><w:body><w:p><w:r><w:t>Essay due</w:t></w:r><w:r><w:t xml:space="preserve"> Oct 20 &amp; </w:t></w:r><w:r><w:tab/><w:t>rubric</w:t></w:r></w:p><w:p><w:r><w:t>Plan 3 hours.</w:t></w:r></w:p></w:body></w:document>';
    expect(await documentText(zipSync({ 'word/document.xml': strToU8(xml) }), DOCX)).toEqual({ status: 'ok', text: 'Essay due Oct 20 & rubric\nPlan 3 hours.' });
  });

  it('reads PowerPoint slides in slide order', async () => {
    const slide = (t: string) => strToU8(`<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`);
    const file = zipSync({ 'ppt/slides/slide10.xml': slide('Ten'), 'ppt/slides/slide2.xml': slide('Two'), 'ppt/slides/slide1.xml': slide('Unit test Friday') });
    expect(await documentText(file, PPTX)).toEqual({ status: 'ok', text: 'Unit test Friday\n\nTwo\n\nTen' });
  });

  it('reads the text of a PDF', async () => {
    const result = await documentText(pdf('Quiz on Friday, Oct 16'), PDF);
    expect(result.status).toBe('ok');
    expect(result.status === 'ok' && result.text).toContain('Quiz on Friday, Oct 16');
  });

  it('tidies exported text and reports what has no text', async () => {
    expect(await documentText(strToU8('﻿  Read   ch. 4\r\n\r\n\r\n\r\nQuiz Monday  '), GOOGLE_DOC)).toEqual({ status: 'ok', text: 'Read ch. 4\n\nQuiz Monday' });
    expect(await documentText(strToU8(' \n '), GOOGLE_DOC)).toEqual({ status: 'no_text' });
    expect(await documentText(strToU8('x'), 'image/png')).toEqual({ status: 'unsupported' });
    expect(await documentText(strToU8('not a zip'), DOCX)).toEqual({ status: 'unreadable' });
  });
});

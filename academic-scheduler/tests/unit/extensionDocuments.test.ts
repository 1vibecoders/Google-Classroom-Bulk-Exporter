// Course documents sent by the browser extension (trust boundary): only
// well-formed entries of the readable types are kept, sizes are capped, and
// the files are read into text with where they are attached.
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readDocuments, readExtensionDocuments } from '../../src/lib/documents/fromExtension';
import { DOCX } from '../../src/lib/documents/text';

const docx = (text: string) => Buffer.from(zipSync({ 'word/document.xml': strToU8(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`) })).toString('base64');
const entry = (fields: Record<string, unknown>) => ({
  fileId: '1AbC_def-123',
  courseId: 'NjI3',
  itemId: 'NzAw',
  itemType: 'assignment',
  title: 'Essay guide',
  url: 'https://docs.google.com/document/d/1AbC_def-123/edit',
  status: 'file',
  mime: DOCX,
  data: docx('Essay due Oct 20.'),
  ...fields,
});

describe('documents from the extension', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const docs = readExtensionDocuments([
      entry({}),
      entry({ fileId: 'bad id!' }),
      entry({ courseId: '../x' }),
      entry({ status: 'deleted' }),
      entry({ fileId: 'png1', mime: 'image/png' }),
      entry({ fileId: 'nob64', data: 'not base64!' }),
      entry({ fileId: 'big1', data: 'A'.repeat(14_000_000) }),
      entry({ fileId: 'gone1', status: 'inaccessible', mime: undefined, data: undefined, url: 'javascript:alert(1)', itemType: 'other' }),
      'nonsense',
    ]);
    expect(docs.map((d) => [d.fileId, d.status])).toEqual([
      ['1AbC_def-123', 'file'],
      ['big1', 'too_large'],
      ['gone1', 'inaccessible'],
    ]);
    expect(docs[2]).toEqual({ fileId: 'gone1', courseId: 'NjI3', parent: null, title: 'Essay guide', status: 'inaccessible' });
    expect(readExtensionDocuments(undefined)).toEqual([]);
  });

  it('reads the files into text with the class and the item they are attached to', async () => {
    const [read, gone] = await readDocuments(readExtensionDocuments([entry({}), entry({ fileId: 'gone1', status: 'inaccessible' })]));
    expect(read).toEqual({
      doc: {
        id: '1AbC_def-123',
        classId: 'gc-class-NjI3',
        title: 'Essay guide',
        url: 'https://docs.google.com/document/d/1AbC_def-123/edit',
        mime: DOCX,
        status: 'ok',
        chars: 17,
        via: 'extension',
      },
      text: 'Essay due Oct 20.',
      parents: [{ kind: 'coursework', sourceId: 'NzAw' }],
    });
    expect(gone.doc.status).toBe('inaccessible');
    expect(gone.text).toBeUndefined();
  });
});

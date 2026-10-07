// Turn a resource descriptor (from the content-script classifier) into a
// download plan: an ordered list of URLs to try, or the reason it is kept as a
// link. Every URL is an ordinary Google download/export endpoint that the
// user's own session can open; nothing here works around permissions.

const GOOGLE_EXPORTS = {
  'google-doc': {
    office: { path: (id) => `https://docs.google.com/document/d/${id}/export?format=docx`, ext: '.docx', label: 'Word (.docx)' },
    pdf: { path: (id) => `https://docs.google.com/document/d/${id}/export?format=pdf`, ext: '.pdf', label: 'PDF' },
  },
  'google-sheet': {
    office: { path: (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`, ext: '.xlsx', label: 'Excel (.xlsx)' },
    pdf: { path: (id) => `https://docs.google.com/spreadsheets/d/${id}/export?format=pdf`, ext: '.pdf', label: 'PDF' },
  },
  'google-slides': {
    office: { path: (id) => `https://docs.google.com/presentation/d/${id}/export/pptx`, ext: '.pptx', label: 'PowerPoint (.pptx)' },
    pdf: { path: (id) => `https://docs.google.com/presentation/d/${id}/export/pdf`, ext: '.pdf', label: 'PDF' },
  },
  'google-drawing': {
    office: { path: (id) => `https://docs.google.com/drawings/d/${id}/export/png`, ext: '.png', label: 'PNG image' },
    pdf: { path: (id) => `https://docs.google.com/drawings/d/${id}/export/pdf`, ext: '.pdf', label: 'PDF' },
  },
};

const LINK_REASONS = {
  'google-form': 'Google Forms cannot be downloaded as a file; saved as a link.',
  'drive-folder': 'Drive folders are not downloaded; saved as a link to the folder.',
  youtube: 'YouTube videos are saved as links.',
  'google-site': 'Google Sites pages are saved as links.',
  classroom: 'Classroom add-on or interactive attachment; saved as a link.',
  link: 'Web link; saved as a link (only Google Drive files are downloaded).',
};

function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') u.searchParams.set(k, String(v));
  }
  return u.href;
}

/**
 * @param {object} resource  descriptor from the snapshot
 * @param {{authuser:number, googleFormat:'office'|'pdf'}} options
 * @returns {{downloadable:true, attempts:{url:string, ext:string, label:string}[], exportLabel:(string|null)}
 *          | {downloadable:false, reason:string}}
 */
export function planDownload(resource, { authuser = null, googleFormat = 'office' } = {}) {
  // The account index of the class page wins: an authuser= typed into a
  // description link refers to the teacher's browser, not the user's.
  const account = authuser ?? resource.authuser ?? 0;
  const key = resource.resourceKey || null;

  if (resource.kind === 'drive-file' && resource.id) {
    const ext = resource.hint === 'ipynb' ? '.ipynb' : '';
    // "drive.google.com/open?id=" links do not say whether the file is a
    // Google Docs/Sheets/Slides file, which can only be exported.
    const nativeFallbacks =
      resource.hint === 'ambiguous'
        ? ['google-doc', 'google-sheet', 'google-slides'].map((kind) => {
            const fmt = googleFormat === 'pdf' ? 'pdf' : 'office';
            const spec = GOOGLE_EXPORTS[kind][fmt];
            return { url: withParams(spec.path(resource.id), { authuser: account, resourcekey: key }), ext: spec.ext, label: `${kindLabel(kind)} export` };
          })
        : [];
    return {
      downloadable: true,
      exportLabel: null,
      attempts: [
        {
          url: withParams('https://drive.usercontent.google.com/download', {
            id: resource.id,
            export: 'download',
            authuser: account,
            confirm: 't',
            resourcekey: key,
          }),
          ext,
          label: 'Drive download',
        },
        {
          url: withParams('https://drive.google.com/uc', { id: resource.id, export: 'download', authuser: account, resourcekey: key }),
          ext,
          label: 'Drive download (legacy endpoint)',
        },
        ...nativeFallbacks,
      ],
    };
  }

  const exports = GOOGLE_EXPORTS[resource.kind];
  if (exports && resource.id) {
    if (resource.published) {
      return { downloadable: false, reason: 'Published-to-the-web Google file; saved as a link.' };
    }
    const primary = googleFormat === 'pdf' ? 'pdf' : 'office';
    const secondary = primary === 'pdf' ? 'office' : 'pdf';
    const attempt = (fmt) => ({
      url: withParams(exports[fmt].path(resource.id), { authuser: account, resourcekey: key }),
      ext: exports[fmt].ext,
      label: exports[fmt].label,
    });
    return { downloadable: true, exportLabel: exports[primary].label, attempts: [attempt(primary), attempt(secondary)] };
  }

  return { downloadable: false, reason: LINK_REASONS[resource.kind] || LINK_REASONS.link };
}

export function kindLabel(kind) {
  return (
    {
      'drive-file': 'Drive file',
      'google-doc': 'Google Docs',
      'google-sheet': 'Google Sheets',
      'google-slides': 'Google Slides',
      'google-drawing': 'Google Drawings',
      'google-form': 'Google Forms',
      'google-site': 'Google Sites',
      'drive-folder': 'Drive folder',
      youtube: 'YouTube video',
      classroom: 'Classroom attachment',
      link: 'Link',
    }[kind] || 'Link'
  );
}

// A small, self-contained imitation of Google Classroom + Drive + Docs used
// by the DOM and end-to-end tests.
//
// It is NOT a copy of Classroom's markup. It reproduces the structural
// contracts the exporter relies on (data-stream-item-id rows, [aria-expanded]
// accordions, attachment links to Drive/Docs, /c/<course>/<kind>/<id>/details
// pages, /u/<n>/ multi-account paths) and the dynamic behaviours it must
// handle: delayed app boot, lazy batches on scroll with a progressbar, rows
// whose content only renders after expansion, duplicate titles, duplicate
// file names, an inaccessible file, Drive's virus-scan interstitial, a flaky
// server, a "Your work" panel and class comments that must be ignored, and
// item pages that are either server-rendered or rendered by scripts.

const ORIGIN = 'https://classroom.google.com';

export function b64(text) {
  return Buffer.from(String(text)).toString('base64').replace(/=+$/, '');
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export function defaultScenario(overrides = {}) {
  const courseNumeric = '627894214549';
  const scenario = {
    authuser: 1,
    course: { numericId: courseNumeric, id: b64(courseNumeric), name: 'English 10', section: 'Period 3' },
    // 'ssr': item pages contain their content; 'csr': content is rendered by a script after load.
    detailMode: 'ssr',
    // Accordion rows on the Classwork page (true) or always-expanded rows (false).
    collapsedRows: true,
    // Clicking a row opens the item page (in-app navigation) instead of expanding it.
    rowNavigates: false,
    initialBatch: 6,
    batchSize: 4,
    bootDelayMs: 300,
    topics: [
      { id: b64('9001'), name: 'Unit 1: Poetry' },
      { id: b64('9002'), name: 'Unit 2: Macbeth' },
    ],
    items: [
      {
        numericId: '700000000001',
        kind: 'a',
        title: 'Macbeth Act 1 Questions',
        topic: 'Unit 2: Macbeth',
        due: 'Due Oct 10, 11:59 PM',
        points: '100 points',
        posted: 'Oct 3',
        description: 'Read Act 1 carefully.\nAnswer every question in the worksheet.\nExtra notes: https://docs.google.com/document/d/DOCLINK00000000000001/edit?usp=sharing',
        attachments: [
          { type: 'drive', id: 'FILEPDF00000000000001', name: 'Macbeth.pdf', label: 'PDF' },
          { type: 'doc', id: 'DOCNOTES0000000000001', name: 'Act 1 notes', label: 'Google Docs' },
          { type: 'slides', id: 'SLIDES000000000000001', name: 'Act 1 slides', label: 'Google Slides' },
        ],
        inlineAttachmentLimit: 2,
        yourWork: [{ type: 'drive', id: 'STUDENTFILE0000000001', name: 'my answers.docx', label: 'Word' }],
        yourWorkInsideRoot: false,
        comments: [{ author: 'A student', text: 'Is this the same file? https://drive.google.com/file/d/COMMENTFILE0000000001/view' }],
      },
      {
        numericId: '700000000002',
        kind: 'm',
        title: 'Poetry Terms',
        topic: 'Unit 1: Poetry',
        posted: 'Sep 5',
        description: 'A reference sheet for the unit.',
        attachments: [
          { type: 'drive', id: 'FILEPDF00000000000002', name: 'terms.pdf', label: 'PDF' },
          { type: 'youtube', id: 'dQw4w9WgXcQ', name: 'How to read a sonnet', label: 'YouTube video' },
          { type: 'link', url: 'https://example.com/poems', name: 'Poetry Foundation', label: 'Link' },
        ],
      },
      {
        numericId: '700000000003',
        kind: 'a',
        title: 'Essay: Unit 1',
        topic: 'Unit 1: Poetry',
        due: 'No due date',
        points: '50 points',
        posted: 'Sep 12',
        description: 'Write a 2 page essay.',
        attachments: [
          { type: 'drive', id: 'FORBIDDEN000000000001', name: 'rubric.pdf', label: 'PDF' },
          { type: 'form', id: 'FORM00000000000000001', name: 'Self assessment', label: 'Google Forms' },
        ],
        yourWork: [{ type: 'drive', id: 'STUDENTFILE0000000002', name: 'essay draft.docx', label: 'Word' }],
        yourWorkInsideRoot: true,
      },
      {
        numericId: '700000000004',
        kind: 'sa',
        title: 'What is a sonnet?',
        topic: null,
        due: 'Due Sep 20',
        posted: 'Sep 15',
        description: 'Answer in one sentence.',
        attachments: [],
      },
      {
        numericId: '700000000005',
        kind: 'm',
        title: 'Poetry Terms',
        topic: null,
        posted: 'Sep 6',
        description: '',
        attachments: [
          { type: 'drive', id: 'NOTESA000000000000001', name: 'notes.pdf', label: 'PDF' },
          { type: 'drive', id: 'NOTESB000000000000001', name: 'notes.pdf', label: 'PDF' },
        ],
      },
      {
        numericId: '700000000006',
        kind: 'm',
        title: 'Lecture recording',
        topic: 'Unit 2: Macbeth',
        posted: 'Oct 1',
        description: 'Recording of the lecture: big file.',
        attachments: [{ type: 'drive', id: 'VIRUSSCAN000000000001', name: 'lecture.mp4', label: 'Video' }],
      },
      {
        numericId: '700000000007',
        kind: 'a',
        title: 'Reading log / week 3',
        topic: 'Unit 2: Macbeth',
        due: 'Due Oct 17',
        posted: 'Oct 8',
        description: 'Fill in the log.',
        attachments: [
          { type: 'sheet', id: 'SHEET0000000000000001', name: 'Reading log', label: 'Google Sheets' },
          { type: 'drive', id: 'FLAKY0000000000000001', name: 'week3.txt', label: 'Text' },
        ],
      },
      {
        numericId: '700000000008',
        kind: 'm',
        title: 'Folder of extra reading',
        topic: 'Unit 1: Poetry',
        posted: 'Sep 2',
        description: 'Optional.',
        attachments: [{ type: 'folder', id: 'FOLDER000000000000001', name: 'Extra reading', label: 'Folder' }],
      },
      {
        numericId: '700000000009',
        kind: 'a',
        title: 'CON',
        topic: null,
        due: 'Due Nov 1',
        posted: 'Oct 20',
        description: 'Title is a Windows reserved name.',
        attachments: [{ type: 'drive', id: 'UNICODE00000000000001', name: 'Résumé: draft?.pdf', label: 'PDF' }],
      },
    ],
    // Listed only on the Stream (e.g. still loading on the Classwork page).
    streamOnlyItems: [
      {
        numericId: '700000000099',
        kind: 'm',
        title: 'Late addition',
        topic: null,
        posted: 'Oct 21',
        description: 'Posted late.',
        attachments: [{ type: 'drive', id: 'LATEFILE0000000000001', name: 'late.pdf', label: 'PDF' }],
      },
    ],
    announcements: [
      {
        numericId: '800000000001',
        text: 'Welcome to English 10!\nThe syllabus is attached.',
        posted: 'Sep 1',
        attachments: [{ type: 'drive', id: 'SYLLABUS0000000000001', name: 'Syllabus.pdf', label: 'PDF' }],
        comments: [{ author: 'A student', text: 'Thanks! https://example.com/student-link' }],
      },
      { numericId: '800000000002', text: 'No class on Monday.', posted: 'Sep 9', attachments: [] },
      { numericId: '800000000003', text: 'Field trip form is due Friday.', posted: 'Sep 19', attachments: [{ type: 'form', id: 'FORM00000000000000002', name: 'Field trip form', label: 'Google Forms' }] },
      { numericId: '800000000004', text: 'Remember to bring your books.', posted: 'Oct 2', attachments: [] },
    ],
    ...overrides,
  };
  for (const item of [...scenario.items, ...scenario.streamOnlyItems]) item.id = b64(item.numericId);
  for (const post of scenario.announcements) post.id = b64(post.numericId);
  return scenario;
}

// ---------------------------------------------------------------------------
// Files served by the Drive/Docs mocks
// ---------------------------------------------------------------------------

function fileBytes(id, size = 2048) {
  const header = Buffer.from(`MOCK FILE ${id}\n`);
  const body = Buffer.alloc(Math.max(size - header.length, 0));
  for (let i = 0; i < body.length; i++) body[i] = (i * 31 + id.length * 7) & 0xff;
  return Buffer.concat([header, body]);
}

export function fileCatalog(scenario) {
  const files = new Map();
  const add = (att) => {
    if (att.type === 'drive') {
      files.set(att.id, {
        name: att.name,
        type: att.name.endsWith('.pdf') ? 'application/pdf' : att.name.endsWith('.mp4') ? 'video/mp4' : att.name.endsWith('.txt') ? 'text/plain' : 'application/octet-stream',
        bytes: fileBytes(att.id, att.id.startsWith('VIRUSSCAN') ? 3 * 1024 * 1024 + 123 : 2048),
      });
    }
  };
  for (const item of [...scenario.items, ...scenario.streamOnlyItems]) {
    item.attachments.forEach(add);
    (item.yourWork || []).forEach(add);
  }
  for (const post of scenario.announcements) post.attachments.forEach(add);
  return files;
}

// ---------------------------------------------------------------------------
// HTML builders
// ---------------------------------------------------------------------------

function prefix(scenario) {
  return `/u/${scenario.authuser}`;
}

function attachmentHref(att, scenario) {
  const au = scenario.authuser;
  switch (att.type) {
    case 'drive':
      return `https://drive.google.com/file/d/${att.id}/view?usp=classroom_web&authuser=${au}`;
    case 'doc':
      return `https://docs.google.com/document/d/${att.id}/edit?usp=classroom_web&authuser=${au}`;
    case 'sheet':
      return `https://docs.google.com/spreadsheets/d/${att.id}/edit?usp=classroom_web&authuser=${au}`;
    case 'slides':
      return `https://docs.google.com/presentation/d/${att.id}/edit?usp=classroom_web&authuser=${au}`;
    case 'form':
      return `https://docs.google.com/forms/d/${att.id}/viewform?usp=classroom_web`;
    case 'folder':
      return `https://drive.google.com/drive/folders/${att.id}?usp=classroom_web`;
    case 'youtube':
      return `https://www.youtube.com/watch?v=${att.id}`;
    default:
      return att.url;
  }
}

function attachmentCard(att, scenario, { driveIdAttr = false } = {}) {
  const href = attachmentHref(att, scenario);
  const wrapAttr = driveIdAttr && att.id ? ` data-drive-id="${esc(att.id)}"` : '';
  return `<div class="Kq1 att"${wrapAttr}><a class="Vb3" target="_blank" href="${esc(href)}" aria-label="Attachment: ${esc(att.label)}: ${esc(att.name)}"><div class="th"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></div><div class="nm"><div class="n1">${esc(att.name)}</div><div class="n2">${esc(att.label)}</div></div></a></div>`;
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" target="_blank">${url}</a>`);
}

function shell(scenario, { title, body, script = '', active = 'stream' }) {
  const c = scenario.course;
  const p = prefix(scenario);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="${ORIGIN}/"><title>${esc(title)}</title>
<style>body{font-family:sans-serif;margin:0}main{padding:16px}.desc,.pt{white-space:pre-wrap}li{list-style:none;border-bottom:1px solid #ddd;padding:8px}.feed>div{border:1px solid #ccc;margin:8px 0;padding:8px}.spacer{height:2200px}</style></head>
<body>
<header class="appbar"><a href="./${p.slice(1)}/h">Google Classroom</a> <a class="cls" href="./${p.slice(1)}/c/${c.id}"><span class="cn">${esc(c.name)}</span><span class="cs">${esc(c.section)}</span></a>
<div role="tablist"><a role="tab" aria-selected="${active === 'stream'}" href="./${p.slice(1)}/c/${c.id}">Stream</a><a role="tab" aria-selected="${active === 'classwork'}" href="./${p.slice(1)}/w/${c.id}/t/all">Classwork</a><a role="tab" href="./${p.slice(1)}/r/${c.id}/sort-last-name">People</a></div></header>
<div class="drawer" role="navigation"><a href="./${p.slice(1)}/c/${c.id}"><div>${esc(c.name)}</div><div>${esc(c.section)}</div></a><a href="./${p.slice(1)}/c/${b64('111')}"><div>Other class</div></a></div>
<main role="main">${body}</main>
${script}
</body></html>`;
}

function rowHtml(item, scenario, { expanded }) {
  const icon = { a: 'assignment', m: 'book', sa: 'help_outline' }[item.kind] || 'assignment';
  const rowMeta = item.due || (item.posted ? `Posted ${item.posted}` : '');
  return `<li class="tfG" data-stream-item-id="${item.numericId}"><div class="hd" role="button" tabindex="0" aria-expanded="${expanded ? 'true' : 'false'}"><i class="ic" aria-hidden="true">${icon}</i><div class="tt"><span class="nZ">${esc(item.title)}</span></div><div class="dd">${esc(rowMeta)}</div></div><div role="button" tabindex="0" aria-haspopup="true" aria-label="Options">⋮</div>${expanded ? expandedHtml(item, scenario) : ''}</li>`;
}

function expandedHtml(item, scenario) {
  const p = prefix(scenario);
  const limit = item.inlineAttachmentLimit || item.attachments.length;
  const shown = item.attachments.slice(0, limit);
  const more = item.attachments.length - shown.length;
  return `<div class="ex"><div class="pm">Posted ${esc(item.posted || '')}</div>${item.description ? `<div class="desc">${linkify(item.description)}</div>` : ''}<div class="atts">${shown.map((a) => attachmentCard(a, scenario)).join('')}${more ? `<div class="more">${more} more</div>` : ''}</div><a class="vi" href="./${p.slice(1)}/c/${scenario.course.id}/${item.kind}/${item.id}/details">View instructions</a></div>`;
}

export function classworkPage(scenario) {
  const data = {
    items: scenario.items.map((item) => ({ ...item, rowCollapsed: rowHtml(item, scenario, { expanded: false }), rowExpanded: rowHtml(item, scenario, { expanded: true }) })),
    topics: scenario.topics,
    initialBatch: scenario.initialBatch,
    batchSize: scenario.batchSize,
    bootDelayMs: scenario.bootDelayMs,
    collapsed: scenario.collapsedRows,
    rowNavigates: scenario.rowNavigates,
    prefix: prefix(scenario).slice(1),
    courseId: scenario.course.id,
  };
  const script = `<script>
(() => {
  const data = ${JSON.stringify(data).replace(/</g, '\\u003c')};
  const root = document.getElementById('cw');
  let rendered = 0;
  function sectionFor(topic) {
    if (!topic) return document.getElementById('no-topic');
    const t = data.topics.find((x) => x.name === topic);
    return document.querySelector('[data-topic="' + t.id + '"] ol');
  }
  function renderBatch(n) {
    const end = Math.min(data.items.length, rendered + n);
    for (; rendered < end; rendered++) {
      const item = data.items[rendered];
      const holder = document.createElement('div');
      holder.innerHTML = data.collapsed ? item.rowCollapsed : item.rowExpanded;
      sectionFor(item.topic).appendChild(holder.firstChild);
    }
  }
  function boot() {
    root.innerHTML = '<ol id="no-topic"></ol>' + data.topics.map((t) =>
      '<section class="tp" data-topic="' + t.id + '"><h2><a href="./' + data.prefix + '/w/' + data.courseId + '/tc/' + t.id + '">' + t.name + '</a></h2><div role="button" aria-haspopup="true" aria-label="Topic options">⋮</div><ol></ol></section>').join('');
    renderBatch(data.initialBatch);
  }
  let loading = false;
  function maybeLoadMore() {
    if (loading || rendered >= data.items.length) return;
    if (window.innerHeight + window.scrollY < document.body.scrollHeight - 300) return;
    loading = true;
    const bar = document.getElementById('bar');
    bar.hidden = false;
    setTimeout(() => { renderBatch(data.batchSize); bar.hidden = true; loading = false; }, 400);
  }
  window.addEventListener('scroll', maybeLoadMore, { passive: true });
  window.addEventListener('popstate', () => {
    root.hidden = false;
    const view = document.getElementById('item-view');
    if (view) view.remove();
  });
  document.addEventListener('click', (ev) => {
    const toggle = ev.target.closest('[aria-expanded]');
    if (!toggle) return;
    const li = toggle.closest('li[data-stream-item-id]');
    const item = data.items.find((x) => x.numericId === li.getAttribute('data-stream-item-id'));
    if (data.rowNavigates) {
      history.pushState({}, '', './' + data.prefix + '/c/' + data.courseId + '/' + item.kind + '/' + item.id + '/details');
      root.hidden = true;
      const view = document.createElement('div');
      view.id = 'item-view';
      view.textContent = item.title;
      root.after(view);
      return;
    }
    if (toggle.getAttribute('aria-expanded') === 'true') {
      const fresh = document.createElement('div');
      fresh.innerHTML = item.rowCollapsed;
      li.replaceWith(fresh.firstChild);
    } else {
      toggle.setAttribute('aria-expanded', 'true');
      const bar = document.createElement('div');
      bar.setAttribute('role', 'progressbar');
      li.appendChild(bar);
      setTimeout(() => {
        const fresh = document.createElement('div');
        fresh.innerHTML = item.rowExpanded;
        li.replaceWith(fresh.firstChild);
      }, 250);
    }
  });
  setTimeout(boot, data.bootDelayMs);
})();
</script>`;
  return shell(scenario, {
    title: `${scenario.course.name} - ${scenario.course.section}`,
    active: 'classwork',
    body: `<div class="topics-nav" role="navigation"><a href="./${prefix(scenario).slice(1)}/w/${scenario.course.id}/t/all">All topics</a>${scenario.topics.map((t) => `<a href="./${prefix(scenario).slice(1)}/w/${scenario.course.id}/tc/${t.id}">${esc(t.name)}</a>`).join('')}</div><div id="cw"></div><div id="bar" role="progressbar" hidden>Loading</div><div class="spacer"></div>`,
    script,
  });
}

function postHtml(post, scenario) {
  const comments = (post.comments || [])
    .map((c) => `<div class="cm"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span class="ca">${esc(c.author)}</span><span class="ct">${linkify(c.text)}</span></div>`)
    .join('');
  return `<div class="post" data-stream-item-id="${post.numericId}"><div class="ph"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><div><span>Ms. Smith</span><span>${esc(post.posted)}</span></div><div role="button" aria-haspopup="true" aria-label="Options">⋮</div></div><div class="pt">${linkify(post.text)}</div><div class="atts">${post.attachments.map((a) => attachmentCard(a, scenario)).join('')}</div><div class="pc"><div class="cc">${(post.comments || []).length ? `${post.comments.length} class comment` : 'No class comments'}</div>${comments}<div contenteditable="true" aria-label="Add class comment…"></div></div></div>`;
}

function noticeHtml(item, scenario) {
  const p = prefix(scenario).slice(1);
  const kindWord = { a: 'assignment', m: 'material', sa: 'question' }[item.kind];
  return `<div class="post notice" data-stream-item-id="${item.numericId}"><a href="./${p}/c/${scenario.course.id}/${item.kind}/${item.id}/details"><span>Ms. Smith posted a new ${kindWord}: ${esc(item.title)}</span></a><span>${esc(item.posted)}</span></div>`;
}

export function streamPage(scenario) {
  const posts = [
    ...scenario.announcements.map((post) => postHtml(post, scenario)),
    ...[scenario.items[0], ...scenario.streamOnlyItems].filter(Boolean).map((item) => noticeHtml(item, scenario)),
  ];
  const data = { posts, initialBatch: 3, batchSize: 2, bootDelayMs: scenario.bootDelayMs };
  const script = `<script>
(() => {
  const data = ${JSON.stringify(data).replace(/</g, '\\u003c')};
  let rendered = 0;
  function renderBatch(n) {
    const feed = document.getElementById('feed');
    const end = Math.min(data.posts.length, rendered + n);
    for (; rendered < end; rendered++) feed.insertAdjacentHTML('beforeend', data.posts[rendered]);
  }
  let loading = false;
  window.addEventListener('scroll', () => {
    if (loading || rendered >= data.posts.length) return;
    if (window.innerHeight + window.scrollY < document.body.scrollHeight - 300) return;
    loading = true;
    document.getElementById('bar').hidden = false;
    setTimeout(() => { renderBatch(data.batchSize); document.getElementById('bar').hidden = true; loading = false; }, 400);
  }, { passive: true });
  setTimeout(() => renderBatch(data.initialBatch), data.bootDelayMs);
})();
</script>`;
  const c = scenario.course;
  return shell(scenario, {
    title: `${c.name} - ${c.section}`,
    active: 'stream',
    body: `<div class="banner"><h1>${esc(c.name)}</h1><div>${esc(c.section)}</div><div>Subject: English</div><div>Room 204</div><div>Class code</div><div>abc1234</div></div><div class="composer"><div role="button">Announce something to your class</div></div><div id="feed" class="feed"></div><div id="bar" role="progressbar" hidden>Loading</div><div class="spacer"></div>`,
    script,
  });
}

function yourWorkHtml(item, scenario) {
  if (!item.yourWork) return '';
  return `<div class="yw"><h2>Your work</h2><span>Assigned</span>${item.yourWork.map((a) => attachmentCard(a, scenario, { driveIdAttr: true }).replace('</a></div>', '</a><div role="button" aria-label="Remove attachment">×</div></div>')).join('')}<div role="button">Turn in</div></div><div class="pvc"><span>Private comments</span><div contenteditable="true" aria-label="Add private comment…"></div></div>`;
}

function detailInner(item, scenario) {
  const icon = { a: 'assignment', m: 'book', sa: 'help_outline' }[item.kind] || 'assignment';
  const comments = (item.comments || [])
    .map((c) => `<div class="cm"><img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><span class="ca">${esc(c.author)}</span><span class="ct">${linkify(c.text)}</span></div>`)
    .join('');
  const header = `<div class="hdr"><i aria-hidden="true">${icon}</i><h1 class="ttl">${esc(item.title)}</h1><div class="by">Ms. Smith • ${esc(item.posted || '')}</div>${item.points ? `<div class="pts">${esc(item.points)}</div>` : ''}${item.due ? `<div class="due">${esc(item.due)}</div>` : ''}<div role="button" aria-haspopup="true" aria-label="More options">⋮</div></div>`;
  const body = item.description ? `<div class="body"><span class="desc">${linkify(item.description)}</span></div>` : '';
  const atts = `<div class="atts">${item.attachments.map((a) => attachmentCard(a, scenario, { driveIdAttr: true })).join('')}</div>`;
  const cmts = `<div class="cmts"><div class="ch"><span>${(item.comments || []).length ? `${item.comments.length} class comment` : 'Class comments'}</span></div>${comments}<div contenteditable="true" aria-label="Add class comment…"></div></div>`;
  const inside = item.yourWorkInsideRoot ? `<div class="side">${yourWorkHtml(item, scenario)}</div>` : '';
  const outside = item.yourWorkInsideRoot ? '' : `<aside class="side-col">${yourWorkHtml(item, scenario)}</aside>`;
  return `<div class="two-col"><div class="main-col" data-stream-item-id="${item.numericId}">${header}${body}${atts}${cmts}${inside}</div>${outside}</div>`;
}

export function detailPage(item, scenario) {
  if (scenario.detailMode === 'csr') {
    const html = detailInner(item, scenario);
    return shell(scenario, {
      title: item.title,
      body: '<div id="app"><div role="progressbar">Loading</div></div>',
      script: `<script>setTimeout(() => { document.getElementById('app').innerHTML = ${JSON.stringify(html).replace(/</g, '\\u003c')}; }, 300);</script>`,
    });
  }
  return shell(scenario, { title: item.title, body: detailInner(item, scenario) });
}

export function announcementPage(post, scenario) {
  return shell(scenario, { title: scenario.course.name, body: `<div class="feed">${postHtml(post, scenario)}</div>` });
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

function html(body, status = 200) {
  return { status, headers: { 'content-type': 'text/html; charset=utf-8' }, body };
}

function fileResponse(file, filenameOverride) {
  const name = filenameOverride || file.name;
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return {
    status: 200,
    headers: {
      'content-type': file.type,
      'content-length': String(file.bytes.length),
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
    body: file.bytes,
  };
}

/**
 * @returns {(req:{method:string,url:string}) => Promise<{status:number,headers:object,body:(string|Buffer)}>}
 */
export function createHandler(scenario, log = []) {
  const files = fileCatalog(scenario);
  const flaky = new Map();
  const allItems = [...scenario.items, ...scenario.streamOnlyItems];
  return async ({ url }) => {
    const u = new URL(url);
    log.push(`${u.host}${u.pathname}${u.search}`);
    const p = prefix(scenario);
    if (u.host === 'classroom.google.com') {
      const path = u.pathname.replace(/\/$/, '');
      if (path === `${p}/w/${scenario.course.id}/t/all`) return html(classworkPage(scenario));
      if (path === `${p}/c/${scenario.course.id}`) return html(streamPage(scenario));
      const m = new RegExp(`^${p}/c/${scenario.course.id}/(a|m|sa|mc)/([^/]+)/details$`).exec(path);
      if (m) {
        const item = allItems.find((i) => i.id === m[2]);
        if (!item || item.kind !== m[1]) return html(shell(scenario, { title: 'Not found', body: '<p>This item was not found.</p>' }), 404);
        return html(detailPage(item, scenario));
      }
      const a = new RegExp(`^${p}/c/${scenario.course.id}/p/([^/]+)$`).exec(path);
      if (a) {
        const post = scenario.announcements.find((x) => x.id === a[1]);
        if (post) return html(announcementPage(post, scenario));
      }
      if (path === '' || path === p || path === `${p}/h`) return html(shell(scenario, { title: 'Classes', body: '<p>Your classes</p>' }));
      return html(shell(scenario, { title: 'Not found', body: '<p>Not found</p>' }), 404);
    }

    if (u.host === 'drive.usercontent.google.com' || (u.host === 'drive.google.com' && u.pathname === '/uc')) {
      const id = u.searchParams.get('id');
      const file = files.get(id);
      if (u.searchParams.get('authuser') !== String(scenario.authuser)) {
        return html('<html><title>Sign in - Google Accounts</title><a href="https://accounts.google.com/ServiceLogin">Sign in</a></html>');
      }
      if (!file) return { status: 404, headers: { 'content-type': 'text/html' }, body: '<html>Not Found</html>' };
      if (id.startsWith('FORBIDDEN')) return { status: 403, headers: { 'content-type': 'text/html' }, body: '<html>You need access</html>' };
      if (id.startsWith('VIRUSSCAN') && !u.searchParams.get('uuid')) {
        return html(`<html><head><title>Google Drive - Virus scan warning</title></head><body><p>Google Drive can't scan this file for viruses.</p><form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="submit" value="Download anyway"><input type="hidden" name="id" value="${id}"><input type="hidden" name="export" value="download"><input type="hidden" name="authuser" value="${scenario.authuser}"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="mock-uuid-1"></form></body></html>`);
      }
      if (id.startsWith('FLAKY')) {
        const n = (flaky.get(id) || 0) + 1;
        flaky.set(id, n);
        if (n === 1) return { status: 503, headers: { 'content-type': 'text/html' }, body: 'Service unavailable' };
      }
      return fileResponse(file);
    }

    if (u.host === 'docs.google.com') {
      const m = /^\/(document|spreadsheets|presentation)\/d\/([^/]+)\/export(?:\/(\w+))?$/.exec(u.pathname);
      if (m) {
        const format = m[3] || u.searchParams.get('format');
        const doc = allItems.flatMap((i) => i.attachments).find((a) => a.id === m[2]) || (m[2].startsWith('DOCLINK') ? { name: 'Extra notes' } : null);
        if (!doc) return { status: 404, headers: { 'content-type': 'text/html' }, body: 'Not found' };
        const types = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', pdf: 'application/pdf' };
        return fileResponse({ name: `${doc.name}.${format}`, type: types[format] || 'application/octet-stream', bytes: fileBytes(`${m[2]}-${format}`, 1500) });
      }
      return { status: 404, headers: { 'content-type': 'text/html' }, body: 'Not found' };
    }

    return { status: 404, headers: { 'content-type': 'text/plain' }, body: 'Not mocked' };
  };
}

export const MOCK_HOSTS = ['classroom.google.com', 'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'];

export function urls(scenario) {
  const p = prefix(scenario);
  return {
    classwork: `${ORIGIN}${p}/w/${scenario.course.id}/t/all`,
    stream: `${ORIGIN}${p}/c/${scenario.course.id}`,
    detail: (item) => `${ORIGIN}${p}/c/${scenario.course.id}/${item.kind}/${item.id}/details`,
  };
}

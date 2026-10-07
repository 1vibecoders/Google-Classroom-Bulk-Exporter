// What discovery should produce for a mock scenario, and helpers to run the
// mock network in-process.
import { createHandler } from '../mock/classroom-mock.mjs';
import { GCX } from './content.mjs';

const TYPE = { a: 'assignment', m: 'material', sa: 'question', mc: 'question', p: 'announcement' };

function hrefFor(att, scenario) {
  const au = scenario.authuser;
  return {
    drive: `https://drive.google.com/file/d/${att.id}/view?usp=classroom_web&authuser=${au}`,
    doc: `https://docs.google.com/document/d/${att.id}/edit?usp=classroom_web&authuser=${au}`,
    sheet: `https://docs.google.com/spreadsheets/d/${att.id}/edit?usp=classroom_web&authuser=${au}`,
    slides: `https://docs.google.com/presentation/d/${att.id}/edit?usp=classroom_web&authuser=${au}`,
    form: `https://docs.google.com/forms/d/${att.id}/viewform?usp=classroom_web`,
    folder: `https://drive.google.com/drive/folders/${att.id}?usp=classroom_web`,
    youtube: `https://www.youtube.com/watch?v=${att.id}`,
  }[att.type] || att.url;
}

function resourceFor(att, scenario, source = 'attachment') {
  return { ...GCX.resources.classify(hrefFor(att, scenario)), title: att.name, typeLabel: att.label, source };
}

/** A snapshot equivalent to what discovery returns for `scenario`. */
export function expectedSnapshot(scenario, { includeAnnouncements = true } = {}) {
  const items = [...scenario.items, ...scenario.streamOnlyItems].map((item, order) => {
    const resources = item.attachments.map((a) => resourceFor(a, scenario));
    for (const m of (item.description || '').matchAll(/https?:\/\/\S+/g)) {
      resources.push({ ...GCX.resources.classify(m[0]), title: m[0], typeLabel: null, source: 'description-link' });
    }
    return {
      key: item.numericId,
      id: item.id,
      type: TYPE[item.kind],
      kind: item.kind,
      title: item.title,
      topic: item.topic,
      description: item.description || '',
      classroomUrl: `https://classroom.google.com/u/${scenario.authuser}/c/${scenario.course.id}/${item.kind}/${item.id}/details`,
      meta: { dueText: item.due ? item.due.replace(/^Due /, '') : null, pointsText: item.points || null, postedText: item.posted || null },
      resources,
      order,
      sources: ['test'],
      warnings: [],
    };
  });
  if (includeAnnouncements) {
    for (const post of scenario.announcements) {
      items.push({
        key: post.numericId,
        id: post.id,
        type: 'announcement',
        kind: 'p',
        title: post.text.split('\n')[0],
        topic: null,
        description: post.text,
        classroomUrl: `https://classroom.google.com/u/${scenario.authuser}/c/${scenario.course.id}/p/${post.id}`,
        meta: { postedText: post.posted },
        resources: post.attachments.map((a) => resourceFor(a, scenario)),
        order: items.length,
        sources: ['test'],
        warnings: [],
      });
    }
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    classInfo: {
      courseId: scenario.course.id,
      authuser: scenario.authuser,
      prefix: `/u/${scenario.authuser}`,
      name: scenario.course.name,
      section: scenario.course.section,
      bannerLines: ['Subject: English', 'Room 204'],
      url: `https://classroom.google.com/u/${scenario.authuser}/c/${scenario.course.id}`,
    },
    topics: scenario.topics.map((t) => ({ id: t.id, name: t.name })),
    items,
    warnings: [],
    stats: { detailStrategy: 'fetch' },
  };
}

/** Replace globalThis.fetch with the mock network; returns a restore function. */
export function installMockFetch(scenario, log = []) {
  const handler = createHandler(scenario, log);
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (init.signal && init.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const r = await handler({ method: 'GET', url: String(url) });
    const res = new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
    Object.defineProperty(res, 'url', { value: String(url) });
    return res;
  };
  return () => {
    globalThis.fetch = original;
  };
}

// App shell: header with navigation, the prominent Import button, Export and
// "+ New"; the routed page; dialogs and notifications.
import { useCallback } from 'react';
import { StoreProvider, useDoc, useStore } from './state/store';
import { ConfirmProvider, Toasts } from './ui/common';
import { EditorProvider, useEditors } from './editors/EditorHost';
import { Icon } from './ui/Icon';
import { Menu } from './ui/Menu';
import { routeToHash, useRoute, type Route } from './router';
import { createExport, rememberExportId } from './lib/exportSchedule';
import { downloadText } from './lib/download';
import { nowLocal, todayLocal } from './lib/time';
import { DayView } from './views/DayView';
import { WeekView } from './views/WeekView';
import { AssignmentsView } from './views/AssignmentsView';
import { ClassesView } from './views/ClassesView';
import { CommitmentsView } from './views/CommitmentsView';
import { ImportView } from './views/ImportView';
import { SettingsView } from './views/SettingsView';
import type { AppState } from './state/reducer';

export function App({ initialState }: { initialState?: AppState }) {
  return (
    <StoreProvider initial={initialState}>
      <ConfirmProvider>
        <EditorProvider>
          <Shell />
        </EditorProvider>
      </ConfirmProvider>
    </StoreProvider>
  );
}

const NAV: Array<{ label: string; icon: Parameters<typeof Icon>[0]['name']; route: (r: Route) => Route; match: Route['name'][] }> = [
  { label: 'Day', icon: 'day', route: (r) => ({ name: 'day', date: 'date' in r ? r.date : todayLocal() }), match: ['day'] },
  { label: 'Week', icon: 'week', route: (r) => ({ name: 'week', date: 'date' in r ? r.date : todayLocal() }), match: ['week'] },
  { label: 'Assignments', icon: 'list', route: () => ({ name: 'assignments' }), match: ['assignments'] },
  { label: 'Classes', icon: 'book', route: () => ({ name: 'classes' }), match: ['classes'] },
  { label: 'Commitments', icon: 'clock', route: () => ({ name: 'commitments' }), match: ['commitments'] },
];

function Shell() {
  const route = useRoute();
  const doc = useDoc();
  const { notify, storageProblem } = useStore();
  const editors = useEditors();

  const exportNow = useCallback(() => {
    const result = createExport(doc, nowLocal());
    downloadText(result.fileName, result.json);
    rememberExportId(result.exportId);
    if (result.problems.length > 0) {
      const first = result.problems[0];
      notify(`Schedule exported, but the file has ${result.problems.length} problem(s) and may not import again (${first.path}: ${first.message}).`, { tone: 'warning' });
    } else {
      notify('Schedule exported. Give this file to /academic-schedule or keep it as a backup.', { tone: 'success' });
    }
  }, [doc, notify]);

  const contextDate = 'date' in route ? route.date : todayLocal();

  return (
    <div className="app">
      <a className="visually-hidden" href="#main">
        Skip to content
      </a>
      <header className="app-header no-print">
        <a className="brand" href={routeToHash({ name: 'day', date: todayLocal() })} aria-label="Academic Scheduler — today">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="calendar" size={16} />
          </span>
          <span className="brand-name">Academic Scheduler</span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <a key={item.label} href={routeToHash(item.route(route))} aria-current={item.match.includes(route.name) ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <a className={`btn primary ${route.name === 'import' ? 'active' : ''}`} href={routeToHash({ name: 'import' })} aria-current={route.name === 'import' ? 'page' : undefined}>
            <Icon name="upload" />
            <span>Import</span>
          </a>
          <button type="button" className="btn" onClick={exportNow}>
            <Icon name="download" />
            <span className="hide-narrow">Export</span>
          </button>
          <Menu
            label={
              <>
                <Icon name="plus" />
                <span className="hide-narrow">New</span>
              </>
            }
            ariaLabel="Create new"
            items={[
              { label: 'Assignment', icon: 'list', onSelect: () => editors.open({ kind: 'assignment' }) },
              { label: 'Scheduled work block', icon: 'clock', onSelect: () => editors.open({ kind: 'block', initial: { start: `${contextDate}T16:00:00`, end: `${contextDate}T17:00:00` } }) },
              { label: 'Class', icon: 'book', onSelect: () => editors.open({ kind: 'class' }) },
              { label: 'Event or commitment', icon: 'calendar', onSelect: () => editors.open({ kind: 'event' }) },
              { label: 'Study time', icon: 'target', onSelect: () => editors.open({ kind: 'availability' }) },
            ]}
          />
          <a className="btn ghost icon" href={routeToHash({ name: 'settings' })} aria-label="Settings and data" aria-current={route.name === 'settings' ? 'page' : undefined} title="Settings and data">
            <Icon name="settings" />
          </a>
        </div>
      </header>
      {storageProblem ? (
        <div className="banner warning no-print" role="alert">
          <Icon name="warning" /> {storageProblem}
        </div>
      ) : null}
      <main id="main" className="app-main" tabIndex={-1}>
        <Page route={route} />
      </main>
      <Toasts />
    </div>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'day':
      return <DayView date={route.date} />;
    case 'week':
      return <WeekView date={route.date} />;
    case 'assignments':
      return <AssignmentsView classId={route.classId} />;
    case 'classes':
      return <ClassesView />;
    case 'commitments':
      return <CommitmentsView />;
    case 'import':
      return <ImportView />;
    case 'settings':
      return <SettingsView />;
  }
}

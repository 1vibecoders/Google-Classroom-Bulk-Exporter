// App shell: header with navigation, the prominent Import button, Export and
// "+ New"; the routed page; dialogs and notifications.
import { useCallback, useEffect, useMemo } from 'react';
import { StoreProvider, useDoc, useStore } from './state/store';
import { ConfirmProvider, Toasts } from './ui/common';
import { EditorProvider, useEditors } from './editors/EditorHost';
import { Icon } from './ui/Icon';
import { Menu } from './ui/Menu';
import { navigate, routeToHash, useRoute, type Route } from './router';
import { onboardingNeeds, setupInProgress } from './lib/onboarding';
import { OnboardingView } from './views/OnboardingView';
import { createExport, rememberExportId } from './lib/exportSchedule';
import { downloadText } from './lib/download';
import { nowLocal, todayLocal } from './lib/time';
import { DayView } from './views/DayView';
import { WeekView } from './views/WeekView';
import { AssignmentsView } from './views/AssignmentsView';
import { ClassesView } from './views/ClassesView';
import { CommitmentsView } from './views/CommitmentsView';
import { ImportView } from './views/ImportView';
import { useExtensionImport } from './views/import/useExtensionImport';
import { ReviewView } from './views/ReviewView';
import { TestsView } from './views/TestsView';
import { LatticeMark, Wordmark } from './ui/LatticeMark';
import { useAiAutoApply } from './views/review/useAiAutoApply';
import { reviewItems } from './lib/ai/proposals';
import { useNow } from './ui/hooks';
import { atRiskWork, brokenSessions } from './lib/repair';
import { useAiStatus } from './state/aiStore';
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
  { label: 'Tests', icon: 'target', route: () => ({ name: 'tests' }), match: ['tests'] },
  { label: 'Classes', icon: 'book', route: () => ({ name: 'classes' }), match: ['classes'] },
  { label: 'Commitments', icon: 'clock', route: () => ({ name: 'commitments' }), match: ['commitments'] },
];

// Pages that stay open while onboarding is incomplete: Import and Settings can fill in the required answers.
const SETUP_ROUTES: Route['name'][] = ['welcome', 'import', 'settings'];

function Shell() {
  const requested = useRoute();
  const doc = useDoc();
  const needsSetup = onboardingNeeds(doc).length > 0 || setupInProgress();
  // Back from Google sign-in during setup: return to the wizard, keeping the sign-in result for its sync card.
  const signInReturn = requested.name === 'settings' && setupInProgress() ? /[?&]google=\w+/.exec(window.location.hash)?.[0] : undefined;
  const route: Route = (needsSetup && !SETUP_ROUTES.includes(requested.name)) || signInReturn ? { name: 'welcome' } : requested;
  // A new page starts at its top (otherwise a phone keeps the last page's scroll position); moving between days keeps it.
  useEffect(() => {
    (document.scrollingElement ?? document.documentElement).scrollTop = 0;
  }, [route.name]);
  useEffect(() => {
    if (route.name === requested.name) return;
    if (signInReturn) window.location.replace(`#/welcome?${signInReturn.slice(1)}`);
    else navigate(route);
  }, [route, requested.name, signInReturn]);
  const { notify, storageProblem } = useStore();
  const editors = useEditors();
  useExtensionImport();
  useAiAutoApply();
  const ai = useAiStatus();
  const now = useNow();
  // Review also lists schedule problems (§ 27.5), so it is always in the menu.
  const problems = useMemo(() => brokenSessions(doc, now).length + atRiskWork(doc, now).length, [doc, now]);
  const toReview = (ai?.configured ? reviewItems(doc, ai.proposals).length : 0) + problems;

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
        <a className="brand" href={routeToHash({ name: 'day', date: todayLocal() })} aria-label="Lattice Study, today">
          <LatticeMark size={28} />
          <span className="brand-name">
            <Wordmark />
          </span>
        </a>
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <a key={item.label} href={routeToHash(item.route(route))} aria-current={item.match.includes(route.name) ? 'page' : undefined}>
              {item.label}
            </a>
          ))}
          <a href={routeToHash({ name: 'review' })} aria-current={route.name === 'review' ? 'page' : undefined}>
            Review{toReview ? <span className="badge"> {toReview}<span className="visually-hidden"> to review</span></span> : null}
          </a>
        </nav>
        <div className="header-actions">
          <a className={`btn primary ${route.name === 'import' ? 'active' : ''}`} href={routeToHash({ name: 'import' })} aria-current={route.name === 'import' ? 'page' : undefined} aria-label="Import">
            <Icon name="upload" />
            <span className="hide-narrow">Import</span>
          </a>
          <button type="button" className="btn" onClick={exportNow} aria-label="Export">
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
    case 'review':
      return <ReviewView />;
    case 'tests':
      return <TestsView />;
    case 'welcome':
      return <OnboardingView />;
  }
}

// Day view — the home screen: "What am I supposed to do, and when?"
// A vertical timeline (or a list) of the day with busy commitments, free study
// time, scheduled work and breaks, the day's due dates and assessments, a
// summary of planned work against free time, and the day's issues.
import { useMemo } from 'react';
import { resolveSettings } from '../model/constants';
import { addDays, formatDateLong, isValidDate } from '../lib/time';
import { navigate, routeToHash } from '../router';
import { useStore } from '../state/store';
import { useNow } from '../ui/hooks';
import { Agenda } from './timeline/Agenda';
import { DayIssues } from './timeline/DayIssues';
import { DayStrip } from './timeline/DayStrip';
import { DaySummary, UnmarkedSessions } from './timeline/DaySummary';
import { GettingStarted } from './timeline/GettingStarted';
import { Timeline } from './timeline/Timeline';
import { ViewToolbar, useViewMode } from './timeline/ViewToolbar';
import { useDayModels } from './timeline/modelCache';
import { relativeDayLabel, suggestNewSpan, unmarkedPastBlocks } from './timeline/logic';
import { useTimelineActions } from './timeline/useTimelineActions';
import '../styles/timeline.css';

export function DayView({ date }: { date: string }) {
  const { state } = useStore();
  const doc = state.doc;
  const now = useNow();
  const today = now.slice(0, 10);
  const day = isValidDate(date) ? date : today;
  const settings = useMemo(() => resolveSettings(doc.settings), [doc.settings]);
  const [model] = useDayModels(doc, day, 1);
  const [mode, setMode] = useViewMode('day');
  const actions = useTimelineActions();
  const unmarked = useMemo(() => (model ? unmarkedPastBlocks(model, now) : []), [model, now]);

  if (!model) return null;
  const title = formatDateLong(day, Number(today.slice(0, 4)));
  const go = (next: string) => navigate({ name: 'day', date: next });
  const relative = relativeDayLabel(day, today);
  const nothingToday = model.blocks.length === 0 && model.events.length === 0 && model.allDayEvents.length === 0 && model.markers.length === 0;

  return (
    <div className="day-view">
      <ViewToolbar
        title={title}
        subtitle={
          <>
            {relative}
            {relative ? ' · ' : ''}
            <a href={routeToHash({ name: 'week', date: day })}>See the week</a>
          </>
        }
        prevLabel="Previous day"
        nextLabel="Next day"
        todayLabel="Today"
        isCurrent={day === today}
        onPrev={() => go(addDays(day, -1))}
        onNext={() => go(addDays(day, 1))}
        onToday={() => go(today)}
        date={day}
        dateLabel="Go to date"
        onDate={go}
        mode={mode}
        onMode={setMode}
        onAdd={() => actions.createBlock(day, suggestNewSpan(model, now))}
        addLabel="Add work"
      />

      <GettingStarted doc={doc} />

      <div className={`day-layout${mode === 'list' ? ' is-list' : ''}`}>
        <div className="day-main">
          <DayStrip model={model} onOpenAssignment={actions.openAssignment} onOpenEvent={actions.openEvent} />
          {mode === 'timeline' ? (
            <>
              <div className="card tl-card">
                <Timeline
                  days={[model]}
                  now={now}
                  label={`Timeline for ${title}`}
                  onOpenBlock={actions.openBlock}
                  onOpenEvent={actions.openEvent}
                  onCreate={actions.createBlock}
                  onMoveBlock={actions.moveBlock}
                />
              </div>
              <p className="tl-help muted small no-print">
                Drag a block to move it, or its bottom edge to change its length (5-minute steps; Esc cancels). Click empty time to add work. On a touch screen,
                press and hold a block, or use its grip. Keyboard: focus a block and press Enter, or Alt+Up/Down to move it.
              </p>
            </>
          ) : (
            <section className="card agenda-card" aria-label={`Schedule for ${title}`}>
              <div className="card-body">
                <Agenda
                  model={model}
                  now={now}
                  actions={actions}
                  label={`Schedule for ${title}`}
                  emptyText={
                    nothingToday && !model.availabilityDefined
                      ? 'Nothing scheduled on this day. Use “Add work” to place a work block.'
                      : 'Nothing scheduled at a set time on this day.'
                  }
                />
              </div>
            </section>
          )}
        </div>

        <aside className="day-side" aria-label="Day overview">
          <DaySummary model={model} maxDaily={settings.maxDailyStudyMinutes} now={now} onAddStudyTime={actions.addStudyTime} />
          <UnmarkedSessions blocks={unmarked} onStatus={actions.setBlockStatus} onOpen={actions.openBlock} />
          <DayIssues doc={doc} issues={model.issues} onStatus={actions.setIssueStatus} onOpenItem={actions.openItem} title="Issues for this day" />
          {mode === 'timeline' ? (
            <section className="card side-agenda" aria-labelledby="side-agenda-title">
              <div className="card-header">
                <h2 id="side-agenda-title">In order</h2>
              </div>
              <div className="card-body">
                <Agenda model={model} now={now} actions={actions} label={`Schedule for ${title}, in order`} showDescriptions={false} emptyText="Nothing scheduled at a set time." />
              </div>
            </section>
          ) : null}
        </aside>
      </div>
      {actions.dialog}
    </div>
  );
}

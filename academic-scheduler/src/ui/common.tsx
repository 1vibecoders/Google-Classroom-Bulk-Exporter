// Small shared display components.
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ASSIGNMENT_TYPE_LABELS, ISSUE_KIND_LABELS, PRIORITY_LABELS, WORK_STATUS_LABELS } from '../model/constants';
import type { AssignmentType, Issue, Priority, WorkStatus } from '../model/types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { useStore } from '../state/store';

export function ClassChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="class-chip">
      <span className="class-dot" style={{ background: color }} aria-hidden="true" />
      {name}
    </span>
  );
}

export function StatusBadge({ status }: { status: WorkStatus }) {
  const tone = status === 'done' ? 'success' : status === 'in_progress' ? 'accent' : status === 'cancelled' ? '' : '';
  return <span className={`badge ${tone}`}>{WORK_STATUS_LABELS[status]}</span>;
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const tone = priority === 'urgent' ? 'danger' : priority === 'high' ? 'warning' : '';
  return <span className={`badge ${tone}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function TypeBadge({ type }: { type: AssignmentType }) {
  return <span className="badge">{ASSIGNMENT_TYPE_LABELS[type]}</span>;
}

export function IssueList({ issues }: { issues?: Issue[] }) {
  if (!issues || !issues.length) return null;
  return (
    <ul className="stack" style={{ gap: 4, listStyle: 'none', padding: 0, margin: 0 }}>
      {issues.map((issue, i) => (
        <li key={i} className="issue">
          <Icon name="warning" size={14} />
          <span>
            <strong>{ISSUE_KIND_LABELS[issue.kind]}:</strong> {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <div>{children}</div> : null}
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone || ''}`}>
          <span className="msg">{t.message}</span>
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          ) : null}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation dialogs: const confirm = useConfirm(); if (await confirm({...})) …
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((options) => new Promise((resolve) => setPending({ ...options, resolve })), []);
  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <Modal
          title={pending.title}
          size="narrow"
          onClose={() => close(false)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => close(false)}>
                Cancel
              </button>
              <button type="button" className={`btn ${pending.danger ? 'danger' : 'primary'}`} onClick={() => close(true)} autoFocus>
                {pending.confirmLabel || 'OK'}
              </button>
            </>
          }
        >
          <div>{pending.message}</div>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return fn;
}

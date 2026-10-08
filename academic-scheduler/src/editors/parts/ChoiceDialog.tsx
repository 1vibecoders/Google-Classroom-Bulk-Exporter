// A confirmation with more than one way to proceed (e.g. delete a class
// only, or the class with its assignments and events). Cancel is always
// offered and is the safe default.
import type { ReactNode } from 'react';
import { Modal } from '../../ui/Modal';

export interface Choice<T extends string> {
  value: T;
  label: string;
  danger?: boolean;
  primary?: boolean;
}

export function ChoiceDialog<T extends string>({
  title,
  children,
  choices,
  onChoose,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  choices: Array<Choice<T>>;
  onChoose: (value: T) => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      size="narrow"
      onClose={onCancel}
      footer={
        <div className="ed-choice-buttons">
          <button type="button" className="btn" onClick={onCancel} autoFocus>
            Cancel
          </button>
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              className={`btn ${choice.danger ? 'danger' : choice.primary ? 'primary' : ''}`}
              onClick={() => onChoose(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="stack">{children}</div>
    </Modal>
  );
}

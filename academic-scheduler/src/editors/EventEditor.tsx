// Placeholder: replaced by the real event editor.
import type { ScheduleEvent } from '../model/types';
import type { EditorProps } from './EditorHost';
import { Modal } from '../ui/Modal';

export function EventEditor({ id, onClose }: EditorProps<ScheduleEvent>) {
  return (
    <Modal title={id ? 'Edit event' : 'New event'} onClose={onClose}>
      <p>Not implemented yet.</p>
    </Modal>
  );
}

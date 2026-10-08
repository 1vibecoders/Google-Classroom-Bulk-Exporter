// Placeholder: replaced by the real scheduled work block editor.
import type { ScheduleBlock } from '../model/types';
import type { EditorProps } from './EditorHost';
import { Modal } from '../ui/Modal';

export function BlockEditor({ id, onClose }: EditorProps<ScheduleBlock>) {
  return (
    <Modal title={id ? 'Edit scheduled work block' : 'New scheduled work block'} onClose={onClose}>
      <p>Not implemented yet.</p>
    </Modal>
  );
}

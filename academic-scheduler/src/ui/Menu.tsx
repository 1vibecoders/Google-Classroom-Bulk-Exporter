// Simple accessible dropdown menu (button + list of actions).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: Parameters<typeof Icon>[0]['name'];
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ label, items, buttonClass = 'btn', align = 'right', ariaLabel }: { label: ReactNode; items: MenuItem[]; buttonClass?: string; align?: 'left' | 'right'; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Focus the first item for keyboard users.
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onMenuKey = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label={ariaLabel} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open ? (
        <div className={`menu-list ${align}`} role="menu" id={menuId} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? 'danger' : ''}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

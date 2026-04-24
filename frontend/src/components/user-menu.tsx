import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import type { AuthUser } from '../api/auth';
import './user-menu.css';

interface Props {
  user: AuthUser | null;
  onSupport: () => void;
  onHistory: () => void;
  /** Передаётся только если у пользователя роль admin; иначе пункт «Админка»
   *  в меню не рисуется (и клиентский доступ к `/admin` тоже защищён
   *  `AdminRoute`, так что прямой URL не откроет страницу обычному юзеру). */
  onAdmin?: () => void;
}

export function UserMenu({ user, onSupport, onHistory, onAdmin }: Props): JSX.Element | null {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape — same interaction model as the
  // browser's own menus. Capture phase so a click on a nested <MenuItem>
  // still reaches onSelect before the dropdown tears down.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const pick = (fn: () => void): (() => void) => () => {
    setOpen(false);
    fn();
  };

  async function handleLogout(): Promise<void> {
    setOpen(false);
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu__button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {user.username}
        <span className="user-menu__caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="user-menu__dropdown" role="menu">
          <button type="button" className="user-menu__item" role="menuitem" onClick={pick(onSupport)}>
            Тех. поддержка
          </button>
          <button type="button" className="user-menu__item" role="menuitem" onClick={pick(onHistory)}>
            Моя история
          </button>
          {onAdmin && (
            <button
              type="button"
              className="user-menu__item"
              role="menuitem"
              onClick={pick(onAdmin)}
            >
              Админка
            </button>
          )}
          <div className="user-menu__divider" role="separator" />
          <button
            type="button"
            className="user-menu__item user-menu__item--danger"
            role="menuitem"
            onClick={handleLogout}
          >
            Выйти
          </button>
        </div>
      )}
    </div>
  );
}

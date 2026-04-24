import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/use-auth';
import { UserMenu } from './user-menu';
import { SupportModal } from './support-modal';
import { HistoryDrawer } from './history-drawer';
import './header.css';

export function Header(): JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [supportOpen, setSupportOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <header className="app-header">
      <Link to="/" className="app-header__brand">
        Mapvideo
      </Link>
      <div className="app-header__spacer" />
      <UserMenu
        user={user}
        onSupport={() => setSupportOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        onAdmin={user?.role === 'admin' ? () => navigate('/admin') : undefined}
      />
      {supportOpen && <SupportModal onClose={() => setSupportOpen(false)} />}
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </header>
  );
}

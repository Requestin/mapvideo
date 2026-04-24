import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './hooks/use-auth';
import { ToastProvider } from './components/toast-provider';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element missing');

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);

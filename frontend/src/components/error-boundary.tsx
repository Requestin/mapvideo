import { Component, type ErrorInfo, type ReactNode } from 'react';

// Без ErrorBoundary любая ошибка в render/useEffect рендерит пустой <root> —
// пользователь видит чёрный экран без единого намёка, что пошло не так.
// Обёртка ловит ошибку, пишет её в консоль и показывает читаемую заглушку
// с самой ошибкой + кнопкой «перезагрузить», чтобы сессию можно было
// спасти без F12.

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Логируем с полным стеком компонентов — удобно при разборе полётов.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          padding: 24,
          margin: 24,
          maxWidth: 720,
          border: '1px solid #c85050',
          borderRadius: 8,
          background: '#2a1212',
          color: '#fff',
          fontFamily: 'monospace',
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        <h2 style={{ margin: '0 0 12px 0', color: '#ff8080' }}>
          Редактор упал: {error.name}
        </h2>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: '0 0 16px 0',
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null });
          }}
          style={{
            padding: '6px 14px',
            marginRight: 8,
            background: '#3d8bff',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Повторить
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: '6px 14px',
            background: '#444',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Перезагрузить страницу
        </button>
      </div>
    );
  }
}

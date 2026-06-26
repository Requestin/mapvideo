import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoryDrawer } from '../src/components/history-drawer';

vi.mock('../src/api/history', () => ({
  getHistory: vi.fn(),
}));

import { getHistory } from '../src/api/history';

const mockedGetHistory = vi.mocked(getHistory);

describe('HistoryDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and renders history rows when drawer opens', async () => {
    mockedGetHistory.mockResolvedValueOnce([
      {
        id: 'job-1',
        createdAt: '2026-06-26T07:00:00.000Z',
        updatedAt: '2026-06-26T07:10:00.000Z',
        downloadUrl: '/api/history/job-1/download',
        thumbnailUrl: '/api/history/job-1/thumbnail',
      },
    ]);

    render(<HistoryDrawer open onClose={() => undefined} />);

    await waitFor(() => {
      expect(mockedGetHistory).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText(/Видео/i)).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Скачать' });
    expect(download).toHaveAttribute('href', '/api/history/job-1/download');
    expect(screen.getByAltText('Миниатюра видео')).toHaveAttribute(
      'src',
      '/api/history/job-1/thumbnail'
    );
  });

  it('shows empty state when backend returns no items', async () => {
    mockedGetHistory.mockResolvedValueOnce([]);

    render(<HistoryDrawer open onClose={() => undefined} />);

    await waitFor(() => {
      expect(screen.getByText('Вы ещё не создавали видео')).toBeInTheDocument();
    });
  });

  it('does not fetch while closed and fetches after open toggle', async () => {
    mockedGetHistory.mockResolvedValueOnce([]);

    const { rerender } = render(<HistoryDrawer open={false} onClose={() => undefined} />);
    expect(mockedGetHistory).toHaveBeenCalledTimes(0);

    rerender(<HistoryDrawer open onClose={() => undefined} />);
    await waitFor(() => {
      expect(mockedGetHistory).toHaveBeenCalledTimes(1);
    });
  });
});


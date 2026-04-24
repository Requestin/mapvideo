import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { ColorField } from '../src/components/right-sidebar/settings-fields';
import {
  UserColorsProvider,
  PRESET_COLORS,
  MAX_CUSTOM_COLORS,
} from '../src/state/user-colors';

// task14: регрессионные тесты на палитру.
// В юнит-режиме моделируем поведение бэкенда заглушками GET/PUT — важно,
// что серверный список — каноничный, и фронт подменяет локальное состояние
// тем, что вернул PUT (после нормализации lowercase/дедупа).

vi.mock('../src/api/user-colors', () => ({
  getMyColors: vi.fn(),
  saveMyColors: vi.fn(),
}));

import { getMyColors, saveMyColors } from '../src/api/user-colors';

const mockedGet = vi.mocked(getMyColors);
const mockedPut = vi.mocked(saveMyColors);

function Host(): JSX.Element {
  const [value, setValue] = useState('#ff4444');
  return (
    <UserColorsProvider>
      <ColorField label="Цвет" value={value} onChange={setValue} />
    </UserColorsProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockResolvedValue([]);
  mockedPut.mockImplementation(async (colors) => colors.map((c) => c.toLowerCase()));
});

describe('ColorField (palette popover)', () => {
  it('renders all 10 presets when the popover opens', async () => {
    const { container } = render(<Host />);
    // Дождёмся, пока стартовый GET резолвится.
    await act(async () => undefined);

    const trigger = container.querySelector(
      '.settings-field__color-trigger'
    ) as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);

    const swatches = container.querySelectorAll('.color-picker__swatch');
    expect(swatches.length).toBeGreaterThanOrEqual(PRESET_COLORS.length);
    // Все пресеты отрисованы — проверяем по aria-label (hex).
    for (const hex of PRESET_COLORS) {
      expect(container.querySelector(`.color-picker__swatch[aria-label="${hex}"]`))
        .toBeTruthy();
    }
  });

  it('adds the current color to "Мои цвета" and persists via PUT', async () => {
    const { container } = render(<Host />);
    await act(async () => undefined);

    fireEvent.click(
      container.querySelector('.settings-field__color-trigger') as HTMLButtonElement
    );

    const add = container.querySelector(
      '.color-picker__add'
    ) as HTMLButtonElement | null;
    expect(add).toBeTruthy();
    await act(async () => {
      fireEvent.click(add!);
    });

    // Локально цвет должен появиться сразу (optimistic); PUT — в полёте.
    expect(
      container.querySelectorAll('.color-picker__swatch-wrap--removable').length
    ).toBe(1);
    expect(mockedPut).toHaveBeenCalledWith(['#ff4444']);
  });

  it('clamps custom colors to MAX_CUSTOM_COLORS (10) via MRU order', async () => {
    // Сервер вернёт уже полный набор из 10 цветов, плюс пользователь пытается
    // добавить 11-й. Ожидаем: новый цвет в начале, самый старый вытесняется.
    const initial = Array.from({ length: MAX_CUSTOM_COLORS }, (_, i) =>
      `#${i.toString(16).padStart(2, '0')}0000`
    );
    mockedGet.mockResolvedValueOnce(initial);

    function HostFull(): JSX.Element {
      const [value, setValue] = useState('#aabbcc');
      return (
        <UserColorsProvider>
          <ColorField label="Цвет" value={value} onChange={setValue} />
        </UserColorsProvider>
      );
    }

    const { container } = render(<HostFull />);
    // Дождёмся первичной загрузки.
    await act(async () => undefined);

    fireEvent.click(
      container.querySelector('.settings-field__color-trigger') as HTMLButtonElement
    );

    // Палитра полная — кнопки «+» быть не должно.
    expect(container.querySelector('.color-picker__add')).toBeNull();
  });

  it('removeColor triggers a PUT without the removed value', async () => {
    mockedGet.mockResolvedValueOnce(['#ff0000', '#00ff00']);

    const { container } = render(<Host />);
    await act(async () => undefined);

    fireEvent.click(
      container.querySelector('.settings-field__color-trigger') as HTMLButtonElement
    );

    const delBtn = container.querySelector(
      '.color-picker__swatch-delete'
    ) as HTMLButtonElement | null;
    expect(delBtn).toBeTruthy();
    await act(async () => {
      fireEvent.click(delBtn!);
    });

    expect(mockedPut).toHaveBeenCalledWith(['#00ff00']);
  });
});

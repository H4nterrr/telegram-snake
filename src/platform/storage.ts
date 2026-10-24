// Рекорды и выбранная скорость в localStorage. Все обращения обёрнуты в
// try/catch: в приватном режиме или при запрете хранилища игра всё равно работает.

import { SPEEDS, isSpeed, type Speed } from '../game/settings';

const RECORDS_KEY = 'telegram-snake:records:v1';
const SPEED_KEY = 'telegram-snake:speed:v1';

export type Records = Record<Speed, number>;

function emptyRecords(): Records {
  return { easy: 0, normal: 0, fast: 0 };
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Хранилище недоступно или переполнено — просто не сохраняем.
  }
}

export function loadRecords(): Records {
  const records = emptyRecords();
  const raw = safeGet(RECORDS_KEY);
  if (!raw) return records;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const speed of SPEEDS) {
        const value = (parsed as Record<string, unknown>)[speed];
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
          records[speed] = Math.floor(value);
        }
      }
    }
  } catch {
    // Повреждённые данные — начинаем с нуля.
  }
  return records;
}

/**
 * Сохраняет рекорды, не уменьшая уже сохранённые: если игра открыта в двух
 * вкладках, одна не затрёт более высокий рекорд другой.
 */
export function saveRecords(records: Records): void {
  const stored = loadRecords();
  const merged = emptyRecords();
  for (const speed of SPEEDS) merged[speed] = Math.max(records[speed], stored[speed]);
  safeSet(RECORDS_KEY, JSON.stringify(merged));
}

export function loadSpeed(): Speed {
  const raw = safeGet(SPEED_KEY);
  return isSpeed(raw) ? raw : 'normal';
}

export function saveSpeed(speed: Speed): void {
  safeSet(SPEED_KEY, speed);
}

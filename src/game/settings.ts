export type Speed = 'easy' | 'normal' | 'fast';

export const SPEEDS: readonly Speed[] = ['easy', 'normal', 'fast'];

export interface SpeedConfig {
  label: string;
  /** Длительность одного хода в миллисекундах. */
  stepMs: number;
}

export const SPEED_CONFIG: Readonly<Record<Speed, SpeedConfig>> = {
  easy: { label: 'Лёгкая', stepMs: 170 },
  normal: { label: 'Обычная', stepMs: 120 },
  fast: { label: 'Быстрая', stepMs: 80 },
};

/** Размер поля в клетках. Квадрат 15×15 хорошо смотрится на телефоне. */
export const BOARD_COLS = 15;
export const BOARD_ROWS = 15;

export function isSpeed(value: unknown): value is Speed {
  return typeof value === 'string' && (SPEEDS as readonly string[]).includes(value);
}

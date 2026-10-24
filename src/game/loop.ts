// Игровой цикл с фиксированным шагом: скорость змейки зависит только от
// выбранной скорости, а не от частоты обновления экрана (60, 90, 120 Гц...).

/**
 * Максимальное время одного кадра, которое учитывается. Если браузер
 * «подвис» или вкладка долго была в фоне, змейка не сделает пачку ходов подряд.
 */
export const MAX_FRAME_MS = 250;

/** Не больше стольких ходов за один кадр — защита от рывков. */
export const MAX_STEPS_PER_FRAME = 2;

export interface AdvanceResult {
  steps: number;
  accumulator: number;
}

/** Чистый расчёт: сколько ходов сделать за прошедшие dt миллисекунд. */
export function advance(accumulator: number, dt: number, stepMs: number): AdvanceResult {
  const safeDt = Math.min(Math.max(dt, 0), MAX_FRAME_MS);
  let acc = accumulator + safeDt;
  let steps = 0;
  while (acc >= stepMs && steps < MAX_STEPS_PER_FRAME) {
    acc -= stepMs;
    steps++;
  }
  // Если не успели «догнать» время, отбрасываем остаток, а не копим долг.
  if (acc >= stepMs) acc = 0;
  return { steps, accumulator: acc };
}

export interface LoopCallbacks {
  /** Один игровой ход. Вернуть false, если игра остановилась (конец игры). */
  step(): boolean;
  /** Отрисовка. alpha ∈ [0, 1] — доля пути до следующего хода, для плавности. */
  render(alpha: number, now: number): void;
}

export class GameLoop {
  private rafId: number | null = null;
  private lastTime: number | null = null;
  private accumulator = 0;
  private running = false;

  constructor(
    private readonly callbacks: LoopCallbacks,
    public stepMs: number,
  ) {}

  /** Запускает отрисовку (анимации идут и на паузе), но не ходы. */
  start(): void {
    if (this.rafId !== null) return;
    this.lastTime = null;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** Включает ходы. Отсчёт времени начинается заново — без скачков после паузы. */
  play(): void {
    this.running = true;
    this.accumulator = 0;
    this.lastTime = null;
  }

  pause(): void {
    this.running = false;
    this.accumulator = 0;
  }

  get isPlaying(): boolean {
    return this.running;
  }

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);

    const dt = this.lastTime === null ? 0 : now - this.lastTime;
    this.lastTime = now;

    if (this.running) {
      const result = advance(this.accumulator, dt, this.stepMs);
      this.accumulator = result.accumulator;
      for (let i = 0; i < result.steps; i++) {
        if (!this.callbacks.step()) {
          this.running = false;
          this.accumulator = 0;
          break;
        }
      }
    }

    const alpha = this.running ? Math.min(1, this.accumulator / this.stepMs) : 1;
    this.callbacks.render(alpha, now);
  };
}

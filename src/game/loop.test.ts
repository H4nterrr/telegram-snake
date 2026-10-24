import { describe, expect, it } from 'vitest';
import { MAX_FRAME_MS, MAX_STEPS_PER_FRAME, advance } from './loop';

describe('игровой цикл с фиксированным шагом', () => {
  it('число ходов не зависит от частоты кадров', () => {
    const stepMs = 100;
    const simulate = (fps: number) => {
      const frame = 1000 / fps;
      let acc = 0;
      let steps = 0;
      for (let t = 0; t < 1000 - 1e-6; t += frame) {
        const r = advance(acc, frame, stepMs);
        acc = r.accumulator;
        steps += r.steps;
      }
      return steps;
    };
    // За 1 секунду при шаге 100 мс должно быть 10 ходов на любом экране (±1 из-за округления).
    for (const fps of [30, 60, 90, 120, 144]) {
      expect(Math.abs(simulate(fps) - 10)).toBeLessThanOrEqual(1);
    }
  });

  it('копит время между кадрами и делает ход, когда набирается шаг', () => {
    let r = advance(0, 60, 100);
    expect(r).toEqual({ steps: 0, accumulator: 60 });
    r = advance(r.accumulator, 60, 100);
    expect(r.steps).toBe(1);
    expect(r.accumulator).toBeCloseTo(20);
  });

  it('после долгой задержки не делает пачку ходов подряд', () => {
    const r = advance(0, 10_000, 80);
    expect(r.steps).toBeLessThanOrEqual(MAX_STEPS_PER_FRAME);
    expect(r.accumulator).toBeLessThan(80);
    expect(MAX_FRAME_MS).toBeLessThanOrEqual(250);
  });

  it('отрицательное время (сбой часов) игнорируется', () => {
    expect(advance(0, -500, 100)).toEqual({ steps: 0, accumulator: 0 });
  });
});

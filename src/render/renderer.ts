// Отрисовка игрового поля на Canvas. Состояние игры здесь только читается.

import type { GameState, Point } from '../game/logic';
import { VECTORS } from '../game/logic';
import { mix, parseColor, toCss, type Rgb } from './colors';

interface Palette {
  boardA: string;
  boardB: string;
  snakeHead: Rgb;
  snakeTail: Rgb;
  head: string;
  food: string;
  foodGlow: string;
  foodGlowEnd: string;
  foodShine: string;
  leaf: string;
  ring: Rgb;
  dead: string;
}

interface EatEffect {
  x: number;
  y: number;
  start: number;
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const EFFECT_MS = 320;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  /** Размер одной клетки в CSS-пикселях. */
  private cell = 20;
  private palette!: Palette;
  private effects: EatEffect[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cols: number,
    private readonly rows: number,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D не поддерживается');
    this.ctx = ctx;
    this.refreshPalette();
  }

  /**
   * Подгоняет холст под доступное место (в CSS-пикселях) и возвращает размер
   * поля. Вызывается при изменении размера окна; состояние игры не
   * затрагивается, меняется только масштаб.
   */
  resize(availableWidth: number, availableHeight: number): { width: number; height: number } {
    const available = Math.max(0, Math.min(availableWidth / this.cols, availableHeight / this.rows));
    // Целое число пикселей на клетку — клетки остаются чёткими.
    this.cell = Math.max(8, Math.floor(available));

    const width = this.cell * this.cols;
    const height = this.cell * this.rows;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { width, height };
  }

  /** Перечитывает цвета из CSS-переменных. */
  refreshPalette(): void {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: Rgb) => parseColor(style.getPropertyValue(name), fallback);

    const boardA = read('--board', { r: 14, g: 21, b: 28 });
    const boardB = read('--board-alt', { r: 17, g: 26, b: 34 });
    const snake = read('--snake', { r: 62, g: 224, b: 122 });
    const tail = read('--snake-tail', { r: 22, g: 154, b: 76 });
    const food = read('--food', { r: 255, g: 93, b: 93 });

    this.palette = {
      boardA: toCss(boardA),
      boardB: toCss(boardB),
      snakeHead: snake,
      snakeTail: tail,
      head: toCss(mix(snake, WHITE, 0.18)),
      food: toCss(food),
      foodGlow: toCss(food, 0.3),
      foodGlowEnd: toCss(food, 0),
      foodShine: toCss(mix(food, WHITE, 0.6), 0.9),
      leaf: '#4cd57f',
      ring: snake,
      dead: '#ff6b6b',
    };
  }

  /** Короткая вспышка-кольцо на месте съеденной еды. */
  addEatEffect(point: Point, now: number): void {
    this.effects.push({ x: point.x, y: point.y, start: now });
  }

  clearEffects(): void {
    this.effects = [];
  }

  /**
   * @param previousSnake змейка до последнего хода — для плавной анимации.
   * @param alpha доля пути до следующего хода (0..1).
   * @param time время кадра, мс — для пульсации еды и эффектов.
   */
  draw(state: GameState, previousSnake: readonly Point[], alpha: number, time: number): void {
    const { ctx, cell, palette } = this;
    const width = cell * this.cols;
    const height = cell * this.rows;

    ctx.clearRect(0, 0, width, height);

    // Шахматная подложка с едва заметным контрастом.
    ctx.fillStyle = palette.boardA;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = palette.boardB;
    for (let y = 0; y < this.rows; y++) {
      for (let x = y % 2; x < this.cols; x += 2) {
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    if (state.food) this.drawFood(state.food, time);
    this.drawEffects(time);
    this.drawSnake(state, previousSnake, alpha);
  }

  private center(p: Point): [number, number] {
    return [(p.x + 0.5) * this.cell, (p.y + 0.5) * this.cell];
  }

  private drawFood(food: Point, time: number): void {
    const { ctx, cell, palette } = this;
    const [cx, cy] = this.center(food);
    const pulse = 1 + Math.sin(time / 240) * 0.07;
    const r = cell * 0.33 * pulse;

    // Мягкое свечение вокруг еды.
    const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.1);
    glow.addColorStop(0, palette.foodGlow);
    glow.addColorStop(1, palette.foodGlowEnd);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.food;
    ctx.beginPath();
    ctx.arc(cx, cy + cell * 0.02, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.foodShine;
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, cy - r * 0.32, r * 0.26, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.leaf;
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.32, cy - r * 0.98, r * 0.36, r * 0.17, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawEffects(time: number): void {
    const { ctx, cell, palette } = this;
    this.effects = this.effects.filter((e) => time - e.start < EFFECT_MS && time >= e.start);
    for (const effect of this.effects) {
      const t = (time - effect.start) / EFFECT_MS;
      const [cx, cy] = this.center(effect);
      ctx.strokeStyle = toCss(palette.ring, 0.55 * (1 - t));
      ctx.lineWidth = Math.max(1.5, cell * 0.12 * (1 - t));
      ctx.beginPath();
      ctx.arc(cx, cy, cell * (0.4 + t * 0.7), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawSnake(state: GameState, previousSnake: readonly Point[], alpha: number): void {
    const { ctx, cell, palette } = this;
    const snake = state.snake;
    if (snake.length === 0) return;

    // Плавность: голова и кончик хвоста сдвигаются между клетками,
    // а изгибы остаются в центрах клеток.
    const canInterpolate = state.status === 'running' && previousSnake.length > 0 && previousSnake !== snake;
    const t = canInterpolate ? alpha : 1;
    const lerp = (from: Point, to: Point): [number, number] => {
      const [ax, ay] = this.center(from);
      const [bx, by] = this.center(to);
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    };

    const head = lerp(canInterpolate ? previousSnake[0] : snake[0], snake[0]);
    const path: Array<[number, number]> = [head];
    for (let i = 1; i < snake.length; i++) path.push(this.center(snake[i]));
    if (canInterpolate) {
      path.push(lerp(previousSnake[previousSnake.length - 1], snake[snake.length - 1]));
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = cell * 0.7;

    if (path.length === 1) {
      ctx.fillStyle = toCss(palette.snakeHead);
      ctx.beginPath();
      ctx.arc(head[0], head[1], cell * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // Тело рисуем от хвоста к голове отрезками с плавным градиентом цвета.
    const segments = path.length - 1;
    for (let i = segments - 1; i >= 0; i--) {
      const k = segments <= 1 ? 0 : i / (segments - 1);
      ctx.strokeStyle = toCss(mix(palette.snakeHead, palette.snakeTail, k * 0.85));
      ctx.beginPath();
      ctx.moveTo(path[i][0], path[i][1]);
      ctx.lineTo(path[i + 1][0], path[i + 1][1]);
      ctx.stroke();
    }

    // Голова.
    const [hx, hy] = head;
    ctx.fillStyle = state.status === 'over' ? palette.dead : palette.head;
    ctx.beginPath();
    ctx.arc(hx, hy, cell * 0.43, 0, Math.PI * 2);
    ctx.fill();

    this.drawEyes(hx, hy, state);
  }

  private drawEyes(hx: number, hy: number, state: GameState): void {
    const { ctx, cell } = this;
    const v = VECTORS[state.direction];
    // Перпендикуляр к направлению — по нему разносим глаза.
    const px = -v.y;
    const py = v.x;
    const forward = cell * 0.12;
    const spread = cell * 0.19;
    const eyeR = cell * 0.12;
    const dead = state.status === 'over';

    for (const side of [-1, 1]) {
      const ex = hx + v.x * forward + px * spread * side;
      const ey = hy + v.y * forward + py * spread * side;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fill();

      if (dead) {
        // Глаза-крестики после столкновения.
        const d = eyeR * 0.6;
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = Math.max(1, cell * 0.05);
        ctx.beginPath();
        ctx.moveTo(ex - d, ey - d);
        ctx.lineTo(ex + d, ey + d);
        ctx.moveTo(ex + d, ey - d);
        ctx.lineTo(ex - d, ey + d);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#0a0f14';
        ctx.beginPath();
        ctx.arc(ex + v.x * eyeR * 0.35, ey + v.y * eyeR * 0.35, eyeR * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

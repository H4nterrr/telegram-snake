import { describe, expect, it } from 'vitest';
import {
  MAX_QUEUED_TURNS,
  createGame,
  queueDirection,
  spawnFood,
  step,
  type GameState,
  type Point,
  type Rng,
} from './logic';

/** Детерминированный генератор (mulberry32), чтобы тесты были воспроизводимыми. */
function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const p = (x: number, y: number): Point => ({ x, y });

function onSnake(state: GameState, point: Point): boolean {
  return state.snake.some((s) => s.x === point.x && s.y === point.y);
}

describe('создание игры', () => {
  it('ставит змейку из 3 клеток головой вправо и еду в свободную клетку', () => {
    const game = createGame({ cols: 15, rows: 15, rng: seeded(1) });
    expect(game.snake).toHaveLength(3);
    expect(game.direction).toBe('right');
    expect(game.status).toBe('running');
    expect(game.score).toBe(0);
    expect(game.snake[0].x).toBe(game.snake[1].x + 1);
    expect(game.food).not.toBeNull();
    expect(onSnake(game, game.food!)).toBe(false);
  });
});

describe('движение', () => {
  it('сдвигает змейку на одну клетку и сохраняет длину', () => {
    const game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(9, 9) });
    const next = step(game);
    expect(next.snake).toEqual([p(4, 5), p(3, 5), p(2, 5)]);
    expect(next.score).toBe(0);
  });

  it('не изменяет исходное состояние', () => {
    const game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(9, 9) });
    const snapshot = JSON.stringify(game);
    step(queueDirection(game, 'up'));
    expect(JSON.stringify(game)).toBe(snapshot);
  });

  it('поворачивает по очереди введённых направлений, по одному повороту за ход', () => {
    let game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(9, 9) });
    game = queueDirection(game, 'up');
    game = queueDirection(game, 'left');
    game = step(game);
    expect(game.snake[0]).toEqual(p(3, 4));
    expect(game.direction).toBe('up');
    game = step(game);
    expect(game.snake[0]).toEqual(p(2, 4));
    expect(game.direction).toBe('left');
    expect(game.queue).toHaveLength(0);
  });
});

describe('запрет разворота на 180°', () => {
  it('игнорирует противоположное направление', () => {
    const game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(9, 9) });
    const next = queueDirection(game, 'left');
    expect(next.queue).toHaveLength(0);
    expect(step(next).snake[0]).toEqual(p(4, 5));
  });

  it('быстрые нажатия «вверх → вниз» в одном ходе не приводят к развороту', () => {
    let game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(9, 9) });
    game = queueDirection(game, 'up');
    game = queueDirection(game, 'down'); // противоположно запланированному «вверх»
    expect(game.queue).toEqual(['up']);
    game = step(game);
    expect(game.status).toBe('running');
    expect(game.snake[0]).toEqual(p(3, 4));
  });

  it('быстрые нажатия «вверх → влево» при движении вправо выполняются за два хода без столкновения', () => {
    let game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(9, 9) });
    game = queueDirection(game, 'up');
    game = queueDirection(game, 'left');
    game = step(step(game));
    expect(game.status).toBe('running');
    expect(game.snake[0]).toEqual(p(2, 4));
  });

  it('повтор текущего направления и переполнение очереди игнорируются', () => {
    let game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(9, 9) });
    game = queueDirection(game, 'right');
    expect(game.queue).toHaveLength(0);
    game = queueDirection(game, 'up');
    game = queueDirection(game, 'right');
    game = queueDirection(game, 'down');
    expect(game.queue).toHaveLength(MAX_QUEUED_TURNS);
    expect(game.queue).toEqual(['up', 'right']);
  });
});

describe('рост и счёт', () => {
  it('съев еду, змейка растёт на 1, счёт +1, появляется новая еда', () => {
    const game = createGame({ cols: 10, rows: 10, snake: [p(3, 5), p(2, 5), p(1, 5)], food: p(4, 5) });
    const next = step(game, seeded(7));
    expect(next.snake).toEqual([p(4, 5), p(3, 5), p(2, 5), p(1, 5)]);
    expect(next.score).toBe(1);
    expect(next.food).not.toBeNull();
    expect(onSnake(next, next.food!)).toBe(false);
  });
});

describe('столкновения', () => {
  it('со стеной — конец игры', () => {
    const game = createGame({ cols: 5, rows: 5, snake: [p(4, 2), p(3, 2), p(2, 2)], food: p(0, 0) });
    const next = step(game);
    expect(next.status).toBe('over');
    // При проигрыше змейка остаётся на месте.
    expect(next.snake).toEqual(game.snake);
  });

  it('с верхней стеной после поворота — конец игры', () => {
    let game = createGame({ cols: 5, rows: 5, snake: [p(2, 0), p(1, 0), p(0, 0)], food: p(4, 4) });
    game = step(queueDirection(game, 'up'));
    expect(game.status).toBe('over');
  });

  it('с собственным телом — конец игры', () => {
    // Змейка-крючок: голова (2,2) идёт вниз в (2,3), где находится тело.
    const snake = [p(2, 2), p(3, 2), p(3, 3), p(2, 3), p(1, 3), p(1, 4)];
    let game = createGame({ cols: 6, rows: 6, snake, direction: 'left', food: p(5, 5) });
    game = step(queueDirection(game, 'down'));
    expect(game.status).toBe('over');
  });

  it('вход в клетку освобождающегося хвоста разрешён', () => {
    // Квадрат 2×2: голова (0,0), хвост (0,1). Ход вниз — в клетку хвоста.
    const snake = [p(0, 0), p(1, 0), p(1, 1), p(0, 1)];
    let game = createGame({ cols: 4, rows: 4, snake, direction: 'left', food: p(3, 3) });
    game = step(queueDirection(game, 'down'));
    expect(game.status).toBe('running');
    expect(game.snake).toEqual([p(0, 1), p(0, 0), p(1, 0), p(1, 1)]);
  });

  it('после конца игры ходы и повороты ничего не меняют', () => {
    const over = step(createGame({ cols: 5, rows: 5, snake: [p(4, 2), p(3, 2)], food: p(0, 0) }));
    expect(over.status).toBe('over');
    expect(step(over)).toBe(over);
    expect(queueDirection(over, 'up')).toBe(over);
  });
});

describe('появление еды', () => {
  it('никогда не появляется на змейке (много случайных расстановок)', () => {
    const rng = seeded(42);
    for (let round = 0; round < 500; round++) {
      const cols = 3 + Math.floor(rng() * 8);
      const rows = 3 + Math.floor(rng() * 8);
      // Случайный набор занятых клеток (для spawnFood важна только занятость).
      const snake: Point[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (rng() < 0.7) snake.push(p(x, y));
        }
      }
      const food = spawnFood(cols, rows, snake, rng);
      if (snake.length === cols * rows) {
        expect(food).toBeNull();
      } else {
        expect(food).not.toBeNull();
        expect(snake.some((s) => s.x === food!.x && s.y === food!.y)).toBe(false);
        expect(food!.x).toBeGreaterThanOrEqual(0);
        expect(food!.x).toBeLessThan(cols);
        expect(food!.y).toBeGreaterThanOrEqual(0);
        expect(food!.y).toBeLessThan(rows);
      }
    }
  });

  it('выбирает единственную свободную клетку', () => {
    const snake = [p(0, 0), p(1, 0), p(2, 0), p(2, 1), p(1, 1)];
    expect(spawnFood(3, 2, snake, () => 0.999999)).toEqual(p(0, 1));
  });

  it('устойчив к генератору, вернувшему ровно 1', () => {
    const food = spawnFood(3, 3, [p(0, 0)], () => 1);
    expect(food).toEqual(p(2, 2));
  });

  it('возвращает null, если свободных клеток нет', () => {
    expect(spawnFood(2, 1, [p(0, 0), p(1, 0)], Math.random)).toBeNull();
  });

  it('распределяет еду по всем свободным клеткам', () => {
    const rng = seeded(3);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const food = spawnFood(4, 4, [p(0, 0), p(1, 0)], rng)!;
      seen.add(`${food.x},${food.y}`);
    }
    expect(seen.size).toBe(14);
  });
});

describe('заполнение поля', () => {
  it('победа, когда змейка съедает последнюю свободную клетку', () => {
    const game = createGame({ cols: 3, rows: 1, snake: [p(1, 0), p(0, 0)], food: p(2, 0) });
    const next = step(game);
    expect(next.status).toBe('won');
    expect(next.snake).toHaveLength(3);
    expect(next.food).toBeNull();
    expect(next.score).toBe(1);
  });

  it('полная партия на поле 4×4 по «змеевидному» маршруту заканчивается победой', () => {
    const cols = 4;
    const rows = 4;
    // Гамильтонов цикл: вниз по столбцу 0, затем «змейкой» по столбцам 1–3 в строках 3..0, и обратно влево по строке 0.
    const cycle: Point[] = [];
    for (let y = 0; y < rows; y++) cycle.push(p(0, y));
    for (let y = rows - 1; y >= 0; y--) {
      const xs = (rows - 1 - y) % 2 === 0 ? [1, 2, 3] : [3, 2, 1];
      for (const x of xs) cycle.push(p(x, y));
    }
    expect(cycle).toHaveLength(cols * rows);

    // Начинаем в начале цикла: голова (0,1), хвост (0,0), едем вниз.
    let game = createGame({ cols, rows, rng: seeded(9), snake: [p(0, 1), p(0, 0)], direction: 'down' });
    let index = 1;
    for (let moves = 0; moves < 1000 && game.status === 'running'; moves++) {
      const next = cycle[(index + 1) % cycle.length];
      const head = game.snake[0];
      const dx = next.x - head.x;
      const dy = next.y - head.y;
      const dir = dx === 1 ? 'right' : dx === -1 ? 'left' : dy === 1 ? 'down' : 'up';
      game = step(queueDirection(game, dir), seeded(moves));
      index++;
    }

    expect(game.status).toBe('won');
    expect(game.snake).toHaveLength(cols * rows);
    expect(game.score).toBe(cols * rows - 2);
    const unique = new Set(game.snake.map((s) => `${s.x},${s.y}`));
    expect(unique.size).toBe(cols * rows);
  });
});

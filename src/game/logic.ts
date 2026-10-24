// Чистая игровая логика «Змейки»: без DOM, таймеров и отрисовки.
// Все функции возвращают новое состояние и не меняют переданное.

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** running — идёт игра, over — проигрыш, won — змейка заполнила всё поле. */
export type GameStatus = 'running' | 'over' | 'won';

export interface GameState {
  readonly cols: number;
  readonly rows: number;
  /** Сегменты змейки, первый элемент — голова. */
  readonly snake: readonly Point[];
  /** Направление, в котором змейка сделала последний ход. */
  readonly direction: Direction;
  /** Повороты, введённые игроком, но ещё не выполненные. */
  readonly queue: readonly Direction[];
  readonly food: Point | null;
  readonly score: number;
  readonly status: GameStatus;
}

/** Генератор случайных чисел в диапазоне [0, 1), как Math.random. */
export type Rng = () => number;

export const VECTORS: Readonly<Record<Direction, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

/**
 * Сколько поворотов можно ввести заранее. Двух хватает, чтобы успеть
 * сделать быстрый «зигзаг» между ходами, и при этом ввод не копится.
 */
export const MAX_QUEUED_TURNS = 2;

export const INITIAL_LENGTH = 3;

export interface CreateGameOptions {
  cols: number;
  rows: number;
  rng?: Rng;
  /** Своя начальная змейка (для тестов). По умолчанию — 3 клетки в центре, голова вправо. */
  snake?: readonly Point[];
  direction?: Direction;
  /** Своя еда (для тестов). null — не размещать. По умолчанию — случайная свободная клетка. */
  food?: Point | null;
}

export function createGame(options: CreateGameOptions): GameState {
  const { cols, rows, rng = Math.random } = options;
  if (cols < 2 || rows < 1) {
    throw new Error('Поле слишком маленькое');
  }

  const snake = options.snake ?? defaultSnake(cols, rows);
  const direction = options.direction ?? 'right';
  const food = options.food !== undefined ? options.food : spawnFood(cols, rows, snake, rng);

  return {
    cols,
    rows,
    snake,
    direction,
    queue: [],
    food,
    score: 0,
    status: 'running',
  };
}

function defaultSnake(cols: number, rows: number): Point[] {
  const length = Math.min(INITIAL_LENGTH, cols);
  const y = Math.floor(rows / 2);
  // Голова в левой трети поля: до стены впереди достаточно места,
  // чтобы успеть сориентироваться после нажатия «Играть».
  const headX = Math.max(length - 1, Math.floor(cols / 3) - 1);
  const snake: Point[] = [];
  for (let i = 0; i < length; i++) {
    snake.push({ x: headX - i, y });
  }
  return snake;
}

/**
 * Добавляет поворот в очередь. Поворот сравнивается с последним
 * запланированным направлением (а не только с текущим), поэтому быстрые
 * нажатия «вверх → влево» при движении вправо не приведут к развороту
 * на 180° за один ход. Повтор того же направления игнорируется.
 */
export function queueDirection(state: GameState, next: Direction): GameState {
  if (state.status !== 'running') return state;
  if (state.queue.length >= MAX_QUEUED_TURNS) return state;

  const last = state.queue.length > 0 ? state.queue[state.queue.length - 1] : state.direction;
  if (next === last || next === OPPOSITE[last]) return state;

  return { ...state, queue: [...state.queue, next] };
}

export function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isInside(cols: number, rows: number, p: Point): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < cols && p.y < rows;
}

/** Один ход змейки. */
export function step(state: GameState, rng: Rng = Math.random): GameState {
  if (state.status !== 'running') return state;

  const [queued, ...restQueue] = state.queue;
  const direction = queued ?? state.direction;
  const vector = VECTORS[direction];
  const head = state.snake[0];
  const newHead: Point = { x: head.x + vector.x, y: head.y + vector.y };

  if (!isInside(state.cols, state.rows, newHead)) {
    return { ...state, direction, queue: restQueue, status: 'over' };
  }

  const eating = state.food !== null && pointsEqual(newHead, state.food);

  // Если змейка не ест, хвост в этот же ход освобождает свою клетку,
  // поэтому в неё можно войти головой. Если ест — хвост остаётся на месте.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  if (body.some((segment) => pointsEqual(segment, newHead))) {
    return { ...state, direction, queue: restQueue, status: 'over' };
  }

  const snake = [newHead, ...body];

  if (!eating) {
    return { ...state, snake, direction, queue: restQueue };
  }

  const score = state.score + 1;
  const food = spawnFood(state.cols, state.rows, snake, rng);
  // Свободных клеток не осталось — змейка заняла всё поле.
  const status: GameStatus = food === null ? 'won' : 'running';

  return { ...state, snake, direction, queue: restQueue, food, score, status };
}

/**
 * Выбирает случайную свободную клетку (равновероятно среди свободных).
 * Возвращает null, если свободных клеток нет.
 */
export function spawnFood(cols: number, rows: number, snake: readonly Point[], rng: Rng): Point | null {
  const occupied = new Uint8Array(cols * rows);
  for (const segment of snake) {
    if (isInside(cols, rows, segment)) {
      occupied[segment.y * cols + segment.x] = 1;
    }
  }

  const free: number[] = [];
  for (let i = 0; i < occupied.length; i++) {
    if (occupied[i] === 0) free.push(i);
  }
  if (free.length === 0) return null;

  const index = Math.min(free.length - 1, Math.floor(rng() * free.length));
  const cell = free[index];
  return { x: cell % cols, y: Math.floor(cell / cols) };
}

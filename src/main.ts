// Точка входа: связывает логику, цикл, отрисовку, управление и интерфейс.

import './styles.css';
import { createGame, queueDirection, step, type Direction, type GameState, type Point } from './game/logic';
import { GameLoop } from './game/loop';
import { BOARD_COLS, BOARD_ROWS, SPEED_CONFIG, isSpeed, type Speed } from './game/settings';
import { bindDpad, bindKeyboard, bindSwipe } from './input/input';
import { TelegramBridge } from './platform/telegram';
import { loadRecords, loadSpeed, saveRecords, saveSpeed } from './platform/storage';
import { Renderer } from './render/renderer';

type Screen = 'menu' | 'playing' | 'paused' | 'over';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Не найден элемент #${id}`);
  return element as T;
}

const ui = {
  score: byId('score'),
  best: byId('best'),
  pauseButton: byId<HTMLButtonElement>('pause-button'),
  playArea: byId('play-area'),
  boardWrap: byId('board-wrap'),
  canvas: byId<HTMLCanvasElement>('board'),
  boardHint: byId('board-hint'),
  dpad: byId('dpad'),
  menu: byId('menu'),
  speedOptions: byId('speed-options'),
  menuBest: byId('menu-best'),
  playButton: byId<HTMLButtonElement>('play-button'),
  version: byId('version'),
  pause: byId('pause'),
  pauseScore: byId('pause-score'),
  resumeButton: byId<HTMLButtonElement>('resume-button'),
  pauseMenuButton: byId<HTMLButtonElement>('pause-menu-button'),
  over: byId('over'),
  overTitle: byId('over-title'),
  finalScore: byId('final-score'),
  newRecord: byId('new-record'),
  overBest: byId('over-best'),
  restartButton: byId<HTMLButtonElement>('restart-button'),
  overMenuButton: byId<HTMLButtonElement>('over-menu-button'),
};

/** Сколько миллисекунд кнопки нового экрана не реагируют на случайное касание. */
const TAP_GUARD_MS = 350;
/** Экран проигрыша появляется с задержкой (см. styles.css), защита чуть дольше. */
const OVER_TAP_GUARD_MS = 650;
const HINT_MS = 3500;

const telegram = new TelegramBridge();
const isTouch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
document.documentElement.classList.toggle('touch', isTouch);

let speed: Speed = loadSpeed();
const records = loadRecords();
let state: GameState = createGame({ cols: BOARD_COLS, rows: BOARD_ROWS });
let previousSnake: readonly Point[] = state.snake;
let screen: Screen = 'menu';
let bestAtStart = 0;
let screenShownAt = 0;
let lastAlpha = 1;
let lastFrameTime = 0;
let hintTimer: number | undefined;

const renderer = new Renderer(ui.canvas, BOARD_COLS, BOARD_ROWS);

// Единственный игровой цикл на всё время работы приложения. Старт, пауза и
// повтор только включают и выключают ходы, новых циклов не создаётся.
const loop = new GameLoop(
  {
    step: onStep,
    render(alpha, now) {
      lastAlpha = alpha;
      lastFrameTime = now;
      if (screen !== 'menu') renderer.draw(state, previousSnake, alpha, now);
    },
  },
  SPEED_CONFIG[speed].stepMs,
);

// ---------- Игровой процесс ----------

function onStep(): boolean {
  const before = state;
  previousSnake = before.snake;
  state = step(before);

  if (state.score > before.score) {
    if (state.score > records[speed]) {
      // Рекорд сохраняем сразу — он не потеряется, даже если закрыть приложение.
      records[speed] = state.score;
      saveRecords(records);
    }
    renderer.addEatEffect(state.snake[0], lastFrameTime);
    telegram.hapticImpact('light');
    updateHud(true);
  }
  publishState();

  if (state.status !== 'running') {
    finishGame();
    return false;
  }
  return true;
}

function startGame(): void {
  state = createGame({ cols: BOARD_COLS, rows: BOARD_ROWS });
  previousSnake = state.snake;
  bestAtStart = records[speed];
  renderer.clearEffects();
  loop.stepMs = SPEED_CONFIG[speed].stepMs;
  // Сначала включаем ходы, потом показываем экран: если в этот момент придёт
  // автопауза, она корректно остановит уже запущенный цикл.
  loop.play();
  setScreen('playing');
  updateHud();
  publishState();
  showHint();
}

function pauseGame(): void {
  if (screen !== 'playing') return;
  loop.pause();
  // Замираем ровно в текущей клетке, без анимации «назад» после продолжения.
  previousSnake = state.snake;
  ui.pauseScore.textContent = String(state.score);
  setScreen('paused');
}

function resumeGame(): void {
  if (screen !== 'paused') return;
  // Отсчёт времени начинается заново: никаких мгновенных ходов после паузы.
  loop.play();
  setScreen('playing');
}

function togglePause(): void {
  if (screen === 'playing') pauseGame();
  else if (screen === 'paused') resumeGame();
}

function goToMenu(): void {
  loop.pause();
  setScreen('menu');
}

function finishGame(): void {
  loop.pause();
  const won = state.status === 'won';
  ui.over.classList.toggle('win', won);
  ui.overTitle.textContent = won ? 'Победа!' : 'Игра окончена';
  ui.finalScore.textContent = String(state.score);
  ui.newRecord.hidden = !(state.score > bestAtStart);
  ui.overBest.textContent = String(records[speed]);
  telegram.hapticNotify(won ? 'success' : 'error');
  if (!won) shakeBoard();
  setScreen('over');
}

function handleDirection(direction: Direction): void {
  if (screen !== 'playing') return;
  state = queueDirection(state, direction);
  hideHint();
}

// ---------- Интерфейс ----------

function setScreen(next: Screen): void {
  screen = next;
  document.documentElement.dataset.screen = next;
  ui.menu.classList.toggle('is-visible', next === 'menu');
  ui.pause.classList.toggle('is-visible', next === 'paused');
  ui.over.classList.toggle('is-visible', next === 'over');
  ui.pauseButton.disabled = next !== 'playing';
  telegram.setBackButtonVisible(next !== 'menu');
  screenShownAt = performance.now();

  if (next !== 'playing') hideHint();

  if (next === 'menu') {
    renderMenu();
    focusIfDesktop(ui.playButton);
  } else if (next === 'paused') {
    focusIfDesktop(ui.resumeButton);
  } else if (next === 'over') {
    focusIfDesktop(ui.restartButton);
  } else {
    // Во время игры фокус не должен оставаться на кнопках экранов.
    (document.activeElement as HTMLElement | null)?.blur?.();
    redraw();
  }
}

function focusIfDesktop(button: HTMLButtonElement): void {
  if (!isTouch) button.focus({ preventScroll: true });
}

function updateHud(bump = false): void {
  ui.score.textContent = String(state.score);
  ui.best.textContent = String(Math.max(records[speed], state.score));
  if (bump) {
    ui.score.classList.remove('bump');
    void ui.score.offsetWidth; // перезапуск CSS-анимации
    ui.score.classList.add('bump');
  }
}

function renderMenu(): void {
  ui.menuBest.textContent = String(records[speed]);
  for (const input of ui.speedOptions.querySelectorAll<HTMLInputElement>('input[name="speed"]')) {
    input.checked = input.value === speed;
  }
  updateHud();
}

function showHint(): void {
  ui.boardHint.classList.add('is-visible');
  window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(hideHint, HINT_MS);
}

function hideHint(): void {
  window.clearTimeout(hintTimer);
  ui.boardHint.classList.remove('is-visible');
}

function shakeBoard(): void {
  ui.boardWrap.classList.remove('shake');
  void ui.boardWrap.offsetWidth;
  ui.boardWrap.classList.add('shake');
}

/**
 * Краткое состояние в data-атрибутах поля: помогает автоматическим проверкам
 * и отладке на телефоне (видно в инспекторе), на игру не влияет.
 */
function publishState(): void {
  const head = state.snake[0];
  const data = ui.canvas.dataset;
  data.head = `${head.x},${head.y}`;
  data.direction = state.direction;
  data.length = String(state.snake.length);
  data.score = String(state.score);
  data.status = state.status;
  data.speed = speed;
}

/**
 * Кнопки экрана, появившегося под пальцем (например, «Ещё раз» сразу после
 * столкновения), не должны срабатывать от случайного касания.
 */
function guarded(action: () => void, delay = TAP_GUARD_MS): () => void {
  return () => {
    if (performance.now() - screenShownAt < delay) return;
    action();
  };
}

function redraw(): void {
  if (screen !== 'menu') renderer.draw(state, previousSnake, lastAlpha, lastFrameTime);
}

// ---------- Подключение событий (один раз при загрузке) ----------

ui.version.textContent = `v${__APP_VERSION__}`;

ui.playButton.addEventListener('click', (event) => {
  // Повтор нажатия Enter с клавиатуры не должен сразу запускать игру после
  // перехода в меню; касания и клики мышью срабатывают всегда.
  if (event.detail === 0 && performance.now() - screenShownAt < TAP_GUARD_MS) return;
  startGame();
});
ui.restartButton.addEventListener('click', guarded(startGame, OVER_TAP_GUARD_MS));
ui.overMenuButton.addEventListener('click', guarded(goToMenu, OVER_TAP_GUARD_MS));
ui.resumeButton.addEventListener('click', guarded(resumeGame));
ui.pauseMenuButton.addEventListener('click', guarded(goToMenu));
ui.pauseButton.addEventListener('click', pauseGame);
ui.boardWrap.addEventListener('animationend', () => ui.boardWrap.classList.remove('shake'));

ui.speedOptions.addEventListener('change', (event) => {
  const value = (event.target as HTMLInputElement).value;
  if (!isSpeed(value)) return;
  speed = value;
  saveSpeed(speed);
  renderMenu();
  telegram.hapticSelection();
});

bindKeyboard({
  direction: handleDirection,
  togglePause,
  confirm() {
    if (screen === 'menu') startGame();
    else if (screen === 'over') guarded(startGame, OVER_TAP_GUARD_MS)();
    else if (screen === 'paused') resumeGame();
  },
  isPlaying: () => screen === 'playing',
  isPaused: () => screen === 'paused',
});
bindSwipe(ui.playArea, handleDirection);
bindDpad(ui.dpad, handleDirection);

// Автопауза, когда приложение свёрнуто или вкладка скрыта. Событие blur окна
// не используем: в Telegram Web/Desktop оно приходит и при нажатии системной
// кнопки «Назад», и тогда одно нажатие сразу выбрасывало бы в меню.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') pauseGame();
});
window.addEventListener('pagehide', pauseGame);

/**
 * Поле — самый крупный квадрат, который помещается в игровой области рядом
 * со стрелками. Изменение размера меняет только масштаб, игра продолжается.
 */
function layoutBoard(): void {
  const area = ui.playArea.getBoundingClientRect();
  const styles = getComputedStyle(ui.playArea);
  const gap = parseFloat(styles.rowGap || styles.gap) || 0;
  let width = area.width;
  let height = area.height;
  if (getComputedStyle(ui.dpad).display !== 'none') {
    const dpad = ui.dpad.getBoundingClientRect();
    if (styles.flexDirection === 'row') width -= dpad.width + gap * 2;
    else height -= dpad.height + gap;
  }
  const size = renderer.resize(width, height);
  ui.boardWrap.style.setProperty('--board-size', `${size.width}px`);
  redraw();
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(layoutBoard).observe(ui.playArea);
}
// resize дополнительно ловит смену масштаба (devicePixelRatio) без смены размеров.
window.addEventListener('resize', layoutBoard);
layoutBoard();

telegram.init({
  onDeactivated: pauseGame,
  onBackButton() {
    // Только что сменившийся экран (автопауза, ещё не проявившийся экран
    // проигрыша) не уводим сразу в меню одним нажатием.
    if (screen === 'paused' && performance.now() - screenShownAt < TAP_GUARD_MS) return;
    if (screen === 'over' && performance.now() - screenShownAt < OVER_TAP_GUARD_MS) return;
    if (screen === 'playing') pauseGame();
    else if (screen === 'paused' || screen === 'over') goToMenu();
  },
});

setScreen('menu');
// Защита от случайных нажатий нужна только после смены экрана, не при загрузке.
screenShownAt = -Infinity;
publishState();
loop.start();
(window as unknown as { __snakeReady: boolean }).__snakeReady = true;
// Если скрипт пришёл позже 8 секунд, уже показанное сообщение об ошибке убираем.
document.getElementById('boot-error')?.setAttribute('hidden', '');

// Отладочный доступ к состоянию для автоматических проверок в браузере.
// Есть только в режиме разработки (npm run dev), в сборку не попадает.
if (import.meta.env.DEV) {
  (window as unknown as { __snake: unknown }).__snake = {
    get state() {
      return state;
    },
    get screen() {
      return screen;
    },
    get stepMs() {
      return loop.stepMs;
    },
    load(next: GameState) {
      state = next;
      previousSnake = next.snake;
    },
  };
}

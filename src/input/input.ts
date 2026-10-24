// Управление: клавиатура (стрелки, WASD), свайпы и экранные кнопки.
// Модуль только переводит действия игрока в команды, игровых правил здесь нет.

import type { Direction } from '../game/logic';

export interface InputHandlers {
  direction(direction: Direction): void;
  /** Пробел, P или Esc. */
  togglePause(): void;
  /** Enter — начать или повторить игру. */
  confirm(): void;
  /** Идёт ли сейчас игра (и стоит ли перехватывать клавиши). */
  isPlaying(): boolean;
  isPaused(): boolean;
}

// event.code не зависит от раскладки: WASD работает и при русской раскладке (ЦФЫВ).
const KEY_DIRECTIONS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

export function bindKeyboard(handlers: InputHandlers): void {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    const direction = KEY_DIRECTIONS[event.code];
    if (direction) {
      // Не даём стрелкам прокручивать страницу или переключать радиокнопки во время игры.
      if (handlers.isPlaying()) event.preventDefault();
      handlers.direction(direction);
      return;
    }

    if (event.repeat) return;

    if (event.code === 'Space' || event.code === 'KeyP' || event.code === 'Escape') {
      if (handlers.isPlaying() || handlers.isPaused()) {
        event.preventDefault();
        handlers.togglePause();
        return;
      }
    }

    const isEnter = event.code === 'Enter' || event.code === 'NumpadEnter';
    if (isEnter || event.code === 'Space') {
      const target = event.target as HTMLElement | null;
      // Enter на кнопке и пробел на кнопке или переключателе скорости
      // обработает сам элемент. Enter на выбранной скорости запускает игру.
      if (target && target.closest(isEnter ? 'button' : 'button, input, label')) return;
      event.preventDefault();
      handlers.confirm();
    }
  });
}

/** Минимальная длина свайпа в CSS-пикселях. */
const SWIPE_THRESHOLD = 18;

/** Старые WebView (iOS до 13) не знают Pointer Events — там используем touch-события. */
const hasPointerEvents = typeof window !== 'undefined' && 'PointerEvent' in window;

/** Касание экранной кнопки — это нажатие, а не начало свайпа. */
function startsOnButton(target: EventTarget | null): boolean {
  return !!(target as HTMLElement | null)?.closest?.('button, .dpad');
}

/**
 * Свайпы по элементу. Каждый следующий отрезок движения пальца в пределах
 * одного касания тоже засчитывается, поэтому можно провести «уголком»
 * и сделать два поворота подряд.
 */
export function bindSwipe(element: HTMLElement, onDirection: (direction: Direction) => void): void {
  let active = false;
  let pointerId: number | null = null;
  let originX = 0;
  let originY = 0;

  const begin = (x: number, y: number) => {
    active = true;
    originX = x;
    originY = y;
  };

  const move = (x: number, y: number) => {
    if (!active) return;
    const dx = x - originX;
    const dy = y - originY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      onDirection(dx > 0 ? 'right' : 'left');
    } else {
      onDirection(dy > 0 ? 'down' : 'up');
    }
    originX = x;
    originY = y;
  };

  if (hasPointerEvents) {
    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (startsOnButton(event.target)) return;
      pointerId = event.pointerId;
      begin(event.clientX, event.clientY);
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // Не критично.
      }
    });
    element.addEventListener('pointermove', (event) => {
      if (event.pointerId === pointerId) move(event.clientX, event.clientY);
    });
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      active = false;
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
  } else {
    element.addEventListener('touchstart', (event) => {
      if (startsOnButton(event.target)) return;
      const touch = event.touches[0];
      if (touch) begin(touch.clientX, touch.clientY);
    });
    element.addEventListener('touchmove', (event) => {
      const touch = event.touches[0];
      if (touch) move(touch.clientX, touch.clientY);
    });
    element.addEventListener('touchend', () => {
      active = false;
    });
  }

  // Касания по полю не должны прокручивать страницу (страховка к touch-action: none).
  element.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
}

/** Экранные кнопки-стрелки: элементы с атрибутом data-dir внутри root. */
export function bindDpad(root: HTMLElement, onDirection: (direction: Direction) => void): void {
  const readButton = (target: EventTarget | null): HTMLElement | null =>
    (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-dir]') ?? null;
  const readDirection = (button: HTMLElement | null): Direction | null => {
    const dir = button?.dataset.dir;
    return dir === 'up' || dir === 'down' || dir === 'left' || dir === 'right' ? dir : null;
  };

  // Нажатие срабатывает сразу при касании, без задержки click.
  const press = (event: Event) => {
    const button = readButton(event.target);
    const direction = readDirection(button);
    if (!button || !direction) return;
    event.preventDefault();
    onDirection(direction);
    // Подсветка нажатия работает и там, где :active на касании не срабатывает.
    button.classList.add('is-pressed');
    window.setTimeout(() => button.classList.remove('is-pressed'), 140);
  };
  root.addEventListener(hasPointerEvents ? 'pointerdown' : 'touchstart', press, { passive: false });

  // Активация с клавиатуры (Tab + Enter) приходит как click с detail === 0.
  root.addEventListener('click', (event) => {
    if (event.detail !== 0) return;
    const direction = readDirection(readButton(event.target));
    if (direction) onDirection(direction);
  });

  root.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
}

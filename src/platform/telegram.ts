// Интеграция с Telegram Mini Apps (официальный SDK telegram-web-app.js,
// подключён в index.html). Вне Telegram или без сети все вызовы безопасно
// ничего не делают, поэтому игра работает и в обычном браузере.
// Документация: https://core.telegram.org/bots/webapps

/** Только те части Telegram.WebApp, которые использует игра. */
interface TelegramWebApp {
  initData: string;
  platform: string;
  version: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  onEvent(event: string, handler: () => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

/** Цвет фона игры (совпадает с --bg в styles.css). */
const APP_BACKGROUND = '#0a0f14';

function getWebApp(): TelegramWebApp | null {
  const webApp = window.Telegram?.WebApp;
  // SDK загружается и в обычном браузере, но там initData пустая,
  // а platform === 'unknown'. Считаем это режимом «вне Telegram».
  if (!webApp || (!webApp.initData && webApp.platform === 'unknown')) return null;
  return webApp;
}

function supports(webApp: TelegramWebApp, version: string): boolean {
  try {
    return webApp.isVersionAtLeast(version);
  } catch {
    return false;
  }
}

/** Безопасный вызов: ошибка в API Telegram не должна ломать игру. */
function attempt(action: () => void): void {
  try {
    action();
  } catch (error) {
    console.warn('[telegram]', error);
  }
}

export interface TelegramHandlers {
  /** Приложение свёрнуто или стало неактивным. */
  onDeactivated(): void;
  onBackButton(): void;
}

export class TelegramBridge {
  private readonly webApp = getWebApp();

  get isTelegram(): boolean {
    return this.webApp !== null;
  }

  init(handlers: TelegramHandlers): void {
    const webApp = this.webApp;
    document.documentElement.classList.toggle('in-telegram', webApp !== null);
    if (!webApp) return;

    attempt(() => webApp.ready());
    attempt(() => webApp.expand());

    // Свайп вниз по игровому полю не должен сворачивать Mini App (Bot API 7.7+).
    if (supports(webApp, '7.7') && webApp.disableVerticalSwipes) {
      attempt(() => webApp.disableVerticalSwipes!());
    }

    this.applyColors();

    // События activated/deactivated есть с Bot API 8.0.
    if (supports(webApp, '8.0')) {
      attempt(() => webApp.onEvent('deactivated', handlers.onDeactivated));
    }

    if (supports(webApp, '6.1') && webApp.BackButton) {
      attempt(() => webApp.BackButton!.onClick(handlers.onBackButton));
    }
  }

  /**
   * У игры своя тёмная тема, поэтому шапку и фон Telegram красим в её цвет.
   * Произвольный цвет #RRGGBB поддерживается с Bot API 6.9, раньше — только
   * ключевые слова темы; нижняя панель — с 7.10.
   */
  private applyColors(): void {
    const webApp = this.webApp;
    if (!webApp || !supports(webApp, '6.1')) return;
    const color = supports(webApp, '6.9') ? APP_BACKGROUND : 'bg_color';
    attempt(() => webApp.setHeaderColor?.(color));
    attempt(() => webApp.setBackgroundColor?.(color));
    if (supports(webApp, '7.10')) attempt(() => webApp.setBottomBarColor?.(APP_BACKGROUND));
  }

  setBackButtonVisible(visible: boolean): void {
    const button = this.webApp?.BackButton;
    if (!button || !supports(this.webApp!, '6.1')) return;
    attempt(() => (visible ? button.show() : button.hide()));
  }

  hapticImpact(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    const haptic = this.webApp?.HapticFeedback;
    if (!haptic || !supports(this.webApp!, '6.1')) return;
    attempt(() => haptic.impactOccurred(style));
  }

  hapticSelection(): void {
    const haptic = this.webApp?.HapticFeedback;
    if (!haptic || !supports(this.webApp!, '6.1')) return;
    attempt(() => haptic.selectionChanged());
  }

  hapticNotify(type: 'error' | 'success' | 'warning'): void {
    const haptic = this.webApp?.HapticFeedback;
    if (!haptic || !supports(this.webApp!, '6.1')) return;
    attempt(() => haptic.notificationOccurred(type));
  }
}

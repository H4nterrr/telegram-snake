import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Подставляет номер версии в index.html (%APP_VERSION%). */
function appVersion(): Plugin {
  return {
    name: 'app-version',
    transformIndexHtml: (html) => html.split('%APP_VERSION%').join(version),
  };
}

export default defineConfig({
  // Относительные пути: собранную папку dist можно положить в любой
  // подкаталог статического хостинга (например, GitHub Pages /telegram-snake/).
  base: './',
  plugins: [appVersion()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    // Доступ с телефона в той же Wi‑Fi сети для локальной проверки.
    host: true,
  },
  preview: {
    host: true,
  },
  build: {
    // Встроенные браузеры Telegram на старых телефонах бывают не самыми свежими.
    target: 'es2019',
    outDir: 'dist',
    emptyOutDir: true,
    // Все файлы сборки лежат рядом с index.html, без подпапки assets/.
    // Так сайт не сломается, даже если файлы загрузят на хостинг «плоско».
    assetsDir: '',
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

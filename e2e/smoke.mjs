// Проверка готовой игры в настоящем браузере (Chromium, экран телефона).
// Главное: кнопка «Играть» действительно запускает игру и змейка движется —
// именно это сломалось в версии 1.0.0.
//
//   npm run e2e                     — проверить сборку из dist/ (локальный сервер)
//   npm run e2e -- https://адрес/   — проверить опубликованную игру
//
// Перед первым запуском: npx playwright install chromium

import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const target = process.argv[2];

let server;
let url = target;
if (!url) {
  server = await preview({ preview: { port: 4317, strictPort: false, host: '127.0.0.1' }, logLevel: 'silent' });
  url = server.resolvedUrls.local[0];
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 760 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  // Считаем подписки на события, чтобы убедиться: повторные игры их не множат.
  await context.addInitScript(() => {
    window.__listeners = 0;
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (...args) {
      window.__listeners++;
      return original.apply(this, args);
    };
  });
  const page = await context.newPage();
  const problems = [];
  const origin = new URL(url).origin;
  page.on('pageerror', (error) => problems.push(`ошибка JS: ${error.message}`));
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().startsWith(origin)) {
      problems.push(`HTTP ${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) problems.push(`не загрузилось: ${request.url()}`);
  });

  const screen = () => page.evaluate(() => document.documentElement.dataset.screen);
  const board = () => page.evaluate(() => ({ ...document.getElementById('board').dataset }));
  const waitFor = async (fn, timeout = 4000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await fn()) return true;
      await wait(25);
    }
    return false;
  };
  /** Сколько ходов змейка сделала за ms миллисекунд. */
  const countMoves = (ms) =>
    page.evaluate(
      (duration) =>
        new Promise((resolve) => {
          const canvas = document.getElementById('board');
          let last = canvas.dataset.head;
          let moves = 0;
          const start = performance.now();
          const tick = () => {
            if (canvas.dataset.head !== last) {
              moves++;
              last = canvas.dataset.head;
            }
            if (performance.now() - start < duration) requestAnimationFrame(tick);
            else resolve(moves);
          };
          requestAnimationFrame(tick);
        }),
      ms,
    );

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__snakeReady === true, null, { timeout: 10000 }).catch(() => {});
  const ready = await page.evaluate(() => window.__snakeReady === true);
  check('скрипт игры загрузился и запустился', ready, problems.join('; '));
  if (!ready) throw new Error('игра не запустилась, остальные проверки пропущены');
  page.setDefaultTimeout(8000);
  const shownVersion = await page.textContent('#version');
  check(`открыта версия v${version}`, shownVersion?.trim() === `v${version}`, `на странице: ${shownVersion}`);
  check('стартовый экран с кнопкой «Играть»', (await screen()) === 'menu' && (await page.isVisible('#play-button')));

  // 1. «Играть» запускает игру, змейка движется.
  const before = await board();
  await page.tap('#play-button');
  check('«Играть» открывает игровой экран', await waitFor(async () => (await screen()) === 'playing', 1000), await screen());
  check(
    'после «Играть» змейка движется',
    await waitFor(async () => (await board()).head !== before.head, 1500),
    `голова: ${before.head} → ${(await board()).head}`,
  );
  const boardUncovered = () =>
    page.evaluate(() => {
      const b = document.getElementById('board').getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const menu = getComputedStyle(document.getElementById('menu'));
      return el !== null && el.closest('#board-wrap') !== null && menu.visibility === 'hidden';
    });
  check('стартовый экран исчезает и не перекрывает поле', await waitFor(boardUncovered, 1000));

  // 2. Управление с первого хода и запрет разворота.
  await page.tap('.dpad-btn.up');
  check('стрелка «вверх» поворачивает змейку', await waitFor(async () => (await board()).direction === 'up', 600));
  await page.tap('.dpad-btn.down');
  await wait(300);
  let b = await board();
  check('разворот на 180° запрещён', b.direction === 'up' && b.status === 'running', `${b.direction}/${b.status}`);
  await page.tap('.dpad-btn.left');
  await page.tap('.dpad-btn.down');
  await wait(400);
  b = await board();
  check('быстрые «влево → вниз» без разворота внутрь себя', b.direction === 'down' && b.status === 'running', `${b.direction}/${b.status}`);

  // 3. Свайп настоящим касанием и отсутствие прокрутки.
  const cdp = await context.newCDPSession(page);
  const box = await page.locator('#board').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + i * 14, y: cy }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('свайп вправо поворачивает змейку', await waitFor(async () => (await board()).direction === 'right', 600));
  check('страница не прокручивается', await page.evaluate(() => window.scrollY === 0 && document.scrollingElement.scrollTop === 0));

  // 4. Пауза и продолжение без скачков.
  await page.tap('#pause-button');
  check('пауза', (await screen()) === 'paused');
  const frozen = (await board()).head;
  await wait(500);
  check('на паузе змейка стоит', (await board()).head === frozen);
  await wait(400);
  await page.tap('#resume-button');
  const resumedAt = (await board()).head;
  await wait(40);
  check('после продолжения нет мгновенного хода', (await board()).head === resumedAt);
  check('после продолжения змейка снова движется', await waitFor(async () => (await board()).head !== resumedAt, 800));

  // 5. Проигрыш и быстрый повтор.
  check('столкновение со стеной → «Игра окончена»', await waitFor(async () => (await screen()) === 'over', 6000));
  await wait(750);
  check('экран проигрыша виден', await page.evaluate(() => Number(getComputedStyle(document.getElementById('over')).opacity) > 0.95));
  await page.tap('#restart-button');
  b = await board();
  check('«Ещё раз» начинает новую игру', (await screen()) === 'playing' && b.score === '0' && b.length === '3', JSON.stringify(b));

  // 6. Повторные запуски не создают лишних циклов и обработчиков.
  const listenersBefore = await page.evaluate(() => window.__listeners);
  for (let i = 0; i < 3; i++) {
    await page.tap('#pause-button');
    await wait(380);
    await page.tap('#pause-menu-button');
    await page.tap('#play-button');
  }
  const moves = await countMoves(840);
  // «Обычная» скорость — ход раз в 120 мс: за 840 мс около 7 ходов. Два цикла дали бы ~14.
  check('после нескольких перезапусков скорость прежняя (один игровой цикл)', moves >= 5 && moves <= 8, `ходов: ${moves}`);
  check('обработчики событий не дублируются', (await page.evaluate(() => window.__listeners)) === listenersBefore);

  // 7. Смена скорости и рекорды по скоростям.
  await page.tap('#pause-button');
  await wait(380);
  await page.tap('#pause-menu-button');
  await page.tap('label.speed:has(input[value="fast"])');
  await page.tap('#play-button');
  check('выбрана «Быстрая»', (await board()).speed === 'fast');
  const fastMoves = await countMoves(560);
  // 80 мс на ход: за 560 мс около 7 ходов.
  check('«Быстрая» действительно быстрее', fastMoves >= 5 && fastMoves <= 8, `ходов: ${fastMoves}`);
  await page.tap('#pause-button');
  await page.evaluate(() => localStorage.setItem('telegram-snake:records:v1', JSON.stringify({ easy: 4, normal: 9, fast: 2 })));
  await page.reload();
  await page.waitForFunction(() => window.__snakeReady === true);
  check('скорость запоминается', await page.isChecked('input[value="fast"]'));
  check('рекорд «Быстрой» = 2', (await page.textContent('#menu-best')) === '2');
  await page.tap('label.speed:has(input[value="easy"])');
  check('рекорд «Лёгкой» = 4', (await page.textContent('#menu-best')) === '4');

  // 8. Изменение размера во время игры.
  await page.tap('#play-button');
  await page.setViewportSize({ width: 360, height: 640 });
  await wait(250);
  b = await board();
  const fits = await page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const inside = (x) => x.top >= 0 && x.left >= 0 && x.bottom <= innerHeight + 0.5 && x.right <= innerWidth + 0.5;
    return inside(r('board')) && inside(r('dpad')) && r('board').bottom <= r('dpad').top;
  });
  check('после изменения размера игра продолжается, поле и стрелки на экране', (await screen()) === 'playing' && b.status === 'running' && fits);

  check('нет ошибок JS и недогруженных файлов', problems.length === 0, problems.join('; '));
} catch (error) {
  check('проверка завершилась без исключений', false, error.stack);
} finally {
  await browser.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n✗ Не пройдено проверок: ${failed} из ${results.length}` : `\n✓ Все проверки пройдены (${results.length})`);
process.exit(failed ? 1 : 0);

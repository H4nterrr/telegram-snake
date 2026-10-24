// Проверка готовой сборки перед публикацией.
// Защищает от ошибки, из-за которой в версии 1.0.0 не работала кнопка «Играть»:
// index.html ссылался на файлы, которых не было рядом с ним на хостинге.
//
// Запуск: node scripts/check-dist.mjs [папка], по умолчанию dist.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const errors = [];
const fail = (message) => errors.push(message);

const indexPath = join(dir, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`✗ Нет файла ${indexPath}. Сначала выполните сборку: npm run build`);
  process.exit(1);
}

const html = readFileSync(indexPath, 'utf8');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// Все локальные ссылки из src="..." и href="...".
const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const local = refs.filter((ref) => !/^(https?:)?\/\//.test(ref) && !ref.startsWith('data:') && !ref.startsWith('#'));

for (const ref of local) {
  if (ref.startsWith('/')) {
    fail(`Абсолютный путь «${ref}» сломается на GitHub Pages (сайт лежит в подпапке /telegram-snake/). Нужен относительный путь.`);
    continue;
  }
  const file = join(dir, ref.replace(/^\.\//, '').split(/[?#]/)[0]);
  if (!existsSync(file)) fail(`index.html ссылается на «${ref}», но такого файла нет в сборке.`);
}

const scripts = local.filter((ref) => /\.js$/.test(ref));
if (scripts.length === 0) fail('В index.html нет подключённого скрипта игры (.js).');
if (!local.some((ref) => /\.css$/.test(ref))) fail('В index.html нет подключённых стилей (.css).');
if (html.includes('/src/')) fail('В собранном index.html осталась ссылка на исходники /src/.');
if (!html.includes('telegram-web-app.js')) fail('Не подключён Telegram Web Apps SDK.');
if (html.includes('%APP_VERSION%')) fail('Номер версии не подставлен в index.html.');
if (!html.includes(`data-version="${version}"`)) fail(`В index.html нет номера версии ${version}.`);

// Все файлы лежат рядом с index.html: сайт переживёт даже «плоскую» загрузку.
const nested = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
if (nested.length > 0) fail(`В сборке есть подпапки (${nested.join(', ')}). Ожидаются файлы только рядом с index.html.`);

// В стилях не должно быть абсолютных url(/...) — они сломаются в подпапке.
for (const style of local.filter((ref) => /\.css$/.test(ref))) {
  const file = join(dir, style.replace(/^\.\//, ''));
  if (existsSync(file) && /url\(\s*['"]?\//.test(readFileSync(file, 'utf8'))) {
    fail(`В ${style} есть абсолютный путь url(/...).`);
  }
}

// Отладочный доступ к состоянию не должен попасть в сборку.
for (const script of scripts) {
  const file = join(dir, script.replace(/^\.\//, ''));
  if (!existsSync(file)) continue; // об отсутствии файла уже сообщено выше
  const code = readFileSync(file, 'utf8');
  if (code.includes('__snake =') || code.includes('__snake=')) fail(`Отладочный код попал в сборку (${script}).`);
}

if (errors.length > 0) {
  console.error('✗ Сборка не готова к публикации:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`✓ Сборка v${version} готова к публикации: ${local.length} локальных файлов на месте, пути относительные.`);

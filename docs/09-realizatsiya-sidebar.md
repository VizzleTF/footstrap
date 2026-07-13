# Реализация варианта 1A — Sidebar Console

Спека того, что и как меняется в `luci-theme-footstrap` для sidebar-раскладки.
Порядок работ и проверка — в конце.

## Целевая раскладка

```
┌──────────────────────────────────────────────────┐
│ .fs-sidebar 224px │ .fs-main (flex:1)            │
│ (rail: 68px)      │ ┌──────────────────────────┐ │
│  [лого] hostname ◂│ │ .fs-content:             │ │
│  #indicators      │ │  предупреждения          │ │
│  МЕНЮ             │ │  #tabmenu (вкладки)      │ │
│  ▸ Status ●       │ │  #view (контент)         │ │
│  ▸ System         │ │                          │ │
│  ▸ Network        │ ├──────────────────────────┤ │
│  …                │ │ footer.fs-footer         │ │
│  [spacer]         │ └──────────────────────────┘ │
│  Appearance [◐]   │                              │
│  ▸ Log out        │                              │
└──────────────────────────────────────────────────┘
```

Отдельного topbar в `main` нет: заголовок страницы — визуально скрытый `<h1>`
(`.fs-title[hidden]`, нужен для порядка заголовков и скринридера), а `#indicators`
(поллинг «Refreshing», несохранённые изменения) живёт в сайдбаре. Кнопка `◂`
(`#fs-rail-toggle`) сворачивает сайдбар в 68px-рельс с иконками и флайаутами.

## Маппинг LuCI-контейнеров на sidebar

LuCI-меню рендерит клиентский JS в фиксированные контейнеры (док 01/04). Пере-
назначаем их:

| LuCI-контейнер | В bootstrap | В footstrap sidebar |
|---|---|---|
| `#topmenu` | горизонт. меню верхних разделов | **вертикальный список в сайдбаре** (`ul.nav`, Status/System/Network/…) |
| `#modemenu` | breadcrumb-переключатель admin/status | `.fs-modemenu` в сайдбаре; пустой/единственный режим → `display:none` |
| `#tabmenu` | вкладки под шапкой | остаётся в main, над `#view` (контейнер эмитит `partials/notices.ut`) |
| `#indicators` | правый угол шапки | `.fs-indicators` в сайдбаре под брендом; пустой → скрыт |
| `#view` | контент | контент (main column) |

Верхние разделы LuCI (Status, System, Services, Network, VPN, …) приходят из
дерева меню — их набор зависит от установленных пакетов, **не хардкодить**.

## Изменения по файлам

### 1. `htdocs/luci-static/footstrap/fonts/`

Самохостинг шрифтов (роутер офлайн, без Google Fonts). Каждое начертание разбито
по `unicode-range` на три сабсета — латиница, latin-ext, кириллица:
- `manrope-{600,700}-{latin,latinext,cyrillic}.woff2`
- `jetbrains-mono-{400,600}-{latin,latinext,cyrillic}.woff2`
- `@font-face` — в `styles/01-fonts.css` (нижний слой сборки, без `@layer`:
  `@font-face` объявляет ресурс, а не правило).

Взято из google-webfonts-helper или репозиториев шрифтов (OFL/Apache — можно
класть в пакет). Fallback: `system-ui, sans-serif` / `ui-monospace, monospace`.
Латинские сабсеты Manrope 600/700 ещё и предзагружаются (`<link rel=preload>` в
`partials/head.ut`) — ими рисуется сам хром.

### 2. `cascade.css` — стратегия

`cascade.css` **генерируется**: `build-css.sh` склеивает дерево `styles/` (один
каталог на каскадный слой, префикс имени файла = порядок) и вырезает комментарии;
редактировать сам файл нельзя, он в `.gitignore`. Порядок слоёв —
`tokens, base, theme, page` (док 17). Устройство:

1. **Токены** — `styles/02-tokens.css` (палитро-независимое: тени, радиусы,
   шрифты, z-index) + `styles/03-palettes.css` (цвета, блок на палитру × режим;
   док 08). ДВА ЯРУСА, и разделение несущее: приватные `--fs-*` (их читают ВСЕ правила
   темы, включая `styles/base`) и экспортный ярус `--*-color-*` — имена, которые
   LuCI-темы отдают годами. Экспорт определяется ИЗ приватного яруса и **не читается
   изнутри темы никем**: он существует только ради сторонних `luci-app-*`. Раньше `base`
   читал именно экспортные имена, и любое приложение, объявившее `:root{--text-color-high}`,
   молча перекрашивало тему (312 из 336 элементов). См. CLAUDE.md и `02-tokens.css`.
   ```css
   :root {
     --fs-panel: …; --fs-border: …; --fs-accent: …;   /* приватные — их читает тема */
     --background-color-high: var(--fs-panel);        /* экспорт — только наружу */
   }
   ```
2. **Раскладка** — `styles/theme/20-shell.css`: `.fs-shell{display:flex}`,
   `.fs-sidebar` шириной `--fs-sidebar-w` (224px; свёрнутый рельс — `--fs-rail-w`, 68px —
   оба ТОКЕНЫ, их читает и `fitShell()` в JS), `.fs-main` flex-column. Панель — база,
   вертикальный сайдбар — единственный загарденный оверрайд; см. CLAUDE.md. Общий с top-nav хром (бренд, лого, логаут,
   индикаторы, примитивы `ul.nav`) — в `styles/theme/10-chrome.css`.
3. **Компоненты** — по файлу на тему: `.cbi-progressbar` (трек 10px,
   `--fs-radius-pill`, заливка `--fs-accent`), панели-карточки (`--fs-radius-lg`,
   `--fs-panel`, `--fs-border`), таблицы, alert'ы, вкладки, кнопки, инпуты, модалки.

Контракт `data-darkmode` (док 04) держим, но **без symlink-тем**: режим
(auto/light/dark) и палитра — клиентские, из `localStorage`, применяются
инлайновым скриптом в `partials/head.ut` до первой отрисовки; auto по-прежнему
слушает `matchMedia('(prefers-color-scheme: dark)')`.

### 3. `ucode/template/themes/footstrap/header.ut`

- Общая часть обоих раскладок вынесена в `partials/` (`head`, `brand`,
  `appearance`, `logout`, `notices`, `footer`) — их же инклюдит `footstrap-top`.
- `<body>` → обёртка `.fs-shell` (flex). Перед ней — skip-link `.fs-skip`
  («Skip to content» → `#maincontent`), первый таб-стоп страницы.
- **Sidebar** — `<nav class="fs-sidebar" aria-label="Menu">` (именно `<nav>`:
  `<aside>` даёт роль `complementary`, и по лендмарку до меню было не допрыгнуть):
  - `.fs-brandrow`: бренд (градиентный квадрат + wifi-SVG на `currentColor` +
    wordmark hostname/OpenWrt) + кнопка `#fs-rail-toggle` (свернуть в рельс);
  - `<div id="indicators">`;
  - `.fs-navlabel` («Menu») + `<ul class="nav" id="topmenu">` (пустой, наполнит
    menu-JS вертикально) + `<ul id="modemenu">`;
  - spacer `flex:1`;
  - кнопка Appearance (`#fs-appearance`, поповер: режим/палитра/обои/скругление);
  - Log out (`{{ dispatcher.build_url('admin/logout') }}` если есть).
- **Main**: `<main class="fs-main" id="maincontent" tabindex="-1">` — скрытый
  `<h1>` (`.fs-title`, заголовок документа для скринридера) и `.fs-content`
  (предупреждения, `#tabmenu`, `#view`, `footer`).
- Сохранить обязательное: `http.prepare_content`, cbi.js, переводы, `node.css`,
  `css`, `data-page`, `blank_page`, noscript, предупреждения (no-password,
  initramfs) — из дока 03/06.

### 4. `htdocs/luci-static/resources/menu-footstrap.js`

- `renderMainMenu` → вертикальный список в `#topmenu`: пункт =
  `<li><a><icon><span class="fs-label">title</span><chevron></a></li>`, активный
  класс по `dispatchpath`. Всё общее (табы, режимы, поповер Appearance, рельс,
  SPA-роутер) живёт в `menu-footstrap-common.js`; layout-специфичен только
  `renderMainMenu`, он передаётся в `common.init()` (композиция, а не наследование —
  LuCI делает из каждого baseclass синглтон).
- Иконки: map по имени/пути раздела (`status`→dashboard-иконка, `system`→gear,
  `network`→network, `vpn`, `docker`, …), fallback — generic SVG. Набор SVG —
  инлайн в JS (как в макете).
- `#tabmenu` — горизонтальный, в main (`renderTabMenu` в common.js).
- `#modemenu` — если >1 режима, показать; иначе скрыть.
- Раздел с детьми — **disclosure-паттерн W3C APG**, а не ссылка: `role="button"`,
  `aria-expanded`, `aria-controls`, Enter/Space, Escape закрывает флайаут и
  возвращает фокус на триггер. Осознанно **не** `role="menu"` (APG: навигация
  сайта не должна брать семантику menubar).
- Два смысла `.open`: в развёрнутом сайдбаре — аккордеон (можно держать
  несколько секций открытыми, набор помнится в `localStorage` `fs-menu-open`), в
  рельсе и на телефоне (≤767px) — эксклюзивный флайаут. На выходе из
  флайаут-режима аккордеон восстанавливается (`restoreAccordion()`).
- Переключатель темы: не тумблер в сайдбаре, а поповер Appearance
  (`#fs-appearance`, обработчик в common.js): режим/палитра/обои/скругление
  тогглят `data-darkmode`/`data-palette`/`data-wallpaper`/`--fs-radius-base` на
  `:root` и сохраняются в `localStorage` — только клиент, без сервера и
  перезагрузки. Раскладка (sidebar/top) остаётся серверным выбором в списке тем.

## Порядок работ

1. Шрифты в `fonts/` + `@font-face`.
2. `cascade.css`: переменные-мост (old→new) + токены обеих схем. Проверить, что
   стандартный overview не сломался (цвета применились).
3. `cascade.css`: sidebar-раскладка + компоненты.
4. `header.ut`: sidebar + main.
5. `menu-footstrap.js`: вертикальное меню + иконки + поповер Appearance.
6. Деплой `dev-sync.sh`, `ucode -c` шаблонов, live-render на `ssh router`
   (временная активация + curl + откат, см. док 05).

## Проверка (Definition of Done для 1A)

- [ ] `ucode -c` header/footer + `partials/*` — OK
- [ ] Активация footstrap → нет fallback/error500
- [ ] Sidebar рендерится, верхние разделы кликабельны, активный подсвечен
- [ ] Status→Overview: панели-карточки, прогресс-бары памяти/диска в стиле макета
- [ ] Вкладки раздела (#tabmenu) работают
- [ ] Appearance меняет dark/light; auto по системной
- [ ] Мобильная ширина (≤767px): sidebar превращается в верхний бар
- [ ] Логин в стиле темы (своего `sysauth.ut` тема не несёт — страница логина
      стоковая, оформляется CSS: `styles/pages/10-login.css`)
- [ ] Откат на bootstrap чистый

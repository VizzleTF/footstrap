# Дизайн-система footstrap

Референс-макеты: `docs/design/`.

Макет даёт **два направления одной системы**: 1A Sidebar Console (навигация
слева) и 1B Bento Grid (навигация сверху). Обе используют одинаковые токены и
компоненты — отличается только раскладка хрома. Реализуем в порядке:
**сначала sidebar (1A), потом top nav (1B)**.

## Токены (CSS custom properties)

Обе схемы — один набор переменных, разные значения. Режим переключается
атрибутом `data-darkmode` на `:root` (док 04): светлая — голый `:root`, тёмная —
`:root[data-darkmode="true"]`. Цвета лежат в `styles/03-palettes.css` (палитра =
блок на режим), всё палитро-независимое (тени, радиусы, шрифты, z-index, мост на
`--*-color-*`) — в `styles/02-tokens.css`.

Палитр две: **footstrap** (GitHub Primer, дефолт — заполняет голый `:root`) и
**hicontrast** (опция, `data-palette="hicontrast"`).

### Light (дефолт, палитра footstrap)

```css
--bg:          #f6f8fa;   /* фон страницы */
--panel:       #ffffff;   /* карточка/сайдбар/топбар */
--panel2:      #f6f8fa;   /* вложенная плитка (порт, device-strip) */
--border:      #d0d7de;
--text:        #1f2328;
--dim:         #656d76;    /* вторичный текст, лейблы */
--faint:       #68727e;    /* третичный: заголовок флайаута, rail-toggle */
--accent:      #0969da;
--accent-lt:   #54aeff;    /* светлый конец градиента лого */
--accent-soft: rgba(9,105,218,.10);   /* фон активного пункта/бейджа */
--track:       #eaeef2;    /* трек прогресс-бара, off-состояние */
--good:        #197c36;    /* success/link up */
--warn:        #946300;    /* warning/half-duplex */
--danger:      #cf222e;    /* error/высокая загрузка */
/* чернила НА заливках accent/good/warn/danger */
--on-accent: #fff; --on-good: #fff; --on-warn: #fff; --on-danger: #fff;
```

### Dark (палитра footstrap)

```css
--bg:          #1c2128;
--panel:       #22272e;
--panel2:      #2d333b;
--border:      #444c56;
--text:        #adbac7;
--dim:         #8f9cab;
--faint:       #959ca5;
--accent:      #569df5;
--accent-soft: rgba(86,157,245,.15);
--track:       #373e47;
--good:        #5aad5d;
--warn:        #c79128;
--danger:      #ea7a74;
/* заливки тёмной палитры светлые → чернила на них тёмные */
--on-accent: #10151c; --on-good: #10151c; --on-warn: #10151c; --on-danger: #10151c;
```

Четыре «чернильных» токена — на палитру И на режим. Единый глобальный
`--on-accent: #fff` (как было) на тёмных палитрах давал 2.8–3.7:1 и не проходил
WCAG AA; каждая пара «заливка + чернила» выше держит ≥4.5:1.

Палитра **hicontrast** — те же токены, глубже и насыщеннее. Её светлые
`--accent/--good/--warn/--danger` специально затемнены (`#0b6fbd`, `#0f7a52`,
`#8a5a00`, `#c02b2b`): раньше они были ярче дефолтных, и палитра с именем
«hicontrast» контрастила хуже дефолта (`--good #17b978` лейблом на `--panel` —
2.55:1 против 5.08:1).

Тень — `--fs-shadow` (light `0 1px 3px rgba(15,23,37,.08)`, dark
`0 1px 2px rgba(0,0,0,.4)`); всплывающие поверхности — `--fs-shadow-pop`.

Режим (auto/light/dark), палитра, обои и радиус скругления переключаются в
поповере Appearance (кнопка `#fs-appearance`, сегментированный `.fs-seg`) и
хранятся в `localStorage` (`fs-darkmode`, `fs-palette`, `fs-wallpaper`,
`fs-radius`); инлайновый скрипт в `partials/head.ut` применяет их до первой
отрисовки.

## Типографика

- Sans: **Manrope** (600/700) — интерфейс, заголовки. Веса 400 нет: `normal`
  разрешается по font-matching в 600, тело страницы рисуется semibold.
- Mono: **JetBrains Mono** (400/600) — все числовые значения, hostname,
  версии, имена портов, тех.данные.
- Правило: любое машинное/числовое значение → mono. Подписи/лейблы → sans dim.

Размеры (px): заголовок карточки 14/700; KPI-число 27/700 mono; крупное число
(кольцо/uptime) 38–40/700 mono; тело 13–14; лейбл uppercase 11/700
`letter-spacing:.05em`; микроподпись 11–12 dim. Вес 800 из макета не грузится
(лишние 18 КБ на шесть элементов) — всё, что просило 800, рисуется 700.

Шрифты **самохостятся** (роутер офлайн, CSP, приватность): `.woff2` лежат в
`htdocs/luci-static/footstrap/fonts/`, `@font-face` — в `styles/01-fonts.css`,
каждое начертание разбито по `unicode-range` на latin / latin-ext / cyrillic,
так что английский UI не тянет кириллицу и наоборот. См. док 09.

## Компоненты (визуальные примитивы → на что мапятся в LuCI)

| Компонент макета | Спека | LuCI-класс для стилизации |
|---|---|---|
| **Панель/карточка** | `background:var(--panel); border:1px solid var(--border); border-radius:var(--radius-lg); padding:16px` | `.cbi-section`, `.cbi-map > *`, `.table` контейнеры |
| **KPI-карточка** | radius 15px, padding 15–16, колонка: лейбл-uppercase + число-mono-27 + подпись-dim | нет прямого аналога — блоки status overview |
| **Прогресс-бар** | трек `height:10px; background:var(--track); border-radius:var(--radius-pill)`; заливка `background:var(--accent)`, значение (`title`) mono/dim над правым краем | `.cbi-progressbar` (LuCI рисует его в overview: память/диск) |
| **Бейдж %** | `font:11/700; border-radius:6px; padding:2px 7px`; цвет+фон soft по статусу (danger/accent/good) | инлайн-статус в `.cbi-progressbar`, zonebadge |
| **Pill статуса** | `border-radius:var(--radius-pill); padding:4px 11px`; фон `--panel2`, рамка `--border`, активный — текст `--good` | индикаторы `#indicators [data-indicator]` (LuCI: «Refreshing», несохранённые изменения) |
| **Живая точка** | 8px круг, `animation:livepulse 2s infinite` (только good) | в теме не реализована: своего online-индикатора в хроме нет, в свёрнутом rail «Refreshing» рисуется крутящимся глифом (`fs-spin`) |
| **Пункт меню** | `padding:10px 11px; border-radius:10px; gap:11px`; активный — `background:var(--accent-soft); color:var(--accent)`; неактивный — `color:var(--dim)` | `#topmenu li a`, sidebar nav (наш menu-JS) |
| **Логотип** | 30px квадрат `border-radius:var(--radius); background:linear-gradient(135deg,var(--accent),var(--accent-lt))` + SVG wifi-иконка на `currentColor` (`color:var(--on-accent)` — следует палитре и режиму) + wordmark 16/700 | `.fs-brand`/`.fs-logo` в `partials/brand.ut` |
| **Переключатель темы** | поповер Appearance: сегменты `.fs-seg` (auto/light/dark), палитра, обои, слайдер скругления | `#fs-appearance` + `data-darkmode`/`data-palette` (наш JS, `localStorage`) |
| **Строка таблицы** | `display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--border)`; лейбл dim, значение mono | `.cbi-value`, `.table .tr` |
| **Кольцо (donut)** | SVG r=66, `stroke-width:15`, трек `--track`, дуга по статусу, `stroke-linecap:round` | контент view (не тема) — см. границы |
| **Спарклайн** | inline SVG polyline `stroke:var(--accent); stroke-width:1.8` | контент view (не тема) |
| **Порт-плитка** | `--panel2` фон, radius 12, точка статуса + имя-mono + скорость-dim | контент view (не тема) |

Радиусы-шкала — токены (`styles/02-tokens.css`), а не литералы: одна база
`--fs-radius-base` (12px по умолчанию, слайдер Rounding 0–20px в Appearance),
от неё пропорционально считаются `--radius-lg` (карточки, панели, модалки,
поповеры = база), `--radius` (контролы: инпуты, кнопки, дропдауны, вкладки,
пункт меню, лого — 10 при базе 12) и `--radius-sm` (чипы, код, мелкие вставки —
8 при базе 12). Пилюли/тумблеры — `--radius-pill` (999px), всегда круглые.

## Границы: что делает ТЕМА, а что — приложение

**Критично для честных ожиданий.** LuCI рендерит контент страниц на клиенте
из view-JS приложений (`luci-mod-status`, `luci-mod-system`, …). Тема отдаёт
только серверный хром (header/footer) + общий CSS (см. док 01).

Тема **может** (без правки приложений):
- Sidebar/topnav хром, лого, индикаторы, переключатель темы.
- Задать весь дизайн-язык через `cascade.css` + переменные: панели, радиусы,
  шрифты, цвета. Стандартные виджеты (cbi-таблицы, `.cbi-progressbar`, кнопки,
  alert, dropdown, вкладки) станут выглядеть в новом стиле.
- Стандартный Status→Overview автоматически получит панели-карточки, mono-числа,
  цветные прогресс-бары памяти/диска.

Тема **не может** (это контент, а не оформление):
- Превратить overview в точный KPI-дэшборд с кольцом памяти, спарклайном load,
  графической «задней панелью» портов. Такой layout генерит view-JS
  (`luci-mod-status/.../view/status/include/*.js`) — его структура фиксирована
  приложением. Кольцо/спарклайн/port-strip — это **отдельный view-мод**
  (пакет `luci-app-*` или переопределение status include), фаза за рамками темы.

**Вывод по фазам:**
1. **Тема (сейчас):** хром sidebar/topnav + дизайн-язык CSS. Overview выглядит
   стильно; его секции остаются стоковыми — тема лишь **переставляет** их
   (`htdocs/luci-static/resources/view/status/include/05_footstrap_overview_layout.js`:
   аддитивный layout-only include, System слева, Memory/Storage справа; своего
   контента не рисует).
2. **Опционально позже:** кастомный status-view (KPI/кольцо/порты как в макете) —
   отдельный пакет-мод, использует токены темы.

Эта дока описывает полную систему; доки 09 (sidebar) и 10 (topnav) — что именно
и как из неё реализуется в теме.

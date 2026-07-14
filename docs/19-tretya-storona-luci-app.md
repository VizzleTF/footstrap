# 19. Третьесторонние `luci-app-*` в footstrap: что они делают и какие правила из этого следуют

Дата: 2026-07-14. Проверено по исходникам (тарболлы с GitHub, июль 2026) и на живом роутере
(OpenWrt 25.12.2, playwright): 20 приложений, из них 6 прокси-стека (OpenClash, passwall,
passwall2, ssr-plus, mosdns, vssr), 5 клеш/михомо-обвязок (ssclash, podkop, justclash,
homeproxy, nikki/mihomo), 4 «тяжёлых» (dockerman, diskman, istore+`luci-lib-taskd`,
AdGuardHome), плюс стоковые `openwrt/luci` (filemanager, package-manager, ttyd, statistics,
olsr-viz, banip, adblock, adblock-fast) как база сравнения.

Повод: у `luci-app-ssclash` конфиг-редактор рисовался чёрным прямоугольником без текста и
раздувал страницу до 2 007 346 px. Причина оказалась не в приложении, а в теме — и это
заставило пересмотреть весь контракт «тема ↔ чужое приложение».

---

## Часть 1. Что чужое приложение реально делает

### 1.1. Инжектит CSS в `<head>` — и он переживает SPA-навигацию

Полная страница выбрасывает такой `<style>` вместе с документом, поэтому приложение
справедливо считает его «своим на одну страницу». Наш SPA-роутер документ не перезагружает,
и CSS остаётся навсегда.

Кто именно (проверено):

| Приложение | Что вешает в `<head>` | Когда |
|---|---|---|
| `luci-app-filemanager` (сток) | `.cbi-button-save/-apply/-reset { display:none !important }`, `.cbi-page-actions`, `.cbi-progressbar`; форк sbwml — ещё и голые `th`/`td`/`tr:hover`/`.table` | на каждый рендер |
| `luci-app-filemanager` (сток, новая версия) | `:root { color-scheme: light dark; --light-bg:… }` — 11 своих свойств и `color-scheme` на `:root` | на рендер |
| `HexEditor.js` (там же) | `:root { --clr-background:… }` | **на eval модуля** |
| `luci-app-banip`, `luci-app-adblock` | `<link>` на `custom.css`, где `.cbi-input-text`, `.cbi-input-select` | **на eval модуля** |
| `luci-app-olsr-viz` | `.label { color:black; background:white }` | на рендер |
| `luci-app-openvpn` (сток) | `h4 { white-space:nowrap; … }` | на рендер |
| `luci-app-adblock-fast` | `#cbi-adblock-fast-config-_log_viewer { display:block !important }` | на рендер |
| `luci-app-podkop` | 4 КБ: `#cbi-podkop-*`, `.centered`, `.rotate`, `.skeleton`, `.toast*`, `@keyframes spin` | **на каждый рендер, без дедупа** |
| `luci-app-mosdns` | три `<link>` на CodeMirror 5 (+ `dracula`) | на каждый рендер |
| ACE (`luci-app-ssclash` и все, кто везёт `ace.js`) | `ace_editor.css` (14 КБ), `error_marker.css` | **на eval модуля** |

Ключевое различие — не «`<style>` или `<link>`», а **кто сможет вернуть CSS обратно**:

* инжект **в рендере** (filemanager, podkop) приложение повторит при повторном рендере;
* инжект **на eval модуля** (ACE, HexEditor, banip, adblock) не повторится **никогда** —
  модуль закэширован на всю жизнь документа. Удалить такой лист = сломать приложение до
  перезагрузки страницы. Именно это и происходило со SSClash.

Отдельно: `<style>`/`<link>` **внутри дерева вьюхи** (package-manager, nftables, aria2,
openlist, v2raya, ustreamer, nlbwmon) — безвредны: умирают вместе с содержимым `#view`.

### 1.2. Нюхает тёмную тему — четырьмя разными способами

Стандарта нет, поэтому приложения гадают:

* **`[data-theme="dark"]` на `:root`** — `luci-app-justclash` (21 правило);
* **`:root[data-darkmode="true"]`** — `luci-app-internet-detector` (и его же пишет OpenClash);
* **`data-bs-theme`** (конвенция Bootstrap 5) — `luci-app-ssclash` проверяет первым;
* **яркость `getComputedStyle(document.body).backgroundColor`** — ssclash (fallback),
  OpenClash (`common.js: isDarkBackground`), passwall (четыре копии YIQ-функции в
  `nodes_*_com.htm`). OpenClash по результату **сам стампит `data-darkmode` на наш `:root`**;
* **`@media (prefers-color-scheme: dark)`** — netspeedtest, vssr, passwall, ustreamer. Это
  **ОС**, а не тема: пользователь с тёмной темой на светлой ОС получает светлые карточки на
  тёмной странице. Средствами CSS это неисправимо в принципе.

### 1.3. Прочее, что ломает или могло бы ломать

* **z-index-войны**: passwall — `2147483647` на выпадашке, OpenClash — `999999 !important`,
  dockerman/diskman — оверлеи на `20000`, podkop — `.toast-container { position:fixed; z-index:9999 }`
  в `document.body`.
* **Глобальные ресеты в CSS приложения**: OpenClash `*{margin:0;padding:0}` (дважды — в
  `tblsection.htm` и в `oc.css`), vssr `@import "pure.css"`.
* **Дженерик-классы, забранные под себя**: `.hidden`, `.label`, `.description`, `.centered`,
  `.skeleton`, `.toast`, `.dialog-title`, `.flex-row`, `[hidden]{display:none!important}`
  (`luci-lib-taskd`).
* **Медиазапросы по вьюпорту** (justclash 56rem, podkop 900px, netspeedtest 768px): у нас
  колонка контента уже вьюпорта на ширину сайдбара, поэтому «мобильная» раскладка включается
  позже, чем нужно.
* **Захардкоженный тёмный редактор**: mosdns и AdGuardHome прибивают CodeMirror к теме
  `dracula`, ssclash — ACE к `tomorrow_night_bright`. На светлой странице редактор всё равно
  чёрный (и на bootstrap тоже — это не наша регрессия).
* **`window.onload` / `DOMContentLoaded` / `location.reload()`** (diskman, passwall
  `optimize_cbi_ui.htm`, istore) — под SPA не перевызываются. Нас это не задевает: такие
  страницы почти всегда легаси-Lua, а в них роутер не заходит SPA-навигацией (нет view-класса
  → полная загрузка).
* **Легаси Lua/CBI — всё ещё большинство**: OpenClash, passwall(2), ssr-plus, vssr, dockerman,
  diskman, AdGuardHome, istore. Полная загрузка на каждый клик, весь их CSS живёт ровно на их
  странице.

---

## Часть 2. Правила темы (что мы обязаны делать и чего не делать)

### Правило 1. CSS вьюхи НИКОГДА не удаляется

Удаление необратимо: лист, импортированный на eval модуля, обратно не придёт. Симптом —
чёрный ACE без структуры и страница в 2 млн px.

### Правило 2. Документ с «инвазивным» листом отдаётся следующей странице только полной загрузкой

Лист инвазивен, если он может покрасить **чужую** страницу. Три проверки, все по факту, а не по
списку имён (множество имён и кастомных свойств темы читается из `cascade.css` в рантайме, 0.3 мс на
переход):

1. **Голый селектор** — без класса, id и атрибута (`pre`, `*`, `svg text`, `div > label + select`):
   попадает в стоковую разметку по построению.
   *Исключение:* если все объявления такого правила — кастомные свойства, которых тема не читает
   (`:root { --app-temp-status-temp: … }`, `:root { --clr-background: … }` у hex-редактора), красить
   им нечего — это инертно. А вот `:root { color-scheme: light dark }` (сток filemanager) — обычное
   свойство, и оно перенацеливает все UA-виджеты документа на настройку ОС.
2. **Стоковое имя без «пина»** — селектор целиком состоит из имён, которые знает тема
   (`.cbi-button-save`, `.label`, `.error`, `.cbi-input-text`). Ему нечем зацепиться за приложение,
   поэтому он матчит те же виджеты на всех страницах.
   *Не инвазивно:* `#cbi-podkop-section > .cbi-section-remove`, `.bandix-table th.sortable.active`,
   `.device-toolbar .cbi-input-select` — стоковый класс здесь **приколот** собственным именем
   приложения и без его разметки не сматчится. Аргументы функциональных псевдоклассов при поиске
   «пина» отбрасываются: `.cbi-button-save:not(.custom-save-button)` (filemanager) упоминает своё имя
   **в отрицании** — это не скоуп, а исключение, и лист остаётся инвазивным.
3. **Нечитаемый лист** (`<link>` ещё грузится, 404, cross-origin) — считается инвазивным:
   консервативный ответ — медленный, а не сломанный.

Что получилось на живых приложениях роутера:

| SPA сохраняется | Полная загрузка при уходе |
|---|---|
| ACE/ssclash (`.ace_*`) | filemanager (`.cbi-button-save:not(…)`) |
| podkop (`#cbi-podkop-*`) | openvpn, сток (`h4 { white-space: nowrap }`) |
| bandix-таблицы, hex-редактор (`.hexview`) | bandix (`.error { … }` — глобальный класс) |
| CPU-инклюд обзора (`.cpu-status-view-mode-entry`) | wrtbwmon (`div > label + select { min-width }`) |
| temp-status: его `:root { --app-* }` | temp-status: его же `svg text { fill }` |

Реализация: `menu-footstrap-common.js` → `themeNames()`, `inertDeclarations()`, `invasiveSheet()`,
`documentPoisoned()`. Покрывает и `<style>`, и `<link rel=stylesheet>`; `[data-fs-shell]` (наш
`cascade.css` и серверный `<style>`) и всё внутри `#view` — исключения.

### Правило 3. Единственное безопасное удаление — байт-идентичный дубль

`dedupeViewSheets()`. Правила при этом не исчезают (остаётся первая копия), и проверка
библиотеки «я это уже импортировал?» по-прежнему находит свой лист. Без этого podkop
накапливает по `<style>` на каждый визит.

### Правило 4. Тёмный режим объявляется на трёх языках

`data-darkmode` (читает только сама тема) + `data-theme` + `data-bs-theme` (исходящая
совместимость). `styles/` не имеет права читать два последних — это ровно та же граница, что у
экспортного тира `--*-color-*`. Держит `tools/axes.mjs` (пре-paint в `head.ut` и живой
`stampDark()` обязаны стампить один и тот же набор).

### Правило 5. `body` обязан иметь НЕПРОЗРАЧНЫЙ фон правильной яркости

Это то, что читают все яркостные сниферы. Прозрачный `body` (фон уехал на `:root`/псевдоэлемент)
= OpenClash решает «светлая» — его регулярка `/rgb\(/` даже не матчит `rgba(0,0,0,0)` — и
перекрашивает нашу тёмную страницу в свою светлую палитру. Держит `tools/export-tier.mjs` по
всей матрице палитра × режим × тинт.

### Правило 6. Экспортный тир — это контракт, и он должен быть рампой

Приложения читают `--primary-color-*`, `--text-color-*`, `--background-color-*`,
`--border-color-*` с литеральным фолбэком. Отдельно замечено: podkop читает
`var(--warn-color-medium, orange)` и justclash `var(--text-color, inherit)` — **таких имён в
контракте LuCI нет**, они всегда падают в фолбэк (и на bootstrap тоже). Изобретать их у себя не
надо: это чинит их опечатку ценой имени, которое потом придётся поддерживать вечно.

### Чего тема сделать не может (и не должна пытаться)

* `@media (prefers-color-scheme)` в CSS приложения не переопределяется ничем — это
  пользовательская настройка ОС. Единственное смягчение: наш дефолт «Авто» следует за ОС.
* Захардкоженные литералы (`background: white` на модалке passwall, `#1e1e1e` терминал
  justclash, 167 цветов в PNG-графиках `luci-app-statistics`) — не наши байты.
* z-index приложения на своей странице — его страница.
* Медиазапросы приложения по вьюпорту — их «мобильный» брейкпоинт не знает про сайдбар.

---

## Часть 3. Как проверять

```sh
npm run check                       # включая axes (правило 4) и export-tier (правила 5, 6)
```

Живой роутер, сценарий, который ловил бы всё вышеописанное:

1. открыть приложение с ACE/CodeMirror (ssclash) → SPA-переход на соседнюю вкладку → обратно;
   редактор обязан остаться живым (правило 1);
2. открыть File Manager → перейти в System; Save/Apply/Reset обязаны быть на месте (правило 2);
3. трижды зайти на podkop через SPA; число `<style>` в `<head>` не растёт (правило 3);
4. justclash в тёмном режиме: правила `[data-theme="dark"]` обязаны матчиться (правило 4).

Скрипты этих проверок — в истории `docs/14` (SPA-роутер) и в
`.claude/skills/footstrap-preview/`.

---

## Приложение. Вторая десятка по звёздам (проверено на роутере)

quickfile, tailscale-community, smartdns, internet-detector, 3ginfo-lite (клиентские JS — подняты на
роутере и отрисованы) и cloudflarespeedtest, aliddns, koolproxy, ech-workers, sms-tool (легаси-Lua —
прочитаны).

**Все десять сохраняют SPA-навигацию, ни одно не инжектит ничего, чем можно покрасить чужую
страницу.** Детали:

* `luci-app-internet-detector` — единственный из десятки, кто вообще инжектит в `<head>`, и делает это
  на eval модуля: `:root { --app-id-* }` (свой префикс → инертно по нашему правилу) плюс свои классы
  `.id-*`. Его тёмный блок висит на `:root[data-darkmode="true"]` — **на нашем атрибуте**, так что
  тёмный режим у него работает у нас из коробки, без единой правки. Четвёртый диалект детекта, и мы
  его уже стампим.
* `luci-app-smartdns` — эталон: `E('style', [css])` возвращается **внутри** `.cbi-map`, то есть умирает
  вместе с вьюхой. Стоковые `.cbi-section-actions` он трогает только внутри своего дерева.
* quickfile, tailscale-community, 3ginfo-lite — ноль инжектов, ноль литералов цвета.
* Легаси-Lua (koolproxy, ech-workers, sms-tool, cloudflarespeedtest, aliddns): `<style>` в шаблоне
  страницы, включая голые `table { … }` и карточки `#f7f7f7`. Утечь это не может (страница
  server-rendered, SPA туда не заходит), но светлые поверхности на тёмной теме остаются светлыми — снаружи
  не чинится.

Вывод: правила из части 2 покрывают всю вторую десятку без единой доработки темы. Поломки
сосредоточены в старых больших приложениях, а не в массе.

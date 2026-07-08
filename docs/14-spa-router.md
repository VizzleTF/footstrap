# SPA-роутер (мгновенная навигация без перезагрузки)

Как `luci-theme-footstrap` убирает полную перезагрузку страницы при клике по
меню. Реализация — вариант C из ресёрча: клиентский роутер только для
`view`-узлов, с безопасным фолбэком в обычную навигацию для всего остального.

Живёт целиком в `htdocs/luci-static/resources/menu-footstrap-common.js`. Правок
сервера / luci-base / шаблонов **нет** — это чистый аддитивный theme-JS.

## Почему это вообще возможно

LuCI 25.12 — классический MPA: каждый клик = полный HTTP GET → ucode-диспетчер
заново отдаёт весь каркас страницы. Но **контент и так рисуется на клиенте**:
диспетчер для `view`-узла рендерит шаблон `view.ut`, который эмитит
`<div id="view">` + инлайн-скрипт `L.require('ui').then(ui => ui.instantiateView(path))`.
Класс `LuCI.view` (см. `luci.js`) в `__init__` берёт `#view`, ждёт `luci-loaded`,
затем `load()` → `render()` → вставляет ноды в `#view`.

То есть сервером управляется только *навигация*, а не *рендер*. Роутер повторяет
ровно то, что делает `view.ut`, минус перезагрузка: перехватывает клик,
переинстанцирует нужный view в существующий `#view`, обновляет URL через
`history.pushState`.

Дерево меню (`ui.menu.load()`, кэш в `sessionStorage`) даёт по каждому узлу
`action.type` и `action.path`. Из ~85 листьев **59 — `view`** (89 %); остальное —
`call`/`function` (серверные обработчики), `alias`/`firstchild` (редиректы),
1 `template` (overview). SPA включается только для `view`.

## Поток навигации

`wireRouter()` вешает один делегированный обработчик на `document`:

1. Клик по `<a href>`, без модификаторов (ctrl/meta/shift/alt), кнопка 0, не
   `target=_blank`, не `download`, тот же origin, href не `#…`.
2. `navigate(pathname, push=true)`:
   - `segsFromPath` срезает `L.env.scriptname` → массив сегментов пути;
   - `nodeForSegs` идёт по дереву меню до узла;
   - **если узел не `view` (или `satisfied === false`, или нет `#view` в DOM) →
     `return false`** → обработчик НЕ делает `preventDefault` → браузер грузит
     страницу как обычно (фолбэк);
   - иначе: teardown → обновление `L.env` → `pushState` → `renderChrome()` →
     переинстанцирование view;
   - `return true` → `preventDefault`.
3. `popstate` (back/forward): `navigate(location.pathname, push=false)`; если
   узел не SPA-able → `location.reload()`.

Так как `pushState` кладёт **реальный** URL диспетчера, F5 и deep-link работают
серверно без изменений.

## Переинстанцирование view — главная тонкость

`L.require('view.x')` возвращает **закэшированный синглтон**, чей `__init__`
(рендер) уже отработал один раз, — повторный вызов ничего не перерисует. Класс
достаётся из инстанса: система классов LuCI ставит
`ClassConstructor.prototype.constructor = ClassConstructor`, поэтому
`instance.constructor` — это класс. `new instance.constructor()` запускает
свежий `__init__` → свежие `load()`+`render()` в `#view`. Это идентично полной
загрузке, которая тоже всегда стартует с нового инстанса.

## Ловушка: два разных `L` (была причиной бага `L.itemlist is not a function`)

`L` внутри модуля (параметр фабрики) и `window.L` (рантайм-инстанс, который
диспетчер создаёт как `new LuCI()`) — **разные объекты**. Модуль `ui` навешивает
хелперы (`itemlist`, `showModal`, `hideTooltip`, …) именно на `window.L`, а не на
прототипный `L`, который получают фабрики. Требуемый модуль захватывает тот `L`,
на котором вызвали `require()`.

Поэтому view **обязан** требоваться через `window.L.require(...)` — иначе он
захватит прототипный `L` без хелперов и упадёт в середине рендера на первом же
`L.itemlist(...)`. В коде это `const RT = window.L; RT.require(className)…`.

`L.env` и `L.Poll` при этом общие (замыкание/синглтон), так что менять их можно
через любой `L`; критичен только таргет `require`.

## Teardown

Перед рендером нового view:

- `L.Poll.queue.length = 0` — сбросить поллеры уходящего view, чтобы они не били
  по detached-DOM и не жгли RPC. **Не** `Poll.stop()`: он удаляет внутренний
  `tick`, и `poll.add()` входящего view уже не сделает авто-старт. Единственный
  не-view-поллер, который добавляет LuCI, — транзиентная проверка достижимости
  при apply/reboot, так что flush безопасен.
- `ui.hideModal()` — закрыть возможную модалку.

## renderChrome()

После смены `L.env` (`requestpath`/`dispatchpath`/`pathinfo`/`nodespec`)
перестраивает mode-меню + основное меню + вкладки секций из нового `L.env`.
Контейнеры (`#modemenu`/`#topmenu`/`#tabmenu`) чистятся перед ре-рендером, чтобы
не дублировать. Обновляются также `document.title` и `.fs-title-main`.

## Границы и деградация

- Работает в обеих раскладках (sidebar и top-nav) — обе зовут
  `common.bootstrap(renderMainMenu)`; роутер общий.
- Сторонние приложения, регистрирующие `view`-узлы, ускоряются автоматически.
- Legacy `cbi`/`template` и обработчики `call`/`function` → полная навигация.
- Overview (`template`) достигается полной загрузкой; при уходе на view с
  overview-страницы, где нет `#view`, первый переход тоже полный (фолбэк по
  «нет `#view`»), дальше view→view уже SPA.
- Любая ошибка require/instanceof → `window.location = pathname` (полный переход).
- Другие темы не затрагиваются.

## Проверено (Playwright, живой роутер)

- sidebar и top-nav: system → interfaces → dhcp → system — все переходы SPA
  (маркер `window` жив = нет перезагрузки), контент/подсветка/вкладки/заголовок
  верные, 0 ошибок консоли;
- back/forward через `popstate` — остаётся SPA, восстанавливает нужную страницу;
- сложные CBI-form view (Interfaces, DHCP) рендерятся полностью, save/apply-футер
  на месте, поллеры («Refreshing», аптайм) живые;
- клик на overview (`template`) — корректный полный reload (фолбэк).

Тест-скрипты — вне репозитория (scratch); повторить можно через
`.claude/skills/footstrap-preview` + ручной playwright-сценарий с проверкой
маркера `window`.

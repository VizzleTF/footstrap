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
`action.type` и `action.path`. На тестовом роутере из 74 листьев **54 — `view`** (73 %); остальное —
`call`/`function` (серверные обработчики), `alias`/`firstchild` (редиректы),
1 `template` (overview). SPA включается только для `view`.

## Поток навигации

`wireRouter()` вешает один делегированный обработчик на `document`:

1. Клик по `<a href>`, без модификаторов (ctrl/meta/shift/alt), кнопка 0, не
   `target=_blank`, не `download`, тот же origin, href не `#…`. Ссылки с
   `?query` или `#hash` тоже уходят в полную загрузку: `navigate()` носит только
   pathname, а `pushState` голого пути срезал бы и то и другое (а view читает
   `location.search`). По той же причине `popstate` на запись с query — просто
   `location.reload()`.
2. `navigate(pathname, push=true)`:
   - `segsFromPath` срезает `L.env.scriptname` → массив сегментов пути;
   - `nodeForSegs` идёт по дереву меню до узла, `viewClassFor` даёт имя класса
     view (или `null`, если узел не SPA-able);
   - **если класса нет (не `view`/overview-`template`, или `satisfied === false`,
     или нет `#view` и некуда его вставить) → `return false`** → обработчик НЕ
     делает `preventDefault` → браузер грузит страницу как обычно (фолбэк);
   - иначе: teardown → обновление `L.env` → `body[data-page]` → `pushState` →
     `renderChrome()` → переинстанцирование view;
   - `return true` → `preventDefault`.
   Каждая закоммиченная навигация инкрементит `_navGen`: два быстрых клика
   гоняют свои async-`require()`, и без токена поколения первый view мог бы
   отрисоваться в `#view` уже после второго.
3. `popstate` (back/forward): `navigate(location.pathname, push=false)`; если
   узел не SPA-able → `location.reload()`.

Так как `pushState` кладёт **реальный** URL диспетчера, F5 и deep-link работают
серверно без изменений.

`document.body[data-page]` роутер перештампывает сам — из **резолвнутого**
пути листа (`segs.join('-')`), ровно как сервер штампует `ctx.path` при полной
загрузке. Иначе входящая страница осталась бы с `data-page` предыдущей, и
page-scoped CSS (`styles/pages/*`) молча не применился бы; заодно
firstchild-URL вроде `/admin/status` даёт тот же `admin-status-overview`, что и
полная загрузка.

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
- `clearViewIntervals()` — прибить голые `window.setInterval` уходящего view
  (например log-tailer у luci-app-podkop): полная загрузка убила бы их сама, SPA
  обязан явно. `setInterval`/`clearInterval` перехвачены на этапе eval модуля,
  id'шники трекаются в `Set`; собственный 1-секундный tick `L.Poll` сохраняется.
- отмена собственной self-update-цепочки: `_updTimer` (raw `setTimeout`)
  очищается, и `_updGen++` **разотождествляет уже летящий** `fs.exec` — таймера
  в этот момент нет (rpctimeout 20 с — окно широкое), и без токена поколения
  ответ перепланировал бы следующий тик и мог выкинуть свою модалку поверх
  посторонней страницы.
- `ui.hideModal()` — закрыть возможную модалку.

## renderChrome()

После смены `L.env` (`requestpath`/`dispatchpath`/`pathinfo`/`nodespec`)
перестраивает mode-меню + основное меню + вкладки секций из нового `L.env`.
Контейнеры (`#modemenu`/`#topmenu`/`#tabmenu`) чистятся перед ре-рендером, чтобы
не дублировать. Обновляются также `document.title` и `.fs-title-main`.

## Границы и деградация

- Работает в обеих раскладках (sidebar и top-nav) — обе зовут
  `common.init(renderMainMenu)`; роутер общий.
- Сторонние приложения, регистрирующие `view`-узлы, ускоряются автоматически.
- Legacy `cbi` и обработчики `call`/`function` → полная навигация.
- **Status→Overview** (`template`-узел `admin_status/index`) — SPA-исключение:
  его серверный шаблон лишь определяет 3 глобал-хелпера
  (`progressbar`/`renderBox`/`renderBadge`) и зовёт `ui.instantiateView('status/index')`.
  Роутер это воспроизводит: `ensureOverviewHelpers()` идемпотентно определяет
  хелперы (инлайн-скрипт шаблона при SPA не выполняется), затем инстанцирует
  `view.status.index`. Прочие `template`-узлы → полная навигация.
- Любая ошибка require/instanceof → `console.error(...)` и `window.location =
  pathname` (полный переход). Ошибку именно **логируем**: молчаливый фолбэк
  делал любую регрессию роутера похожей на «страница просто медленно грузится».
- Другие темы не затрагиваются.

## Hover-prefetch

`wireRouter()` вешает делегированный `pointerover`: при заходе курсора на ссылку
SPA-able-узла — `fetch()` его модуля JS, чтобы прогреть HTTP-кеш браузера
(**не** `require`: тот запустил бы `__init__` и отрендерил чужой view в `#view`).
URL строится `moduleUrl()` байт-в-байт как у `LuCI.require()`
(`base_url/<точки→слэши>.js?v=resource_version`) — иначе кеш-промах. Дедуп по
имени класса (`_prefetched`), ошибки молча глотаются (чистая оптимизация).
Последующий клик → `require()` бьёт по тёплому кешу (−10–40 ms на первый визит
страницы, больше на WAN/VPN). `viewClassFor()` — общий резолвер класса для
navigate() и prefetch.

## Пауза поллинга в фоне

`wireVisibility()` (в `init()`): `visibilitychange` → скрытая вкладка
`L.Poll.stop()` (clearInterval, очередь цела), показ `L.Poll.start()` (пере-арм +
немедленный `step()`). LuCI своего обработчика не имеет, поэтому status/overview в
фоновой вкладке иначе молотит ubus 24/7 (дорогой iwinfo `getAssocList`). Поллер,
добавленный пока скрыто, не авто-стартует (`stop()` удаляет tick) — `start()`
подхватит его на показе, ничего не теряется. Возобновляем только то, что сами и
поставили на паузу (`wasActive`): пользователь мог остановить поллинг вручную
через индикатор «Refreshing», и безусловный `start()` на показе вкладки молча
отменил бы это.

## Проверено (Playwright, живой роутер)

- sidebar и top-nav: system → interfaces → dhcp → system — все переходы SPA
  (маркер `window` жив = нет перезагрузки), контент/подсветка/вкладки/заголовок
  верные, 0 ошибок консоли;
- back/forward через `popstate` — остаётся SPA, восстанавливает нужную страницу;
- сложные CBI-form view (Interfaces, DHCP) рендерятся полностью, save/apply-футер
  на месте, поллеры («Refreshing», аптайм) живые;
- клик на прочие (не-overview) `template`-узлы — корректный полный reload
  (фолбэк). Сам overview с тех пор заведён под SPA через `ensureOverviewHelpers`
  (см. выше) — `viewClassFor` мапит его `template`-узел на `view.status.index`.

Повторить можно playwright-сценарием: пройти по ссылкам меню и проверить, что
маркер, положенный в `window`, переживает переход (жив = перезагрузки не было).

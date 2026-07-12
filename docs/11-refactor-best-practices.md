# Рефакторинг по best practices (SOLID / KISS / DRY)

Что применено и что в roadmap.

## Выводы (verified)

1. **CSS — слои и токены против override-sprawl.** Слоёная архитектура
   (ITCSS / нативные `@layer`): поздние слои побеждают вне зависимости от
   специфичности → убирает эскалацию оверрайдов. Дизайн-токены (CSS custom
   properties) — прямой DRY-антидот повторяющимся литералам. Реальные LuCI-темы
   (kucat, aurora) гонят цвета из токенов. Снижать sprawl: объединять селекторы,
   снижать специфичность, убирать дубли, избегать `!important`-гонки.
2. **Client JS — baseclass + `E()` + декомпозиция.** Апстрим `menu-bootstrap.js`
   = `baseclass.extend({...})`, строит DOM через `E()` (не innerHTML), render
   делегирует в мелкие методы (renderModeMenu/renderMainMenu/renderTabMenu).
   Для untrusted HTML — safe sinks (`textContent`) или DOMPurify (OWASP).
3. **ucode-шаблоны — общие partials.** Каноничный LuCI-DRY: общий хром в
   header/footer/sysauth-partials, подключаемые через `include()`.
4. **Dead-rule elimination — осторожно.** Coverage-инструменты видят только
   выполненное; JS-инъектируемые классы легко удалить по ошибке.

Источники: itcss (xfive), CSS cascade layers (Smashing/MDN), legacy CSS refactor
(dev.to kathryngrayson), OWASP XSS Cheat Sheet, openwrt/luci, ThemesHowTo,
luci-theme-kucat/aurora/argon.

## Ключевой урок из luci-app-podkop (itdoginfo/podkop)

Podkop — не тема, но образцовый LuCI-фронтенд. Паттерн шаринга кода между
модулями: **композиция, не наследование.** `'require view.podkop.main as main'`
даёт singleton, у которого ВЫЗЫВАЮТ функции (`main.DashboardTab.render()`,
`main.injectGlobalStyles()`); тонкие entrypoints (dashboard.js/section.js по 20
строк) экспортят по одной функции-конфигуратору, а корневой view (`podkop.js`)
их орхестрирует. Вариативность — через колбэки/параметры, не через override
метода класса.

Это снимает ограничение, из-за которого «общая база» через `extend` не
работала (required-модуль = singleton, класс-наследование недоступно).

## Применено (проверено скриншотами, вывод не изменился)

- **Menu JS DRY — через композицию (паттерн podkop).** Общая логика
  (`renderTabMenu` / `renderModeMenu` / `wireAppearance` / `init`, ~90
  строк дубля) вынесена в `menu-footstrap-common.js`, который экспортит
  `init(renderMainMenu)`. Оба меню `'require menu-footstrap-common as
  common'` и в `__init__` вызывают `common.init(<свой renderMainMenu>)` —
  layout-специфичный рендер инжектится колбэком (SOLID DI). Осталось только
  `renderMainMenu` в каждом файле (sidebar vertical-collapsible / top
  horizontal-dropdown). Обе раскладки рендерятся, консоль чистая.
- **ucode partials.** Дублированный хром вынесен в
  `themes/footstrap/partials/` (`head` / `brand` / `appearance` / `logout` /
  `notices` / `footer`), подключается `include()` из обоих header'ов и
  footer'ов; вариативность — параметрами (`with_label`, `menu_module`).
  Каноничный LuCI-DRY, один источник правды.
- **(снято вместе с кастомным dashboard.)** `05_footstrap_dashboard.js`
  рисовал overview целиком сам, и в нём были свои DRY-правки: `leasesCard(title,
  subLabel, addrHeader, leases, addrOf)` вместо дубля DHCPv4/DHCPv6-таблиц и
  `nf(label, value)` вместо 10 инлайновых `.fs-nf`; все интерполяции проходили
  через `esc()` (XSS-safe). Инклуд ретайрнут (полное перерисовывание дерева на
  каждый polling-тик мигало и сбрасывало скролл) — его заменил layout-only
  `05_footstrap_overview_layout.js`, который не рендерит контент вообще.
- **CSS токен `--accent-lt`.** Логотип-градиент `#7ec8ff` (дубль в 2 местах) →
  токен `var(--accent-lt)`.

## Что НЕ работает в LuCI (зафиксировано)

- Межмодульное **наследование классов** (`base.extend` из другого модуля) —
  `base.extend is not a function` (required = singleton). Плоский объект —
  `factory yields invalid constructor` (модуль обязан вернуть класс).
  → использовать композицию (выше), не наследование.

## Отклонено с обоснованием (не просто «отложено»)

- **CSS `@layer`-миграция — ПЕРЕСМОТРЕНО, сделано (см. docs/17).** Исходный
  аргумент против: **все unlayered-правила побеждают любые layered**, а CSS
  LuCI-приложений (`node.css` per-page: statistics и т.д.) — unlayered, значит
  тема в слоях начнёт проигрывать app-CSS. На практике это не регрессия, а
  ровно то поведение, которое и нужно: unlayered-уровень намеренно оставлен
  пустым как аварийный люк, туда же попадает app'овый `node.css` — и он и так
  грузился после темы, т.е. выигрывал и раньше. Внутри же темы слои
  (`@layer tokens, base, theme, page;` — единственное объявление в
  `styles/00-header.css`) убрали `!important`-гонку между базой и компонентами:
  поздний слой побеждает вне зависимости от специфичности.
- **Полный переход dashboard на `E()`** вместо innerHTML-шаблонов. Каноничнее,
  но: `E()` использует `document.createElement` (HTML-namespace), а весь дизайн —
  SVG (иконки/бары/кольца) → нужен `createElementNS`, чего `E()` не делает;
  ~250 строк HTML → сотни вызовов. Текущее решение (innerHTML + `esc()` на всех
  интерполяциях + `textContent` для user-данных в меню) XSS-безопасно. Переход
  не оправдан. (Вопрос снят вместе с самим dashboard-инклудом: layout-only
  `05_footstrap_overview_layout.js` строит DOM через `E()` и `createElement` —
  своего контента у него нет.)

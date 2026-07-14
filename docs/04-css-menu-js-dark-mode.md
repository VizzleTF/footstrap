# Как это делает luci-theme-bootstrap — и почему footstrap иначе

**Это апстрим-референс, а не описание footstrap.** Здесь разобрано, как устроены
CSS-переменные, dark mode и контракт `menu-<тема>.js` у `luci-theme-bootstrap`
(master/25.12) — потому что именно от этих решений footstrap отталкивается. Что
делает сам footstrap, сказано во врезках `>` и в последней секции; полностью —
док 08 (дизайн-система), док 09 (хром), док 14 (SPA-роутер), док 17 (сборка CSS).

## CSS: что обязана стилизовать тема

Тема несёт весь CSS сама (luci-base общих стилей страниц не даёт). У bootstrap:
`cascade.css` (~2650 строк) + `mobile.css` (~430 строк, подключается media query
`only screen and (max-device-width: 854px)`).

Классы, которые генерирует клиентский JS (luci.js / ui.js / form.js) — их надо
покрыть обязательно, иначе страницы развалятся:

- **Формы CBI**: `.cbi-map`, `.cbi-section`, `.cbi-section-node`, `.cbi-value`,
  `.cbi-value-title`, `.cbi-value-field`, `.cbi-input-*`, `.cbi-button`,
  `.cbi-button-positive/negative/action/remove`, `.cbi-section-table`,
  `.cbi-section-create`, `.cbi-optionals`, `.cbi-dropdown`, `.cbi-checkbox`,
  `.cbi-progressbar`, `.cbi-tooltip`
- **Таблицы**: `.table`, `.tr`, `.td`, `.th` (LuCI рисует таблицы div-ами!),
  `.cbi-rowstyle-1/2`, сортировка `.th[data-sortable]`
- **UI-компоненты**: `.alert-message` (+ `.warning/.error/.success/.notice`),
  `.modal`, `.tooltip`, `.spinning`, `.dropdown`, `.tabs`/`.tab-pane`,
  `#indicators .indicator`, `.notifications`
- **Виджеты статуса**: `.zonebadge`, `.ifacebox`, `.ifacebox-head`, `.network-status-table`
- **Меню**: ваши же контейнеры `#topmenu`, `#tabmenu`, `#modemenu`, `.dropdown-menu`
- **Логин**: `[data-page="failsafe"]`, generic sysauth разметка

Практический вывод: **не писать CSS с нуля — взять готовый набор виджетных
дефолтов и перекрасить через CSS custom properties**. Так делает большинство
современных тем. В footstrap эти дефолты лежат в `styles/base/` (`@layer base`) и
поглощаются по одному правилу, а сам `cascade.css` **генерируется** из дерева
`styles/` скриптом `build-css.sh` — док 17.

> **Покрытие — это контракт.** Селектор, который не рисует ни одна штатная
> страница LuCI, всё равно стилизуется: его emit'ит чей-то сторонний `luci-app-*`.
> «Выглядит неиспользуемым — удалить» = раз-стилизовать чужое приложение.

## Система CSS-переменных bootstrap (master/25.12)

Bootstrap параметризован HSL-переменными — перекраска темы возможна почти без
правки правил:

```css
:root {
	/* фон: базовый hue/saturation/lightness + производные уровни */
	--background-color-h: 0;
	--background-color-s: 0%;
	--background-color-l: 100%;
	--background-color-high / -medium / -low     /* авто через calc() */

	/* текст: --text-color-h/s/l → --text-color-highest/high/medium/low */
	/* рамки: --border-color-* → high/medium/low */

	/* акценты */
	--primary-color-high: #1976d2;
	--primary-color-medium: #1564c0;
	--primary-color-low: #0d46a1;
	--error-color-*; --success-color-*; --warn-color-*;
	--on-primary-color; --on-error-color; ...  /* цвет текста на акценте */

	--disabled-opacity: .7;
	color-scheme: light;
	--font-sans: ...; --font-mono: ...;
}
```

Тёмная схема — просто другой набор тех же переменных:

```css
:root[data-darkmode="true"] {
	--background-color-delta-l-sign: 1;   /* производные светлеют, а не темнеют */
	--background-color-l: ~10%;
	color-scheme: dark;
	...
}
```

Плюс точечные правки `[data-darkmode="true"] .zonebadge[style]` и т.п. для
элементов с инлайновыми цветами.

> **В footstrap HSL-триплетов нет** (как нет и покомпонентных `--*-rgb` — обе
> «покомпонентные копии цвета» удалены: они молча устаревали при перекраске
> палитры). Оттенки считаются `color-mix()` **из** самого токена.
>
> **Ярусов два, и `--*-color-*` — не мост, а односторонний ЭКСПОРТ.**
> Приватный ярус `--fs-*` (`--fs-bg`, `--fs-panel`, `--fs-accent`, `--fs-text`,
> `--fs-radius-*`, `--fs-z-*`, `--fs-dur*`, …) — **единственное, что читают правила
> темы**. Конвенциональные LuCI-имена `--primary-color-*`, `--text-color-*`,
> `--border-color-*`, `--on-*-color` определены **из** приватных и не читаются
> **никем** внутри темы: `audit.py --strict` **валит сборку** на любом чтении
> экспортного имени из `styles/`.
>
> Причина: `:root` — общая область видимости, а CSS любого `luci-app-*` попадает в
> тот же документ **вне слоёв**, то есть бьёт любой `@layer`. Замер на
> `docs/gallery.html` с враждебным `:root`: **312 элементов из 336 перекрашивались
> до раскола яруса, 0 — после.** Чтение экспортных имён из base было дырой пошире:
> `--text-color-high` — конвенция, приложение объявит её тем охотнее.
>
> Цвет текста на акценте — не одна общая переменная, а четыре чернила **на каждую
> палитру и режим**: `--fs-on-accent/-good/-warn/-danger` (`styles/03-palettes.css`,
> рядом с заливками, на которых обязаны читаться). Единый `#fff` проваливал AA на
> семи из восьми тёмных заливок — до **1.69:1**. Подробно — док 08, док 17.

## Механизм dark mode (bootstrap, master)

Три варианта темы = три uci-записи, указывающие на **одни и те же файлы через
symlink**:

```
uci: themes.Bootstrap      = /luci-static/bootstrap        # auto (по системной теме)
uci: themes.BootstrapDark  = /luci-static/bootstrap-dark   # принудительно тёмная
uci: themes.BootstrapLight = /luci-static/bootstrap-light  # принудительно светлая

htdocs/luci-static/bootstrap-dark  -> bootstrap   (symlink)
htdocs/luci-static/bootstrap-light -> bootstrap   (symlink)
ucode/template/themes/bootstrap-dark  -> bootstrap (symlink)
ucode/template/themes/bootstrap-light -> bootstrap (symlink)
```

header.ut различает варианты по имени темы:

```
const darkpref = (theme == 'bootstrap-dark' ? 'true'
                : (theme == 'bootstrap-light' ? 'false' : null));
```

- `darkpref != null` → жёстко ставит `<html data-darkmode="true|false">`
- `darkpref == null` (вариант auto) → инлайновый скрипт в `<head>` следит за
  `prefers-color-scheme`:

```html
<script>
	var mediaQuery = window.matchMedia('(prefers-color-scheme: dark)'),
	    rootElement = document.querySelector(':root'),
	    setDarkMode = function(match) { rootElement.setAttribute('data-darkmode', match.matches) };
	mediaQuery.addEventListener('change', setDarkMode);
	setDarkMode(mediaQuery);
</script>
```

- `<meta name="darkreader-lock">` — запрещает расширению Dark Reader ломать тему.
- Скрипт инлайновый и в `<head>` — чтобы не было вспышки светлой темы (FOUC).

Makefile при этом в `postrm` удаляет все три uci-записи.

> **В footstrap запись ОДНА** — `Footstrap` → `/luci-static/footstrap`
> (`root/etc/uci-defaults/30_luci-theme-footstrap`). Симлинков `-dark`/`-light`
> нет, «раскладочных» записей (`FootstrapSidebar`, `FootstrapOnTop`) нет тоже — все
> легаси-имена uci-defaults **удаляет**, а `postrm` вычищает все `luci.themes.*`.
> И режим, и палитра, и **раскладка** — клиентские настройки.
>
> **Пре-пейнт-блоков в `partials/head.ut` несколько**, по одному на ось Appearance
> (dark mode; палитра+обои+скругление+tint+accent; rail; layout) — каждый читает
> `localStorage` и штампует `:root` **до первого кадра**, потому что `require` там
> невозможен: загрузчика модулей ещё нет.
>
> Dark mode: сохранённое значение выигрывает у ОС, иначе — `prefers-color-scheme`;
> подписка на `change` регистрируется **всегда** (она перечитывает storage), чтобы
> режим Auto продолжал следить за системой, если пользователь переключился на него
> уже после загрузки.
>
> **`set()` штампует ТРИ атрибута:** `data-darkmode` (его читает CSS этой темы),
> плюс `data-theme` и `data-bs-theme` — **исходящая совместимость** для сторонних
> приложений, которые их вынюхивают (`luci-app-justclash` вешает на `data-theme`
> 21 правило, `ssclash` первым делом читает `data-bs-theme`). Изнутри `styles/` их
> не читают никогда.
>
> Переключает всё это поповер Appearance (`menu-footstrap-common.js`) — см. ниже.

## menu-<тема>.js: контракт

Файл: `htdocs/luci-static/resources/menu-mytheme.js`. Грузится из footer:
`L.require('menu-mytheme')`. Каркас (реальный bootstrap, сокращён):

```js
'use strict';
'require baseclass';
'require ui';

return baseclass.extend({
	__init__() {
		ui.menu.load().then((tree) => this.render(tree));
	},

	render(tree) {
		// tree — дерево меню (права юзера уже учтены)
		this.renderModeMenu(tree);          // admin / failsafe / ... → #modemenu
		// по L.env.dispatchpath найти активный узел → renderTabMenu → #tabmenu
	},

	renderMainMenu(tree, url, level) {
		// children = ui.menu.getChildren(tree)
		// L.url(url, child.name) — ссылка; _(child.title) — перевод
		// наполняет #topmenu, вложенность → ul.dropdown-menu
	},

	renderTabMenu(tree, url, level) { /* табы текущего раздела → #tabmenu */ },

	renderModeMenu(tree) { /* переключатель admin/… → #modemenu (в футере) */ }
});
```

API: `ui.menu.load()`, `ui.menu.getChildren(node)`, `L.env.dispatchpath`,
`L.env.requestpath`, `L.url(...)`, `E(tag, attrs, children)` — DOM-хелпер luci.js.

Хотите другую структуру меню (сайдбар как в material/argon) — меняете renderMainMenu
и контейнеры в header.ut соответственно. Material так и делает: тот же контракт,
другая раскладка.

> **В footstrap рендерер ОДИН** — `menu-footstrap.js`. Второго
> (`menu-footstrap-top.js`) **не существует**: `partials/footer.ut` жёстко грузит
> `L.require('menu-footstrap')` и `L.require('fs-select')`, и всё.
>
> Второй раскладки как «второго дизайна» не было никогда. Тот же рендерер уже
> умел **flyout-режим** (`flyoutMode()`), в котором секция ведёт себя ровно как
> дропдаун верхнего меню, — верхняя раскладка и ЕСТЬ этот режим на десктопной
> ширине. Одна и та же разметка = вертикальный аккордеон / дропдауны бара /
> флайауты rail'а; hover-открытие — чистый CSS. Смена `data-layout` **ничего не
> перерисовывает**: CSS морфит хром, а `MutationObserver` в `menu-footstrap.js`
> складывает аккордеон в дропдауны и обратно.
>
> Общее — табы, `#modemenu`, поповер Appearance, SPA-роутер (док 14), измерение
> хрома — в `menu-footstrap-common.js`, который рендерер подключает через
> `'require menu-footstrap-common as common'`.
>
> Заголовки секций — паттерн **disclosure** по W3C APG: `role="button"` +
> `aria-expanded` + `aria-controls`, Space открывает/закрывает, Escape закрывает и
> возвращает фокус на заголовок.

## Чего у bootstrap нет вовсе: измерение, `fs-select` и оси Appearance

**`fs-fit.js` — единственный движок «а оно ещё влезает?».** Часть решений темы
зависит от того, чего требует **контент**, а не от ширины экрана, и ни один
CSS-запрос об этом спросить не может (media query меряет вьюпорт, container query —
контейнер). Такие решения **измеряются**. `fs-fit` владеет измерением,
склейкой в один кадр и `ResizeObserver`; вызывающий регистрирует фиттер
(`fit.add(fn)`) и приносит только решение. **Новую логику «влезает ли» добавляют
сюда — второго наблюдателя не заводят.** Он же отдаёт `fit.frame(fn)` (склеить
колбэк в один вызов на кадр) и `fit.touches(mutations, sel)` («а это вообще про
меня?» — poll LuCI переписывает контент раз в секунду).

Потребители: `fitChrome()` (`menu-footstrap-common.js`) — бар сначала ужимает
пилюли (`.fs-dense1/2`), и только если и в самом тесном шаге меню всё равно
переносится, оно уходит на **вторую строку** (`.fs-bar-stack`); `fitShell()` —
вычитает срез сайдбара (`--fs-sidebar-w`/`--fs-rail-w`, прочитанные из CSS через
`getComputedStyle`) из вьюпорта и ставит **`data-narrow`**, если оставшаяся колонка
уже нечитаема; `fitTables()` (`fs-select.js`) — складывает **дата**-таблицы в
карточки.

**`data-narrow` — единственный источник истины «сайдбар превратился в бар»**: на
него гардится CSS, его же читает `flyoutMode()`. Раньше там был
`matchMedia('(max-width: 767px)')`, и в окне 768–779px хром рисовался баром, пока
меню всё ещё вело себя аккордеоном (замерено на роутере). **Вьюпортный брейкпоинт
для этого вопроса возвращать нельзя.**

**`fs-select.js`** превращает каждый штатный `<select>` в стилизованный
`ui.Dropdown`: попап нативного `<select>` не стилизуется CSS'ом. Нативный
`<select>` при этом **остаётся** полем формы и обязан оставаться
`frameEl.firstChild` — `ui.Select.getValue()` возвращает
`this.node.firstChild.value`.

**Оси Appearance реализованы ДВАЖДЫ** — пре-пейнтом в `head.ut` и живым
аппликатором в `menu-footstrap-common.js` (Layout, Theme, Palette, Wallpaper, Tint,
Accent, Rounding, Submenus, Updates). Байт-в-байт их не свести, поэтому контракт
держит гейт **`tools/axes.mjs`** (`npm run axes`), выводя его **из JS**: ключи
`localStorage`, атрибуты `:root`, custom properties, диапазоны 1–360, дефолт
скругления — и несущее правило порядка: **сначала custom property, потом атрибут**,
иначе перезагрузка рисует один кадр предыдущим оттенком. Гейт существует именно
ради этой строчки: её починили бы в поповере и забыли в шаблоне, а единственный
симптом — один неверный кадр, о котором никто не сообщит и который не ловит ни один
другой тест.

## Кастомизация логотипа

- `logo.svg` + `logo_48.png` в `htdocs/luci-static/mytheme/` — favicon
  (`<link rel="icon">` в header.ut).
- Бренд в шапке у bootstrap — текст hostname (`<a class="brand">`). Хотите картинку —
  `<img src="{{ media }}/logo.svg">` в header.ut.
- Material дополнительно несёт `brand.png` и `custom.css` (пользовательские
  оверрайды поверх cascade.css).

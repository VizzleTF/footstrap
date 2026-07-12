# CSS, клиентский menu-JS и dark mode

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
дефолтов и перекрасить через CSS custom properties** (см. ниже). Так делает
большинство современных тем. В footstrap эти дефолты лежат в `styles/base/`
(`@layer base`) и поглощаются по одному правилу, а сам `cascade.css`
**генерируется** из дерева `styles/` скриптом `build-css.sh` — docs/17.

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

> **В footstrap HSL-триплетов нет.** Палитра задаётся прямыми токенами
> (`--bg/--panel/--panel2/--border/--text/--dim/--accent/…`, `styles/02-tokens.css`),
> оттенки и тени считаются `color-mix()`. Привычные LuCI-имена `--*-color-*`
> остаются мостом поверх них (`--primary-color-high: var(--accent)` и т.д., там же) —
> чтобы сторонние `luci-app-*` красились сами. Цвет текста на акценте — не одна
> общая переменная, а четыре чернила на **каждую палитру и режим**:
> `--on-accent/--on-good/--on-warn/--on-danger` (`styles/03-palettes.css`).
> Там же — шкала `--z-*` и `--fs-bar-h` в `02-tokens.css`. Подробно — docs/17.

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

> **В footstrap записей две — только раскладки** (`FootstrapSidebar`,
> `FootstrapOnTop`, `root/etc/uci-defaults/30_luci-theme-footstrap`), симлинков
> `-dark`/`-light` нет: режим клиентский. Инлайновый скрипт в
> `partials/head.ut` до первой отрисовки ставит `data-darkmode` из
> `localStorage['fs-darkmode']`, а если там ничего нет — из `prefers-color-scheme`;
> подписка на `change` регистрируется всегда, чтобы режим Auto продолжал следить за
> системой. Переключает — попап Appearance (`menu-footstrap-common.js`). `postrm`
> в Makefile удаляет все записи `luci.themes.*`, включая шесть легаси-имён.

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

> **В footstrap рендерера два**: `menu-footstrap.js` (сайдбар) и
> `menu-footstrap-top.js` (верхнее меню); общая логика — табы, `#modemenu`, попап
> Appearance, SPA-роутер — вынесена в `menu-footstrap-common.js`, который оба
> подключают через `'require menu-footstrap-common as common'`. `partials/footer.ut`
> грузит нужный рендерер (`L.require('menu-footstrap')` / `…-top`) и `fs-select`.
> Заголовки секций — паттерн **disclosure** по W3C APG: `role="button"` +
> `aria-expanded` + `aria-controls`, Space открывает/закрывает, Escape закрывает и
> возвращает фокус на заголовок.

## Кастомизация логотипа

- `logo.svg` + `logo_48.png` в `htdocs/luci-static/mytheme/` — favicon
  (`<link rel="icon">` в header.ut).
- Бренд в шапке у bootstrap — текст hostname (`<a class="brand">`). Хотите картинку —
  `<img src="{{ media }}/logo.svg">` в header.ut.
- Material дополнительно несёт `brand.png` и `custom.css` (пользовательские
  оверрайды поверх cascade.css).

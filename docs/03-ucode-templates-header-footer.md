# Шаблоны ucode: header.ut, footer.ut, sysauth.ut

## Синтаксис ucode-шаблонов (*.ut)

- `{% ... %}` — код (ucode), `{%- -%}` / `{% ... -%}` — с обрезкой пробелов
- `{{ expr }}` — вывод выражения
- `{# комментарий #}`
- `_('text')` — перевод (gettext), `include('path', {scope})` — вложенный шаблон

## Переменные, доступные в header/footer темы

Собраны из `runtime.uc`, `dispatcher.uc` и реального использования в bootstrap:

| Переменная | Что это |
|---|---|
| `theme` | имя темы (`basename(mediaurlbase)`), напр. `mytheme` |
| `media` | URL-база темы: `/luci-static/mytheme` |
| `resource` | `/luci-static/resources` (общие ресурсы luci-base) |
| `ctx` | контекст диспетчера: `ctx.path`, `ctx.request_path`, `ctx.authsession`, `ctx.authtoken` |
| `dispatcher` | API: `dispatcher.lang`, `dispatcher.build_url(...)`, `dispatcher.lookup("admin/system/admin")`, `dispatcher.menu_json()` |
| `dispatched` | текущий узел меню (`dispatched.title` — заголовок страницы) |
| `node` | узел с доп. свойствами: `node.css` (страница может требовать свой CSS), `node.title` |
| `version` | `version.luciname`, `version.luciversion`, `version.distname`, `version.distversion`, `version.distrevision`, `version.disturl` |
| `config` | разобранный `/etc/config/luci` (`config.main.pollinterval` и т.д.) |
| `blank_page` | `true` для страниц без хрома (логин): не рисовать шапку/меню/футер |
| `css` | инлайновый CSS, запрошенный страницей — вывести в `<style>` |
| `lua_active` | активен ли Lua-совместимый рантайм (luci-lua-runtime установлен) |
| `http` | объект запроса: `http.getenv()`, `http.prepare_content()` |
| `ubus` | прямые ubus-вызовы: `ubus.call('system', 'board')` |
| `L`, `uci` и глобалы ucode | `import {...} from 'luci.core'` доступен |

## header.ut — обязательный контракт

Header темы **обязан**:

1. Вызвать `http.prepare_content('text/html; charset=UTF-8')`.
2. Вывести `<!DOCTYPE html><html><head>...` со своим CSS (`{{ media }}/cascade.css`).
3. Подключить `{{ resource }}/cbi.js` и переводы.
4. Учесть `node.css` и `css` (страницы могут добавлять стили).
5. Открыть контейнер контента (у bootstrap `<div id="maincontent" class="container">`)
   и оставить его НЕзакрытым — контент страницы и footer закроют.
6. Уважать `blank_page` — при `true` не рисовать шапку/меню.
7. Дать пустые контейнеры меню: `#topmenu`, `#tabmenu` (+ `#modemenu` в footer),
   `#indicators` — их наполнит menu-JS.

Скелет (выжимка из реального bootstrap `header.ut`):

```
{%
	import { getuid, getspnam } from 'luci.core';

	const boardinfo = ubus.call('system', 'board') ?? {};

	http.prepare_content('text/html; charset=UTF-8');
-%}
<!DOCTYPE html>
<html lang="{{ dispatcher.lang }}">
	<head>
		<meta charset="utf-8">
		<title>{{ striptags(`${boardinfo.hostname ?? '?'}${dispatched?.title ? ` | ${_(dispatched.title)}` : ''}`) }}</title>
		<meta name="viewport" content="width=device-width, initial-scale=1">
		<meta name="darkreader-lock">
		<link rel="stylesheet" href="{{ media }}/cascade.css">
		<link rel="icon" href="{{ media }}/logo_48.png" sizes="48x48">
		<link rel="icon" href="{{ media }}/logo.svg" sizes="any">
		{% if (node?.css): %}
		<link rel="stylesheet" href="{{ resource }}/{{ node.css }}">
		{% endif %}
		{% if (css): %}
		<style title="text/css">{{ css }}</style>
		{% endif %}
		<script src="{{ dispatcher.build_url('admin/translations', dispatcher.lang) }}"></script>
		<script src="{{ resource }}/cbi.js"></script>
	</head>

	<body class="lang_{{ dispatcher.lang }} {{ entityencode(striptags(node?.title ?? ''), true) }}" data-page="{{ entityencode(join('-', length(ctx.request_path) ? ctx.request_path : ctx.path), true) }}">
		{% if (!blank_page): %}
		<header>
			<a class="brand" href="/">{{ striptags(boardinfo.hostname ?? '?') }}</a>
			<ul class="nav" id="topmenu" style="display:none"></ul>
			<div id="indicators" class="pull-right"></div>
		</header>

		<div id="maincontent" class="container">
			<noscript>
				<div class="alert-message warning">
					<h4>{{ _('JavaScript required!') }}</h4>
				</div>
			</noscript>
			<div id="tabmenu" style="display:none"></div>
		{% endif %}
```

Bootstrap дополнительно показывает предупреждения: «пароль root не задан»
(`getuid() == 0 && getspnam('root')?.pwdp === ''`) и «recovery/initramfs режим»
(`boardinfo.rootfs_type == "initramfs"`). Стоит сохранить в своей теме.

`data-page` на `<body>` — важен: CSS luci-base и приложений таргетирует страницы
по этому атрибуту (напр. `[data-page="admin-status-overview"]`).

> **Реальный header footstrap отличается.** Каталог шаблонов **один** —
> `ucode/template/themes/footstrap/`; `header.ut` тонкий: `<head>`, бренд, notices,
> appearance и logout вынесены в `partials/*.ut`. Раскладка (сайдбар / верхний бар) —
> **не второй шаблон**, а `:root[data-layout]` + CSS.
>
> - `data-page` собирается из **диспетч-пути**:
>   `join('-', length(ctx.path) ? ctx.path : ctx.request_path)` — обратный порядок
>   относительно bootstrap. На firstchild-маршруте (`/admin/status` рендерит overview)
>   `request_path` = `['admin','status']`, и `data-page` выходил `admin-status`: правила
>   `body[data-page='admin-status-overview']` и overview-include молча не применялись.
> - Первый элемент `<body>` — skip-link `<a class="fs-skip" href="#maincontent">`;
>   контейнер контента — `<main class="fs-main" id="maincontent" tabindex="-1">`, а меню
>   сайдбара — `<nav class="fs-sidebar" aria-label>` (у `<aside>` роль `complementary`,
>   по ней к меню нельзя перейти лендмарком).
> - Заголовок документа — `<h1 class="fs-title-main">` внутри `<div class="fs-title fs-sr">`.
>   Контейнер **клиппится** (`.fs-sr`), а НЕ `hidden`: `hidden` — это `display:none`,
>   который выкидывает элемент и из дерева доступности, т.е. h1 не было вообще, а
>   SPA-роутер обновлял узел, недоступный скринридеру. Клиппнутый — остаётся в дереве.
> - `partials/head.ut`: `cascade.css`, `node.css` и `cbi.js` идут с `?v={{ pkgs_update_time }}`
>   (uhttpd не шлёт Cache-Control); preload двух latin-сабсетов Manrope; `<style>` без
>   атрибута `title` (на `<style>` он объявляет alternate style sheet set, а не MIME);
>   `<title>` и интерполяции — через `entityencode(striptags(...))`.
> - Предупреждения (нет пароля root / initramfs / noscript) и `#tabmenu` — в
>   `partials/notices.ut`, заголовки в них `<h2>`, а не `<h4>`.

### `partials/head.ut`: `data-layout` и пре-пейнт — это контракт, а не украшение

- **`<html data-layout="…">` сервер штампует ВСЕГДА и явным значением** (`sidebar` | `top`;
  источник — `luci.main.footstrap_layout`, который uci-defaults ставит в `top` при миграции
  со старой верхней темы). Два следствия: каждое layout-правило матчится **позитивно**
  (будущая третья раскладка обязана явно подписаться, а не унаследовать правила сайдбара
  просто «не будучи top» — что и сделал бы `:not([data-layout="top"])`, поэтому такой guard
  писать нельзя), и хром корректен при выключенном JS.
- Дальше идут **инлайновые пре-пейнт скрипты** — по одному на ось Appearance (тёмный режим,
  палитра, обои, скругление, tint, accent, icon-rail, сохранённая раскладка). Они дублируют
  живые applier'ы в `fs-prefs.js`/`fs-update.js` и **не могут** переиспользовать их код: этот
  код выполняется до того, как появится загрузчик модулей.
- **Свойство ставится ПЕРЕД атрибутом.** `root.style.setProperty('--fs-tint-h', …)`, и только
  потом `root.setAttribute('data-tint', '')`. Наоборот — и перезагрузка рисует один кадр
  предыдущим оттенком. Симптом — ровно один неверный кадр, о котором никто не сообщит;
  поэтому контракт (ключи localStorage, атрибуты, свойства, диапазоны 1–360, дефолт
  скругления, порядок) выводится **из JS** и сверяется с шаблоном гейтом `tools/axes.mjs`
  (`npm run axes`).

## footer.ut

```
		{% if (!blank_page): %}
		</div>  {# закрыть #maincontent #}
		<footer>
			<span>
				Powered by
				<a href="https://github.com/openwrt/luci">{{ version.luciname }} ({{ version.luciversion }})</a> /
				<a href="{{ entityencode(version.disturl ?? '#', true) }}">{{ version.distname }} {{ version.distversion }} ({{ version.distrevision }})</a>
			</span>
			<ul class="breadcrumb pull-right" id="modemenu" style="display:none"></ul>
		</footer>
		<script>L.require('menu-mytheme')</script>
		{% endif %}
	</body>
</html>
```

`L.require('menu-mytheme')` грузит `/www/luci-static/resources/menu-mytheme.js`.
На этот момент `L` уже определён (luci-base вставляет `luci.js` между header
темы и контентом).

> **У footstrap** `footer.ut` — **один** и в одну строку: `include('…/partials/footer')`
> **без параметров**. Параметр `menu_module`, выбиравший рендерер, исчез вместе со вторым
> рендерером: `partials/footer.ut` жёстко грузит `L.require('menu-footstrap')`, а следом
> `L.require('fs-select')`. В общем футере: `<footer class="fs-footer" role="contentinfo">`
> (роль явная — implicit `contentinfo` у `<footer>` есть, только когда ближайший предок —
> `<body>`, а этот лежит внутри `<main>`), строки версии обёрнуты в `entityencode`.

## sysauth.ut (страница логина) — ОБЯЗАТЕЛЕН для темы со своим хромом

**Не «опционально».** Без `sysauth.ut` в каталоге темы диспетчер откатывается на generic-шаблон
luci-base, а тот включает header **без `blank_page`** — и весь хром (сайдбар, меню, футер)
рисуется вокруг формы логина, причём все его контроли мертвы: сессии ещё нет. Единственное, что
шаблон темы обязан изменить в generic-варианте, — это передать `blank_page: true`:

```
{% include('header', { blank_page: true }) %}
… форма …
{% include('footer', { blank_page: true }) %}
```

Ровно это и делает `ucode/template/themes/footstrap/sysauth.ut` — **форму рендерит СЕРВЕР**.

### Паттерн bootstrap (`<section hidden>` + view-модуль) — ЗАПРЕЩЁН

У bootstrap серверный шаблон прячет форму в `<section hidden>`, а рисует её клиентский view
(`ui.instantiateView('<theme>.sysauth')` из `resources/view/<theme>/sysauth.js`). **Здесь это
пробовали, и получилась ПУСТАЯ СТРАНИЦА, с которой невозможно залогиниться:** view
бутстрапится до того, как существует сессия, его RPC отвечают «Access denied», промис
реджектится — и `render()` не вызывается никогда. Форма так и остаётся под `hidden`.

Серверный рендеринг лишён всех трёх проблем: работает с выключенным JS, не ломается от
отклонённого промиса и не требует установленного `luci-theme-bootstrap`. Не возвращать.

Переменные sysauth: `duser` (дефолтный логин), `fuser` (неудачный логин), `auth_fields`,
`auth_message`, `auth_plugin`, `auth_html`, `auth_assets` (расширения аутентификации, напр. 2FA).

Строки логина **намеренно без msgctxt** — пусть их переводит luci-base в тех ~40 языках, для
которых у темы нет своего каталога (см. правило про msgid как глобальное имя в CLAUDE.md).

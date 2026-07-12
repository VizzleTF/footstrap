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

> **Реальный header footstrap отличается.** `ucode/template/themes/footstrap/header.ut`
> и `footstrap-top/header.ut` — тонкие: `<head>`, бренд, notices, appearance и logout
> вынесены в `themes/footstrap/partials/*.ut` (одни на оба layout'а).
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
> - В обоих layout'ах есть `<h1 class="fs-title-main">` (визуально скрыт, контейнер
>   `[hidden]`) — без него у документа не было h1 вообще.
> - `partials/head.ut`: `cascade.css`, `node.css` и `cbi.js` идут с `?v={{ pkgs_update_time }}`
>   (uhttpd не шлёт Cache-Control); preload двух latin-сабсетов Manrope; `<style>` без
>   атрибута `title` (на `<style>` он объявляет alternate style sheet set, а не MIME);
>   `<title>` и интерполяции — через `entityencode(striptags(...))`.
> - Предупреждения (нет пароля root / initramfs / noscript) и `#tabmenu` — в
>   `partials/notices.ut`, заголовки в них `<h2>`, а не `<h4>`.

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

> **У footstrap** `footstrap/footer.ut` и `footstrap-top/footer.ut` — по одной строке:
> обе включают `partials/footer.ut`, передавая `menu_module` (`menu-footstrap` /
> `menu-footstrap-top`). В общем футере: `<footer class="fs-footer" role="contentinfo">`
> (роль явная — implicit `contentinfo` у `<footer>` есть, только когда его ближайший
> предок `<body>`, а этот лежит внутри `<main>`), строки версии обёрнуты в
> `entityencode`, и после меню грузится ещё `L.require('fs-select')`.

## sysauth.ut (страница логина) — опционально

Если файла нет — рендерится generic `sysauth.ut` из luci-base (работает с любой
темой). Свой нужен только для кастомного вида логина.

Паттерн bootstrap: серверный шаблон отдаёт скрытую форму + JS-view рисует UI:

```
{% include('header', { blank_page: true }) %}

<section hidden>
	<form method="post" class="cbi-map">
		<input name="luci_username" id="luci_username" type="text" value="{{ entityencode(duser, true) }}">
		<input name="luci_password" id="luci_password" type="password">
		{# + auth_fields / auth_message / fuser — см. оригинал #}
	</form>
	<button class="btn cbi-button-positive important">{{ _('Log in') }}</button>
</section>

<div id="view">
	<div class="spinning">{{ _('Loading view…') }}</div>
	<script>
		L.require('ui').then(function(ui) {
			ui.instantiateView('mytheme.sysauth');
		});
	</script>
</div>

{% include('footer', { blank_page: true }) %}
```

Переменные sysauth: `duser` (дефолтный логин), `fuser` (неудачный логин),
`auth_fields`, `auth_message`, `auth_plugin`, `auth_html`, `auth_assets`
(расширения аутентификации, напр. 2FA). Клиентский view кладётся в
`htdocs/luci-static/resources/view/mytheme/sysauth.js`.

**Проще для старта**: не делать sysauth вообще — generic страница логина
подхватит ваш CSS через header/footer с `blank_page`.

# Архитектура LuCI в OpenWrt 24.10 / 25.12+: как рендерятся темы

> Источник: исходники `openwrt/luci` (закреплённый коммит + ветка `openwrt-24.10`,
> см. `luci-theme-footstrap/luci-upstream.pin` и док 07), проверено на живом роутере
> OpenWrt 25.12.2 (r32802, LuCI bootstrap 26.134).

**Тема поддерживает обе ветки, и API шаблонов у них одинаков** — это проверено против
`openwrt-24.10`, а не предположено: на 24.10 LuCI **уже ucode** (`modules/luci-base/ucode/`
там есть), и весь API, которым пользуется тема, на месте — `ctx.path`, `ctx.request_path`,
`entityencode`, `striptags`, `dispatcher.build_url/lookup/lang`, `ubus.call`,
`pkgs_update_time` (его определение на 24.10 уже умеет откатываться с `/lib/apk/db/installed`
на `/usr/lib/opkg/status`). Блоб `L.env`, который печатает `header.ut` самого luci-base,
**побайтово одинаков** между ветками, поэтому `L.env.dispatchpath` (на него завязаны меню и
SPA-роутер) есть в обеих.

Различие ровно одно — **менеджер пакетов**: apk на 25.12+, opkg/`.ipk` на 24.10. CI собирает
оба формата; `install.sh` и `footstrap-selfupdate.sh` определяют, который стоит на роутере.

## Ключевой сдвиг: ucode вместо Lua

Начиная с ветки, попавшей в 23.05+, и полностью в 25.12, LuCI работает на **ucode**
(си-подобный скриптовый язык от авторов OpenWrt), а не на Lua:

- Диспетчер: `/usr/share/ucode/luci/dispatcher.uc`
- Рантайм: `/usr/share/ucode/luci/runtime.uc`
- Шаблоны: `*.ut` (ucode templates) в `/usr/share/ucode/luci/template/`
- Страницы (views) рендерятся **на клиенте** JavaScript-ом (`luci.js`, модули в
  `/www/luci-static/resources/view/**`). Сервер отдаёт только "скорлупу":
  header + пустой `<div id="view">` + footer.

Для темы это значит: **тема = серверная скорлупа (header/footer на ucode) + CSS +
клиентский JS для меню**. Никакого Lua, никаких серверных контроллеров.

## Как LuCI выбирает тему (runtime.uc)

Точный алгоритм из `modules/luci-base/ucode/runtime.uc`:

```ucode
// determine theme
let media = uci.get('luci', 'main', 'mediaurlbase');          // напр. '/luci-static/mytheme'
let status = self.trycompile(`themes/${basename(media)}/header`);

if (status !== true) {
    media = null;
    self.env.media_error = status;
    // fallback: перебор всех зарегистрированных тем из luci.themes
    for (let k, v in uci.get_all('luci', 'themes')) {
        if (substr(k, 0, 1) != '.') {
            status = self.trycompile(`themes/${basename(v)}/header`);
            if (status === true) { media = v; break; }
        }
    }
    if (!media)
        env.dispatcher.error500(`Unable to render any theme header template...`);
}

self.env.media    = media;              // '/luci-static/mytheme'
self.env.theme    = basename(media);    // 'mytheme'
self.env.resource = uci.get('luci', 'main', 'resourcebase');  // '/luci-static/resources'
```

Выводы:

1. Имя темы = `basename(mediaurlbase)`. Шаблон обязан лежать в
   `/usr/share/ucode/luci/template/themes/<имя>/header.ut`.
2. Если header темы не компилируется — LuCI молча откатывается на первую рабочую
   тему из `luci.themes` и показывает индикатор "Theme fallback" с текстом ошибки
   (см. `footer.ut` luci-base, переменная `media_error`). Удобно для отладки:
   синтаксическая ошибка в header не кладёт интерфейс.
3. `resource` всегда `/luci-static/resources` — общие ресурсы luci-base (luci.js,
   cbi.js, иконки), темам их трогать нельзя.

## Конвейер рендеринга страницы

`modules/luci-base/ucode/template/view.ut` — то, что рендерит диспетчер для любой
страницы:

```
view.ut
 ├─ include('header')                 → luci-base header.ut
 │    ├─ include(`themes/${theme}/header`)   ← ВАШ header.ut (весь HTML до контента)
 │    └─ <script src="{{resource}}/luci.js?v=..."> + L = new LuCI({...env...})
 ├─ <div id="view"> + ui.instantiateView('<view>')   ← клиентский рендер страницы
 └─ include('footer')                 → luci-base footer.ut
      ├─ apply/rollback триггеры, индикатор media_error
      └─ include(`themes/${theme}/footer`)   ← ВАШ footer.ut (закрыть теги, меню-JS)
```

Т.е. тема НЕ вызывается напрямую — её header/footer включаются обёртками luci-base.
`luci.js` подключает сам luci-base **после** header темы. Кэш-бастинг через
`?v=<версия>-<pkgs_update_time>`.

## Страница логина (sysauth)

Диспетчер (`dispatcher.uc`) при показе логина пробует шаблон темы:

```ucode
let theme_sysauth = `themes/${basename(runtime.env.media)}/sysauth`;
if (runtime.is_ucode_template(theme_sysauth) || runtime.is_lua_template(theme_sysauth))
    // рендерит его, при ошибке — media_error и generic sysauth.ut
```

Если у темы нет `sysauth.ut` — используется общий `sysauth.ut` из luci-base.
Bootstrap имеет свой: серверный `sysauth.ut` (скрытая `<section hidden>` с формой,
data для JS) + клиентский view `htdocs/luci-static/resources/view/bootstrap/sysauth.js`,
который рисует форму через `ui.instantiateView('bootstrap.sysauth')`.

**Практический вывод (его нет ни здесь, ни в доке 03): тема со своей "скорлупой" ОБЯЗАНА
везти свой `sysauth.ut`.** Общий шаблон luci-base начинается с `{% include('header') %}` —
**без `blank_page`** (проверено на роутере: `/usr/share/ucode/luci/template/sysauth.ut`). А
`header.ut` темы прячет всю скорлупу именно под `{% if (!blank_page) %}`. Итог отсутствия
своего sysauth: вокруг формы логина рисуется весь сайдбар/меню/футер, и все его контроли
мертвы — сессии ещё нет, меню не грузится. Наш `sysauth.ut` существует ровно ради
`{% include('header', { blank_page: true }) %}`; форму рендерит **сервер** (работает с
выключенным JS и не ломается отклонённым промисом — копия bootstrap'овской схемы со скрытой
`<section hidden>` + view давала здесь пустую страницу без возможности войти: view стартует
до сессии, его RPC отвечают "Access denied", `render()` не выполняется).

## Меню — целиком на клиенте

Серверный header темы выводит только пустые контейнеры по id, а наполняет их клиентский JS.
Так это делает **bootstrap** (`style="display:none"` — его приём, а не контракт LuCI и не то,
что делаем мы: у нас контейнеры видимы, скрывать их незачем):

```html
<ul class="nav" id="topmenu" style="display:none"></ul>
<div id="tabmenu" style="display:none"></div>
<ul class="breadcrumb pull-right" id="modemenu" style="display:none"></ul>
```

Footer темы грузит JS-модуль: `<script>L.require('menu-bootstrap')</script>` (у нас —
`menu-footstrap` + `fs-select`). Файл `htdocs/luci-static/resources/menu-<тема>.js` —
baseclass, в `__init__` делает `ui.menu.load().then(tree => this.render(tree))` и наполняет
контейнеры (`renderModeMenu` / `renderMainMenu` / `renderTabMenu`). Дерево меню приходит
с сервера JSON-ом (права уже отфильтрованы).

**Важно**: menu-JS кладётся в `htdocs/luci-static/resources/` (не в каталог темы),
потому что грузится через `L.require()`, который ищет в `resourcebase`. Оттуда же
подтягиваются зависимости по прагмам `'require <модуль> as <имя>'` — так у нас
`menu-footstrap` тянет `fs-fit` и `menu-footstrap-common`.

## Регистрация темы в UCI

Конфиг `/etc/config/luci`:

```
config core 'main'
    option mediaurlbase '/luci-static/bootstrap'   # активная тема
    option resourcebase '/luci-static/resources'

config internal 'themes'
    option Bootstrap '/luci-static/bootstrap'       # список доступных тем
    option BootstrapDark '/luci-static/bootstrap-dark'
    option MyTheme '/luci-static/mytheme'           # ← ваша
```

Выпадающий список тем в System → System → Language and Style строится из секции
`themes`. Регистрация — через `uci-defaults` скрипт пакета (см. док 02).

Обратите внимание: `BootstrapDark` — это приём **bootstrap** (отдельная тема-symlink на
каждый режим). Footstrap регистрирует **одну** запись `Footstrap` → `/luci-static/footstrap`;
режим, палитра и раскладка — клиентские оси (localStorage + атрибуты на `:root`, до первой
отрисовки их проставляет `partials/head.ut`), а не записи в `luci.themes`. Легаси-имена
(`FootstrapDark`, `FootstrapTop`, …) `uci-defaults` активно удаляет и мигрирует
`mediaurlbase` на единственный оставшийся путь.

## Схема каталогов в рантайме (на роутере)

Что кладёт `luci.mk`: `ucode/` → `/usr/share/ucode/luci`, `htdocs/` → `/www`, `root/` → `/`.
Реальная раскладка footstrap:

```
/usr/share/ucode/luci/template/themes/footstrap/
        header.ut, footer.ut, sysauth.ut, partials/*.ut
        (sysauth.ut ОБЯЗАТЕЛЕН — см. раздел про sysauth выше)
/www/luci-static/footstrap/             cascade.css (генерится build-css.sh), fonts/, logo.svg, …
/www/luci-static/resources/
        menu-footstrap.js               единственный рендерер меню (аккордеон/бар/флайаут)
        menu-footstrap-common.js        общая скорлупа, SPA-роутер, попап Appearance
        fs-fit.js                       общий «а влезает ли?» движок (ResizeObserver, rAF)
        fs-select.js                    <select> → ui.Dropdown, карточный режим таблиц
/www/luci-static/resources/view/status/include/05_footstrap_overview_layout.js
        аддитивный layout-only инклюд Overview (LuCI сам подхватывает *.js из этого каталога)
/usr/lib/lua/luci/i18n/footstrap-theme.<lang>.lmo
        каталог переводов — едет ВНУТРИ пакета темы (не отдельным luci-i18n-*, см. док 13)
/usr/libexec/footstrap-selfupdate.sh    бэкенд кнопки Update
/usr/share/rpcd/acl.d/luci-theme-footstrap.json   ACL, разрешающий его exec
/usr/share/luci-theme-footstrap/.installed        маркер «уже ставились» (см. ниже)
/etc/uci-defaults/30_luci-theme-<тема>            регистрация в uci
```

**`uci-defaults` у этого пакета выполняется ДВАЖДЫ за установку, а не один раз.** Его зовёт
наш `postinst`, и вдобавок штатный `default_postinst` OpenWrt прогоняет (а затем удаляет)
каждый `/etc/uci-defaults/*` из пакета. Скрипт идемпотентен, так что это безвредно.
Свежая установка отличается от апгрейда **файлом-маркером** `/usr/share/luci-theme-footstrap/.installed`,
который пишется в самом конце скрипта (первый проход видит именно свежую установку) и удаляется
в `postrm`. Раньше guard'ом был `$PKG_UPGRADE`, но apk его никогда не выставляет — в проде
условие было мёртвым (см. док 02).

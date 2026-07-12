# Реализация варианта 1B — Top-nav (меню сверху)

Второй вариант раскладки `footstrap-top` — горизонтальное меню сверху (как сток
bootstrap / макет 1B). Выбирается в System → System → Language and Style наравне
с sidebar-вариантом. Общие с sidebar: `cascade.css`, шрифты, логотип,
overview-include, партиалы шаблона, все токены и компоненты. Отличие — только
раскладка хрома.

## Как устроен выбор

LuCI выбирает тему по `luci.main.mediaurlbase` → `basename` → каталог шаблонов
`themes/<basename>/header` (док 01). В `luci.themes` регистрируются **две**
записи — по одной на раскладку (`root/etc/uci-defaults/30_luci-theme-footstrap`):

```
FootstrapSidebar   /luci-static/footstrap      (sidebar)
FootstrapOnTop     /luci-static/footstrap-top  (top-nav)
```

Записей dark/light больше нет: режим (auto/light/dark) и палитра — **клиентские**
переключатели в поповере Appearance, а не темы. Прежние шесть имён
(`Footstrap`, `…Dark`, `…Light`, `FootstrapTop`, …) uci-defaults удаляет, а
`luci.main.mediaurlbase`, застрявший на одном из старых путей, мигрирует на
выжившую раскладку. Режим ставит инлайновый скрипт в `partials/head.ut` — до
первой отрисовки, из `localStorage`/`prefers-color-scheme`:

```js
var saved = localStorage.getItem('fs-darkmode');      /* 'true' | 'false' | null */
var mq = window.matchMedia('(prefers-color-scheme: dark)');
function set(dark) { root.setAttribute('data-darkmode', dark ? 'true' : 'false'); }
if (saved === 'true' || saved === 'false') set(saved === 'true');
else                                       set(mq.matches);
```

## Файлы

```
ucode/template/themes/footstrap/{header.ut, footer.ut, partials/*}  sidebar + ОБЩИЕ партиалы
ucode/template/themes/footstrap-top/{header.ut, footer.ut}          реальные (top layout),
                                                                    инклюдят те же partials

htdocs/luci-static/footstrap-top -> footstrap   (symlink: общий CSS/шрифты/лого)

htdocs/luci-static/resources/menu-footstrap-top.js      горизонтальный рендер меню
htdocs/luci-static/resources/menu-footstrap-common.js   общее: табы, режимы, Appearance, SPA
```

Медиа-каталог top-раскладки — symlink на `footstrap`, поэтому `{{ media }}/cascade.css`
отдаёт тот же файл (одна кодовая база стилей). Шаблонный каталог `-top` реальный
(своя раскладка), но `head`/`brand`/`appearance`/`logout`/`notices`/`footer` он
инклюдит из `themes/footstrap/partials/` — общий хром описан один раз.

## Раскладка (header.ut top)

```
body.fs-top
 a.fs-skip                          skip-link «Skip to content» (первый таб-стоп)
 .fs-topwrap
   header.fs-topnav                 sticky бар (46px, блюр): лого+hostname |
                                    nav.fs-navwrap > ul#topmenu.fs-mainmenu (гориз.) |
                                    .fs-topnav-right (#indicators + Appearance + logout)
   ul#modemenu.fs-modemenu-top      (скрыт, если один режим)
   main.fs-main.fs-main-top #maincontent
     .fs-title[hidden] > h1         заголовок документа (визуально скрыт, для скринридера)
     .fs-content (max --fs-content-max = 1280, центр)  предупреждения, #tabmenu, #view
     footer.fs-footer
```

Тумблер `body.fs-top` включает top-CSS; sidebar-правила (`.fs-shell/.fs-sidebar`)
не применяются (другие классы). Один `cascade.css` обслуживает обе раскладки.

## menu-footstrap-top.js

Горизонтальное меню с одним уровнем дропдаунов: `#topmenu` — верхние разделы в
ряд; у раздела с детьми — `ul.dropdown-menu` (абсолютный поповер, показ по
`:hover` на pointer-устройствах и по тапу/клику через `.open`; панель у правого
края экрана подвигается внутрь вьюпорта — `clampDropdown`). Раздел с детьми —
disclosure-паттерн W3C APG: `role="button"` + `aria-haspopup` + `aria-expanded` +
`aria-controls`, Enter/Space открывают, Escape закрывает и возвращает фокус на
триггер (WCAG 2.2 SC 1.4.13).

Файл несёт **только** `renderMainMenu` и передаёт его в `common.init()`:
`#tabmenu` (вкладки раздела), `#modemenu` (режимы), поповер Appearance
(режим/палитра/обои/скругление, `localStorage`) и SPA-роутер живут в общем
`menu-footstrap-common.js` — тот же код, что и у sidebar.

## Проверка

- `ucode -c` header/footer top — OK
- Активация `footstrap-top` → overview 200, top-nav разметка, нет fallback
- `cascade.css` отдаётся через `/luci-static/footstrap-top` (symlink) — 200
- Переключение в списке тем меняет раскладку (две записи: `FootstrapSidebar` /
  `FootstrapOnTop`); dark/light/auto переключаются в Appearance, без перезагрузки
- Overview-include и все фиксы стилей — общие, работают в обоих вариантах

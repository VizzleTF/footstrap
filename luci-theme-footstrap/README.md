# luci-theme-footstrap (пакет)

Тема LuCI для OpenWrt **24.10 и новее** (ucode-шаблоны). Дизайн — макет «OpenWrt
Status Redesign» (`../docs/08-design-system.md`).

Внутреннее имя: `footstrap`. Media-путь: `/luci-static/footstrap`.

## Одна тема, одна запись

В `luci.themes` регистрируется **ровно одна** запись — `Footstrap`
(`/luci-static/footstrap`). Раскладка (боковое меню / верхняя панель), режим,
палитра, обои, оттенок, акцент и скругление — **клиентские** оси в поповере
Appearance: `localStorage` + атрибуты на `:root`, ничего не пишется на роутер.
Отдельных тем под раскладку или под тёмный режим нет; все легаси-имена
(`FootstrapSidebar`, `FootstrapOnTop`, `…-dark`/`…-light`) удаляются в
`root/etc/uci-defaults/30_luci-theme-footstrap`.

Рендерер меню тоже один: `menu-footstrap.js`. Верхняя панель — это его же
разметка, которую морфит CSS по `:root[data-layout]`. Второго шаблона, второго
рендерера и симлинка `footstrap-top` не существует.

**Граница темы:** тема даёт хром и дизайн-язык; контент страниц рисует view-JS
`luci-mod-*`. Единственное исключение — `05_footstrap_overview_layout.js`: он
не рисует своего контента, а только переставляет штатные секции overview.
Подробно — `../docs/08-design-system.md`, раздел «Границы», и `../CLAUDE.md`.

## Структура

```
Makefile                          luci.mk; LUCI_MINIFY_CSS:=0; Build/Prepare (CSS, версия, po2lmo)
styles/                           ИСТОЧНИК CSS: слои tokens / base / theme / pages
build-css.sh                      styles/ -> htdocs/luci-static/footstrap/cascade.css
i18n/                             каталог перевода (НЕ po/ — иначе luci.mk наплодит пакетов)
ucode/template/themes/footstrap/  header.ut, footer.ut, sysauth.ut, partials/
htdocs/luci-static/footstrap/     cascade.css (генерируется), fonts/, cats.svg
htdocs/luci-static/resources/     menu-footstrap.js (рендерер), menu-footstrap-common.js (bootstrap),
                                  fs-{menutree,prefs,widgets,chrome,router,sheets,version,appearance}.js,
                                  fs-fit.js, fs-select.js
  …/view/status/include/          05_footstrap_overview_layout.js
root/etc/uci-defaults/            регистрация темы и миграция легаси-имён
root/usr/share/rpcd/acl.d/        luci-theme-footstrap.json (ACL: uci footstrap — Save-as-default)
```

Проверка обновлений и самообновление — в ОТДЕЛЬНОМ необязательном пакете
`luci-app-footstrap-updater` (свой `fs-update.js`, backend `footstrap-selfupdate.sh`,
ACL `file.exec` и ключ `release.pub`). Без него тема полностью работает — поповер
показывает версию (из `fs-version.js`) без контролов обновления.

**`cascade.css` не редактируется** — он генерируется `build-css.sh` из `styles/`
и лежит в `.gitignore`. Цвета правятся в `styles/03-palettes.css`, шкалы и
токены — в `styles/02-tokens.css`.

## Разработка на роутере

```sh
./dev-sync.sh          # залить на ssh router (регистрирует, но НЕ активирует тему)
# включить вручную:
ssh router 'uci set luci.main.mediaurlbase=/luci-static/footstrap; uci commit luci; rm -f /tmp/luci-indexcache*'
# откат:
ssh router 'uci set luci.main.mediaurlbase=/luci-static/bootstrap; uci commit luci'
```

Перед пушем — `npm run check` (eslint, stylelint, axe, экспорт-ярус, i18n,
`@mirror`, оси Appearance и остальные гейты). Правила и ловушки — в `../CLAUDE.md`;
сборка пакета — `../docs/05-build-deploy-development.md`.

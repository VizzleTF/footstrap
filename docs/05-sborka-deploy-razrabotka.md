# Сборка, деплой и цикл разработки

## Два режима работы

1. **Быстрый цикл (без сборки)** — правим файлы прямо на роутере / scp с хоста.
   Тема — это шаблоны + статика; единственный шаг сборки — `build-css.sh`,
   который склеивает дерево `styles/` в `cascade.css` (только `cat`/`awk`,
   docs/17). Основной режим при разработке.
2. **Пакет .apk через SDK** — для распространения и чистой установки.

## Быстрый цикл разработки на живом роутере

Целевые пути (см. док 01):

```
/usr/share/ucode/luci/template/themes/mytheme/{header.ut,footer.ut}
/www/luci-static/mytheme/cascade.css ...
/www/luci-static/resources/menu-mytheme.js
```

### Первичная заливка (роутер `ssh router`)

```sh
# 1. БЕКАП затрагиваемого (одноразово, до любых изменений)
ssh router 'mkdir -p /root/theme-backup && \
  cp -a /etc/config/luci /root/theme-backup/luci.config && \
  tar -C / -czf /root/theme-backup/luci-theme-orig.tar.gz \
    usr/share/ucode/luci/template/themes www/luci-static'

# 2. Каталоги + файлы
ssh router 'mkdir -p /usr/share/ucode/luci/template/themes/mytheme /www/luci-static/mytheme'
scp ucode/template/themes/mytheme/*.ut router:/usr/share/ucode/luci/template/themes/mytheme/
scp htdocs/luci-static/mytheme/*       router:/www/luci-static/mytheme/
scp htdocs/luci-static/resources/menu-mytheme.js router:/www/luci-static/resources/

# 3. Регистрация (НЕ переключая активную тему — безопасно)
ssh router 'uci set luci.themes.MyTheme=/luci-static/mytheme && uci commit luci'
```

Дальше тема выбирается в LuCI: System → System → Language and Style, или:

```sh
ssh router 'uci set luci.main.mediaurlbase=/luci-static/mytheme && uci commit luci'
```

### Страховка от поломки

- Механизм fallback (док 01): если header.ut темы не компилируется, LuCI сам
  откатится на первую рабочую тему из `luci.themes` (bootstrap) и покажет
  индикатор "Theme fallback" с текстом ошибки. Т.е. кривой шаблон **не окирпичит
  веб-интерфейс**.
- Ручной откат в любой момент:
  `ssh router 'uci set luci.main.mediaurlbase=/luci-static/bootstrap && uci commit luci'`
- Совсем всё сломалось: `uci` доступен по ssh, LuCI для восстановления не нужен.

### Кэши при итерации

- Меню/диспетчер кэшируются: `/tmp/luci-indexcache.<hash>.json`. Хэш считается от
  mtime файлов меню — при добавлении/удалении файлов обновляется сам, но при
  странностях: `ssh router 'rm -f /tmp/luci-indexcache*'`.
- Шаблоны `.ut` НЕ кэшируются между запросами (ucode компилирует на лету) —
  правка header.ut видна по F5.
- CSS/JS кэширует браузер: жёсткий reload (Ctrl+Shift+R). `luci.js` грузится с
  `?v=<версия>-<mtime базы пакетов>`; в footstrap с тем же ключом грузится и
  `cascade.css` (`?v={{ pkgs_update_time }}` в `partials/head.ut`), поэтому после
  заливки CSS достаточно `ssh router 'touch /lib/apk/db/installed'` — ключ
  меняется, и файл подхватывается обычным F5, без Disable cache.

### Синхронизация одним скриптом

```sh
luci-theme-footstrap/dev-sync.sh [host]     # host по умолчанию — router
```

Скрипт делает всё разом (только `ssh`/`scp`, rsync на роутере не нужен):
пересобирает `cascade.css` из `styles/` (`build-css.sh --dev`, с комментариями),
копирует шаблоны обеих раскладок (`footstrap/` + `footstrap-top/`, включая
`partials/`), статику, `menu-footstrap.js` / `menu-footstrap-top.js` /
`menu-footstrap-common.js` / `fs-select.js` и overview-include, ставит скрипт
самообновления с его rpcd-ACL, пересоздаёт симлинк `footstrap-top` → `footstrap`
и вычищает легаси-каталоги вариантов, прогоняет `root/etc/uci-defaults/…`
(единственный источник регистрации тем) и сбрасывает кэши.
**Активную тему не меняет.**

## Сборка пакета .apk (OpenWrt 25.12 использует apk, не opkg)

> Автоматическая сборка (**GitHub Actions**, apk + ipk, релизы, `install.sh`,
> поддержка 24.10) вынесена в **docs/13**. Ниже — ручная сборка через SDK.

### Через SDK

Эти же шаги (скачать SDK, положить тему в feed, собрать) автоматизирует
`luci-theme-footstrap/build-apk.sh` — руками они выглядят так:

```sh
# SDK под таргет роутера (пример: mediatek/filogic 25.12.2)
wget https://downloads.openwrt.org/releases/25.12.2/targets/mediatek/filogic/\
openwrt-sdk-25.12.2-mediatek-filogic_gcc-*_musl.Linux-x86_64.tar.zst
tar --zstd -xf openwrt-sdk-*.tar.zst && cd openwrt-sdk-*/

# feeds (нужен luci ради luci.mk и luci-base)
./scripts/feeds update base luci
./scripts/feeds install -a -p luci

# положить тему внутрь feed'а luci
ln -s /path/to/repo/luci-theme-footstrap feeds/luci/themes/luci-theme-footstrap
./scripts/feeds update -i luci && ./scripts/feeds install luci-theme-footstrap

make defconfig
make package/luci-theme-footstrap/compile V=s

# результат
ls bin/packages/*/luci/luci-theme-footstrap*.apk
```

`cascade.css` в git не лежит: его генерирует хук `Build/Prepare` в Makefile
темы — он вызывает `build-css.sh` уже по копии дерева в `PKG_BUILD_DIR` (нужны
только `cat`/`awk`, поэтому это работает и на билдботе OpenWrt). Там же в
`menu-footstrap-common.js` штампуется версия.

### Установка на роутер

```sh
scp bin/packages/*/luci/luci-theme-footstrap*.apk router:/tmp/
ssh router 'apk add --allow-untrusted /tmp/luci-theme-footstrap*.apk'
# удаление
ssh router 'apk del luci-theme-footstrap'
```

`--allow-untrusted` нужен, т.к. локальная сборка не подписана ключом фида.

### Свой feed (для install через menuconfig / собственный репозиторий)

feeds.conf.default в SDK/buildroot:

```
src-git mytheme https://github.com/<you>/<repo>.git
```

Структура репо тогда: `themes/luci-theme-mytheme/…` — feed-скрипты найдут пакет
по Makefile. `include ../../luci.mk` резолвится, если в корне репо лежит копия
`luci.mk` — либо проще указывать полный путь к luci.mk из feed'а luci:
`include $(TOPDIR)/feeds/luci/luci.mk` (footstrap использует именно эту форму —
поэтому его Makefile собирается и из `feeds/luci/themes/`, и просто из
`package/`, как это делает CI).

## Тестовая матрица

- Страницы: Status/Overview (таблицы, ifacebox), Network/Interfaces (zonebadge,
  модалки), Network/Firewall (section-table, dropdown), System/Software (прогресс),
  Realtime graphs (SVG), логин/логаут, Reboot.
- Режимы: светлая/тёмная/auto, обе раскладки (sidebar / top-nav), палитры
  (footstrap / hicontrast), мобильная ширина (мобильный тир — ≤767px; выше 768px
  идёт «планшет/десктоп», у верхнего меню есть ещё компактный тир ≤1199px),
  длинные hostname/SSID.
- Отдельно: страница `apply/rollback` (шторка подтверждения изменений) — рисуется
  ui.js поверх темы, часто ломается кастомными z-index.
- Статические гейты (их же гоняет CI, docs/13): `build-css.sh` сам проверяет
  баланс скобок и бюджет размера; `python3 .claude/skills/footstrap-audit/audit.py
  --strict` (неопределённые `var()`, затенённые правила, лишние `!important`,
  хардкод-цвета — с ненулевым кодом возврата); `npm run lint` (eslint по
  `htdocs/`, stylelint по `styles/`); `npm run a11y` (axe-core по
  `docs/gallery.html`, матрица light/dark × footstrap/hicontrast). Ничего из
  `package.json` в пакет не попадает — на билдботе OpenWrt node нет.

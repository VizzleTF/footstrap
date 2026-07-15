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

- пересобирает `cascade.css` из `styles/` (`build-css.sh --dev`, с комментариями);
- копирует **единственный** каталог шаблонов `themes/footstrap/` вместе с `partials/`.
  Второго каталога нет: sidebar и верхний бар — одна и та же разметка, которую морфит
  `:root[data-layout]`;
- копирует статику (`cascade.css`, шрифты, лого) и **все** resource-JS **глобом**
  (`resources/*.js`: сейчас `menu-footstrap.js`, `menu-footstrap-common.js`, `fs-fit.js`,
  `fs-select.js` и модули концернов `fs-{menutree,prefs,widgets,chrome,router,sheets,update,appearance}.js`)
  плюс overview-include. Именно глобом, а не списком имён: список был
  багом — пятый файл попадал в пакет (`luci.mk` копирует `htdocs/` целиком), но на
  дев-роутер молча не доезжал и впервые проверялся уже после релиза;
- штампует версию из `git describe` в `FS_VERSION` внутри залитого
  `fs-update.js` — то же делает `Build/Prepare` в пакете, иначе поповер
  показывает `dev` и проверка обновлений не работает;
- компилирует каталог переводов `i18n/*/*.po` → `/usr/lib/lua/luci/i18n/footstrap-theme.<lang>.lmo`,
  если в `$PATH` есть `po2lmo` (это host-tool `luci-base`; без него строки остаются
  английскими, синк не падает);
- ставит бэкенд самообновления `/usr/libexec/footstrap-selfupdate.sh` и его rpcd-ACL, затем
  `rpcd reload` (**reload, а не restart**: rpcd держит сессии в памяти, restart разлогинит
  всех);
- **удаляет** (`rm -rf`) легаси-каталоги вариантов, включая `footstrap-top`: верхний бар
  больше не тема, симлинка нет и создавать его не надо;
- прогоняет `root/etc/uci-defaults/30_luci-theme-footstrap` — единственный источник
  регистрации (ОДНА запись `luci.themes.Footstrap`) — и сбрасывает кэши.

**Активную тему не меняет** (`PKG_UPGRADE=1` форсит upgrade-ветку uci-defaults).

### Проверка изменения

- **Шаблон** — тем же `trycompile`, что делает LuCI:
  `ssh router 'ucode -T -c -o /dev/null /usr/share/ucode/luci/template/themes/footstrap/header.ut'`.
  То же гоняет CI.
- **CSS** — скриншотами проверять нельзя: живые счётчики (uptime, DHCP-лизы, сигнал wifi)
  двигают 0.5–1.3% пикселей между двумя прогонами ОДНОГО И ТОГО ЖЕ стиля, а реальная
  регрессия — 0.19%; сигнал под шумом. Дифф считается по computed-стилям: страница грузится
  один раз, `<link>` подменяется на второй файл, снимок `getComputedStyle` по всем элементам —
  DOM и данные те же, значит любая разница вызвана CSS.
  ```sh
  scp -q old.css router:/www/luci-static/footstrap/cascade-a.css
  scp -q new.css router:/www/luci-static/footstrap/cascade-b.css
  LUCI_PW=<pw> python3 .claude/skills/footstrap-audit/cssdiff.py \
    admin/network/firewall admin/system/system admin/status/overview admin/system/opkg
  ```

## Правка JS: комментарии бесплатны, regex-литералы — нет

`LUCI_MINIFY_JS` осознанно НЕ выключен (в отличие от `LUCI_MINIFY_CSS:=0`): `luci.mk` гонит JS
темы через **jsmin** (`luci-base/src/jsmin.c`, он и так на билдботе). Это выгодно — ~72 КБ из
127 КБ JS темы это комментарии, jsmin отдаёт 47 КБ, а uhttpd раздаёт `/www` **без сжатия**, т.е.
это байты и на проводе, и во флеше. Комментировать можно сколько угодно: в пакет они не попадают.

Плата — одно правило, и оно про корректность, а не про стиль. jsmin решает, `/` это regex или
деление, по ОДНОМУ предыдущему символу из фиксированного списка (`( , = : [ ! & | ? + - ~ * / { } ;`).
Ни `n` (последняя буква `return`), ни `>` (из `=>`) в него не входят:

```js
return /^https?:\/\//i.test(a);     // jsmin принимает // за начало комментария, СЪЕДАЕТ
                                    // остаток файла и выходит с кодом 0
return (/^https?:\/\//i.test(a));   // `(` в списке — безопасно
```

Это не теория: openwrt/luci#8299, #8020, #8021, #8256. **Нулевой код возврата jsmin ничего не
доказывает** — порча молчаливая. Отсюда два гейта, оба в CI:

- eslint `wrap-regex` — запрещает саму форму (`npx eslint --fix` расставит скобки);
- `tools/jsmin-verify.mjs` — собирает тот же jsmin из коммита, закреплённого в
  `luci-upstream.pin`, минифицирует каждый уходящий в пакет файл и падает, если поток токенов
  (acorn) не совпал с исходником. Только он ловит порчу с exit 0.

Regex как **аргумент** (`s.replace(/x/g, y)`) уже стоит за `(` или `,` — безопасен. Бэктик
внутри `${…}` в шаблонной строке — тоже нельзя (jsmin теряет строку; падает громко).

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
`fs-update.js` штампуется версия.

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
- Режимы: светлая/тёмная/auto, обе раскладки (sidebar / top — это **клиентский**
  переключатель в поповере Appearance, а не запись темы), палитры (footstrap /
  hicontrast), узкое окно, длинные hostname/SSID.
- **Брейкпойнтов для «влезает или нет» нет — это ИЗМЕРЕНИЕ.** Сайдбар уступает место
  бару, когда ширина контентной колонки (`innerWidth − сайдбар/рельс − паддинги`) падает
  ниже `--fs-content-min`: считает `fitShell()` (`fs-chrome.js`), читая токены
  `--fs-sidebar-w` / `--fs-rail-w` / `--fs-content-min` из CSS (`fs-fit.js` владеет
  наблюдателем и коалесингом), и ставит `data-narrow` на `:root` — на него и смотрят CSS, и
  `flyoutMode()`. Меню верхнего бара так же по измерению сначала ужимается (`.fs-dense1/2`)
  и только потом переезжает на вторую строку (`.fs-bar-stack`): влезет оно или нет, зависит
  от числа разделов на конкретном роутере, а не от экрана. Единственный литерал —
  `@media (min-width: 521px)` в `20-shell.css`: пол, ниже которого никакой срез не оставит
  читаемой колонки, и он же держит хром корректным при выключенном JS. Возвращать вьюпортный
  брейкпойнт для этого вопроса нельзя: было `matchMedia('(max-width: 767px)')`, и в окне
  768–779px хром рисовался баром, пока меню считало себя аккордеоном. Тест — тянуть окно
  мышью, а не проверять точки.
- Отдельно: страница `apply/rollback` (шторка подтверждения изменений) — рисуется
  ui.js поверх темы, часто ломается кастомными z-index.
- Статические гейты (их же гоняет CI, docs/13). `build-css.sh` сам проверяет баланс скобок и
  бюджет размера; остальное — двумя командами:
  ```sh
  npm run check                                          # перед пушем
  python3 .claude/skills/footstrap-audit/audit.py --strict
  ```
  `npm run check` = `lint` (eslint по `htdocs/`, stylelint по `styles/`) → `css-metrics`
  (ratchet: `!important` ≤ 33, максимальная специфичность, пустые правила) → `css-orphans`
  (мёртвые `fs-*`-селекторы; безопасно только внутри своего неймспейса) → `css-dup`
  (одинаковые тела правил под разными гардами: дубль обязан быть либо слит, либо закреплён
  `@mirror`) → `mirror` (закреплённые копии, CSS и shell, побайтно совпадают) → `axes`
  (пре-пейнт в `head.ut` согласован с живыми аппликаторами Appearance) → `export-tier`
  (контракт `--*-color-*` со сторонними `luci-app-*`) → `i18n` (`.pot` актуален, пустых
  msgstr нет) → `a11y` (axe-core по `docs/gallery.html`, матрица light/dark ×
  footstrap/hicontrast). `audit.py --strict` — неопределённые `var()`, затенённые правила,
  мёртвые декларации `base`, лишние `!important`, хардкод-цвета. CI сверх этого гоняет
  `tools/jsmin-verify.mjs` (см. выше), `ucode -T -c` по шаблонам и бюджеты шрифтов/JS.
  Ничего из `package.json` в пакет не попадает — на билдботе OpenWrt node нет.

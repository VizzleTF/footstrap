# Структура пакета темы и Makefile

## Дерево исходников (реальное, `luci-theme-footstrap/`)

```
luci-theme-footstrap/
├── Makefile
├── build-css.sh                   # собирает cascade.css из styles/ (cat+awk, без node)
├── build-apk.sh                   # локальная сборка .apk через SDK (docs/05)
├── dev-sync.sh                    # деплой на живой роутер (docs/05)
├── luci-upstream.pin              # пин коммита openwrt/luci + sha256 заимствованных тулов
├── LICENSE
├── styles/                        # ИСТОЧНИК CSS. НЕ шипается (luci.mk его не копирует)
│   ├── 00-header.css 01-fonts.css 02-tokens.css 03-palettes.css
│   ├── base/  theme/  pages/      # один каталог на cascade-слой, см. docs/17
├── i18n/                          # каталог перевода. Имя каталога — НЕ `po/`, см. ниже
│   ├── templates/footstrap.pot
│   └── ru/footstrap.po
├── htdocs/luci-static/            # → /www/luci-static/
│   ├── footstrap/                 # медиа-каталог темы (mediaurlbase)
│   │   ├── cascade.css            # ГЕНЕРИРУЕТСЯ build-css.sh, в .gitignore — не редактировать
│   │   ├── fonts/*.woff2 + OFL.txt
│   │   ├── logo.svg  logo_48.png  cats.svg
│   └── resources/                 # → /www/luci-static/resources/
│       ├── menu-footstrap.js          # рендер меню (единственный)
│       ├── menu-footstrap-common.js   # bootstrap хрома; концерны — в fs-*.js (см. CLAUDE.md)
│       ├── fs-{fit,menutree,prefs,widgets,chrome,select,sheets,search,router,version,appearance}.js
│       └── view/status/include/05_footstrap_overview_layout.js
├── root/                          # → / (корень rootfs)
│   ├── etc/uci-defaults/30_luci-theme-footstrap   # регистрация темы
│   ├── etc/config/footstrap                       # пустой стаб, пишется рантаймом (Save as default)
│   └── usr/share/rpcd/acl.d/luci-theme-footstrap.json  # ACL: uci footstrap + загрузка login-bg
└── ucode/template/themes/footstrap/    # → /usr/share/ucode/luci/template/...
    ├── header.ut  footer.ut  sysauth.ut
    └── partials/{head,brand,logout,notices,appearance,footer}.ut
```

`luci.mk` ставит автоматически по наличию каталогов (install-рецептов писать не надо):

| Каталог исходника | Куда ставится |
|---|---|
| `ucode/*` | `/usr/share/ucode/luci/` |
| `htdocs/*` | `/www/` |
| `root/*` | `/` |
| `root/etc/uci-defaults/*` | подхватываются как LUCI_DEFAULTS |

Копируются **как есть** только `src/ luasrc/ htdocs/ root/ ucode/ po/`. `styles/` в этот
список не входит — поэтому `cascade.css` собирается в `Build/Prepare` прямо в build-дерево,
а в git его нет.

## Makefile: чем footstrap отличается от шаблонного

```makefile
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-theme-footstrap
LUCI_NAME:=luci-theme-footstrap  # пин: luci.mk именует хук Build/Prepare по LUCI_NAME,
                                 # а тот по умолчанию = имя каталога → сборка CSS
                                 # молча не выполнилась бы в переименованном чекауте
FOOTSTRAP_VERSION?=              # CI инжектит из тега; локально версия git-derived
LUCI_TITLE:=Footstrap Theme
LUCI_DEPENDS:=+luci-base         # ВЕСЬ список зависимостей
LUCI_PKGARCH:=all                # noarch: одна сборка на любой таргет
LUCI_MAINTAINER / LUCI_URL       # иначе пакет объявит мейнтейнером «OpenWrt LuCI community»

LUCI_MINIFY_CSS:=0               # см. ниже
# LUCI_MINIFY_JS НЕ ЗАДАН — и это осознанно, см. ниже

PKG_LICENSE:=Apache-2.0 OFL-1.1  # тема + вебшрифты (OFL §2 требует нести текст лицензии
                                 # рядом: сабсеттер вырезает её из метаданных .woff2)

include $(TOPDIR)/feeds/luci/luci.mk   # АБСОЛЮТНЫЙ путь, не ../../luci.mk: CI rsync'ает
                                       # пакет в package/, а не в feed
```

### Минификация: CSS выключена, JS — ДВА пути

Это разные истории, и путать их дорого.

- **`LUCI_MINIFY_CSS:=0`** — обязательно. luci.mk гонит CSS через **csstidy**, который
  достаточно стар, чтобы манглить `:has()`, `color-mix()` и вложенный `calc()`: пакет
  ставится, верстка разваливается. Минифицирует вместо него `build-css.sh` (свой, строко-
  осведомлённый awk-проход). Верхнего бюджета размера у него больше нет (снят) — остался только
  broken-build FLOOR (отказ писать подозрительно короткий файл).
- **`LUCI_MINIFY_JS` — два пути минификации.** Релизная CI-сборка пре-минифицирует **terser**
  (`tools/minify-js.mjs`, ~41 КБ — умеет манглить идентификаторы, чего jsmin не может) и
  выставляет `FOOTSTRAP_PREMIN=1`, что переводит `LUCI_MINIFY_JS:=0`. Сборка **без** node
  (SDK-пользователь, buildbot) держит дефолтный `1`, и jsmin минифицирует **нетронутый исходник**
  (~57 КБ), как раньше. Комментарии — ~60 % исходника JS, а uhttpd отдаёт `/www` **без сжатия**,
  то есть это байты и на проводе, и во флеше 8–16-МБ железки на обоих путях. Выставить здесь `0`
  вручную (без terser) значит утроить шипаемый JS. Численного бюджета минифицированного JS в CI
  больше нет (снят).

  Опасность jsmin — совсем другая, не «ломает современный ES»: он решает, `/` — это регекс
  или деление, по **одному** предыдущему символу, и ни `n` (из `return`), ни `>` (из `=>`) в
  его allow-list'е нет. `return /re/…` заставляет его сожрать остаток файла **и выйти с кодом
  0** (openwrt/luci#8299). Поэтому исходник обязан оставаться jsmin-безопасным (фолбэк-путь
  всё ещё гоняет jsmin): eslint-правило `wrap-regex` запрещает саму форму, а
  `tools/jsmin-verify.mjs` доказывает, что поток токенов минифицированного файла совпадает с
  исходным. Правила написания JS — в CLAUDE.md, раздел «Writing JS».

### `Build/Prepare`: три вещи и одно правило про каталог перевода

Хук `Build/Prepare/luci-theme-footstrap` (имя ключится на `LUCI_NAME`) выполняется сразу
после копирования исходников в `PKG_BUILD_DIR` и правит **копию**, не дерево:

1. `build-css.sh` → `cascade.css` в build-дерево (`cat`/`awk`, host-тулчейн не нужен — потому
   это и работает на buildbot'е OpenWrt);
2. `sed`'ом штампует git-версию в `fs-version.js` (`FS_VERSION`) — путь к файлу часть контракта
   (тот же `sed` по пути делает `dev-sync.sh`; сдвинуть константу = править оба места);
3. `po2lmo` компилирует каталог перевода **внутрь пакета темы**.
4. Кладёт `LICENSE` в `PKG_BUILD_DIR` — `PKG_LICENSE_FILES` резолвится относительно него, а
   luci.mk корень пакета не копирует.

**Каталог перевода лежит в `i18n/`, а не в `po/`, и это самое дорогое структурное правило
проекта.** `LUCI_LANGUAGES` в luci.mk — это `$(wildcard po/*)`, и при наличии `po/` он
порождает **отдельный пакет `luci-i18n-footstrap-<lang>` на язык**. Так и было в v0.8.4 — и
это **сломало кнопку «Обновить» на всех роутерах в поле** (issue #6):

- `footstrap-selfupdate.sh`, который у людей **уже стоит**, выбирает ассет как
  `grep -E '\.apk$' | head -1`, а GitHub отдаёт ассеты **отсортированными по имени**;
  `luci-i18n-…` сортируется раньше `luci-theme-…`. Кнопка ставила 6-КБ каталог вместо темы,
  рапортовала об успехе и предлагала то же обновление вечно.
- Установленный на роутере скрипт удалённо не чинится. Чинить можно только **релиз** →
  один ассет на формат (CI это проверяет), каталог едет внутри темы.
- Бонус: два пакета расходятся, и тема с отставшим каталогом просто рисует новые строки
  по-английски, не сообщая ничего.

Переименование `po/` → `i18n/` — это и есть то, что глушит генерацию языковых пакетов.

Базовое имя `.lmo` — **`footstrap-theme.<lang>.lmo`**, не `footstrap.<lang>.lmo`:
`lmo_load_catalog` глобает `*.<lang>.lmo`, так что грузится любое имя, а роутер с v0.8.4 всё
ещё **владеет** файлом `footstrap.ru.lmo` через старый пакет — тот же путь = конфликт файлов =
apk откажет ровно в том апгрейде, который это чинит.

### postinst / postrm

`postinst` перезапускает uci-defaults, чистит кэши LuCI и делает **`rpcd reload`, никогда не
`restart`**: rpcd держит сессии в памяти, `restart` разлогинит всех пользователей LuCI —
включая админа, который только что нажал «Обновить». `reload` шлёт SIGHUP, а тот перечитывает
`/usr/share/rpcd/acl.d/*` — единственное, что этому пакету от rpcd и нужно.

(Скрипт uci-defaults отрабатывает **дважды** за установку: его зовёт наш postinst и, отдельно,
`default_postinst` OpenWrt, который прогоняет и затем удаляет все `/etc/uci-defaults/*`. Он
идемпотентен.)

`postrm` не однострочник:

- удаляет **все восемь** имён тем, которые пакет когда-либо регистрировал (`Footstrap`,
  `FootstrapDark/Light`, `FootstrapTop{,Dark,Light}`, `FootstrapSidebar`, `FootstrapOnTop`).
  Список продублирован в uci-defaults по необходимости (postrm бежит, когда того файла уже
  нет) и потому запинен `@mirror theme/legacy-names` — копии не могут разойтись;
- удаляет `luci.main.footstrap_layout` (дефолтный layout роутера — чужим темам он ничего не
  значит, а забытый он тихо вернул бы верхнюю панель при переустановке);
- если активной осталась наша тема — откатывает `mediaurlbase` на bootstrap по **двухчастной**
  проверке (нужны И медиа-каталог, И ucode-шаблон: однобокая проверка отдала бы UI
  полуудалённому bootstrap — той самой белой странице, ради которой ветка и написана);
- сносит `/usr/share/luci-theme-footstrap` (вместе с маркером `.installed`) и делает
  `rpcd reload`.

## uci-defaults: регистрация темы

`root/etc/uci-defaults/30_luci-theme-footstrap` — **единственный источник правды** о
регистрации (его же гоняет `dev-sync.sh`; больше тему не регистрируют нигде).

- Регистрируется **ОДНА** запись: `luci.themes.Footstrap=/luci-static/footstrap`. Layout
  (сайдбар / верхняя панель), палитра, тема и скругления — **клиентские** переключатели в
  поповере Appearance, не записи темы и не серверный выбор.
- Ключ в `themes.<Имя>` — CamelCase без дефисов (ограничение имён опций uci).
- Мигрирует `mediaurlbase`: легаси-пути `-dark`/`-light`/`-top` → на единственный путь
  (плюс `luci.main.footstrap_layout=top`, чтобы роутер со старой верхней темы остался с
  панелью — localStorage из shell'а не напишешь); висящий путь → `bootstrap`.
- Сбрасывает index/module-кэши LuCI.

**Первая установка vs апгрейд решается маркер-файлом**
`/usr/share/luci-theme-footstrap/.installed` (пишется в конце скрипта, сносится в `postrm`):
первая установка может активировать тему, апгрейд — **никогда** не меняет активную.
Классический приём `[ "$PKG_UPGRADE" != 1 ]` здесь **мёртв**: apk эту переменную не
экспортирует, ветка апгрейда на реальном роутере не бралась никогда (её брал только
`dev-sync.sh`, который экспортирует её руками), и апгрейд с пустым `mediaurlbase` включал тему
за спиной пользователя.

## Версия и формат пакетов

Версию не задавать: `luci.mk` выводит `PKG_VERSION` из git; CI инжектит `FOOTSTRAP_VERSION` из
тега (в SDK-сборке нет `.git`, вывести неоткуда).

CI собирает **оба** формата: **apk** для 25.12+ (`apk add --allow-untrusted …`) и **ipk** для
24.10 (`opkg install …`). Подробно — **docs/13**.

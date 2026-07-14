# Источники и внешние ресурсы

Итог ресерча (веб-ресерч с адверсариальной верификацией + прямой анализ исходников
openwrt/luci + живой роутер 25.12.2). Все пункты ниже подтверждены минимум 2–3
независимыми проверками против первоисточников.

## Против какого дерева читать openwrt/luci

Ссылки ниже даны на `master` для удобства чтения, но **на `master` ничего не закрепляется**.

- **Коммит закреплён**: `luci-theme-footstrap/luci-upstream.pin` — единственный источник
  коммита `openwrt/luci` и sha256 двух заимствованных инструментов: `luci-base/src/jsmin.c`
  и `build/i18n-scan.pl`. Оба **скачиваются и ЗАПУСКАЮТСЯ** в CI как гейты (jsmin решает,
  безопасен ли отгружаемый JS; i18n-scan — полон ли каталог переводов). С плавающего
  `master` гейтом было бы то, что апстрим запушил последним. Там же закреплён `UCODE_PIN` —
  интерпретатор ucode, которым CI компилирует `.ut`-шаблоны. `update-po.sh` и workflow
  сорсят этот один файл (раньше коммит был выписан в двух местах с комментарием «бампить
  вместе» — и ничем не подкреплён).
- **Ветка `openwrt-24.10` — равноправный референс.** Тема поддерживает 24.10 и 25.12+, API
  шаблонов у них одинаков (проверено, а не предположено — см. док 01); различие только в
  менеджере пакетов. Сверяться нужно с обеими ветками, а не только с master.
  `jsmin.c` побайтово одинаков на `openwrt-24.10` и `master`, поэтому одной сборки хватает
  на обе.

## Первоисточники (доверять)

| Ресурс | Что там |
|---|---|
| https://github.com/openwrt/luci/tree/master/themes/luci-theme-bootstrap | Эталонная тема. header.ut/footer.ut/sysauth.ut, uci-defaults, Makefile. **Не** копировать его symlink-механику dark/light (см. п. 6) |
| https://github.com/openwrt/luci/wiki/ThemesHowTo | **Актуальный** официальный гайд по темам (ucode-based). Минимальный Makefile: `rules.mk` + `LUCI_TITLE` + `include ../../luci.mk` |
| https://github.com/openwrt/luci/blob/master/modules/luci-base/ucode/runtime.uc | Выбор темы, fallback, env-переменные (media/theme/resource) |
| https://github.com/openwrt/luci/blob/master/modules/luci-base/ucode/dispatcher.uc | sysauth-рендер, indexcache, меню |
| https://github.com/openwrt/luci/blob/master/modules/luci-base/ucode/template/sysauth.ut | Общий шаблон логина. Начинается с `include('header')` **без `blank_page`** — поэтому тема со своей скорлупой обязана везти свой `sysauth.ut` (док 01) |
| https://github.com/openwrt/luci/blob/master/luci.mk | Автоустановка htdocs/ → /www, ucode/ → /usr/share/ucode/luci, root/ → /. Плюс `LUCI_MINIFY_CSS`/`LUCI_MINIFY_JS` и `LUCI_LANGUAGES := $(wildcard po/*)` |
| https://github.com/openwrt/luci/blob/master/modules/luci-base/src/jsmin.c | Минификатор JS, который luci.mk гонит по нашим файлам. Закреплён по sha256 и собирается в CI как гейт — см. ниже |
| https://github.com/openwrt/luci/blob/master/build/i18n-scan.pl | Сканер строк для `.pot`. Умеет лексить `.ut` (переписывает шаблон в JS перед xgettext) и подхватывает заголовок из rpcd ACL — grep по `_('…')` не умеет ни того, ни другого |
| https://github.com/openwrt/luci/tree/master/themes/luci-theme-material | Пример альтернативной раскладки (сайдбар) на том же контракте |
| https://github.com/openwrt/luci/tree/master/themes/luci-theme-openwrt-2020 | Минимальная тема без sysauth (2 шаблона + шрифт + spinner) |

### jsmin и правило про regex-литералы

`jsmin.c` решает, что такое `/` — **regex** или **деление**, по ОДНОМУ предыдущему символу
из фиксированного списка (`( , = : [ ! & | ? + - ~ * / { } ;`). Ни `n` (последняя буква
`return`), ни `>` (из `=>`) в него не входят: `return /re/…` заставляет jsmin съесть
**остаток файла** и **выйти с кодом 0**. Это не теория — апстримные баги
**openwrt/luci#8299, #8020, #8021, #8256**. Отсюда правило «regex-литерал никогда не пишется
сразу после `return` или `=>` — оборачивать в скобки», гейт eslint `wrap-regex` и
`tools/jsmin-verify.mjs` (сравнивает поток токенов до и после минификации: только он ловит
«тихое» повреждение с нулевым exit-кодом). Подробности — CLAUDE.md и док 02.

### GitHub Release API — источник правды для установки и самообновления

`install.sh` (льётся `curl | sh` под root) и `root/usr/libexec/footstrap-selfupdate.sh`
(бэкенд кнопки Appearance → Update) оба ставят пакет с `--allow-untrusted`, т.е. **без
подписи пакета**. Цепочка доверия ровно из двух звеньев, и оба обязательны:

1. **Проверяемый TLS-канал.** Никаких `curl -k` / `--no-check-certificate`, в том числе «на
   повторной попытке» — провал проверки *и есть* случай MITM, а `ca-bundle` входит в
   `DEFAULT_PACKAGES` OpenWrt, так что небезопасный путь ничего не покупает. Схема редиректа
   пинится (`--proto-redir '=https'`): ассет релиза уходит на `objects.githubusercontent.com`.
2. **sha256, который GitHub публикует для ассета** — поле `@.assets[*].digest` в
   `https://api.github.com/repos/<repo>/releases/latest`. Несовпадение или **отсутствие**
   digest'а — отказ от установки (fail closed). Едет тем же каналом, что и URL, поэтому это
   не защита от скомпрометированного `api.github.com`; это защита от подменённой или
   обрезанной загрузки с CDN ассетов — а это **другой хост**. Хосты тоже в allow-list.

**Один пакет на формат в релизе — это тоже контракт с API.** Установленный на роутере
селф-апдейтер выбирает ассет как `grep '\.apk$' | head -1`, а GitHub возвращает ассеты
**отсортированными по имени**: в v0.8.4 `luci-i18n-…` отсортировался раньше `luci-theme-…`,
и Update ставил 6-КБ каталог переводов вместо темы, рапортовал успех и предлагал то же
обновление вечно (issue #6). **Селф-апдейтер на чужом роутере починить нельзя — чинить
можно только РЕЛИЗ**, поэтому CI падает, если в `dist/` больше одного пакета на формат, а
каталог переводов едет внутри пакета темы (док 13).

### Что есть и чего нет в базовом образе OpenWrt

- **`curl` в дефолтный набор пакетов НЕ входит** — образ везёт `uclient-fetch`; curl ставится
  отдельно (на дев-роутере: `/usr/bin/curl is owned by curl-8.19.0-r2`). Захардкоженный
  `curl` в селф-апдейтере убивал и бейдж обновления, и кнопку Update на стоковом роутере с
  `ERR: cannot reach the GitHub release API` (воспроизведено — достаточно убрать
  `/usr/bin/curl`). Отсюда fallback на `uclient-fetch`, а не рантайм-зависимость:
  `LUCI_DEPENDS:=+luci-base` — это весь список.
- **`jsonfilter` и `sha256sum` в базовом образе ЕСТЬ** — они читают digest из ответа API и
  считают контрольную сумму, зависимость для них не нужна.

## Устаревшее (НЕ использовать как reference)

- https://github.com/openwrt/luci/wiki/HowTo:-Create-Themes — **legacy Lua-гайд**
  (`luasrc/view`, `<%...%>`-шаблоны, `require("luci.http")`). Для 24.10/25.12+ не
  годится: подтверждено верификацией, это старый пайплайн. Не путать с
  актуальным `ThemesHowTo` (без двоеточия).
- Старые форки тем с `luasrc/view/themes/*.htm` — работают только с
  `luci-lua-runtime`, копировать код из них нельзя.

## Современные сторонние примеры

- https://github.com/LazuliKao/luci-theme-fluent — тема на ucode-шаблонах со
  сборкой через Rsbuild (TypeScript/SCSS → cascade.css). Подтверждено: структура
  пакета идентична bootstrap (htdocs/luci-static/fluent, ucode/template/themes/fluent,
  root/etc/uci-defaults, Makefile); дистрибуция двойная — `.ipk` (opkg, 24.10.x)
  и `.apk --allow-untrusted` (25.12.x).
  **Их сборочный пайплайн мы сознательно НЕ повторяем.** У нас сборка CSS — это один `cat` +
  `awk` (`build-css.sh`), потому что она обязана запускаться на бильдботе OpenWrt, где нет
  node: `build-css.sh` дёргается из `Build/Prepare` в Makefile. Препроцессор превратил бы
  сборку пакета в сборку с node-тулчейном. Всё, что требует npm (eslint, stylelint, axe,
  и прочие гейты), живёт **только в CI и локально** и ничего не отгружает. См. док 17.
- luci-theme-argon (jerrykuku) — самая популярная сторонняя тема; утверждения о
  её ветках/тёмном режиме верифицировать не успели (лимит сессии). Перед
  заимствованием кода проверить, что берёте ветку с ucode-шаблонами, а не
  legacy `.htm`.

## Подтверждённые ключевые факты (кросс-чек с доками 01–06)

1. Тема 24.10/25.12+ = ucode-шаблоны `.ut` в `ucode/template/themes/<имя>/`
   (header, footer, sysauth). Lua не участвует. `sysauth.ut` — не «опционально»: общий
   шаблон luci-base включает header **без `blank_page`** и рисует всю скорлупу вокруг формы
   логина с мёртвыми контролями (док 01).
2. Пакет: `htdocs/luci-static/<имя>/` (статика, доступ через `{{ media }}`),
   `root/etc/uci-defaults/` (регистрация), Makefile с `LUCI_TITLE` +
   `LUCI_DEPENDS:=+luci-base` + `include ../../luci.mk`; postrm чистит uci.
3. Регистрация: `uci set luci.themes.<Имя>=/luci-static/<имя>; uci commit luci`;
   активная тема — `luci.main.mediaurlbase`, и менять её вправе только свежая установка,
   но не апгрейд.
   **ЛОВУШКА: bootstrap отличает их по `PKG_UPGRADE != 1` — копировать это нельзя.** apk
   переменную `PKG_UPGRADE` никогда не выставляет, наш `postinst` тоже, так что в проде
   guard **мёртв**: его брал только `dev-sync.sh`, который экспортит переменную руками. У нас
   свежую установку от апгрейда отличает **файл-маркер**
   `/usr/share/luci-theme-footstrap/.installed` — он пишется в конце скрипта и удаляется в
   `postrm` (доки 01, 02).
4. header.ut начинается с ucode-блока: import из `luci.core`,
   `ubus.call('system','board')`, `http.prepare_content('text/html; charset=UTF-8')`.
5. Меню — пустые контейнеры в header, наполняются клиентским JS
   (client-side рендеринг LuCI).
6. Тёмная тема: `matchMedia('(prefers-color-scheme: dark)')` → атрибут `data-darkmode`
   на `:root`.
   **Форс-варианты через symlink-темы `-dark`/`-light` — это приём bootstrap, и мы от него
   отказались; не восстанавливать.** В `luci.themes` регистрируется **одна** запись
   (`Footstrap` → `/luci-static/footstrap`). Режим (тёмный/светлый), палитра, оттенок,
   акцент, скругление и раскладка (сайдбар / верхний бар) — **клиентские** оси: localStorage
   (`fs-darkmode`, `fs-palette`, `fs-layout`, `fs-tint`, `fs-accent`, `fs-radius`, …) →
   атрибуты и custom properties на `:root`, которые `partials/head.ut` проставляет инлайном
   **до первой отрисовки**, а попап Appearance меняет вживую. Раскладка при переключении
   ничего не перерендеривает — CSS морфит одну и ту же разметку. `uci-defaults` активно
   мигрирует легаси-пути `-dark`/`-light`/`-top` на единственный оставшийся и удаляет
   легаси-имена тем. Почему так: тема-на-режим удваивает пакет, требует перезагрузки страницы
   и серверного решения там, где выбор принадлежит клиенту.
7. 24.10 = ipk/opkg, 25.12+ = apk (`apk add --allow-untrusted`). CI собирает оба формата;
   `install.sh` и селф-апдейтер определяют, какой менеджер стоит на роутере.

## Проверка покрытия виджетов

Полнота стилизации виджетов проверяется по `docs/gallery.html` — статический файл, который
рендерит каждый виджет, какой может выдать LuCI (или сторонний `luci-app-*`), с настоящими
именами классов; роутер для этого не нужен. По нему же гоняется axe-core (`npm run a11y`)
по матрице `{light,dark} × {footstrap,hicontrast}`.

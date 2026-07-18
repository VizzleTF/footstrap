# Глубокий аудит темы — best practices, производительность, безопасность

> ## ⚠️ ИСТОРИЧЕСКИЙ СРЕЗ — 2026-07-09
>
> **Дерева, по которому сделан этот аудит, больше не существует.** Документ сохранён как
> запись *почему* были приняты решения, а не как список работ. Каждый пункт помечен:
> **ИСПРАВЛЕНО** / **СНЯТО** (исчезло вместе с файлом) / **ОТКЛОНЕНО** (проверено и
> признано невозможным или вредным) / **ОТКРЫТО**.
>
> **Открыто на сегодня — ровно пять пунктов**, все остальные закрыты:
> **L14** (SPA не снимает document/window-листенеры ушедшего view) ·
> **QW2** (навигация по `pointerdown`, а не `click`) ·
> **BI1** (RPC-prefetch/кеш по hover) ·
> **P-M1** (render-blocking `admin/translations` в `<head>` — но `defer cbi.js` ОТКЛОНЁН) ·
> **S4** (нет CSP — осознанное решение, не дефект).
>
> **Все baseline-числа ниже устарели** и оставлены как «на момент аудита»; текущие — в
> скобках. Аудит по трём направлениям (bp / perf / sec); пути относительно
> `luci-theme-footstrap/`. Замеры сделаны на живом роутере (OpenWrt 25.12.2,
> mediatek/filogic, uhttpd 2025.10.03, LAN), только чтение.

Baseline **на момент аудита** (2026-07-09): `cascade.css` 149 K, 1003/1003 фигурных скобок,
`:has()` ×36, `color-mix()` ×35, 116 hex-литералов; тема регистрирует **2** layout-entry
(`FootstrapSidebar`/`FootstrapOnTop`); шрифты 105 K / 5 файлов.

Сейчас: `cascade.css` **~112 КБ** (генерируется `build-css.sh` из `styles/`, править нельзя);
hex-литералов в `styles/base` — **ноль** (`audit.py`); layout-entry — **один** (`Footstrap`),
раскладка стала **клиентским** тумблером в Appearance, а не темой; шрифты **68 488 B / 9
subset-файлов** (3 начертания × latin/latin-ext/cyrillic).

---

## 1. Best practices / качество кода

### HIGH

**H1. 2.5 GbE порт рендерится как «3 GbE»** — *снято вместе с файлом: кастомный дашборд retired, вместо него аддитивный `05_footstrap_overview_layout.js`* — `htdocs/luci-static/resources/view/status/include/05_footstrap_dashboard.js:53`
`(speed/1000).toFixed(0)` → `(2.5).toFixed(0)` = `"3"`. Целевое железо (filogic) часто с 2.5G-портами → видимо неверные данные. Строка 52 метит 100M как `"100 M"` (стиль единиц расходится с «GbE»).
Fix: `(speed/1000).toFixed(1).replace(/\.0$/,'') + ' GbE'`.

**H2. SPA-роутер молча теряет query string и hash** — *исправлено (`menu-footstrap-common.js:650` — `if (url.search || url.hash) return;`; popstate с query делает reload)* — `menu-footstrap-common.js:193-237, 288-293`
`navigate()` матчит только `url.pathname` и `pushState(..., pathname)`. Ссылка вида
`admin/system/package-manager?query=x` или `path#frag` перехватывается, view-узел матчится, `location.search`/`hash` теряются — view рендерится будто без параметров, без ошибки.
Fix в click-handler: `if (url.search || url.hash) return;` (или протащить `url.search + url.hash` в `pushState`).

**H3. Один rejected-promise в `load()` кладёт всю страницу Overview** — *снято вместе с файлом (у layout-инклуда нет `load()`)* — `05_footstrap_dashboard.js:147-150`
`network.getWANNetworks()`, `uci.load('system')`, `uci.load('network')`, `network.getWifiNetworks()`, `network.getHostHints()` — единственные в `Promise.all`, **не** обёрнутые в `L.resolveDefault`. При ограниченном ACL / временном сбое rpc `load()` реджектится; luci-mod-status объединяет load'ы include'ов → аддитивный include ломает страницу, которая иначе работала бы.
Fix: обернуть все пять в `L.resolveDefault(..., fallback)` + null-guard в `render()`.

### MEDIUM

**M1. `dupObserver` живёт вечно и наблюдает после ухода с Overview (SPA)** — *снято вместе с файлом* — `05_footstrap_dashboard.js:116-130`
Module-level observer на `#maincontent` с `subtree:true`, никогда не отключается. С SPA-роутером после ухода с Overview продолжает гонять `tagDuplicates()` (полный скан `.cbi-section`) на каждую мутацию DOM всю сессию, и спрячет любую будущую `.cbi-section`, чей `.cbi-title h3` == «System»/«Network» и т.п.
Fix: `dupObserver.disconnect(); dupObserver = null;` когда `!document.querySelector('.fs-dashroot')`.

**M2. Фейковые кнопки-действия** — *снято вместе с файлом* — `05_footstrap_dashboard.js:71` (`Reserve IP`), `:327` (`Disconnect`)
`<span class="fs-btn-o">` без обработчиков — выглядят кликабельными, ничего не делают (остатки мокапа). Fix: подключить (dhcp static-lease / hostapd `del_client` как стоковый 60_wifi.js) или убрать до реализации.

**M3. `popstate` на смену hash даёт лишний reload/re-render** — *ИСПРАВЛЕНО: `menu-footstrap-common.js` держит `_curPath` (последний отрисованный pathname, `:542`, обновляется в `navigate()` `:978`) и на popstate сравнивает с ним (`:1185`) — смена только фрагмента выходит рано.* — `menu-footstrap-common.js:296-299`
Смена hash фаерит `popstate`. In-page `#anchor` (click-handler намеренно игнорит `#…` на :286) попадает в popstate: на template-странице (Overview) → полный `location.reload()`; на view — лишняя ре-инстанциация.
Fix: хранить последний обработанный pathname, ранний выход при смене только hash.

**M0. dev-sync.sh `ln -sf` плодит вложенные self-симлинки при повторном запуске — HIGH (подтверждено на живом роутере)** — *исправлено (`dev-sync.sh:56` — `ln -sfn`)* — `dev-sync.sh:34-39`
`ln -sf footstrap footstrap-dark`, когда `footstrap-dark` уже симлинк на каталог, кладёт ссылку **внутрь** каталога. На роутере реально существуют `/www/luci-static/footstrap/footstrap` и `.../themes/footstrap-top/footstrap-top`. Каждый ре-запуск плодит мусор и петли для обходчиков.
Fix: `ln -sfn` (busybox поддерживает `-n`) + разовая чистка вложенных симлинков на роутере.

**M4. dev-sync.sh регистрирует устаревшие entry — расхождение dev/prod** — *исправлено (`dev-sync.sh:76-77` заливает и запускает сам uci-defaults-скрипт пакета — один источник правды)* — `dev-sync.sh:41-52` vs `root/etc/uci-defaults/30_luci-theme-footstrap:13-14`
uci-defaults регистрирует ровно `FootstrapSidebar` + `FootstrapOnTop` и *удаляет* легаси-6; dev-sync всё ещё регистрирует легаси-6 и не регистрирует два текущих. После install + dev-sync удалённые легаси-entry возвращаются, дропдаун показывает смесь. dev-sync не шипит `root/etc/uci-defaults/`.
Fix: dev-sync регистрирует `FootstrapSidebar`/`FootstrapOnTop` идемпотентно, легаси-блок убрать.

**M5. У top-nav нет `sysauth.ut`** — *СНЯТО вместе с каталогом `footstrap-top/`, но вывод аудита с тех пор перевернулся: тема **несёт** свой `ucode/template/themes/footstrap/sysauth.ut`, и он **обязателен**. Без него диспетчер падает на generic-шаблон, который включает header **без `blank_page`**, и весь хром рисуется вокруг формы логина с мёртвыми контролами. Подробно — docs/01, docs/03, docs/09.* — на момент аудита `ucode/template/themes/footstrap-top/` содержал только `header.ut`/`footer.ut`
Диспетчер предпочитает `themes/<theme>/sysauth`, откатывается на generic → логин FootstrapOnTop не проходит через `view/footstrap/sysauth.js`, получает стоковую нестилизованную форму в footstrap-top shell.
Fix: `footstrap-top/sysauth.ut` = `{% include('themes/footstrap/sysauth') %}`. Проверить на роутере.

**M6. Легаси bootstrap-правила `header` матчат `<header class="fs-topnav">`** — *исправлено: легаси-header-блок не пережил разбор монолита на `styles/` (в дереве нет ни `margin:-5px`, ни `1180px`)* — `cascade.css:1086-1135` vs `:3483-3495`
Старый блок: `header { margin:-5px -5px 15px -5px; padding-left:calc((100% - 1180px)/2); … }`. `.fs-topnav` переопределяет background/padding/z-index, но **не** `margin` — негативные margin и 1180px-padding-left протекают в top-nav. ~180 строк (1086-1265) метят несуществующую/полу-совпадающую разметку.
Fix: нейтрализатор `header.fs-topnav { margin:0; … }` — или удалить легаси-header-блок (это fork-owned мусор, не «база не трогать»).

**M7. sysauth.js без null-guard, оставляет юзера залоченным при ошибке** — *снято вместе с файлом (см. M5)* — `view/footstrap/sysauth.js:11-25`
`section`, `form`, `btn` используются без проверок; исходный `<section hidden>` остаётся hidden → если любая строка бросит (дрейф разметки; `auth_html` добавляет кнопки, `section.querySelector('button')` берёт *первую*, не «Log in»), логин невозможен без devtools.
Fix: try/catch, при сбое `section.hidden = false; return '';`. `const view` (:23) шэдоуит required-модуль `view` (→ `viewEl`); `keypress` (:27) deprecated → `keydown`.

**M8. Дублирование header.ut между layout** — *исправлено: общий хром вынесен в `footstrap/partials/` (`head`/`brand`/`notices`/`appearance`/`logout`/`footer`), обе раскладки их инклудят* — `footstrap/header.ut` vs `footstrap-top/header.ut`: 67 из ~79/92 строк идентичны (преамбула, brand SVG, no-password/initramfs alert, noscript, tabmenu, title). `footer.ut` побайтно одинаковы кроме комментария и имени menu-модуля.
Fix: alerts+noscript+преамбула в `partials/alerts.ut`; один `footer` partial с var `menu_js`.

**M9. 48 хардкод-литералов в базовой зоне без token-bridge = реальные дыры dark-mode** — *исправлено: `audit.py` показывает по `styles/base` ноль литералов* — второй заход, `audit.py`-список
`.cbi-section-error` (#fce6e6/#f00, `cascade.css:2205-2215` — в дарке светло-розовый), `.ifacebox-head` #eee (:2237), `.cbi-filebrowser` #ccc (:2550-2615), `.dropdown-menu` legacy (:1234-1263), header-градиенты #333 (:1091-1191 — частично матчат `header.fs-topnav`, см. M6). Правило репо «мапить на токены override-блоком» для видимых компонентов (section-error/filebrowser/ifacebox) **не** сделано.
Fix: домапить в override-секции после :2690.

**M10. Override-sprawl в хвосте cascade.css — против собственного docs/11 п.1** — *исправлено: монолит разобран на `styles/` по каскадным слоям, дубли свёрнуты (182 затенённых объявления → 0), `cascade.css` генерируется — см. docs/17* — 19+ append-блоков по хронологии правок («audit fixes», «polish round 2»), а не по компонентам. Стили дашборда разнесены (:3163 и :3626), кнопки — на три (:2691, :3430, :3578). **135 из 158 `!important` в последних ~1000 строк** — та самая эскалация специфичности, которую docs/11 зовёт главным врагом.
Fix: разовый консолидационный пасс — слить блоки по компонентам (dashboard/buttons/topnav/widgets/tables), убрав межблоковые перезаписи. Безопасная сетка: skill footstrap-audit + скриншот-превью.

### LOW

- **L1.** *Исправлено: HSL-мост снят целиком, ни одной из перечисленных переменных в `styles/` больше нет; `audit.py` — ноль used-but-undefined.* Мёртвые CSS custom properties (определены, не читаются): `--knob-x` (:48), `--border-color-h/s/l`, `--tab-active-text-color` (:1293, там же hardcoded `#0069d6`), `--tab-inactive-background-color-h/s`, `--tab-inactive-text-color-l` (:1289 — :1290 читает `--tab-inactive-background-color-hsl` вместо). Used-but-undefined: только `--zone-color-rgb` (:2252) — **не баг**, LuCI инжектит inline-style на zone-badge.
- **L2.** *Исправлено: `#0069d6` в дереве не осталось.* Не-збриджованный литерал, всё ещё видимый: `div.cbi-value var, .td.cbi-value-field var { color:#0069d6 }` + `border-bottom:1px dotted #0069d6` (`cascade.css:2386,2394`) — нет override после :2690. То же для `.tabs`-градиента (:1293). Map → `var(--accent)` в override-секции.
- **L3.** *Снято вместе с файлом дашборда.* Непереведённые строки дашборда: `'no link'`, `'1 GbE'`, `'Connected'` (:50-54), uptime `'d h m s'` (:201). Обернуть в `_()`.
- **L4.** *Снято вместе с файлом дашборда.* Мёртвый код: `loadHistory` push/trim (:134,176-177) не рендерится (спарклайн убрали?); `const field = nf;` (:241) — бессмысленный алиас; `uci.load('network')` (:149) результат не используется; доступ по magic-index `data[0..13]` (:155) — деструктурировать.
- **L5.** *Исправлено: `_mqDark`-listener ставится безусловно (`menu-footstrap-common.js:218,228`) и сам гейтится по stored-pref.* `applyMode('auto')` не переустанавливает `prefers-color-scheme` listener — `menu-footstrap-common.js:87-94` + `head.ut:26-29`: mq-listener ставится только если на загрузке не было saved-pref. dark→auto + смена OS-темы не применится до reload. Fix: ставить listener безусловно в head.ut, гейтить по stored-pref внутри.
- **L6.** *Исправлено: `fs-select.js` сравнивает `choicesKey()` и на смену списка делает `resync()` (teardown+enhance).* `fs-select.js`: choices снапшотятся раз (:19-22) — если CBI позже перепишет options (зависимые поля), виджет показывает stale; `change`-resync (:63-67) чинит только value, не список.
- **L7.** *Снято вместе с файлом (см. M5).* `sysauth.ut:27-37`: `field.name/label/placeholder/pattern` от auth-плагинов без `entityencode`; `auth_message` (:64) raw HTML (см. sec-раздел, совпадает с upstream).
- **L8.** *Исправлено: `<style>` в `partials/head.ut` без атрибута `title`.* `head.ut:57`: `<style title="text/css">` — `title` делает stylesheet именованным (preferred); должно быть `type` или ничего. Наследие upstream.
- **L9.** *Исправлено: postrm сбрасывает `mediaurlbase` на `/luci-static/bootstrap`, если тот указывал на footstrap.* Packaging: postrm (`Makefile:43-53`) не сбрасывает `luci.main.mediaurlbase` при указании на footstrap-dir → «Theme fallback»-ошибка на каждом заходе (сценарий docs/06 п.8). Спасает theme-fallback LuCI, но reset чище: `case $(uci -q get luci.main.mediaurlbase) in /luci-static/footstrap*) uci set luci.main.mediaurlbase=/luci-static/bootstrap;; esac`. postinst (:35-36) оставляет uci-defaults-скрипт для повторного запуска на boot — безвредно (идемпотентен).
- **L10.** *Исправлено: CLAUDE.md описывает 2 entry + клиентский Appearance-popover.* Doc drift: CLAUDE.md всё ещё описывает 6 `luci.themes`-entry и «-dark/-light suffix»-выбор; код перешёл на 2 entry + client Appearance-popover. Обновить CLAUDE.md и комментарий dev-sync.
- **L11. install.sh молча отключает TLS-проверку — MED (MITM-вектор)** — **ИСПРАВЛЕНО, дыры больше нет.** `install.sh` теперь никогда не отключает проверку сертификата — ни как основной путь, ни как retry (провал проверки *и есть* MITM-случай, а `ca-bundle` в `DEFAULT_PACKAGES`, так что insecure-fallback ничего не покупает): `curl` идёт с `--proto '=https' --proto-redir '=https'` (пин и на редирект — ассет уходит на `objects.githubusercontent.com`), `wget` — с `--https-only`. Вторым звеном добавлена проверка **sha256, который GitHub публикует для самого ассета** (`@.assets[*].digest`): несовпадение или отсутствие digest = отказ от установки, а не warning. Хост релиз-API и хост ассета запинены. Тот же контракт — в `footstrap-selfupdate.sh`, и оба `fetch()` держит от расхождения `@mirror gh/{fetch,asset-host}`. Было: curl всегда `-k`, wget всегда `--no-check-certificate` → MITM на весь путь до `apk add --allow-untrusted`.
- **L12. Противоречие «25.12+ only» ↔ 24.10** — CLAUDE.md/docs декларируют «OpenWrt 25.12+ only», но `install.sh:41-56` пускает 24.10, CI собирает ipk для 24.10, release-notes рекламируют. Либо править docs (24.10 поддерживается), либо резать ipk-ветку. — **исправлено: 24.10 поддерживается официально.** Сверено с веткой `openwrt-24.10` `openwrt/luci`: там уже ucode, весь используемый API шаблонов на месте, `L.env`-блок из `luci-base/template/header.ut` побайтно совпадает с 25.12 (значит `dispatchpath` есть), `luci.mk` уважает `LUCI_MINIFY_*=0`. Отличается только пакетный менеджер (apk / opkg).
- **L13. Ветка активации в uci-defaults недостижима на свежей установке** — *ИСПРАВЛЕНО: «свежая установка vs апгрейд» решается **маркер-файлом** `/usr/share/luci-theme-footstrap/.installed` (`30_luci-theme-footstrap:9`, пишется последней строкой скрипта, удаляется в `postrm`), а не пустотой `mediaurlbase`. Свежая установка вправе активировать тему, апгрейд — никогда не меняет активную. Раньше ветка ключилась на env `PKG_UPGRADE`, который apk не выставляет вообще: гард был мёртв в проде.*
- **L14. SPA: нет teardown document/window-листенеров view — ОТКРЫТО.** Проверено: `navigate()` по-прежнему чистит только `L.Poll.queue` (`menu-footstrap-common.js:1013-1014`) и модалку; своих листенеров view никто не снимает. У LuCI-view нет lifecycle-destroy → document/window-листенеры предыдущего view (drag-n-drop, resize, keydown) живут через все SPA-переходы и копятся. Системный риск подхода. Минимум — задокументировать «грязные» страницы в docs/14 + blocklist (как для template-нод).

### Чисто / хорошо
Дисциплина эскейпинга в дашборде (`esc()` на все динамические значения), singleton/composition-паттерн в `menu-footstrap-common.js` с задокументированным `window.L` vs module-`L`, listener-гигиена (`_wired`-guard, баланс add/remove в `wireAppearance`, rAF-debounced observers), `ui.Select` firstChild-ordering workaround в `fs-select.js`, token-bridge CSS-архитектура (audit-fixes блок после :2690 покрывает почти все литералы базы — проскочил только L2).

---

## 2. Производительность

### Измеренная база (роутер, LAN, curl)

> **Числа — на 2026-07-09.** Байтовые с тех пор устарели: `cascade.css` 149 K → **~112 КБ**,
> шрифты 105 K / 5 файлов → **68 488 B / 9 subset-файлов**. Свойства *сервера* (нет gzip, нет
> Cache-Control, `max_requests 3`, 61 ms на CGI-spawn) не изменились — это бинарник uhttpd.

- **uhttpd НЕ умеет gzip вообще**: на `Accept-Encoding: gzip, br` отдаёт полный `Content-Length: 149030` без `Content-Encoding`. В актуальном `uhttpd/file.c` — 0 вхождений gzip/Content-Encoding/Cache-Control. Precompressed `.gz` рядом бесполезен.
- **Cache-Control отсутствует** у всех статических ответов — только `ETag`+`Last-Modified`; `If-None-Match` → 304 (1.3 ms LAN). Отсюда каскад 304-ревалидаций (по 1 RTT) на повторной загрузке и 15-39 запросов/переход у bootstrap.
- `http_keepalive '20'` включён; `max_requests '3'` (лимит параллельных CGI — душит MPA, не статику).
- Тайминги LAN: cascade.css cold **3.4 ms**, 304 **1.3 ms**, каждый js/шрифт 1-2 ms; **shell CGI 61 ms, translations CGI 32 ms** — на LAN узкое место сервер-CGI и JS-exec, не байты. Байты стреляют на Wi-Fi/WAN.
- **Критический путь cold-загрузки:** shell 6.3K + cascade.css **149K** + luci.js 29.6K + cbi.js 14.4K + ui.js 85.4K + form.js 67.7K + rpc/uci/validation/fs ~33K + menu-JS 20.3K + fs-select 2.8K + шрифты **105K (5 файлов)** ≈ **460-515 KB, ~20-25 запросов**, без компрессии. У bootstrap: css 44K (минифицирован csstidy), шрифтов нет → ~230K.
- **cascade.css анатомия:** 149K = токены/шрифты 4K + bootstrap-база 54.5K + footstrap-секции **90K** (наши секции больше базы). gzip 149K→31.2K; наивная минификация →**110K** (gz 19.9K). `cats.svg` 103K грузится **только** при палитре rvht (scoped-селектор) — вне критического пути.
- Anti-FOUC уже решён (2 инлайн-скрипта до CSS), `font-display:swap` стоит на всех 5 @font-face. Render-blocking в `<head>`: cascade.css → translations (sync CGI 32 ms) → cbi.js (sync) → luci.js. Preload'ов нет. Шрифты обнаруживаются только после парса всех 149K CSS.
- **SPA-роутер (docs/14/15) уже даёт:** 1.91× сумма, 2.28× медиана, 15-39 → 1-4 запроса. Warm-навигации 28-178 ms — уже RPC/render-bound.

### Крупнейшие оставшиеся выигрыши (второй perf-заход, поведенческий фокус)

**P-H1. Overview СЕЙЧАС не SPA-ится, но МОЖЕТ — это самая посещаемая страница.** *(сделано — `ensureOverviewHelpers()` + спец-кейс `view.status.index` в `navigate()`; замер ниже)*
Роутерный `template/admin_status/index.ut` **эмитит `<div id="view">`** и заканчивается `ui.instantiateView('status/index')` — структурно идентичен `view.ut` + 3 inline-хелпера (`progressbar`/`renderBox`/`renderBadge`). SPA-роутер бейлит на template-нодах (`menu-footstrap-common.js:198`).
Fix: спец-кейс `admin/status/overview` в `navigate()` — инстанциировать `view.status.index` как обычный view + определить 3 хелпера один раз в theme-JS (их требуют стоковые includes 18_cpu/20_memory/25_storage/30_network, иначе кинут при SPA-приходе).
Выигрыш: **~150-250 ms/визит Overview** — landing-страница, крупнейший оставшийся nav-win. (Ранее Overview числился «границей полного reload»; это устранимо.)

**P-H2. Overview-poll делает ~2× RPC — дашборд двойным фетчем тянет то, что прячет.** *(сделано: двойной фетч снят вместе с дашбордом — `.fs-dup-hidden` секций больше нет, стоковые секции только переставляются; `visibilitychange` → `Poll.stop()/start()` есть в `menu-footstrap-common.js:703`)*
`.fs-dup-hidden` секции скрыты визуально, но их `load()` идёт **каждые 5 c**. За цикл дубли: `system.info` **×4**, `getDHCPLeases` ×2, `getWANNetworks` ×2, conntrack `fs.trimmed` ×2, `getBuiltinEthernetPorts` ×2, `getWifiNetworks` ×2, `getHostHints` **×3**, `getAssocList` ×2/радио (iwinfo — самый дорогой). Скрытые секции ещё и ребилдят DOM каждый poll.
Плюс: **у luci.js нет `visibilitychange`** (0 вхождений на роутере) → Overview в фоновой вкладке молотит ubus 24/7 на 2× rate. Тема может `Poll.stop()/Poll.start()` по `visibilitychange` (docs/14-caveat: `stop()` убивает tick → всегда явный `start()` на visible).
Выигрыш: ~50% ubus/CPU при открытом Overview; ~100% в фоне. Нагрузка rpcd/CPU (не latency), но железо слабое — `getAssocList` конкурирует с роутингом. Дедуп стоковых фетчей — highest-effort/lowest-safety, только после замера `top` при открытом overview.

**P-M1. Два render-blocking `<script src>` в `<head>`, один — CGI-хит на каждую загрузку. — ЧАСТИЧНО ОТКРЫТО (половина ОТКЛОНЕНА).**
`partials/head.ut:145,148` — `admin/translations/<lang>`, затем `cbi.js`; оба на месте. Translations отдаёт `cache-control: no-cache` → **каждая полная загрузка = dispatcher CGI-spawn** (~30 ms + блокирует парс). Для `lang=en` payload **13 байт**.
- **`cbi.js` трогать нельзя — ОТКЛОНЕНО** (см. «Большие затеи» №3): `luci.js` в конструкторе читает `window.cbi_init`, значит `cbi.js` обязан выполниться синхронно ДО него. Ни `defer`, ни перенос в конец `<body>` этого порядка не переживут.
- **`admin/translations` — ОТКРЫТО**: этот тег ни от чего в `<head>` не зависит, его CGI-хит остаётся единственным незакрытым куском пункта. Fix: перенести перед inline-`L.require` в footer; опц. вовсе не эмитить при `lang=='en'`. Выигрыш: ~30 ms first-paint на каждую полную загрузку. SPA-навигации не затронуты.

**P-M3. rvht-палитра: `backdrop-filter: blur(6px)` на каждой кнопке и закрытом дропдауне.** *(сделано: палитра стала осью «обоев» `data-wallpaper="cats"` (`theme/15-wallpaper.css`), blur с кнопок снят — остался на закрытом дропдауне и sticky-баре; `cats.svg` 103K → 77K)*
`cascade.css:186-187` — CBI-форма (firewall/interfaces) = десятки live backdrop-sampling-слоёв над 103K `cats.svg`. `.fs-topnav` sticky тоже `blur(10px)` (:3492) — непрерывный композитинг на каждый scroll-frame в top-layout.
Fix: заменить blur кнопок на solid `color-mix`-фон; blur оставить только на sticky-баре (или поднять opacity фона до 100% и убрать filter); `cats.svg` через svgo (repeating-tile = пара KB). Выигрыш: убирает scroll-jank на слабых GPU (телефоны) для rvht/top-nav; −~70+ KB rvht cold-load.

> **Измерено (before/after, живой роутер, LAN, warm):**
> - **P-H1 Overview→SPA:** 853ms → 794ms (**1.07×**, −58ms). Скромно на LAN — overview доминирует рендером самого дашборда (много RPC + большой DOM), SPA экономит только перезагрузку каркаса (~60ms). Масштабируется с latency (WAN больше). **Оставлено.**
> - **P-M4/M5 инкрементальный дашборд:** `render()`/poll 1.17ms → 1.7ms (**0.69× — МЕДЛЕННЕЕ**). `render()` в любом случае строит все строки секций каждый poll, а leases/wifi/net signature тикает (remaining/signal) → они всё равно репарсятся; инкремент сэкономил только статику+system+метры (~0.5ms), но добавил overhead querySelector/diff. Полный `innerHTML` (1.17ms) дешевле. Премиса «дорогой ребилд» не подтвердилась. **Откачено.**
> - `:has()`→`.fs-dt` (P-M5) и preload/rvht/poll-pause/hover-prefetch — оставлены (низкий риск, разные цели; не в этом замере).

**P-M4/M5. Дашборд ребилдит весь DOM каждые 5 c + `:has()` на polled-таблицах.** *(инкремент откачен — см. замер выше; сам ребилд снят вместе с дашбордом: стоковый poll обновляет секции на месте)*
`05_footstrap_dashboard.js:342-358` — `box.innerHTML = <весь дашборд>` per poll → каждый ребилд фаерит MutationObserver-retag и инвалидирует `.cbi-section:has(.fs-dashroot)`. Fix: держать shell статичным, обновлять только volatile-узлы (uptime/load/meters/leases). Плюс горячее семейство `#view table.table:has(.tr.table-titles)…` (~6 правил) матчит каждую data-таблицу (Processes ~100 строк — 178 ms, самая медленная SPA) — тегировать классом `fs-dt` через существующий MutationObserver-паттерн, селекторы → `.fs-dt .td…`. Zero-risk.

**P-side. Manrope 400/500 не шипятся → `body { font-weight:normal }` (`cascade.css:341`) рендерит Manrope 600 везде.** Если намеренно — ок; иначе design-баг, замаскированный font-matching. Проверить. *(проверено: намеренно — это задокументировано в `styles/01-fonts.css`; заодно выкинут вес 800.)*

### Quick wins (theme-only, можно сразу)

1. **Preload 2-3 шрифтов** в `partials/head.ut` (`rel=preload as=font crossorigin`: manrope-600/700, jb-mono-400). Убирает каскад «149K CSS скачан+распарсен → только потом шрифт». LAN ~5 ms, Wi-Fi/WAN 50-300 ms до стабильного текста. Риск ~0 (`crossorigin` обязателен даже same-origin, иначе двойная загрузка). 3 строки. *(сделано: preload на manrope-600/700-latin; jb-mono намеренно не преloadится — он рисуется только внутри таблиц.)*
2. **pointerdown-навигация** в SPA-роутере (`navigate()` на mousedown, не click). **ОТКРЫТО** — роутер по-прежнему висит на `click` (`menu-footstrap-common.js:1139`). Воспринимаемые **−50-100 ms/клик** — сравнимо с целой warm-навигацией. Отфильтровать кнопку≠0 / drag.
3. **Hover-prefetch view-JS**: на `pointerenter` view-ссылки — `fetch(resource/view/….js)` (тёплый HTTP-кеш), **не** `RT.require`. −10-40 ms LAN на первый визит. ВАЖНО: именно fetch — `require` view-класса запустит `__init__` и отрендерит чужой view в текущий `#view`. *(сделано: `prefetchView()` на `pointerover`.)*
4. **Убедиться, что дистрибуция = .apk с CONFIG_LUCI_CSSTIDY/JSMIN** — минификация «бесплатно» через luci.mk (`LUCI_MINIFY_CSS/JS?=1`); касается только dev-sync и сырых установок. Опц. флаг минификации в dev-sync.sh. *(решено иначе: `csstidy` ломает `:has()`/`color-mix()`, поэтому `LUCI_MINIFY_CSS:=0`, а минификацию делает собственный `build-css.sh` — docs/17.)*

### Большие затеи (по убыванию смысла)

1. **BI1. RPC-prefetch/кеш по hover** (idempotent-ubus, TTL 1-2 c) — **ОТКРЫТО.** Единственное, что двигает warm-SPA (он RPC-bound). До −60-150 ms/warm-нав. Высокая сложность, риск stale/побочных вызовов. Не путать с QW3: `prefetchView()` на `pointerover` уже есть, но он греет HTTP-кеш **view-JS**, а не RPC-ответы.
2. **Font subsetting latin+cyrillic** (pyftsubset): 105K → ~55-65K. Кириллицу резать нельзя (русская локаль). Ломает «no build step» — нужен воспроизводимый скрипт. *(сделано без build step: каждый начертание разрезано по `unicode-range` на latin/latin-ext/cyrillic — латинский UI тянет ~66K, русский ~90K вместо безусловных 105K.)*
3. ~~**defer translations+cbi.js** в head.ut~~ — **ОТКЛОНЕНО (невозможно).** `luci.js` в своём конструкторе делает `originalCBIInit = window.cbi_init` — то есть `cbi.js` обязан выполниться **до** него, синхронно. `defer` (как и перенос в конец `<body>`) этот порядок ломает: `luci.js` увидит `undefined` и потеряет CBI-init. Доказано в docs/18. Отложить можно только `admin/translations` — это и есть оставшаяся половина P-M1.
4. **Дедуп 90K собственных footstrap-секций** (больше базы!) — реалистично −15-25K raw. Гигиена, не скорость; каскад построен на source-order. *(сделано: 182 затенённых объявления → 0, source-order больше не несущая конструкция — docs/17.)*
5. ~~Purge мёртвых bootstrap-правил~~ (база 54.5K из 149K, потолок ~15-20K raw) — **ОТКЛОНЕНО, теперь прямо ЗАПРЕЩЕНО.** Это нарушает **coverage-контракт** (CLAUDE.md): селектор, для которого сегодня нет примера ни на одной стоковой странице LuCI, всё равно стилизуется — ради стороннего `luci-app-*`, который отрисует этот виджет завтра на чужом роутере. Именно поэтому существует `docs/gallery.html`. Удаление покрытия — не уборка: оно молча раз-темизирует чужое приложение. Правила из `base` можно **переносить и сливать** (в этом и состоит абсорбция), но множество покрытых селекторов может только расти. Coverage-based инструменты (PurgeCSS/uncss) здесь активно опасны — они вырезают ровно то, чего не наблюдали. Единственный безопасный охотник за мёртвым CSS — `npm run css-orphans`, и только внутри собственного namespace `fs-*`, который никто снаружи эмитить не может.

### Граница: что тема НЕ ускорит

CGI-fork + ucode-диспетчер (61 ms/shell, 32 ms/translations на каждую полную загрузку — SPA обходит); rpcd/ubus (Startup 1000 ms — перечисление init.d, SPA дал лишь 1.13×); TLS-handshake; отсутствие gzip и Cache-Control — свойство бинарника uhttpd, конфигом не включается; `max_requests 3`. Радикальный обход блока доставки — nginx (`luci-ssl-nginx`, gzip/gzip_static: css 149K→31K, всё →~150K) вместо uhttpd, но это решение дистрибутива, не темы.

Мелочь: спрятанные `.fs-dup-hidden` стоковые секции overview продолжают гонять RPC каждый poll (3 лишних ubus/5 c) — фоновая нагрузка rpcd, не latency; лечится только глубже пересечением границы темы/мода.

---

## 3. Безопасность (defensive audit)

Прочитаны все шипнутые файлы; семантика `striptags`/`entityencode` проверена эмпирически на живом роутере. **Итог: эксплуатируемого XSS нет.** Данные под контролем сетевого атакующего (DHCP/station hostnames) корректно эскейпятся; admin-контролируемые данные проходят через tag-stripper, эмпирически нейтрализующий tag-инъекцию. Находки — low-severity корректность/hardening.

### Модель эскейпинга (проверено на роутере)
`{{ }}` в ucode-шаблонах LuCI **не** авто-эскейпит; эскейпинг ручной через `entityencode`/`striptags` из модуля `html`.
- `striptags` — tag-remover, **не** HTML-encoder: оставляет сырые `&amp;`, `"`, `&lt;`. Но агрессивен: `<img onerror>`, незакрытый `<img`, `<svg/onload>`, tag через перевод строки, вложенный `<scr<script>ipt>` — всё коллапсит в отсутствие живого тега.
- `entityencode(s)` кодирует `& < >`; `entityencode(s, true)` — ещё `"`.

### Находки

**S1. Admin hostname через голый `striptags` (без `entityencode`) — LOW** — *исправлено: все места обёрнуты в `entityencode(striptags(...), true)` (`partials/head.ut:16`, `partials/brand.ut:16`, `footstrap/header.ut:75`, `footstrap-top/header.ut:59`)*
`footstrap/header.ut:28` (`.fs-wordmark`), `:57` (`.fs-title-main`); `footstrap-top/header.ut:26,:45`; `partials/head.ut:12` (`<title>`).
`{{ striptags(boardinfo.hostname ?? 'OpenWrt') }}` — оставляет сырые `&amp;`/`"`/lone-`<`. Непоследовательно с корректным паттерном для того же класса данных (`header.ut:20`: `entityencode(striptags(node?.title ?? ''), true)`).
Эксплуатируемость: `boardinfo.hostname` — admin-set (uci `system.@system[0].hostname`), **не** задаётся неавторизованным сетевым клиентом. `striptags` надёжно убивает tag-инъекцию → не практический XSS; остаток — сырые `&amp;`/`"`/`<` как литеральный текст (порча рендера / теоретическая HTML-инъекция уже привилегированным админом).
Fix: обернуть 5 мест в `entityencode(striptags(...), true)` — encoder-based защита, не зависящая от силы striptags.

**S2. `sysauth.ut` raw auth-plugin output + неэскейпнутые атрибуты полей — LOW / info** — *снято: тема больше не шипит `sysauth.ut` (см. M5) — логин рисует стоковый шаблон*
`footstrap/sysauth.ut`: `:46-47` `{{ auth_html }}`, `:64` `{{ auth_message }}` — raw; `:52` `<script src="{{ asset.src }}">` — `asset.src` неэскейпнут; `:27-38` `field.name/type/placeholder/pattern/autocomplete/inputmode/maxlength` в атрибуты неэскейпнуты.
Значения от server-side auth-backend (rpcd/auth-плагины), не от сетевого клиента. Скопировано дословно из upstream `luci-theme-bootstrap` sysauth. Единственное reflected user-значение `duser` обработано верно: `:15` `value="{{ entityencode(duser, true) }}"`.
Эксплуатируемость: требует контроля auth-config = уже root. Defense-in-depth. При hardening — `entityencode(..., true)` на `field.*`.

**S3. `esc()` в дашборде не кодирует `'` — LOW / latent** — *снято вместе с файлом дашборда*
`05_footstrap_dashboard.js:32` — кодирует `& < > "`, но не `'`. Сейчас безопасно: все интерполяции `esc()` в тексте элемента или **двойных** кавычках атрибутов. Станет багом при добавлении single-quoted-атрибута.
Позитив: именно этот файл рендерит реально network-attacker-controlled данные — DHCP lease hostnames (`l.hostname`, DHCP option 12 от любого LAN-клиента, :66-67), host-hint hostnames (:320/324), SSID/BSSID/MAC — и корректно оборачивает всё в `esc()`.

**S4. Нет Content-Security-Policy — ОСОЗНАННОЕ РЕШЕНИЕ, не дефект (открыт как «принято»)**
`partials/head.ut` CSP не ставит, и ставить не будет. Тема **обязана** держать inline-`<script>`: pre-paint-стамп осей Appearance (mode/palette/layout/accent/rounding) должен отработать до первого кадра, до появления module-loader'а — вынести его в файл значит вернуть FOUC. Строгий CSP тут потребовал бы `'unsafe-inline'` (то есть был бы фикцией) или nonce, а nonce должен выдавать **сервер** — заголовками владеет ядро LuCI/uhttpd, не тема. Плюс любой сторонний `luci-app-*` вправе инжектить свой inline-`<style>`/`<script>` (`package-manager.js` так и делает), и CSP от темы сломал бы их все. Совпадает со стоковым LuCI. **Действий не требует** — это граница ответственности, а не долг.

**S5. Menu node name в class-атрибут через `.format` — LOW / defense-in-depth**
`menu-footstrap-common.js:26` — `'tabmenu-item-%s %s'.format(child.name, …)` в class через `E()`/`setAttribute` (без HTML-парсинга). `child.name` из ACL-фильтрованного menu-tree (определяется установленными пакетами), не из сети. Не инъектируется.

### Чисто / позитив
- **Нет внешних ресурсов**: 0 CDN/off-router URL в шипнутых CSS/JS/шаблонах; шрифты/лого/стили с `{{ media }}`/`{{ resource }}`. Нет MITM/privacy-экспозиции.
- **Нет секретов/кредов/токенов/debug-endpoint** в шипнутых ассетах.
- **`innerHTML`-синки безопасны**: `menu-footstrap-common.js:154-156` и `sysauth.js:24` очищают (`= ''`); `menu-footstrap.js:58` вставляет только статический SVG (`iconSvg` никогда не интерполирует `child.name` в разметку — lowercase+regex для выбора преднастроенного path), затем title через `.textContent:59`; дашборд `:343` через `esc()`. Нет `eval`/`new Function`/`document.write`/`insertAdjacentHTML`/`outerHTML`.
- **SPA-роутер** ограничивает навигацию same-origin (:290), только `view`-satisfied-узлами (:198), имя класса из доверенного menu-tree (:218); сбои → реальная навигация.
- **localStorage/theme-toggle**: `fs-darkmode`/`fs-palette` идут только в `setAttribute('data-darkmode'/'data-palette', …)` (без HTML-парсинга), same-origin-writable — нет пути инъекции.
- **uci-defaults + Makefile postinst/postrm**: нет command injection — все theme-имена фиксированные литералы, файловые операции `rm -f` на фикс. `/tmp/luci-*`; `case` на `mediaurlbase` value-matched.
- **Login-форма**: `duser` через `entityencode(…, true)`; CSRF обрабатывает login-endpoint LuCI (тема верно не добавляет токен).

### Рекомендация
*На момент аудита:* менять стоит только **S1** — сделано. **S2/S3 сняты вместе с файлами**, **S5** не инъектируется, **S4** — принятое решение (см. выше). **Открытых security-находок в этом разделе нет.** Единственная настоящая дыра, найденная аудитом, жила в разделе 1 — **L11** (`install.sh` без TLS-проверки), и она **закрыта**.

---

## Сводный приоритет действий

> **Таблица ниже — приоритет НА МОМЕНТ АУДИТА (2026-07-09), а не список работ.**
> Строки **1-14 закрыты** (14, `install.sh` TLS, — самая дорогая из них: MITM-вектор закрыт
> пином `--proto '=https'` + sha256 ассета). Строка **15 закрыта наполовину**: `cbi.js`
> отложить нельзя (ОТКЛОНЕНО, см. P-M1), `admin/translations` — всё ещё в `<head>`.
> Из последней строки открытыми остались только **pointerdown** и **RPC-cache**.
> Актуальный остаток целиком — пять пунктов, см. баннер в начале документа.

| # | Пункт | Тип | Усилие | Эффект |
|---|-------|-----|--------|--------|
| 1 | H1 2.5GbE «3 GbE» | correctness | 1 строка | видимый баг данных |
| 2 | H3 unwrap `L.resolveDefault` в load() | robustness | ~5 строк | Overview не падает при ACL/rpc-сбое |
| 3 | H2 SPA теряет query/hash | correctness | 1 строка | ломаные ссылки с параметрами |
| 4 | M0 dev-sync `ln -sfn` | dev-bug | 1 флаг | реальный мусор симлинков на роутере |
| 5 | P-H1 Overview → SPA | perf | спец-кейс+3 хелпера | −150-250 ms/визит самой частой страницы |
| 6 | P-H2 visibilitychange poll-pause | perf | ~10 строк | −50-100% ubus/CPU (фон/открытый Overview) |
| 7 | Preload шрифтов | perf | 3 строки | −50-300 ms первой загрузки на Wi-Fi/WAN |
| 8 | pointerdown-навигация | perf | ~5 строк | −50-100 ms воспринимаемых/клик |
| 9 | M1 отключать dupObserver | perf/correctness | ~3 строки | нет фонового скана + ложных скрытий |
| 10 | S1 entityencode hostname | security | 5 мест | consistency, устраняет порчу рендера |
| 11 | M4 dev-sync устаревшие entry | dev-hygiene | блок | нет мусора в дропдауне |
| 12 | M5 top-nav sysauth.ut | consistency | 1 include | стилизованный логин top-nav |
| 13 | M7 sysauth.js try/catch | robustness | обёртка | нет лок-аута при дрейфе |
| 14 | L11 install.sh verify-first TLS | security | ветвление | закрывает MITM pipe-to-sh |
| 15 | P-M1 head-скрипты в конец body | perf | перенос | −30-80 ms first-paint |
| — | Hover-prefetch, RPC-cache, subsetting, defer, дедуп CSS, минификация, rvht-blur, 48 CSS-литералов (dark-mode дыры) | perf/hygiene | сред/высок | см. раздел 2 |

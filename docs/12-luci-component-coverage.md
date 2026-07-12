# Покрытие LuCI-компонентов темой footstrap

Источник канонного списка: пространство имён **`LuCI.ui`** (JS API,
`openwrt.github.io/luci/jsapi/LuCI.ui.html`), сверено с исходником
`/usr/share/ucode/luci/.../ui.js` (`UIElement`-подклассы) + CBI-классы `cbi.js`.

Цель: **максимум общей логики, минимум page-scoped исключений.** Каждый виджет
темится общими блоками (token-bridge + компонентные правила), а не разово.

## Матрица (все виджеты `LuCI.ui.*`)

| Виджет | CSS-класс(ы) | Чем темится (общая логика) |
|---|---|---|
| Textfield | `.cbi-input-text`, `input[type=text/number/…]` | общий input-блок (panel2, radius 10, focus-ring) |
| Textarea | `.cbi-input-textarea`, `textarea` | тот же input-блок |
| Checkbox | `.cbi-checkbox`, `input[type=checkbox]` | toggle-switch блок |
| Select (native) | `.cbi-input-select` | input-блок + `fs-select.js` рисует рядом `.cbi-dropdown` (нативный `<select>` остаётся источником правды и `frameEl.firstChild`) |
| Dropdown | `.cbi-dropdown` | dropdown-блок (контрол+chevron+open-list) |
| Combobox | `.cbi-dropdown` + `.create-item` | dropdown-блок |
| ComboButton | `.cbi-dropdown` (кнопка) | dropdown + button блоки |
| DynamicList | `.cbi-dynlist` | dynlist-блок (базовый layout bootstrap + токены) |
| FileUpload | `.cbi-fileupload-*`, `input[type=file]`, `.cbi-filebrowser` | button-блок (кнопки несут `.cbi-button*`) + file-input |
| RangeSlider | `.cbi-range-slider*`, `input[type=range]` | slider-блок (track/thumb по токенам) — **добавлен** |
| Hiddenfield | — | невидим, стиль не нужен |
| Table | `.table`, `.cbi-rowstyle-*` | общий table-card блок (radius 14, uppercase-заголовки, hover) |
| Tabs | `.cbi-tabmenu`, `.cbi-tab*` | tabs-блок (accent-подчёркивание) |
| Progressbar | `.cbi-progressbar` | общий блок (track + good-fill) |
| Tooltip | `.cbi-tooltip*` | tooltip-блок + bridge |
| Buttons | `.cbi-button-{action,positive,negative,neutral,save,reset,add,apply,remove}` | button-блок (44 правила, `theme/55-buttons.css`) |
| Modal / Notification | `.modal`, `.cbi-modal`, `.alert-message`, `notification` | alert-блок + bridge |
| Value / Section | `.cbi-value`, `.cbi-section` | section-card блок |

## Единственный ранее-непокрытый: RangeSlider

База bootstrap оставляла `input[type=range]` нативным (браузерный рендер). Добавлен
общий slider-блок → thin track `--track`, круглый thumb `--accent`, value-бабл
`--panel2`/mono. Теперь 0 непокрытых виджетов.

## Page-scoped исключения (осознанные, не «дыры»)

Весь page-scope живёт в `styles/pages/` (`@layer page`) — **5 файлов**, не
стилевые пробелы:
- `10-login.css` — страница логина (`form:has(> .cbi-map input[name=luci_username])`).
- `20-overview.css` — `admin-status-overview`: раскладка сеткой
  (`05_footstrap_overview_layout.js`) + порт-плитки.
- `30-software.css` — `admin-system-package-manager`, Software-страница под макет.
- `40-sshkeys.css` — `admin-system-admin-sshkeys`.
- `50-leases.css` — таблицы DHCP-лизов.

Всё остальное — общая логика: **token-bridge** re-темит ~340 базовых правил
(925 деклараций в `styles/base/`), поверх — компонентные блоки (input / button /
dropdown / dynlist / table-card / tabs / slider / section-card). Один виджет =
одно общее правило, без разовых исключений на страницу.

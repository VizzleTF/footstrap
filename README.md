# theme_openwrt

Собственная тема LuCI для OpenWrt **25.12+** (старые версии не поддерживаются).
База — `luci-theme-bootstrap` (master).

## Установка

На роутере (SSH) — одной строкой, ставит последний релиз `.apk`:

```sh
wget -qO- https://raw.githubusercontent.com/VizzleTF/footstrap/main/install.sh | sh
```

Закрепить версию: `... | sh -s v0.2.1`. После — выбрать тему в **System → System →
Language and Style** (поле «Design»). Скрипт: [`install.sh`](install.sh).

## Тема

[`luci-theme-footstrap/`](luci-theme-footstrap/) — пакет темы (форк bootstrap на
ucode-шаблонах). Деплой: `luci-theme-footstrap/dev-sync.sh`. Проверено на роутере
25.12.2: шаблоны компилируются, страница логина рендерится через тему, fallback
не срабатывает.

## Документация

| Файл | Содержание |
|---|---|
| [docs/01-arhitektura-luci-25.12.md](docs/01-arhitektura-luci-25.12.md) | Как LuCI 25.12 рендерит темы: ucode, runtime, выбор темы, fallback |
| [docs/02-struktura-paketa-i-makefile.md](docs/02-struktura-paketa-i-makefile.md) | Дерево пакета, Makefile, luci.mk, uci-defaults, postrm |
| [docs/03-shablony-ucode-header-footer.md](docs/03-shablony-ucode-header-footer.md) | header.ut / footer.ut / sysauth.ut, все переменные шаблонов |
| [docs/04-css-menu-js-dark-mode.md](docs/04-css-menu-js-dark-mode.md) | CSS-контракт, переменные bootstrap, dark mode, menu-JS |
| [docs/05-sborka-deploy-razrabotka.md](docs/05-sborka-deploy-razrabotka.md) | Быстрый цикл на роутере, бекапы, SDK, apk-пакет |
| [docs/06-podvodnye-kamni-checklist.md](docs/06-podvodnye-kamni-checklist.md) | Камни совместимости 25.12+, чек-лист темы |
| [docs/07-istochniki-resursy.md](docs/07-istochniki-resursy.md) | Верифицированные источники, устаревшие гайды, примеры тем |
| [docs/08-design-sistema.md](docs/08-design-sistema.md) | Дизайн-система footstrap: токены, компоненты, границы тема/приложение |
| [docs/09-realizatsiya-sidebar.md](docs/09-realizatsiya-sidebar.md) | Спека варианта 1A Sidebar Console: раскладка, файлы, DoD |
| [docs/10-realizatsiya-topnav.md](docs/10-realizatsiya-topnav.md) | Спека варианта 1B Top-nav: выбор темы, symlinks, раскладка |
| [docs/11-refactor-best-practices.md](docs/11-refactor-best-practices.md) | Ресерч best-practices (SOLID/KISS/DRY): что применено, что неприменимо в LuCI, roadmap |
| [docs/12-luci-component-coverage.md](docs/12-luci-component-coverage.md) | Матрица покрытия всех `LuCI.ui`-виджетов темой (общая логика, исключения) |
| [docs/design/](docs/design/) | Референс макета (Claude Design) |

## Тестовый стенд

Роутер: OpenWrt 25.12.2 (mediatek/filogic, aarch64), `ssh router`.
Бекап оригинала перед изменениями: `/root/theme-backup/` на роутере
(см. docs/05, раздел «Первичная заливка»).

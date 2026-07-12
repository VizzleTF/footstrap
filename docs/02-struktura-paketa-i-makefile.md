# Структура пакета темы и Makefile

## Эталон: luci-theme-bootstrap (полное дерево исходников)

```
luci-theme-mytheme/
├── Makefile
├── htdocs/
│   └── luci-static/
│       ├── mytheme/                    # → /www/luci-static/mytheme/
│       │   ├── cascade.css             # основной CSS (имя — конвенция, задаёте в header.ut)
│       │   ├── mobile.css              # [опц.] мобильный CSS
│       │   ├── logo.svg
│       │   └── logo_48.png             # favicon
│       └── resources/                  # → /www/luci-static/resources/
│           ├── menu-mytheme.js         # клиентский рендер меню
│           └── view/mytheme/           # [опц.] JS-views (напр. sysauth.js)
│               └── sysauth.js
├── root/                               # → / (корень rootfs)
│   └── etc/uci-defaults/
│       └── 30_luci-theme-mytheme       # регистрация темы в uci
└── ucode/                              # → /usr/share/ucode/luci/
    └── template/themes/mytheme/
        ├── header.ut
        ├── footer.ut
        └── sysauth.ut                  # [опц.] своя страница логина
```

`luci.mk` устанавливает автоматически по наличию каталогов (никаких install-рецептов
писать не надо):

| Каталог исходника | Куда ставится |
|---|---|
| `ucode/*` | `/usr/share/ucode/luci/` |
| `htdocs/*` | `/www/` |
| `root/*` | `/` |
| `root/etc/uci-defaults/*` | автоматически подхватываются как LUCI_DEFAULTS |

## Makefile (минимальный, реальный из bootstrap)

```makefile
#
# Copyright (C) 2026 You
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=MyTheme Theme
LUCI_DEPENDS:=+luci-base

PKG_LICENSE:=Apache-2.0

define Package/luci-theme-mytheme/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.MyTheme
	uci commit luci
}
endef

include ../../luci.mk

# call BuildPackage - OpenWrt buildroot signature
```

Правила:

- Имя каталога/пакета **обязано** начинаться с `luci-theme-` — `luci.mk` по префиксу
  определяет тип пакета и кладёт его в меню `LuCI → Themes` menuconfig.
- `LUCI_DEPENDS:=+luci-base` — единственная зависимость.
- `postrm` подчищает uci-записи при удалении пакета (иначе мёртвая тема останется
  в списке и на неё можно переключиться → fallback-ошибка).
- `include ../../luci.mk` — путь актуален внутри feed'а luci
  (`feeds/luci/themes/<имя>/`). Для отдельного репозитория-feed'а положите тему в
  `<feed>/themes/luci-theme-mytheme/` и добавьте свою копию `luci.mk` в корень
  feed'а, либо стройте внутри feeds/luci.
- Версию задавать не нужно: `luci.mk` генерирует `PKG_VERSION` из git
  (`git-<дата>.<коммиты>~<hash>` или `<major>.<число коммитов>`).

> **Реальный Makefile footstrap отличается** (важно для сборки пакета):
> `LUCI_MINIFY_CSS:=0` + `LUCI_MINIFY_JS:=0` (минификатор ломает `:has()`/
> `color-mix()`/`calc()` — docs/06 п.13), `LUCI_PKGARCH:=all` (noarch),
> `include $(TOPDIR)/feeds/luci/luci.mk` (абсолютный путь — работает и в
> `package/`, и в feeds), инжектируемая `FOOTSTRAP_VERSION` для CI. Подробно —
> **docs/13**.

## uci-defaults: регистрация темы

`root/etc/uci-defaults/30_luci-theme-mytheme` (паттерн bootstrap, актуальный master):

```sh
#!/bin/sh

changed=0

set_opt() {
	local key=$1
	local val=$2

	if ! uci -q get "luci.$key" 2>/dev/null; then
		uci set "luci.$key=$val"
		changed=1
	fi
}

set_opt themes.MyTheme /luci-static/mytheme

# сделать тему активной ТОЛЬКО при первой установке (не при апгрейде)
if [ "$PKG_UPGRADE" != 1 ] && [ $changed = 1 ]; then
	set_opt main.mediaurlbase /luci-static/mytheme
fi

if [ $changed = 1 ]; then
	uci commit luci
fi

exit 0
```

Нюансы:

- Скрипт выполняется один раз при первой загрузке/установке, затем удаляется.
  Приём с `PKG_UPGRADE=1` («при апгрейде не перетираем выбор пользователя») в 25.12
  **мёртвый**: apk эту переменную не экспортирует, ветка апгрейда никогда не берётся —
  а postinst пакета сам перезапускает uci-defaults, т.е. скрипт отрабатывает и на
  апгрейде. Footstrap поэтому различает первую установку и апгрейд по маркер-файлу
  `/usr/share/luci-theme-footstrap/.installed` (он есть ⇔ скрипт уже отрабатывал);
  маркер пишется в конце `root/etc/uci-defaults/30_luci-theme-footstrap` и сносится
  в `postrm` вместе с каталогом `/usr/share/luci-theme-footstrap`.
- Блок `main.mediaurlbase` делает тему активной сразу после установки. Если хотите
  «установил, но не включил» — уберите этот блок (так делает openwrt-2020? нет,
  2020 тоже не активируется: его uci-defaults ставит только `themes.OpenWrt2020`).
- Ключ в `themes.<Имя>` — CamelCase без дефисов (ограничение имён опций uci).

## Именование и версия LuCI в 25.12

На роутере 25.12.2 пакет: `luci-theme-bootstrap-26.134.75701~cd18b8e` — LuCI в
25.12 собирается из master (версии 26.x), формат пакетов — **apk** (`.apk`),
не opkg/ipk. Утилита на роутере: `apk add/del/list`.

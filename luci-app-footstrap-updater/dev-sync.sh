#!/bin/sh
# Залить пакет обновлятора luci-app-footstrap-updater на дев-роутер (по умолчанию router2512).
# Ставит fs-update.js в /www/luci-static/resources, backend-скрипт + ACL + ключ в root/, перезагружает
# rpcd (чтобы подхватить file.exec ACL) и сбрасывает кэши. Тему НЕ трогает — её катает
# luci-theme-footstrap/dev-sync.sh.
set -e

R="${1:-router2512}"
D="$(cd "$(dirname "$0")" && pwd)"

ssh "$R" "mkdir -p /www/luci-static/resources"

# fs-update.js — единственный ресурс-модуль этого пакета. Тема грузит его через L.require('fs-update')
# и показывает контролы обновления только когда он есть на роутере.
scp -q "$D"/htdocs/luci-static/resources/*.js "$R":/www/luci-static/resources/

# root/ -> / как ДЕРЕВО, не списком имён (luci.mk ставит root/ целиком; файл, названный поимённо,
# уехал бы в пакет, но молча не попал бы на дев-роутер — та же ловушка, что в теме). tar, не scp -r:
# семантика слияния scp на существующем /usr неоднозначна.
set --
for _d in "$D"/root/*/; do set -- "$@" "$(basename "$_d")"; done
tar -C "$D/root" -cf - "$@" | ssh "$R" "tar -C / -xf -"

ssh "$R" "chmod +x /usr/libexec/footstrap-selfupdate.sh
	rm -f /tmp/luci-indexcache* /tmp/luci-modulecache/* 2>/dev/null || true
	/etc/init.d/rpcd reload 2>/dev/null || true
	for db in /lib/apk/db/installed /usr/lib/opkg/status; do [ -f \"\$db\" ] && touch \"\$db\"; done"

echo "updater synced to $R (fs-update.js + backend + ACL + key; rpcd reloaded)"

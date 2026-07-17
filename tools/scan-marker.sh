#!/bin/sh
# The OpenWrt SDK finds packages by GREP, not by parsing. include/scan.mk:
#
#   find -L $(SCAN_DIR) -name Makefile | xargs grep -aHE 'call (Build/DefaultTargets|BuildPackage|KernelPackage)'
#
# Whatever that grep does not match is not in the package list: no dump, no CONFIG_PACKAGE_*
# symbol, and `make package/luci-theme-footstrap/compile` answers "No rule to make target" —
# without one line anywhere in the build naming the package. This theme calls BuildPackage
# nowhere itself; luci.mk does it at the include, and the grep cannot see that. The literal
# `call BuildPackage` in the Makefile's trailing comment is the whole reason the SDK sees us.
#
# It reads like boilerplate, so it was deleted as boilerplate, and both package builds went red
# with an error that pointed at nothing. This is the gate that says so out loud.
set -eu

for mk in luci-theme-footstrap/Makefile luci-app-footstrap-updater/Makefile; do
	grep -aE 'call (Build/DefaultTargets|BuildPackage|KernelPackage)' "$mk" >/dev/null || {
		cat >&2 <<EOF
$mk does not match include/scan.mk's package grep:

    grep -aHE 'call (Build/DefaultTargets|BuildPackage|KernelPackage)'

so the OpenWrt SDK will not see this package at all — the build fails with
"No rule to make target 'package/$(dirname "$mk")/compile'" and names nothing.
Restore the trailing line:

    # call BuildPackage - OpenWrt buildroot signature
EOF
		exit 1
	}
	echo "ok: the SDK's package grep matches $mk"
done

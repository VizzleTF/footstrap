#!/bin/sh
# Hand netifd the address docker has ALREADY put on eth0 — and do it BEFORE procd boots.
#
# THE TIMING IS THE WHOLE POINT, and it is why this is not a uci-defaults script.
# Two things happen during OpenWrt's boot that a container does not survive by default:
#
#   1. By the time /etc/uci-defaults/* run, eth0 is DOWN and FLUSHED (measured: at that
#      point `ip addr` shows `eth0@if49: <BROADCAST,MULTICAST,M-DOWN> state DOWN` with no
#      inet at all). So a uci-default cannot read the address docker assigned — it reads
#      nothing, and every "derive the config from the live interface" idea has to run out
#      here, before `exec /sbin/init`.
#   2. `/bin/config_generate` then writes a config of its own from /etc/board.json, and on
#      x86 that means `br-lan` with eth0 enslaved and a hardcoded 192.168.1.1. netifd
#      applies it, docker's address is gone, and the container is unreachable with no
#      console to fix it from. That is not a theory — it is what the first version of this
#      setup did.
#
# config_generate's own guard is `[ -s /etc/config/network -a -s /etc/config/system ] &&
# exit 0`, so writing BOTH files here is what stops it. Hence /etc/config/system is
# shipped in the image even though nothing about it is interesting: an empty or missing
# one re-arms the generator.
#
# The values are DERIVED from the interface rather than passed in from compose, because a
# copy in compose is the copy nobody remembers to change. And because they match what is
# already on the wire, netifd re-asserting them is a no-op.
set -e

addr="$(ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4; exit}')"   # 172.31.0.2/24
gw="$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')"

# The resolver is TOLD to us (compose: FOOTSTRAP_DEV_DNS), not read out of the
# /etc/resolv.conf docker wrote — that file names docker's embedded resolver (127.0.0.11),
# which is dead in here: it works by NAT rules OpenWrt's boot flushes. Copying it into
# `option dns` propagates the dead address into netifd and dnsmasq; overwriting the file is
# what gives the container working DNS at all. See the note in compose.yml.
dns="${FOOTSTRAP_DEV_DNS:-1.1.1.1 8.8.8.8}"
for ns in $dns; do echo "nameserver $ns"; done > /etc/resolv.conf

if [ -n "$addr" ]; then
	netmask="$(ipcalc.sh "$addr" | sed -n 's/^NETMASK=//p')"
	cat > /etc/config/network <<-EOF
		config interface 'loopback'
			option device 'lo'
			option proto 'static'
			option ipaddr '127.0.0.1'
			option netmask '255.0.0.0'

		config globals 'globals'

		config interface 'lan'
			option device 'eth0'
			option proto 'static'
			option ipaddr '${addr%/*}'
			option netmask '$netmask'
			option gateway '$gw'
			option dns '$dns'
			option delegate '0'
	EOF
else
	echo "footstrap-dev: eth0 has no IPv4 — not writing /etc/config/network" >&2
fi

# Rewritten on every start, not just the first: the container is recreated far more often
# than a router reboots, and a stale address here is the one failure that locks us out.
sed -i "s/^\toption hostname .*/\toption hostname '$(cat /proc/sys/kernel/hostname)'/" /etc/config/system

# The invented networks (98_footstrap-dev-fixtures) hang off these. netifd knows how to
# make a bridge or a VLAN but not a dummy, so the dummy has to exist before it looks —
# which means here, before procd starts. They carry no traffic: a dummy discards, and that
# is exactly why the fake WAN can have an address and a gateway without endangering the one
# interface that is real.
for d in dummy0 dummy1; do
	ip link show "$d" >/dev/null 2>&1 || ip link add "$d" type dummy
done

# compose bind-mounts the host's public key to a staging path, because a bind mount carries
# the HOST's ownership (uid 1000) and dropbear rejects an authorized_keys it does not see
# as root's — reporting only "Permission denied (publickey)", which reads like a wrong key.
# Copying it gives root:root 0600 and nothing to debug.
# (cp+chown+chmod, not `install`: OpenWrt's busybox has no install applet, and `set -e`
# turns that into a boot loop.)
if [ -s /etc/footstrap-dev/authorized_keys.host ]; then
	cp /etc/footstrap-dev/authorized_keys.host /etc/dropbear/authorized_keys
	chown root:root /etc/dropbear/authorized_keys
	chmod 0600 /etc/dropbear/authorized_keys
fi

exec /sbin/init

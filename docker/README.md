# Dev routers in docker — one per supported release

Two containers running the **real OpenWrt userland** (procd as PID 1, netifd, ubus, rpcd,
uhttpd, dropbear) with LuCI installed, from the release's own rootfs tarball:

| ssh host | release | pkg manager | bridge address | from Windows |
|---|---|---|---|---|
| `router2512` | 25.12.4 | apk | 172.31.0.2 | http://localhost:8025 |
| `router2410` | 24.10.7 | opkg | 172.31.0.3 | http://localhost:8024 |

Login: `root` / `1234` (that is `LUCI_PW` for the preview and cssdiff tooling). Both are up
at once because the theme supports both releases and the differences that bite are runtime
ones a single box cannot show — apk vs opkg, `/lib/apk/db/installed` vs
`/usr/lib/opkg/status` as the cache-bust stamp, and the two branches' LuCI.

## Start

```sh
cd docker && docker compose up -d --build      # ~2 min the first time
```

Then append `ssh_config.example` to `~/.ssh/config` — **above** the `Host *`
block, since ssh keeps the FIRST value it obtains for each keyword. `router` is deliberately
not one of these: it stays the name of the physical box.

```sh
../luci-theme-footstrap/dev-sync.sh router2512      # register + deploy the theme
../luci-theme-footstrap/dev-sync.sh router2410
./hwsim-up.sh                                       # wifi (see below)
```

**A rebuild is a factory reset.** The containers hold no volumes, so `--build` wipes the
deployed theme along with everything else — re-run `dev-sync.sh`. That is a feature: the
install path gets exercised for real, on both package managers, instead of drifting on a
box that has been hand-patched for months.

## What is on them

They are meant to look **lived-in**, because LuCI renders almost nothing from the theme's
side: the sections, tabs, tables, badges and forms this theme exists to style only appear
when there is config behind them. A bare `luci` shows three menus and about a fifth of the
widget surface.

* **~25 `luci-app-*`** from OpenWrt's own feed (firewall, package-manager, statistics,
  banip, adblock, ddns, upnp, sqm, mwan3, nlbwmon, vnstat, samba4, wireguard, dashboard, …)
  — that is where Dashboard, Services, VPN and Statistics come from.
* **openclash and nikki**, which are not in that feed and are fetched from their releases
  (pinned in `compose.yml`). They are here because this theme's hardest problem is sharing
  one document with apps like these — `tools/chrome-fence.mjs` reasons about openclash's
  `*{padding:0!important}` from a text file; this puts the real sheet in the real document.
  Note they are dev fixtures: nothing about them is signed or verified, unlike the release
  trust chain in `install.sh`.
* **Invented networks** (`files/etc/uci-defaults/98_footstrap-dev-fixtures`): a WAN, guest
  and IoT and mgmt on VLANs, a WireGuard tunnel with two peers, five firewall zones, port
  forwards, static leases, mounts, cron jobs — plus a disabled interface, because LuCI
  renders one differently.
* **Fake clients** (`files/etc/rc.local`): DHCP leases and ARP neighbours, so the data
  tables have rows. Those tables are what `fs-select.js`'s measured card-stacking is aimed
  at, and with no rows that whole path goes untested.
* **Wifi** — see below.

**Nothing here may touch `lan`.** It is eth0 with docker's own address, it is the only way
in, and there is no console. Every invented network sits on a dummy device or a silent
VLAN, and the fake WAN's default route is metric 100 so the real one keeps winning.

## Wifi: `./hwsim-up.sh`

```sh
./hwsim-up.sh          # build the module if needed, load it, hand out radios, configure
./hwsim-up.sh --down   # unload
```

Each container gets two virtual radios, real hostapd, real SSIDs and real scans. Run it
after `compose up` and again after a container is recreated: a phy lives in a network
namespace, and when that namespace dies the phy goes back to the host.

Nothing is installed on the host and no sudo is used — the module is built in a throwaway
ubuntu container and loaded from a privileged one (being in the `docker` group is already
root-equivalent here).

Three things worth knowing, all measured, all documented at the code:

* **A real Windows adapter cannot be forwarded.** usbipd-win forwards USB devices only — a
  built-in PCIe card is not forwardable at all — and the WSL kernel carries drivers for
  almost none anyway. Virtual radios are not a compromise here; they are the only radios
  this kernel can have.
* **The module is built from the WSL kernel's own source** at the tag the running kernel
  came from. OpenWrt's `kmod-mac80211-hwsim` is built against OpenWrt's 6.12 kernel and
  cannot load; Microsoft ships 6.18 with `CONFIG_MAC80211_HWSIM is not set`.
* **2.4 GHz only.** cfg80211 forbids beaconing on 5 GHz here because it never loads
  regulatory.db — the kernel resolves the firmware path in a namespace that is neither the
  container's nor the Ubuntu root, and `CONFIG_CFG80211_REQUIRE_SIGNED_REGDB=y` rules out
  handing it one another way. The second radio is what makes **Channel Analysis** work at
  all: a scan only ever shows what another radio in the same band and the same namespace is
  beaconing, so each box carries a neighbour of its own on channel 11.

## Two ways in, and both are needed

* **The bridge address** (172.31.0.2 / .3) is what the tooling uses. `deploy.sh`,
  `preview.py`, `device-sweep.py` and `cssdiff.py` all derive the browser's base URL from
  `ssh -G <host>` — literally `http://<hostname>` — so ssh and http have to answer at the
  **same** address. A published port (localhost:2225 -> 22) cannot express that. Those
  tools run inside WSL, where the bridge is routable.
* **The published ports** are for a browser on the **Windows** side: WSL2's NAT does not
  route the docker bridge to Windows, so 172.31.0.2 is unreachable from there, but Windows
  forwards localhost into WSL. Nothing in the tooling uses them.

## What is deliberately different from a real router

* **No `curl`.** It is not in OpenWrt's default package set, and the self-updater's
  `uclient-fetch` fallback exists precisely because of that. Installing it here would hide
  that bug class on the dev box.
* **`openssh-sftp-server` IS installed** — the one concession. OpenSSH 9+ `scp` speaks
  SFTP, dropbear ships no sftp-server, and without it every `scp` in the deploy tooling
  fails. The alternative was `scp -O` at every call site, forever.
* **firewall, mwan3 and watchcat are stopped**, and their config stays so the pages still
  render. Each rewrites something a container cannot survive: fw4's zone ruleset would drop
  the ssh the tooling comes in on; mwan3 decides the fake WAN on dummy0 is the uplink and
  installs `from all fwmark 0x100/0x3f00 unreachable`, which killed DNS and the package
  manager while `ip route get 1.1.1.1` still answered correctly; watchcat's ping_reboot
  would reboot a box whose "hardware" comes back factory-fresh.
* **dnsmasq hands out no leases** (`dhcp.lan.ignore=1`). The bridge is shared with the
  other release's container; a DHCP server here would answer for addresses it does not own.
* **DNS is set explicitly** (`FOOTSTRAP_DEV_DNS`, default 1.1.1.1). Docker's embedded
  resolver does not survive OpenWrt's boot — see the long note in `compose.yml`.

## The two traps this setup exists on top of

Both are documented at the code, because both cost an afternoon:

1. **`/usr/lib/footstrap-dev/entrypoint.sh` runs before `/sbin/init`, and must.** By the
   time `/etc/uci-defaults/*` run, eth0 is already down and flushed, so nothing there can
   read the address docker assigned. And `/bin/config_generate` writes `br-lan` +
   192.168.1.1 from `/etc/board.json` unless `/etc/config/network` **and**
   `/etc/config/system` both already exist — netifd then applies it, docker's address is
   gone, and the container is unreachable with no console.
2. **The authorized_keys is copied, not mounted into place.** A bind mount keeps the host
   file's ownership (uid 1000) and dropbear rejects a key file it does not see as root's,
   reporting only `Permission denied (publickey)`.

## Poke at them

```sh
ssh router2512 'grep DESCRIPTION /etc/openwrt_release'
docker compose logs -f owrt2512
docker compose down                # stop; `up -d` gives a fresh boot, config kept
docker compose down && docker compose up -d --build   # factory reset
```

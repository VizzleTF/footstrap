'use strict';
'require baseclass';
'require rpc';
'require uci';
'require fs';
'require network';

/* Footstrap dashboard for Status → Overview — matches the Claude Design mock
 * "OpenWrt Overview". Additive include (unique filename, no collision). Renders
 * the whole overview: page head, KPI row, System, Memory, Storage, Port status,
 * Network upstream + connections, DHCP leases. The stock sections it replaces
 * are hidden by tagging them .fs-dup-hidden by title (watchDuplicates) — only
 * the sections we reproduce, so 3rd-party includes (temp-status etc.) stay
 * visible. Data comes from the same ubus/ rpc the stock includes use.
 * Crosses the theme/mod line on purpose (docs/08). */

const callSystemBoard = rpc.declare({ object: 'system', method: 'board' });
const callSystemInfo  = rpc.declare({ object: 'system', method: 'info' });
const callLuciVersion = rpc.declare({ object: 'luci',   method: 'getVersion' });
const callUnixtime    = rpc.declare({ object: 'luci',   method: 'getUnixtime', expect: { result: 0 } });
const callDHCPLeases  = rpc.declare({ object: 'luci-rpc', method: 'getDHCPLeases', expect: { '': {} } });
const callBuiltinPorts = rpc.declare({ object: 'luci', method: 'getBuiltinEthernetPorts', expect: { result: [] } });

function hb(bytes) {
	bytes = Number(bytes) || 0;
	const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
	let i = 0;
	while (bytes >= 1024 && i < u.length - 1) { bytes /= 1024; i++; }
	return { v: bytes, u: u[i] };
}
function fmt(bytes, dec) { const x = hb(bytes); return x.v.toFixed(dec == null ? 1 : dec) + ' ' + x.u; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pct(u, t) { return t ? Math.min(100, Math.round(u / t * 100)) : 0; }
function dur(sec) { try { return '%t'.format(parseInt(sec) || 0); } catch (e) { return '-'; } }

/* labelled field: dim uppercase label + mono value (network upstream, wifi radios) */
function nf(label, value) {
	return `<div class="fs-nf"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function meter(label, used, total, color) {
	const p = pct(used, total);
	return `<div class="fs-meter">
		<div class="fs-meter-top"><span>${esc(label)}</span><em>${esc(fmt(used))} / ${esc(fmt(total))}</em></div>
		<div class="fs-bar"><div style="width:${p}%;background:${color}"></div></div>
	</div>`;
}

function speedText(carrier, speed) {
	if (!carrier) return { t: 'no link', ok: false };
	if (speed == 1000) return { t: '1 GbE', ok: true };
	if (speed > 0 && speed < 1000) return { t: speed + ' M', ok: true };
	if (speed >= 1000) return { t: (speed / 1000).toFixed(0) + ' GbE', ok: true };
	return { t: 'Connected', ok: true };
}

const AVATAR = ['accent', 'good', 'warn'];

/* One card for a DHCPv4/DHCPv6 lease table — identical layout, only the address
 * column differs (addrOf extracts it). Returns '' when there are no leases. */
function leasesCard(title, subLabel, addrHeader, leases, addrOf) {
	if (!leases.length) return '';
	const rows = leases.map((l, i) => {
		const addr = addrOf(l);
		const name = l.hostname || addr;
		const ini = (name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2) || '?');
		return `<div class="fs-lease-host"><span class="fs-av ${AVATAR[i % AVATAR.length]}">${esc(ini)}</span><span>${esc(name)}</span></div>
			<div class="fs-lease-ip">${esc(addr)}</div>
			<div class="fs-lease-mac">${esc(l.macaddr || '-')}</div>
			<div class="fs-lease-rem">${esc(l.expires > 0 ? dur(l.expires) : (l.expires == 0 ? _('expired') : '∞'))}</div>
			<div class="fs-lease-act"><span class="fs-btn-o">${_('Reserve IP')}</span></div>`;
	}).join('');
	return `<div class="fs-card">
		<div class="fs-card-hd"><span class="fs-card-title">${title}</span></div>
		<div class="fs-lease-sub">${subLabel} · ${leases.length}</div>
		<div class="fs-leases">
			<div class="fs-lease-h">${_('Hostname')}</div><div class="fs-lease-h">${addrHeader}</div><div class="fs-lease-h">${_('MAC address')}</div><div class="fs-lease-h">${_('Remaining')}</div><div class="fs-lease-h"></div>
			${rows}
		</div>
	</div>`;
}

/* This include is installed to the GLOBAL luci-mod-status include dir, so LuCI
 * auto-loads it on the overview page under EVERY active theme. It must render
 * only when a footstrap theme is active — otherwise its unstyled .fs-* markup
 * dumps as raw text (cascade.css isn't loaded). L.env.media is the active
 * theme's media base, e.g. /luci-static/footstrap or /luci-static/bootstrap;
 * only footstrap variants contain "footstrap" ("bootstrap" does not). */
function isFootstrapTheme() {
	return String(L.env.media || '').indexOf('footstrap') >= 0;
}

/* Titles of the ONLY stock sections our dashboard reproduces. Everything else
 * (3rd-party includes like luci-app-temp-status) is left visible. Titles come
 * from _() so they match whatever locale the stock includes render in. */
function dupTitles() {
	return [ _('System'), _('Memory'), _('Storage'), _('Port status'), _('Network'),
	         _('DHCP Leases'), _('Active DHCP Leases'), _('Wireless'), _('Associated Stations') ];
}
function tagDuplicates(titles) {
	document.querySelectorAll('.cbi-section').forEach((sec) => {
		if (sec.querySelector('.fs-dashroot') || sec.classList.contains('fs-dup-hidden'))
			return;
		const h = sec.querySelector('.cbi-title h3');
		const t = (h && h.firstChild) ? String(h.firstChild.nodeValue || '').trim() : '';
		if (t && titles.indexOf(t) >= 0)
			sec.classList.add('fs-dup-hidden');
	});
}
/* Stock overview includes sort AFTER ours (05_) and re-render on every poll, so
 * a one-shot tag would miss/lose them. Watch #maincontent and re-tag on change
 * (debounced) — this also avoids the first-frame duplicate flash.
 * render() runs on every poll, so the observer is installed ONCE (guarded by
 * dupObserver) — otherwise each poll leaked another observer and the page got
 * progressively slower. */
let dupObserver = null;
function watchDuplicates() {
	const titles = dupTitles();
	tagDuplicates(titles);
	if (dupObserver)
		return;
	const mc = document.getElementById('maincontent') || document.body;
	let pending = false;
	dupObserver = new MutationObserver(() => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(() => { pending = false; tagDuplicates(titles); });
	});
	dupObserver.observe(mc, { childList: true, subtree: true });
}

return baseclass.extend({
	title: _('Overview'),
	loadHistory: [],

	load() {
		if (!isFootstrapTheme())
			return Promise.resolve(null);
		return Promise.all([
			L.resolveDefault(callSystemBoard(), {}),
			L.resolveDefault(callSystemInfo(), {}),
			L.resolveDefault(callLuciVersion(), { revision: '', branch: 'LuCI' }),
			L.resolveDefault(callUnixtime(), 0),
			L.resolveDefault(callDHCPLeases(), {}),
			L.resolveDefault(fs.trimmed('/proc/sys/net/netfilter/nf_conntrack_count'), '0'),
			L.resolveDefault(fs.trimmed('/proc/sys/net/netfilter/nf_conntrack_max'), '0'),
			network.getWANNetworks(),
			L.resolveDefault(callBuiltinPorts(), []),
			uci.load('system'), uci.load('network'),
			network.getWifiNetworks(), network.getHostHints()
		]).then(data => {
			const wifiNets = data[11] || [];
			return Promise.all(wifiNets.map(net =>
				L.resolveDefault(net.getAssocList(), []).then(assoc => ({ net, assoc }))
			)).then(wifi => { data.push(wifi); return data; });  // data[13]
		});
	},

	render(data) {
		if (!isFootstrapTheme() || data == null)
			return E([]);
		const board = data[0] || {}, info = data[1] || {}, luci = data[2] || {}, unixtime = data[3] || 0;
		const dhcp = data[4] || {}, ctCount = +data[5] || 0, ctMax = +data[6] || 0;
		const wanNets = data[7] || [], builtins = data[8] || [];

		/* --- memory / storage / load / uptime --- */
		const mem = L.isObject(info.memory) ? info.memory : {};
		const total = mem.total || 0, free = mem.free || 0, buffered = mem.buffered || 0, cached = mem.cached || 0;
		const available = mem.available || (free + buffered), used = total ? total - free : 0;
		const root = L.isObject(info.root) ? info.root : {}, tmp = L.isObject(info.tmp) ? info.tmp : {};
		const rootUsed = (root.used || 0) * 1024, rootTot = (root.total || 0) * 1024;
		const tmpUsed = (tmp.used || 0) * 1024, tmpTot = (tmp.total || 0) * 1024;

		const load = Array.isArray(info.load) ? info.load : [0, 0, 0];
		const l1 = load[0] / 65535, l5 = load[1] / 65535, l15 = load[2] / 65535;
		this.loadHistory.push(l1);
		if (this.loadHistory.length > 32) this.loadHistory.shift();

		const up = parseInt(info.uptime) || 0;
		const upd = Math.floor(up / 86400), uph = Math.floor((up % 86400) / 3600),
		      upm = Math.floor((up % 3600) / 60), ups = up % 60;

		/* --- system fields --- */
		const luciver = (luci.branch || 'LuCI') + ' ' + (luci.revision || '');
		const firmware = (L.isObject(board.release) ? board.release.description + ' ' : '') + (board.release?.revision || '');
		let datestr = '';
		if (unixtime) {
			const zn = uci.get('system', '@system[0]', 'zonename')?.replaceAll(' ', '_') || 'UTC';
			try { datestr = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zn }).format(new Date(unixtime * 1000)); }
			catch (e) { datestr = new Date(unixtime * 1000).toISOString().replace('T', ' ').slice(0, 16); }
		}

		const sysRows = [
			[_('Hostname'), board.hostname],
			[_('Model'), board.model],
			[_('Architecture'), board.system],
			[_('Target Platform'), L.isObject(board.release) ? board.release.target : ''],
			[_('Firmware Version'), firmware || luciver], [_('Kernel Version'), board.kernel],
			[_('Local Time'), datestr],
			[_('Load Average'), l1.toFixed(2) + ' / ' + l5.toFixed(2) + ' / ' + l15.toFixed(2)],
			[_('Uptime'), upd + 'd ' + uph + 'h ' + upm + 'm ' + ups + 's']
		].map(r => `<div class="fs-kv"><span>${esc(r[0])}</span><b>${esc(r[1] || '?')}</b></div>`).join('');

		const memCard = meter(_('Available'), available, total, 'var(--good)')
			+ meter(_('Used'), used, total, 'var(--danger)')
			+ meter(_('Buffered'), buffered, total, 'var(--accent)')
			+ meter(_('Cached'), cached, total, 'var(--accent)');

		const stCard = meter(_('Disk space'), rootUsed, rootTot, 'var(--good)')
			+ meter(_('Temp space'), tmpUsed, tmpTot, 'var(--good)');

		/* --- ports --- */
		let ports = [];
		(Array.isArray(builtins) ? builtins : []).forEach(p => {
			if (!p.device) return;
			const d = network.instantiateDevice(p.device);
			const carrier = d.getCarrier();
			const sp = speedText(carrier, d.getSpeed());
			ports.push({ name: d.getName(), carrier, sp, tx: d.getTXBytes(), rx: d.getRXBytes() });
		});
		ports.sort((a, b) => L.naturalCompare(a.name, b.name));
		const portTiles = ports.map(p => `<div class="fs-port${p.carrier ? '' : ' off'}">
			<div class="fs-port-top"><span class="fs-port-name">${esc(p.name)}</span><span class="fs-port-dot${p.carrier ? '' : ' off'}"></span></div>
			<div class="fs-port-speed${p.sp.ok ? '' : ' off'}">${esc(p.sp.t)}</div>
			<div class="fs-port-io"><span>↑ ${esc(fmt(p.tx, 1))}</span><span>↓ ${esc(fmt(p.rx, 1))}</span></div>
		</div>`).join('');
		const portsCard = ports.length ? `<div class="fs-card">
			<div class="fs-card-hd"><span class="fs-card-title">${_('Port status')}</span></div>
			<div class="fs-ports">${portTiles}</div>
		</div>` : '';

		/* --- network upstream --- */
		let netCard = '';
		const wan = (wanNets || [])[0];
		if (wan) {
			const dev = wan.getL3Device();
			const active = dev && wan.getProtocol() != 'none';
			const addr = (wan.getIPAddrs() || [])[0] || '-';
			const dns = (wan.getDNSAddrs() || [])[0] || '-';
			const exp = wan.getExpiry(), upt = wan.getUptime();
			const field = nf;
			netCard = `<div class="fs-card">
				<div class="fs-card-hd"><span class="fs-card-title">${_('Network')}</span></div>
				<div class="fs-upstream">
					<div class="fs-upstream-hd">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V10M12 10 6 14M12 10l6 4"/><circle cx="12" cy="5" r="2.5"/></svg>
						<span>${_('IPv4 Upstream')}</span>
						<span class="fs-conn${active ? '' : ' bad'}">${active ? _('Connected') : _('Not connected')}</span>
					</div>
					<div class="fs-upstream-grid">
						${field(_('Protocol'), wan.getI18n() || _('Not connected'))}
						${field(_('Address'), addr)}
						${field(_('Gateway'), wan.getGatewayAddr() || '0.0.0.0')}
						${field(_('DNS'), dns)}
						${field(_('Expires'), (exp != null && exp > -1) ? dur(exp) : '-')}
						${field(_('Connected'), (upt > 0) ? dur(upt) : '-')}
					</div>
					<div class="fs-upstream-dev">
						<span class="fs-dev-ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" stroke-width="1.8"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2"/></svg></span>
						<div><div class="fs-dev-name">${esc(dev ? dev.getI18n() : '-')}</div><div class="fs-dev-mac">${esc(dev ? dev.getMAC() : '')}</div></div>
					</div>
				</div>
				<div class="fs-conns">
					<div class="fs-conns-top"><span>${_('Active Connections')}</span><em>${ctCount} / ${ctMax} <b>(${pct(ctCount, ctMax)}%)</b></em></div>
					<div class="fs-bar"><div style="width:${pct(ctCount, ctMax)}%;background:var(--accent)"></div></div>
				</div>
			</div>`;
		}

		/* --- dhcp leases (v4 + v6, same layout via leasesCard) --- */
		const dhcpCard = leasesCard(_('DHCP Leases'), _('Active DHCPv4 Leases'), _('IPv4'),
			(dhcp.dhcp_leases || dhcp.dhcpv4_leases || dhcp.leases || []).filter(l => l.ipaddr),
			l => l.ipaddr);
		const dhcp6Card = leasesCard(_('DHCPv6 Leases'), _('Active DHCPv6 Leases'), _('IPv6'),
			(dhcp.dhcp6_leases || dhcp.dhcpv6_leases || []).filter(l => l.ip6addr || l.ip6addrs),
			l => (Array.isArray(l.ip6addrs) ? l.ip6addrs[0] : l.ip6addr) || '-');

		/* --- wireless --- */
		const hostHints = data[12], wifi = data[13] || [];
		let wifiCard = '';
		if (wifi.length) {
			const wifiSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"><path d="M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1.3" fill="var(--accent)" stroke="none"/></svg>';
			const radios = wifi.map(({ net, assoc }) => {
				const freq = parseFloat(net.getFrequency()) || 0;
				const band = freq >= 5 ? '5 GHz' : '2.4 GHz';
				const enc = net.getActiveEncryption() || '-';
				const cnt = (assoc || []).length;
				return `<div class="fs-radio">
					<div class="fs-radio-hd">${wifiSvg}<span class="fs-radio-name">${esc(net.getWifiDeviceName() || net.getName())}</span><span class="fs-radio-band">${band} · ${esc(net.getChannel() || '?')} ch</span></div>
					<div class="fs-radio-grid">
						${nf(_('Bitrate'), net.getBitRate() ? net.getBitRate() + ' Mbit/s' : '-')}
						${nf(_('Channel'), (net.getChannel() || '?') + ' · ' + (freq ? freq.toFixed(3) + ' GHz' : '-'))}
						${nf(_('Noise'), net.getNoise() != null ? net.getNoise() + ' dBm' : '-')}
						${nf(_('TX Power'), net.getTXPower() != null ? net.getTXPower() + ' dBm' : '-')}
					</div>
					<div class="fs-ssid">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--good)" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M9 20V6M14 20v-8M19 20V4"/></svg>
						<div class="fs-ssid-body">
							<div class="fs-ssid-name">${esc(net.getActiveSSID() || '?')} <span>· ${esc(net.getActiveMode() || 'AP')}</span></div>
							<div class="fs-ssid-bssid">${esc(net.getActiveBSSID() || '')}</div>
							<div class="fs-ssid-meta"><span class="fs-enc">${esc(enc)}</span><span>${cnt} ${_('associations')}</span></div>
						</div>
					</div>
				</div>`;
			}).join('');

			/* associated stations */
			let stations = [];
			wifi.forEach(({ net, assoc }) => (assoc || []).forEach(s => stations.push({ net, s })));
			const bars = (sig) => {
				const q = sig >= -50 ? 4 : sig >= -60 ? 3 : sig >= -70 ? 2 : sig >= -82 ? 1 : 0;
				const col = q >= 3 ? 'var(--good)' : q >= 2 ? 'var(--warn)' : 'var(--danger)';
				let r = '';
				for (let i = 0; i < 4; i++) r += `<rect x="${i * 5.6}" y="${11 - i * 4}" width="3.2" height="${5 + i * 4}" rx="1" fill="${i < q ? col : 'var(--track)'}"/>`;
				return `<svg width="20" height="16" viewBox="0 0 20 16">${r}</svg>`;
			};
			const fmtRate = (r) => r && r.rate ? (r.rate / 1000).toFixed(0) + ' Mbit/s' : '-';
			const stRows = stations.map(({ net, s }) => {
				const mac = s.mac || '';
				const host = hostHints ? (hostHints.getHostnameByMACAddr(mac) || '') : '';
				const ip = hostHints ? (hostHints.getIPAddrByMACAddr(mac) || '') : '';
				return `<div class="fs-st-net"><span class="fs-av accent">${wifiSvg}</span><span>${esc(net.getActiveSSID() || net.getWifiDeviceName())}</span></div>
					<div class="fs-st-mac">${esc(mac)}</div>
					<div class="fs-st-host"><div class="fs-st-hn">${esc(host || '?')}</div><div class="fs-st-ip">${esc(ip)}</div></div>
					<div class="fs-st-sig">${bars(s.signal || -100)}<span>${esc(s.signal != null ? s.signal + ' dBm' : '-')}</span></div>
					<div class="fs-st-rate">↓ ${esc(fmtRate(s.rx))}<br>↑ ${esc(fmtRate(s.tx))}</div>
					<div class="fs-st-act"><span class="fs-btn-o danger">${_('Disconnect')}</span></div>`;
			}).join('');
			const stationsBlock = stations.length ? `<div class="fs-st-title">${_('Associated Stations')}</div>
				<div class="fs-stations">
					<div class="fs-lease-h">${_('Network')}</div><div class="fs-lease-h">${_('MAC')}</div><div class="fs-lease-h">${_('Host')}</div><div class="fs-lease-h">${_('Signal')}</div><div class="fs-lease-h">${_('RX / TX rate')}</div><div class="fs-lease-h"></div>
					${stRows}
				</div>` : '';

			wifiCard = `<div class="fs-card">
				<div class="fs-card-hd"><span class="fs-card-title">${_('Wireless')}</span></div>
				<div class="fs-radios">${radios}</div>
				${stationsBlock}
			</div>`;
		}

		const box = E('div', { 'class': 'fs-dashroot' });
		box.innerHTML = `
			<div class="fs-dashhead">
				<div class="fs-dashhead-title">${_('Overview')}</div>
			</div>
			<div class="fs-cols">
				<div class="fs-card"><div class="fs-card-title">${_('System')}</div><div class="fs-kvs">${sysRows}</div></div>
				<div class="fs-colr">
					<div class="fs-card"><div class="fs-card-title">${_('Memory')}</div><div class="fs-meters">${memCard}</div></div>
					<div class="fs-card"><div class="fs-card-title">${_('Storage')}</div><div class="fs-meters">${stCard}</div></div>
				</div>
			</div>
			${portsCard}
			${netCard}
			${dhcpCard}
			${dhcp6Card}
			${wifiCard}`;

		watchDuplicates();
		return box;
	}
});

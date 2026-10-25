import type { CompanionVariableDefinitions, CompanionVariableValues } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { mobileConnected, type RouterState, type WlanInfo } from './router.js'
import { suffixesFor, unitLabel, unitValues, unitVarPrefix, type SmartHomeState } from './shstate.js'

/**
 * The variables follow one scheme, so new values have an obvious place:
 *
 *   device_             the box itself: model, firmware, uptime, the connection to it
 *   connection_wan1_    the main internet connection, whatever the technology
 *   connection_wan2_    a second one, such as a mobile backup
 *   connection_dsl_     values only a DSL line has
 *   connection_fiber_   values only a fibre line has
 *   connection_mobile_  values only a mobile connection has
 *   connection_cable_   values only a cable box has (so far its DVB-C TV function)
 *   wlan_               the wireless networks, by band, plus the guest network
 *   lan_                devices in the home network
 *   smarthome_          the smart home devices, one prefix per unit
 *
 * Values that only some boxes have are defined only on those boxes.
 */
export interface VariablesSchema extends CompanionVariableValues {
	device_connected: string
	device_web_url: string
	device_diagnostics_url: string
	device_model: string
	device_firmware: string
	device_serial: string
	device_uptime: string
	device_uptime_seconds: number | string
	connection_wan1_type: string
	connection_wan1_link: string
	connection_wan1_status: string
	connection_wan1_connected: string
	connection_wan1_uptime: string
	connection_wan1_uptime_seconds: number | string
	connection_wan1_last_error: string
	connection_wan1_ipv4: string
	connection_wan1_ipv6: string
	connection_wan1_ipv6_prefix: string
	connection_wan1_line_down_mbit: number | string
	connection_wan1_line_up_mbit: number | string
	connection_wan1_rate_down_mbit: number | string
	connection_wan1_rate_up_mbit: number | string
	connection_wan1_rate_down_kbyte: number | string
	connection_wan1_rate_up_kbyte: number | string
	wlan_enabled: string
	wlan_clients_total: number | string
	lan_hosts_active: number | string
	lan_hosts_known: number | string
	smarthome_units: number | string
}

type Definitions = CompanionVariableDefinitions<VariablesSchema>

const STATIC_DEFINITIONS: Definitions = {
	device_connected: { name: 'Device: connection to the FRITZ!Box established' },
	device_web_url: { name: 'Device: address of the web interface' },
	device_diagnostics_url: { name: 'Device: download address of the diagnostics report (set by its action)' },
	device_model: { name: 'Device: model' },
	device_firmware: { name: 'Device: FRITZ!OS version' },
	device_serial: { name: 'Device: serial number' },
	device_uptime: { name: 'Device: uptime (formatted)' },
	device_uptime_seconds: { name: 'Device: uptime in seconds' },
	connection_wan1_type: { name: 'WAN 1: access type (DSL, Fiber, Cable, LTE, Ethernet ...)' },
	connection_wan1_link: { name: 'WAN 1: physical link (Up, Down, Initializing, Unavailable)' },
	connection_wan1_status: { name: 'WAN 1: connection status (Connected, Connecting, Disconnected ...)' },
	connection_wan1_connected: { name: 'WAN 1: internet connected' },
	connection_wan1_uptime: { name: 'WAN 1: connection uptime (formatted)' },
	connection_wan1_uptime_seconds: { name: 'WAN 1: connection uptime in seconds' },
	connection_wan1_last_error: { name: 'WAN 1: last connection error' },
	connection_wan1_ipv4: { name: 'WAN 1: external IPv4 address' },
	connection_wan1_ipv6: { name: 'WAN 1: external IPv6 address' },
	connection_wan1_ipv6_prefix: { name: 'WAN 1: IPv6 prefix' },
	connection_wan1_line_down_mbit: { name: 'WAN 1: line rate downstream in Mbit/s' },
	connection_wan1_line_up_mbit: { name: 'WAN 1: line rate upstream in Mbit/s' },
	connection_wan1_rate_down_mbit: { name: 'WAN 1: current download in Mbit/s' },
	connection_wan1_rate_up_mbit: { name: 'WAN 1: current upload in Mbit/s' },
	connection_wan1_rate_down_kbyte: { name: 'WAN 1: current download in kB/s' },
	connection_wan1_rate_up_kbyte: { name: 'WAN 1: current upload in kB/s' },
	wlan_enabled: { name: 'WLAN: switched on (the WLAN button)' },
	wlan_clients_total: { name: 'WLAN: clients on all networks' },
	lan_hosts_active: { name: 'LAN: network devices currently active' },
	lan_hosts_known: { name: 'LAN: network devices known to the box' },
	smarthome_units: { name: 'Smart home: number of units' },
}

const DSL_DEFINITIONS: Record<string, string> = {
	connection_dsl_status: 'DSL: status',
	connection_dsl_sync_down_mbit: 'DSL: sync rate downstream in Mbit/s',
	connection_dsl_sync_up_mbit: 'DSL: sync rate upstream in Mbit/s',
	connection_dsl_max_down_mbit: 'DSL: attainable rate downstream in Mbit/s',
	connection_dsl_max_up_mbit: 'DSL: attainable rate upstream in Mbit/s',
	connection_dsl_snr_down_db: 'DSL: noise margin downstream in dB',
	connection_dsl_snr_up_db: 'DSL: noise margin upstream in dB',
	connection_dsl_attenuation_down_db: 'DSL: attenuation downstream in dB',
	connection_dsl_attenuation_up_db: 'DSL: attenuation upstream in dB',
}

const FIBER_DEFINITIONS: Record<string, string> = {
	connection_fiber_mode: 'Fiber: mode (AON, GPON, XGS-PON ...)',
	connection_fiber_rx_power_dbm: 'Fiber: received optical power in dBm',
	connection_fiber_tx_power_dbm: 'Fiber: transmitted optical power in dBm',
	connection_fiber_sfp_vendor: 'Fiber: SFP module vendor',
	connection_fiber_sfp_type: 'Fiber: SFP module type',
	connection_fiber_resyncs: 'Fiber: resynchronisations',
	connection_fiber_showtime_minutes: 'Fiber: minutes since the line came up',
}

const CABLE_DEFINITIONS: Record<string, string> = {
	connection_cable_dvbc_enabled: 'Cable: DVB-C TV enabled',
	connection_cable_station_search: 'Cable: DVB-C station search (active, inactive)',
	connection_cable_search_progress: 'Cable: DVB-C station search progress in percent',
}

const MOBILE_DEFINITIONS: Record<string, string> = {
	connection_mobile_enabled: 'Mobile: enabled',
	connection_mobile_technology: 'Mobile: technology (LTE, 5G-NSA, 5G-SA ...)',
	connection_mobile_signal_rsrp: 'Mobile: signal strength (RSRP) in dBm',
	connection_mobile_roaming: 'Mobile: roaming',
	connection_mobile_provider: 'Mobile: provider',
	connection_mobile_sim_status: 'Mobile: SIM card status',
}

const WAN2_DEFINITIONS: Record<string, string> = {
	connection_wan2_type: 'WAN 2: access type',
	connection_wan2_enabled: 'WAN 2: enabled',
	connection_wan2_connected: 'WAN 2: connected',
	connection_wan2_uptime: 'WAN 2: connection uptime (formatted)',
	connection_wan2_uptime_seconds: 'WAN 2: connection uptime in seconds',
}

const WLAN_SUFFIXES: { suffix: string; name: string }[] = [
	{ suffix: 'ssid', name: 'name (SSID)' },
	{ suffix: 'enabled', name: 'enabled' },
	{ suffix: 'band', name: 'frequency band' },
	{ suffix: 'channel', name: 'channel' },
	{ suffix: 'clients', name: 'connected clients' },
	{ suffix: 'password', name: 'password' },
]

/** Only the guest network switches itself off after a while. */
const GUEST_SUFFIXES: { suffix: string; name: string }[] = [
	{ suffix: 'auto_off', name: 'switches itself off after a while' },
	{ suffix: 'auto_off_minutes', name: 'switches itself off after this many minutes' },
	{ suffix: 'auto_off_remaining', name: 'time left until it switches off (minutes, as the box reports it)' },
]

/** Readable access types: the X_AVM-DE_ prefix of the TR-064 values means nothing to anyone. */
export function accessTypeLabel(type: string): string {
	return type.replace(/^X_AVM-DE_/, '')
}

/** True when the main connection itself is mobile, so a mobile service is not a second WAN. */
function isMobileAccess(type: string): boolean {
	return /LTE|UMTS|Mobile/i.test(type)
}

/** Whether the box has a mobile connection besides a main connection of another kind. */
export function hasWan2(router: RouterState): boolean {
	return router.mobile !== undefined && !isMobileAccess(router.accessType)
}

/**
 * The variable keys of the WLANs: by band rather than by instance number, which differs between
 * models, so wlan_5ghz_ssid means the same thing on every box. A second network on the same band
 * gets a number, the guest network its own key.
 */
export function wlanKeys(wlans: WlanInfo[]): Map<string, string> {
	const keys = new Map<string, string>()
	const used = new Set<string>()
	for (const wlan of wlans) {
		let base: string
		if (wlan.guest) base = 'guest'
		else if (wlan.band) base = wlan.band.replace('.', '').replace(/\s+/g, '').toLowerCase()
		else base = String(wlan.index)
		let key = base
		for (let n = 2; used.has(key); n++) key = `${base}_${n}`
		used.add(key)
		keys.set(wlan.serviceId, key)
	}
	return keys
}

function addAll(definitions: Definitions, entries: Record<string, string>): void {
	for (const [id, name] of Object.entries(entries)) definitions[id] = { name }
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const definitions: Definitions = { ...STATIC_DEFINITIONS }
	const router = self.router

	if (hasWan2(router)) addAll(definitions, WAN2_DEFINITIONS)
	if (router.dsl) addAll(definitions, DSL_DEFINITIONS)
	if (router.fiber) addAll(definitions, FIBER_DEFINITIONS)
	if (router.cable) addAll(definitions, CABLE_DEFINITIONS)
	if (router.mobile) addAll(definitions, MOBILE_DEFINITIONS)

	const keys = wlanKeys(router.wlans)
	for (const wlan of router.wlans) {
		const key = keys.get(wlan.serviceId)
		const title = wlan.guest ? 'WLAN guest' : `WLAN ${wlan.band || wlan.index}`
		for (const { suffix, name } of [...WLAN_SUFFIXES, ...(wlan.guest ? GUEST_SUFFIXES : [])]) {
			definitions[`wlan_${key}_${suffix}`] = { name: `${title}: ${name}` }
		}
	}

	const sh = self.smartHome
	for (const unit of sh.overview.units) {
		const title = `Smart home ${unitLabel(sh, unit)}`
		const alias = sh.namePrefixes.get(unit.UID)
		for (const { suffix, name } of suffixesFor(unit)) {
			definitions[`${unitVarPrefix(unit)}_${suffix}`] = { name: `${title}: ${name}` }
			if (alias) definitions[`${alias}_${suffix}`] = { name: `${title}: ${name} (by name)` }
		}
	}

	self.setVariableDefinitions(definitions)
}

/** Identifies which optional groups and WLANs exist, to notice when definitions must be rebuilt. */
export function routerShapeFingerprint(router: RouterState): string {
	return [
		hasWan2(router) ? 'wan2' : '',
		router.dsl ? 'dsl' : '',
		router.fiber ? 'fiber' : '',
		router.cable ? 'cable' : '',
		router.mobile ? 'mobile' : '',
		router.wlans.map((wlan) => `${wlan.serviceId}:${wlan.guest}:${wlan.band}:${wlan.ssid}`).join(','),
	].join('|')
}

/** Renders a number of seconds as "3d 04:15:22", dropping the day part when it is zero. */
export function formatUptime(totalSeconds: number): string {
	const seconds = Math.max(0, Math.floor(totalSeconds))
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	const secs = seconds % 60
	const pad = (value: number): string => String(value).padStart(2, '0')
	const clock = `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
	return days > 0 ? `${days}d ${clock}` : clock
}

const blank = (value: number | undefined): number | string => value ?? ''
const formatted = (seconds: number | undefined): string => (seconds === undefined ? '' : formatUptime(seconds))
const bitsToMbit = (bits: number | undefined): number | string =>
	bits === undefined ? '' : Math.round(bits / 100_000) / 10
const bytesToMbit = (bytes: number | undefined): number | string =>
	bytes === undefined ? '' : Math.round((bytes * 8) / 100_000) / 10
const bytesToKbyte = (bytes: number | undefined): number | string =>
	bytes === undefined ? '' : Math.round(bytes / 100) / 10
const kbitToMbit = (kbit: number | undefined): number | string =>
	kbit === undefined ? '' : Math.round(kbit / 100) / 10

/** The values derived from the router state, ready to publish. */
export function routerVariableValues(router: RouterState, now = Date.now()): CompanionVariableValues {
	const uptime =
		router.uptimeSeconds === undefined
			? undefined
			: router.uptimeSeconds + Math.floor((now - router.uptimeReadAt) / 1000)

	const values: CompanionVariableValues = {
		device_model: router.model,
		device_firmware: router.firmware,
		device_serial: router.serial,
		device_uptime: formatted(uptime),
		device_uptime_seconds: blank(uptime),
		connection_wan1_type: accessTypeLabel(router.accessType),
		connection_wan1_link: router.physicalLinkStatus,
		connection_wan1_status: router.connectionStatus,
		connection_wan1_connected: String(router.connectionStatus === 'Connected'),
		connection_wan1_uptime: formatted(router.connectionUptime),
		connection_wan1_uptime_seconds: blank(router.connectionUptime),
		connection_wan1_last_error: router.lastConnectionError,
		connection_wan1_ipv4: router.externalIpv4,
		connection_wan1_ipv6: router.externalIpv6,
		connection_wan1_ipv6_prefix: router.ipv6Prefix,
		connection_wan1_line_down_mbit: bitsToMbit(router.lineDownstream),
		connection_wan1_line_up_mbit: bitsToMbit(router.lineUpstream),
		connection_wan1_rate_down_mbit: bytesToMbit(router.rateDown),
		connection_wan1_rate_up_mbit: bytesToMbit(router.rateUp),
		connection_wan1_rate_down_kbyte: bytesToKbyte(router.rateDown),
		connection_wan1_rate_up_kbyte: bytesToKbyte(router.rateUp),
		wlan_enabled: router.wlanGlobalEnabled === undefined ? '' : String(router.wlanGlobalEnabled),
		wlan_clients_total: router.wlans.length ? router.wlans.reduce((sum, wlan) => sum + wlan.clients, 0) : '',
		lan_hosts_active: router.hosts ? router.hosts.filter((host) => host.active).length : '',
		lan_hosts_known: router.hosts?.length ?? '',
	}

	const { dsl, fiber, cable, mobile } = router
	if (dsl) {
		Object.assign(values, {
			connection_dsl_status: dsl.status,
			connection_dsl_sync_down_mbit: kbitToMbit(dsl.downstreamRate),
			connection_dsl_sync_up_mbit: kbitToMbit(dsl.upstreamRate),
			connection_dsl_max_down_mbit: kbitToMbit(dsl.downstreamMaxRate),
			connection_dsl_max_up_mbit: kbitToMbit(dsl.upstreamMaxRate),
			connection_dsl_snr_down_db: dsl.downstreamSnr,
			connection_dsl_snr_up_db: dsl.upstreamSnr,
			connection_dsl_attenuation_down_db: dsl.downstreamAttenuation,
			connection_dsl_attenuation_up_db: dsl.upstreamAttenuation,
		})
	}
	if (fiber) {
		Object.assign(values, {
			connection_fiber_mode: fiber.mode,
			connection_fiber_rx_power_dbm: blank(fiber.rxPower),
			connection_fiber_tx_power_dbm: blank(fiber.txPower),
			connection_fiber_sfp_vendor: fiber.sfpVendor,
			connection_fiber_sfp_type: fiber.sfpType,
			connection_fiber_resyncs: blank(fiber.resyncs),
			connection_fiber_showtime_minutes: blank(fiber.showtimeMinutes),
		})
	}
	if (cable) {
		Object.assign(values, {
			connection_cable_dvbc_enabled: String(cable.dvbcEnabled),
			connection_cable_station_search: cable.stationSearch,
			connection_cable_search_progress: blank(cable.searchProgress),
		})
	}
	if (mobile) {
		Object.assign(values, {
			connection_mobile_enabled: String(mobile.enabled),
			connection_mobile_technology: mobile.technology,
			connection_mobile_signal_rsrp: blank(mobile.signalRsrp),
			connection_mobile_roaming: String(mobile.roaming),
			connection_mobile_provider: mobile.provider,
			connection_mobile_sim_status: mobile.simStatus,
		})
	}
	if (mobile && hasWan2(router)) {
		Object.assign(values, {
			connection_wan2_type: 'Mobile',
			connection_wan2_enabled: String(mobile.enabled),
			// The mobile service has no connection state of its own; a network technology in use is the sign.
			connection_wan2_connected: String(mobileConnected(mobile)),
			connection_wan2_uptime: formatted(mobile.uptime),
			connection_wan2_uptime_seconds: blank(mobile.uptime),
		})
	}

	const keys = wlanKeys(router.wlans)
	for (const wlan of router.wlans) {
		const prefix = `wlan_${keys.get(wlan.serviceId)}`
		values[`${prefix}_ssid`] = wlan.ssid
		values[`${prefix}_enabled`] = String(wlan.enabled)
		values[`${prefix}_band`] = wlan.band
		values[`${prefix}_channel`] = wlan.channel
		values[`${prefix}_clients`] = wlan.clients
		values[`${prefix}_password`] = wlan.password ?? ''
		if (wlan.guest) {
			values[`${prefix}_auto_off`] = wlan.autoOff === undefined ? '' : String(wlan.autoOff)
			values[`${prefix}_auto_off_remaining`] = wlan.autoOffRemaining ?? ''
			values[`${prefix}_auto_off_minutes`] = wlan.autoOffMinutes ?? ''
		}
	}
	return values
}

/** The values of every smart home unit, under the UID prefix and, where there is one, the name alias. */
export function smartHomeVariableValues(sh: SmartHomeState): CompanionVariableValues {
	const values: CompanionVariableValues = { smarthome_units: sh.available ? sh.overview.units.length : '' }
	for (const unit of sh.overview.units) {
		const alias = sh.namePrefixes.get(unit.UID)
		for (const [suffix, value] of Object.entries(unitValues(sh, unit))) {
			values[`${unitVarPrefix(unit)}_${suffix}`] = value
			if (alias) values[`${alias}_${suffix}`] = value
		}
	}
	return values
}

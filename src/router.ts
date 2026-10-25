import { randomInt } from 'node:crypto'
import { decodeXmlEntities, HttpTransportError } from './http.js'
import { Tr064Client, Tr064Fault, tr064Bool, tr064Number } from './tr064.js'

/** One WLAN access point of the box: a radio band, or the guest network. */
export interface WlanInfo {
	/** The TR-064 service id, e.g. WLANConfiguration2. */
	serviceId: string
	/** The instance number, 1 to 4. */
	index: number
	enabled: boolean
	status: string
	ssid: string
	/** 2.4, 5 or 6 GHz, or empty when the box does not say. */
	band: string
	channel: number
	standard: string
	clients: number
	guest: boolean
	/** The WLAN password, readable on purpose: handy at events. Undefined if the user may not read it. */
	password: string | undefined
	/** Guest network only: whether it switches itself off after a while, and what the box reports as left. */
	autoOff: boolean | undefined
	autoOffRemaining: string | undefined
	/** Guest network only: after how many minutes it switches itself off when auto-off is active. */
	autoOffMinutes: string | undefined
}

/** One network device the box knows about. */
export interface HostInfo {
	mac: string
	ip: string
	name: string
	active: boolean
	interfaceType: string
	guest: boolean
	/** Internet access is blocked for this device ("Disallow" on the box). */
	blocked: boolean
	/** What the box says about its internet access: granted, denied, error or empty. */
	internet: string
}

export interface DslInfo {
	status: string
	/** kbit/s. */
	downstreamRate: number
	upstreamRate: number
	downstreamMaxRate: number
	upstreamMaxRate: number
	/** dB. */
	downstreamSnr: number
	upstreamSnr: number
	downstreamAttenuation: number
	upstreamAttenuation: number
}

/** The optical line of a fibre box, from X_AVM-DE_WANFiber. */
export interface FiberInfo {
	/** AON, GPON, XGS-PON ... */
	mode: string
	/** Received and transmitted optical power in dBm. */
	rxPower: number | undefined
	txPower: number | undefined
	sfpVendor: string
	sfpType: string
	resyncs: number | undefined
	showtimeMinutes: number | undefined
}

/** The DVB-C TV function of a cable box, from X_AVM-DE_Media. */
export interface CableInfo {
	dvbcEnabled: boolean
	/** active or inactive. */
	stationSearch: string
	/** Progress of a running station search, 0 to 100. */
	searchProgress: number | undefined
}

/** The mobile connection, from X_AVM-DE_WANMobileConnection: an LTE/5G box or a mobile backup. */
export interface MobileInfo {
	enabled: boolean
	/** State of the SIM card, e.g. "PIN successful" or "no SIM card". */
	simStatus: string
	/** GSM, UMTS, LTE, 5G-NSA, 5G-SA, or empty while not connected. */
	technology: string
	roaming: boolean
	/** Signal strength (RSRP) in dBm. */
	signalRsrp: number | undefined
	provider: string
	/** Seconds the mobile connection has been up. */
	uptime: number | undefined
}

export interface RouterState {
	model: string
	firmware: string
	serial: string
	/** Uptime of the box in seconds at the moment uptimeReadAt was taken. */
	uptimeSeconds: number | undefined
	uptimeReadAt: number
	accessType: string
	physicalLinkStatus: string
	/** Physical line rate in bit/s. */
	lineDownstream: number | undefined
	lineUpstream: number | undefined
	/** The service carrying the internet connection, WANPPPConnection1 or WANIPConnection1. */
	connectionService: string | undefined
	connectionStatus: string
	connectionUptime: number | undefined
	lastConnectionError: string
	externalIpv4: string
	externalIpv6: string
	ipv6Prefix: string
	/** Current throughput in bytes per second. */
	rateDown: number | undefined
	rateUp: number | undefined
	dsl: DslInfo | undefined
	fiber: FiberInfo | undefined
	cable: CableInfo | undefined
	mobile: MobileInfo | undefined
	wlans: WlanInfo[]
	/** The state of the WLAN button: all wireless networks together. */
	wlanGlobalEnabled: boolean | undefined
	/** Undefined until the list could be read, so "0 hosts" is never claimed by mistake. */
	hosts: HostInfo[] | undefined
}

export function createRouterState(): RouterState {
	return {
		model: '',
		firmware: '',
		serial: '',
		uptimeSeconds: undefined,
		uptimeReadAt: 0,
		accessType: '',
		physicalLinkStatus: '',
		lineDownstream: undefined,
		lineUpstream: undefined,
		connectionService: undefined,
		connectionStatus: '',
		connectionUptime: undefined,
		lastConnectionError: '',
		externalIpv4: '',
		externalIpv6: '',
		ipv6Prefix: '',
		rateDown: undefined,
		rateUp: undefined,
		dsl: undefined,
		fiber: undefined,
		cable: undefined,
		mobile: undefined,
		wlans: [],
		wlanGlobalEnabled: undefined,
		hosts: undefined,
	}
}

/** The first number of a comma separated list, which the online monitor sends newest first. */
export function firstOfList(list: string | undefined): number | undefined {
	if (!list) return undefined
	return tr064Number(list.split(',')[0])
}

/** Turns the FrequencyBand field (2400, 5000, 6000) into a label. */
export function bandLabel(band: string | undefined, channel: number): string {
	if (band === '2400') return '2.4 GHz'
	if (band === '5000') return '5 GHz'
	if (band === '6000') return '6 GHz'
	// Older firmware has no band field; the channel number tells 2.4 and 5 GHz apart.
	if (channel >= 1 && channel <= 14) return '2.4 GHz'
	if (channel >= 32) return '5 GHz'
	return ''
}

/**
 * Reads the host list the box hands out as an XML file.
 *
 * Parsed per item and per field rather than as a whole document, because the example in the AVM
 * documentation already contains a mismatched closing tag and the parser must not trip over that.
 */
export function parseHostList(xml: string): HostInfo[] {
	const hosts: HostInfo[] = []
	for (const match of xml.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) {
		const item = match[1] ?? ''
		const field = (tag: string): string => {
			const found = new RegExp(`<${tag}>([^<]*)<`).exec(item)
			return found ? decodeXmlEntities(found[1] ?? '').trim() : ''
		}
		const friendly = field('X_AVM-DE_FriendlyName')
		hosts.push({
			mac: field('MACAddress').toUpperCase(),
			ip: field('IPAddress'),
			name: friendly || field('HostName'),
			active: field('Active') === '1',
			interfaceType: field('InterfaceType'),
			guest: field('X_AVM-DE_Guest') === '1',
			blocked: field('X_AVM-DE_Disallow') === '1',
			internet: field('X_AVM-DE_WANAccess'),
		})
	}
	return hosts
}

/**
 * The path of a list file the box hands out. Usually a relative path; over the internet it may
 * be a complete URL, of which only the path and query are needed since host and port are known.
 */
export function listFilePath(location: string): string {
	if (/^https?:\/\//i.test(location)) {
		const url = new URL(location)
		return `${url.pathname}${url.search}`
	}
	return location.startsWith('/') ? location : `/${location}`
}

/** SIM states that mean there is no stick or SIM card at all. */
const NO_MOBILE_STATUSES = new Set(['', 'factory default', 'unconfigured', 'no sim card'])

/**
 * Whether a mobile stick or SIM is actually there. Every current box announces the mobile service,
 * because a stick can be plugged in; without one it reports e.g. "factory default" and no technology.
 */
export function hasMobileHardware(mobile: MobileInfo): boolean {
	const technology = mobile.technology.toLowerCase()
	return (
		!NO_MOBILE_STATUSES.has(mobile.simStatus.trim().toLowerCase()) || (technology !== '' && technology !== 'unknown')
	)
}

/** Whether the mobile connection is up: switched on and attached to a network. */
export function mobileConnected(mobile: MobileInfo): boolean {
	const technology = mobile.technology.toLowerCase()
	return mobile.enabled && technology !== '' && technology !== 'unknown'
}

/** The provider of the cell the mobile connection uses, from the CellList XML of GetInfoEx. */
export function connectedProvider(cellList: string): string {
	for (const match of cellList.matchAll(/<Cell>([\s\S]*?)<\/Cell>/g)) {
		const cell = match[1] ?? ''
		const connected = /<Connected>([^<]*)</.exec(cell)?.[1]?.trim()
		if (connected && connected !== 'none') return decodeXmlEntities(/<Provider>([^<]*)</.exec(cell)?.[1] ?? '').trim()
	}
	return ''
}

/** Characters of generated WLAN passwords: easy to read aloud and to type, without 0/O, 1/l/I. */
const PASSWORD_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A random WLAN password of the given length (8 to 63), for a fresh guest password per event. */
export function randomWlanPassword(length: number, pick: (max: number) => number = randomInt): string {
	const size = Math.min(63, Math.max(8, Math.round(length)))
	let password = ''
	for (let i = 0; i < size; i++) password += PASSWORD_ALPHABET[pick(PASSWORD_ALPHABET.length)]
	return password
}

/** Why a WLAN password would be refused, or undefined when it is fine: 8 to 63 printable ASCII characters. */
export function wlanPasswordProblem(password: string): string | undefined {
	if (password.length < 8) return 'at least 8 characters are needed'
	if (password.length > 63) return 'at most 63 characters are allowed'
	if (!/^[\x20-\x7e]+$/.test(password)) return 'only printable ASCII characters are allowed, no umlauts'
	return undefined
}

/** Why a WLAN name would be refused, or undefined when it is fine. */
export function wlanSsidProblem(ssid: string): string | undefined {
	if (ssid.length < 1) return 'the name must not be empty'
	if (Buffer.byteLength(ssid, 'utf8') > 32) return 'at most 32 bytes are allowed'
	if (!/^[\x20-\x7e]+$/.test(ssid)) return 'only printable ASCII characters are allowed, no umlauts'
	return undefined
}

/** Normalises a MAC address to upper case with colons, so any common spelling matches. */
export function normaliseMac(mac: string): string {
	const hex = mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase()
	if (hex.length !== 12) return mac.trim().toUpperCase()
	return hex.match(/.{2}/g)?.join(':') ?? hex
}

/** Finds a host by MAC address, IP address or name, the way a user would type it. */
export function findHost(hosts: HostInfo[] | undefined, query: string): HostInfo | undefined {
	if (!hosts) return undefined
	const wanted = query.trim()
	if (!wanted) return undefined
	const mac = normaliseMac(wanted)
	return (
		hosts.find((host) => host.mac === mac) ??
		hosts.find((host) => host.ip === wanted) ??
		hosts.find((host) => host.name.toLowerCase() === wanted.toLowerCase())
	)
}

/** Something one part of the status could not read, worth one log line and no more. */
export interface ReadProblem {
	area: string
	error: unknown
}

/**
 * Reads the router status over TR-064.
 *
 * Each area is read on its own, so a box without DSL, a user without some right, or an action
 * a firmware lacks only leaves that part empty instead of failing the whole poll. Areas that
 * turn out to be unsupported are remembered and not asked again until the next reconnect.
 */
export class RouterReader {
	readonly #tr064: Tr064Client
	/** The UPnP IGD services, which only exist in the home network. */
	readonly #igd: Tr064Client | undefined
	/** Areas the box has shown it does not offer, so they are not asked again. */
	readonly #unsupported = new Set<string>()
	#connectionServiceChecked = false

	/** The TR-064 client in use, for the diagnostics report. */
	get tr064(): Tr064Client {
		return this.#tr064
	}

	constructor(tr064: Tr064Client, igd: Tr064Client | undefined) {
		this.#tr064 = tr064
		this.#igd = igd
	}

	/** The cheap part that changes all the time: link, connection state and throughput. */
	async readFast(state: RouterState): Promise<ReadProblem[]> {
		const problems: ReadProblem[] = []
		await this.#area('link', problems, async () => {
			const link = await this.#tr064.call('WANCommonInterfaceConfig1', 'GetCommonLinkProperties')
			state.accessType = link.NewWANAccessType ?? ''
			state.physicalLinkStatus = link.NewPhysicalLinkStatus ?? ''
			state.lineDownstream = tr064Number(link.NewLayer1DownstreamMaxBitRate)
			state.lineUpstream = tr064Number(link.NewLayer1UpstreamMaxBitRate)
		})
		await this.#area('connection', problems, async () => {
			const service = await this.#connectionService(state)
			if (!service) return
			const status = await this.#tr064.call(service, 'GetStatusInfo')
			state.connectionStatus = status.NewConnectionStatus ?? ''
			state.connectionUptime = tr064Number(status.NewUptime)
			state.lastConnectionError = status.NewLastConnectionError ?? ''
		})
		await this.#readThroughput(state, problems)
		return problems
	}

	/** The part that rarely changes: identity, addresses, DSL line, WLAN and the host list. */
	/**
	 * Drops the internet connection so the box dials in again at once, usually with a new IP
	 * address. The box may cut the answer off while the line goes down, so a request that gets no
	 * answer counts as done; a refusal (missing right, no such service) does not.
	 */
	async reconnect(state: RouterState): Promise<string> {
		const service = await this.#connectionService(state)
		if (!service) throw new Error('The box has no internet connection service to reconnect')
		try {
			await this.#tr064.call(service, 'ForceTermination')
		} catch (error) {
			if (!(error instanceof HttpTransportError)) throw error
		}
		return service
	}

	/** Switches one WLAN on or off. */
	async setWlanEnabled(serviceId: string, enable: boolean): Promise<void> {
		await this.#tr064.call(serviceId, 'SetEnable', { NewEnable: enable ? 1 : 0 })
	}

	/** Switches all WLANs on or off like the WLAN button; switching on brings back the ones last active. */
	async setWlanGlobal(enable: boolean): Promise<void> {
		const first = (await this.#tr064.services()).find((service) => /^WLANConfiguration\d+$/.test(service.id))
		if (!first) throw new Error('The box offers no WLAN')
		await this.#tr064.callService(first, 'X_AVM-DE_SetWLANGlobalEnable', {
			'NewX_AVM-DE_WLANGlobalEnable': enable ? 1 : 0,
		})
	}

	/** Sets the WPA password of one WLAN. The other key fields are ignored by the box. */
	async setWlanPassword(serviceId: string, password: string): Promise<void> {
		await this.#tr064.call(serviceId, 'SetSecurityKeys', {
			NewWEPKey0: '',
			NewWEPKey1: '',
			NewWEPKey2: '',
			NewWEPKey3: '',
			NewPreSharedKey: '',
			NewKeyPassphrase: password,
		})
	}

	async setWlanSsid(serviceId: string, ssid: string): Promise<void> {
		await this.#tr064.call(serviceId, 'SetSSID', { NewSSID: ssid })
	}

	/** Sends a Wake on LAN packet from the box to a device of the home network. */
	async wakeHost(mac: string): Promise<void> {
		await this.#tr064.call('Hosts1', 'X_AVM-DE_WakeOnLANByMACAddress', { NewMACAddress: mac })
	}

	/** Blocks or allows the internet access of a device. The box applies it with a short delay. */
	async setInternetBlocked(ip: string, block: boolean): Promise<void> {
		await this.#tr064.call('X_AVM-DE_HostFilter1', 'DisallowWANAccessByIP', {
			NewIPv4Address: ip,
			NewDisallow: block ? 1 : 0,
		})
	}

	/** Restarts the box. It may drop the answer while going down, which counts as done. */
	async reboot(): Promise<void> {
		try {
			await this.#tr064.call('DeviceConfig1', 'Reboot')
		} catch (error) {
			if (!(error instanceof HttpTransportError)) throw error
		}
	}

	async readSlow(state: RouterState, withDeviceInfo: boolean): Promise<ReadProblem[]> {
		const problems: ReadProblem[] = []

		if (withDeviceInfo) {
			// GetInfo also carries the complete event log, often tens of kilobytes, so it is read
			// rarely and the uptime is carried forward from the time of reading in between.
			await this.#area('device', problems, async () => {
				const info = await this.#tr064.call('DeviceInfo1', 'GetInfo')
				state.model = info.NewModelName ?? ''
				state.firmware = info.NewSoftwareVersion ?? ''
				state.serial = info.NewSerialNumber ?? ''
				state.uptimeSeconds = tr064Number(info.NewUpTime)
				state.uptimeReadAt = Date.now()
			})
		}

		await this.#area('external_ip', problems, async () => {
			const service = await this.#connectionService(state)
			if (!service) return
			const ip = await this.#tr064.call(service, 'GetExternalIPAddress')
			state.externalIpv4 = ip.NewExternalIPAddress ?? ''
		})

		const igd = this.#igd
		if (igd) {
			await this.#area('ipv6', problems, async () => {
				// Only the UPnP IGD services offer IPv6 details, and only while the box has "transmit
				// status information over UPnP" switched on. Without it this simply stays empty.
				const address = await igd.call('WANIPConn1', 'X_AVM_DE_GetExternalIPv6Address')
				state.externalIpv6 = address.NewExternalIPv6Address ?? ''
				const prefix = await igd.call('WANIPConn1', 'X_AVM_DE_GetIPv6Prefix')
				state.ipv6Prefix = prefix.NewIPv6Prefix ? `${prefix.NewIPv6Prefix}/${prefix.NewPrefixLength ?? ''}` : ''
			})
		}

		if (state.accessType === 'DSL' || state.dsl) {
			await this.#area('dsl', problems, async () => {
				const dsl = await this.#tr064.call('WANDSLInterfaceConfig1', 'X_AVM-DE_GetDSLInfo')
				const tenth = (value: string | undefined): number => (tr064Number(value) ?? 0) / 10
				state.dsl = {
					status: dsl.NewStatus ?? '',
					downstreamRate: tr064Number(dsl.NewDownstreamCurrRate) ?? 0,
					upstreamRate: tr064Number(dsl.NewUpstreamCurrRate) ?? 0,
					downstreamMaxRate: tr064Number(dsl.NewDownstreamMaxRate) ?? 0,
					upstreamMaxRate: tr064Number(dsl.NewUpstreamMaxRate) ?? 0,
					downstreamSnr: tenth(dsl.NewDownstreamNoiseMargin),
					upstreamSnr: tenth(dsl.NewUpstreamNoiseMargin),
					downstreamAttenuation: tenth(dsl.NewDownstreamAttenuation),
					upstreamAttenuation: tenth(dsl.NewUpstreamAttenuation),
				}
			})
		}

		if (await this.#offers('X_AVM-DE_WANFiber1')) {
			await this.#area('fiber', problems, async () => {
				const info = await this.#tr064.call('X_AVM-DE_WANFiber1', 'GetInfo')
				const stats = await this.#tr064
					.call('X_AVM-DE_WANFiber1', 'GetStatistics')
					.catch((): Record<string, string> => ({}))
				// Optical levels come in thousandths of a dBm.
				const dbm = (value: string | undefined): number | undefined => {
					const raw = tr064Number(value)
					return raw === undefined ? undefined : Math.round(raw / 10) / 100
				}
				state.fiber = {
					mode: info.NewFiberMode ?? '',
					rxPower: dbm(info.NewOpticalSignalLevel),
					txPower: dbm(info.NewTransmitOpticalLevel),
					sfpVendor: info.NewSFPVendor ?? '',
					sfpType: info.NewSFPType ?? '',
					resyncs: tr064Number(stats.NewResyncs),
					showtimeMinutes: tr064Number(stats.NewMinutesInShowtime),
				}
			})
		}

		if (await this.#offers('X_AVM-DE_Media1')) {
			await this.#area('cable', problems, async () => {
				const media = await this.#tr064.call('X_AVM-DE_Media1', 'GetInfo')
				state.cable = {
					dvbcEnabled: tr064Bool(media.NewDVBCEnabled),
					stationSearch: media.NewStationSearchStatus ?? '',
					searchProgress: tr064Number(media.NewSearchProgress),
				}
			})
		}

		if (await this.#offers('X_AVM-DE_WANMobileConnection1')) {
			await this.#area('mobile', problems, async () => {
				const info = await this.#tr064.call('X_AVM-DE_WANMobileConnection1', 'GetInfo')
				// The documentation says NewEnable; a FRITZ!Box 6660 Cable with FRITZ!OS 8.40 sends NewEnabled.
				const enabled = tr064Bool(info.NewEnable ?? info.NewEnabled)
				const ex: Record<string, string> = enabled
					? await this.#tr064
							.call('X_AVM-DE_WANMobileConnection1', 'GetInfoEx')
							.catch((): Record<string, string> => ({}))
					: {}
				const mobile: MobileInfo = {
					enabled,
					simStatus: info.NewStatus ?? '',
					technology: ex.NewCurrentAccessTechnology ?? '',
					roaming: tr064Bool(ex.NewRoaming),
					signalRsrp: tr064Number(ex.NewSignalRSRP0),
					provider: connectedProvider(ex.NewCellList ?? ''),
					uptime: tr064Number(ex.NewUptime),
				}
				state.mobile = hasMobileHardware(mobile) ? mobile : undefined
			})
		}

		await this.#area('wlan', problems, async () => {
			state.wlans = await this.#readWlans(state)
		})

		await this.#area('hosts', problems, async () => {
			const path = await this.#tr064.call('Hosts1', 'X_AVM-DE_GetHostListPath')
			const listPath = path['NewX_AVM-DE_HostListPath']
			if (!listPath) return
			// The path carries its own session id and expires, so it is requested afresh every time.
			const res = await this.#tr064.get(listFilePath(listPath))
			if (res.status !== 200) throw new Error(`Host list answered HTTP ${res.status}`)
			state.hosts = parseHostList(res.body)
		})

		return problems
	}

	async #readWlans(state: RouterState): Promise<WlanInfo[]> {
		const services = (await this.#tr064.services()).filter((service) => /^WLANConfiguration\d+$/.test(service.id))
		const wlans: WlanInfo[] = []
		for (const service of services) {
			const info = await this.#tr064.callService(service, 'GetInfo')
			const associations = await this.#tr064
				.callService(service, 'GetTotalAssociations')
				.catch((): Record<string, string> => ({}))
			let guest = false
			let autoOff: boolean | undefined
			let autoOffRemaining: string | undefined
			let autoOffMinutes: string | undefined
			if (!this.#unsupported.has(`ext:${service.id}`)) {
				try {
					const ext = await this.#tr064.callService(service, 'X_AVM-DE_GetWLANExtInfo')
					guest = ext['NewX_AVM-DE_APType'] === 'guest'
					if (guest) {
						autoOff = tr064Bool(ext['NewX_AVM-DE_TimeoutActive'])
						autoOffRemaining = ext['NewX_AVM-DE_TimeRemain']
						autoOffMinutes = ext['NewX_AVM-DE_Timeout']
					}
				} catch (error) {
					if (error instanceof Tr064Fault) this.#unsupported.add(`ext:${service.id}`)
					else throw error
				}
			}
			let password: string | undefined
			if (!this.#unsupported.has(`keys:${service.id}`)) {
				try {
					password = (await this.#tr064.callService(service, 'GetSecurityKeys')).NewKeyPassphrase
				} catch (error) {
					if (error instanceof Tr064Fault) this.#unsupported.add(`keys:${service.id}`)
					else throw error
				}
			}
			const globalEnable = info['NewX_AVM-DE_WLANGlobalEnable']
			if (globalEnable !== undefined && globalEnable !== '') state.wlanGlobalEnabled = tr064Bool(globalEnable)
			const channel = tr064Number(info.NewChannel) ?? 0
			wlans.push({
				serviceId: service.id,
				index: Number(service.id.replace(/\D/g, '')) || wlans.length + 1,
				enabled: tr064Bool(info.NewEnable),
				status: info.NewStatus ?? '',
				ssid: info.NewSSID ?? '',
				band: bandLabel(info['NewX_AVM-DE_FrequencyBand'], channel),
				channel,
				standard: info.NewStandard ?? '',
				clients: tr064Number(associations.NewTotalAssociations) ?? 0,
				guest,
				password,
				autoOff,
				autoOffRemaining,
				autoOffMinutes,
			})
		}
		return wlans
	}

	/**
	 * Current throughput: the online monitor where the user may read it, otherwise the UPnP
	 * IGD counters, which need no login but only work with UPnP status information enabled.
	 */
	async #readThroughput(state: RouterState, problems: ReadProblem[]): Promise<void> {
		if (!this.#unsupported.has('monitor')) {
			try {
				const monitor = await this.#tr064.call('WANCommonInterfaceConfig1', 'X_AVM-DE_GetOnlineMonitor', {
					NewSyncGroupIndex: 0,
				})
				const down = firstOfList(monitor.Newds_current_bps)
				const up = firstOfList(monitor.Newus_current_bps)
				if (down !== undefined || up !== undefined) {
					state.rateDown = down
					state.rateUp = up
					return
				}
			} catch (error) {
				if (!(error instanceof Tr064Fault)) {
					problems.push({ area: 'throughput', error })
					return
				}
				this.#unsupported.add('monitor')
			}
		}

		const igd = this.#igd
		if (!igd) return
		await this.#area('throughput', problems, async () => {
			const addon = await igd.call('WANCommonIFC1', 'GetAddonInfos')
			state.rateDown = tr064Number(addon.NewByteReceiveRate)
			state.rateUp = tr064Number(addon.NewByteSendRate)
		})
	}

	/**
	 * Finds out once whether the internet runs over PPP or IP, which decides where to ask.
	 *
	 * Only a definite answer is kept. A box that cannot be reached or refuses the login throws, so
	 * the question is asked again on the next poll instead of being settled as "no connection".
	 */
	async #connectionService(state: RouterState): Promise<string | undefined> {
		if (this.#connectionServiceChecked) return state.connectionService
		await this.#tr064.services()

		try {
			const result = await this.#tr064.call('Layer3Forwarding1', 'GetDefaultConnectionService')
			// Looks like "1.WANPPPConnection.1"; the service id drops the dots.
			const match = /(WAN(?:PPP|IP)Connection).(d+)/.exec(result.NewDefaultConnectionService ?? '')
			if (match && (await this.#tr064.has(`${match[1]}${match[2]}`))) {
				state.connectionService = `${match[1]}${match[2]}`
			}
		} catch (error) {
			if (!(error instanceof Tr064Fault)) throw error
		}

		if (!state.connectionService) {
			for (const candidate of ['WANPPPConnection1', 'WANIPConnection1']) {
				if (!(await this.#tr064.has(candidate))) continue
				try {
					const status = await this.#tr064.call(candidate, 'GetStatusInfo')
					state.connectionService = candidate
					if (status.NewConnectionStatus === 'Connected') break
				} catch (error) {
					if (!(error instanceof Tr064Fault)) throw error
				}
			}
		}

		this.#connectionServiceChecked = true
		return state.connectionService
	}

	/** Whether the box announces a service, without failing the poll when the description is unreadable. */
	async #offers(serviceId: string): Promise<boolean> {
		try {
			return await this.#tr064.has(serviceId)
		} catch {
			return false
		}
	}

	/** Runs one area, turning "not offered by this box" into silence and anything else into a problem. */
	async #area(area: string, problems: ReadProblem[], read: () => Promise<void>): Promise<void> {
		if (this.#unsupported.has(area)) return
		try {
			await read()
		} catch (error) {
			if (error instanceof Tr064Fault && (error.isUnknownAction || error.isMissingRight)) {
				// Not available on this box or for this user: report once, then stop asking.
				this.#unsupported.add(area)
			}
			problems.push({ area, error })
		}
	}
}

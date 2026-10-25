import { isIP } from 'node:net'
import type { Tr064Client } from './tr064.js'

/** One request the module made, as kept for a diagnostics report. Never with bodies or credentials. */
export interface Exchange {
	time: string
	method: string
	target: string
	status?: number
	ms: number
	error?: string
}

/** Keeps the last requests in memory, so a report can show what happened before it was made. */
export class ExchangeLog {
	readonly #entries: Exchange[] = []
	readonly #size: number

	constructor(size = 200) {
		this.#size = size
	}

	add(entry: Exchange): void {
		this.#entries.push({ ...entry, target: scrubPath(entry.target) })
		if (this.#entries.length > this.#size) this.#entries.shift()
	}

	entries(): Exchange[] {
		return [...this.#entries]
	}
}

/** Removes session ids from paths: list files the box hands out carry one in the query. */
export function scrubPath(path: string): string {
	return path.replace(/([?&](?:sid|SID)=)[^&]*/g, '$1***')
}

const SENSITIVE_KEYS =
	/(ssid|hostname|friendlyname|^name$|devicename|username|user$|serial|imsi|iccid|bssid|mac|ipaddress|dnsserver|provider|recipient|password|passwd|sid$|psk|keypassphrase|wpakey|pin|puk)/i

/** Keys that look sensitive by name but only hold harmless counts or flags. */
const HARMLESS_KEYS = /(failurecount|numberofentries|macaddresscontrolenabled|^isMac)/i

/**
 * Replaces everything that identifies a tester or their network by placeholders: IP and MAC
 * addresses, names, network names, serial numbers, the address of the box. The same value always
 * gets the same placeholder within one report, so it stays visible which entries belong together.
 */
export class Anonymizer {
	readonly #map = new Map<string, string>()
	readonly #counters = new Map<string, number>()
	readonly #extra: { kind: string; value: string }[]

	/** Further values to hide wherever they appear, e.g. the configured host name as HOST. */
	constructor(extra: { kind: string; value: string }[] = []) {
		this.#extra = extra.filter((entry) => entry.value.length >= 3)
	}

	placeholder(kind: string, value: string): string {
		const key = `${kind}:${value}`
		const known = this.#map.get(key)
		if (known) return known
		const next = (this.#counters.get(kind) ?? 0) + 1
		this.#counters.set(kind, next)
		const result = `${kind}#${next}`
		this.#map.set(key, result)
		return result
	}

	/** Masks addresses and the extra values inside free text. */
	text(value: string): string {
		let result = value
		for (const { kind, value: extra } of this.#extra) {
			if (result.includes(extra)) result = result.split(extra).join(this.placeholder(kind, extra))
		}
		result = result.replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, (mac) =>
			this.placeholder('MAC', mac.toUpperCase().replace(/-/g, ':')),
		)
		result = result.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (ip) =>
			isIP(ip) === 4 ? this.placeholder('IPv4', ip) : ip,
		)
		result = result.replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}\b/gi, (ip) =>
			isIP(ip) === 6 && ip !== '::' ? this.placeholder('IPv6', ip) : ip,
		)
		return result
	}

	/** Walks a value; strings under sensitive keys are replaced as a whole, other strings are masked. */
	value(input: unknown, key = ''): unknown {
		if (typeof input === 'string') {
			if (input === '') return input
			if (SENSITIVE_KEYS.test(key) && !HARMLESS_KEYS.test(key)) return this.placeholder(kindOf(key), input)
			return this.text(input)
		}
		if (Array.isArray(input)) return input.map((item) => this.value(item, key))
		if (input && typeof input === 'object') {
			const output: Record<string, unknown> = {}
			for (const [childKey, child] of Object.entries(input)) output[childKey] = this.value(child, childKey)
			return output
		}
		return input
	}
}

function kindOf(key: string): string {
	if (/ssid/i.test(key)) return 'SSID'
	if (/mac/i.test(key)) return 'MAC'
	if (/ip/i.test(key)) return 'IP'
	if (/serial|imsi|iccid/i.test(key)) return 'ID'
	if (/user/i.test(key)) return 'USER'
	if (/password|passwd|psk|key|pin|puk|sid/i.test(key)) return 'SECRET'
	return 'NAME'
}

/** The read-only TR-064 actions a report asks, per service. Actions the box lacks are reported as such. */
const REPORT_ACTIONS: { service: string; actions: string[]; args?: Record<string, string | number> }[] = [
	{ service: 'DeviceInfo1', actions: ['GetInfo'] },
	{ service: 'Layer3Forwarding1', actions: ['GetDefaultConnectionService'] },
	{ service: 'WANCommonInterfaceConfig1', actions: ['GetCommonLinkProperties'] },
	{ service: 'WANCommonInterfaceConfig1', actions: ['X_AVM-DE_GetOnlineMonitor'], args: { NewSyncGroupIndex: 0 } },
	{ service: 'WANPPPConnection1', actions: ['GetStatusInfo', 'GetInfo'] },
	{ service: 'WANIPConnection1', actions: ['GetStatusInfo', 'GetInfo'] },
	{ service: 'WANDSLInterfaceConfig1', actions: ['X_AVM-DE_GetDSLInfo'] },
	{ service: 'X_AVM-DE_WANFiber1', actions: ['GetInfo', 'GetStatistics'] },
	{ service: 'X_AVM-DE_WANMobileConnection1', actions: ['GetInfo', 'GetInfoEx'] },
	{ service: 'X_AVM-DE_Media1', actions: ['GetInfo'] },
	{ service: 'Hosts1', actions: ['GetHostNumberOfEntries'] },
]

export interface ActionResult {
	service: string
	action: string
	ok: boolean
	values?: Record<string, string>
	error?: string
}

/** Asks every report action the box offers, plus each WLAN instance, and records answers and refusals alike. */
export async function collectTr064(client: Tr064Client): Promise<{ services: string[]; results: ActionResult[] }> {
	const services = await client.services()
	const results: ActionResult[] = []
	const ask = async (service: string, action: string, args?: Record<string, string | number>): Promise<void> => {
		try {
			const values = await client.call(service, action, args)
			// The event log can run to tens of kilobytes and says nothing about the interface.
			delete values.NewDeviceLog
			results.push({ service, action, ok: true, values })
		} catch (error) {
			results.push({ service, action, ok: false, error: error instanceof Error ? error.message : String(error) })
		}
	}

	for (const entry of REPORT_ACTIONS) {
		if (!services.some((service) => service.id === entry.service)) continue
		for (const action of entry.actions) await ask(entry.service, action, entry.args)
	}
	for (const service of services.filter((s) => /^WLANConfiguration\d+$/.test(s.id))) {
		for (const action of ['GetInfo', 'GetTotalAssociations', 'X_AVM-DE_GetWLANExtInfo']) await ask(service.id, action)
	}
	return { services: services.map((service) => `${service.id} (${service.serviceType})`), results }
}

/** A file name with date and time, so several reports do not overwrite each other. */
export function reportFileName(now = new Date()): string {
	const pad = (value: number): string => String(value).padStart(2, '0')
	const stamp =
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
	return `fritzbox-diagnostics-${stamp}.json`
}

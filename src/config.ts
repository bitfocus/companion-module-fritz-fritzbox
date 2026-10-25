import type { SomeCompanionConfigField } from '@companion-module/base'
import { isIP } from 'node:net'

export type ModuleConfig = {
	/** The address as typed: 192.168.178.1, fritz.box or https://xxxx.myfritz.net:43167 */
	host: string
	username: string
	/** Seconds between reads of connection state and throughput. */
	pollInterval: number
	/** Seconds between reads of the smart home overview. 0 switches smart home off. */
	smartHomeInterval: number
}

/** Values stored separately from the config so they are not echoed back to the web UI. */
export type ModuleSecrets = {
	password: string
}

export const DEFAULT_CONFIG: ModuleConfig = {
	host: '192.168.178.1',
	username: '',
	pollInterval: 15,
	smartHomeInterval: 60,
}

/** Where the web interface of the box is, worked out from the address field. */
export interface BoxAddress {
	host: string
	https: boolean
	/** The port of the web interface: as given, or the default of the protocol. */
	port: number
	/** Whether the box is in a home network or VPN rather than reached over the internet. */
	homeNetwork: boolean
}

/**
 * Reads the address field: a bare name or IP, "name:port", or a full address such as
 * https://xxxx.myfritz.net:43167/ as the MyFRITZ! page shows it. Without a scheme HTTP is used,
 * without a port the default of the protocol. Paths and query strings are ignored. Returns
 * undefined for text that is no address at all.
 */
export function parseAddress(input: string): BoxAddress | undefined {
	const text = input.trim()
	if (!text) return undefined

	let host: string
	let https = false
	let port: number | undefined

	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
		let url: URL
		try {
			url = new URL(text)
		} catch {
			return undefined
		}
		const scheme = url.protocol.toLowerCase()
		if (scheme !== 'http:' && scheme !== 'https:') return undefined
		host = url.hostname.replace(/^\[|\]$/g, '')
		https = scheme === 'https:'
		// URL leaves the port empty when it is the default of the scheme.
		if (url.port) port = Number(url.port)
	} else if (isIP(text) === 6) {
		// A bare IPv6 address has colons of its own and no port.
		host = text
	} else {
		const match = /^(?:\[([0-9a-f:.]+)\]|([^\s/:[\]]+))(?::(\d{1,5}))?\/?$/i.exec(text)
		if (!match) return undefined
		host = match[1] ?? match[2] ?? ''
		if (match[3]) port = Number(match[3])
	}

	host = host.toLowerCase()
	if (!host || (port !== undefined && (port < 1 || port > 65535))) return undefined
	return { host, https, port: port ?? (https ? 443 : 80), homeNetwork: isHomeNetworkHost(host) }
}

/**
 * Whether an address belongs to a home network: private, link local and shared (VPN, e.g.
 * Tailscale) ranges, and names that only resolve inside a network. Everything else, MyFRITZ!
 * names in particular, is taken to be reached over the internet. This only decides which way to
 * TR-064 is tried first; the other one is tried as well.
 */
export function isHomeNetworkHost(host: string): boolean {
	const name = host.toLowerCase().replace(/\.$/, '')
	const version = isIP(name)
	if (version === 4) {
		const [a = 0, b = 0] = name.split('.').map(Number)
		return (
			a === 10 ||
			a === 127 ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 169 && b === 254) ||
			(a === 100 && b >= 64 && b <= 127)
		)
	}
	if (version === 6) {
		return name === '::1' || /^f[cd]/.test(name) || /^fe[89ab]/.test(name)
	}
	if (!name.includes('.')) return true
	return /\.(box|local|lan|home|internal|localdomain|intranet)$/.test(name) || name === 'localhost'
}

/** The address of the web interface as a URL, the default port left out. */
export function webUrlFor(address: BoxAddress | undefined): string {
	if (!address) return ''
	const host = address.host.includes(':') ? `[${address.host}]` : address.host
	const showPort = address.port !== (address.https ? 443 : 80)
	return `${address.https ? 'https' : 'http'}://${host}${showPort ? `:${address.port}` : ''}`
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'About this connection',
			width: 12,
			value:
				'Reads the router status over TR-064 and controls smart home devices over the FRITZ!OS ' +
				'Smart Home REST API (FRITZ!OS 8.20 or later), or over the older AHA-HTTP interface on earlier ' +
				'versions, chosen automatically. Create a dedicated user on the box under ' +
				'System > FRITZ!Box Users with the rights "FRITZ!Box Settings" and "Smart Home", and make ' +
				'sure Home Network > Network > Network Settings > "Allow access for applications" is on. ' +
				'For a box elsewhere, also allow that user access from the internet and enter the internet ' +
				'address of the box: its MyFRITZ! name or the name from another dynamic DNS service, with the ' +
				'port shown under Internet > MyFRITZ! Account, e.g. https://xxxxxxxxxxxx.myfritz.net:43167.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Address',
			tooltip:
				'IP address or name of the box, e.g. 192.168.178.1, or its internet address (MyFRITZ! or another ' +
				'dynamic DNS name) with the port from Internet > MyFRITZ! Account, e.g. ' +
				'https://xxxxxxxxxxxx.myfritz.net:43167. Without a port the default port is used (80, or 443 ' +
				'with https://). Everything else is found automatically.',
			width: 12,
			default: DEFAULT_CONFIG.host,
			regex: '/^\\S*$/',
		},
		{
			type: 'textinput',
			id: 'username',
			label: 'User name',
			tooltip: 'A FRITZ!Box user with the rights "FRITZ!Box Settings" and "Smart Home"',
			width: 6,
			default: DEFAULT_CONFIG.username,
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			width: 6,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Router status interval (s)',
			tooltip:
				'How often connection state and throughput are read. Addresses, WLAN and the host list are ' +
				'read every 30 seconds, model and firmware every ten minutes.',
			width: 6,
			min: 2,
			max: 300,
			default: DEFAULT_CONFIG.pollInterval,
		},
		{
			type: 'number',
			id: 'smartHomeInterval',
			label: 'Smart home interval (s), 0 = off',
			tooltip:
				'How often the state of all smart home devices is read, in one request. After a smart home ' +
				'action the state is read again right away, so a long interval does not delay feedbacks. ' +
				'Battery powered thermostats only report every few minutes anyway.',
			width: 6,
			min: 0,
			max: 300,
			default: DEFAULT_CONFIG.smartHomeInterval,
		},
	]
}

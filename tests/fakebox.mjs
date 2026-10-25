// A stand-in FRITZ!Box for the tests: login_sid.lua with PBKDF2, TR-064 with real digest checking,
// a host list file and the Smart Home REST API. Everything is served on one port, which the module
// is pointed at through its web and TR-064 port settings.
import http from 'node:http'
import https from 'node:https'
import { readFileSync } from 'node:fs'
import { ahaCommand, initialAhaState } from './aha-fixture.mjs'
import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto'

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex')

export const USER = 'companion'
export const PASSWORD = 'süßes Passwort'
const REALM = 'F!Box SOAP-Auth'

const SERVICES = [
	['DeviceInfo', 'DeviceInfo1', '/upnp/control/deviceinfo'],
	['Layer3Forwarding', 'Layer3Forwarding1', '/upnp/control/layer3forwarding'],
	['Hosts', 'Hosts1', '/upnp/control/hosts'],
	['WLANConfiguration', 'WLANConfiguration1', '/upnp/control/wlanconfig1'],
	['WLANConfiguration', 'WLANConfiguration2', '/upnp/control/wlanconfig2'],
	['WLANConfiguration', 'WLANConfiguration3', '/upnp/control/wlanconfig3'],
	['WANCommonInterfaceConfig', 'WANCommonInterfaceConfig1', '/upnp/control/wancommonifconfig1'],
	['WANDSLInterfaceConfig', 'WANDSLInterfaceConfig1', '/upnp/control/wandslifconfig1'],
	['WANPPPConnection', 'WANPPPConnection1', '/upnp/control/wanpppconn1'],
	['WANIPConnection', 'WANIPConnection1', '/upnp/control/wanipconnection1'],
	['X_AVM-DE_WANMobileConnection', 'X_AVM-DE_WANMobileConnection1', '/upnp/control/x_wanmobileconn'],
	['X_AVM-DE_WANFiber', 'X_AVM-DE_WANFiber1', '/upnp/control/x_wanfiber'],
	['X_AVM-DE_Media', 'X_AVM-DE_Media1', '/upnp/control/x_media'],
	['X_AVM-DE_HostFilter', 'X_AVM-DE_HostFilter1', '/upnp/control/x_hostfilter'],
	['DeviceConfig', 'DeviceConfig1', '/upnp/control/deviceconfig'],
]

function description() {
	const services = SERVICES.map(
		([type, id, url]) =>
			`<service><serviceType>urn:dslforum-org:service:${type}:1</serviceType>` +
			`<serviceId>urn:${type}-com:serviceId:${id}</serviceId><controlURL>${url}</controlURL>` +
			`<eventSubURL>/upnp/control/x</eventSubURL><SCPDURL>/x.xml</SCPDURL></service>`,
	)
	// Nested like the real thing: services of the WAN device sit in a deviceList.
	return (
		'<?xml version="1.0"?><root xmlns="urn:dslforum-org:device-1-0"><device>' +
		`<deviceType>urn:dslforum-org:device:InternetGatewayDevice:1</deviceType><serviceList>${services.slice(0, 6).join('')}</serviceList>` +
		`<deviceList><device><serviceList>${services.slice(6).join('')}</serviceList></device></deviceList>` +
		'</device></root>'
	)
}

const initialWlans = () => ({
	'/upnp/control/wlanconfig1': {
		ssid: 'Studio',
		band: '2400',
		channel: 6,
		enable: 1,
		clients: 3,
		ap: 'normal',
		key: 'studio-secret-24',
	},
	'/upnp/control/wlanconfig2': {
		ssid: 'Studio 5',
		band: '5000',
		channel: 44,
		enable: 1,
		clients: 7,
		ap: 'normal',
		key: 'studio-secret-5',
	},
	'/upnp/control/wlanconfig3': {
		ssid: 'Gäste & Co',
		band: '2400',
		channel: 6,
		enable: 0,
		clients: 0,
		ap: 'guest',
		key: 'welcome2026',
	},
})

const initialHosts = () => [
	{
		ip: '192.168.178.20',
		mac: 'AA:BB:CC:00:00:01',
		active: 1,
		name: 'playout-pc',
		type: 'Ethernet',
		friendly: '',
		disallow: 0,
	},
	{
		ip: '192.168.178.21',
		mac: 'aa:bb:cc:00:00:02',
		active: 0,
		name: 'tablet',
		type: '802.11',
		friendly: 'Regie-Tablet',
		disallow: 0,
	},
]

function hostList(hosts) {
	return (
		'<?xml version="1.0" ?><List>' +
		hosts
			.map(
				(h, i) =>
					`<Item><Index>${i + 1}</Index><IPAddress>${h.ip}</IPAddress><MACAddress>${h.mac}</MACAddress>` +
					`<Active>${h.active}</Active><HostName>${h.name}</HostName><InterfaceType>${h.type}</InterfaceType>` +
					`<X_AVM-DE_Guest>0</X_AVM-DE_Guest><X_AVM-DE_WANAccess>${h.disallow ? 'denied' : 'granted'}</X_AVM-DE_WANAccess>` +
					`<X_AVM-DE_Disallow>${h.disallow}</X_AVM-DE_Disallow>` +
					(h.friendly ? `<X_AVM-DE_FriendlyName>${h.friendly}</X_AVM-DE_FriendlyName>` : '') +
					// The mismatched tag of the AVM example, kept so the parser stays tolerant.
					'<X_AVM-DE_URLParameter></X_AVM-DE_URLParameters></Item>',
			)
			.join('') +
		`<!-- devicehosts :${hosts.length} --></List>`
	)
}

export function initialOverview() {
	return {
		devices: [
			{
				UID: '11630 0015376',
				ain: '11630 0015376',
				name: 'Steckdose Regie',
				productName: 'FRITZ!Smart Energy 200',
				unitUids: ['11630 0015376'],
				isConnected: true,
				batteryState: 'unknown',
			},
			{
				UID: '09995 0123456',
				name: 'Heizung Saal',
				productName: 'FRITZ!Smart Thermo 302',
				unitUids: ['09995 0123456'],
				isConnected: true,
				batteryState: 'known',
				batteryValue: 80,
				isBatteryLow: false,
			},
			{
				UID: '13077 0137031',
				name: 'Fenster Saal',
				productName: 'HAN-FUN contact',
				unitUids: ['13077 0137031-1'],
				isConnected: true,
				batteryState: 'known',
				batteryValue: 10,
				isBatteryLow: true,
			},
		],
		units: [
			{
				UID: '11630 0015376',
				name: 'Steckdose Regie',
				unitType: 'avmPlugSocket',
				isConnected: true,
				isGroupUnit: false,
				deviceUid: '11630 0015376',
				parentUid: '11630 0015376',
				interfaces: {
					onOffInterface: { state: 'valid', active: false, outletState: 'valid' },
					multimeterInterface: { state: 'valid', power: 123450, voltage: 230120, current: 540, energy: 15320 },
					temperatureInterface: { state: 'valid', celsius: 22.5 },
				},
			},
			{
				UID: '09995 0123456',
				name: 'Heizung Saal',
				unitType: 'avmThermostat',
				isConnected: true,
				isGroupUnit: false,
				deviceUid: '09995 0123456',
				parentUid: '09995 0123456',
				interfaces: {
					thermostatInterface: {
						state: 'valid',
						setPointTemperature: { mode: 'temperature', celsius: 21 },
						boost: { enabled: false, endTime: 0 },
						windowOpenMode: { enabled: false, endTime: 0 },
					},
					temperatureInterface: { state: 'valid', celsius: 19.5 },
				},
			},
			{
				UID: '13077 0137031-1',
				name: 'Fenster Saal',
				unitType: 'windowOpenCloseDetector',
				isConnected: true,
				isGroupUnit: false,
				deviceUid: '13077 0137031',
				parentUid: '13077 0137031',
				interfaces: { alertInterface: { state: 'valid', alerts: ['open'], lastAlertTime: 0 } },
			},
		],
		groups: [],
		triggers: [{ UID: 'trg9D4BAB-3FC9C824E', ain: 'trg9D4BAB-3FC9C824E', name: 'Abends aus', enabled: true }],
		templates: [
			{ UID: 'tmp9D4BAB-3F42B59F6', name: 'Alles aus', applyType: ['relayManual'], template: { isAutoCreated: false } },
			{ UID: 'tmp9D4BAB-HELPER', name: 'helper', applyType: ['relayManual'], template: { isAutoCreated: true } },
		],
		globals: {},
	}
}

export async function startFakeBox(options = {}) {
	const state = {
		overview: initialOverview(),
		puts: [],
		templatesApplied: [],
		loginAttempts: 0,
		sids: new Set(),
		nonces: new Set(),
		soapCalls: [],
		smartHome: options.smartHome ?? true,
		/** The old AHA-HTTP interface, which every box has, also those without the REST API. */
		aha: options.aha ?? true,
		ahaState: initialAhaState(),
		wlans: initialWlans(),
		hosts: initialHosts(),
		wlanGlobal: 1,
		woken: [],
		reboots: 0,
		/** How many times the description fails before the box "comes up". */
		descriptionFailures: options.descriptionFailures ?? 0,
		// The real box hands out a fresh challenge per page view; a fixed one keeps this simple.
		challenge: `2$1000$${randomBytes(8).toString('hex')}$100$${randomBytes(8).toString('hex')}`,
	}

	const expectedResponse = () => {
		const [, i1, s1, i2, s2] = state.challenge.split('$')
		const h1 = pbkdf2Sync(Buffer.from(PASSWORD, 'utf8'), Buffer.from(s1, 'hex'), Number(i1), 32, 'sha256')
		const h2 = pbkdf2Sync(h1, Buffer.from(s2, 'hex'), Number(i2), 32, 'sha256')
		return `${s2}$${h2.toString('hex')}`
	}

	const sessionInfo = (sid) =>
		`<?xml version="1.0" encoding="utf-8"?><SessionInfo><SID>${sid}</SID><Challenge>${state.challenge}</Challenge>` +
		'<BlockTime>0</BlockTime><Rights><Name>Dial</Name><Access>2</Access><Name>HomeAuto</Name><Access>2</Access>' +
		'<Name>BoxAdmin</Name><Access>2</Access></Rights><Users><User last="1">companion</User></Users></SessionInfo>'

	const readBody = (req) =>
		new Promise((resolve) => {
			const chunks = []
			req.on('data', (c) => chunks.push(c))
			req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
		})

	const digestOk = (req) => {
		const header = req.headers.authorization ?? ''
		if (!header.startsWith('Digest ')) return false
		const p = {}
		for (const m of header.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) p[m[1]] = m[2] ?? m[3]
		// The digest must cover the path actually requested, prefix included.
		if (!state.nonces.has(p.nonce) || p.username !== USER || p.uri !== req.url) return false
		const ha1 = md5(`${USER}:${REALM}:${PASSWORD}`)
		const ha2 = md5(`${req.method}:${p.uri}`)
		return p.response === md5(`${ha1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`)
	}

	const soapResult = (action, values) =>
		'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
		`<u:${action}Response xmlns:u="x">` +
		Object.entries(values)
			.map(([k, v]) => `<${k}>${String(v).replace(/&/g, '&amp;')}</${k}>`)
			.join('') +
		`</u:${action}Response></s:Body></s:Envelope>`

	const soapFault = (code, text) =>
		'<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault>' +
		'<faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail>' +
		`<UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode>` +
		`<errorDescription>${text}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`

	function soap(path, action, args = {}) {
		const WLANS = state.wlans
		if (path === '/upnp/control/deviceinfo' && action === 'GetSecurityPort') return { NewSecurityPort: 49443 }
		if (path === '/upnp/control/deviceinfo' && action === 'GetInfo')
			return {
				NewManufacturerName: 'AVM',
				NewModelName: 'FRITZ!Box 7590 AX',
				NewSerialNumber: '3810D5000001',
				NewSoftwareVersion: '256.08.20',
				NewUpTime: 3725,
				NewDeviceLog: 'lots of log lines',
			}
		if (path === '/upnp/control/layer3forwarding' && action === 'GetDefaultConnectionService')
			return { NewDefaultConnectionService: '1.WANPPPConnection.1' }
		if (path === '/upnp/control/wancommonifconfig1' && action === 'GetCommonLinkProperties')
			return {
				NewWANAccessType: 'DSL',
				NewLayer1UpstreamMaxBitRate: 46720000,
				NewLayer1DownstreamMaxBitRate: 116790000,
				NewPhysicalLinkStatus: 'Up',
			}
		if (path === '/upnp/control/wancommonifconfig1' && action === 'X_AVM-DE_GetOnlineMonitor')
			return {
				NewTotalNumberSyncGroups: 1,
				Newds_current_bps: '1250000,1000,1000',
				Newus_current_bps: '62500,200,200',
				Newmc_current_bps: '0,0,0',
			}
		if (path === '/upnp/control/wanpppconn1' && action === 'GetStatusInfo')
			return { NewConnectionStatus: 'Connected', NewLastConnectionError: 'ERROR_NONE', NewUptime: 90061 }
		if (path === '/upnp/control/wanpppconn1' && action === 'ForceTermination') {
			state.reconnects = (state.reconnects ?? 0) + 1
			state.externalIp = '198.51.100.23'
			return {}
		}
		if (path === '/upnp/control/wanpppconn1' && action === 'GetExternalIPAddress')
			return { NewExternalIPAddress: state.externalIp ?? '203.0.113.7' }
		if (path === '/upnp/control/wandslifconfig1' && action === 'X_AVM-DE_GetDSLInfo')
			return {
				NewStatus: 'Up',
				NewDownstreamCurrRate: 116790,
				NewUpstreamCurrRate: 46720,
				NewDownstreamMaxRate: 130000,
				NewUpstreamMaxRate: 50000,
				NewDownstreamNoiseMargin: 95,
				NewUpstreamNoiseMargin: 80,
				NewDownstreamAttenuation: 140,
				NewUpstreamAttenuation: 120,
			}
		const wlan = WLANS[path]
		if (wlan && action === 'GetInfo')
			return {
				NewEnable: wlan.enable,
				NewStatus: wlan.enable ? 'Up' : 'Disabled',
				NewSSID: wlan.ssid,
				NewChannel: wlan.channel,
				NewStandard: 'ax',
				'NewX_AVM-DE_FrequencyBand': wlan.band,
				'NewX_AVM-DE_WLANGlobalEnable': state.wlanGlobal,
			}
		if (wlan && action === 'GetTotalAssociations') return { NewTotalAssociations: wlan.clients }
		if (wlan && action === 'X_AVM-DE_GetWLANExtInfo')
			return {
				'NewX_AVM-DE_APType': wlan.ap,
				'NewX_AVM-DE_TimeoutActive': wlan.ap === 'guest' ? 1 : 0,
				'NewX_AVM-DE_TimeRemain': wlan.ap === 'guest' ? 90 : 0,
			}
		if (wlan && action === 'GetSecurityKeys') return { NewKeyPassphrase: wlan.key, NewPreSharedKey: '' }
		if (wlan && action === 'SetEnable') {
			wlan.enable = Number(args.NewEnable)
			return {}
		}
		if (wlan && action === 'SetSecurityKeys') {
			wlan.key = args.NewKeyPassphrase
			return {}
		}
		if (wlan && action === 'SetSSID') {
			wlan.ssid = args.NewSSID
			return {}
		}
		if (wlan && action === 'X_AVM-DE_SetWLANGlobalEnable') {
			state.wlanGlobal = Number(args['NewX_AVM-DE_WLANGlobalEnable'])
			for (const w of Object.values(WLANS)) if (w.ap === 'normal') w.enable = state.wlanGlobal
			return {}
		}
		if (path === '/upnp/control/hosts' && action === 'X_AVM-DE_WakeOnLANByMACAddress') {
			state.woken.push(args.NewMACAddress)
			return {}
		}
		if (path === '/upnp/control/x_hostfilter' && action === 'DisallowWANAccessByIP') {
			const host = state.hosts.find((h) => h.ip === args.NewIPv4Address)
			if (!host) return undefined
			host.disallow = Number(args.NewDisallow)
			return {}
		}
		if (path === '/upnp/control/deviceconfig' && action === 'Reboot') {
			state.reboots++
			return {}
		}
		if (path === '/upnp/control/x_wanmobileconn' && action === 'GetInfo')
			return { NewEnabled: 1, NewStatus: 'PIN successful', NewPINFailureCount: 0, NewPUKFailureCount: 0 }
		if (path === '/upnp/control/x_wanmobileconn' && action === 'GetInfoEx')
			return {
				NewCurrentAccessTechnology: 'LTE',
				NewRoaming: 0,
				NewSignalRSRP0: -97,
				NewUptime: 3600,
				NewCellList:
					'<CellList><Cell><Index>1</Index><Connected>none</Connected><Provider>Telekom</Provider></Cell>' +
					'<Cell><Index>2</Index><Connected>primary</Connected><Provider>Vodafone</Provider></Cell></CellList>',
			}
		if (path === '/upnp/control/x_wanfiber' && action === 'GetInfo')
			return {
				NewOpticalSignalLevel: -18450,
				NewTransmitOpticalLevel: 2310,
				NewFiberMode: 'XGSPON',
				NewSFPVendor: 'FRITZ!',
				NewSFPType: '10GBASE_BX',
			}
		if (path === '/upnp/control/x_wanfiber' && action === 'GetStatistics')
			return { NewResyncs: 2, NewMinutesInShowtime: 1440 }
		if (path === '/upnp/control/x_media' && action === 'GetInfo')
			return { NewDVBCEnabled: 1, NewStationSearchStatus: 'inactive', NewSearchProgress: 0 }
		if (path === '/upnp/control/hosts' && action === 'X_AVM-DE_GetHostListPath')
			return { 'NewX_AVM-DE_HostListPath': '/devicehostlist.lua?sid=abc123' }
		return undefined
	}

	// Over the internet the box serves HTTPS only, on one port, with TR-064 below /tr064.
	const remote = options.remote ?? false
	state.paths = []
	const handler = async (req, res) => {
		const url = new URL(req.url, 'http://localhost')
		state.paths.push(req.url)
		let tr064Path = true
		if (remote) {
			tr064Path = url.pathname.startsWith('/tr064/')
			if (tr064Path) url.pathname = url.pathname.slice('/tr064'.length)
		}
		const body = await readBody(req)
		const send = (status, text, type = 'text/xml', headers = {}) => {
			res.writeHead(status, { 'Content-Type': type, ...headers })
			res.end(text)
		}
		const challenge = () => {
			const nonce = randomBytes(8).toString('hex').toUpperCase()
			state.nonces.add(nonce)
			return send(401, '', 'text/html', {
				'WWW-Authenticate': `Digest realm="${REALM}", nonce="${nonce}", algorithm=MD5, qop="auth"`,
			})
		}

		const isTr064 =
			url.pathname === '/tr64desc.xml' ||
			url.pathname === '/devicehostlist.lua' ||
			url.pathname.startsWith('/upnp/control/')
		if (remote && (isTr064 !== tr064Path || url.pathname === '/igddesc.xml')) {
			return send(404, 'Not Found', 'text/html')
		}

		// Over the remote access the box wants the login for the description and list files too.
		if (remote && (url.pathname === '/tr64desc.xml' || url.pathname === '/devicehostlist.lua') && !digestOk(req)) {
			return challenge()
		}

		if (url.pathname === '/tr64desc.xml') {
			if (state.descriptionFailures > 0) {
				state.descriptionFailures--
				return send(503, 'Service Unavailable', 'text/html')
			}
			return send(200, description())
		}
		// UPnP status information is off on this box, as it is by default on many.
		if (url.pathname === '/igddesc.xml') return send(404, '<h1>Not Found</h1>', 'text/html')
		if (url.pathname === '/devicehostlist.lua') return send(200, hostList(state.hosts))

		if (url.pathname.startsWith('/upnp/control/')) {
			const action = /#(\w[\w-]*)"/.exec(req.headers.soapaction ?? '')?.[1] ?? ''
			state.soapCalls.push(action)
			if (action !== 'GetSecurityPort' && !digestOk(req)) return challenge()
			const args = {}
			for (const m of body.matchAll(/<(New[\w-]+)>([\s\S]*?)<\/\1>/g))
				args[m[1]] = m[2]
					.replace(/&lt;/g, '<')
					.replace(/&gt;/g, '>')
					.replace(/&quot;/g, '"')
					.replace(/&apos;/g, "'")
					.replace(/&amp;/g, '&')
			const result = soap(url.pathname, action, args)
			if (!result) return send(500, soapFault(401, 'Invalid Action'))
			return send(200, soapResult(action, result))
		}

		if (url.pathname === '/login_sid.lua') {
			if (req.method === 'GET') return send(200, sessionInfo('0000000000000000'))
			const form = new URLSearchParams(body)
			if (form.has('logout')) {
				state.sids.delete(form.get('sid'))
				return send(200, sessionInfo('0000000000000000'))
			}
			state.loginAttempts++
			if (form.get('username') === USER && form.get('response') === expectedResponse()) {
				const sid = randomBytes(8).toString('hex')
				state.sids.add(sid)
				return send(200, sessionInfo(sid))
			}
			return send(200, sessionInfo('0000000000000000'))
		}

		if (url.pathname === '/webservices/homeautoswitch.lua') {
			if (!state.aha) return send(404, 'Not Found', 'text/html')
			// AHA takes the session id as a query parameter and answers a bad one with 403.
			if (!state.sids.has(url.searchParams.get('sid'))) return send(403, 'Forbidden', 'text/plain')
			const answer = ahaCommand(state.ahaState, url.searchParams)
			if (answer === undefined) return send(400, 'Bad Request', 'text/plain')
			return send(200, answer, answer.startsWith('<') ? 'text/xml' : 'text/plain; charset=utf-8')
		}

		if (url.pathname.startsWith('/api/v0/smarthome/')) {
			if (!state.smartHome) return send(404, 'Not Found', 'text/html')
			const sid = /^AVM-SID ([0-9a-f]{16})$/.exec(req.headers.authorization ?? '')?.[1]
			if (!sid || !state.sids.has(sid)) {
				return send(401, JSON.stringify({ errors: [{ code: 3001, message: 'no permission' }] }), 'application/json')
			}
			const path = url.pathname.slice('/api/v0/smarthome'.length)
			if (req.method === 'GET' && path === '/overview') {
				return send(200, JSON.stringify(state.overview), 'application/json')
			}
			const unitMatch = /^\/overview\/units\/(.+)$/.exec(path)
			if (req.method === 'PUT' && unitMatch) {
				const uid = decodeURIComponent(unitMatch[1])
				const unit = state.overview.units.find((u) => u.UID === uid)
				if (!unit) return send(404, JSON.stringify({ errors: [{ code: 2001, message: 'UID not found' }] }))
				const update = JSON.parse(body).interfaces
				state.puts.push({ uid, update })
				for (const [key, value] of Object.entries(update)) {
					unit.interfaces[key] = { ...unit.interfaces[key], ...value }
				}
				return send(200, '', 'application/json')
			}
			const templateMatch = /^\/overview\/templates\/(.+)$/.exec(path)
			if (req.method === 'POST' && templateMatch) {
				state.templatesApplied.push(decodeURIComponent(templateMatch[1]))
				return send(200, '', 'application/json')
			}
			return send(404, JSON.stringify({ errors: [{ code: 3002, message: 'bad path' }] }), 'application/json')
		}

		send(404, 'Not Found', 'text/html')
	}

	const server = remote
		? https.createServer(
				{
					key: readFileSync(new URL('fixtures/test-key.pem', import.meta.url)),
					cert: readFileSync(new URL('fixtures/test-cert.pem', import.meta.url)),
				},
				handler,
			)
		: http.createServer(handler)

	// A fixed port lets a test bring "the same box" back after it went away.
	await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve))
	return {
		port: server.address().port,
		state,
		close: () =>
			new Promise((resolve) => {
				server.close(resolve)
				server.closeAllConnections()
			}),
	}
}

// Checks of the pure building blocks: login hashing, digest, parsers and the smart home helpers.
const D = '../dist'
const { pbkdf2Response, md5Response, parseSessionInfo } = await import(`${D}/session.js`)
const { digestAuthorization, parseDigestChallenge, parseServices, parseSoapResponse, soapEnvelope } = await import(
	`${D}/tr064.js`
)
const { parseHostList, findHost, firstOfList, bandLabel, normaliseMac } = await import(`${D}/router.js`)
const { slug, assignNamePrefixes, unitValues, createSmartHomeState, UNIT_SUFFIXES, findUnit, reading } = await import(
	`${D}/shstate.js`
)
const { adjust, clampSetPoint, resolveSwitch, endTimeIn } = await import(`${D}/actions.js`)
const { compare, alertMatches, wlanEnabled } = await import(`${D}/feedbacks.js`)
const { routerVariableValues, formatUptime } = await import(`${D}/variables.js`)
const { describeErrors } = await import(`${D}/smarthome.js`)
const { parseAddress, isHomeNetworkHost, webUrlFor } = await import(`${D}/config.js`)
const { tr064Routes } = await import(`${D}/main.js`)
const { listFilePath, connectedProvider, randomWlanPassword, wlanPasswordProblem, wlanSsidProblem } = await import(
	`${D}/router.js`
)
const { hasMobileHardware, mobileConnected } = await import(`${D}/router.js`)
const { diagnosticsUrl } = await import(`${D}/actions.js`)
const { parseXml, child, childText } = await import(`${D}/xml.js`)
const { mapAha, ahaSetPoint, ahaSetPointParam } = await import(`${D}/aha.js`)
const { ahaDeviceList, ahaTemplateList, ahaTriggerList, initialAhaState } = await import('./aha-fixture.mjs')
const { Anonymizer, scrubPath, reportFileName, ExchangeLog } = await import(`${D}/diagnostics.js`)
const { wlanKeys, hasWan2, accessTypeLabel } = await import(`${D}/variables.js`)
const { initialOverview } = await import('./fakebox.mjs')

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}
const eq = (name, actual, expected) =>
	check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}`)

// --- Login: the test vectors from the AVM Session-ID document ---
eq(
	'PBKDF2 response matches the AVM example',
	await pbkdf2Response('2$10000$5A1711$2000$5A1722', '1example!'),
	'5A1722$1798a1672bca7c6463d6b245f82b53703b0f50813401b03e4045a5861e689adb',
)
eq('MD5 response matches the AVM example', md5Response('1234567z', 'äbc'), '1234567z-9e224a41eeefa284df7bb0f26c2913e2')
const info = parseSessionInfo(
	'<SessionInfo><SID>8b4994376ab804ca</SID><Challenge>a0fa42bb</Challenge><BlockTime>4</BlockTime>' +
		'<Rights><Name>NAS</Name><Access>2</Access><Name>HomeAuto</Name><Access>1</Access></Rights></SessionInfo>',
)
eq('session info is parsed', info, {
	sid: '8b4994376ab804ca',
	challenge: 'a0fa42bb',
	blockTime: 4,
	rights: { NAS: 2, HomeAuto: 1 },
})

// --- Digest: the worked example of RFC 2617 section 3.5 ---
const challenge = parseDigestChallenge(
	'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", ' +
		'opaque="5ccc069c403ebaf9f0171e9517f40e41"',
)
const header = digestAuthorization(challenge, 'Mufasa', 'Circle Of Life', 'GET', '/dir/index.html', '0a4f113b')
check('digest response matches RFC 2617', header.includes('response="6629fae49393a05397450978507c4ef1"'), header)
check('digest carries nc and opaque', header.includes('nc=00000001') && header.includes('opaque="5ccc069c'))
digestAuthorization(challenge, 'Mufasa', 'Circle Of Life', 'GET', '/dir/index.html', 'x')
check('nonce count rises on reuse', challenge.count === 2)
check('a non-digest header is ignored', parseDigestChallenge('Basic realm="x"') === undefined)

// --- SOAP ---
const services = parseServices(
	'<root><serviceList><service><serviceType>urn:dslforum-org:service:WLANConfiguration:1</serviceType>' +
		'<serviceId>urn:WLANConfiguration-com:serviceId:WLANConfiguration2</serviceId>' +
		'<controlURL>/upnp/control/wlanconfig2</controlURL></service></serviceList></root>',
)
eq('services are read with their short id', services, [
	{
		serviceType: 'urn:dslforum-org:service:WLANConfiguration:1',
		id: 'WLANConfiguration2',
		controlUrl: '/upnp/control/wlanconfig2',
	},
])
eq(
	'SOAP outputs are read and decoded',
	parseSoapResponse(
		'<u:XResponse><NewSSID>A &amp; B</NewSSID><NewX_AVM-DE_APType>guest</NewX_AVM-DE_APType><NewEmpty/></u:XResponse>',
	),
	{ NewSSID: 'A & B', 'NewX_AVM-DE_APType': 'guest', NewEmpty: '' },
)
check(
	'SOAP arguments are escaped',
	soapEnvelope('urn:x', 'Do', { NewName: '<a&b>' }).includes('<NewName>&lt;a&amp;b&gt;</NewName>'),
)

// --- Router helpers ---
const hosts = parseHostList(
	'<List><Item><MACAddress>aa:bb:cc:00:00:01</MACAddress><IPAddress>10.0.0.2</IPAddress><Active>1</Active>' +
		'<HostName>pc</HostName><X_AVM-DE_URLParameter></X_AVM-DE_URLParameters></Item>' +
		'<Item><MACAddress>AA:BB:CC:00:00:02</MACAddress><Active>0</Active><HostName>x</HostName>' +
		'<X_AVM-DE_FriendlyName>Tablet</X_AVM-DE_FriendlyName></Item></List>',
)
check('host list survives a mismatched tag', hosts.length === 2 && hosts[0].active && hosts[0].name === 'pc')
check('friendly name wins over host name', hosts[1].name === 'Tablet')
check('host found by any MAC spelling', findHost(hosts, 'aabb.cc00.0001')?.ip === '10.0.0.2')
check('host found by name, ignoring case', findHost(hosts, 'tablet')?.mac === 'AA:BB:CC:00:00:02')
check('host found by IP', findHost(hosts, '10.0.0.2')?.name === 'pc')
check('unknown host is undefined', findHost(hosts, 'nope') === undefined)
eq('MAC is normalised', normaliseMac('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF')
eq('online monitor takes the newest sample', firstOfList('1250,10,20'), 1250)
eq(
	'bands from the band field',
	[bandLabel('2400', 0), bandLabel('5000', 0), bandLabel('6000', 0)],
	['2.4 GHz', '5 GHz', '6 GHz'],
)
eq(
	'bands from the channel on old firmware',
	[bandLabel(undefined, 11), bandLabel('', 100), bandLabel('', 0)],
	['2.4 GHz', '5 GHz', ''],
)

// --- Smart home helpers ---
eq('slug keeps ids readable', slug('Steckdose Büro / Größe 2'), 'steckdose_buero_groesse_2')
eq('slug of a UID with spaces', slug('13077 0137031-1'), '13077_0137031_1')

const units = [
	{ UID: '1', name: 'Lampe', interfaces: {} },
	{ UID: '2', name: 'Lampe', interfaces: {} },
	{ UID: '3', name: 'Küche', interfaces: {} },
]
const prefixes = assignNamePrefixes(units)
check('shared names get no alias', !prefixes.has('1') && !prefixes.has('2'))
eq('unique names get an alias', prefixes.get('3'), 'smarthome_kueche')

for (const a of UNIT_SUFFIXES) {
	for (const b of UNIT_SUFFIXES) {
		if (a !== b && a.suffix.endsWith(`_${b.suffix}`)) check(`suffix ${a.suffix} does not end in _${b.suffix}`, false)
	}
}
check('no suffix ends in another suffix', true)

const sh = createSmartHomeState()
sh.available = true
sh.overview = initialOverview()
const plug = findUnit(sh, '11630 0015376')
const values = unitValues(sh, plug)
eq(
	'plug values are scaled',
	[values.on, values.power, values.energy, values.voltage, values.current],
	['false', 123.45, 15.32, 230.1, 0.54],
)
check('plug has no thermostat variables', !('setpoint' in values))
const window = unitValues(sh, findUnit(sh, 'fenster saal'))
eq('window contact values, found by name', [window.alert, window.battery, window.battery_low], ['open', 10, 'true'])
eq('setpoint reading', reading(sh, findUnit(sh, '09995 0123456'), 'setpoint'), 21)
sh.overview.units[0].interfaces.onOffInterface.state = 'notConnected'
eq('values of an invalid interface are blank', unitValues(sh, plug).on, '')

// --- Actions ---
eq('toggle flips', [resolveSwitch('toggle', true), resolveSwitch('toggle', false)], [false, true])
eq('toggle of unknown state is refused', resolveSwitch('toggle', undefined), undefined)
eq(
	'adjust clamps',
	[adjust('increase', 95, 10, 0, 100), adjust('decrease', 5, 10, 0, 100), adjust('set', 0, 50, 0, 100)],
	[100, 0, 50],
)
eq('relative adjust needs a current value', adjust('increase', undefined, 1, 0, 100), undefined)
eq(
	'setpoint rounds to half degrees and clamps',
	[clampSetPoint(21.3), clampSetPoint(5), clampSetPoint(40)],
	[21.5, 8, 28],
)
eq('boost end time', endTimeIn(30, 1_000_000_000_000), 1_000_000_000 + 1800)
eq('boost end time is capped at four hours', endTimeIn(10_000, 0), 240 * 60)

// --- Feedbacks ---
eq('compare', [compare(5, 'above', 4), compare(5, 'below', 4), compare(undefined, 'above', 0)], [true, false, false])
eq('alerts: any ignores closed', [alertMatches(['closed'], 'any'), alertMatches(['open'], 'any')], [false, true])
const router = {
	wlans: [
		{ serviceId: 'WLANConfiguration1', enabled: true, guest: false },
		{ serviceId: 'WLANConfiguration3', enabled: false, guest: true },
	],
}
eq(
	'wlan feedback',
	[wlanEnabled(router, 'guest'), wlanEnabled(router, 'any'), wlanEnabled(router, 'WLANConfiguration1')],
	[false, true, true],
)

// --- Variables ---
eq('uptime format', [formatUptime(59), formatUptime(90061)], ['00:00:59', '1d 01:01:01'])
const routerValues = routerVariableValues(
	{
		model: 'FRITZ!Box',
		firmware: '',
		serial: '',
		uptimeSeconds: 100,
		uptimeReadAt: 0,
		accessType: 'DSL',
		physicalLinkStatus: 'Up',
		lineDownstream: 116_790_000,
		lineUpstream: undefined,
		connectionService: undefined,
		connectionStatus: 'Connected',
		connectionUptime: undefined,
		lastConnectionError: '',
		externalIpv4: '',
		externalIpv6: '',
		ipv6Prefix: '',
		rateDown: 1_250_000,
		rateUp: undefined,
		dsl: undefined,
		wlans: [],
		hosts: undefined,
	},
	10_000,
)
eq(
	'router values are converted',
	[
		routerValues.device_uptime_seconds,
		routerValues.connection_wan1_line_down_mbit,
		routerValues.connection_wan1_rate_down_mbit,
		routerValues.connection_wan1_rate_down_kbyte,
		routerValues.lan_hosts_active,
	],
	[110, 116.8, 10, 1250, ''],
)

// --- REST errors ---
eq('REST error bodies are summarised', describeErrors('{"errors":[{"code":2001,"message":"UID not found"}]}'), {
	codes: [2001],
	text: '2001 UID not found',
})

// --- Addresses ---
eq('MyFRITZ! address', parseAddress('https://au91ljzqvowe5ljt.myfritz.net:43167'), {
	host: 'au91ljzqvowe5ljt.myfritz.net',
	https: true,
	port: 43167,
	homeNetwork: false,
})
eq('bare IP uses HTTP on port 80', parseAddress('192.168.2.1'), {
	host: '192.168.2.1',
	https: false,
	port: 80,
	homeNetwork: true,
})
eq('https without port uses 443', parseAddress('https://x.myfritz.net/').port, 443)
eq('scheme and name are case-insensitive, paths ignored', parseAddress(' HTTP://Fritz.Box/x?y=1 '), {
	host: 'fritz.box',
	https: false,
	port: 80,
	homeNetwork: true,
})
eq('name with port', parseAddress('box.example.org:8080').port, 8080)
eq('bare IPv6', parseAddress('fd00::1')?.host, 'fd00::1')
eq(
	'bracketed IPv6 with port',
	[parseAddress('[2001:db8::1]:8080')?.host, parseAddress('[2001:db8::1]:8080')?.port],
	['2001:db8::1', 8080],
)
eq('IPv6 URL', webUrlFor(parseAddress('https://[2001:db8::1]:43167/')), 'https://[2001:db8::1]:43167')
eq('other schemes are no address', parseAddress('ftp://x.de'), undefined)
eq('text with spaces is no address', parseAddress('my box'), undefined)
eq('port out of range', parseAddress('box:70000'), undefined)
eq('webUrl drops the default port', webUrlFor(parseAddress('https://x.myfritz.net:443')), 'https://x.myfritz.net')
eq(
	'webUrl keeps another port',
	webUrlFor(parseAddress('https://au91ljzqvowe5ljt.myfritz.net:43167')),
	'https://au91ljzqvowe5ljt.myfritz.net:43167',
)

eq(
	'home network hosts',
	['192.168.178.1', '10.1.2.3', '172.20.0.1', '100.98.39.102', 'fritz.box', 'fritzbox', 'fd00::1', 'fe80::1'].map((h) =>
		isHomeNetworkHost(h),
	),
	[true, true, true, true, true, true, true, true],
)
eq(
	'internet hosts',
	['au91ljzqvowe5ljt.myfritz.net', '203.0.113.7', '172.32.0.1', 'box.example.org', '2001:db8::1'].map((h) =>
		isHomeNetworkHost(h),
	),
	[false, false, false, false, false],
)

eq('MyFRITZ! tries the remote route first', tr064Routes(parseAddress('https://au91ljzqvowe5ljt.myfritz.net:43167')), [
	'web-port',
	'own-port',
])
eq('local HTTPS tries the own port first', tr064Routes(parseAddress('https://192.168.178.1')), ['own-port', 'web-port'])
eq('plain HTTP only has the own port', tr064Routes(parseAddress('192.168.2.1')), ['own-port'])

eq(
	'list file from a full URL',
	listFilePath('https://x.myfritz.net:488/tr064/devicehostlist.lua?sid=1'),
	'/tr064/devicehostlist.lua?sid=1',
)
eq('list file from a relative path', listFilePath('devicehostlist.lua?sid=1'), '/devicehostlist.lua?sid=1')

// --- Variable structure ---
const keys = wlanKeys([
	{ serviceId: 'W1', index: 1, band: '2.4 GHz', guest: false },
	{ serviceId: 'W2', index: 2, band: '5 GHz', guest: false },
	{ serviceId: 'W3', index: 3, band: '5 GHz', guest: false },
	{ serviceId: 'W4', index: 4, band: '2.4 GHz', guest: true },
	{ serviceId: 'W5', index: 5, band: '', guest: false },
])
eq('WLAN keys by band', [...keys.values()], ['24ghz', '5ghz', '5ghz_2', 'guest', '5'])
eq('a mobile stick beside DSL is WAN 2', hasWan2({ accessType: 'DSL', mobile: { enabled: true } }), true)
eq('an LTE box has no WAN 2', hasWan2({ accessType: 'X_AVM-DE_LTE', mobile: { enabled: true } }), false)
eq('no mobile service, no WAN 2', hasWan2({ accessType: 'DSL', mobile: undefined }), false)
eq('access types without the vendor prefix', accessTypeLabel('X_AVM-DE_Fiber'), 'Fiber')
eq(
	'provider of the connected cell',
	connectedProvider(
		'<Cell><Connected>none</Connected><Provider>A</Provider></Cell><Cell><Connected>primary</Connected><Provider>B &amp; C</Provider></Cell>',
	),
	'B & C',
)

// --- Diagnostics ---
const anon = new Anonymizer([
	{ kind: 'HOST', value: 'au91ljzqvowe5ljt.myfritz.net' },
	{ kind: 'USER', value: 'companion' },
])
const masked = anon.value({
	NewSSID: 'Studio',
	NewBSSID: '3C:A6:2F:00:00:01',
	NewExternalIPAddress: '203.0.113.7',
	NewSerialNumber: '3810D5000001',
	NewPPPUsername: 'h12345@t-online.de',
	NewPINFailureCount: '0',
	NewMACAddressControlEnabled: '0',
	message: 'Login as "companion" refused at https://au91ljzqvowe5ljt.myfritz.net:43167 from 192.168.178.20 (fd00::1)',
	units: [{ name: 'Küche' }, { name: 'Bad' }, { name: 'Küche' }],
	celsius: 21.5,
})
eq(
	'sensitive keys get placeholders',
	[masked.NewSSID, masked.NewBSSID, masked.NewSerialNumber, masked.NewPPPUsername],
	['SSID#1', 'SSID#2', 'ID#1', 'USER#1'],
)
eq('IP addresses are masked by pattern', masked.NewExternalIPAddress, 'IP#1')
eq('counts and flags are kept', [masked.NewPINFailureCount, masked.NewMACAddressControlEnabled], ['0', '0'])
eq('free text is masked', masked.message, 'Login as "USER#2" refused at https://HOST#1:43167 from IPv4#1 (IPv6#1)')
eq(
	'the same value keeps its placeholder',
	masked.units.map((unit) => unit.name),
	['NAME#1', 'NAME#2', 'NAME#1'],
)
eq('numbers stay numbers', masked.celsius, 21.5)
eq(
	'session ids are scrubbed from paths',
	scrubPath('/devicehostlist.lua?sid=0123456789abcdef&x=1'),
	'/devicehostlist.lua?sid=***&x=1',
)
eq('report file name', reportFileName(new Date(2026, 9, 12, 8, 5, 3)), 'fritzbox-diagnostics-2026-10-12_08-05-03.json')
const exchanges = new ExchangeLog(3)
for (let i = 0; i < 5; i++) exchanges.add({ time: '', method: 'GET', target: `/x?sid=${i}abc`, ms: i })
eq(
	'the request log keeps only the newest entries, scrubbed',
	exchanges.entries().map((e) => e.target),
	['/x?sid=***', '/x?sid=***', '/x?sid=***'],
)
eq(
	'the request log drops the oldest',
	exchanges.entries().map((e) => e.ms),
	[2, 3, 4],
)

// --- WLAN passwords and names ---
eq(
	'random password length is kept in range',
	[randomWlanPassword(4).length, randomWlanPassword(12).length, randomWlanPassword(99).length],
	[8, 12, 63],
)
check('random passwords avoid look-alike characters', !/[0O1lI]/.test(randomWlanPassword(63)))
eq(
	'password rules',
	[wlanPasswordProblem('1234567'), wlanPasswordProblem('12345678'), wlanPasswordProblem('Passwört-123')],
	['at least 8 characters are needed', undefined, 'only printable ASCII characters are allowed, no umlauts'],
)
eq(
	'SSID rules',
	[wlanSsidProblem(''), wlanSsidProblem('Event Gast'), wlanSsidProblem('x'.repeat(33))],
	['the name must not be empty', undefined, 'at most 32 bytes are allowed'],
)

// --- Findings from a real FRITZ!Box 6660 Cable ---
const noStick = {
	enabled: true,
	simStatus: 'factory default',
	technology: 'unknown',
	roaming: false,
	signalRsrp: undefined,
	provider: '',
	uptime: 292838,
}
eq('a box without a mobile stick has no mobile connection', hasMobileHardware(noStick), false)
eq('a SIM that is ready counts', hasMobileHardware({ ...noStick, simStatus: 'PIN successful' }), true)
eq('a technology in use counts', hasMobileHardware({ ...noStick, technology: 'LTE' }), true)
eq(
	'connected needs a technology, not just uptime',
	[mobileConnected(noStick), mobileConnected({ ...noStick, technology: 'LTE' })],
	[false, true],
)

eq(
	'diagnostics link from the binding',
	diagnosticsUrl('192.168.20.100', '', '8000', '/instance/FRITZ_Box/diagnostics'),
	'http://192.168.20.100:8000/instance/FRITZ_Box/diagnostics',
)
eq(
	'bound to all interfaces: first real address',
	diagnosticsUrl('0.0.0.0', '127.0.0.1\\n192.168.20.100\\n172.30.64.1', '8888', '/x'),
	'http://192.168.20.100:8888/x',
)
eq(
	'real line breaks work as well',
	diagnosticsUrl('0.0.0.0', '127.0.0.1\n10.0.0.5', '8000', '/x'),
	'http://10.0.0.5:8000/x',
)
eq(
	'unresolved variables fall back',
	diagnosticsUrl('$(internal:bind_ip)', '', '$(internal:bind_port)', '/x'),
	'http://127.0.0.1:8000/x',
)

// --- XML parser ---
const doc = parseXml(
	'<?xml version="1.0"?><!-- c --><a x="1" y=\'2\'><b>T &amp; U</b><c/><d><![CDATA[<raw>]]></d><e>x</f></e><g>after</g></a>',
)
const a = child(doc, 'a')
eq('attributes in both quote styles', a?.attributes, { x: '1', y: '2' })
eq('text with entities', childText(a, 'b'), 'T & U')
eq('self-closing element', child(a, 'c')?.children.length, 0)
eq('CDATA', childText(a, 'd'), '<raw>')
eq('a stray closing tag is ignored', childText(a, 'g'), 'after')

// --- AHA mapping ---
eq(
	'AHA setpoints',
	[ahaSetPoint(42), ahaSetPoint(253), ahaSetPoint(254), ahaSetPoint(undefined)],
	[{ mode: 'temperature', celsius: 21 }, { mode: 'off' }, { mode: 'on' }, { mode: 'unknown' }],
)
eq(
	'AHA setpoint parameters',
	[
		ahaSetPointParam({ mode: 'temperature', celsius: 21.5 }),
		ahaSetPointParam({ mode: 'off' }),
		ahaSetPointParam({ mode: 'temperature', celsius: 40 }),
	],
	[43, 253, 56],
)
const aha = mapAha(ahaDeviceList(initialAhaState()), ahaTemplateList(), ahaTriggerList(initialAhaState()))
const ahaUnit = (uid) => aha.overview.units.find((unit) => unit.UID === uid)
eq('AHA devices: HAN-FUN parents are devices, not units', aha.overview.devices.map((d) => d.UID).sort(), [
	'08761 0000434',
	'09995 0123456',
	'09995 1040598',
	'11934 0059978',
	'13077 0000060',
])
eq(
	'HAN-FUN unit belongs to its device',
	[ahaUnit('11934 0059978-1')?.deviceUid, ahaUnit('11934 0059978-1')?.unitType],
	['11934 0059978', 'windowOpenCloseDetector'],
)
eq('the device lists its units', aha.overview.devices.find((d) => d.UID === '11934 0059978')?.unitUids, [
	'11934 0059978-1',
])
eq('window contact open', ahaUnit('11934 0059978-1')?.interfaces.alertInterface?.alerts, ['open'])
eq(
	'socket: values and switch kind',
	[
		ahaUnit('08761 0000434')?.interfaces.multimeterInterface?.voltage,
		ahaUnit('08761 0000434')?.unitType,
		aha.switchKinds.get('08761 0000434'),
	],
	[229512, 'avmPlugSocket', 'switch'],
)
eq('names with entities', ahaUnit('08761 0000434')?.name, 'Beamer & Leinwand')
eq(
	'bulb: simpleonoff, level in percent, colour',
	[
		aha.switchKinds.get('13077 0000060-1'),
		ahaUnit('13077 0000060-1')?.interfaces.levelControlInterface?.level,
		ahaUnit('13077 0000060-1')?.interfaces.colorControlInterface?.hsColor,
	],
	['simpleonoff', 80, { hue: 200, saturation: 180 }],
)
eq(
	'thermostat: real degrees',
	[
		ahaUnit('09995 0123456')?.interfaces.temperatureInterface?.celsius,
		ahaUnit('09995 0123456')?.interfaces.thermostatInterface?.comfortTemperature,
	],
	[19.5, { mode: 'temperature', celsius: 21 }],
)
eq(
	'button unit of the FRITZ!DECT 440',
	[ahaUnit('09995 1040598-1')?.unitType, ahaUnit('09995 1040598-1')?.interfaces.buttonInterface?.lastEventTime],
	['avmButton', 1760001234],
)
eq(
	'group unit with its members',
	[ahaUnit('65:3A:18-900')?.isGroupUnit, aha.overview.groups[0]?.memberUnitUids],
	[true, ['08761 0000434']],
)
eq(
	'templates: scenario and automatic flag',
	aha.overview.templates.map((t) => [t.UID, t.template?.isAutoCreated, Boolean(t.scenario)]),
	[
		['tmp653A18-38AE7FDE9', false, false],
		['tmp653A18-AUTO1', true, false],
		['tmpD0EF2E-3CE52B246', false, true],
	],
)
eq('routines', aha.overview.triggers, [{ UID: 'trg695F2D-3CBF1DC25', name: 'Abends aus', enabled: true }])

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

// End-to-end checks: the real module instance against a fake FRITZ!Box, through Companion's
// instance contract. This is the level at which "it connects" can actually be verified.
import { startFakeBox, USER, PASSWORD } from './fakebox.mjs'
const D = '../dist'
const ModuleInstance = (await import(`${D}/main.js`)).default

let failures = 0
const check = (name, cond, detail = '') => {
	if (cond) console.log(`  PASS  ${name}`)
	else {
		failures++
		console.log(`  FAIL  ${name} ${detail}`)
	}
}

const waitFor = async (predicate, what, timeoutMs = 8000) => {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (predicate()) return true
		await new Promise((r) => setTimeout(r, 25))
	}
	console.log(`  (timed out waiting for ${what})`)
	return false
}

/** A stand-in for what Companion hands a module instance. */
function makeContext() {
	const record = {
		statuses: [],
		logs: [],
		variables: {},
		variableDefinitions: {},
		presets: {},
		actions: {},
		feedbacks: {},
		checked: [],
	}
	const context = {
		_isInstanceContext: true,
		id: 'test-instance',
		label: 'fritz',
		upgradeScripts: [],
		saveConfig: () => {},
		updateStatus: (status, message) => record.statuses.push({ status, message }),
		oscSend: () => {},
		recordAction: () => {},
		setActionDefinitions: (actions) => {
			record.actions = actions
		},
		subscribeActions: () => {},
		unsubscribeActions: () => {},
		setFeedbackDefinitions: (feedbacks) => {
			record.feedbacks = feedbacks
		},
		subscribeFeedbacks: () => {},
		unsubscribeFeedbacks: () => {},
		checkFeedbacks: (...ids) => record.checked.push(...ids),
		checkAllFeedbacks: () => {},
		checkFeedbacksById: () => {},
		setPresetDefinitions: (structure, presets) => {
			record.presets = presets
			record.presetStructure = structure
		},
		setVariableDefinitions: (definitions) => {
			record.variableDefinitions = definitions
		},
		setVariableValues: (values) => Object.assign(record.variables, values),
		getVariableValue: (id) => record.variables[id],
		sharedUdpSocketHandlers: new Map(),
	}
	return { context, record }
}

/** Builds an instance with its logging captured, the way Companion would start it. */
async function startInstance(port, overrides = {}, password = PASSWORD) {
	const { context, record } = makeContext()
	const instance = new ModuleInstance(context)
	// The fake box serves TR-064 on its one port instead of 49000.
	const { tr064PlainPort = port, ...config } = overrides
	instance.tr064PlainPort = tr064PlainPort
	instance.log = (level, message) => record.logs.push({ level, message })
	instance.updateStatus = (status, message) => record.statuses.push({ status, message })
	instance.setVariableValues = (values) => Object.assign(record.variables, values)
	instance.setVariableDefinitions = (definitions) => {
		record.variableDefinitions = definitions
	}
	instance.setActionDefinitions = (actions) => {
		record.actions = actions
	}
	instance.setFeedbackDefinitions = (feedbacks) => {
		record.feedbacks = feedbacks
	}
	instance.setPresetDefinitions = (structure, presets) => {
		record.presets = presets
		record.presetStructure = structure
	}
	instance.checkFeedbacks = (...ids) => record.checked.push(...ids)
	Object.defineProperty(instance, 'label', { get: () => 'fritz' })

	await instance.init(
		{
			host: `http://127.0.0.1:${port}`,
			username: USER,
			pollInterval: 60,
			smartHomeInterval: 60,
			...config,
		},
		true,
		{ password },
	)
	return { instance, record }
}

/** Runs a feedback callback the way Companion would. */
const feedback = (record, id, options) => record.feedbacks[id].callback({ id: 'x', feedbackId: id, options })
const runAction = (record, id, options) => record.actions[id].callback({ id: 'x', actionId: id, options })
const lastStatus = (record) => record.statuses.at(-1)

console.log('Router status and smart home against a working box')
{
	const box = await startFakeBox()
	const { instance, record } = await startInstance(box.port)

	await waitFor(() => record.variables.device_connected === 'true', 'router connection')
	// Connected is published after the quick part of a read; the slow part follows.
	await waitFor(() => record.variables.lan_hosts_known === 2, 'slow part of the first read')
	await waitFor(() => record.variables.smarthome_units === 3, 'smart home overview')

	check('status ends up ok', lastStatus(record)?.status === 'ok', JSON.stringify(record.statuses))
	check(
		'model and firmware read',
		record.variables.device_model === 'FRITZ!Box 7590 AX' && record.variables.device_firmware === '256.08.20',
	)
	check(
		'internet connected',
		record.variables.connection_wan1_connected === 'true' && record.variables.connection_wan1_status === 'Connected',
	)
	check('external IPv4 via the PPP service', record.variables.connection_wan1_ipv4 === '203.0.113.7')
	check(
		'throughput from the online monitor',
		record.variables.connection_wan1_rate_down_mbit === 10 && record.variables.connection_wan1_rate_up_mbit === 0.5,
	)
	check('line rate in Mbit/s', record.variables.connection_wan1_line_down_mbit === 116.8)
	check(
		'DSL values scaled',
		record.variables.connection_dsl_snr_down_db === 9.5 && record.variables.connection_dsl_sync_down_mbit === 116.8,
	)
	check(
		'WLAN instances read',
		record.variables.wlan_5ghz_ssid === 'Studio 5' && record.variables.wlan_5ghz_band === '5 GHz',
	)
	check(
		'guest WLAN detected',
		record.variables.wlan_guest_ssid === 'Gäste & Co' && record.variables.wlan_guest_enabled === 'false',
	)
	check('WLAN clients summed', record.variables.wlan_clients_total === 10)
	check('hosts counted', record.variables.lan_hosts_active === 1 && record.variables.lan_hosts_known === 2)
	check('IPv6 stays empty without UPnP status', record.variables.connection_wan1_ipv6 === '')
	check('missing IGD is not an error', !record.logs.some((l) => l.level === 'error'), JSON.stringify(record.logs))
	check(
		'mobile stick is WAN 2',
		record.variables.connection_wan2_type === 'Mobile' && record.variables.connection_wan2_connected === 'true',
	)
	check(
		'mobile details',
		record.variables.connection_mobile_technology === 'LTE' &&
			record.variables.connection_mobile_signal_rsrp === -97 &&
			record.variables.connection_mobile_provider === 'Vodafone',
	)
	check(
		'fibre optical power in dBm',
		record.variables.connection_fiber_rx_power_dbm === -18.45 && record.variables.connection_fiber_mode === 'XGSPON',
	)
	check('cable DVB-C', record.variables.connection_cable_dvbc_enabled === 'true')
	check(
		'optional groups are defined',
		'connection_dsl_status' in record.variableDefinitions && 'connection_wan2_type' in record.variableDefinitions,
	)
	check('WAN 1 type is readable', record.variables.connection_wan1_type === 'DSL')
	check('uptime published', record.variables.device_uptime_seconds >= 3725)

	check('variables per unit by UID', record.variables['smarthome_11630_0015376_power'] === 123.45)
	check('variables per unit by name', record.variables.smarthome_steckdose_regie_on === 'false')
	check('thermostat variables', record.variables.smarthome_heizung_saal_setpoint === 21)
	check('unit variables are defined', 'smarthome_fenster_saal_alert' in record.variableDefinitions)
	check('WLAN variables are defined', 'wlan_guest_ssid' in record.variableDefinitions)

	check('feedback: internet connected', feedback(record, 'internet_connected', {}) === true)
	check('feedback: guest WLAN off', feedback(record, 'wlan_enabled', { wlan: 'guest' }) === false)
	check('feedback: host active by name', feedback(record, 'host_active', { host: 'playout-pc' }) === true)
	check('feedback: host inactive by MAC', feedback(record, 'host_active', { host: 'aa:bb:cc:00:00:02' }) === false)
	check(
		'feedback: throughput above 5 Mbit/s',
		feedback(record, 'throughput', { direction: 'down', comparison: 'above', mbit: 5 }) === true,
	)
	check('feedback: window open', feedback(record, 'sh_alert', { unit: '13077 0137031-1', alert: 'open' }) === true)
	check('feedback: battery low', feedback(record, 'sh_battery_low', { unit: '13077 0137031-1' }) === true)
	check(
		'feedback: power reading',
		feedback(record, 'sh_reading', { unit: '11630 0015376', reading: 'power', comparison: 'above', value: 100 }) ===
			true,
	)
	check(
		'feedback: routine enabled',
		feedback(record, 'sh_trigger_enabled', { trigger: 'trg9D4BAB-3FC9C824E' }) === true,
	)
	check('feedback: routine by its name', feedback(record, 'sh_trigger_enabled', { trigger: 'Abends aus' }) === true)

	const unitChoices = record.actions.sh_switch.options[0].choices.map((c) => c.id)
	check('switch action lists only switchable units', unitChoices.length === 1 && unitChoices[0] === '11630 0015376')
	const templateChoices = record.actions.sh_apply_template.options[0].choices.map((c) => c.id)
	check(
		'auto-created templates are hidden',
		templateChoices.length === 1 && templateChoices[0] === 'tmp9D4BAB-3F42B59F6',
	)
	check(
		'presets for units exist',
		'sh_11630_0015376_toggle' in record.presets && 'sh_09995_0123456_thermostat' in record.presets,
	)
	check(
		'presets reference the label',
		record.presets.status_internet.style.text.includes('$(fritz:connection_wan1_status)'),
	)

	// Toggle the socket: the module reads the cached state and writes the opposite.
	await runAction(record, 'sh_switch', { unit: '11630 0015376', mode: 'toggle' })
	check(
		'toggle sends on',
		box.state.puts.at(-1)?.uid === '11630 0015376' && box.state.puts.at(-1)?.update.onOffInterface?.active === true,
		JSON.stringify(box.state.puts),
	)
	await waitFor(
		() => record.variables.smarthome_steckdose_regie_on === 'true',
		'state read back after the action',
		3000,
	)
	check('state is read back after an action', record.variables.smarthome_steckdose_regie_on === 'true')
	check('feedback follows', feedback(record, 'sh_on', { unit: '11630 0015376' }) === true)

	await runAction(record, 'sh_setpoint', { unit: 'Heizung Saal', mode: 'increase', value: 0.5 })
	const setPoint = box.state.puts.at(-1)?.update.thermostatInterface?.setPointTemperature
	check(
		'setpoint raised by half a degree',
		setPoint?.mode === 'temperature' && setPoint?.celsius === 21.5,
		JSON.stringify(setPoint),
	)

	await runAction(record, 'sh_setpoint', { unit: '09995 0123456', mode: 'off', value: 0 })
	check('thermostat off', box.state.puts.at(-1)?.update.thermostatInterface?.setPointTemperature?.mode === 'off')

	await runAction(record, 'sh_boost', { unit: '09995 0123456', mode: 'on', minutes: 15 })
	const boost = box.state.puts.at(-1)?.update.thermostatInterface?.boost
	const expectedEnd = Math.floor(Date.now() / 1000) + 900
	check(
		'boost with end time',
		boost?.enabled === true && Math.abs(boost.endTime - expectedEnd) <= 2,
		JSON.stringify(boost),
	)

	await runAction(record, 'sh_apply_template', { template: 'tmp9D4BAB-3F42B59F6' })
	check('template applied', box.state.templatesApplied.at(-1) === 'tmp9D4BAB-3F42B59F6')
	box.state.templatesApplied.length = 0
	await runAction(record, 'sh_apply_template', { template: 'alles aus' })
	check('template applied by its name', box.state.templatesApplied.at(-1) === 'tmp9D4BAB-3F42B59F6')

	const putsBefore = box.state.puts.length
	await runAction(record, 'sh_switch', { unit: 'does-not-exist', mode: 'on' })
	check('unknown unit is not sent', box.state.puts.length === putsBefore)
	check(
		'unknown unit is logged',
		record.logs.some((l) => l.level === 'warn' && l.message.includes('does-not-exist')),
	)

	// WLAN: passwords readable, switching, new passwords and names.
	check(
		'WLAN passwords are variables',
		record.variables.wlan_guest_password === 'welcome2026' && record.variables.wlan_5ghz_password === 'studio-secret-5',
	)
	check('WLAN button state', record.variables.wlan_enabled === 'true')
	check(
		'guest auto off',
		record.variables.wlan_guest_auto_off === 'true' && record.variables.wlan_guest_auto_off_remaining === '90',
	)
	await runAction(record, 'wlan_switch', { wlan: 'guest', mode: 'toggle' })
	check('guest WLAN switched on', box.state.wlans['/upnp/control/wlanconfig3'].enable === 1)
	await waitFor(() => record.variables.wlan_guest_enabled === 'true', 'guest WLAN state read back', 4000)
	check('guest WLAN feedback follows', feedback(record, 'wlan_enabled', { wlan: 'guest' }) === true)
	await runAction(record, 'wlan_switch', { wlan: 'all', mode: 'off' })
	check('all WLAN off like the button', box.state.wlanGlobal === 0)
	await runAction(record, 'wlan_password', { wlan: 'guest', mode: 'set', password: 'Neues-Passwort-1', length: 12 })
	check('guest password set', box.state.wlans['/upnp/control/wlanconfig3'].key === 'Neues-Passwort-1')
	await runAction(record, 'wlan_password', { wlan: 'guest', mode: 'random', password: '', length: 14 })
	const generated = box.state.wlans['/upnp/control/wlanconfig3'].key
	check('random guest password', /^[a-km-zA-HJ-NP-Z2-9]{14}$/.test(generated), generated)
	await waitFor(() => record.variables.wlan_guest_password === generated, 'new password read back', 4000)
	check('the new password shows up in the variable', record.variables.wlan_guest_password === generated)
	const keyBefore = box.state.wlans['/upnp/control/wlanconfig3'].key
	await runAction(record, 'wlan_password', { wlan: 'guest', mode: 'set', password: 'kurz', length: 12 })
	check(
		'a too short password is refused before it reaches the box',
		box.state.wlans['/upnp/control/wlanconfig3'].key === keyBefore &&
			record.logs.some((l) => l.level === 'warn' && /at least 8/.test(l.message)),
	)
	await runAction(record, 'wlan_ssid', { wlan: 'guest', ssid: 'Event Gast' })
	check('guest WLAN renamed', box.state.wlans['/upnp/control/wlanconfig3'].ssid === 'Event Gast')
	const wlanIds = record.actions.wlan_switch.options[0].choices.map((c) => c.id)
	check('WLAN choices are the band keys of the variables', wlanIds.includes('5ghz'), JSON.stringify(wlanIds))
	await runAction(record, 'wlan_ssid', { wlan: '5ghz', ssid: 'Event 5' })
	check('a WLAN named by its band key', box.state.wlans['/upnp/control/wlanconfig2'].ssid === 'Event 5')
	await runAction(record, 'wlan_ssid', { wlan: 'WLANConfiguration2', ssid: 'Event 5b' })
	check('a WLAN named by its service id still works', box.state.wlans['/upnp/control/wlanconfig2'].ssid === 'Event 5b')

	// Devices: Wake on LAN and internet block, chosen from the device list.
	const deviceChoices = record.actions.host_wake.options[0].choices.map((c) => c.id)
	check(
		'device list comes from the box',
		deviceChoices.includes('AA:BB:CC:00:00:01') && deviceChoices.includes('AA:BB:CC:00:00:02'),
	)
	check(
		'device field also takes an address, a name or an expression',
		record.actions.host_wake.options[0].allowCustom === true,
	)
	await runAction(record, 'host_wake', { host: 'AA:BB:CC:00:00:02' })
	check('Wake on LAN sent for the tablet', box.state.woken.at(-1) === 'AA:BB:CC:00:00:02')
	await runAction(record, 'host_internet', { host: 'AA:BB:CC:00:00:01', mode: 'block' })
	check('internet blocked for the playout PC', box.state.hosts[0].disallow === 1)
	await waitFor(
		() => feedback(record, 'host_blocked', { host: 'playout-pc' }) === true,
		'blocked state read back',
		4000,
	)
	check('blocked feedback follows', feedback(record, 'host_blocked', { host: 'playout-pc' }) === true)
	await runAction(record, 'host_internet', { host: 'AA:BB:CC:00:00:01', mode: 'toggle' })
	check('toggle allows it again', box.state.hosts[0].disallow === 0)
	// The device can also be given by IP address or name, e.g. from an expression.
	await runAction(record, 'host_internet', { host: '192.168.178.20', mode: 'block' })
	check('a device given by its IP address is blocked', box.state.hosts[0].disallow === 1)
	await runAction(record, 'host_internet', { host: 'playout-pc', mode: 'allow' })
	check('a device given by its name is allowed again', box.state.hosts[0].disallow === 0)
	await runAction(record, 'host_wake', { host: 1234 })
	check(
		'a number from an expression is reported, not thrown',
		record.logs.some((l) => l.level === 'warn' && /device "1234" is not known/.test(l.message)),
	)

	// Restart only with the confirmation ticked.
	await runAction(record, 'box_reboot', { confirm: false })
	check(
		'restart without confirmation is refused',
		box.state.reboots === 0 && record.logs.some((l) => l.level === 'warn' && /confirmation/.test(l.message)),
	)
	await runAction(record, 'box_reboot', { confirm: true })
	check('restart with confirmation', box.state.reboots === 1)

	await runAction(record, 'wan_reconnect', {})
	check('reconnect terminates the PPP connection', box.state.reconnects === 1)
	check(
		'reconnect is logged',
		record.logs.some((l) => l.level === 'info' && /Reconnect/.test(l.message)),
	)
	await waitFor(() => record.variables.connection_wan1_ipv4 === '198.51.100.23', 'new IP after the reconnect', 9000)
	check('the new IP address is read after the reconnect', record.variables.connection_wan1_ipv4 === '198.51.100.23')

	// A diagnostics report, as a beta tester would send it in.
	const httpRequest = (path) => ({
		baseUrl: '/instance/fritz',
		headers: {},
		hostname: '127.0.0.1',
		ip: '127.0.0.1',
		method: 'GET',
		originalUrl: `/instance/fritz${path}`,
		path,
		query: {},
	})
	const response = await instance.handleHttpRequest(httpRequest('/diagnostics'))
	check(
		'diagnostics report served as a download',
		response.status === 200 &&
			/^attachment; filename="fritzbox-diagnostics-.*\.json"$/.test(response.headers['Content-Disposition']),
	)
	const reportText = response.body
	const report = JSON.parse(reportText)
	const page = await instance.handleHttpRequest(httpRequest('/'))
	check('a start page links to the report', page.status === 200 && page.body.includes('href="diagnostics"'))
	check('other paths are not found', (await instance.handleHttpRequest(httpRequest('/nope'))).status === 404)
	await runAction(record, 'diagnostics_report', { bindIp: '192.168.20.100', allIp: '', bindPort: '8000' })
	check(
		'the action logs the download address from the binding',
		record.logs.some(
			(l) => l.level === 'info' && l.message.includes('http://192.168.20.100:8000/instance/fritz/diagnostics'),
		),
	)
	check(
		'and puts it in a variable',
		record.variables.device_diagnostics_url === 'http://192.168.20.100:8000/instance/fritz/diagnostics',
	)
	check(
		'report holds the box model and firmware',
		reportText.includes('FRITZ!Box 7590 AX') && reportText.includes('256.08.20'),
	)
	check(
		'report lists the TR-064 services',
		report.tr064.services.some((s) => s.startsWith('X_AVM-DE_WANFiber1')),
	)
	check(
		'report holds raw answers',
		report.tr064.results.some(
			(r) => r.action === 'X_AVM-DE_GetDSLInfo' && r.ok && r.values.NewDownstreamCurrRate === '116790',
		),
	)
	check('report leaves the device log out', !reportText.includes('lots of log lines'))
	check(
		'report holds the smart home overview',
		report.smartHome.overview.units.length === 3 && report.smartHome.rights.HomeAuto === 2,
	)
	check('report holds recent requests', report.recentRequests.length > 5)
	const leaks = {
		password: PASSWORD,
		'user name': USER,
		MAC: 'AA:BB:CC:00:00:01',
		'external IP': '198.51.100.23',
		SSID: 'Studio 5',
		'device name': 'Steckdose Regie',
		'routine name': 'Abends aus',
		serial: '3810D5000001',
		'box address': '127.0.0.1',
	}
	for (const [what, value] of Object.entries(leaks)) {
		check(`report does not contain the ${what}`, !reportText.includes(value))
	}
	check('report contains no session id', !/[?&]sid=[0-9a-f]/i.test(reportText) && !reportText.includes('AVM-SID'))
	check('placeholders keep entries apart', reportText.includes('NAME#1') && reportText.includes('NAME#2'))

	check('one login served everything', box.state.loginAttempts === 1, `attempts ${box.state.loginAttempts}`)

	// An expired session: the box forgets the SID, the module logs in again by itself.
	box.state.sids.clear()
	await runAction(record, 'refresh', {})
	check('expired SID is renewed transparently', box.state.loginAttempts === 2 && record.variables.smarthome_units === 3)

	await instance.destroy()
	check('logout on destroy', box.state.sids.size === 0)
	await box.close()
}

console.log('Box away for a while, e.g. the nightly reconnect over MyFRITZ!')
{
	let box = await startFakeBox()
	const port = box.port
	const { instance, record } = await startInstance(port)
	await waitFor(() => record.variables.device_connected === 'true', 'first connection')
	await waitFor(() => record.variables.smarthome_units === 3, 'smart home')

	// The box disappears: connections are cut and nothing answers any more.
	await box.close()
	await runAction(record, 'refresh', {})
	check(
		'outage is noticed',
		record.variables.device_connected === 'false' && lastStatus(record)?.status === 'connection_failure',
		JSON.stringify(lastStatus(record)),
	)
	await runAction(record, 'refresh', {})
	const outageLogs = record.logs.filter((l) => l.level !== 'debug' && /not reachable/.test(l.message)).length
	check('the outage is logged once, not on every poll', outageLogs === 1, `${outageLogs} times`)

	// It comes back with a fresh state, as after a restart: the old session is unknown there.
	box = await startFakeBox({ port })
	await runAction(record, 'refresh', {})
	check(
		'router status resumes by itself',
		record.variables.device_connected === 'true',
		JSON.stringify(record.statuses.slice(-3)),
	)
	check('smart home resumes with a new login', record.variables.smarthome_units === 3 && box.state.loginAttempts === 1)
	check('status is ok again', lastStatus(record)?.status === 'ok', JSON.stringify(lastStatus(record)))
	check('the recovery is logged', record.logs.filter((l) => /Connected to/.test(l.message)).length === 2)
	await instance.destroy()
	await box.close()
}

console.log('Internet over the IP connection, with a PPP connection listed beside it')
{
	// Cable or fibre: Layer3Forwarding names the IP connection, PPP is listed but never connected.
	const box = await startFakeBox({ wan: 'ip' })
	const { instance, record } = await startInstance(box.port, { smartHomeInterval: 0 })
	await waitFor(() => record.variables.connection_wan1_ipv4 === '198.51.100.99', 'IP connection read')
	check('the IP connection named by the box is used', record.variables.connection_wan1_ipv4 === '198.51.100.99')
	check('and reported as connected', record.variables.connection_wan1_status === 'Connected')
	await instance.destroy()
	await box.close()
}

for (const layer3 of [true, false]) {
	console.log(`DSL box, line still down at the first contact, Layer3Forwarding ${layer3 ? 'answers' : 'silent'}`)
	// PPP carries the internet, IP is listed beside it and answers "Disconnected". Before the
	// line is up neither is connected, so a guess must not stick once the line comes up.
	const box = await startFakeBox({ wan: 'ppp', layer3, lineUp: false })
	const { instance, record } = await startInstance(box.port, { smartHomeInterval: 0 })
	await waitFor(() => record.variables.device_connected === 'true', 'first connection')
	check('not connected while the line is down', record.variables.connection_wan1_connected === 'false')
	box.state.lineUp = true
	await runAction(record, 'refresh', {})
	check(
		'once the line is up, the PPP connection is followed',
		record.variables.connection_wan1_connected === 'true' && record.variables.connection_wan1_ipv4 === '203.0.113.7',
		JSON.stringify([record.variables.connection_wan1_status, record.variables.connection_wan1_ipv4]),
	)
	await runAction(record, 'wan_reconnect', {})
	check('reconnect goes to the PPP connection', box.state.reconnects === 1)
	await instance.destroy()
	await box.close()
}

console.log('Cable box, line still down at the first contact, Layer3Forwarding silent')
{
	const box = await startFakeBox({ wan: 'ip', layer3: false, lineUp: false })
	const { instance, record } = await startInstance(box.port, { smartHomeInterval: 0 })
	await waitFor(() => record.variables.device_connected === 'true', 'first connection')
	check('not connected while the line is down', record.variables.connection_wan1_connected === 'false')
	box.state.lineUp = true
	await runAction(record, 'refresh', {})
	check(
		'once the line is up, the connected service is found',
		record.variables.connection_wan1_connected === 'true' && record.variables.connection_wan1_ipv4 === '198.51.100.99',
		JSON.stringify([record.variables.connection_wan1_status, record.variables.connection_wan1_ipv4]),
	)
	await instance.destroy()
	await box.close()
}

console.log('Name variables keep updating after the settings are saved')
{
	const box = await startFakeBox()
	const { instance, record } = await startInstance(box.port)
	await waitFor(() => record.variables.smarthome_steckdose_regie_power === 123.45, 'name variable')
	await instance.configUpdated({ ...instance.config, pollInterval: 30 }, { password: PASSWORD })
	box.state.overview.units[0].interfaces.multimeterInterface.power = 55000
	await waitFor(() => record.variables.smarthome_steckdose_regie_power === 55, 'name variable after saving', 4000)
	check(
		'the name variable follows the box after a save',
		record.variables.smarthome_steckdose_regie_power === 55,
		String(record.variables.smarthome_steckdose_regie_power),
	)
	await instance.destroy()
	await box.close()
}

console.log('Button pressed recently turns off on time')
{
	const box = await startFakeBox({ smartHome: false })
	box.state.ahaState.buttonPressed = Math.floor(Date.now() / 1000)
	const { instance, record } = await startInstance(box.port)
	await waitFor(() => 'smarthome_taster_regie_oben_rechts_last_press' in record.variableDefinitions, 'button unit')
	const options = { unit: '09995 1040598-1', seconds: 2 }
	check('the feedback is on right after the press', feedback(record, 'sh_button_pressed', options) === true)
	const checksBefore = record.checked.filter((id) => id === 'sh_button_pressed').length
	await new Promise((r) => setTimeout(r, 3200))
	check('it is off after the configured seconds', feedback(record, 'sh_button_pressed', options) === false)
	check(
		'Companion is told to re-check it without waiting for the next read',
		record.checked.filter((id) => id === 'sh_button_pressed').length >= checksBefore + 2,
	)
	await instance.destroy()
	await box.close()
}

console.log('User without the Smart Home right')
{
	const box = await startFakeBox({ smartHomeForbidden: true })
	const { instance, record } = await startInstance(box.port)
	await waitFor(() => lastStatus(record)?.status === 'unknown_warning', 'smart home warning')
	await waitFor(() => record.variables.device_connected === 'true', 'router connection')
	check(
		'the connection shows a warning, not an authentication failure',
		lastStatus(record)?.status === 'unknown_warning',
		JSON.stringify(lastStatus(record)),
	)
	check('the warning says how to switch smart home off', /Smart home interval/.test(lastStatus(record)?.message ?? ''))
	check('router values still work', record.variables.device_model === 'FRITZ!Box 7590 AX')
	await instance.destroy()
	await box.close()
}

console.log('User without the Smart Home right: no session pile-up')
{
	for (const aha of [false, true]) {
		const box = await startFakeBox({ smartHomeForbidden: true, smartHome: !aha, legacyRestAnswer: aha })
		const { instance, record } = await startInstance(box.port, { smartHomeInterval: 2 })
		await waitFor(() => lastStatus(record)?.status === 'unknown_warning', 'smart home warning')
		await new Promise((resolve) => setTimeout(resolve, 4500))
		const via = aha ? 'AHA' : 'REST'
		check(`${via}: one login for several smart home reads`, box.state.loginAttempts === 1, `${box.state.loginAttempts}`)
		check(`${via}: one session open on the box`, box.state.sids.size === 1, `${box.state.sids.size}`)
		await instance.destroy()
		check(`${via}: no session left after the connection ends`, box.state.sids.size === 0, `${box.state.sids.size}`)
		await box.close()
	}
}

console.log('User without the FRITZ!Box Settings right')
{
	const box = await startFakeBox({ settingsForbidden: true })
	const { instance, record } = await startInstance(box.port, { pollInterval: 2 })
	await waitFor(() => record.variables.smarthome_units >= 6, 'smart home still works')
	await new Promise((resolve) => setTimeout(resolve, 2500))
	const status = lastStatus(record)
	check(
		'the connection shows a warning that names the right, also after the next read',
		status?.status === 'unknown_warning' && /FRITZ!Box Settings/.test(status.message ?? ''),
		JSON.stringify(status),
	)
	check(
		'the hint is in the log, not only in the debug log',
		record.logs.some((l) => l.level === 'warn' && /FRITZ!Box Settings/.test(l.message)),
	)
	await instance.destroy()
	await box.close()
}

console.log('Empty smart home overview')
{
	const box = await startFakeBox({ emptyOverview: true })
	const { instance, record } = await startInstance(box.port, { pollInterval: 60 })
	await waitFor(() => record.logs.some((l) => /empty smart home overview/.test(l.message)), 'clear message')
	check(
		'an empty overview gives a clear message',
		record.logs.some((l) => /empty smart home overview/.test(l.message)),
	)
	await instance.destroy()
	await box.close()
}

console.log('Wrong password')
{
	const box = await startFakeBox()
	const { instance, record } = await startInstance(box.port, {}, 'wrong')
	await waitFor(() => lastStatus(record)?.status === 'authentication_failure', 'authentication failure')
	check(
		'status is authentication failure',
		lastStatus(record)?.status === 'authentication_failure',
		JSON.stringify(record.statuses),
	)
	check(
		'the reason is logged',
		record.logs.some((l) => l.level === 'error' && /refused/.test(l.message)),
	)
	check('not connected', record.variables.device_connected === 'false')
	await waitFor(() => box.state.loginAttempts > 0, 'smart home login attempt')
	const attempts = box.state.loginAttempts
	await runAction(record, 'refresh', {})
	await runAction(record, 'refresh', {})
	check(
		'a refused login is not retried at once',
		box.state.loginAttempts === attempts,
		`attempts ${box.state.loginAttempts}`,
	)
	await instance.destroy()
	await box.close()
}

console.log('Box not ready at the first poll')
{
	const box = await startFakeBox({ descriptionFailures: 1 })
	const { instance, record } = await startInstance(box.port, { smartHomeInterval: 0 })
	await waitFor(() => lastStatus(record)?.status === 'connection_failure', 'first poll failing')
	await runAction(record, 'refresh', {})
	check('connects on the next poll', record.variables.device_connected === 'true')
	check('the internet service is still found', record.variables.connection_wan1_ipv4 === '203.0.113.7')
	check('connection status still read', record.variables.connection_wan1_status === 'Connected')
	await instance.destroy()
	await box.close()
}

console.log('Box reached over MyFRITZ!-style remote access')
{
	const box = await startFakeBox({ remote: true })
	// Nothing answers on the plain TR-064 port, as over the internet.
	const { instance, record } = await startInstance(box.port, {
		host: `https://127.0.0.1:${box.port}`,
		tr064PlainPort: 1,
	})
	await waitFor(() => record.variables.device_connected === 'true', 'router connection over the remote access port')
	// Connected comes from the quick part of a read; model and host list follow from the slow part.
	await waitFor(() => record.variables.lan_hosts_known === 2, 'host list over the remote access port')
	await waitFor(() => record.variables.smarthome_units === 3, 'smart home over the remote access port')
	check(
		'router status read over HTTPS',
		record.variables.device_model === 'FRITZ!Box 7590 AX',
		JSON.stringify(record.logs),
	)
	check(
		'TR-064 used the /tr064 prefix',
		box.state.paths.some((p) => p.startsWith('/tr064/upnp/control/')),
	)
	check('no TR-064 request without the prefix', !box.state.paths.some((p) => p.startsWith('/upnp/')))
	check('host list fetched below /tr064', record.variables.lan_hosts_known === 2)
	check('no IGD request on the remote route', !box.state.paths.some((p) => p.includes('igddesc')))
	check('smart home over the same port', record.variables.smarthome_steckdose_regie_power === 123.45)
	check('web_url keeps the port', record.variables.device_web_url === `https://127.0.0.1:${box.port}`)
	check('status ok', lastStatus(record)?.status === 'ok', JSON.stringify(lastStatus(record)))
	await instance.destroy()
	await box.close()
}

console.log('Mobile connection switched off')
{
	const box = await startFakeBox()
	const { Tr064Client } = await import(`${D}/tr064.js`)
	const { RouterReader, createRouterState } = await import(`${D}/router.js`)
	const { routerVariableValues } = await import(`${D}/variables.js`)
	const tr064 = new Tr064Client({
		host: '127.0.0.1',
		port: box.port,
		https: false,
		username: USER,
		password: PASSWORD,
		timeout: 5000,
	})
	const reader = new RouterReader(tr064, undefined)
	const state = createRouterState()
	await reader.readSlow(state, false)
	check('the stick is seen while on', state.mobile?.enabled === true)
	box.state.mobileEnabled = 0
	await reader.readSlow(state, false)
	const values = routerVariableValues(state)
	check(
		'switched off it stays, as off',
		values.connection_mobile_enabled === 'false' && values.connection_wan2_enabled === 'false',
		JSON.stringify([values.connection_mobile_enabled, values.connection_wan2_enabled]),
	)
	await box.close()
}

console.log('HTTPS certificates')
{
	const box = await startFakeBox({ remote: true })
	const { httpCall, CertificateError } = await import(`${D}/http.js`)
	const request = {
		host: '127.0.0.1',
		port: box.port,
		https: true,
		method: 'GET',
		path: '/login_sid.lua',
		timeout: 5000,
	}
	const accepted = await httpCall(request).catch((error) => error)
	check('without the check the certificate the box signed itself is accepted', accepted?.status === 200)
	const refused = await httpCall({ ...request, verifyCertificate: true }).catch((error) => error)
	check(
		'with the check it is refused, with a hint to the setting',
		refused instanceof CertificateError && /Accept the certificate the box signed itself/.test(refused.message),
		String(refused?.message ?? refused?.status),
	)
	await box.close()
}

console.log('Remote access with a wrong password')
{
	const box = await startFakeBox({ remote: true })
	const started = Date.now()
	const { instance, record } = await startInstance(
		box.port,
		{ host: `https://127.0.0.1:${box.port}`, tr064PlainPort: 1, smartHomeInterval: 0 },
		'wrong',
	)
	await waitFor(() => lastStatus(record)?.status === 'authentication_failure', 'authentication failure')
	check(
		'wrong password over the remote access is an authentication failure',
		lastStatus(record)?.status === 'authentication_failure',
		JSON.stringify(record.statuses),
	)
	check('the other route is not tried after a refused login', Date.now() - started < 2500, `${Date.now() - started} ms`)
	await instance.destroy()
	await box.close()
}

console.log('Unusable address')
{
	const { instance, record } = await startInstance(1, { host: 'ftp://box' })
	check('status is bad config', lastStatus(record)?.status === 'bad_config')
	check('the reason names the address', /ftp:\/\/box/.test(lastStatus(record)?.message ?? ''))
	await instance.destroy()
}

console.log('Older box: no Smart Home REST API, AHA-HTTP instead')
{
	const box = await startFakeBox({ smartHome: false })
	const { instance, record } = await startInstance(box.port)
	await waitFor(() => record.variables.smarthome_units >= 6, 'smart home over AHA')
	await waitFor(() => record.variables.device_connected === 'true', 'router connection')
	check(
		'the switch to AHA is logged',
		record.logs.some((l) => l.level === 'info' && /using the AHA-HTTP interface/.test(l.message)),
	)
	check('status ok', lastStatus(record)?.status === 'ok', JSON.stringify(lastStatus(record)))
	check(
		'socket values over AHA',
		record.variables.smarthome_beamer_leinwand_power === 0 &&
			record.variables.smarthome_beamer_leinwand_voltage === 229.5,
	)
	check(
		'thermostat target over AHA',
		record.variables.smarthome_heizung_saal_setpoint === 21 && record.variables.smarthome_heizung_saal_battery === 70,
	)
	check(
		'HAN-FUN window contact over AHA',
		record.variables['smarthome_11934_0059978_1_alert'] === 'open' &&
			record.variables['smarthome_11934_0059978_1_battery_low'] === 'true',
	)
	check(
		'colour bulb over AHA',
		record.variables['smarthome_13077_0000060_1_level'] === 80 &&
			record.variables['smarthome_13077_0000060_1_hue'] === 200,
	)
	check(
		'button of a FRITZ!DECT 440 is its own unit',
		'smarthome_taster_regie_oben_rechts_last_press' in record.variableDefinitions,
	)
	check('humidity of the FRITZ!DECT 440', record.variables.smarthome_taster_regie_humidity === 45)
	check(
		'templates over AHA, automatic ones hidden',
		record.actions.sh_apply_template.options[0].choices
			.map((c) => c.id)
			.sort()
			.join() === 'tmp653A18-38AE7FDE9,tmpD0EF2E-3CE52B246',
	)
	check('routine over AHA', feedback(record, 'sh_trigger_enabled', { trigger: 'trg695F2D-3CBF1DC25' }) === true)

	const commands = box.state.ahaState.commands
	await runAction(record, 'sh_switch', { unit: '08761 0000434', mode: 'toggle' })
	check(
		'a FRITZ! socket is switched with setswitchon',
		commands.at(-1)?.cmd === 'setswitchon' && box.state.ahaState.socketOn === 1,
	)
	await waitFor(() => record.variables.smarthome_beamer_leinwand_on === 'true', 'socket state read back', 3000)
	check('feedback follows over AHA', feedback(record, 'sh_on', { unit: '08761 0000434' }) === true)
	await runAction(record, 'sh_switch', { unit: '13077 0000060-1', mode: 'off' })
	check(
		'a HAN-FUN lamp is switched with setsimpleonoff',
		commands.at(-1)?.cmd === 'setsimpleonoff' && commands.at(-1)?.onoff === '0',
	)
	await runAction(record, 'sh_level', { unit: '13077 0000060-1', mode: 'set', value: 40, switchOn: true })
	check(
		'level and switch on in two commands',
		commands.at(-2)?.cmd === 'setsimpleonoff' &&
			commands.at(-1)?.cmd === 'setlevelpercentage' &&
			commands.at(-1)?.level === '40',
	)
	await runAction(record, 'sh_color', { unit: '13077 0000060-1', hue: 120, saturation: 50, switchOn: false })
	check(
		'colour with setunmappedcolor',
		commands.at(-1)?.cmd === 'setunmappedcolor' &&
			commands.at(-1)?.hue === '120' &&
			commands.at(-1)?.saturation === '128',
	)
	await runAction(record, 'sh_setpoint', { unit: 'Heizung Saal', mode: 'increase', value: 0.5 })
	check('setpoint in half degrees', commands.at(-1)?.cmd === 'sethkrtsoll' && commands.at(-1)?.param === '43')
	await runAction(record, 'sh_setpoint', { unit: 'Heizung Saal', mode: 'off', value: 0 })
	check('thermostat off is 253', commands.at(-1)?.param === '253')
	await runAction(record, 'sh_boost', { unit: 'Heizung Saal', mode: 'on', minutes: 15 })
	const boostEnd = Number(commands.at(-1)?.endtimestamp)
	check(
		'boost with end time',
		commands.at(-1)?.cmd === 'sethkrboost' && Math.abs(boostEnd - (Math.floor(Date.now() / 1000) + 900)) <= 2,
	)
	await runAction(record, 'sh_apply_template', { template: 'tmpD0EF2E-3CE52B246' })
	check('scenario applied', commands.at(-1)?.cmd === 'applytemplate' && commands.at(-1)?.ain === 'tmpD0EF2E-3CE52B246')
	await runAction(record, 'sh_trigger', { trigger: 'trg695F2D-3CBF1DC25', mode: 'toggle' })
	check('routine switched off', commands.at(-1)?.cmd === 'settriggeractive' && commands.at(-1)?.active === '0')

	// An expired session: AHA answers 403, the module logs in again by itself.
	const logins = box.state.loginAttempts
	box.state.sids.clear()
	await runAction(record, 'refresh', {})
	check(
		'expired SID is renewed over AHA too',
		box.state.loginAttempts === logins + 1 && record.variables.smarthome_units >= 6,
	)

	const response = await instance.handleHttpRequest({
		baseUrl: '',
		headers: {},
		hostname: '',
		ip: '',
		method: 'GET',
		originalUrl: '',
		path: '/diagnostics',
		query: {},
	})
	const report = JSON.parse(response.body)
	check(
		'the report names the AHA interface and holds its lists',
		report.smartHome.interface === 'aha' && report.smartHome.overview.devicelist.device.length >= 6,
	)
	check(
		'device names are masked in the AHA lists',
		!response.body.includes('Heizung Saal') && !response.body.includes('Beamer'),
	)
	await instance.destroy()
	await box.close()
}

console.log('FRITZ!OS 7.x answering the REST path with 400 / 201 unknown endpoint')
{
	const box = await startFakeBox({ smartHome: false, legacyRestAnswer: true })
	const { instance, record } = await startInstance(box.port)
	await waitFor(() => record.variables.smarthome_units >= 6, 'smart home over AHA')
	check(
		'the module switches to AHA',
		record.logs.some((l) => /using the AHA-HTTP interface/.test(l.message)),
	)
	check('no smart home error is reported', !record.logs.some((l) => /Smart home not readable/.test(l.message)))
	await instance.destroy()
	await box.close()
}

console.log('WAN over an Ethernet port (fibre converter)')
{
	const box = await startFakeBox({ ethernetWan: true })
	const { instance, record } = await startInstance(box.port, { smartHomeInterval: 0 })
	await waitFor(() => record.variables.connection_wan1_line_down_mbit !== undefined, 'line rate')
	check(
		'the line rate is the capacity set in the box, not the port speed',
		record.variables.connection_wan1_line_down_mbit === 170 && record.variables.connection_wan1_line_up_mbit === 85,
		`${record.variables.connection_wan1_line_down_mbit} / ${record.variables.connection_wan1_line_up_mbit}`,
	)
	await instance.destroy()
	await box.close()
}

console.log('Diagnostics report of a slow box')
{
	// Every TR-064 answer takes 250 ms, so the report takes longer than Companion waits (5 s).
	const box = await startFakeBox({ delayMs: 250 })
	const { instance, record } = await startInstance(box.port)
	await waitFor(() => record.variables.lan_hosts_known === 2, 'first read', 20000)
	const request = {
		baseUrl: '',
		headers: {},
		hostname: '',
		ip: '',
		method: 'GET',
		originalUrl: '',
		path: '/diagnostics',
		query: {},
	}
	const started = Date.now()
	const first = await instance.handleHttpRequest(request)
	check("the first answer comes within Companion's 5 s", Date.now() - started < 4500, `${Date.now() - started} ms`)
	check(
		'it is a page that reloads itself',
		/http-equiv="refresh"/.test(first.body) && first.headers['Content-Type'].startsWith('text/html'),
	)
	let report
	const deadline = Date.now() + 30000
	while (Date.now() < deadline) {
		const answer = await instance.handleHttpRequest(request)
		if (answer.headers['Content-Type'].startsWith('application/json')) {
			report = JSON.parse(answer.body)
			break
		}
	}
	check('then the report is downloaded', report?.tr064?.results?.length > 10)
	await instance.destroy()
	await box.close()
}

console.log('Box with no smart home interface at all')
{
	const box = await startFakeBox({ smartHome: false, aha: false })
	const { instance, record } = await startInstance(box.port)
	await waitFor(() => record.logs.some((l) => /offers no smart home interface/.test(l.message)), 'smart home warning')
	await waitFor(() => record.variables.device_connected === 'true', 'router connection')
	check('router still works', record.variables.device_connected === 'true')
	check(
		'the missing interface is explained',
		record.logs.some((l) => l.level === 'warn' && /no smart home interface/.test(l.message)),
	)
	check(
		'status is a warning, not an error',
		lastStatus(record)?.status === 'unknown_warning',
		JSON.stringify(lastStatus(record)),
	)
	await instance.destroy()
	await box.close()
}

console.log('Nothing listening')
{
	const { instance, record } = await startInstance(1, { smartHomeInterval: 0 })
	await waitFor(() => lastStatus(record)?.status === 'connection_failure', 'connection failure')
	check(
		'status is connection failure',
		lastStatus(record)?.status === 'connection_failure',
		JSON.stringify(record.statuses),
	)
	await instance.destroy()
}

console.log('No password')
{
	const { instance, record } = await startInstance(1, {}, '')
	check('status is bad config', lastStatus(record)?.status === 'bad_config')
	await instance.destroy()
}

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

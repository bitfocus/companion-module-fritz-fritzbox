// Reads a real FRITZ!Box the way the module does and prints what it found, without Companion.
//
//   yarn build
//   yarn live-check <address> <user>
//
// The address is entered as in the module: 192.168.178.1 or https://xxxx.myfritz.net:43167
//
// The password is asked for on the terminal and never printed. Nothing on the box is changed:
// only status reads, one login and one logout.
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'

const D = '../dist'
const { Tr064Client, TR064_HTTP_PORT, REMOTE_TR064_PREFIX } = await import(`${D}/tr064.js`)
const { parseAddress, webUrlFor } = await import(`${D}/config.js`)
const { tr064Routes } = await import(`${D}/main.js`)
const { RouterReader, createRouterState } = await import(`${D}/router.js`)
const { FritzSession } = await import(`${D}/session.js`)
const { SmartHomeClient } = await import(`${D}/smarthome.js`)
const { routerVariableValues } = await import(`${D}/variables.js`)
const { capabilitiesOf, createSmartHomeState, unitValues } = await import(`${D}/shstate.js`)

const [input, username = ''] = process.argv.slice(2)
const address = input ? parseAddress(input) : undefined
if (!address) {
	console.error(
		'Usage: yarn live-check <address> <user>, e.g. yarn live-check https://xxxx.myfritz.net:43167 companion',
	)
	process.exit(2)
}
const { host } = address

/** Reads a line without echoing it. */
async function askHidden(question) {
	let muted = false
	const output = new Writable({
		write(chunk, encoding, done) {
			if (!muted) process.stdout.write(chunk, encoding)
			done()
		},
	})
	const rl = createInterface({ input: process.stdin, output, terminal: true })
	process.stdout.write(question)
	muted = true
	const answer = await new Promise((resolve) => rl.question('', resolve))
	rl.close()
	process.stdout.write('\n')
	return answer
}

const password = process.env.FRITZ_PASSWORD ?? (await askHidden(`Password for ${username || '(no user)'}@${host}: `))
const timeout = 8000
const describe = (error) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error))

console.log(`\n== TR-064 ==`)
console.log(`Web interface: ${webUrlFor(address)} (${address.homeNetwork ? 'home network' : 'internet'})`)

/** The same routes the module tries, in the same order. */
async function clientFor(route) {
	const common = { host, username, password, timeout }
	if (route === 'web-port') {
		return new Tr064Client({ ...common, port: address.port, https: true, pathPrefix: REMOTE_TR064_PREFIX })
	}
	if (!address.https) return new Tr064Client({ ...common, port: TR064_HTTP_PORT, https: false })
	const plain = new Tr064Client({ host, port: TR064_HTTP_PORT, https: false, username: '', password: '', timeout })
	const port = Number((await plain.call('DeviceInfo1', 'GetSecurityPort')).NewSecurityPort)
	return new Tr064Client({ ...common, port, https: true })
}

let tr064
let ownPort = false
for (const route of tr064Routes(address)) {
	try {
		const client = await clientFor(route)
		const services = await client.services()
		const { https, port, pathPrefix } = client.options
		console.log(`Route ${route}: ${https ? 'https' : 'http'}://${host}:${port}${pathPrefix ?? ''} works`)
		console.log(`${services.length} services: ${services.map((x) => x.id).join(', ')}`)
		tr064 = client
		ownPort = route === 'own-port'
		break
	} catch (error) {
		console.log(`Route ${route}: ${describe(error)}`)
	}
}
if (!tr064) {
	console.log('TR-064 not reachable on any route.')
	process.exit(1)
}

const igd = ownPort
	? new Tr064Client({
			host,
			port: TR064_HTTP_PORT,
			https: false,
			username: '',
			password: '',
			timeout,
			descriptionPath: '/igddesc.xml',
		})
	: undefined

if (igd) {
	try {
		const services = await igd.services()
		console.log(`UPnP IGD services: ${services.map((s) => s.id).join(', ')}`)
	} catch (error) {
		console.log(`UPnP IGD: ${describe(error)} (fine unless IPv6 or the throughput fallback is wanted)`)
	}
}

const reader = new RouterReader(tr064, igd)
const router = createRouterState()
const started = Date.now()
const problems = [...(await reader.readFast(router)), ...(await reader.readSlow(router, true))]
console.log(`Read in ${Date.now() - started} ms`)
for (const { area, error } of problems) console.log(`  problem in ${area}: ${describe(error)}`)

const values = routerVariableValues(router)
for (const [key, value] of Object.entries(values)) {
	if (value !== '') console.log(`  ${key.padEnd(24)} ${value}`)
}
console.log(`  connection service       ${router.connectionService ?? '(none)'}`)

console.log(`\n== Smart Home REST API ==`)
const web = { host, port: address.port, https: address.https, timeout }
const session = new FritzSession(web, username, password)
try {
	await session.sid()
	console.log(`Login ok. Rights: ${JSON.stringify(session.rights)}`)
	const client = new SmartHomeClient(web, session)
	const overview = await client.overview()
	const sh = createSmartHomeState()
	sh.available = true
	sh.overview = overview
	console.log(
		`${overview.devices.length} devices, ${overview.units.length} units, ${overview.groups.length} groups, ` +
			`${overview.templates.length} templates, ${overview.triggers.length} routines`,
	)
	for (const unit of overview.units) {
		console.log(`\n  [${unit.UID}] ${unit.name} - ${unit.unitType}${unit.isGroupUnit ? ' (group)' : ''}`)
		console.log(`    capabilities: ${capabilitiesOf(unit).join(', ') || '(none)'}`)
		const shown = Object.entries(unitValues(sh, unit)).filter(([, value]) => value !== '')
		console.log(`    ${shown.map(([key, value]) => `${key}=${value}`).join('  ')}`)
	}
	for (const template of overview.templates) {
		console.log(`  template [${template.UID}] ${template.name} ${template.template?.isAutoCreated ? '(auto)' : ''}`)
	}
	for (const trigger of overview.triggers) {
		console.log(`  routine  [${trigger.UID}] ${trigger.name} enabled=${trigger.enabled}`)
	}
} catch (error) {
	console.log(`Smart home: ${describe(error)}`)
} finally {
	await session.logout()
}

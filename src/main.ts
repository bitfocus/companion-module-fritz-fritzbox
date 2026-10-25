import {
	InstanceBase,
	InstanceStatus,
	type CompanionHTTPRequest,
	type CompanionHTTPResponse,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import {
	DEFAULT_CONFIG,
	GetConfigFields,
	parseAddress,
	webUrlFor,
	type BoxAddress,
	type ModuleConfig,
	type ModuleSecrets,
} from './config.js'
import {
	routerShapeFingerprint,
	routerVariableValues,
	smartHomeVariableValues,
	UpdateVariableDefinitions,
	type VariablesSchema,
} from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { HttpTransportError, setHttpObserver } from './http.js'
import { Anonymizer, collectTr064, ExchangeLog, reportFileName } from './diagnostics.js'
import { readFile } from 'node:fs/promises'
import { createRouterState, RouterReader, type ReadProblem, type RouterState } from './router.js'
import { FritzSession, LoginRefusedError, type WebEndpoint } from './session.js'
import { SmartHomeClient, SmartHomeError, type SmartHomeBackend } from './smarthome.js'
import { AhaClient } from './aha.js'
import { assignNamePrefixes, createSmartHomeState, overviewFingerprint, type SmartHomeState } from './shstate.js'
import { REMOTE_TR064_PREFIX, Tr064AuthError, Tr064Client, Tr064Fault, TR064_HTTP_PORT } from './tr064.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: ModuleSecrets
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

const REQUEST_TIMEOUT_MS = 8_000
/** For asking the TR-064 HTTPS port, which over the internet simply never answers. */
const PROBE_TIMEOUT_MS = 3_000
/** How often addresses, WLAN, DSL values and the host list are read. */
const SLOW_POLL_MS = 30_000
/** How often model, firmware and uptime are read; that answer carries the whole event log. */
const DEVICE_INFO_MS = 600_000
/** After a smart home action, when to look again. DECT devices confirm with some delay. */
const AFTER_ACTION_MS = [1_000, 4_000]
/** After a router action, when to read the status again. */
const AFTER_ROUTER_ACTION_MS = [1_500, 5_000]
/** After a reconnect, when to read the status again: the line drops and comes back within seconds. */
const AFTER_RECONNECT_MS = [5_000, 15_000, 30_000]
/** After TR-064 refused the login, how long to wait before trying again, so the box does not lock up. */
const AUTH_RETRY_MS = 60_000
/** The HTTPS port TR-064 uses unless the box announces another. */
const DEFAULT_TR064_HTTPS_PORT = 49443

/**
 * The two ways TR-064 can be reached. In the home network it has a port of its own (49000, or the
 * HTTPS port the box announces). Through MyFRITZ! or other remote access everything goes through
 * the one HTTPS port of the web interface, with TR-064 below /tr064.
 */
export type Tr064Route = 'own-port' | 'web-port'

/**
 * The order in which to try the routes for an address. Remote access is HTTPS only, so a plain
 * HTTP address can only mean the home network. Otherwise the more likely route goes first and the
 * other one follows, so a VPN, port forwarding or an unusual name still finds its way.
 */
export function tr064Routes(address: BoxAddress): Tr064Route[] {
	if (!address.https) return ['own-port']
	return address.homeNetwork ? ['own-port', 'web-port'] : ['web-port', 'own-port']
}

/** Areas whose failure means the box itself cannot be read, not just one feature. */
const ESSENTIAL_AREAS = new Set(['link', 'connection'])

type Part = 'router' | 'smarthome'

/** Lower is worse, so the status shown is the worst of the two parts. */
const STATUS_RANK: Partial<Record<InstanceStatus, number>> = {
	[InstanceStatus.BadConfig]: 0,
	[InstanceStatus.AuthenticationFailure]: 1,
	[InstanceStatus.ConnectionFailure]: 2,
	[InstanceStatus.UnknownError]: 3,
	[InstanceStatus.Connecting]: 4,
	[InstanceStatus.UnknownWarning]: 5,
	[InstanceStatus.Ok]: 6,
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config: ModuleConfig = { ...DEFAULT_CONFIG }
	secrets: ModuleSecrets = { password: '' }

	router: RouterState = createRouterState()
	smartHome: SmartHomeState = createSmartHomeState()
	/** True while the router status could be read on the last attempt. */
	connected = false
	/** The plain TR-064 port of the box. A field rather than a constant so tests can use a fake box. */
	tr064PlainPort = TR064_HTTP_PORT
	/** The last requests, for diagnostics reports. */
	readonly #exchanges = new ExchangeLog()

	#session: FritzSession | undefined
	/** The address field, read; undefined while it holds no usable address. */
	#address: BoxAddress | undefined
	/** Set once a TR-064 route has been found, cleared to search again after the box was lost. */
	#reader: RouterReader | undefined
	#smartHomeClient: SmartHomeBackend | undefined
	/** Kept to switch to the AHA-HTTP interface when the box has no Smart Home REST API. */
	#smartHomeEndpoint: WebEndpoint | undefined
	#routerTimer: NodeJS.Timeout | undefined
	#smartHomeTimer: NodeJS.Timeout | undefined
	#followUps: NodeJS.Timeout[] = []
	#reconnectChecks: NodeJS.Timeout[] = []
	#routerChecks: NodeJS.Timeout[] = []
	#routerInFlight = false
	#smartHomeInFlight = false
	/** Set when a smart home read has to follow the current one, e.g. after switching to AHA. */
	#smartHomeAgain = false
	#lastSlowPoll = 0
	#lastDeviceInfo = 0
	/** No router poll before this time, set after a refused login. */
	#routerPausedUntil = 0
	/** Bumped on every reconfiguration, so answers to an old configuration are thrown away. */
	#generation = 0
	#definitionsFingerprint = ''
	#smartHomeFingerprint = ''
	/** The last message logged per area, so a lasting problem is logged once and not every poll. */
	#reported = new Map<string, string>()
	/** The kind of problem last reported per area, so a changing detail of the same outage stays quiet. */
	#problemKinds = new Map<string, string>()
	#status: Record<Part, { status: InstanceStatus; message?: string }> = {
		router: { status: InstanceStatus.Connecting },
		smarthome: { status: InstanceStatus.Ok },
	}

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		setHttpObserver((observation) =>
			this.#exchanges.add({
				time: new Date().toISOString(),
				method: observation.method,
				target: `${observation.host}:${observation.port}${observation.path}`,
				ms: observation.ms,
				...(observation.status !== undefined ? { status: observation.status } : {}),
				...(observation.error ? { error: observation.error } : {}),
			}),
		)
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.secrets = secrets ?? { password: '' }
		this.#rebuildDefinitions()
		await this.#applyConfig()
	}

	async destroy(): Promise<void> {
		setHttpObserver(undefined)
		this.#stop()
		await this.#session?.logout()
		this.#session = undefined
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.secrets = secrets ?? { password: '' }
		// Companion sets a renamed label just before calling this, and presets address variables through it.
		this.updatePresets()
		await this.#applyConfig()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	/**
	 * Runs a smart home request on behalf of an action, turning failures into a log entry rather than
	 * an unhandled rejection, and reads the state back shortly afterwards so feedbacks follow.
	 */
	async runSmartHome(name: string, fn: (client: SmartHomeBackend) => Promise<void>): Promise<void> {
		const client = this.#smartHomeClient
		if (!client) {
			this.log('warn', `${name}: smart home is not available`)
			return
		}
		try {
			await fn(client)
			this.log('debug', `${name}: ok`)
		} catch (error) {
			this.log('error', `${name} failed: ${describe(error)}`)
		}
		this.#scheduleFollowUps()
	}

	/**
	 * Runs a router change on behalf of an action and reads the status back, addresses and lists
	 * included, so variables and feedbacks follow. Failures become a log entry, with a hint when
	 * the user lacks the right for it.
	 */
	async runRouter(name: string, fn: (reader: RouterReader) => Promise<void>): Promise<boolean> {
		const reader = this.#reader
		if (!reader) {
			this.log('warn', `${name}: not connected to the FRITZ!Box`)
			return false
		}
		try {
			await fn(reader)
			this.log('info', `${name}: done`)
		} catch (error) {
			const hint =
				error instanceof Tr064Fault && error.isMissingRight
					? ' (the user needs the "FRITZ!Box Settings" right)'
					: error instanceof Tr064Fault && error.isUnknownAction
						? ' (not offered by this box)'
						: ''
			this.log('error', `${name} failed: ${describe(error)}${hint}`)
			return false
		}
		for (const timer of this.#routerChecks) clearTimeout(timer)
		// The box applies some changes with a short delay, e.g. the internet block.
		this.#routerChecks = AFTER_ROUTER_ACTION_MS.map((delay) =>
			setTimeout(() => {
				this.#lastSlowPoll = 0
				void this.#pollRouter()
			}, delay),
		)
		return true
	}

	/**
	 * Drops the internet connection so the box dials in again. Afterwards the status is read a few
	 * times, with the addresses included, so the new connection and IP address show up quickly.
	 */
	async reconnectWan(): Promise<void> {
		const reader = this.#reader
		if (!reader) {
			this.log('warn', 'Reconnect: not connected to the FRITZ!Box')
			return
		}
		try {
			const service = await reader.reconnect(this.router)
			this.log('info', `Reconnect: internet connection dropped (${service}), the box is dialling in again`)
		} catch (error) {
			const hint =
				error instanceof Tr064Fault && error.isMissingRight ? ' (the user needs the "FRITZ!Box Settings" right)' : ''
			this.log('error', `Reconnect failed: ${describe(error)}${hint}`)
			return
		}
		for (const timer of this.#reconnectChecks) clearTimeout(timer)
		this.#reconnectChecks = AFTER_RECONNECT_MS.map((delay) =>
			setTimeout(() => {
				this.#lastSlowPoll = 0
				void this.#pollRouter()
			}, delay),
		)
	}

	/** The path below the Companion web server where the diagnostics report of this connection is served. */
	diagnosticsPath(): string {
		return `/instance/${encodeURIComponent(this.label)}/diagnostics`
	}

	/**
	 * Serves the diagnostics report through the web server of Companion, at
	 * /instance/<connection label>/diagnostics, as a file download. Modules run without write access
	 * to the disk, so the browser saving it is the way to a file a beta tester can send in.
	 */
	async handleHttpRequest(request: CompanionHTTPRequest): Promise<CompanionHTTPResponse> {
		const path = request.path.replace(/\/+$/, '')
		if (path === '/diagnostics' || path === '/diagnostics.json') {
			const report = await this.buildDiagnostics()
			return {
				status: 200,
				headers: {
					'Content-Type': 'application/json; charset=utf-8',
					'Content-Disposition': `attachment; filename="${reportFileName()}"`,
					'Cache-Control': 'no-store',
				},
				body: `${JSON.stringify(report, null, 2)}\n`,
			}
		}
		if (path === '') {
			return {
				status: 200,
				headers: { 'Content-Type': 'text/html; charset=utf-8' },
				body:
					'<!doctype html><html><head><meta charset="utf-8"><title>FRITZ!Box diagnostics</title></head>' +
					'<body style="font-family:sans-serif;max-width:40em;margin:2em auto">' +
					'<h1>FRITZ!Box diagnostics</h1><p>The report shows how this box answers the module. Passwords ' +
					'are never included; addresses, names and serial numbers are replaced by placeholders.</p>' +
					'<p><a href="diagnostics">Download the diagnostics report</a></p></body></html>',
			}
		}
		return { status: 404, body: 'Not found' }
	}

	/**
	 * Builds a diagnostics report a beta tester can send in: what the box offers and answers,
	 * the smart home overview as sent, the recent requests and problems. Passwords, session ids and
	 * digest data never go in; addresses, names and serial numbers are replaced by placeholders.
	 */
	async buildDiagnostics(): Promise<unknown> {
		const address = this.#address
		// The user name can turn up in error messages, the address in request targets.
		const anonymizer = new Anonymizer([
			...(address ? [{ kind: 'HOST', value: address.host }] : []),
			{ kind: 'USER', value: this.config.username },
		])
		const report: Record<string, unknown> = {
			report: 'companion-module-fritz-fritzbox diagnostics',
			created: new Date().toISOString(),
			module: await moduleVersion(),
			node: process.version,
			platform: `${process.platform} ${process.arch}`,
			config: {
				address: address ? webUrlFor(address) : this.config.host,
				homeNetwork: address?.homeNetwork,
				userNameSet: this.config.username !== '',
				passwordSet: this.secrets.password !== '',
				pollInterval: this.config.pollInterval,
				smartHomeInterval: this.config.smartHomeInterval,
			},
			status: { router: this.#status.router, smartHome: this.#status.smarthome, connected: this.connected },
			problems: Object.fromEntries(this.#reported),
		}

		const reader = this.#reader
		if (reader) {
			const { https, port, pathPrefix } = reader.tr064.options
			report.tr064Route = `${https ? 'https' : 'http'}:${port}${pathPrefix ?? ''}`
			try {
				report.tr064 = await collectTr064(reader.tr064)
			} catch (error) {
				report.tr064 = { error: describe(error) }
			}
		} else {
			report.tr064 = { error: 'TR-064 has not been reached yet' }
		}

		const client = this.#smartHomeClient
		const session = this.#session
		if (client && session) {
			try {
				const overview = await client.rawOverview()
				report.smartHome = { interface: client.kind, rights: session.rights, overview }
			} catch (error) {
				report.smartHome = { interface: client.kind, error: describe(error) }
			}
			// On boxes with the REST API, also show how the AHA-HTTP interface would see them. That is
			// how the AHA mapping, needed for older boxes, can be checked against a current one.
			const endpoint = this.#smartHomeEndpoint
			if (client.kind === 'rest' && endpoint) {
				try {
					report.smartHomeAha = (await new AhaClient(endpoint, session).overview()).units
				} catch (error) {
					report.smartHomeAha = { error: describe(error) }
				}
			}
		} else {
			report.smartHome = { error: 'Smart home is switched off or not configured' }
		}

		// Only the router values: smart home variable names carry the device names, and the raw
		// overview above already holds every smart home value.
		report.variables = routerVariableValues(this.router)
		report.recentRequests = this.#exchanges.entries()

		return anonymizer.value(report)
	}

	/** Reads everything at once, for the refresh action. */
	async refreshAll(): Promise<void> {
		this.#lastSlowPoll = 0
		this.#routerPausedUntil = 0
		await Promise.all([this.#pollRouter(), this.#pollSmartHome()])
	}

	async #applyConfig(): Promise<void> {
		this.#stop()
		this.#generation++
		void this.#session?.logout()
		this.#session = undefined
		this.#reader = undefined
		this.#smartHomeClient = undefined
		this.#smartHomeEndpoint = undefined
		this.#reported.clear()
		this.#problemKinds.clear()
		this.#lastSlowPoll = 0
		this.#lastDeviceInfo = 0
		this.#routerPausedUntil = 0
		this.router = createRouterState()
		this.smartHome = createSmartHomeState()

		const { username } = this.config
		const address = parseAddress(this.config.host)
		this.#address = address
		this.#setDisconnected()
		if (!address) {
			this.#setStatus(
				'router',
				InstanceStatus.BadConfig,
				this.config.host ? `Address not understood: ${this.config.host}` : 'No address configured',
			)
			return
		}
		if (!this.secrets.password) {
			this.#setStatus('router', InstanceStatus.BadConfig, 'No password configured')
			return
		}

		this.#setStatus('router', InstanceStatus.Connecting)
		this.#setStatus('smarthome', InstanceStatus.Ok)

		const web: WebEndpoint = {
			host: address.host,
			port: address.port,
			https: address.https,
			timeout: REQUEST_TIMEOUT_MS,
		}
		this.#session = new FritzSession(web, username, this.secrets.password)

		const routerMs = Math.max(2, Number(this.config.pollInterval) || DEFAULT_CONFIG.pollInterval) * 1000
		this.#routerTimer = setInterval(() => void this.#pollRouter(), routerMs)
		void this.#pollRouter()

		const smartHomeSeconds = Number(this.config.smartHomeInterval)
		if (smartHomeSeconds > 0) {
			this.#smartHomeClient = new SmartHomeClient(web, this.#session)
			this.#smartHomeEndpoint = web
			this.#smartHomeTimer = setInterval(() => void this.#pollSmartHome(), Math.max(2, smartHomeSeconds) * 1000)
			void this.#pollSmartHome()
		}
	}

	/**
	 * Finds the way to TR-064 by trying the routes in turn until one serves the service description.
	 * That description needs no login, so wrong credentials cannot send the search the wrong way.
	 */
	async #locateTr064(address: BoxAddress): Promise<RouterReader> {
		let lastError: unknown
		for (const route of tr064Routes(address)) {
			const tr064 = await this.#tr064Client(address, route)
			try {
				await tr064.services()
			} catch (error) {
				// A refused login means this is the right place and the credentials are wrong; trying
				// the other route would only add a long wait before saying so.
				if (error instanceof Tr064AuthError) throw error
				this.log('debug', `TR-064 not found ${describeRoute(tr064)}: ${describe(error)}`)
				lastError = error
				continue
			}
			this.log('debug', `TR-064 found ${describeRoute(tr064)}`)
			// The UPnP IGD services need no login and only answer on the plain port in the home network.
			const igd =
				route === 'own-port'
					? new Tr064Client({
							host: address.host,
							port: this.tr064PlainPort,
							https: false,
							username: '',
							password: '',
							timeout: REQUEST_TIMEOUT_MS,
							descriptionPath: '/igddesc.xml',
						})
					: undefined
			return new RouterReader(tr064, igd)
		}
		throw lastError instanceof Error ? lastError : new Error('TR-064 could not be reached')
	}

	async #tr064Client(address: BoxAddress, route: Tr064Route): Promise<Tr064Client> {
		const common = {
			host: address.host,
			username: this.config.username,
			password: this.secrets.password,
			timeout: REQUEST_TIMEOUT_MS,
		}
		if (route === 'web-port') {
			return new Tr064Client({ ...common, port: address.port, https: true, pathPrefix: REMOTE_TR064_PREFIX })
		}
		if (!address.https) return new Tr064Client({ ...common, port: this.tr064PlainPort, https: false })
		return new Tr064Client({ ...common, port: await this.#securityPort(address.host), https: true })
	}

	/**
	 * Asks the box which port it serves TR-064 over HTTPS on. That one question needs no login.
	 * Kept short, because over the internet nothing answers there and the wait only delays the result.
	 */
	async #securityPort(host: string): Promise<number> {
		try {
			const plain = new Tr064Client({
				host,
				port: this.tr064PlainPort,
				https: false,
				username: '',
				password: '',
				timeout: PROBE_TIMEOUT_MS,
			})
			const result = await plain.call('DeviceInfo1', 'GetSecurityPort')
			return Number(result.NewSecurityPort) || DEFAULT_TR064_HTTPS_PORT
		} catch (error) {
			this.log('debug', `Could not read the TR-064 HTTPS port, using ${DEFAULT_TR064_HTTPS_PORT}: ${describe(error)}`)
			return DEFAULT_TR064_HTTPS_PORT
		}
	}

	#stop(): void {
		if (this.#routerTimer) clearInterval(this.#routerTimer)
		if (this.#smartHomeTimer) clearInterval(this.#smartHomeTimer)
		this.#routerTimer = undefined
		this.#smartHomeTimer = undefined
		for (const timer of this.#followUps) clearTimeout(timer)
		this.#followUps = []
		for (const timer of this.#reconnectChecks) clearTimeout(timer)
		this.#reconnectChecks = []
		for (const timer of this.#routerChecks) clearTimeout(timer)
		this.#routerChecks = []
	}

	async #pollRouter(): Promise<void> {
		const address = this.#address
		if (!address || !this.#session || this.#routerInFlight || Date.now() < this.#routerPausedUntil) return
		this.#routerInFlight = true
		const generation = this.#generation

		try {
			this.#reader ??= await this.#locateTr064(address)
			const reader = this.#reader
			if (generation !== this.#generation) return
			const problems = await reader.readFast(this.router)
			const fatal = problems.find(
				(problem) =>
					problem.error instanceof Tr064AuthError ||
					(ESSENTIAL_AREAS.has(problem.area) && !(problem.error instanceof Tr064Fault)),
			)
			if (generation !== this.#generation) return

			if (fatal) {
				this.#routerFailed(fatal)
				return
			}

			const now = Date.now()
			if (now - this.#lastSlowPoll >= SLOW_POLL_MS) {
				const withDeviceInfo = now - this.#lastDeviceInfo >= DEVICE_INFO_MS
				problems.push(...(await reader.readSlow(this.router, withDeviceInfo)))
				if (generation !== this.#generation) return
				this.#lastSlowPoll = now
				if (withDeviceInfo) this.#lastDeviceInfo = now
			}

			this.#reportProblems(problems)
			this.#clearProblem('router')
			if (!this.connected) this.log('info', `Connected to ${this.router.model || this.config.host}`)
			this.connected = true
			this.#setStatus('router', InstanceStatus.Ok)
			this.#rebuildDefinitionsIfNeeded()
			this.setVariableValues({
				...routerVariableValues(this.router),
				device_connected: 'true',
				device_web_url: webUrlFor(address),
			})
			this.checkFeedbacks(
				'connected',
				'internet_connected',
				'wan_link_up',
				'wlan_enabled',
				'host_active',
				'host_blocked',
				'throughput',
			)
		} catch (error) {
			if (generation === this.#generation) this.#routerFailed({ area: 'router', error })
		} finally {
			this.#routerInFlight = false
		}
	}

	#routerFailed(problem: ReadProblem): void {
		const auth = problem.error instanceof Tr064AuthError
		const message = describe(problem.error)
		if (auth) this.#routerPausedUntil = Date.now() + AUTH_RETRY_MS
		// A box that went away may come back on another route, e.g. after a VPN was switched off.
		else this.#reader = undefined
		this.#logProblem(
			'router',
			auth ? 'auth' : 'unreachable',
			'error',
			auth ? message : `FRITZ!Box not reachable: ${message}`,
		)
		this.#setStatus('router', auth ? InstanceStatus.AuthenticationFailure : InstanceStatus.ConnectionFailure, message)
		if (this.connected) this.#setDisconnected()
	}

	async #pollSmartHome(): Promise<void> {
		const client = this.#smartHomeClient
		if (!client || this.#smartHomeInFlight) return
		this.#smartHomeInFlight = true
		const generation = this.#generation

		try {
			const overview = await client.overview()
			if (generation !== this.#generation) return

			if (!this.smartHome.available) this.log('info', `Smart home: ${overview.units.length} units found`)
			this.#clearProblem('smarthome')
			this.smartHome.available = true
			this.smartHome.overview = overview
			this.#setStatus('smarthome', InstanceStatus.Ok)

			const fingerprint = overviewFingerprint(overview)
			if (fingerprint !== this.#smartHomeFingerprint) {
				this.#smartHomeFingerprint = fingerprint
				this.smartHome.namePrefixes = assignNamePrefixes(overview.units)
				this.#rebuildDefinitions()
			}
			this.setVariableValues(smartHomeVariableValues(this.smartHome))
			this.checkFeedbacks(
				'smarthome_available',
				'sh_on',
				'sh_connected',
				'sh_alert',
				'sh_reading',
				'sh_boost',
				'sh_window_open',
				'sh_battery_low',
				'sh_button_pressed',
				'sh_trigger_enabled',
			)
		} catch (error) {
			if (generation !== this.#generation) return
			this.#smartHomeFailed(error)
		} finally {
			this.#smartHomeInFlight = false
			if (this.#smartHomeAgain) {
				this.#smartHomeAgain = false
				void this.#pollSmartHome()
			}
		}
	}

	#smartHomeFailed(error: unknown): void {
		const wasAvailable = this.smartHome.available
		this.smartHome.available = false
		if (wasAvailable) this.checkFeedbacks('smarthome_available')

		if (error instanceof SmartHomeError && error.isNotAvailable) {
			const session = this.#session
			const endpoint = this.#smartHomeEndpoint
			if (this.#smartHomeClient?.kind === 'rest' && session && endpoint) {
				// FRITZ!OS before 8.20: no REST API, but the older AHA-HTTP interface does the same job.
				this.log('info', 'Smart home: this box has no Smart Home REST API, using the AHA-HTTP interface instead')
				this.#smartHomeClient = new AhaClient(endpoint, session)
				// This runs inside the failed read, so the next one starts when that has finished.
				this.#smartHomeAgain = true
				return
			}
			// Nothing will change until the firmware does, so stop asking.
			this.#logProblem('smarthome', 'missing', 'warn', 'This box offers no smart home interface')
			if (this.#smartHomeTimer) clearInterval(this.#smartHomeTimer)
			this.#smartHomeTimer = undefined
			this.#setStatus('smarthome', InstanceStatus.UnknownWarning, 'This box offers no smart home interface')
			return
		}
		if (error instanceof LoginRefusedError) {
			this.#logProblem('smarthome', 'login', 'error', error.message)
			this.#setStatus('smarthome', InstanceStatus.AuthenticationFailure, error.message)
			return
		}
		if (error instanceof SmartHomeError && error.isPermission) {
			const message = 'The FRITZ!Box user lacks the "Smart Home" right'
			this.#logProblem('smarthome', 'permission', 'error', `${message}: ${error.message}`)
			this.#setStatus('smarthome', InstanceStatus.AuthenticationFailure, message)
			return
		}
		const message = describe(error)
		this.#logProblem('smarthome', 'unreadable', 'warn', `Smart home not readable: ${message}`)
		this.#setStatus(
			'smarthome',
			error instanceof HttpTransportError ? InstanceStatus.ConnectionFailure : InstanceStatus.UnknownWarning,
			message,
		)
	}

	#scheduleFollowUps(): void {
		for (const timer of this.#followUps) clearTimeout(timer)
		this.#followUps = AFTER_ACTION_MS.map((delay) => setTimeout(() => void this.#pollSmartHome(), delay))
	}

	/** Rebuilds actions, feedbacks, presets and variables when the box shows a different set of things. */
	#rebuildDefinitionsIfNeeded(): void {
		const fingerprint = [
			routerShapeFingerprint(this.router),
			(this.router.hosts ?? [])
				.map((host) => `${host.mac}=${host.name}=${host.ip}`)
				.sort()
				.join(','),
		].join('|')
		if (fingerprint === this.#definitionsFingerprint) return
		this.#definitionsFingerprint = fingerprint
		this.#rebuildDefinitions()
	}

	#rebuildDefinitions(): void {
		this.updateVariableDefinitions()
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
	}

	#reportProblems(problems: ReadProblem[]): void {
		for (const { area, error } of problems) {
			const hint =
				error instanceof Tr064Fault && error.isMissingRight
					? ' (the user needs the "FRITZ!Box Settings" right)'
					: error instanceof Tr064Fault && error.isUnknownAction
						? ' (not offered by this box)'
						: ''
			this.#logOnce(`area:${area}`, 'debug', `Router status, ${area}: ${describe(error)}${hint}`)
		}
	}

	/**
	 * Logs a lasting problem once. While the same kind of problem goes on, e.g. the box stays
	 * unreachable while the error text changes from "reset" to "refused", the details only go to the
	 * debug log, so a night without the box does not fill the log.
	 */
	#logProblem(key: string, kind: string, level: 'warn' | 'error', message: string): void {
		if (this.#reported.get(key) === message) return
		const ongoing = this.#problemKinds.get(key) === kind
		this.#reported.set(key, message)
		this.#problemKinds.set(key, kind)
		this.log(ongoing ? 'debug' : level, message)
	}

	/** Ends a reported problem, so the next one is logged again in full. */
	#clearProblem(key: string): void {
		this.#reported.delete(key)
		this.#problemKinds.delete(key)
	}

	#logOnce(key: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
		if (this.#reported.get(key) === message) return
		this.#reported.set(key, message)
		this.log(level, message)
	}

	#setDisconnected(): void {
		this.connected = false
		this.setVariableValues({ device_connected: 'false', device_web_url: webUrlFor(this.#address) })
		this.checkFeedbacks('connected')
	}

	#setStatus(part: Part, status: InstanceStatus, message?: string): void {
		this.#status[part] = { status, message }
		const worst = [this.#status.router, this.#status.smarthome].sort(
			(a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3),
		)[0]
		if (worst) this.updateStatus(worst.status, worst.message ?? null)
	}
}

/**
 * The version of the module. The packaged build writes it into the manifest; in development the
 * manifest says 0.0.0 as Bitfocus asks, and package.json next to it has the real one.
 */
async function moduleVersion(): Promise<string> {
	for (const candidate of ['./companion/manifest.json', '../companion/manifest.json', '../package.json']) {
		try {
			const file = JSON.parse(await readFile(new URL(candidate, import.meta.url), 'utf8')) as { version?: string }
			if (file.version && file.version !== '0.0.0') return file.version
		} catch {
			// Try the next place.
		}
	}
	return 'unknown'
}

function describeRoute(client: Tr064Client): string {
	const { https, host, port, pathPrefix } = client.options
	return `at ${https ? 'https' : 'http'}://${host}:${port}${pathPrefix ?? ''}`
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

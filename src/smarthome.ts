import { httpCall, type HttpResponse } from './http.js'
import type { FritzSession, WebEndpoint } from './session.js'

/**
 * The subset of the FRITZ!OS Smart Home REST API (api/v0, FRITZ!OS 8.50) this module relies on.
 * Everything is optional unless the box always sends it, because the API documentation itself
 * warns that fields depend on the device and firmware.
 */

export type InterfaceState = 'valid' | 'unknown' | 'notConnected'

export interface SetPointTemperature {
	mode: 'temperature' | 'on' | 'off' | 'unknown'
	/** Real degrees Celsius, 8 to 28 in steps of 0.5, only with mode "temperature". */
	celsius?: number
}

export interface TimedMode {
	enabled: boolean
	/** Unix seconds, -1 for no end, null when the box has no valid time. */
	endTime?: number | null
}

export interface UnitInterfaces {
	onOffInterface?: {
		state?: InterfaceState
		active?: boolean
		outletState?: 'valid' | 'overcurrent' | 'relayStuck'
		isLockedDeviceLocal?: boolean
		isLockedDeviceApi?: boolean
	}
	levelControlInterface?: { state?: InterfaceState; level?: number }
	colorControlInterface?: {
		state?: InterfaceState
		hsColor?: { hue: number; saturation: number }
		colorTemperature?: number
		currentColorMode?: 'hueSaturation' | 'temperature' | 'unknown'
		supportedColorModes?: string[]
	}
	blindInterface?: {
		state?: InterfaceState
		blindAction?: 'moveUp' | 'moveDown' | 'stop'
		blindState?: string
	}
	thermostatInterface?: {
		state?: InterfaceState
		setPointTemperature?: SetPointTemperature
		comfortTemperature?: SetPointTemperature
		reducedTemperature?: SetPointTemperature
		boost?: TimedMode
		windowOpenMode?: TimedMode
		thermostatState?: string
		isLockedDeviceApi?: boolean
		isHolidayActive?: boolean
		isSummertimeActive?: boolean
		nextChange?: { changeTime?: number | null; temperatureChange?: SetPointTemperature }
	}
	temperatureInterface?: { state?: InterfaceState; celsius?: number; lastInfoTime?: number | null }
	humidityInterface?: { state?: InterfaceState; relativeHumidity?: number; lastInfoTime?: number | null }
	illuminanceInterface?: { state?: InterfaceState; lux?: number; lastInfoTime?: number | null }
	multimeterInterface?: {
		state?: InterfaceState
		/** Milliwatts. */
		power?: number
		/** Millivolts. */
		voltage?: number
		/** Milliamperes. */
		current?: number
		/** Watt hours. */
		energy?: number
	}
	alertInterface?: { state?: InterfaceState; alerts?: string[]; lastAlertTime?: number | null }
	/** One Becker example in the API documentation uses the singular; both are accepted. */
	alert?: { state?: InterfaceState; alerts?: string[]; lastAlertTime?: number | null }
	buttonInterface?: { state?: InterfaceState; lastEventTime?: number | null }
}

export interface ShDevice {
	UID: string
	ain?: string
	name: string
	productName?: string
	productCategory?: string
	manufacturer?: string
	firmwareVersion?: string
	unitUids?: string[]
	isConnected?: boolean
	batteryState?: 'known' | 'unknown'
	batteryValue?: number
	isBatteryLow?: boolean
}

export interface ShUnit {
	UID: string
	ain?: string
	name: string
	unitType: string
	isConnected?: boolean
	isGroupUnit?: boolean
	deviceUid?: string
	parentUid?: string
	groupUid?: string
	interfaces: UnitInterfaces
}

export interface ShGroup {
	UID: string
	name: string
	isConnected?: boolean
	groupCategory?: string
	unitUid?: string
	memberUnitUids?: string[]
}

export interface ShTemplate {
	UID: string
	name: string
	applyType?: string[]
	template?: { memberUnitUids?: string[]; isAutoCreated?: boolean; memberType?: string }
	scenario?: { templateUids?: string[]; type?: string }
}

export interface ShTrigger {
	UID: string
	name: string
	enabled: boolean
}

/** GET /smarthome/overview */
export interface ShOverview {
	devices: ShDevice[]
	units: ShUnit[]
	groups: ShGroup[]
	triggers: ShTrigger[]
	templates: ShTemplate[]
}

/** The body PUT to a unit: only the writable fields of the interfaces being changed. */
export interface ShUnitUpdate {
	onOffInterface?: { active: boolean }
	levelControlInterface?: { level: number }
	colorControlInterface?: { hsColor?: { hue: number; saturation: number }; colorTemperature?: number }
	blindInterface?: { blindAction: 'moveUp' | 'moveDown' | 'stop' }
	thermostatInterface?: {
		setPointTemperature?: SetPointTemperature
		boost?: TimedMode
		windowOpenMode?: TimedMode
	}
}

const API_BASE = '/api/v0/smarthome'

/** A refusal from the REST API, with the error codes it listed. */
export class SmartHomeError extends Error {
	readonly status: number
	readonly codes: number[]

	constructor(message: string, status: number, codes: number[] = []) {
		super(message)
		this.name = 'SmartHomeError'
		this.status = status
		this.codes = codes
	}

	/** The box has no REST API: FRITZ!OS before 8.20, or not a FRITZ!Box at all. */
	get isNotAvailable(): boolean {
		return this.status === 404 && this.codes.length === 0
	}

	/** The user lacks the Smart Home right (code 3001), or the session is not accepted. */
	get isPermission(): boolean {
		return this.status === 401 || this.status === 403 || this.codes.includes(3001)
	}
}

/** Reads the error list the REST API sends with a refusal. */
export function describeErrors(body: string): { codes: number[]; text: string } {
	try {
		const parsed = JSON.parse(body) as { errors?: { code?: number; field?: string; message?: string }[] }
		const errors = parsed.errors ?? []
		return {
			codes: errors.map((error) => Number(error.code)).filter((code) => Number.isFinite(code)),
			text: errors
				.map((error) => [error.code, error.message, error.field ? `(${error.field})` : ''].filter(Boolean).join(' '))
				.join('; '),
		}
	} catch {
		return { codes: [], text: body.slice(0, 200) }
	}
}

/**
 * The Smart Home REST API, authenticated through the shared web session.
 *
 * When the box no longer accepts the SID, the request is repeated once with a fresh login. A
 * second refusal is a real permission problem and is reported as such.
 */
/**
 * What the module needs from a smart home interface. The Smart Home REST API (FRITZ!OS 8.20 and
 * later) and the older AHA-HTTP interface both provide it, mapped onto the same model.
 */
export interface SmartHomeBackend {
	readonly kind: 'rest' | 'aha'
	overview(): Promise<ShOverview>
	/** What the box sent, for the diagnostics report. */
	rawOverview(): Promise<unknown>
	updateUnit(uid: string, interfaces: ShUnitUpdate): Promise<void>
	applyTemplate(uid: string): Promise<void>
	setTriggerEnabled(uid: string, enabled: boolean): Promise<void>
}

export class SmartHomeClient implements SmartHomeBackend {
	readonly kind = 'rest' as const
	readonly #endpoint: WebEndpoint
	readonly #session: FritzSession

	constructor(endpoint: WebEndpoint, session: FritzSession) {
		this.#endpoint = endpoint
		this.#session = session
	}

	async overview(): Promise<ShOverview> {
		const overview = await this.#json<Partial<ShOverview>>('GET', '/overview')
		return {
			devices: overview.devices ?? [],
			units: overview.units ?? [],
			groups: overview.groups ?? [],
			triggers: overview.triggers ?? [],
			templates: overview.templates ?? [],
		}
	}

	/** The overview as the box sent it, every field included, for the diagnostics report. */
	async rawOverview(): Promise<unknown> {
		return this.#json<unknown>('GET', '/overview')
	}

	async updateUnit(uid: string, interfaces: ShUnitUpdate): Promise<void> {
		await this.#json('PUT', `/overview/units/${encodeURIComponent(uid)}`, { interfaces })
	}

	async applyTemplate(uid: string): Promise<void> {
		await this.#json('POST', `/overview/templates/${encodeURIComponent(uid)}`, { triggerEvent: true })
	}

	async setTriggerEnabled(uid: string, enabled: boolean): Promise<void> {
		await this.#json('PUT', `/overview/triggers/${encodeURIComponent(uid)}`, { enabled })
	}

	async #json<T>(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<T> {
		let sid = await this.#session.sid()
		let res = await this.#send(method, path, sid, body)

		if (res.status === 401 || res.status === 403) {
			this.#session.invalidate(sid)
			sid = await this.#session.sid()
			res = await this.#send(method, path, sid, body)
		}

		if (res.status < 200 || res.status >= 300) {
			const { codes, text } = describeErrors(res.body)
			throw new SmartHomeError(
				`${method} ${path} answered HTTP ${res.status}${text ? `: ${text}` : ''}`,
				res.status,
				codes,
			)
		}

		if (res.body.trim() === '') return undefined as T
		return JSON.parse(res.body) as T
	}

	async #send(method: 'GET' | 'PUT' | 'POST', path: string, sid: string, body?: unknown): Promise<HttpResponse> {
		const headers: Record<string, string> = { Authorization: `AVM-SID ${sid}`, Accept: 'application/json' }
		const payload = body === undefined ? undefined : JSON.stringify(body)
		if (payload !== undefined) headers['Content-Type'] = 'application/json'
		return httpCall({ ...this.#endpoint, method, path: `${API_BASE}${path}`, headers, body: payload })
	}
}

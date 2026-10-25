import type { CompanionVariableValue, DropdownChoice } from '@companion-module/base'
import type { ShDevice, ShOverview, ShUnit, UnitInterfaces } from './smarthome.js'

/** The capabilities a unit can have, named after what a user would do with them. */
export type Capability =
	| 'onOff'
	| 'level'
	| 'color'
	| 'blind'
	| 'thermostat'
	| 'temperature'
	| 'humidity'
	| 'illuminance'
	| 'multimeter'
	| 'alert'
	| 'button'

const CAPABILITY_INTERFACE: Record<Capability, (keyof UnitInterfaces)[]> = {
	onOff: ['onOffInterface'],
	level: ['levelControlInterface'],
	color: ['colorControlInterface'],
	blind: ['blindInterface'],
	thermostat: ['thermostatInterface'],
	temperature: ['temperatureInterface'],
	humidity: ['humidityInterface'],
	illuminance: ['illuminanceInterface'],
	multimeter: ['multimeterInterface'],
	alert: ['alertInterface', 'alert'],
	button: ['buttonInterface'],
}

/**
 * Whether a unit offers a capability. Decided by the interfaces present, not by the unit type,
 * because the API documentation says the type is only a hint and devices may carry more.
 */
export function hasCapability(unit: ShUnit, capability: Capability): boolean {
	return CAPABILITY_INTERFACE[capability].some((key) => unit.interfaces?.[key] !== undefined)
}

export function capabilitiesOf(unit: ShUnit): Capability[] {
	return (Object.keys(CAPABILITY_INTERFACE) as Capability[]).filter((capability) => hasCapability(unit, capability))
}

/** Turns any text into the lower case letters, digits and underscores a variable id allows. */
export function slug(text: string): string {
	// German umlauts are spelled out the way Germans would type them, before other accents are dropped.
	return text
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
}

/** What the module keeps about the smart home between polls. */
export interface SmartHomeState {
	available: boolean
	overview: ShOverview
	/** Unit UID to the readable variable prefix, only for names no other unit shares. */
	namePrefixes: Map<string, string>
}

export function createSmartHomeState(): SmartHomeState {
	return {
		available: false,
		overview: { devices: [], units: [], groups: [], triggers: [], templates: [] },
		namePrefixes: new Map(),
	}
}

/** The stable variable prefix of a unit, built from its UID, which never changes. */
export function unitVarPrefix(unit: Pick<ShUnit, 'UID'>): string {
	return `smarthome_${slug(unit.UID)}`
}

/**
 * Readable prefixes built from the unit names, so a button can say $(fritz:smarthome_kitchen_power).
 * A name two units share gets no alias at all, rather than one of them silently winning.
 */
export function assignNamePrefixes(units: ShUnit[]): Map<string, string> {
	const counts = new Map<string, number>()
	const stable = new Set(units.map((unit) => unitVarPrefix(unit)))
	for (const unit of units) {
		const name = slug(unit.name)
		if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
	}
	const prefixes = new Map<string, string>()
	for (const unit of units) {
		const name = slug(unit.name)
		const prefix = `smarthome_${name}`
		// Skip names that would collide with each other or with any UID based prefix.
		if (!name || counts.get(name) !== 1 || stable.has(prefix)) continue
		prefixes.set(unit.UID, prefix)
	}
	return prefixes
}

export function findUnit(state: SmartHomeState, uid: string): ShUnit | undefined {
	const wanted = uid.trim()
	return (
		state.overview.units.find((unit) => unit.UID === wanted) ??
		// A name typed in, or coming from an expression, is accepted as well.
		state.overview.units.find((unit) => unit.name.toLowerCase() === wanted.toLowerCase())
	)
}

export function deviceOfUnit(state: SmartHomeState, unit: ShUnit): ShDevice | undefined {
	if (!unit.deviceUid) return undefined
	return state.overview.devices.find((device) => device.UID === unit.deviceUid)
}

/** The label of a unit in dropdowns: its name, plus the kind so groups and duplicates stand out. */
export function unitLabel(state: SmartHomeState, unit: ShUnit): string {
	if (unit.isGroupUnit) return `${unit.name} (group)`
	const device = deviceOfUnit(state, unit)
	if (device && device.name !== unit.name) return `${unit.name} (${device.name})`
	return device?.productName ? `${unit.name} (${device.productName})` : unit.name
}

export function unitChoices(state: SmartHomeState, capability?: Capability): DropdownChoice[] {
	const units = state.overview.units.filter((unit) => !capability || hasCapability(unit, capability))
	if (units.length === 0) {
		return [{ id: '', label: state.available ? 'No matching smart home device' : 'No smart home devices known yet' }]
	}
	return units
		.map((unit) => ({ id: unit.UID, label: unitLabel(state, unit) }))
		.sort((a, b) => a.label.localeCompare(b.label))
}

export function templateChoices(state: SmartHomeState): DropdownChoice[] {
	// Templates created automatically for preset scenarios are internal helpers; AVM asks clients to hide them.
	const templates = state.overview.templates.filter((template) => !template.template?.isAutoCreated)
	if (templates.length === 0) return [{ id: '', label: 'No templates or scenarios known yet' }]
	return templates
		.map((template) => ({
			id: template.UID,
			label: template.scenario ? `${template.name} (scenario)` : template.name,
		}))
		.sort((a, b) => a.label.localeCompare(b.label))
}

export function triggerChoices(state: SmartHomeState): DropdownChoice[] {
	if (state.overview.triggers.length === 0) return [{ id: '', label: 'No routines known yet' }]
	return state.overview.triggers.map((trigger) => ({ id: trigger.UID, label: trigger.name }))
}

/** A value from an interface, but only while the box marks that interface as valid. */
function valid<T extends { state?: string }>(iface: T | undefined): T | undefined {
	if (!iface) return undefined
	return iface.state === undefined || iface.state === 'valid' ? iface : undefined
}

export function isOn(unit: ShUnit | undefined): boolean | undefined {
	return valid(unit?.interfaces.onOffInterface)?.active
}

export function setPointOf(unit: ShUnit | undefined): number | undefined {
	const setPoint = valid(unit?.interfaces.thermostatInterface)?.setPointTemperature
	return setPoint?.mode === 'temperature' ? setPoint.celsius : undefined
}

/** The open/closed/alert states a unit currently reports, never including "none". */
export function activeAlerts(unit: ShUnit | undefined): string[] {
	const iface = valid(unit?.interfaces.alertInterface ?? unit?.interfaces.alert)
	return (iface?.alerts ?? []).filter((alert) => alert !== 'none' && alert !== 'unknown')
}

/** The numeric readings a unit can be compared against in a feedback. */
export type Reading =
	'temperature' | 'setpoint' | 'humidity' | 'power' | 'energy' | 'voltage' | 'level' | 'battery' | 'lux'

export const READINGS: { id: Reading; label: string }[] = [
	{ id: 'temperature', label: 'Temperature (°C)' },
	{ id: 'setpoint', label: 'Thermostat target (°C)' },
	{ id: 'humidity', label: 'Humidity (%)' },
	{ id: 'power', label: 'Power (W)' },
	{ id: 'energy', label: 'Energy (kWh)' },
	{ id: 'voltage', label: 'Voltage (V)' },
	{ id: 'level', label: 'Level / position (%)' },
	{ id: 'battery', label: 'Battery (%)' },
	{ id: 'lux', label: 'Illuminance (lx)' },
]

export function reading(state: SmartHomeState, unit: ShUnit | undefined, which: Reading): number | undefined {
	if (!unit) return undefined
	const i = unit.interfaces
	const meter = valid(i.multimeterInterface)
	switch (which) {
		case 'temperature':
			return valid(i.temperatureInterface)?.celsius
		case 'setpoint':
			return setPointOf(unit)
		case 'humidity':
			return valid(i.humidityInterface)?.relativeHumidity
		case 'power':
			return meter?.power === undefined ? undefined : round(meter.power / 1000, 2)
		case 'energy':
			return meter?.energy === undefined ? undefined : round(meter.energy / 1000, 3)
		case 'voltage':
			return meter?.voltage === undefined ? undefined : round(meter.voltage / 1000, 1)
		case 'level':
			return valid(i.levelControlInterface)?.level
		case 'battery': {
			const device = deviceOfUnit(state, unit)
			return device?.batteryState === 'known' ? device.batteryValue : undefined
		}
		case 'lux':
			return valid(i.illuminanceInterface)?.lux
	}
}

function round(value: number, digits: number): number {
	const factor = 10 ** digits
	return Math.round(value * factor) / factor
}

/** A unix timestamp as local HH:MM:SS, or empty when the box has none. */
function clock(timestamp: number | null | undefined): string {
	if (!timestamp || timestamp <= 0) return ''
	return new Date(timestamp * 1000).toLocaleTimeString('de-DE', { hour12: false })
}

/**
 * The variables published for a unit, by suffix.
 *
 * Only the suffixes matching the interfaces of the unit are published. No suffix may end in "_"
 * plus another suffix, otherwise a unit named "x" and one named "x_on" could write the same id.
 */
export const UNIT_SUFFIXES: { suffix: string; name: string; capability?: Capability }[] = [
	{ suffix: 'name', name: 'name' },
	{ suffix: 'connected', name: 'connected' },
	{ suffix: 'battery', name: 'battery in percent' },
	{ suffix: 'battery_low', name: 'battery low' },
	{ suffix: 'on', name: 'switched on', capability: 'onOff' },
	{ suffix: 'level', name: 'level or position in percent', capability: 'level' },
	{ suffix: 'hue', name: 'colour hue (0-359)', capability: 'color' },
	{ suffix: 'saturation', name: 'colour saturation (0-255)', capability: 'color' },
	{ suffix: 'kelvin', name: 'colour temperature in Kelvin', capability: 'color' },
	{ suffix: 'blind', name: 'last blind movement', capability: 'blind' },
	{ suffix: 'setpoint', name: 'thermostat target in °C', capability: 'thermostat' },
	{ suffix: 'mode', name: 'thermostat mode (temperature, on, off)', capability: 'thermostat' },
	{ suffix: 'boost', name: 'boost active', capability: 'thermostat' },
	{ suffix: 'window_open', name: 'window open mode active', capability: 'thermostat' },
	{ suffix: 'temperature', name: 'temperature in °C', capability: 'temperature' },
	{ suffix: 'humidity', name: 'humidity in percent', capability: 'humidity' },
	{ suffix: 'lux', name: 'illuminance in lux', capability: 'illuminance' },
	{ suffix: 'power', name: 'power in W', capability: 'multimeter' },
	{ suffix: 'energy', name: 'energy in kWh', capability: 'multimeter' },
	{ suffix: 'voltage', name: 'voltage in V', capability: 'multimeter' },
	{ suffix: 'current', name: 'current in A', capability: 'multimeter' },
	{ suffix: 'alert', name: 'alert state (e.g. open, closed, alert)', capability: 'alert' },
	{ suffix: 'last_press', name: 'time of the last button press', capability: 'button' },
]

/** The suffixes that apply to this unit. */
export function suffixesFor(unit: ShUnit): { suffix: string; name: string }[] {
	return UNIT_SUFFIXES.filter((entry) => !entry.capability || hasCapability(unit, entry.capability))
}

export function unitValues(state: SmartHomeState, unit: ShUnit): Record<string, CompanionVariableValue> {
	const i = unit.interfaces
	const device = deviceOfUnit(state, unit)
	const color = valid(i.colorControlInterface)
	const thermostat = valid(i.thermostatInterface)
	const meter = valid(i.multimeterInterface)
	const text = (value: number | undefined): CompanionVariableValue => value ?? ''
	const flag = (value: boolean | undefined): string => (value === undefined ? '' : String(value))

	const all: Record<string, CompanionVariableValue> = {
		name: unit.name,
		connected: String(unit.isConnected ?? device?.isConnected ?? false),
		battery: text(reading(state, unit, 'battery')),
		battery_low: flag(device?.isBatteryLow),
		on: flag(isOn(unit)),
		level: text(reading(state, unit, 'level')),
		hue: text(color?.hsColor?.hue),
		saturation: text(color?.hsColor?.saturation),
		kelvin: text(color?.colorTemperature),
		blind: valid(i.blindInterface)?.blindAction ?? '',
		setpoint: text(setPointOf(unit)),
		mode: thermostat?.setPointTemperature?.mode ?? '',
		boost: flag(thermostat?.boost?.enabled),
		window_open: flag(thermostat?.windowOpenMode?.enabled),
		temperature: text(reading(state, unit, 'temperature')),
		humidity: text(reading(state, unit, 'humidity')),
		lux: text(reading(state, unit, 'lux')),
		power: text(reading(state, unit, 'power')),
		energy: text(reading(state, unit, 'energy')),
		voltage: text(reading(state, unit, 'voltage')),
		current: meter?.current === undefined ? '' : round(meter.current / 1000, 3),
		alert: activeAlerts(unit).join(', ') || ((i.alertInterface ?? i.alert) ? 'none' : ''),
		last_press: clock(valid(i.buttonInterface)?.lastEventTime),
	}

	const values: Record<string, CompanionVariableValue> = {}
	for (const { suffix } of suffixesFor(unit)) values[suffix] = all[suffix] ?? ''
	return values
}

/** Identifies the set of units and their interfaces, to notice when definitions must be rebuilt. */
export function overviewFingerprint(overview: ShOverview): string {
	const units = overview.units.map((unit) => `${unit.UID}=${unit.name}:${capabilitiesOf(unit).join(',')}`)
	const templates = overview.templates.map((template) => `${template.UID}=${template.name}`)
	const triggers = overview.triggers.map((trigger) => `${trigger.UID}=${trigger.name}`)
	return [...units, '|', ...templates, '|', ...triggers].join(';')
}

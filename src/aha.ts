import { httpCall, type HttpResponse } from './http.js'
import type { FritzSession, WebEndpoint } from './session.js'
import {
	SmartHomeError,
	type SetPointTemperature,
	type ShDevice,
	type ShGroup,
	type ShOverview,
	type ShTemplate,
	type ShTrigger,
	type ShUnit,
	type ShUnitUpdate,
	type SmartHomeBackend,
	type UnitInterfaces,
} from './smarthome.js'
import { child, childNumber, children, childText, parseXml, xmlToJson, type XmlElement } from './xml.js'

/**
 * The old AHA-HTTP interface (webservices/homeautoswitch.lua), for boxes before FRITZ!OS 8.20
 * that have no Smart Home REST API. FRITZ! has frozen it but still ships it, also in FRITZ!OS 8.
 *
 * The device list is mapped onto the same model as the REST API, so actions, feedbacks,
 * variables and presets work the same whichever interface a box offers.
 */

const AHA_PATH = '/webservices/homeautoswitch.lua'

/** How a unit is switched: FRITZ! sockets know setswitchon/off, everything else setsimpleonoff. */
type SwitchKind = 'switch' | 'simpleonoff'

/** HAN-FUN unit types, named like the unit types of the REST API. */
const UNIT_TYPES: Record<number, string> = {
	256: 'simpleOnOffSwitchable',
	257: 'simpleOnOffSwitchable',
	262: 'acOutlet',
	263: 'acOutletSimplePowerMetering',
	264: 'simpleLight',
	265: 'dimmableLight',
	266: 'dimmerSwitch',
	273: 'simpleButton',
	277: 'colorBulb',
	278: 'dimmableColorBulb',
	281: 'blind',
	282: 'lamellar',
	512: 'simpleDetector',
	513: 'doorOpenCloseDetector',
	514: 'windowOpenCloseDetector',
	515: 'motionDetector',
	518: 'floodDetector',
	519: 'glassBreakDetector',
	520: 'vibrationDetector',
	640: 'siren',
}

/** Applymask entries of a template, named like the applyType values of the REST API. */
const APPLY_TYPES: Record<string, string> = {
	hkr_summer: 'thermostatOnOff',
	hkr_temperature: 'thermostatTemperature',
	hkr_holidays: 'thermostatHoliday',
	hkr_time_table: 'thermostatTimetable',
	relay_manual: 'relayManual',
	relay_automatic: 'relayAutomatic',
	level: 'level',
	color: 'color',
	dialhelper: 'dialHelper',
	sun_simulation: 'sunSimulation',
	sub_templates: 'subTemplates',
	main_wifi: 'mainWifi',
	guest_wifi: 'guestWifi',
	tam_control: 'tamControl',
	http_request: 'httpRequest',
	timer_control: 'timerControl',
	switch_master: 'switchMaster',
	custom_notification: 'customNotification',
}

/** A thermostat temperature in AHA units (half degrees, 253 off, 254 on) as the REST model has it. */
export function ahaSetPoint(value: number | undefined): SetPointTemperature {
	if (value === undefined) return { mode: 'unknown' }
	if (value === 253) return { mode: 'off' }
	if (value === 254) return { mode: 'on' }
	if (value >= 16 && value <= 56) return { mode: 'temperature', celsius: value / 2 }
	return { mode: 'unknown' }
}

/** The AHA parameter for a target temperature: half degrees from 16 (8 °C) to 56 (28 °C), 253 off, 254 on. */
export function ahaSetPointParam(setPoint: SetPointTemperature): number {
	if (setPoint.mode === 'off') return 253
	if (setPoint.mode === 'on') return 254
	const celsius = setPoint.celsius ?? 20
	return Math.min(56, Math.max(16, Math.round(celsius * 2)))
}

/** The result of reading the AHA lists: the shared model plus what each unit needs for switching. */
export interface AhaMapping {
	overview: ShOverview
	switchKinds: Map<string, SwitchKind>
}

const flag = (element: XmlElement | undefined, name: string): boolean | undefined => {
	const text = childText(element, name)
	return text === undefined ? undefined : text === '1'
}

/** Builds the interfaces one device, group or unit element offers. */
function interfacesOf(
	element: XmlElement,
	unitType: number | undefined,
): { interfaces: UnitInterfaces; switchKind?: SwitchKind } {
	const connected = childText(element, 'present') !== '0'
	const state = connected ? ('valid' as const) : ('notConnected' as const)
	const interfaces: UnitInterfaces = {}
	let switchKind: SwitchKind | undefined

	const sw = child(element, 'switch')
	if (sw) {
		const on = childText(sw, 'state')
		interfaces.onOffInterface = {
			state: on === undefined ? 'unknown' : state,
			...(on === undefined ? {} : { active: on === '1' }),
			isLockedDeviceApi: flag(sw, 'lock') ?? false,
			isLockedDeviceLocal: flag(sw, 'devicelock') ?? false,
		}
		switchKind = 'switch'
	}
	const simple = child(element, 'simpleonoff')
	if (simple && !sw) {
		const on = childText(simple, 'state')
		interfaces.onOffInterface = {
			state: on === undefined ? 'unknown' : state,
			...(on === undefined ? {} : { active: on === '1' }),
		}
		switchKind = 'simpleonoff'
	}

	const meter = child(element, 'powermeter')
	if (meter) {
		// AHA reports power in mW and voltage in mV, the same units as the REST API.
		interfaces.multimeterInterface = {
			state,
			power: childNumber(meter, 'power'),
			energy: childNumber(meter, 'energy'),
			voltage: childNumber(meter, 'voltage'),
		}
	}

	const hkr = child(element, 'hkr')
	const temperature = child(element, 'temperature')
	if (temperature) {
		const tenths = childNumber(temperature, 'celsius')
		interfaces.temperatureInterface = {
			state: tenths === undefined ? 'unknown' : state,
			...(tenths === undefined ? {} : { celsius: tenths / 10 }),
		}
	} else if (hkr) {
		const ist = childNumber(hkr, 'tist')
		if (ist !== undefined && ist <= 120) interfaces.temperatureInterface = { state, celsius: ist / 2 }
	}

	if (hkr) {
		interfaces.thermostatInterface = {
			state,
			setPointTemperature: ahaSetPoint(childNumber(hkr, 'tsoll')),
			comfortTemperature: ahaSetPoint(childNumber(hkr, 'komfort')),
			reducedTemperature: ahaSetPoint(childNumber(hkr, 'absenk')),
			boost: { enabled: flag(hkr, 'boostactive') ?? false, endTime: childNumber(hkr, 'boostactiveendtime') ?? null },
			windowOpenMode: {
				enabled: flag(hkr, 'windowopenactiv') ?? false,
				endTime: childNumber(hkr, 'windowopenactiveendtime') ?? null,
			},
			isHolidayActive: flag(hkr, 'holidayactive') ?? false,
			isSummertimeActive: flag(hkr, 'summeractive') ?? false,
			isLockedDeviceApi: flag(hkr, 'lock') ?? false,
		}
	}

	const level = child(element, 'levelcontrol')
	if (level) {
		const percent = childNumber(level, 'levelpercentage')
		const raw = childNumber(level, 'level')
		const value = percent ?? (raw === undefined ? undefined : Math.round((raw / 255) * 100))
		interfaces.levelControlInterface = {
			state: value === undefined ? 'unknown' : state,
			...(value === undefined ? {} : { level: value }),
		}
	}

	const color = child(element, 'colorcontrol')
	if (color) {
		const mode = color.attributes.current_mode
		const hue = childNumber(color, 'hue')
		const saturation = childNumber(color, 'saturation')
		const kelvin = childNumber(color, 'temperature')
		interfaces.colorControlInterface = {
			state,
			currentColorMode: mode === '1' ? 'hueSaturation' : mode === '4' ? 'temperature' : 'unknown',
			...(hue !== undefined && saturation !== undefined ? { hsColor: { hue, saturation } } : {}),
			...(kelvin !== undefined ? { colorTemperature: kelvin } : {}),
		}
	}

	const blind = child(element, 'blind')
	if (blind) {
		const set = childText(blind, 'endpositionsset')
		interfaces.blindInterface = {
			state,
			blindState: set === '1' ? 'endPositionConfigured' : set === '0' ? 'endPositionNotConfigured' : 'unknown',
		}
	}

	const alert = child(element, 'alert')
	if (alert) {
		const value = childNumber(alert, 'state')
		let alerts: string[] = []
		if (value !== undefined) {
			if (blind) {
				// On blinds the alert state is a bit mask: obstacle, motor overheated.
				if (value & 1) alerts.push('obstacle')
				if (value & 2) alerts.push('temperature')
				if (alerts.length === 0) alerts = ['none']
			} else if (unitType === 513 || unitType === 514) {
				alerts = [value === 1 ? 'open' : 'closed']
			} else {
				alerts = [value === 1 ? 'alert' : 'none']
			}
		}
		interfaces.alertInterface = {
			state: value === undefined ? 'unknown' : state,
			alerts,
			lastAlertTime: childNumber(alert, 'lastalertchgtimestamp') ?? null,
		}
	}

	const humidity = child(element, 'humidity') ?? child(child(element, 'avmbutton'), 'humidity')
	if (humidity) {
		const value = childNumber(humidity, 'rel_humidity')
		interfaces.humidityInterface = {
			state: value === undefined || value === -9999 ? 'unknown' : state,
			...(value === undefined || value === -9999 ? {} : { relativeHumidity: value }),
		}
	}

	// A button without its own identifier belongs to this element itself (e.g. a HAN-FUN button unit).
	const ownButton = children(element, 'button').find(
		(button) => !button.attributes.identifier || button.attributes.identifier === element.attributes.identifier,
	)
	if (ownButton) {
		interfaces.buttonInterface = { state, lastEventTime: childNumber(ownButton, 'lastpressedtimestamp') ?? null }
	}

	return { interfaces, ...(switchKind ? { switchKind } : {}) }
}

/** A unit type for an element without a HAN-FUN unit type, from what it can do. */
function guessUnitType(interfaces: UnitInterfaces, isGroup: boolean): string {
	if (isGroup) {
		if (interfaces.thermostatInterface) return 'thermostatGroup'
		if (interfaces.blindInterface) return 'blindGroup'
		if (interfaces.onOffInterface) return 'switchableGroup'
		return 'otherGroup'
	}
	if (interfaces.thermostatInterface) return 'avmThermostat'
	if (interfaces.onOffInterface && interfaces.multimeterInterface) return 'avmPlugSocket'
	if (interfaces.onOffInterface) return 'simpleOnOffSwitchable'
	if (interfaces.temperatureInterface) return 'simpleTemperatureSensor'
	return 'generic'
}

/** Maps the AHA device, template and trigger lists onto the model the module works with. */
export function mapAha(deviceXml: string, templateXml = '', triggerXml = ''): AhaMapping {
	const devices: ShDevice[] = []
	const units: ShUnit[] = []
	const groups: ShGroup[] = []
	const switchKinds = new Map<string, SwitchKind>()

	const list = child(parseXml(deviceXml), 'devicelist')
	const elements = list?.children.filter((entry) => entry.name === 'device' || entry.name === 'group') ?? []
	// HAN-FUN units name their device by its internal id, not by its identifier.
	const identifierById = new Map(
		elements.map((entry) => [entry.attributes.id ?? '', entry.attributes.identifier ?? '']),
	)
	const deviceByUid = new Map<string, ShDevice>()

	const addDevice = (element: XmlElement): ShDevice => {
		const uid = element.attributes.identifier ?? ''
		const battery = childNumber(element, 'battery')
		const device: ShDevice = {
			UID: uid,
			ain: uid,
			name: childText(element, 'name') ?? uid,
			productName: element.attributes.productname ?? '',
			manufacturer: element.attributes.manufacturer ?? '',
			firmwareVersion: element.attributes.fwversion ?? '',
			isConnected: childText(element, 'present') !== '0',
			batteryState: battery === undefined ? 'unknown' : 'known',
			...(battery === undefined ? {} : { batteryValue: battery }),
			...(childText(element, 'batterylow') === undefined
				? {}
				: { isBatteryLow: childText(element, 'batterylow') === '1' }),
			unitUids: [],
		}
		devices.push(device)
		deviceByUid.set(uid, device)
		return device
	}

	const addUnit = (unit: ShUnit, switchKind?: SwitchKind): void => {
		units.push(unit)
		if (switchKind) switchKinds.set(unit.UID, switchKind)
		if (unit.deviceUid) deviceByUid.get(unit.deviceUid)?.unitUids?.push(unit.UID)
	}

	// Devices first, so units can be attached to them whatever the order in the list.
	for (const element of elements) {
		if (element.name === 'device' && !child(element, 'etsiunitinfo')) addDevice(element)
	}

	for (const element of elements) {
		const uid = element.attributes.identifier ?? ''
		const name = childText(element, 'name') ?? uid
		const connected = childText(element, 'present') !== '0'
		const etsi = child(element, 'etsiunitinfo')

		if (element.name === 'group') {
			const { interfaces, switchKind } = interfacesOf(element, undefined)
			const members = (childText(child(element, 'groupinfo'), 'members') ?? '')
				.split(',')
				.map((id) => identifierById.get(id.trim()) ?? '')
				.filter(Boolean)
			groups.push({ UID: uid, name, isConnected: connected, unitUid: uid, memberUnitUids: members })
			addUnit(
				{
					UID: uid,
					ain: uid,
					name,
					unitType: guessUnitType(interfaces, true),
					isConnected: connected,
					isGroupUnit: true,
					parentUid: uid,
					interfaces,
				},
				switchKind,
			)
			continue
		}

		const unitTypeNumber = etsi ? Number(childText(etsi, 'unittype')) : undefined
		const { interfaces, switchKind } = interfacesOf(element, unitTypeNumber)
		const deviceUid = etsi ? (identifierById.get(childText(etsi, 'etsideviceid') ?? '') ?? uid) : uid
		const unitType =
			(unitTypeNumber !== undefined ? UNIT_TYPES[unitTypeNumber] : undefined) ?? guessUnitType(interfaces, false)

		// A HAN-FUN unit has no device element of its own; it shares the device of its parent.
		if (etsi && !deviceByUid.has(deviceUid)) addDevice(element)

		if (Object.keys(interfaces).length > 0) {
			addUnit(
				{
					UID: uid,
					ain: uid,
					name,
					unitType,
					isConnected: connected,
					isGroupUnit: false,
					deviceUid,
					parentUid: deviceUid,
					groupUid: '',
					interfaces,
				},
				switchKind,
			)
		}

		// FRITZ!DECT 400/440: each button is a unit of its own with its own identifier.
		for (const button of children(element, 'button')) {
			const buttonUid = button.attributes.identifier
			if (!buttonUid || buttonUid === uid) continue
			addUnit({
				UID: buttonUid,
				ain: buttonUid,
				name: childText(button, 'name') ?? buttonUid,
				unitType: 'avmButton',
				isConnected: connected,
				isGroupUnit: false,
				deviceUid: uid,
				parentUid: uid,
				groupUid: '',
				interfaces: {
					buttonInterface: {
						state: connected ? 'valid' : 'notConnected',
						lastEventTime: childNumber(button, 'lastpressedtimestamp') ?? null,
					},
				},
			})
		}
	}

	const templates: ShTemplate[] = children(child(parseXml(templateXml), 'templatelist'), 'template').map((template) => {
		const applyMask = child(template, 'applymask')
		const applyType = (applyMask?.children ?? []).map((entry) => APPLY_TYPES[entry.name] ?? entry.name)
		const scenario = applyType.includes('subTemplates')
		return {
			UID: template.attributes.identifier ?? '',
			name: childText(template, 'name') ?? template.attributes.identifier ?? '',
			applyType,
			template: { isAutoCreated: template.attributes.autocreate === '1' && !scenario },
			...(scenario
				? {
						scenario: {
							templateUids: children(child(template, 'sub_templates'), 'template').map(
								(sub) => sub.attributes.identifier ?? '',
							),
						},
					}
				: {}),
		}
	})

	const triggers: ShTrigger[] = children(child(parseXml(triggerXml), 'triggerlist'), 'trigger').map((trigger) => ({
		UID: trigger.attributes.identifier ?? '',
		name: childText(trigger, 'name') ?? trigger.attributes.identifier ?? '',
		enabled: trigger.attributes.active === '1',
	}))

	return { overview: { devices, units, groups, templates, triggers }, switchKinds }
}

export class AhaClient implements SmartHomeBackend {
	readonly kind = 'aha' as const
	readonly #endpoint: WebEndpoint
	readonly #session: FritzSession
	#switchKinds = new Map<string, SwitchKind>()

	constructor(endpoint: WebEndpoint, session: FritzSession) {
		this.#endpoint = endpoint
		this.#session = session
	}

	async overview(): Promise<ShOverview> {
		const [devices, templates, triggers] = await this.#lists()
		const mapping = mapAha(devices, templates, triggers)
		this.#switchKinds = mapping.switchKinds
		return mapping.overview
	}

	/** The three lists as plain objects, for the diagnostics report. */
	async rawOverview(): Promise<unknown> {
		const [devices, templates, triggers] = await this.#lists()
		// The root element of each list, not the document around it.
		const list = (xml: string, name: string): unknown => {
			const root = child(parseXml(xml), name)
			return root ? xmlToJson(root) : {}
		}
		return {
			devicelist: list(devices, 'devicelist'),
			templatelist: list(templates, 'templatelist'),
			triggerlist: list(triggers, 'triggerlist'),
		}
	}

	async updateUnit(uid: string, update: ShUnitUpdate): Promise<void> {
		// AHA sets one thing per request, so a combined update becomes a short sequence.
		if (update.onOffInterface) {
			const on = update.onOffInterface.active
			if (this.#switchKinds.get(uid) === 'switch')
				await this.#command(on ? 'setswitchon' : 'setswitchoff', { ain: uid })
			else await this.#command('setsimpleonoff', { ain: uid, onoff: on ? 1 : 0 })
		}
		if (update.levelControlInterface) {
			await this.#command('setlevelpercentage', { ain: uid, level: Math.round(update.levelControlInterface.level) })
		}
		const color = update.colorControlInterface
		if (color?.hsColor) {
			const params = { ain: uid, hue: color.hsColor.hue, saturation: color.hsColor.saturation, duration: 0 }
			try {
				await this.#command('setunmappedcolor', params)
			} catch {
				// Before FRITZ!OS 7.39 only the predefined colours of setcolor exist.
				await this.#command('setcolor', params)
			}
		}
		if (color?.colorTemperature !== undefined) {
			await this.#command('setcolortemperature', { ain: uid, temperature: color.colorTemperature, duration: 0 })
		}
		if (update.blindInterface) {
			const target = { moveUp: 'open', moveDown: 'close', stop: 'stop' }[update.blindInterface.blindAction]
			await this.#command('setblind', { ain: uid, target })
		}
		const thermostat = update.thermostatInterface
		if (thermostat?.setPointTemperature) {
			await this.#command('sethkrtsoll', { ain: uid, param: ahaSetPointParam(thermostat.setPointTemperature) })
		}
		if (thermostat?.boost) {
			await this.#command('sethkrboost', {
				ain: uid,
				endtimestamp: thermostat.boost.enabled ? (thermostat.boost.endTime ?? 0) : 0,
			})
		}
		if (thermostat?.windowOpenMode) {
			const end = thermostat.windowOpenMode.enabled ? (thermostat.windowOpenMode.endTime ?? 0) : 0
			await this.#command('sethkrwindowopen', { ain: uid, endtimestamp: end })
		}
	}

	async applyTemplate(uid: string): Promise<void> {
		await this.#command('applytemplate', { ain: uid })
	}

	async setTriggerEnabled(uid: string, enabled: boolean): Promise<void> {
		await this.#command('settriggeractive', { ain: uid, active: enabled ? 1 : 0 })
	}

	async #lists(): Promise<[string, string, string]> {
		const devices = await this.#command('getdevicelistinfos')
		// Templates and routines came later than the device list; boxes without them simply have none.
		const templates = await this.#command('gettemplatelistinfos').catch(() => '')
		const triggers = await this.#command('gettriggerlistinfos').catch(() => '')
		return [devices, templates, triggers]
	}

	async #command(switchcmd: string, params: Record<string, string | number> = {}): Promise<string> {
		let sid = await this.#session.sid()
		let res = await this.#send(switchcmd, params, sid)
		if (res.status === 403) {
			// AHA answers an expired session with 403.
			this.#session.invalidate(sid)
			sid = await this.#session.sid()
			res = await this.#send(switchcmd, params, sid)
		}
		if (res.status !== 200) {
			throw new SmartHomeError(`AHA ${switchcmd} answered HTTP ${res.status}`, res.status === 403 ? 401 : res.status)
		}
		const body = res.body.trim()
		if (body === 'inval') throw new SmartHomeError(`AHA ${switchcmd} was refused by the box (inval)`, 400)
		return body
	}

	async #send(switchcmd: string, params: Record<string, string | number>, sid: string): Promise<HttpResponse> {
		const query = new URLSearchParams({ switchcmd, sid })
		for (const [key, value] of Object.entries(params)) query.set(key, String(value))
		return httpCall({ ...this.#endpoint, method: 'GET', path: `${AHA_PATH}?${query.toString()}` })
	}
}

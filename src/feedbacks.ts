import { combineRgb, type CompanionInputFieldDropdown, type DropdownChoice } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { findHost, type RouterState } from './router.js'
import {
	activeAlerts,
	findUnit,
	isOn,
	READINGS,
	reading,
	triggerChoices,
	unitChoices,
	type Capability,
	type Reading,
	type SmartHomeState,
} from './shstate.js'

type NoOptions = Record<string, never>

export type Comparison = 'above' | 'below' | 'equal'
export type Direction = 'down' | 'up'

export type FeedbacksSchema = {
	connected: { type: 'boolean'; options: NoOptions }
	internet_connected: { type: 'boolean'; options: NoOptions }
	wan_link_up: { type: 'boolean'; options: NoOptions }
	wlan_enabled: { type: 'boolean'; options: { wlan: string } }
	host_active: { type: 'boolean'; options: { host: string } }
	host_blocked: { type: 'boolean'; options: { host: string } }
	throughput: { type: 'boolean'; options: { direction: Direction; comparison: Comparison; mbit: number } }
	smarthome_available: { type: 'boolean'; options: NoOptions }
	sh_on: { type: 'boolean'; options: { unit: string } }
	sh_connected: { type: 'boolean'; options: { unit: string } }
	sh_alert: { type: 'boolean'; options: { unit: string; alert: string } }
	sh_reading: { type: 'boolean'; options: { unit: string; reading: Reading; comparison: Comparison; value: number } }
	sh_boost: { type: 'boolean'; options: { unit: string } }
	sh_window_open: { type: 'boolean'; options: { unit: string } }
	sh_battery_low: { type: 'boolean'; options: { unit: string } }
	sh_button_pressed: { type: 'boolean'; options: { unit: string; seconds: number } }
	sh_trigger_enabled: { type: 'boolean'; options: { trigger: string } }
}

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 128, 0)
const RED = combineRgb(192, 0, 0)
const AMBER = combineRgb(200, 120, 0)
const BLUE = combineRgb(0, 80, 160)
const YELLOW = combineRgb(230, 200, 0)

export const COLORS = { WHITE, BLACK, GREEN, RED, AMBER, BLUE, YELLOW }

export const COMPARISONS: DropdownChoice<Comparison>[] = [
	{ id: 'above', label: 'is above' },
	{ id: 'below', label: 'is below' },
	{ id: 'equal', label: 'equals' },
]

export function compare(value: number | undefined, comparison: Comparison, threshold: number): boolean {
	if (value === undefined || !Number.isFinite(threshold)) return false
	if (comparison === 'above') return value > threshold
	if (comparison === 'below') return value < threshold
	return value === threshold
}

/** The unit field shared by actions and feedbacks, limited to units that can do the thing at hand. */
export function unitOption(sh: SmartHomeState, capability?: Capability): CompanionInputFieldDropdown<'unit'> {
	const choices = unitChoices(sh, capability)
	return {
		id: 'unit',
		type: 'dropdown',
		label: 'Smart home device',
		choices,
		default: String(choices[0]?.id ?? ''),
		allowCustom: true,
		tooltip: 'The list follows the devices and groups on the box. A unit UID or exact name can also be typed in.',
	}
}

/** WLAN choices: the guest network by role, the radios by band, since instance numbers vary between models. */
export function wlanChoices(router: RouterState, withAll = true): DropdownChoice[] {
	const choices: DropdownChoice[] = [{ id: 'guest', label: 'Guest WLAN' }]
	if (withAll) choices.push({ id: 'all', label: 'All WLAN (like the WLAN button)' })
	for (const wlan of router.wlans) {
		if (wlan.guest) continue
		choices.push({ id: wlan.serviceId, label: `WLAN ${wlan.band || wlan.index}${wlan.ssid ? ` (${wlan.ssid})` : ''}` })
	}
	if (withAll) choices.push({ id: 'any', label: 'Any WLAN except guest' })
	return choices
}

export function wlanEnabled(router: RouterState, which: string): boolean {
	if (which === 'guest') return router.wlans.some((wlan) => wlan.guest && wlan.enabled)
	if (which === 'any') return router.wlans.some((wlan) => !wlan.guest && wlan.enabled)
	if (which === 'all') return router.wlanGlobalEnabled ?? router.wlans.some((wlan) => wlan.enabled)
	return router.wlans.find((wlan) => wlan.serviceId === which)?.enabled ?? false
}

export function hostChoices(router: RouterState): DropdownChoice[] {
	if (!router.hosts || router.hosts.length === 0) return [{ id: '', label: 'No network devices known yet' }]
	return router.hosts
		.filter((host) => host.mac)
		.map((host) => ({ id: host.mac, label: `${host.name || host.ip || host.mac} (${host.mac})` }))
		.sort((a, b) => a.label.localeCompare(b.label))
}

const ALERT_CHOICES: DropdownChoice[] = [
	{ id: 'any', label: 'Any alert or open' },
	{ id: 'open', label: 'Open (window or door contact)' },
	{ id: 'closed', label: 'Closed (window or door contact)' },
	{ id: 'alert', label: 'Alert' },
	{ id: 'motion', label: 'Motion' },
	{ id: 'smoke', label: 'Smoke' },
	{ id: 'flood', label: 'Flood' },
	{ id: 'gas', label: 'Gas' },
	{ id: 'temperature', label: 'Temperature alert' },
	{ id: 'obstacle', label: 'Obstacle (blind)' },
	{ id: 'glassBreak', label: 'Glass break' },
	{ id: 'vibration', label: 'Vibration' },
]

export function alertMatches(alerts: string[], wanted: string): boolean {
	if (wanted === 'any') return alerts.some((alert) => alert !== 'closed')
	return alerts.includes(wanted)
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	const sh = self.smartHome
	const router = self.router

	self.setFeedbackDefinitions({
		connected: {
			name: 'Connected to the FRITZ!Box',
			description: 'Active while the module can read the router status',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => self.connected,
		},

		internet_connected: {
			name: 'Internet connected',
			description: 'Active while the internet connection of the box is up',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => self.router.connectionStatus === 'Connected',
		},

		wan_link_up: {
			name: 'Internet line synchronised',
			description: 'Active while the physical line (DSL, fibre, cable) is up, even before a connection is made',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => self.router.physicalLinkStatus === 'Up',
		},

		wlan_enabled: {
			name: 'WLAN enabled',
			description: 'Active while the chosen WLAN is switched on',
			type: 'boolean',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [
				{
					id: 'wlan',
					type: 'dropdown',
					label: 'WLAN',
					choices: wlanChoices(router),
					default: 'guest',
					allowCustom: true,
				},
			],
			callback: (feedback) => wlanEnabled(self.router, feedback.options.wlan),
		},

		host_active: {
			name: 'Network device online',
			description: 'Active while the box reports this device as active in the home network',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{
					id: 'host',
					type: 'dropdown',
					label: 'Device',
					choices: hostChoices(router),
					default: String(hostChoices(router)[0]?.id ?? ''),
					allowCustom: true,
					tooltip: 'Pick a device, or type a MAC address, IP address or the name shown on the box',
				},
			],
			callback: (feedback) => findHost(self.router.hosts, feedback.options.host)?.active ?? false,
		},

		host_blocked: {
			name: 'Network device: internet blocked',
			description: 'Active while the internet access of this device is blocked on the box',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				{
					id: 'host',
					type: 'dropdown',
					label: 'Device',
					choices: hostChoices(router),
					default: String(hostChoices(router)[0]?.id ?? ''),
					allowCustom: true,
					tooltip: 'Pick a device, or type a MAC address, IP address or the name shown on the box',
				},
			],
			callback: (feedback) => findHost(self.router.hosts, feedback.options.host)?.blocked ?? false,
		},

		throughput: {
			name: 'Internet throughput',
			description: 'Compares the current download or upload with a value in Mbit/s',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [
				{
					id: 'direction',
					type: 'dropdown',
					label: 'Direction',
					choices: [
						{ id: 'down', label: 'Download' },
						{ id: 'up', label: 'Upload' },
					],
					default: 'down',
					disableAutoExpression: true,
				},
				{
					id: 'comparison',
					type: 'dropdown',
					label: 'Condition',
					choices: COMPARISONS,
					default: 'above',
					disableAutoExpression: true,
				},
				{ id: 'mbit', type: 'number', label: 'Mbit/s', default: 10, min: 0, max: 100000, step: 0.1 },
			],
			callback: (feedback) => {
				const bytes = feedback.options.direction === 'up' ? self.router.rateUp : self.router.rateDown
				const mbit = bytes === undefined ? undefined : (bytes * 8) / 1_000_000
				return compare(mbit, feedback.options.comparison, Number(feedback.options.mbit))
			},
		},

		smarthome_available: {
			name: 'Smart home reachable',
			description: 'Active while the smart home overview can be read',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [],
			callback: () => self.smartHome.available,
		},

		sh_on: {
			name: 'Smart home: switched on',
			description: 'Active while a socket, lamp, switch or group is on',
			type: 'boolean',
			defaultStyle: { bgcolor: YELLOW, color: BLACK },
			options: [unitOption(sh, 'onOff')],
			callback: (feedback) => isOn(findUnit(self.smartHome, feedback.options.unit)) ?? false,
		},

		sh_connected: {
			name: 'Smart home: device reachable',
			description: 'Active while the box has radio contact with the device',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [unitOption(sh)],
			callback: (feedback) => findUnit(self.smartHome, feedback.options.unit)?.isConnected ?? false,
		},

		sh_alert: {
			name: 'Smart home: alert or contact state',
			description: 'Active while a sensor reports the chosen state, e.g. a window contact reports open',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [
				unitOption(sh, 'alert'),
				{
					id: 'alert',
					type: 'dropdown',
					label: 'State',
					choices: ALERT_CHOICES,
					default: 'any',
					disableAutoExpression: true,
				},
			],
			callback: (feedback) =>
				alertMatches(activeAlerts(findUnit(self.smartHome, feedback.options.unit)), feedback.options.alert),
		},

		sh_reading: {
			name: 'Smart home: compare a reading',
			description: 'Compares temperature, power, humidity and similar readings with a value',
			type: 'boolean',
			defaultStyle: { bgcolor: AMBER, color: WHITE },
			options: [
				unitOption(sh),
				{
					id: 'reading',
					type: 'dropdown',
					label: 'Reading',
					choices: READINGS,
					default: 'temperature',
					disableAutoExpression: true,
				},
				{
					id: 'comparison',
					type: 'dropdown',
					label: 'Condition',
					choices: COMPARISONS,
					default: 'above',
					disableAutoExpression: true,
				},
				{ id: 'value', type: 'number', label: 'Value', default: 20, min: -100, max: 1000000, step: 0.1 },
			],
			callback: (feedback) =>
				compare(
					reading(self.smartHome, findUnit(self.smartHome, feedback.options.unit), feedback.options.reading),
					feedback.options.comparison,
					Number(feedback.options.value),
				),
		},

		sh_boost: {
			name: 'Smart home: thermostat boost active',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [unitOption(sh, 'thermostat')],
			callback: (feedback) =>
				findUnit(self.smartHome, feedback.options.unit)?.interfaces.thermostatInterface?.boost?.enabled ?? false,
		},

		sh_window_open: {
			name: 'Smart home: thermostat window open mode',
			type: 'boolean',
			defaultStyle: { bgcolor: BLUE, color: WHITE },
			options: [unitOption(sh, 'thermostat')],
			callback: (feedback) =>
				findUnit(self.smartHome, feedback.options.unit)?.interfaces.thermostatInterface?.windowOpenMode?.enabled ??
				false,
		},

		sh_battery_low: {
			name: 'Smart home: battery low',
			type: 'boolean',
			defaultStyle: { bgcolor: RED, color: WHITE },
			options: [unitOption(sh)],
			callback: (feedback) => {
				const unit = findUnit(self.smartHome, feedback.options.unit)
				const device = self.smartHome.overview.devices.find((d) => d.UID === unit?.deviceUid)
				return device?.isBatteryLow ?? false
			},
		},

		sh_button_pressed: {
			name: 'Smart home: button pressed recently',
			description:
				'Active for a number of seconds after a FRITZ! button was pressed. The box is read at the smart ' +
				'home interval, so a press shows up with up to that much delay.',
			type: 'boolean',
			defaultStyle: { bgcolor: YELLOW, color: BLACK },
			options: [
				unitOption(sh, 'button'),
				{ id: 'seconds', type: 'number', label: 'Stay active for (s)', default: 10, min: 1, max: 3600 },
			],
			callback: (feedback) => {
				const last = findUnit(self.smartHome, feedback.options.unit)?.interfaces.buttonInterface?.lastEventTime
				if (!last || last <= 0) return false
				return Date.now() - last * 1000 < Number(feedback.options.seconds) * 1000
			},
		},

		sh_trigger_enabled: {
			name: 'Smart home: routine enabled',
			type: 'boolean',
			defaultStyle: { bgcolor: GREEN, color: WHITE },
			options: [
				{
					id: 'trigger',
					type: 'dropdown',
					label: 'Routine',
					choices: triggerChoices(sh),
					default: String(triggerChoices(sh)[0]?.id ?? ''),
					allowCustom: true,
				},
			],
			callback: (feedback) =>
				self.smartHome.overview.triggers.find((trigger) => trigger.UID === feedback.options.trigger)?.enabled ?? false,
		},
	})
}

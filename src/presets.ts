import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import { COLORS } from './feedbacks.js'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { hasCapability, slug, templateChoices, unitVarPrefix } from './shstate.js'

const { WHITE, BLACK, GREEN, RED, AMBER, BLUE, YELLOW } = COLORS
const GREY = 0x282828

export function UpdatePresets(self: ModuleInstance): void {
	// Variables are addressed by the connection's label, which the user can change at any time.
	const v = (name: string): string => `$(${self.label}:${name})`
	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		status_internet: {
			type: 'simple',
			name: 'Internet connection',
			keywords: ['internet', 'wan', 'online', 'status'],
			style: {
				text: `Internet\n${v('connection_wan1_status')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: RED,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [{ feedbackId: 'internet_connected', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
		},
		status_ipv4: {
			type: 'simple',
			name: 'External IPv4 address',
			keywords: ['ip', 'address', 'wan'],
			style: { text: `IPv4\n${v('connection_wan1_ipv4')}`, size: '7', color: WHITE, bgcolor: GREY, show_topbar: false },
			steps: [],
			feedbacks: [],
		},
		status_rate_down: {
			type: 'simple',
			name: 'Current download',
			keywords: ['download', 'throughput', 'bandwidth'],
			style: {
				text: `⬇ Mbit/s\n${v('connection_wan1_rate_down_mbit')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},
		status_rate_up: {
			type: 'simple',
			name: 'Current upload',
			keywords: ['upload', 'throughput', 'bandwidth'],
			style: {
				text: `⬆ Mbit/s\n${v('connection_wan1_rate_up_mbit')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},
		status_wan_uptime: {
			type: 'simple',
			name: 'Internet connection uptime',
			keywords: ['uptime', 'wan'],
			style: {
				text: `Online\n${v('connection_wan1_uptime')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [{ feedbackId: 'internet_connected', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
		},
		status_guest_wlan: {
			type: 'simple',
			name: 'Guest WLAN on/off',
			keywords: ['wlan', 'wifi', 'guest'],
			style: {
				text: `Guest WLAN\n${v('wlan_guest_ssid')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'wlan_switch', options: { wlan: 'guest', mode: 'toggle' } }], up: [] }],
			feedbacks: [{ feedbackId: 'wlan_enabled', options: { wlan: 'guest' }, style: { bgcolor: BLUE, color: WHITE } }],
		},
		status_guest_password: {
			type: 'simple',
			name: 'Guest WLAN name and password',
			keywords: ['wlan', 'wifi', 'guest', 'password'],
			style: {
				text: `${v('wlan_guest_ssid')}\n${v('wlan_guest_password')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [{ feedbackId: 'wlan_enabled', options: { wlan: 'guest' }, style: { bgcolor: BLUE, color: WHITE } }],
		},
		status_wlan_clients: {
			type: 'simple',
			name: 'WLAN clients',
			keywords: ['wlan', 'wifi', 'clients'],
			style: {
				text: `WLAN clients\n${v('wlan_clients_total')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},
		status_hosts: {
			type: 'simple',
			name: 'Active network devices',
			keywords: ['hosts', 'devices', 'network'],
			style: {
				text: `Devices\n${v('lan_hosts_active')}`,
				size: 'auto',
				color: WHITE,
				bgcolor: GREY,
				show_topbar: false,
			},
			steps: [],
			feedbacks: [],
		},
		status_box: {
			type: 'simple',
			name: 'Box model and connection',
			keywords: ['model', 'firmware', 'status'],
			style: {
				text: `${v('device_model')}\n${v('device_firmware')}`,
				size: '7',
				color: WHITE,
				bgcolor: RED,
				show_topbar: false,
			},
			steps: [{ down: [{ actionId: 'refresh', options: {} }], up: [] }],
			feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: GREEN, color: WHITE } }],
		},
	}

	const sh = self.smartHome
	const unitPresetIds: string[] = []
	const sensorPresetIds: string[] = []

	for (const unit of sh.overview.units) {
		const id = `sh_${slug(unit.UID)}`
		const p = unitVarPrefix(unit)
		const keywords = ['smart home', unit.name]

		if (hasCapability(unit, 'onOff')) {
			const extra = hasCapability(unit, 'multimeter') ? `\n${v(`${p}_power`)} W` : ''
			presets[`${id}_toggle`] = {
				type: 'simple',
				name: `${unit.name}: toggle`,
				keywords: [...keywords, 'switch', 'toggle'],
				style: { text: `${unit.name}${extra}`, size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
				steps: [{ down: [{ actionId: 'sh_switch', options: { unit: unit.UID, mode: 'toggle' } }], up: [] }],
				feedbacks: [{ feedbackId: 'sh_on', options: { unit: unit.UID }, style: { bgcolor: YELLOW, color: BLACK } }],
			}
			unitPresetIds.push(`${id}_toggle`)
		}

		if (hasCapability(unit, 'thermostat')) {
			const current = hasCapability(unit, 'temperature') ? `${v(`${p}_temperature`)}° → ` : ''
			presets[`${id}_thermostat`] = {
				type: 'simple',
				name: `${unit.name}: temperature`,
				keywords: [...keywords, 'thermostat', 'heating'],
				style: {
					text: `${unit.name}\n${current}${v(`${p}_setpoint`)}°`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
					show_topbar: false,
				},
				steps: [{ down: [{ actionId: 'sh_boost', options: { unit: unit.UID, mode: 'toggle', minutes: 30 } }], up: [] }],
				feedbacks: [
					{ feedbackId: 'sh_window_open', options: { unit: unit.UID }, style: { bgcolor: BLUE, color: WHITE } },
					{ feedbackId: 'sh_boost', options: { unit: unit.UID }, style: { bgcolor: RED, color: WHITE } },
				],
			}
			for (const [suffix, mode, label] of [
				['up', 'increase', '+0.5°'],
				['down', 'decrease', '-0.5°'],
			] as const) {
				presets[`${id}_setpoint_${suffix}`] = {
					type: 'simple',
					name: `${unit.name}: ${label}`,
					keywords: [...keywords, 'thermostat'],
					style: { text: `${unit.name}\n${label}`, size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
					steps: [{ down: [{ actionId: 'sh_setpoint', options: { unit: unit.UID, mode, value: 0.5 } }], up: [] }],
					feedbacks: [],
				}
			}
			unitPresetIds.push(`${id}_thermostat`, `${id}_setpoint_up`, `${id}_setpoint_down`)
		}

		if (hasCapability(unit, 'blind')) {
			for (const [suffix, command, label] of [
				['up', 'moveUp', '▲'],
				['stop', 'stop', '■'],
				['down', 'moveDown', '▼'],
			] as const) {
				presets[`${id}_blind_${suffix}`] = {
					type: 'simple',
					name: `${unit.name}: ${suffix}`,
					keywords: [...keywords, 'blind', 'shutter'],
					style: { text: `${unit.name}\n${label}`, size: 'auto', color: WHITE, bgcolor: BLACK, show_topbar: false },
					steps: [{ down: [{ actionId: 'sh_blind', options: { unit: unit.UID, command } }], up: [] }],
					feedbacks: [],
				}
				unitPresetIds.push(`${id}_blind_${suffix}`)
			}
		}

		if (hasCapability(unit, 'alert')) {
			presets[`${id}_alert`] = {
				type: 'simple',
				name: `${unit.name}: state`,
				keywords: [...keywords, 'alert', 'window', 'door'],
				style: {
					text: `${unit.name}\n${v(`${p}_alert`)}`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
					show_topbar: false,
				},
				steps: [],
				feedbacks: [
					{ feedbackId: 'sh_alert', options: { unit: unit.UID, alert: 'any' }, style: { bgcolor: RED, color: WHITE } },
				],
			}
			sensorPresetIds.push(`${id}_alert`)
		}

		if (!hasCapability(unit, 'thermostat') && hasCapability(unit, 'temperature')) {
			const humidity = hasCapability(unit, 'humidity') ? `\n${v(`${p}_humidity`)} %` : ''
			presets[`${id}_temperature`] = {
				type: 'simple',
				name: `${unit.name}: temperature`,
				keywords: [...keywords, 'temperature', 'sensor'],
				style: {
					text: `${unit.name}\n${v(`${p}_temperature`)} °C${humidity}`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
					show_topbar: false,
				},
				steps: [],
				feedbacks: [],
			}
			sensorPresetIds.push(`${id}_temperature`)
		}

		if (hasCapability(unit, 'button')) {
			presets[`${id}_button`] = {
				type: 'simple',
				name: `${unit.name}: pressed`,
				keywords: [...keywords, 'button'],
				style: {
					text: `${unit.name}\n${v(`${p}_last_press`)}`,
					size: 'auto',
					color: WHITE,
					bgcolor: GREY,
					show_topbar: false,
				},
				steps: [],
				feedbacks: [
					{
						feedbackId: 'sh_button_pressed',
						options: { unit: unit.UID, seconds: 10 },
						style: { bgcolor: YELLOW, color: BLACK },
					},
				],
			}
			sensorPresetIds.push(`${id}_button`)
		}
	}

	const templatePresetIds: string[] = []
	for (const choice of templateChoices(sh)) {
		if (!choice.id) continue
		const id = `template_${slug(String(choice.id))}`
		presets[id] = {
			type: 'simple',
			name: `Apply ${choice.label}`,
			keywords: ['smart home', 'template', 'scenario', choice.label],
			style: { text: choice.label, size: 'auto', color: WHITE, bgcolor: AMBER, show_topbar: false },
			steps: [{ down: [{ actionId: 'sh_apply_template', options: { template: String(choice.id) } }], up: [] }],
			feedbacks: [],
		}
		templatePresetIds.push(id)
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'router',
			name: 'Router status',
			description: 'Internet connection, addresses, throughput, WLAN and network devices',
			definitions: [
				'status_internet',
				'status_ipv4',
				'status_rate_down',
				'status_rate_up',
				'status_wan_uptime',
				'status_guest_wlan',
				'status_guest_password',
				'status_wlan_clients',
				'status_hosts',
				'status_box',
			],
		},
	]
	if (unitPresetIds.length > 0) {
		structure.push({
			id: 'smarthome',
			name: 'Smart home control',
			description: 'Switches, thermostats and blinds on the box',
			definitions: unitPresetIds,
		})
	}
	if (sensorPresetIds.length > 0) {
		structure.push({
			id: 'sensors',
			name: 'Smart home sensors',
			description: 'Contacts, alarms, temperature sensors and buttons',
			definitions: sensorPresetIds,
		})
	}
	if (templatePresetIds.length > 0) {
		structure.push({
			id: 'templates',
			name: 'Templates and scenarios',
			description: 'Buttons running a template or scenario configured on the box',
			definitions: templatePresetIds,
		})
	}

	self.setPresetDefinitions(structure, presets)
}

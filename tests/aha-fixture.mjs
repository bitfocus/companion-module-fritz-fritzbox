// The AHA-HTTP interface of the fake box: an older FRITZ!Box without the Smart Home REST API.
// The device list covers the kinds of elements the AHA documentation describes: a FRITZ! socket,
// a thermostat, a HAN-FUN window contact (device plus unit), a colour bulb unit, a FRITZ!DECT 440
// with a button of its own, a group, templates and a routine.

export function initialAhaState() {
	return {
		socketOn: 0,
		tsoll: 42,
		boostEnd: 0,
		windowEnd: 0,
		bulbOn: 1,
		bulbLevel: 80,
		triggerActive: 1,
		commands: [],
	}
}

export function ahaDeviceList(s) {
	return `<?xml version="1.0" encoding="utf-8"?>
<devicelist version="1" fwversion="7.57">
 <device identifier="08761 0000434" id="17" functionbitmask="35712" fwversion="04.25" manufacturer="AVM" productname="FRITZ!DECT 200">
  <present>1</present><txbusy>0</txbusy><name>Beamer &amp; Leinwand</name>
  <switch><state>${s.socketOn}</state><mode>manuell</mode><lock>0</lock><devicelock>0</devicelock></switch>
  <simpleonoff><state>${s.socketOn}</state></simpleonoff>
  <powermeter><voltage>229512</voltage><power>${s.socketOn ? 123450 : 0}</power><energy>15320</energy></powermeter>
  <temperature><celsius>225</celsius><offset>0</offset></temperature>
 </device>
 <device identifier="09995 0123456" id="18" functionbitmask="320" fwversion="05.16" manufacturer="AVM" productname="FRITZ!DECT 301">
  <present>1</present><txbusy>0</txbusy><name>Heizung Saal</name><battery>70</battery><batterylow>0</batterylow>
  <temperature><celsius>195</celsius><offset>0</offset></temperature>
  <hkr><tist>39</tist><tsoll>${s.tsoll}</tsoll><absenk>32</absenk><komfort>42</komfort><lock>0</lock><devicelock>0</devicelock>
   <errorcode>0</errorcode><windowopenactiv>${s.windowEnd ? 1 : 0}</windowopenactiv><windowopenactiveendtime>${s.windowEnd}</windowopenactiveendtime>
   <boostactive>${s.boostEnd ? 1 : 0}</boostactive><boostactiveendtime>${s.boostEnd}</boostactiveendtime><batterylow>0</batterylow><battery>70</battery>
   <nextchange><endperiod>0</endperiod><tchange>255</tchange></nextchange><summeractive>0</summeractive><holidayactive>0</holidayactive></hkr>
 </device>
 <device identifier="11934 0059978" id="406" functionbitmask="1" fwversion="00.00" manufacturer="0x2c3c" productname="HAN-FUN">
  <present>1</present><txbusy>0</txbusy><name>Fensterkontakt Saal</name><battery>15</battery><batterylow>1</batterylow>
 </device>
 <device identifier="11934 0059978-1" id="2000" functionbitmask="8208" fwversion="0.0" manufacturer="0x2c3c" productname="HAN-FUN">
  <present>1</present><txbusy>0</txbusy><name>Fensterkontakt Saal</name>
  <etsiunitinfo><etsideviceid>406</etsideviceid><unittype>514</unittype><interfaces>256</interfaces></etsiunitinfo>
  <alert><state>1</state><lastalertchgtimestamp>1760000000</lastalertchgtimestamp></alert>
 </device>
 <device identifier="13077 0000060" id="410" functionbitmask="1" fwversion="34.10.16.16.009" manufacturer="AVM" productname="FRITZ!DECT 500">
  <present>1</present><txbusy>0</txbusy><name>Bühnenlicht</name>
 </device>
 <device identifier="13077 0000060-1" id="2001" functionbitmask="237572" fwversion="0.0" manufacturer="AVM" productname="FRITZ!DECT 500">
  <present>1</present><txbusy>0</txbusy><name>Bühnenlicht</name>
  <simpleonoff><state>${s.bulbOn}</state></simpleonoff>
  <levelcontrol><level>${Math.round((s.bulbLevel * 255) / 100)}</level><levelpercentage>${s.bulbLevel}</levelpercentage></levelcontrol>
  <colorcontrol supported_modes="5" current_mode="1" fullcolorsupport="1" mapped="0"><hue>200</hue><saturation>180</saturation><unmapped_hue>200</unmapped_hue><unmapped_saturation>180</unmapped_saturation><temperature></temperature></colorcontrol>
  <etsiunitinfo><etsideviceid>410</etsideviceid><unittype>278</unittype><interfaces>512,514,513</interfaces></etsiunitinfo>
 </device>
 <device identifier="09995 1040598" id="20" functionbitmask="1048864" fwversion="05.25" manufacturer="AVM" productname="FRITZ!DECT 440">
  <present>1</present><txbusy>0</txbusy><name>Taster Regie</name><battery>90</battery><batterylow>0</batterylow>
  <temperature><celsius>210</celsius><offset>0</offset></temperature>
  <button identifier="09995 1040598-1" id="5000"><name>Taster Regie: Oben rechts</name><lastpressedtimestamp>1760001234</lastpressedtimestamp></button>
  <humidity><rel_humidity>45</rel_humidity></humidity>
 </device>
 <group identifier="65:3A:18-900" id="900" functionbitmask="37504" fwversion="1.0" manufacturer="AVM" productname="">
  <present>1</present><txbusy>0</txbusy><name>Alle Steckdosen</name>
  <switch><state>${s.socketOn}</state><mode>manuell</mode><lock/><devicelock/></switch>
  <groupinfo><masterdeviceid>0</masterdeviceid><members>17</members></groupinfo>
 </group>
</devicelist>`
}

export function ahaTemplateList() {
	return `<templatelist version="1">
<template identifier="tmp653A18-38AE7FDE9" id="60001" functionbitmask="320" applymask="10" autocreate="0">
 <name>Saal warm</name><metadata/><devices><device identifier="09995 0123456"/></devices><sub_templates/>
 <applymask><hkr_temperature/></applymask>
</template>
<template identifier="tmp653A18-AUTO1" id="60002" functionbitmask="512" applymask="1" autocreate="1">
 <name>helper</name><metadata/><devices/><sub_templates/><applymask><relay_manual/></applymask>
</template>
<template identifier="tmpD0EF2E-3CE52B246" id="60100" functionbitmask="16384" autocreate="0" applymask="2048">
 <name>Show-Start</name><metadata/><devices/>
 <sub_templates><template identifier="tmp653A18-38AE7FDE9"/></sub_templates>
 <applymask><sub_templates/><triggers/></applymask>
</template>
</templatelist>`
}

export function ahaTriggerList(s) {
	return `<triggerlist version="1"><trigger identifier="trg695F2D-3CBF1DC25" active="${s.triggerActive}"><name>Abends aus</name></trigger></triggerlist>`
}

/** Answers one homeautoswitch.lua request, or undefined for an unknown command. */
export function ahaCommand(s, query) {
	const cmd = query.get('switchcmd')
	const ain = query.get('ain')
	s.commands.push({
		cmd,
		ain,
		...Object.fromEntries([...query].filter(([k]) => !['switchcmd', 'ain', 'sid'].includes(k))),
	})
	switch (cmd) {
		case 'getdevicelistinfos':
			return ahaDeviceList(s)
		case 'gettemplatelistinfos':
			return ahaTemplateList()
		case 'gettriggerlistinfos':
			return ahaTriggerList(s)
		case 'setswitchon':
			s.socketOn = 1
			return '1'
		case 'setswitchoff':
			s.socketOn = 0
			return '0'
		case 'setsimpleonoff':
			if (ain === '13077 0000060-1') s.bulbOn = Number(query.get('onoff'))
			return ''
		case 'setlevelpercentage':
			s.bulbLevel = Number(query.get('level'))
			return ''
		case 'setunmappedcolor':
		case 'setcolortemperature':
			return ''
		case 'sethkrtsoll': {
			const param = Number(query.get('param'))
			if (!(param === 253 || param === 254 || (param >= 16 && param <= 56))) return 'inval'
			s.tsoll = param
			return ''
		}
		case 'sethkrboost':
			s.boostEnd = Number(query.get('endtimestamp'))
			return String(s.boostEnd)
		case 'sethkrwindowopen':
			s.windowEnd = Number(query.get('endtimestamp'))
			return String(s.windowEnd)
		case 'applytemplate':
			return '60001'
		case 'settriggeractive':
			s.triggerActive = Number(query.get('active'))
			return ''
		default:
			return undefined
	}
}

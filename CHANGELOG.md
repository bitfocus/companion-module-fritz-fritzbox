# Changelog

## 1.0.1

Fixes from the Bitfocus review of 1.0.0:

- A user without the Smart Home right no longer opens a new session on the box with every smart home read. The module sees the missing right in the login answer, and a session the box refuses is also logged out there.
- A user without the "FRITZ!Box Settings" right gets a warning on the connection, instead of OK with empty router values.
- Over the internet the HTTPS certificate is checked. MyFRITZ! names have a valid one; for other names or an IP address, the new setting "Accept the certificate the box signed itself" lets the box's own certificate through. In the home network nothing changes.
- The new WLAN password and the new WLAN name take variables, e.g. `$(custom:guest_pw)`.
- The WLAN choices use the keys of the variables (`24ghz`, `5ghz`, `6ghz`), so a typed or computed value works and a button means the same band on another model. Buttons saved with the old ids (`WLANConfiguration2`) keep working.
- Templates, scenarios and routines can also be typed in by name, in the actions and in the "routine enabled" feedback.
- A mobile connection switched off on the box shows as `false` in `connection_mobile_enabled` and `connection_wan2_enabled`, instead of the variables disappearing.
- After the address is changed, the diagnostics report no longer lists requests to the previous address.
- The "Connected to" log line names the box model again.

## 1.0.0

First stable version. Router status over TR-064, smart home over the REST API (FRITZ!OS 8.20 and later) or the AHA-HTTP interface (older boxes), event actions and the diagnostics report, as in the betas. Tested with a FRITZ!Box 6660 Cable (FRITZ!OS 8.40) and a FRITZ!Box 7490 (FRITZ!OS 7.62), in the home network and over MyFRITZ!.

Fixes from the FRITZ!Box 7490 with FRITZ!OS 7.62:

- Smart home switches to the AHA-HTTP interface also when the box answers the REST path with "400, 201 unknown endpoint", as FRITZ!OS 7.x does, not only with 404.
- The diagnostics report is built in the background. Companion gives a module 5 s to answer, and over the internet a report can take longer; until it is ready the browser shows a page that reloads itself.
- Connection state and throughput show up right after the quick part of a read, without waiting for addresses, WLAN and a host list of maybe hundreds of devices.
- A mobile stick only counts as there when the box reports a technology, cells or a signal. Boxes keep the SIM state of a stick used once, which made WAN 2 and the mobile variables appear without a stick.
- With WAN over an Ethernet port (e.g. to a fibre converter) the line rate is the line capacity set in the box, not the speed of the port.
- The WAN 2 uptime is only shown while the mobile connection is up; boxes report the uptime of the main connection there otherwise.

## 1.0.0-beta.3

Fixes from the Bitfocus review of 1.0.0-beta.2:

- DSL boxes: the internet connection (PPP) was not always recognised, so status, external IP and reconnect could follow the wrong service when the line was not up yet at the first contact.
- Smart home variables named after a device stopped updating after the connection settings were saved.
- The device field of "Wake on LAN" and "block or allow internet" also takes an IP address, a name or an expression, like the feedbacks.
- "Button pressed recently" turns off when its time is up, not at the next smart home read.
- A user without the Smart Home right shows a warning with a hint, instead of an authentication failure for the whole connection.
- Values from expressions that are numbers no longer break the device lookups.
- One malformed character code in a device name no longer stops the host list.
- An empty smart home answer gives a clear message.
- The CI workflow is the template's, with its own test job switched on.

## 1.0.0-beta.2

- The module now lives in the official repository: https://github.com/bitfocus/companion-module-fritz-fritzbox
- Smart home on boxes before FRITZ!OS 8.20: the module switches to the older AHA-HTTP interface by itself when the box has no Smart Home REST API. Actions, feedbacks, variables and presets work the same.
- The diagnostics report names the smart home interface in use and, on boxes with the REST API, also shows how the AHA-HTTP interface sees them.

## 1.0.0-beta.1

- First version (beta): router status over TR-064 and smart home control over the FRITZ!OS Smart Home REST API.
- Diagnostics report for beta testers, downloaded with a browser from the web server of Companion: an anonymised file with what the box offers and answers.
- Actions for events: guest and other WLAN on/off, new WLAN password (typed in or generated), WLAN name, Wake on LAN and internet block for network devices, reconnect, and a restart of the box that needs a ticked confirmation.
- WLAN passwords as variables, e.g. to show the guest password on a button.
- Defaults: router status every 15 s, smart home every 60 s, with an immediate read after each smart home action.
- Tested with a real FRITZ!Box, in the home network and over MyFRITZ!. Beta testers with other boxes and connection types are welcome.

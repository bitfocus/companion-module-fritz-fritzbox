# Changelog

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

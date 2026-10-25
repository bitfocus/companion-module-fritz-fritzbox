# companion-module-fritz-fritzbox

A [Bitfocus Companion](https://bitfocus.io/companion) module for the FRITZ!Box: router status as variables and feedbacks, and control of the smart home devices connected to the box.

See [companion/HELP.md](companion/HELP.md) for what it offers and how to set up the box.

The module has been tested with a real FRITZ!Box, in the home network and over MyFRITZ!.

## Beta testers wanted

FRITZ!Boxes differ a lot: DSL, cable, fibre, LTE/5G, a mobile stick as backup, mesh setups, smart home devices of every kind. We are looking for beta testers who try the module on their own box and tell us what works and what does not.

Helpful in a report:

- the model and FRITZ!OS version of the box
- how the box is connected to the internet (DSL, cable, fibre, mobile, ...)
- whether Companion reaches it in the home network or over MyFRITZ! / dynamic DNS
- a diagnostics report: add the action **Diagnostics report: show the download address** to a button and press it once. The Companion log, and the variable `device_diagnostics_url`, then show the address, e.g. `http://192.168.1.10:8000/instance/FRITZ_Box/diagnostics`. Open it in a browser and the report is downloaded as a file. The report never contains passwords or session ids, and addresses, names and serial numbers are replaced by placeholders, so it can be attached to an issue as it is.
- if that is not possible: the Companion log of the connection, or the output of `yarn live-check` (see below)

Please open an issue at https://github.com/bitfocus/companion-module-fritz-fritzbox/issues.

## Interfaces used

- **TR-064** (SOAP with HTTP digest authentication) for the router status
- **UPnP IGD** (no login, home network only) for IPv6 details and as a throughput fallback
- Over the internet (MyFRITZ! or another dynamic DNS name) TR-064 is used below `/tr064` on the HTTPS port of the remote access
- **Smart Home REST API** (`/api/v0/smarthome`, FRITZ!OS 8.20 or later), authenticated with a session ID from `login_sid.lua`
- **AHA-HTTP** (`/webservices/homeautoswitch.lua`) as the automatic fallback for smart home on boxes before FRITZ!OS 8.20, with the same session

The specifications are published by FRITZ! at https://fritz.com/pages/schnittstellen.

## Development

```bash
yarn install
yarn build
yarn test
```

The tests run the built module against a simulated FRITZ!Box (`tests/fakebox.mjs`).

To check against a real box without Companion:

```bash
yarn live-check 192.168.178.1 companion
yarn live-check https://xxxxxxxxxxxxxxxx.myfritz.net:43167 companion
```

The script asks for the password, only reads, and logs out at the end.

## License

MIT

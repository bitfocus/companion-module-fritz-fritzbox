## FRITZ!Box

Shows the status of a FRITZ!Box router on buttons and controls the smart home devices connected to it: sockets, lamps, thermostats, blinds, contacts and buttons.

> **Beta:** this module has been tested with a real FRITZ!Box. Since boxes differ a lot (DSL, cable, fibre, LTE/5G, smart home devices), we are looking for beta testers. Please report what works and what does not at https://github.com/bitfocus/companion-module-fritz-fritzbox/issues, with the model, FRITZ!OS version and connection type, and attach a diagnostics report (see below).

### Preparing the FRITZ!Box

1. **Create a user for Companion** under _System > FRITZ!Box Users_ and give it the rights **FRITZ!Box Settings** and **Smart Home**. Without "FRITZ!Box Settings" most router values stay empty, and without "Smart Home" the devices cannot be read or switched.
2. **Allow access for applications** under _Home Network > Network > Network Settings_. This switches on TR-064, which the router status is read through.
3. Optional: in the same place, switch on **Transmit status information over UPnP**. Only the IPv6 address and prefix need it, plus a fallback for the throughput values.

Smart home works on current and older boxes alike. From FRITZ!OS 8.20 the module uses the Smart Home REST API; on earlier versions it switches to the older AHA-HTTP interface by itself and says so once in the log. Actions, feedbacks, variables and presets are the same either way.

### Configuration

| Field                  | Meaning                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Address                | Where the box is, e.g. `192.168.178.1` or `https://xxxxxxxxxxxxxxxx.myfritz.net:43167`                                                                              |
| User name / Password   | The user created above                                                                                                                                              |
| Router status interval | How often connection state and throughput are read, 15 s by default. Addresses, WLAN and network devices are read every 30 s.                                       |
| Smart home interval    | How often all smart home devices are read in one request, 60 s by default. After a smart home action the state is read again right away. 0 switches smart home off. |

The address decides everything else: `https://` switches on encryption, a number after the colon is the port, and without one the standard port is used (80, or 443 with `https://`). How TR-064 is reached is found out automatically when connecting.

### A box somewhere else

A FRITZ!Box that is not in the same network as Companion is reached through its remote access over the internet:

1. Give the Companion user the right **Access from the internet allowed** (_System > FRITZ!Box Users_).
2. Switch on the internet access of the box and give it a name on the internet. That can be the free **MyFRITZ!** service of the box (an address ending in `.myfritz.net`) or **any other dynamic DNS service** set up on the box.
3. Look up the **port** of the remote access under _Internet > MyFRITZ! Account_ (_Internet > MyFRITZ!-Konto_). The box picks this port itself and it differs from box to box.
4. Enter the address as `https://<name>:<port>`, e.g. `https://xxxxxxxxxxxxxxxx.myfritz.net:43167` or `https://studio.example-dyndns.org:43167`.

Over the internet the box only speaks HTTPS, and everything (login, smart home and TR-064) goes through that one port. The IPv6 address and prefix and the UPnP throughput fallback are not available this way; everything else is.

### Variables

All variables follow one scheme, so every value has an obvious place:

| Prefix               | Contents                                                      |
| -------------------- | ------------------------------------------------------------- |
| `device_`            | The box itself                                                |
| `connection_wan1_`   | The main internet connection, whatever the technology         |
| `connection_wan2_`   | A second connection, e.g. a mobile stick as backup            |
| `connection_dsl_`    | Values only a DSL line has                                    |
| `connection_fiber_`  | Values only a fibre line has                                  |
| `connection_cable_`  | Values only a cable box has                                   |
| `connection_mobile_` | Values only a mobile connection has (LTE/5G box or USB stick) |
| `wlan_`              | The wireless networks                                         |
| `lan_`               | Devices in the home network                                   |
| `smarthome_`         | The smart home devices                                        |

Groups that only some boxes have (WAN 2, DSL, fibre, cable, mobile) only appear on those boxes. A mobile connection counts as WAN 2 when it runs beside a DSL, cable, fibre or Ethernet connection; on a pure LTE/5G box it is WAN 1. Values the box does not report stay empty.

#### Device

| Variable                 | Meaning                                                       | Example                                                   |
| ------------------------ | ------------------------------------------------------------- | --------------------------------------------------------- |
| `device_connected`       | Companion can read the box                                    | `true`                                                    |
| `device_web_url`         | Address of the web interface                                  | `https://xxxx.myfritz.net:43167`                          |
| `device_diagnostics_url` | Download address of the diagnostics report, set by its action | `http://192.168.1.10:8000/instance/FRITZ_Box/diagnostics` |
| `device_model`           | Model                                                         | `FRITZ!Box 7590 AX`                                       |
| `device_firmware`        | FRITZ!OS version                                              | `256.08.20`                                               |
| `device_serial`          | Serial number                                                 | `3810D5000001`                                            |
| `device_uptime`          | Time since the box started                                    | `3d 04:15:22`                                             |
| `device_uptime_seconds`  | The same in seconds                                           | `274522`                                                  |

#### WAN 1 (main internet connection)

| Variable                          | Meaning                                                      | Example                                    |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `connection_wan1_type`            | Access type                                                  | `DSL`, `Fiber`, `Cable`, `LTE`, `Ethernet` |
| `connection_wan1_link`            | Physical line                                                | `Up`, `Down`, `Initializing`               |
| `connection_wan1_status`          | Internet connection                                          | `Connected`, `Connecting`, `Disconnected`  |
| `connection_wan1_connected`       | Internet connected                                           | `true`                                     |
| `connection_wan1_uptime`          | Time since the connection came up                            | `1d 01:01:01`                              |
| `connection_wan1_uptime_seconds`  | The same in seconds                                          | `90061`                                    |
| `connection_wan1_last_error`      | Reason of the last disconnection                             | `ERROR_NONE`                               |
| `connection_wan1_ipv4`            | External IPv4 address                                        | `203.0.113.7`                              |
| `connection_wan1_ipv6`            | External IPv6 address (home network only, needs UPnP status) | `2001:db8::1`                              |
| `connection_wan1_ipv6_prefix`     | IPv6 prefix (same condition)                                 | `2001:db8:1234::/56`                       |
| `connection_wan1_line_down_mbit`  | Line rate downstream in Mbit/s                               | `116.8`                                    |
| `connection_wan1_line_up_mbit`    | Line rate upstream in Mbit/s                                 | `46.7`                                     |
| `connection_wan1_rate_down_mbit`  | Current download in Mbit/s                                   | `10`                                       |
| `connection_wan1_rate_up_mbit`    | Current upload in Mbit/s                                     | `0.5`                                      |
| `connection_wan1_rate_down_kbyte` | Current download in kB/s                                     | `1250`                                     |
| `connection_wan1_rate_up_kbyte`   | Current upload in kB/s                                       | `62.5`                                     |

#### WAN 2 (second connection)

| Variable                         | Meaning                           | Example    |
| -------------------------------- | --------------------------------- | ---------- |
| `connection_wan2_type`           | Access type                       | `Mobile`   |
| `connection_wan2_enabled`        | Switched on in the box            | `true`     |
| `connection_wan2_connected`      | Connection is up                  | `true`     |
| `connection_wan2_uptime`         | Time since the connection came up | `01:00:00` |
| `connection_wan2_uptime_seconds` | The same in seconds               | `3600`     |

#### DSL

| Variable                             | Meaning                              | Example |
| ------------------------------------ | ------------------------------------ | ------- |
| `connection_dsl_status`              | Line status                          | `Up`    |
| `connection_dsl_sync_down_mbit`      | Sync rate downstream in Mbit/s       | `116.8` |
| `connection_dsl_sync_up_mbit`        | Sync rate upstream in Mbit/s         | `46.7`  |
| `connection_dsl_max_down_mbit`       | Attainable rate downstream in Mbit/s | `130`   |
| `connection_dsl_max_up_mbit`         | Attainable rate upstream in Mbit/s   | `50`    |
| `connection_dsl_snr_down_db`         | Noise margin downstream in dB        | `9.5`   |
| `connection_dsl_snr_up_db`           | Noise margin upstream in dB          | `8`     |
| `connection_dsl_attenuation_down_db` | Attenuation downstream in dB         | `14`    |
| `connection_dsl_attenuation_up_db`   | Attenuation upstream in dB           | `12`    |

#### Fibre

| Variable                            | Meaning                          | Example                 |
| ----------------------------------- | -------------------------------- | ----------------------- |
| `connection_fiber_mode`             | Fibre technology                 | `AON`, `GPON`, `XGSPON` |
| `connection_fiber_rx_power_dbm`     | Received optical power in dBm    | `-18.45`                |
| `connection_fiber_tx_power_dbm`     | Transmitted optical power in dBm | `2.31`                  |
| `connection_fiber_sfp_vendor`       | Vendor of the fibre module       | `FRITZ!`                |
| `connection_fiber_sfp_type`         | Type of the fibre module         | `10GBASE_BX`            |
| `connection_fiber_resyncs`          | Number of resynchronisations     | `2`                     |
| `connection_fiber_showtime_minutes` | Minutes since the line came up   | `1440`                  |

#### Cable

| Variable                           | Meaning                                   | Example              |
| ---------------------------------- | ----------------------------------------- | -------------------- |
| `connection_cable_dvbc_enabled`    | DVB-C TV switched on                      | `true`               |
| `connection_cable_station_search`  | DVB-C station search                      | `active`, `inactive` |
| `connection_cable_search_progress` | Progress of the station search in percent | `0`                  |

#### Mobile

| Variable                        | Meaning                                              | Example                         |
| ------------------------------- | ---------------------------------------------------- | ------------------------------- |
| `connection_mobile_enabled`     | Mobile connection switched on                        | `true`                          |
| `connection_mobile_technology`  | Technology in use                                    | `LTE`, `5G-NSA`, `5G-SA`        |
| `connection_mobile_signal_rsrp` | Signal strength (RSRP) in dBm, closer to 0 is better | `-97`                           |
| `connection_mobile_roaming`     | Roaming                                              | `false`                         |
| `connection_mobile_provider`    | Provider of the cell in use                          | `Vodafone`                      |
| `connection_mobile_sim_status`  | State of the SIM card                                | `PIN successful`, `no SIM card` |

#### WLAN

Each network gets its own prefix by band, so the names are the same on every model: `wlan_24ghz_`, `wlan_5ghz_`, `wlan_6ghz_` and `wlan_guest_`. A second network on the same band gets a number, e.g. `wlan_5ghz_2_`.

| Variable                        | Meaning                                                                         | Example       |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------- |
| `wlan_enabled`                  | All WLAN switched on (the WLAN button)                                          | `true`        |
| `wlan_clients_total`            | Clients on all networks together                                                | `10`          |
| `wlan_5ghz_ssid`                | Network name                                                                    | `Studio 5`    |
| `wlan_5ghz_enabled`             | Network switched on                                                             | `true`        |
| `wlan_5ghz_band`                | Frequency band                                                                  | `5 GHz`       |
| `wlan_5ghz_channel`             | Channel                                                                         | `44`          |
| `wlan_5ghz_clients`             | Clients on this network                                                         | `7`           |
| `wlan_5ghz_password`            | WLAN password, readable on purpose, e.g. to show the guest password on a button | `welcome2026` |
| `wlan_guest_auto_off`           | Guest WLAN only: switches itself off after a while                              | `true`        |
| `wlan_guest_auto_off_minutes`   | Guest WLAN only: after how many minutes                                         | `30`          |
| `wlan_guest_auto_off_remaining` | Guest WLAN only: minutes left, as the box reports it                            | `12`          |

#### LAN

| Variable           | Meaning                                      | Example |
| ------------------ | -------------------------------------------- | ------- |
| `lan_hosts_active` | Network devices currently active             | `12`    |
| `lan_hosts_known`  | Network devices the box knows, active or not | `48`    |

#### Smart home

| Variable          | Meaning                                      | Example |
| ----------------- | -------------------------------------------- | ------- |
| `smarthome_units` | Number of smart home units (devices, groups) | `6`     |

Every unit also gets its own prefix: always one from its ID, e.g. `smarthome_11630_0015376_`, and if no other unit has the same name, a second one from its name, e.g. `smarthome_steckdose_regie_`. Umlauts are written out (`ü` becomes `ue`). Which of the following a unit has depends on the device:

| Ending         | Meaning                                   | Example                      |
| -------------- | ----------------------------------------- | ---------------------------- |
| `_name`        | Name of the unit                          | `Steckdose Regie`            |
| `_connected`   | The box has radio contact                 | `true`                       |
| `_battery`     | Battery in percent                        | `80`                         |
| `_battery_low` | Battery low                               | `false`                      |
| `_on`          | Switched on (socket, lamp, switch, group) | `true`                       |
| `_level`       | Brightness or blind position in percent   | `60`                         |
| `_hue`         | Colour hue, 0 to 359                      | `200`                        |
| `_saturation`  | Colour saturation, 0 to 255               | `180`                        |
| `_kelvin`      | Colour temperature in Kelvin              | `3000`                       |
| `_blind`       | Last blind movement                       | `moveUp`, `moveDown`, `stop` |
| `_setpoint`    | Thermostat target in °C                   | `21.5`                       |
| `_mode`        | Thermostat mode                           | `temperature`, `on`, `off`   |
| `_boost`       | Thermostat boost active                   | `false`                      |
| `_window_open` | Thermostat window open mode active        | `false`                      |
| `_temperature` | Measured temperature in °C                | `22.5`                       |
| `_humidity`    | Humidity in percent                       | `45`                         |
| `_lux`         | Illuminance in lux                        | `320`                        |
| `_power`       | Power in W                                | `123.45`                     |
| `_energy`      | Energy in kWh                             | `15.32`                      |
| `_voltage`     | Voltage in V                              | `230.1`                      |
| `_current`     | Current in A                              | `0.54`                       |
| `_alert`       | Contact or alarm state                    | `open`, `closed`, `none`     |
| `_last_press`  | Time of the last button press             | `14:32:05`                   |

Example: `$(fritz:smarthome_steckdose_regie_power)` shows the power of the socket named "Steckdose Regie" on a connection labelled `fritz`.

Use the name based prefix on buttons where you can. The ID based one can change for some devices if a box moves from the AHA-HTTP interface to the REST API, e.g. after an update to FRITZ!OS 8.20 or later; the name based one stays the same.

### Router status

Actions:

- **Internet: reconnect now** drops the internet connection so the box dials in again at once, usually with a new IP address. The internet is gone for a few seconds; over MyFRITZ! the module also loses the box until the new address has reached the DNS, and then reconnects by itself.
- **WLAN: switch on, off or toggle** for the guest WLAN, a single band, or all WLAN together like the WLAN button. Careful: switching off the WLAN Companion itself uses cuts its connection to the box.
- **WLAN: change password**, typed in or generated (easy to read, without look-alike characters such as 0/O and 1/l). Connected devices have to connect again with the new password, which then shows up in the password variable of that WLAN.
- **WLAN: change name (SSID)**.
- **Network device: wake up (Wake on LAN)** and **Network device: block or allow internet**, both chosen from the list of devices the box knows; the list follows the box. Blocking takes a few seconds to take effect, and the device needs a current IP address.
- **FRITZ!Box: restart**. Only runs when the confirmation in the action is ticked, since internet, WLAN and the home network can be gone for several minutes.

Over TR-064 the guest WLAN can be switched, renamed and given a new password. Its auto-off timer and its device isolation can only be read, not set.

Feedbacks: connected, internet connected, line synchronised, WLAN enabled (guest, all, per band or any), network device online, network device internet blocked, and throughput above or below a value.

### Smart home

The variables are listed in the tables above.

Actions: switch on, off or toggle; brightness; colour and colour temperature; blind up, down, stop and position; thermostat temperature (set, raise, lower, ON, OFF), boost and window open mode; apply a template or scenario; enable or disable a routine.

Feedbacks: switched on, reachable, alert or contact state, compare a reading (temperature, power, humidity ...), boost, window open mode, battery low, button pressed recently, routine enabled.

Presets are created for every device the box reports.

### Diagnostics report

The report is served by the web server of Companion, at `/instance/<name of the connection>/diagnostics`. To get it, add the action **Diagnostics report: show the download address** to a button and press it once. The Companion log, and the variable `device_diagnostics_url`, then show the address, e.g. `http://192.168.1.10:8000/instance/FRITZ_Box/diagnostics`. Open it in a browser and the report is downloaded as a file. It holds what the box offers and answers over TR-064, the smart home overview as the box sends it, the recent requests and problems, and the router values. Passwords and session ids are never included. IP and MAC addresses, network and device names, WLAN passwords, serial numbers, the user name and the address of the box are replaced by placeholders such as `IPv4#1`, so the report can be shared as it is. Nothing is written to the disk of the computer running Companion.

### Good to know

- Battery powered thermostats only talk to the box every few minutes. A new target temperature is accepted at once but may take a while to show as the current state.
- The box only reports a button press when it is next read, so the "button pressed" feedback can lag by up to the smart home interval.
- The module holds one login session on the box and logs out when the connection is disabled.
- When the box is unreachable, e.g. during the nightly reconnect of the internet line, the module says so once in the log and connects again by itself as soon as the box answers. Over MyFRITZ! or another dynamic DNS name that is as soon as the name points to the new IP address. Nothing needs to be restarted.

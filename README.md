
<p align="center">

<img src="https://github.com/homebridge/branding/raw/master/logos/homebridge-wordmark-logo-vertical.png" width="150">

</p>


# Homebridge AWS IoT Plugin

> &#x26a0;&#xfe0f; **Unstable Plugin**: This plugin is a work in progress.

This plugin syncs Homebridge accessories with AWS IoT. It publishes the
accessories as `Things` in IoT and keeps device shadows updated as state changes
occur. Additionally, it subscribes to state updates via MQTT such that the accessories
can be controlled by other platforms (i.e. Alexa) through IoT.

## Accessory Support
The following capabilities have been tested thus far:
- Lights
  - Power
  - Brightness
  - Color
- Switches
- Motion Sensors
- Contact Sensors
- Thermostats
- Temperature Sensors
- Security Panels



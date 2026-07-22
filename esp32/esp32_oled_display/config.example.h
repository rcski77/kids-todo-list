// Copy this file to config.h and fill in your details.
// config.h is gitignored so your WiFi password never gets committed.

#ifndef CONFIG_H
#define CONFIG_H

#define WIFI_SSID     "YourWiFiName"
#define WIFI_PASSWORD "YourWiFiPassword"

// The Docker host's LAN IP (or hostname) and port. E.g. "192.168.1.50"
#define SERVER_HOST "192.168.1.50"
#define SERVER_PORT 3000

// Which kid this particular display shows. Find the id via GET /api/kids
// or the "admin.html" page (it's shown next to each kid's name).
#define KID_ID 1

// How often to poll the server, in milliseconds.
#define POLL_INTERVAL_MS 4000

// SSD1309 SPI wiring for an Arduino Nano ESP32.
// CS/DC/RESET can be any free digital pin; SCK/SDA(MOSI) must be the board's
// hardware SPI pins, which on the Nano ESP32 are fixed at D13/D11.
#define OLED_PIN_CS    10  // D10
#define OLED_PIN_DC    2   // D2
#define OLED_PIN_RESET 3   // D3
// OLED "SCK" -> board D13, OLED "SDA" (MOSI/DIN) -> board D11 (fixed, hardware SPI).

// "Next task" push button (module has its own pull-down resistor: signal
// pin idles LOW, reads HIGH when pressed). Wire signal -> this pin,
// plus VCC and GND to the module's power pins.
#define BUTTON_PIN 4  // D4

#endif

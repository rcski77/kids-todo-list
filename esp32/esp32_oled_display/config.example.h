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

// SSD1309 SPI wiring (defaults match a typical ESP32 DevKit + 4-wire SPI OLED).
// Change these to match how you actually wired the board.
#define OLED_PIN_CS   5
#define OLED_PIN_DC   17
#define OLED_PIN_RESET 16
// SCK/MOSI use the ESP32's default hardware VSPI pins (SCK=18, MOSI/DIN=23).

#endif

// Morning Mission — ESP32 + SSD1309 (SPI) "what's next" display.
//
// Polls the Morning Mission server's lightweight /display endpoint for one
// kid and shows the current task on a 128x64 monochrome OLED.
//
// Libraries needed (install via Arduino Library Manager):
//   - U8g2 by olikraus
//   - ArduinoJson by Benoit Blanchon (v6 or v7)
//
// Copy config.example.h to config.h and fill in your WiFi/server details
// before building.

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <U8g2lib.h>
#include <SPI.h>
#include "config.h"

// 4-wire hardware SPI. Rotation 0 = normal orientation.
U8G2_SSD1309_128X64_NONAME0_F_4W_HW_SPI u8g2(
  U8G2_R0, /* cs=*/ OLED_PIN_CS, /* dc=*/ OLED_PIN_DC, /* reset=*/ OLED_PIN_RESET
);

unsigned long lastPoll = 0;
bool haveData = false;
bool lastFetchOk = false;

// Button debounce state. The module has its own pull-down resistor, so the
// pin idles LOW and reads HIGH when pressed (opposite of INPUT_PULLUP).
int buttonState = LOW;
int lastButtonReading = LOW;
unsigned long lastButtonChange = 0;
const unsigned long DEBOUNCE_MS = 40;

String kidName;
int taskIndex = 0;
int totalTasks = 0;
String taskEmojiLabel; // not rendered (no emoji glyphs on this font), kept for reference
String taskName;
String taskDetail;
bool allDone = false;
int starsEarned = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT); // external pull-down on the button module
  u8g2.begin();
  u8g2.setContrast(180);

  drawStatus("Connecting to", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
  drawStatus("Connected!", WiFi.localIP().toString().c_str());
  delay(600);
}

void loop() {
  checkButton();

  if (millis() - lastPoll >= POLL_INTERVAL_MS || lastPoll == 0) {
    lastPoll = millis();
    fetchDisplayState();
    render();
  }
  delay(10);
}

// Debounced button check. Fires advanceTask() once per physical press
// (on the LOW->HIGH transition), not repeatedly while held down.
void checkButton() {
  int reading = digitalRead(BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastButtonChange = millis();
  }

  if (millis() - lastButtonChange > DEBOUNCE_MS && reading != buttonState) {
    buttonState = reading;
    Serial.printf("BUTTON_PIN (D4) is now %s\n", buttonState == HIGH ? "HIGH (pressed)" : "LOW (released)");
    if (buttonState == HIGH) {
      advanceTask();
    }
  }

  lastButtonReading = reading;
}

// Tells the server to mark the current task done, then immediately
// refreshes the display so it doesn't wait for the next poll cycle.
void advanceTask() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) +
               "/api/kids/" + String(KID_ID) + "/advance";
  http.begin(url);
  http.setTimeout(4000);
  int code = http.POST("");
  http.end();

  if (code != 200) {
    Serial.printf("POST %s failed, code=%d\n", url.c_str(), code);
    return;
  }

  lastPoll = millis();
  fetchDisplayState();
  render();
}

void fetchDisplayState() {
  if (WiFi.status() != WL_CONNECTED) {
    lastFetchOk = false;
    return;
  }

  HTTPClient http;
  String url = "http://" + String(SERVER_HOST) + ":" + String(SERVER_PORT) +
               "/api/kids/" + String(KID_ID) + "/display";
  http.begin(url);
  http.setTimeout(4000);
  int code = http.GET();

  if (code != 200) {
    Serial.printf("GET %s failed, code=%d\n", url.c_str(), code);
    lastFetchOk = false;
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.print("JSON parse failed: ");
    Serial.println(err.c_str());
    lastFetchOk = false;
    return;
  }

  kidName = doc["kidName"].as<String>();
  taskIndex = doc["index"] | 0;
  totalTasks = doc["total"] | 0;
  allDone = doc["allDone"] | false;
  starsEarned = doc["starsEarned"] | 0;

  if (!allDone && !doc["current"].isNull()) {
    taskEmojiLabel = doc["current"]["emoji"].as<String>();
    taskName = doc["current"]["name"].as<String>();
    taskDetail = doc["current"]["detail"].as<String>();
  } else {
    taskName = "";
    taskDetail = "";
  }

  haveData = true;
  lastFetchOk = true;
}

// ── Rendering ──────────────────────────────────────

void drawStatus(const char* line1, const char* line2) {
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_7x14B_tr);
  u8g2.drawStr(2, 24, line1);
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(2, 44, line2);
  u8g2.sendBuffer();
}

// Word-wraps `text` into up to `maxLines` lines that fit `maxWidth` px,
// drawing each line starting at (x, y), advancing by `lineHeight` px.
// Returns the number of lines actually drawn.
int drawWrapped(const char* text, int x, int y, int maxWidth, int lineHeight, int maxLines) {
  String remaining = String(text);
  int linesDrawn = 0;

  while (remaining.length() > 0 && linesDrawn < maxLines) {
    int fit = remaining.length();
    // Find the longest prefix (breaking on spaces) that fits maxWidth.
    while (fit > 0 && u8g2.getUTF8Width(remaining.substring(0, fit).c_str()) > maxWidth) {
      int lastSpace = remaining.substring(0, fit).lastIndexOf(' ');
      if (lastSpace <= 0) { fit--; } else { fit = lastSpace; }
    }
    if (fit == 0) fit = 1;

    bool isLastLine = (linesDrawn == maxLines - 1);
    String line = remaining.substring(0, fit);

    if (isLastLine && fit < (int)remaining.length()) {
      // Truncate with ellipsis if there's more text than we have room for.
      while (line.length() > 1 &&
             u8g2.getUTF8Width((line + "...").c_str()) > maxWidth) {
        line.remove(line.length() - 1);
      }
      line += "...";
    }

    u8g2.drawStr(x, y + linesDrawn * lineHeight, line.c_str());
    linesDrawn++;

    remaining = remaining.substring(fit);
    remaining.trim();
  }
  return linesDrawn;
}

void drawProgressBar(int x, int y, int w, int h, int current, int total) {
  u8g2.drawFrame(x, y, w, h);
  if (total <= 0) return;
  int fillW = (w - 2) * current / total;
  if (fillW > 0) u8g2.drawBox(x + 1, y + 1, fillW, h - 2);
}

void render() {
  u8g2.clearBuffer();

  if (!haveData) {
    u8g2.setFont(u8g2_font_7x14B_tr);
    u8g2.drawStr(2, 24, "Waiting for");
    u8g2.drawStr(2, 42, "server...");
    u8g2.sendBuffer();
    return;
  }

  // Header: kid name + connectivity dot
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(0, 9, kidName.c_str());
  if (!lastFetchOk) {
    u8g2.drawStr(108, 9, "OFF");
  } else {
    u8g2.drawDisc(122, 5, 2);
  }
  u8g2.drawHLine(0, 12, 128);

  if (allDone) {
    u8g2.setFont(u8g2_font_9x15B_tr);
    u8g2.drawStr(20, 32, "ALL DONE!");
    u8g2.setFont(u8g2_font_6x10_tr);
    String stars = String(starsEarned) + " / " + String(totalTasks) + " stars";
    int sw = u8g2.getUTF8Width(stars.c_str());
    u8g2.drawStr((128 - sw) / 2, 48, stars.c_str());
    u8g2.sendBuffer();
    return;
  }

  // "Up next" label + progress
  u8g2.setFont(u8g2_font_6x10_tr);
  String label = "Task " + String(taskIndex) + "/" + String(totalTasks);
  u8g2.drawStr(0, 23, label.c_str());

  // Task name, bold, one line (truncated with "..." if it doesn't fit)
  u8g2.setFont(u8g2_font_7x14B_tr);
  drawWrapped(taskName.c_str(), 0, 37, 128, 14, 1);

  // Detail line
  u8g2.setFont(u8g2_font_6x10_tr);
  drawWrapped(taskDetail.c_str(), 0, 51, 128, 10, 1);

  // Progress bar along the very bottom
  drawProgressBar(0, 59, 128, 5, taskIndex - 1, totalTasks);

  u8g2.sendBuffer();
}

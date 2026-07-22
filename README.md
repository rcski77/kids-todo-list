# Morning Mission

A self-hosted, multi-kid morning routine tracker: a web app (Docker) plus
optional ESP32 + OLED displays that show each kid what to do next.

## What's here

- `server/` — Node/Express + SQLite backend. Serves the API and the web UI.
- `public/` — The web app (`index.html`) and an admin page (`admin.html`)
  for adding kids and editing their task lists.
- `esp32/esp32_oled_display/` — Arduino sketch for an ESP32 + SSD1309 SPI
  OLED that polls the server and shows the active kid's current task.
- `docker-compose.yml` / `server/Dockerfile` — container packaging.

## Running it (Docker)

```bash
docker compose up -d --build
```

The app is then available at `http://<host>:3000`. Data (kids, tasks,
today's progress) is stored in a SQLite file inside the `kids-todo-data`
Docker volume, so it survives container rebuilds.

Set the container's timezone via the `TZ` environment variable in
`docker-compose.yml` (defaults to `America/New_York`) — this controls when
"today" rolls over and each kid's progress resets.

On first run, one example kid ("Buddy") is seeded with the original
9-step morning routine so there's something to look at immediately.

### Managing kids and tasks

Open `http://<host>:3000/admin.html` to:

- Add/remove kids
- Add/remove tasks per kid (emoji, name, detail text, optional brush-teeth
  style countdown timer)

Each kid's ID (shown in the admin page) is what you'll plug into the ESP32
config for that kid's display.

## Web app behavior

- Kid selector at the top switches between kids (remembered per browser).
- The big hero card shows the current task; tapping "Done!" advances to the
  next one and syncs back to the server, so multiple devices (e.g. a kid's
  tablet and a parent's phone) viewing the same kid stay in sync (polls
  every 4s).
- The "get ready" countdown timer and the confetti effects are local to
  the browser tab, unrelated to server state.
- Progress resets automatically at midnight (server's local time) and can
  also be reset manually with the reset button on the "all done" screen.

## ESP32 display setup

Hardware: any ESP32 dev board + an SSD1309 OLED wired for 4-wire SPI.

Default wiring assumed by the sketch (change in `config.h` if you wired it
differently):

| OLED pin | ESP32 pin |
|---|---|
| CS  | GPIO 5 |
| DC  | GPIO 17 |
| RES | GPIO 16 |
| SCK | GPIO 18 (VSPI default) |
| DIN/MOSI | GPIO 23 (VSPI default) |
| VCC | 3.3V |
| GND | GND |

### Firmware setup

1. In the Arduino IDE, install these libraries (Library Manager):
   - **U8g2** by olikraus
   - **ArduinoJson** by Benoit Blanchon (v6 or v7)
   - Install ESP32 board support if you haven't already (Boards Manager →
     "esp32" by Espressif Systems).
2. Open `esp32/esp32_oled_display/esp32_oled_display.ino`.
3. Copy `config.example.h` to `config.h` in the same folder and fill in:
   - Your WiFi SSID/password
   - `SERVER_HOST` — your Docker host's LAN IP (e.g. `192.168.1.50`)
   - `KID_ID` — which kid this display is for (check `admin.html`)
4. Flash it to the ESP32. On boot it connects to WiFi, then polls
   `GET /api/kids/<id>/display` every 4 seconds and shows:
   - The kid's name and a small connectivity dot (or "OFF" if the last
     poll failed)
   - The current task name + detail text
   - A `task N / total` counter and a progress bar
   - A celebratory "ALL DONE!" screen with the star count once every task
     for that day is complete

Want a display for each kid? Flash multiple ESP32 boards, each with its own
`config.h` pointing at a different `KID_ID` — they all hit the same server.

The `/api/kids/:id/display` endpoint is intentionally small/cheap (no auth,
plain JSON) since it's meant to be polled repeatedly from a microcontroller
on your home LAN. Don't expose the server directly to the internet without
adding your own auth/reverse proxy in front of it.

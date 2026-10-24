# Steam Simultaneous Hour Booster ⚡

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-v18%2B-green.svg" alt="Node Version">
  <img src="https://img.shields.io/badge/Steam-QR%20Auth-blue.svg" alt="Steam Auth">
  <img src="https://img.shields.io/badge/Games-Up%20to%2032%20Simultaneous-orange.svg" alt="Simultaneous Games">
  <img src="https://img.shields.io/badge/License-MIT-purple.svg" alt="License">
</p>

A modern, full-featured web-based **Steam Hour Booster & Multi-Game Idler**. It connects directly to Steam's official network without requiring you to download, install, or run games locally.

Boost playing hours on up to **32 Steam games simultaneously** (1 hour real-time = 32 hours total gain) with zero PC performance impact!

---

## 🌟 Key Features

- 📱 **Steam Mobile QR Login:** No need to type passwords or 2FA codes. Simply scan the dynamic QR code with the Steam Mobile App and tap "Sign In".
- 🎮 **Automatic Library Sync:** Automatically fetches all games owned on your account (with official box art, playtime, and titles) upon login.
- 🔥 **Simultaneous Multi-Idling:** Steam allows up to 32 apps to be run in one session. Boost 10 games = 10 hours added to your profile every hour!
- ⚡ **Auto-Pause & Smart Resume:** If you launch a game on your PC, the booster detects it, pauses gracefully so you don't experience disconnects or lag, and automatically resumes once you exit your game.
- 💬 **Custom Status Message:** Display custom non-Steam text or motivational tags across your Steam presence.
- ⏱️ **Live Dashboard:** WebSocket-powered real-time counter, connection logs, and total playtime gains.
- 🖥️ **7/24 VDS & VPS Ready:** Lightweight, self-contained, and includes one-click Windows Server setup scripts with PM2 auto-restart on boot.

---

## 🚀 Quick Start (Local PC)

### 1. Clone the repository
```bash
git clone https://github.com/YOUR_USERNAME/steam-hour-booster.git
cd steam-hour-booster
```

### 2. Install dependencies
```bash
npm install
```

### 3. Run the application
```bash
# Windows double-click:
start.bat

# Or via terminal:
node server.js
```

### 4. Open the Web Dashboard
Navigate to `http://localhost:3456` in your web browser.

---

## ☁️ 24/7 Deployment on Windows Server (VDS / VPS)

1. Copy the project folder to your Windows Server.
2. Install Node.js (LTS) from [nodejs.org](https://nodejs.org).
3. Right-click **`setup_vds.bat`** and choose **"Run as Administrator"**:
   - Opens port `3456` in Windows Firewall.
   - Configures **PM2** background service to automatically start on server reboot.
4. Access your panel remotely from any phone or PC at `http://YOUR_VDS_IP:3456`.

---

## 🛡️ Security & Privacy

- **Your credentials stay local:** All authentication tokens (`refreshToken`) are stored strictly inside your local `config.json` on your own machine/server.
- **No external third-party servers:** The backend communicates directly with official Valve Steam servers via `steam-user` and `steam-session`.
- **Open Source:** Full code transparency.

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.

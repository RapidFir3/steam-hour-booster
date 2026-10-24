# steam-hour-booster

[English](#english) | [Türkçe](#türkçe)

---

## English

Lightweight, self-hosted web tool to boost hours on multiple Steam games simultaneously without downloading them. Uses Node.js, `steam-user`, and `steam-session`.

Designed to be dead simple: scan the QR code with your Steam Mobile app, pick the games from your library, and let it run in the background or on a 24/7 VDS.

### Features
- **Parallel Idling:** Idles up to 32 games at the same time (Steam's client limit). 1 hour running = 1 hour added to every selected game.
- **Steam Mobile QR Login:** No need to type passwords or 2FA codes manually. Just point your Steam mobile app camera and approve. Saves session token locally so you don't scan every time.
- **Auto Library Fetch:** Grabs your owned games with titles and box art automatically upon login—no manual AppID hunting.
- **Smart Pause & Auto-Resume:** If you open a game on your PC, the booster detects it, pauses gracefully so you don't get disconnected, and resumes once you quit your game.
- **Custom Status:** Set a custom non-Steam presence text on your profile.
- **VDS / 24-7 Ready:** Runs fine on local machine or as a background service on a Windows Server VDS.

### Setup

```bash
git clone https://github.com/RapidFir3/steam-hour-booster.git
cd steam-hour-booster
npm install
node server.js
```

Open `http://localhost:3456` in your browser. (On Windows, you can also just double-click `start.bat`).

### Windows Server (VDS) Setup
1. Copy the folder to your VDS.
2. Right click `setup_vds.bat` and run as Administrator (opens firewall port 3456 and sets up PM2 auto-restart).
3. Access your dashboard from `http://YOUR_VDS_IP:3456`.

---

## Türkçe

Oyunları indirmeden veya bilgisayarı yormadan aynı anda birden fazla Steam oyununda saat kasmak için geliştirilmiş hafif, web arayüzlü bir idler aracı. `steam-user` ve `steam-session` kullanılarak yazıldı.

Kullanımı olabildiğince pratik tutuldu: Steam Mobile uygulamasından QR kodunu okutuyorsun, kütüphanendeki oyunlar otomatik listeleniyor ve arkada saat kasmaya başlıyor.

### Özellikler
- **Eşzamanlı Saat Kasma:** Steam protokolünün izin verdiği maksimum sınır olan 32 oyuna kadar aynı anda saat kasar (1 saat açık kaldığında seçtiğin tüm oyunlara 1'er saat eklenir).
- **Steam Mobile QR Girişi:** Şifre veya 2FA kodu yazmaya gerek kalmadan telefonundaki Steam uygulamasından QR okutarak tek tıkla bağlanır. Oturum anahtarını yerel olarak kaydeder, her seferinde tekrar okutmak gerekmez.
- **Otomatik Kütüphane Çekme:** Giriş yaptığında hesabındaki oyunlar afişleri ve isimleriyle birlikte otomatik listelenir. Tek tek App ID aramakla uğraşmazsın.
- **Akıllı Duraklatma (Smart Auto-Resume):** Sen kendi bilgisayarından bir oyuna girdiğinde booster bunu algılar ve seni oyundan atmamak için geçici olarak duraklar. Sen oyundan çıktığında yaklaşık 30 saniye içinde otomatik olarak kaldığı yerden saat kasmaya devam eder.
- **Özel Durum Metni:** Profiline özel "Steam Dışı Oyunda: ..." durum mesajı yazabilirsin.
- **VDS / 7-24 Uyumlu:** İster kendi bilgisayarında çalıştır, ister Windows Server VDS'inde arka planda 7/24 kesintisiz çalıştır.

### Kurulum (Yerel PC)

```bash
git clone https://github.com/RapidFir3/steam-hour-booster.git
cd steam-hour-booster
npm install
node server.js
```

Tarayıcıdan `http://localhost:3456` adresine gir. Windows'ta doğrudan `start.bat` dosyasına çift tıklayarak da açabilirsin.

### Windows Server (VDS) Kurulumu
1. Proje klasörünü VDS'ine kopyala.
2. `setup_vds.bat` dosyasına sağ tıklayıp Yönetici olarak çalıştır (Güvenlik duvarında 3456 portunu açar ve VDS yeniden başlasa bile arkada çalışması için PM2 servisini kurar).
3. Kendi bilgisayarından veya telefonundan `http://VDS_IP_ADRESIN:3456` adresine girerek paneli yönet.

---

### License
MIT

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const SteamUser = require('steam-user');
const { LoginSession, EAuthTokenPlatformType } = require('steam-session');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3456;
const DATA_FILE = path.join(__dirname, 'config.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Saved configuration state
let savedConfig = {
    accountName: '',
    refreshToken: '',
    games: [],
    libraryGames: [],
    customStatus: '⚡ Hour Boosting with Antigravity'
};

if (fs.existsSync(DATA_FILE)) {
    try {
        const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        savedConfig = { ...savedConfig, ...loaded };
    } catch (e) {
        console.error('Error loading config:', e);
    }
}

function saveConfiguration() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(savedConfig, null, 2));
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}

// Booster runtime state
let client = null;
let currentLoginSession = null;
let cardFarmingInterval = null;

let cardFarmingState = {
    active: false,
    scanning: false,
    gamesWithDrops: [],
    currentGame: null,
    totalDropsRemaining: 0,
    farmedThisSession: 0,
    lastCheckTime: null
};

let boosterState = {
    status: 'idle', // 'idle' | 'waiting_qr' | 'logging_in' | 'guard_needed' | 'running' | 'error'
    error: null,
    account: savedConfig.accountName || null,
    hasSavedSession: !!savedConfig.refreshToken,
    guardType: null, // 'steamguard' | '2fa'
    activeGames: savedConfig.games || [],
    libraryGames: savedConfig.libraryGames || [],
    customStatus: savedConfig.customStatus,
    cardFarming: cardFarmingState,
    startTime: null,
    elapsedSeconds: 0,
    qrDataUrl: null,
    logHistory: []
};

let tickerInterval = null;

function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    const entry = { time, msg, type };
    boosterState.logHistory.unshift(entry);
    if (boosterState.logHistory.length > 50) boosterState.logHistory.pop();
    broadcast({ type: 'log', data: entry });
}

function broadcast(payload) {
    const message = JSON.stringify(payload);
    wss.clients.forEach(c => {
        if (c.readyState === 1) {
            c.send(message);
        }
    });
}

function updateBoosterState(updates) {
    Object.assign(boosterState, updates);
    broadcast({ type: 'state', data: boosterState });
}

function startTicker() {
    if (tickerInterval) clearInterval(tickerInterval);
    tickerInterval = setInterval(() => {
        if (boosterState.status === 'running' && boosterState.startTime) {
            boosterState.elapsedSeconds = Math.floor((Date.now() - boosterState.startTime) / 1000);
            broadcast({ 
                type: 'tick', 
                elapsedSeconds: boosterState.elapsedSeconds 
            });
        }
    }, 1000);
}

function stopTicker() {
    if (tickerInterval) {
        clearInterval(tickerInterval);
        tickerInterval = null;
    }
}

let latestWebCookies = null;

function createSteamClient() {
    if (client) {
        try {
            client.logOff();
        } catch(e) {}
        client.removeAllListeners();
    }

    client = new SteamUser({
        autoRelogin: true,
        promptSteamGuardCode: false,
        enablePicsCache: true
    });

    client.on('loggedOn', async (details) => {
        const username = savedConfig.accountName || (client.steamID ? client.steamID.getSteamID64() : 'Steam User');
        addLog(`Steam'e başarıyla giriş yapıldı! Hoş geldin: ${username}`, 'success');
        
        client.setPersona(SteamUser.EPersonaState.Online);

        updateBoosterState({
            status: 'running',
            error: null,
            guardType: null,
            qrDataUrl: null,
            account: username,
            hasSavedSession: !!savedConfig.refreshToken,
            startTime: boosterState.startTime || Date.now()
        });

        startTicker();

        // Start Web session for store/community API access
        try {
            client.webLogOn();
        } catch(e) {
            console.error('webLogOn initial trigger error:', e.message);
        }

        // Automatically fetch games in user library (including Family Sharing)
        await fetchUserLibrary();
        applyActiveGames();

        // Scan badges in background for card farming
        scanUserBadges(client).catch(e => console.error('Initial badge scan error:', e));
    });

    client.on('webSession', (sessionID, cookies) => {
        latestWebCookies = cookies;
        addLog('Steam Web oturumu doğrulandı. Aile Paylaşımı erişimi aktif.', 'info');
    });

    // When steam-user issues or refreshes token
    client.on('refreshToken', (token) => {
        savedConfig.refreshToken = token;
        saveConfiguration();
        updateBoosterState({ hasSavedSession: true });
        addLog('Yenilenen oturum tokenı kaydedildi.', 'info');
    });

    client.on('steamGuard', (domain, callback, lastCodeWrong) => {
        const guardType = domain ? 'steamguard' : '2fa';
        addLog(lastCodeWrong 
            ? 'Girdiğin kod hatalı! Lütfen yeni güvenlik kodunu gir.' 
            : (domain ? `E-posta adresine (${domain}) bir Steam Guard doğrulama kodu gönderildi.` : 'Steam Mobil Kimlik Doğrulayıcı (2FA) kodunu gir.'), 'warning');

        updateBoosterState({
            status: 'guard_needed',
            guardType: guardType,
            error: lastCodeWrong ? 'Hatalı kod, lütfen tekrar deneyin.' : null
        });

        client._steamGuardCallback = callback;
    });

    client.on('error', (err) => {
        console.error('Steam client error:', err);
        let message = err.message || 'Bilinmeyen bir hata oluştu.';

        if (err.eresult === SteamUser.EResult.LoggedInElsewhere) {
            addLog(`Steam başka bir cihazda/oyunda aktif edildi (LoggedInElsewhere). Booster geçici olarak beklemeye alındı, birazdan otomatik bağlanacak...`, 'warning');
            updateBoosterState({
                status: 'waiting_qr',
                error: 'Başka bir yerde Steam oturumu açıldı (Geçici duraklatıldı).'
            });
            setTimeout(() => {
                if (boosterState.status !== 'running' && savedConfig.refreshToken) {
                    addLog('Oturum tekrar kontrol ediliyor ve bağlanılıyor...', 'info');
                    client.logOn({
                        refreshToken: savedConfig.refreshToken,
                        logonID: Math.floor(Math.random() * 1000000) + 1
                    });
                }
            }, 30000);
            return;
        }

        if (err.eresult === SteamUser.EResult.InvalidPassword) {
            message = 'Kullanıcı adı, şifre veya oturum tokenı geçersiz.';
            if (savedConfig.refreshToken) {
                savedConfig.refreshToken = '';
                saveConfiguration();
                updateBoosterState({ hasSavedSession: false });
            }
        } else if (err.eresult === SteamUser.EResult.AccountLogonDenied) {
            message = 'Steam Guard doğrulaması reddedildi.';
        } else if (err.eresult === SteamUser.EResult.RateLimitExceeded) {
            message = 'Çok fazla giriş denemesi yapıldı. Lütfen biraz bekleyin.';
        }
        
        addLog(`Hata: ${message}`, 'error');
        stopTicker();
        updateBoosterState({
            status: 'error',
            error: message,
            qrDataUrl: null
        });
    });

    client.on('disconnected', (eresult, msg) => {
        addLog(`Steam bağlantısı kesildi: ${msg || eresult}`, 'warning');
        if (boosterState.status === 'running') {
            updateBoosterState({ status: 'logging_in' });
        }
    });

    return client;
}

async function getSteamWebCookies(steamClient) {
    if (latestWebCookies && latestWebCookies.length > 0) {
        return latestWebCookies;
    }

    return new Promise((resolve) => {
        let finished = false;
        const timer = setTimeout(() => {
            if (!finished) {
                finished = true;
                resolve(latestWebCookies || null);
            }
        }, 10000);

        steamClient.once('webSession', (sessionID, cookies) => {
            latestWebCookies = cookies;
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                resolve(cookies);
            }
        });

        try {
            steamClient.webLogOn();
        } catch(e) {
            if (!finished) {
                finished = true;
                clearTimeout(timer);
                resolve(null);
            }
        }
    });
}

async function getSteamFamiliesAppIds(cookies) {
    if (!cookies || !cookies.length) return [];
    try {
        const cookieStr = cookies.join('; ');
        const configResp = await fetch('https://store.steampowered.com/pointssummary/ajaxgetasyncconfig', {
            headers: {
                'Cookie': cookieStr,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            }
        });
        const configJson = await configResp.json();
        const webapiToken = configJson?.data?.webapi_token || configJson?.webapi_token;
        if (!webapiToken) {
            console.log('webapi_token not found in ajaxgetasyncconfig response');
            return [];
        }

        const sharedUrl = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token=${encodeURIComponent(webapiToken)}&family_groupid=0&include_own=true&include_free=false`;
        const sharedResp = await fetch(sharedUrl);
        const sharedJson = await sharedResp.json();
        const appList = (sharedJson?.response?.apps || []).map(a => Number(a.appid)).filter(id => !isNaN(id) && id > 0);
        return appList;
    } catch(e) {
        console.error('Steam Families lookup error:', e.message);
        return [];
    }
}

async function fetchUserLibrary() {
    if (!client || !client.steamID) return [];
    try {
        addLog('Hesabındaki oyunlar Steam kütüphanesinden taranıyor...', 'info');
        const res = await client.getUserOwnedApps(client.steamID, {
            includeAppInfo: true,
            includePlayedFreeGames: true,
            includeFreeSub: true
        });

        let apps = (res.apps || []).map(app => ({
            id: app.appid,
            name: app.name || `App ${app.appid}`,
            playtimeHours: Math.round(((app.playtime_forever || 0) / 60) * 10) / 10,
            isFamilyShared: false,
            icon: app.img_icon_url || `https://cdn.cloudflare.steamstatic.com/steam/apps/${app.appid}/header.jpg`
        }));

        // Fetch Steam Families (Aile Paylaşımı) games
        addLog('Steam Aile Paylaşımı (Steam Families) kütüphanesi taranıyor...', 'info');
        try {
            const cookies = await getSteamWebCookies(client);
            let familyAppIds = [];
            if (cookies) {
                familyAppIds = await getSteamFamiliesAppIds(cookies);
            }

            // Also check packages in PICS cache if available
            try {
                if (client.getOwnedApps) {
                    const picsOwned = client.getOwnedApps() || [];
                    picsOwned.forEach(id => {
                        if (!familyAppIds.includes(id)) familyAppIds.push(id);
                    });
                }
            } catch(e) {}

            const existingIds = new Set(apps.map(a => a.id));
            const missingFamilyIds = familyAppIds.filter(id => !existingIds.has(id));

            if (missingFamilyIds.length > 0) {
                addLog(`Aile Paylaşımından ${missingFamilyIds.length} adet paylaşılan oyun bulundu! Bilgileri çekiliyor...`, 'info');
                
                // Fetch game titles in batches of 100 via PICS
                for (let i = 0; i < missingFamilyIds.length; i += 100) {
                    const chunk = missingFamilyIds.slice(i, i + 100);
                    try {
                        const productInfo = await client.getProductInfo(chunk, []);
                        const productApps = productInfo.apps || {};
                        chunk.forEach(id => {
                            const info = productApps[id];
                            const gameName = info?.appinfo?.common?.name;
                            apps.push({
                                id: id,
                                name: gameName || `App #${id}`,
                                playtimeHours: 0,
                                isFamilyShared: true,
                                icon: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`
                            });
                        });
                    } catch(chunkErr) {
                        chunk.forEach(id => {
                            apps.push({
                                id: id,
                                name: `App #${id}`,
                                playtimeHours: 0,
                                isFamilyShared: true,
                                icon: `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`
                            });
                        });
                    }
                }
            }
        } catch(famErr) {
            console.error('Family discovery error:', famErr);
        }

        apps.sort((a, b) => b.playtimeHours - a.playtimeHours);

        boosterState.libraryGames = apps;
        savedConfig.libraryGames = apps;

        // If user hasn't chosen games yet, auto-select top games (up to 32)
        if (!savedConfig.games || savedConfig.games.length === 0) {
            savedConfig.games = apps.slice(0, 32).map(a => ({ id: a.id, name: a.name }));
            addLog(`Kütüphanenden ${savedConfig.games.length} oyun otomatik olarak saat kasma listesine eklendi!`, 'success');
        }

        saveConfiguration();
        addLog(`Toplam ${apps.length} adet oyun (kendi oyunların + Aile Paylaşımı) başarıyla yüklendi!`, 'success');
        
        broadcast({ type: 'library', data: apps });
        updateBoosterState({ libraryGames: apps, activeGames: savedConfig.games });
        return apps;
    } catch(err) {
        console.error('Failed to fetch user library:', err);
        addLog(`Kütüphane listesi alınamadı: ${err.message}`, 'warning');
        return [];
    }
}

function applyActiveGames() {
    if (!client || !client.steamID) return;

    if (cardFarmingState.active) {
        applyCardFarmingGame();
        return;
    }

    const gameIds = savedConfig.games.map(g => Number(g.id)).filter(id => !isNaN(id) && id > 0);
    const targetGames = gameIds.slice(0, 32);

    if (savedConfig.customStatus && savedConfig.customStatus.trim().length > 0) {
        targetGames.unshift(savedConfig.customStatus.trim());
    }

    client.gamesPlayed(targetGames);
    updateBoosterState({ activeGames: savedConfig.games });
    addLog(`${gameIds.length} oyun için saat kasma aktif edildi: [${savedConfig.games.map(g => g.name || g.id).join(', ')}]`, 'success');
}

// ==========================================
// CARD FARMING ENGINE (KART ÇİFTLİĞİ)
// ==========================================

async function scanUserBadges(steamClient) {
    if (!steamClient || !steamClient.steamID) return [];
    try {
        cardFarmingState.scanning = true;
        updateBoosterState({ cardFarming: cardFarmingState });
        addLog('Steam rozetleri ve kart düşürme hakları taranıyor...', 'info');

        const cookies = await getSteamWebCookies(steamClient);
        if (!cookies) {
            addLog('Steam web oturumu alınamadığı için rozetler taranamadı.', 'warning');
            cardFarmingState.scanning = false;
            updateBoosterState({ cardFarming: cardFarmingState });
            return [];
        }

        const cookieStr = cookies.join('; ') + '; Steam_Language=english';
        const steamId = steamClient.steamID.getSteamID64();

        const allGamesWithDrops = [];
        let page = 1;

        while (page <= 25) {
            const resp = await fetch(`https://steamcommunity.com/profiles/${steamId}/badges/?p=${page}&l=english`, {
                headers: {
                    'Cookie': cookieStr,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const html = await resp.text();
            const badgeRows = html.split(/class=["']badge_row\s+/);
            if (badgeRows.length <= 1) break;

            for (let i = 1; i < badgeRows.length; i++) {
                const row = badgeRows[i];
                const dropMatch = row.match(/(\d+)\s+card drops?\s+remaining/i);
                if (!dropMatch) continue;

                const cardsRemaining = parseInt(dropMatch[1], 10);
                const cardLinkMatch = row.match(/gamecards\/(\d+)/);
                const appId = cardLinkMatch ? parseInt(cardLinkMatch[1], 10) : null;
                if (!appId) continue;

                const playMatch = row.match(/([0-9\.,]+)\s+hrs on record/i);
                const playtimeHours = playMatch ? parseFloat(playMatch[1].replace(',', '.')) : 0;

                const titleMatch = row.match(/ShowCardDropInfo\(\s*&quot;(.*?)&quot;/i) 
                    || row.match(/<div class="badge_title">\s*([^<]+?)\s*&nbsp;/i)
                    || row.match(/<div class="badge_title">([\s\S]*?)<\/div>/i);
                
                let name = `App ${appId}`;
                if (titleMatch) {
                    name = titleMatch[1].replace(/<[^>]+>/g, '').trim();
                } else {
                    const libFound = (savedConfig.libraryGames || []).find(g => g.id === appId);
                    if (libFound) name = libFound.name;
                }

                allGamesWithDrops.push({
                    id: appId,
                    name,
                    cardsRemaining,
                    playtimeHours,
                    icon: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
                });
            }

            if (!html.includes(`?p=${page + 1}`) && !html.includes(`&amp;p=${page + 1}`)) {
                break;
            }
            page++;
        }

        const totalDrops = allGamesWithDrops.reduce((sum, g) => sum + g.cardsRemaining, 0);
        cardFarmingState.gamesWithDrops = allGamesWithDrops;
        cardFarmingState.totalDropsRemaining = totalDrops;
        cardFarmingState.scanning = false;

        addLog(`Rozet taraması tamamlandı! Kart düşürme hakkı olan ${allGamesWithDrops.length} oyun ve toplam ${totalDrops} kart bulundu.`, 'success');
        updateBoosterState({ cardFarming: cardFarmingState });
        return allGamesWithDrops;
    } catch(err) {
        console.error('Badge scan error:', err);
        addLog(`Rozet tarama hatası: ${err.message}`, 'warning');
        cardFarmingState.scanning = false;
        updateBoosterState({ cardFarming: cardFarmingState });
        return [];
    }
}

async function checkSingleGameDrops(steamClient, appId) {
    if (!steamClient || !steamClient.steamID || !appId) return null;
    try {
        const cookies = await getSteamWebCookies(steamClient);
        if (!cookies) return null;

        const cookieStr = cookies.join('; ') + '; Steam_Language=english';
        const steamId = steamClient.steamID.getSteamID64();

        const resp = await fetch(`https://steamcommunity.com/profiles/${steamId}/gamecards/${appId}/?l=english`, {
            headers: {
                'Cookie': cookieStr,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        const html = await resp.text();
        const dropMatch = html.match(/(\d+)\s+card drops?\s+remaining/i);
        if (dropMatch) {
            return parseInt(dropMatch[1], 10);
        }
        return 0;
    } catch(e) {
        console.error('Error checking single game drops:', e.message);
        return null;
    }
}

function applyCardFarmingGame() {
    if (!client || !client.steamID || !cardFarmingState.active) return;
    if (!cardFarmingState.currentGame) {
        if (cardFarmingState.gamesWithDrops.length > 0) {
            cardFarmingState.currentGame = cardFarmingState.gamesWithDrops[0];
        } else {
            addLog('🏆 Tebrikler! Tüm kartlar düşürüldü, kart çiftliği tamamlandı!', 'success');
            stopCardFarming();
            return;
        }
    }

    const game = cardFarmingState.currentGame;
    const targets = [game.id];
    if (savedConfig.customStatus && savedConfig.customStatus.trim().length > 0) {
        targets.unshift(`${savedConfig.customStatus.trim()} • 🃏 Kart Kasılıyor`);
    } else {
        targets.unshift(`🃏 Kart Kasılıyor: ${game.name}`);
    }

    client.gamesPlayed(targets);
    addLog(`🃏 Kart Çiftliği Devrede: "${game.name}" çalıştırılıyor (${game.cardsRemaining} kart hakkı kaldı).`, 'info');
    updateBoosterState({ cardFarming: cardFarmingState });
}

async function checkCardFarmingTick() {
    if (!client || !client.steamID || !cardFarmingState.active || !cardFarmingState.currentGame) return;

    const game = cardFarmingState.currentGame;
    addLog(`🃏 "${game.name}" için kart kontrolü yapılıyor...`, 'info');
    cardFarmingState.lastCheckTime = Date.now();

    const remaining = await checkSingleGameDrops(client, game.id);
    if (remaining === null) {
        addLog('Kart durumu kontrol edilirken bağlantı hatası oluştu, bir sonraki döngüde tekrar denenecek.', 'warning');
        return;
    }

    if (remaining < game.cardsRemaining) {
        const droppedCount = game.cardsRemaining - remaining;
        cardFarmingState.farmedThisSession += droppedCount;
        game.cardsRemaining = remaining;
        cardFarmingState.totalDropsRemaining = Math.max(0, cardFarmingState.totalDropsRemaining - droppedCount);

        addLog(`🎉 TEBRİKLER! "${game.name}" için ${droppedCount} kart düştü! (Kalan: ${remaining} kart)`, 'success');
    }

    if (remaining === 0) {
        addLog(`✅ "${game.name}" oyununun tüm kartları tamamlandı! Sıradaki oyuna geçiliyor...`, 'success');
        cardFarmingState.gamesWithDrops = cardFarmingState.gamesWithDrops.filter(g => g.id !== game.id);
        if (cardFarmingState.gamesWithDrops.length > 0) {
            cardFarmingState.currentGame = cardFarmingState.gamesWithDrops[0];
            applyCardFarmingGame();
        } else {
            cardFarmingState.currentGame = null;
            addLog('🏆 Kütüphanendeki tüm oyunların kartları başarıyla düşürüldü! Normal saat kasmaya dönülüyor.', 'success');
            stopCardFarming();
        }
    } else {
        updateBoosterState({ cardFarming: cardFarmingState });
    }
}

function startCardFarming() {
    if (!client || !client.steamID) {
        addLog('Kart çiftliğini başlatmak için önce Steam girişi yapılmalıdır.', 'error');
        return;
    }

    if (!cardFarmingState.gamesWithDrops || cardFarmingState.gamesWithDrops.length === 0) {
        addLog('Kart hakkı olan oyunlar taranıyor...', 'info');
        scanUserBadges(client).then(games => {
            if (games.length > 0) {
                startCardFarming();
            } else {
                addLog('Kütüphanende kart hakkı kalan oyun bulunamadı.', 'info');
            }
        });
        return;
    }

    cardFarmingState.active = true;
    if (!cardFarmingState.currentGame) {
        cardFarmingState.currentGame = cardFarmingState.gamesWithDrops[0];
    }
    applyCardFarmingGame();

    if (cardFarmingInterval) clearInterval(cardFarmingInterval);
    cardFarmingInterval = setInterval(checkCardFarmingTick, 10 * 60 * 1000);
    updateBoosterState({ cardFarming: cardFarmingState });
}

function stopCardFarming() {
    cardFarmingState.active = false;
    if (cardFarmingInterval) {
        clearInterval(cardFarmingInterval);
        cardFarmingInterval = null;
    }
    updateBoosterState({ cardFarming: cardFarmingState });
    addLog('Kart çiftliği durduruldu.', 'info');
    if (boosterState.status === 'running') {
        applyActiveGames();
    }
}

// REST Endpoints
app.get('/api/config', (req, res) => {
    res.json(savedConfig);
});

app.get('/api/library', (req, res) => {
    res.json(savedConfig.libraryGames || []);
});

app.post('/api/refresh-library', async (req, res) => {
    if (!client || !client.steamID) {
        return res.status(400).json({ error: 'Önce Steam girişi yapılmalıdır.' });
    }
    const apps = await fetchUserLibrary();
    res.json({ success: true, count: apps.length });
});

app.post('/api/config', (req, res) => {
    const { games, customStatus, accountName } = req.body;
    if (games) savedConfig.games = games;
    if (customStatus !== undefined) savedConfig.customStatus = customStatus;
    if (accountName !== undefined) savedConfig.accountName = accountName;
    saveConfiguration();

    if (boosterState.status === 'running') {
        applyActiveGames();
    }

    res.json({ success: true, config: savedConfig });
});

// START QR CODE AUTHENTICATION
app.post('/api/start-qr', async (req, res) => {
    try {
        if (currentLoginSession) {
            try {
                currentLoginSession.cancelLoginAttempt();
            } catch(e) {}
        }

        addLog('Steam Mobile QR kodu oluşturuluyor...', 'info');
        updateBoosterState({
            status: 'waiting_qr',
            error: null,
            qrDataUrl: null
        });

        const session = new LoginSession(EAuthTokenPlatformType.SteamClient);
        currentLoginSession = session;

        const startResult = await session.startWithQR();
        const qrDataUrl = await QRCode.toDataURL(startResult.qrChallengeUrl, {
            margin: 2,
            width: 260,
            color: {
                dark: '#0f172a',
                light: '#ffffff'
            }
        });

        updateBoosterState({
            status: 'waiting_qr',
            qrDataUrl: qrDataUrl
        });

        addLog('QR kodu hazır! Steam Mobile uygulamanı açıp tara ve ekrandan onayla.', 'info');

        session.on('authenticated', async () => {
            addLog(`QR kodu doğrulandı! Hesap: ${session.accountName || 'Onaylandı'}`, 'success');
            savedConfig.accountName = session.accountName || savedConfig.accountName;
            savedConfig.refreshToken = session.refreshToken;
            saveConfiguration();

            updateBoosterState({
                status: 'logging_in',
                account: session.accountName,
                hasSavedSession: true,
                qrDataUrl: null
            });

            // Log into steam-user with the refreshToken
            const steamClient = createSteamClient();
            steamClient.logOn({
                refreshToken: session.refreshToken,
                logonID: Math.floor(Math.random() * 1000000) + 1
            });
        });

        session.on('timeout', () => {
            addLog('QR kodunun süresi doldu. Lütfen yenileyin.', 'warning');
            updateBoosterState({
                status: 'idle',
                qrDataUrl: null,
                error: 'QR kod süresi doldu.'
            });
        });

        session.on('error', (err) => {
            addLog(`QR oturum hatası: ${err.message}`, 'error');
            updateBoosterState({
                status: 'error',
                qrDataUrl: null,
                error: err.message
            });
        });

        res.json({ success: true, qrDataUrl });
    } catch(err) {
        console.error('QR start error:', err);
        addLog(`QR kodu oluşturulamadı: ${err.message}`, 'error');
        updateBoosterState({
            status: 'error',
            error: err.message
        });
        res.status(500).json({ error: err.message });
    }
});

// START WITH SAVED SESSION (Refresh Token)
app.post('/api/start-saved', (req, res) => {
    if (!savedConfig.refreshToken) {
        return res.status(400).json({ error: 'Kayıtlı oturum bulunamadı. Lütfen QR kod ile giriş yapın.' });
    }

    addLog(`Kayıtlı oturumla (${savedConfig.accountName || 'Kayıtlı Hesap'}) Steam'e bağlanılıyor...`, 'info');
    updateBoosterState({
        status: 'logging_in',
        error: null,
        elapsedSeconds: 0
    });

    const steamClient = createSteamClient();
    steamClient.logOn({
        refreshToken: savedConfig.refreshToken,
        logonID: Math.floor(Math.random() * 1000000) + 1
    });

    res.json({ success: true });
});

// START WITH USERNAME & PASSWORD (Fallback)
app.post('/api/start-password', (req, res) => {
    const { accountName, password } = req.body;

    if (!accountName || !password) {
        return res.status(400).json({ error: 'Kullanıcı adı ve şifre zorunludur.' });
    }

    savedConfig.accountName = accountName;
    saveConfiguration();

    addLog(`"${accountName}" hesabı ile şifreli giriş deneniyor...`, 'info');
    updateBoosterState({
        status: 'logging_in',
        error: null,
        elapsedSeconds: 0
    });

    const steamClient = createSteamClient();
    steamClient.logOn({
        accountName,
        password
    });

    res.json({ success: true });
});

// SUBMIT 2FA / EMAIL GUARD CODE
app.post('/api/submit-guard', (req, res) => {
    const { code } = req.body;
    if (!code || !client || !client._steamGuardCallback) {
        return res.status(400).json({ error: 'Aktif bir Steam Guard isteği bulunamadı veya kod boş.' });
    }

    addLog(`Doğrulama kodu gönderiliyor...`, 'info');
    const cb = client._steamGuardCallback;
    client._steamGuardCallback = null;
    cb(code.trim());

    res.json({ success: true });
});

// CLEAR SAVED SESSION
app.post('/api/forget-session', (req, res) => {
    savedConfig.refreshToken = '';
    saveConfiguration();
    updateBoosterState({ hasSavedSession: false });
    addLog('Kayıtlı Steam oturumu silindi.', 'info');
    res.json({ success: true });
});

// STOP BOOSTER
app.post('/api/stop', (req, res) => {
    stopTicker();
    stopCardFarming();
    if (currentLoginSession) {
        try { currentLoginSession.cancelLoginAttempt(); } catch(e) {}
    }
    if (client) {
        try {
            client.gamesPlayed([]);
            client.logOff();
        } catch(e) {}
    }

    addLog('Saat kasma ve kart çiftliği durduruldu, Steam çıkışı yapıldı.', 'info');
    updateBoosterState({
        status: 'idle',
        error: null,
        guardType: null,
        qrDataUrl: null,
        startTime: null
    });

    res.json({ success: true });
});

// CARD FARMING ENDPOINTS
app.get('/api/card-farming', (req, res) => {
    res.json(cardFarmingState);
});

app.post('/api/card-farming/scan', async (req, res) => {
    if (!client || !client.steamID) {
        return res.status(400).json({ error: 'Önce Steam girişi yapılmalıdır.' });
    }
    const games = await scanUserBadges(client);
    res.json({ success: true, count: games.length, games });
});

app.post('/api/card-farming/start', (req, res) => {
    if (!client || !client.steamID) {
        return res.status(400).json({ error: 'Önce Steam girişi yapılmalıdır.' });
    }
    startCardFarming();
    res.json({ success: true, state: cardFarmingState });
});

app.post('/api/card-farming/stop', (req, res) => {
    stopCardFarming();
    res.json({ success: true, state: cardFarmingState });
});

app.post('/api/card-farming/check-now', async (req, res) => {
    if (!client || !client.steamID) {
        return res.status(400).json({ error: 'Önce Steam girişi yapılmalıdır.' });
    }
    await checkCardFarmingTick();
    res.json({ success: true, state: cardFarmingState });
});

app.post('/api/card-farming/select-game', (req, res) => {
    const { appId } = req.body;
    const found = cardFarmingState.gamesWithDrops.find(g => g.id === Number(appId));
    if (!found) {
        return res.status(404).json({ error: 'Oyun kart listesinde bulunamadı.' });
    }
    cardFarmingState.currentGame = found;
    if (cardFarmingState.active) {
        applyCardFarmingGame();
    } else {
        updateBoosterState({ cardFarming: cardFarmingState });
    }
    res.json({ success: true, currentGame: found });
});

app.get('/api/state', (req, res) => {
    res.json(boosterState);
});

// Search Steam Store for Game Title & Header image
app.get('/api/steam-search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);

    try {
        const resp = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=english&cc=US`);
        const json = await resp.json();
        
        const items = (json.items || []).map(item => ({
            id: item.id,
            name: item.name,
            icon: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/header.jpg`
        }));
        res.json(items);
    } catch(e) {
        res.json([]);
    }
});

wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'init', data: boosterState, config: savedConfig }));
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Steam Hour Booster çalışıyor: http://0.0.0.0:${PORT}`);
});

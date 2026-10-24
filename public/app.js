let config = {
    accountName: '',
    customStatus: '',
    games: [],
    libraryGames: []
};

let currentState = {
    status: 'idle',
    error: null,
    account: null,
    hasSavedSession: false,
    guardType: null,
    activeGames: [],
    libraryGames: [],
    startTime: null,
    elapsedSeconds: 0,
    qrDataUrl: null,
    logHistory: []
};

let currentTab = 'active'; // 'active' | 'library'
let ws = null;
let searchDebounceTimer = null;

// DOM Elements
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const authTabs = document.getElementById('authTabs');
const tabQrBtn = document.getElementById('tabQrBtn');
const tabPassBtn = document.getElementById('tabPassBtn');
const qrTab = document.getElementById('qrTab');
const passTab = document.getElementById('passTab');

const qrImage = document.getElementById('qrImage');
const qrPlaceholder = document.getElementById('qrPlaceholder');
const generateQrBtn = document.getElementById('generateQrBtn');

const savedSessionBlock = document.getElementById('savedSessionBlock');
const savedAccountName = document.getElementById('savedAccountName');
const startSavedBtn = document.getElementById('startSavedBtn');
const forgetSessionBtn = document.getElementById('forgetSessionBtn');

const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const startPasswordBtn = document.getElementById('startPasswordBtn');
const customStatusInput = document.getElementById('customStatusInput');

const activeSessionBlock = document.getElementById('activeSessionBlock');
const sessionUsername = document.getElementById('sessionUsername');
const elapsedTimer = document.getElementById('elapsedTimer');
const multiplierTag = document.getElementById('multiplierTag');
const stopBtn = document.getElementById('stopBtn');

const guardBlock = document.getElementById('guardBlock');
const guardTitle = document.getElementById('guardTitle');
const guardSub = document.getElementById('guardSub');
const guardCodeInput = document.getElementById('guardCodeInput');
const submitGuardBtn = document.getElementById('submitGuardBtn');

const statGameCount = document.getElementById('statGameCount');
const statTotalHours = document.getElementById('statTotalHours');
const gameLimitCount = document.getElementById('gameLimitCount');
const gamesGrid = document.getElementById('gamesGrid');
const gameSearchInput = document.getElementById('gameSearchInput');
const searchResults = document.getElementById('searchResults');
const addGameBtn = document.getElementById('addGameBtn');

// Library Elements
const viewActiveBtn = document.getElementById('viewActiveBtn');
const viewLibraryBtn = document.getElementById('viewLibraryBtn');
const activeBadgeCount = document.getElementById('activeBadgeCount');
const totalLibCount = document.getElementById('totalLibCount');
const selectTop32Btn = document.getElementById('selectTop32Btn');
const clearAllGamesBtn = document.getElementById('clearAllGamesBtn');
const refreshLibBtn = document.getElementById('refreshLibBtn');
const emptyLibBanner = document.getElementById('emptyLibBanner');

const terminalWindow = document.getElementById('terminalWindow');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Initialize WebSocket connection
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
        try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'init') {
                config = payload.config;
                currentState = payload.data;
                populateConfigInputs();
                renderGamesList();
                renderState();
                renderLogs(currentState.logHistory);
            } else if (payload.type === 'state') {
                currentState = payload.data;
                if (currentState.activeGames) config.games = currentState.activeGames;
                renderState();
                renderGamesList();
            } else if (payload.type === 'library') {
                currentState.libraryGames = payload.data;
                config.libraryGames = payload.data;
                if (payload.activeGames) config.games = payload.activeGames;
                renderGamesList();
            } else if (payload.type === 'tick') {
                currentState.elapsedSeconds = payload.elapsedSeconds;
                updateElapsedTimer(payload.elapsedSeconds);
            } else if (payload.type === 'log') {
                prependLog(payload.data);
            }
        } catch(e) {
            console.error('Error handling WS message:', e);
        }
    };

    ws.onclose = () => {
        setTimeout(initWebSocket, 2000);
    };
}

function populateConfigInputs() {
    if (config.accountName && !usernameInput.value) {
        usernameInput.value = config.accountName;
    }
    if (config.customStatus !== undefined) {
        customStatusInput.value = config.customStatus;
    }
}

function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
}

function updateElapsedTimer(seconds) {
    elapsedTimer.textContent = formatTime(seconds);
    const activeGamesCount = config.games ? config.games.length : 1;
    const totalGainedHours = ((seconds / 3600) * activeGamesCount).toFixed(2);
    statTotalHours.textContent = `${totalGainedHours}h`;
}

function renderState() {
    statusBadge.className = `status-badge ${currentState.status}`;
    
    // Saved session banner
    if (currentState.hasSavedSession && currentState.status === 'idle') {
        savedSessionBlock.classList.remove('hidden');
        savedAccountName.textContent = currentState.account || config.accountName || 'Kayıtlı Steam Hesabı';
    } else {
        savedSessionBlock.classList.add('hidden');
    }

    // QR Image display
    if (currentState.qrDataUrl) {
        qrImage.src = currentState.qrDataUrl;
        qrImage.classList.remove('hidden');
        qrPlaceholder.classList.add('hidden');
    } else if (currentState.status !== 'waiting_qr') {
        qrImage.classList.add('hidden');
        qrPlaceholder.classList.remove('hidden');
    }

    switch(currentState.status) {
        case 'idle':
            statusText.textContent = 'Boşta (Durduruldu)';
            authTabs.classList.remove('hidden');
            qrTab.classList.remove('hidden');
            activeSessionBlock.classList.add('hidden');
            guardBlock.classList.add('hidden');
            generateQrBtn.disabled = false;
            generateQrBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                </svg>
                QR Kodunu Göster / Yenile`;
            break;

        case 'waiting_qr':
            statusText.textContent = 'Steam Mobile QR Taranması Bekleniyor...';
            authTabs.classList.remove('hidden');
            generateQrBtn.disabled = false;
            generateQrBtn.textContent = 'Yeni QR Kodu İste';
            break;

        case 'logging_in':
            statusText.textContent = 'Steam\'e Giriş Yapılıyor & Oyunlar Çekiliyor...';
            guardBlock.classList.add('hidden');
            break;

        case 'guard_needed':
            statusText.textContent = 'Doğrulama Kodu Bekleniyor';
            guardBlock.classList.remove('hidden');
            if (currentState.guardType === 'steamguard') {
                guardTitle.textContent = 'E-Posta Steam Guard Kodu Gerekli';
                guardSub.textContent = 'Steam hesabına bağlı e-posta adresine gelen kodu gir:';
            } else {
                guardTitle.textContent = 'Mobil Kimlik Doğrulayıcı (2FA) Kodu Gerekli';
                guardSub.textContent = 'Steam Mobile uygulamasındaki 5 haneli 2FA kodunu gir:';
            }
            guardCodeInput.focus();
            break;

        case 'running':
            statusText.textContent = 'Çalışıyor ⚡ Saat Kasılıyor';
            authTabs.classList.add('hidden');
            qrTab.classList.add('hidden');
            passTab.classList.add('hidden');
            savedSessionBlock.classList.add('hidden');
            guardBlock.classList.add('hidden');
            activeSessionBlock.classList.remove('hidden');
            sessionUsername.textContent = currentState.account || usernameInput.value || 'Steam Kullanıcısı';
            multiplierTag.textContent = `${(config.games || []).length}x Eşzamanlı Saat Çarpanı`;
            updateElapsedTimer(currentState.elapsedSeconds || 0);
            break;

        case 'error':
            statusText.textContent = `Hata: ${currentState.error || 'Bağlantı hatası'}`;
            authTabs.classList.remove('hidden');
            activeSessionBlock.classList.add('hidden');
            guardBlock.classList.add('hidden');
            generateQrBtn.disabled = false;
            break;
    }

    const activeCount = (config.games || []).length;
    statGameCount.textContent = activeCount;
    gameLimitCount.textContent = activeCount;
    activeBadgeCount.textContent = activeCount;
    totalLibCount.textContent = (currentState.libraryGames || config.libraryGames || []).length;
}

// Tab navigation for Auth
tabQrBtn.addEventListener('click', () => {
    tabQrBtn.classList.add('active');
    tabPassBtn.classList.remove('active');
    qrTab.classList.remove('hidden');
    passTab.classList.add('hidden');
});

tabPassBtn.addEventListener('click', () => {
    tabPassBtn.classList.add('active');
    tabQrBtn.classList.remove('active');
    passTab.classList.remove('hidden');
    qrTab.classList.add('hidden');
});

// View switching between Active Games and Library
viewActiveBtn.addEventListener('click', () => {
    currentTab = 'active';
    viewActiveBtn.classList.add('active');
    viewLibraryBtn.classList.remove('active');
    renderGamesList();
});

viewLibraryBtn.addEventListener('click', () => {
    currentTab = 'library';
    viewLibraryBtn.classList.add('active');
    viewActiveBtn.classList.remove('active');
    renderGamesList();
});

// Generate QR Code request
generateQrBtn.addEventListener('click', async () => {
    generateQrBtn.disabled = true;
    generateQrBtn.textContent = 'QR Kodu Oluşturuluyor...';
    try {
        const res = await fetch('/api/start-qr', { method: 'POST' });
        const data = await res.json();
        if (data.success && data.qrDataUrl) {
            qrImage.src = data.qrDataUrl;
            qrImage.classList.remove('hidden');
            qrPlaceholder.classList.add('hidden');
        }
    } catch(e) {
        alert('QR kod sunucu hatası.');
    } finally {
        generateQrBtn.disabled = false;
        generateQrBtn.textContent = 'Yeni QR Kodu İste';
    }
});

// Start with saved session
startSavedBtn.addEventListener('click', async () => {
    try {
        const res = await fetch('/api/start-saved', { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
            alert(data.error);
        }
    } catch(e) {
        alert('Kayıtlı oturumla bağlanılamadı.');
    }
});

// Forget saved session
forgetSessionBtn.addEventListener('click', async () => {
    if (confirm('Kayıtlı oturumu silmek istediğinden emin misin?')) {
        await fetch('/api/forget-session', { method: 'POST' });
    }
});

// Password login fallback
startPasswordBtn.addEventListener('click', async () => {
    const accountName = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!accountName || !password) {
        alert('Lütfen Steam Kullanıcı Adı ve Şifrenizi girin.');
        return;
    }

    config.accountName = accountName;
    saveCurrentConfig();

    try {
        const res = await fetch('/api/start-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountName, password })
        });
        const data = await res.json();
        if (!data.success) {
            alert(data.error || 'Başlatma başarısız');
        }
    } catch(e) {
        alert('Sunucuyla iletişim kurulamadı.');
    }
});

// Quick action: Select top 32 played games
selectTop32Btn.addEventListener('click', () => {
    const lib = currentState.libraryGames || config.libraryGames || [];
    if (lib.length === 0) {
        alert('Henüz kütüphane taranmadı. Önce Steam hesabına giriş yapmalısın.');
        return;
    }

    config.games = lib.slice(0, 32).map(app => ({
        id: app.id,
        name: app.name,
        playtimeHours: app.playtimeHours
    }));

    renderGamesList();
    saveCurrentConfig();
});

// Quick action: Clear all
clearAllGamesBtn.addEventListener('click', () => {
    if (config.games.length === 0) return;
    if (confirm('Saat kasma listesindeki tüm oyunları kaldırmak istiyor musun?')) {
        config.games = [];
        renderGamesList();
        saveCurrentConfig();
    }
});

// Refresh library from Steam
refreshLibBtn.addEventListener('click', async () => {
    refreshLibBtn.disabled = true;
    refreshLibBtn.textContent = 'Taranıyor...';
    try {
        const res = await fetch('/api/refresh-library', { method: 'POST' });
        const data = await res.json();
        if (!data.success) {
            alert(data.error || 'Kütüphane yenilenemedi.');
        }
    } catch(e) {
        alert('Kütüphane isteği başarısız oldu.');
    } finally {
        refreshLibBtn.disabled = false;
        refreshLibBtn.textContent = '🔄 Kütüphaneyi Yenile';
    }
});

function renderGamesList() {
    gamesGrid.innerHTML = '';
    const activeGames = config.games || [];
    const library = currentState.libraryGames || config.libraryGames || [];

    activeBadgeCount.textContent = activeGames.length;
    totalLibCount.textContent = library.length;
    gameLimitCount.textContent = activeGames.length;
    statGameCount.textContent = activeGames.length;
    multiplierTag.textContent = `${activeGames.length}x Eşzamanlı Saat Çarpanı`;

    if (library.length === 0 && activeGames.length === 0) {
        emptyLibBanner.classList.remove('hidden');
    } else {
        emptyLibBanner.classList.add('hidden');
    }

    const searchTerm = gameSearchInput.value.trim().toLowerCase();

    if (currentTab === 'active') {
        // Render Active Boost Games
        let filtered = activeGames;
        if (searchTerm) {
            filtered = activeGames.filter(g => (g.name || '').toLowerCase().includes(searchTerm) || String(g.id).includes(searchTerm));
        }

        if (filtered.length === 0 && activeGames.length === 0) {
            gamesGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
                    Saat kasma listen henüz boş.<br>
                    <strong>"📚 Tüm Kütüphanem"</strong> sekmesine geçerek istediğin oyunları seçebilir veya 
                    <strong>"🔥 En Çok Oynanan 32'yi Seç"</strong> butonuna basabilirsin!
                </div>
            `;
            return;
        }

        filtered.forEach((game, index) => {
            const item = document.createElement('div');
            item.className = 'game-item in-active-list';
            
            const headerUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.id}/header.jpg`;

            item.innerHTML = `
                <span class="game-tag-active">AKTİF</span>
                <div class="game-item-header" style="background-image: url('${headerUrl}'), linear-gradient(135deg, #1e293b, #0f172a);"></div>
                <div class="game-item-body">
                    <div>
                        <div class="game-title" title="${game.name}">${game.name}</div>
                        <div class="game-appid">ID: ${game.id}</div>
                    </div>
                    <button class="delete-game-btn" title="Listeden Kaldır" data-id="${game.id}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            `;
            gamesGrid.appendChild(item);
        });

        document.querySelectorAll('.delete-game-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.currentTarget.dataset.id);
                toggleGameInList(id);
            });
        });

    } else {
        // Render Full Account Library
        let filtered = library;
        if (searchTerm) {
            filtered = library.filter(g => (g.name || '').toLowerCase().includes(searchTerm) || String(g.id).includes(searchTerm));
        }

        if (filtered.length === 0) {
            gamesGrid.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
                    ${searchTerm ? 'Aramanıza uygun oyun bulunamadı.' : 'Kütüphane taranıyor veya henüz giriş yapılmadı.'}
                </div>
            `;
            return;
        }

        filtered.forEach(game => {
            const isSelected = activeGames.some(g => g.id === game.id);
            const item = document.createElement('div');
            item.className = `game-item ${isSelected ? 'in-active-list' : ''}`;
            item.style.cursor = 'pointer';

            const headerUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.id}/header.jpg`;

            item.innerHTML = `
                ${isSelected ? '<span class="game-tag-active">SEÇİLDİ</span>' : ''}
                <div class="game-item-header" style="background-image: url('${headerUrl}'), linear-gradient(135deg, #1e293b, #0f172a);"></div>
                <div class="game-item-body">
                    <div>
                        <div class="game-title" title="${game.name}">
                            ${game.name}
                            ${game.isFamilyShared ? '<span class="family-badge">Aile Paylaşımı</span>' : ''}
                        </div>
                        <div class="game-appid">ID: ${game.id} • ${game.playtimeHours !== undefined ? (game.isFamilyShared && game.playtimeHours === 0 ? 'Paylaşılan Kütüphane' : game.playtimeHours + ' saat oynandı') : ''}</div>
                    </div>
                    <button class="btn btn-sm ${isSelected ? 'btn-danger' : 'btn-success'}" style="width: auto;">
                        ${isSelected ? 'Çıkar' : '+ Seç'}
                    </button>
                </div>
            `;

            item.addEventListener('click', () => {
                toggleGameInList(game.id, game.name, game.playtimeHours);
            });

            gamesGrid.appendChild(item);
        });
    }
}

function toggleGameInList(id, name, playtimeHours) {
    const numericId = parseInt(id);
    const existingIndex = config.games.findIndex(g => g.id === numericId);

    if (existingIndex >= 0) {
        // Remove from list
        config.games.splice(existingIndex, 1);
    } else {
        // Add to list
        if (config.games.length >= 32) {
            alert('Steam aynı anda maksimum 32 oyuna izin vermektedir. Önce bir oyunu çıkarmanız gerekiyor.');
            return;
        }

        const libGame = (currentState.libraryGames || []).find(g => g.id === numericId);
        config.games.push({
            id: numericId,
            name: name || (libGame ? libGame.name : `Steam App #${numericId}`),
            playtimeHours: playtimeHours || (libGame ? libGame.playtimeHours : 0)
        });
    }

    renderGamesList();
    saveCurrentConfig();
}

async function saveCurrentConfig() {
    config.customStatus = customStatusInput.value;
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
    } catch(e) {
        console.error('Config save failed', e);
    }
}

function prependLog(entry) {
    const el = document.createElement('div');
    el.className = `log-entry ${entry.type}`;
    el.innerHTML = `<span class="log-time">[${entry.time}]</span> ${entry.msg}`;
    terminalWindow.insertBefore(el, terminalWindow.firstChild);
}

function renderLogs(logs) {
    terminalWindow.innerHTML = '';
    (logs || []).slice().reverse().forEach(entry => prependLog(entry));
}

// Live search input handler
gameSearchInput.addEventListener('input', () => {
    renderGamesList();
});

// Manual Add Button
addGameBtn.addEventListener('click', () => {
    const val = gameSearchInput.value.trim();
    if (!val) return;
    const num = parseInt(val);
    if (!isNaN(num) && num > 0) {
        toggleGameInList(num, `App ${num}`);
        gameSearchInput.value = '';
    } else {
        alert('Lütfen geçerli bir sayısal App ID girin.');
    }
});

// Steam guard submit (for password fallback)
submitGuardBtn.addEventListener('click', async () => {
    const code = guardCodeInput.value.trim();
    if (!code) return;

    try {
        const res = await fetch('/api/submit-guard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.success) {
            guardCodeInput.value = '';
        } else {
            alert(data.error);
        }
    } catch(e) {
        alert('Kod iletilemedi.');
    }
});

guardCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitGuardBtn.click();
});

// Stop button
stopBtn.addEventListener('click', async () => {
    try {
        await fetch('/api/stop', { method: 'POST' });
    } catch(e) {
        console.error('Stop error:', e);
    }
});

clearLogsBtn.addEventListener('click', () => {
    terminalWindow.innerHTML = '';
});

const saveStatusBtn = document.getElementById('saveStatusBtn');
if (saveStatusBtn) {
    saveStatusBtn.addEventListener('click', async () => {
        saveStatusBtn.disabled = true;
        saveStatusBtn.textContent = 'Kaydediliyor...';
        await saveCurrentConfig();
        saveStatusBtn.disabled = false;
        saveStatusBtn.textContent = 'Uygulandı ✓';
        setTimeout(() => { saveStatusBtn.textContent = 'Uygula'; }, 1500);
    });
}

customStatusInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        saveCurrentConfig();
        if (saveStatusBtn) {
            saveStatusBtn.textContent = 'Uygulandı ✓';
            setTimeout(() => { saveStatusBtn.textContent = 'Uygula'; }, 1500);
        }
    }
});

// Initialize on start
initWebSocket();

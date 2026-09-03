 // GOOGLE DRIVE CLIENT CONFIGURATION
        let GOOGLE_CLIENT_ID = '520227032774-9joaijquq6027bjj86k1tnrvraahh0rj.apps.googleusercontent.com';
        const GDRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email';
        const GDRIVE_FILE_NAME = 'dompetku_backup.json';

        const STORAGE_USERS = 'dompetku_users_db';
        const STORAGE_SESSION = 'dompetku_active_session';
        const STORAGE_DATA_PREFIX = 'dompetku_data_';
        const STORAGE_GDRIVE_META = 'dompetku_gdrive_meta';
        const STORAGE_FIRST_USED = 'dompetku_first_used';
        const STORAGE_GDRIVE_NUDGE = 'dompetku_gdrive_nudge_last';

        const DEFAULT_CATEGORIES = {
            PEMASUKAN: ['Penjualan Produk', 'Jasa / Layanan', 'Hasil Investasi', 'Pemasukan Lainnya'],
            PENGELUARAN: ['Bahan Baku', 'Gaji Karyawan', 'Sewa Tempat', 'Listrik & Air', 'Pemasaran & Iklan', 'Operasional Harian', 'Pengeluaran Pribadi']
        };

        let state = {
            users: [],
            currentUser: null,
            businessName: 'DompetKu',
            logoBase64: '',
            transactions: [],
            categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
            categoriesEnabled: false,
            reportPeriod: 'BULANAN',
            selectedMonth: new Date().toISOString().slice(0, 7),
            selectedDate: new Date().toISOString().slice(0, 10),
            hasUnsavedChanges: false,
            transactionPage: 1,
            transactionLimit: 10,
            reportPage: 1,
            reportLimit: 10,
            gdrive: {
                accessToken: null,
                tokenExpiry: null,
                userEmail: null,
                lastSyncTime: null,
                syncFreqDays: 1  // 0 = jangan pernah, 1 = 1 hari, 3 = 3 hari, 7 = 7 hari
            }

        };

        let tokenClient = null;
        let chartBarInstance = null;
        let chartPieInstance = null;
        let deferredPrompt = null;
        let pendingConfirmCallback = null;

        // --- FUNGSI FORMAT INPUT NOMINAL ---
        function formatNumberInput(input) {
            let value = input.value.replace(/[^0-9]/g, '');
            if (value === '') {
                input.value = '';
                return;
            }
            const num = parseInt(value);
            input.value = num.toLocaleString('id-ID');
        }

        // --- FUNGSI TOGGLE SUBMIT TRANSFER ---
        function toggleTransferSubmit() {
            const selected = document.querySelector('input[name="transfer-type-radio"]:checked');
            const submitBtn = document.getElementById('transfer-submit-btn');
            const hiddenInput = document.getElementById('transfer-type');
            
            if (selected) {
                hiddenInput.value = selected.value;
                submitBtn.disabled = false;
                submitBtn.className = 'w-1/2 bg-navy-900 hover:bg-navy-800 text-white font-bold py-2.5 rounded-xl text-xs shadow-md transition-all';
            } else {
                hiddenInput.value = '';
                submitBtn.disabled = true;
                submitBtn.className = 'w-1/2 bg-slate-300 text-white font-bold py-2.5 rounded-xl text-xs cursor-not-allowed transition-all';
            }
        }

        // --- FUNGSI TOGGLE SUBMIT TRANSAKSI ---
        function toggleTransactionSubmit() {
            const selectedType = document.querySelector('input[name="tx-type"]:checked');
            const amountRaw = document.getElementById('tx-amount').value.replace(/\./g, '');
            const amount = Number(amountRaw) || 0;
            const submitBtn = document.getElementById('tx-submit-btn');
            
            if (selectedType && amount > 0) {
                submitBtn.disabled = false;
                submitBtn.className = 'w-full bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-white font-extrabold py-3 rounded-2xl text-sm shadow-md flex items-center justify-center gap-2 transition-all';
            } else {
                submitBtn.disabled = true;
                submitBtn.className = 'w-full bg-slate-300 text-white font-extrabold py-3 rounded-2xl text-sm cursor-not-allowed flex items-center justify-center gap-2 transition-all';
            }
        }

        // --- FUNGSI PAGING TRANSAKSI ---
        function changeTransactionPage(direction) {
            const search = document.getElementById('tx-search').value.toLowerCase();
            const entity = document.getElementById('tx-filter-entity').value;
            const type = document.getElementById('tx-filter-type').value;

            let filtered = state.transactions.filter(t => {
                const matchSearch = t.description.toLowerCase().includes(search) || t.category.toLowerCase().includes(search);
                const matchEntity = entity === 'ALL' || t.entity === entity;
                const matchType = type === 'ALL' || t.type === type;
                return matchSearch && matchEntity && matchType;
            });

            const totalPages = Math.ceil(filtered.length / state.transactionLimit) || 1;
            const newPage = state.transactionPage + direction;
            
            if (newPage >= 1 && newPage <= totalPages) {
                state.transactionPage = newPage;
                renderTransactions();
            }
        }

        // --- FUNGSI PAGING LAPORAN ---
        function changeReportPage(direction) {
            let filtered = state.transactions;
            if (state.reportPeriod === 'HARIAN') {
                const dateVal = document.getElementById('report-date-picker').value || state.selectedDate;
                filtered = state.transactions.filter(t => t.date.startsWith(dateVal));
            } else if (state.reportPeriod === 'BULANAN') {
                const monthVal = document.getElementById('report-month-picker').value || state.selectedMonth;
                filtered = state.transactions.filter(t => t.date.startsWith(monthVal));
            }
            
            const totalPages = Math.ceil(filtered.length / state.reportLimit) || 1;
            const newPage = state.reportPage + direction;
            
            if (newPage >= 1 && newPage <= totalPages) {
                state.reportPage = newPage;
                renderReportTable(filtered);
            }
        }

        // --- FUNGSI PERHITUNGAN MODAL & PRIVE ---
        function computeModalAndPrive(transactions) {
            let suntikTotal = 0;
            let penarikanTotal = 0;
            
            (transactions || state.transactions).forEach(t => {
                if (t.type === 'TRANSFER') {
                    const amt = Number(t.amount) || 0;
                    if (t.category === 'Suntik Modal') suntikTotal += amt;
                    if (t.category === 'Penarikan Prive') penarikanTotal += amt;
                }
            });
            
            const priveAktual = Math.max(0, penarikanTotal - suntikTotal);
            const modalKembali = Math.min(penarikanTotal, suntikTotal);
            const sisaModal = Math.max(0, suntikTotal - penarikanTotal);
            
            let status = '';
            let edukasi = '';
            
            if (sisaModal > 0) {
                status = 'Mengembalikan Modal';
                edukasi = `Anda masih memiliki sisa modal pribadi di usaha sebesar ${formatRp(sisaModal)}. Semua penarikan saat ini adalah pengembalian modal, BUKAN prive (keuntungan).`;
            } else if (priveAktual > 0) {
                status = 'Mengambil Keuntungan (Prive)';
                edukasi = `Modal pribadi sudah kembali semua. Kelebihan penarikan sebesar ${formatRp(priveAktual)} adalah prive (bagian laba usaha untuk pemilik).`;
            } else {
                status = 'Modal Sama Dengan Penarikan';
                edukasi = 'Total modal yang disuntik sama dengan total penarikan. Belum ada prive yang diambil.';
            }
            
            return {
                suntikTotal,
                penarikanTotal,
                priveAktual,
                modalKembali,
                sisaModal,
                status,
                edukasi
            };
        }

        // --- GOOGLE DRIVE SYNC ENGINE ---
        let tokenRequestResolve = null;

        async function loadGoogleConfig() {
            if (GOOGLE_CLIENT_ID) return GOOGLE_CLIENT_ID;
            try {
                const res = await fetch('/api/public/google-config');
                const data = await res.json();
                GOOGLE_CLIENT_ID = data.clientId || '';
            } catch (err) {
                console.error('Gagal memuat konfigurasi Google', err);
            }
            return GOOGLE_CLIENT_ID;
        }

        async function initGoogleDriveAuth() {
            if (tokenClient) return tokenClient;
            await loadGoogleConfig();
            if (!GOOGLE_CLIENT_ID) return null;

            for (let i = 0; i < 50; i++) {
                if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) break;
                await new Promise((r) => setTimeout(r, 150));
            }
            if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) return null;

            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: GOOGLE_CLIENT_ID,
                scope: GDRIVE_SCOPE,
                callback: (response) => {
                    const resolve = tokenRequestResolve;
                    tokenRequestResolve = null;
                    if (!response || response.error || !response.access_token) {
                        if (resolve) resolve(null);
                        return;
                    }
                    state.gdrive.accessToken = response.access_token;
                    state.gdrive.tokenExpiry = Date.now() + ((Number(response.expires_in) || 3600) - 60) * 1000;
                    saveGDriveMeta();
                    if (resolve) resolve(response.access_token);
                },
                error_callback: () => {
                    const resolve = tokenRequestResolve;
                    tokenRequestResolve = null;
                    if (resolve) resolve(null);
                }
            });
            return tokenClient;
        }

        function tokenIsValid() {
            return !!(state.gdrive.accessToken && state.gdrive.tokenExpiry && Date.now() < state.gdrive.tokenExpiry);
        }

        async function ensureAccessToken(forceInteractive) {
            if (!forceInteractive && tokenIsValid()) return state.gdrive.accessToken;

            const client = await initGoogleDriveAuth();
            if (!client) {
                showToast('Google Sign-In belum siap. Coba lagi sebentar.', 'warning');
                return null;
            }
            if (tokenRequestResolve) return null;

            const connected = !!state.gdrive.userEmail;
            let token = await new Promise((resolve) => {
                tokenRequestResolve = resolve;
                const opts = { prompt: (connected && !forceInteractive) ? '' : 'consent' };
                if (state.gdrive.userEmail) opts.hint = state.gdrive.userEmail;
                try {
                    client.requestAccessToken(opts);
                } catch (err) {
                    tokenRequestResolve = null;
                    resolve(null);
                }
            });

            if (!token && connected && !forceInteractive) {
                token = await new Promise((resolve) => {
                    tokenRequestResolve = resolve;
                    const opts = { prompt: '', hint: state.gdrive.userEmail };
                    opts.prompt = 'consent';
                    try {
                        client.requestAccessToken(opts);
                    } catch (err) {
                        tokenRequestResolve = null;
                        resolve(null);
                    }
                });
            }

            if (!token) return null;
            if (!state.gdrive.userEmail) await fetchGoogleUserInfo();
            saveGDriveMeta();
            updateGDriveUI();
            return token;
        }

        async function gdriveFetch(url, options, isRetry) {
            const token = await ensureAccessToken(false);
            if (!token) return null;
            const opts = Object.assign({}, options || {});
            opts.headers = Object.assign({}, opts.headers || {}, { Authorization: `Bearer ${token}` });
            const res = await fetch(url, opts);
            if (res.status === 401 && !isRetry) {
                state.gdrive.accessToken = null;
                state.gdrive.tokenExpiry = null;
                saveGDriveMeta();
                return gdriveFetch(url, options, true);
            }
            return res;
        }

        async function fetchGoogleUserInfo() {
            try {
                const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                    headers: { Authorization: `Bearer ${state.gdrive.accessToken}` }
                });
                const data = await res.json();
                state.gdrive.userEmail = data.email || 'Akun Google';
            } catch (err) {
                console.error('Failed to get user info', err);
                state.gdrive.userEmail = state.gdrive.userEmail || 'Akun Google';
            }
            saveGDriveMeta();
        }

        async function connectGoogleDrive() {
            if (state.gdrive.userEmail) {
                uploadToGoogleDrive();
                return;
            }
            const token = await ensureAccessToken(true);
            if (!token) {
                showToast('Gagal menghubungkan akun Google.', 'error');
                return;
            }
            updateGDriveUI();
            showToast(`Terhubung sebagai ${state.gdrive.userEmail}`, 'success');
        }

        async function disconnectGoogleDrive() {
            try {
                if (state.gdrive.accessToken && typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
                    google.accounts.oauth2.revoke(state.gdrive.accessToken, () => {});
                }
            } catch (err) { /* abaikan */ }
            state.gdrive.accessToken = null;
            state.gdrive.tokenExpiry = null;
            state.gdrive.userEmail = null;
            saveGDriveMeta();
            updateGDriveUI();
            showToast('Akun Google diputuskan.', 'info');
        }

        async function backupToGoogleDrive() {
            uploadToGoogleDrive();
        }

        async function restoreFromGoogleDrive() {
            const token = await ensureAccessToken(false);
            if (!token) {
                showToast('Hubungkan akun Google terlebih dahulu.', 'warning');
                return;
            }
            executeGDriveRestore();
        }

        function restoreFromGoogleDriveDirect() {
            restoreFromGoogleDrive();
        }

        function triggerGDriveBackupManual() {
            uploadToGoogleDrive();
        }

        async function uploadToGoogleDrive() {
            const token = await ensureAccessToken(false);
            if (!token) {
                showToast('Hubungkan akun Google terlebih dahulu.', 'warning');
                return;
            }

            showToast('Mengunggah backup ke Google Drive...', 'info');

            // Kumpulkan data seluruh user untuk backup komprehensif
            const allUsersData = {};
            state.users.forEach(u => {
                const raw = localStorage.getItem(STORAGE_DATA_PREFIX + u.id);
                if (raw) {
                    try { allUsersData[u.id] = JSON.parse(raw); } catch(e) {}
                }
            });
            // Pastikan data user aktif tersimpan mutakhir
            if (state.currentUser) {
                allUsersData[state.currentUser] = {
                    businessName: state.businessName,
                    logoBase64: state.logoBase64,
                    transactions: state.transactions,
                    categories: state.categories,
                    categoriesEnabled: state.categoriesEnabled
                };
            }

            const backupContent = JSON.stringify({
                version: "3.0",
                exportDate: new Date().toISOString(),
                users: state.users,
                activeUserId: state.currentUser,
                businessName: state.businessName,
                logoBase64: state.logoBase64,
                transactions: state.transactions,
                categories: state.categories,
                categoriesEnabled: state.categoriesEnabled,
                allUsersData: allUsersData
            });

            try {
                const searchRes = await gdriveFetch(
                    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${GDRIVE_FILE_NAME}'`
                );
                if (!searchRes) return;
                const searchData = await searchRes.json();
                const existingFile = searchData.files && searchData.files[0];

                let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
                let method = 'POST';

                const metadata = {
                    name: GDRIVE_FILE_NAME,
                    parents: ['appDataFolder']
                };

                if (existingFile) {
                    uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`;
                    method = 'PATCH';
                    delete metadata.parents;
                }

                const boundary = 'foo_bar_baz';
                const delimiter = "\r\n--" + boundary + "\r\n";
                const close_delim = "\r\n--" + boundary + "--";

                const multipartRequestBody =
                    delimiter +
                    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                    JSON.stringify(metadata) +
                    delimiter +
                    'Content-Type: application/json\r\n\r\n' +
                    backupContent +
                    close_delim;

                const uploadRes = await gdriveFetch(uploadUrl, {
                    method: method,
                    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                    body: multipartRequestBody
                });

                if (uploadRes && uploadRes.ok) {
                    if (!state.gdrive.userEmail) await fetchGoogleUserInfo();
                    state.gdrive.lastSyncTime = new Date().toISOString();
                    state.hasUnsavedChanges = false;
                    saveGDriveMeta();
                    updateGDriveUI();
                    showToast('Backup Google Drive Berhasil!', 'success');
                } else {
                    showToast('Gagal mengunggah ke Google Drive.', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Koneksi terputus saat sync Google Drive.', 'error');
            }
        }

        async function executeGDriveRestore() {
            showToast('Mencari file backup di Google Drive...', 'info');
            try {
                // Cek file dompetku_backup.json atau duitku_backup.json lama
                let searchRes = await gdriveFetch(
                    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='${GDRIVE_FILE_NAME}'`
                );
                let searchData = searchRes ? await searchRes.json() : null;
                let file = searchData && searchData.files && searchData.files[0];

                if (!file) {
                    // Fallback cek file lama duitku_backup.json
                    searchRes = await gdriveFetch(
                        `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name='duitku_backup.json'`
                    );
                    searchData = searchRes ? await searchRes.json() : null;
                    file = searchData && searchData.files && searchData.files[0];
                }

                if (!file) {
                    showToast('Tidak ada file backup ditemukan di Google Drive ini.', 'warning');
                    return;
                }

                const fileRes = await gdriveFetch(
                    `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`
                );
                if (!fileRes) return;
                const parsed = await fileRes.json();
                
                showConfirmModal('Restore Data Google Drive', `Ditemukan backup tanggal ${new Date(parsed.exportDate || Date.now()).toLocaleString('id-ID')}. Pulihkan data ini?`, () => {
                    if (parsed.version === "3.0" && parsed.allUsersData) {
                        state.users = parsed.users || [];
                        Object.keys(parsed.allUsersData).forEach(uid => {
                            localStorage.setItem(STORAGE_DATA_PREFIX + uid, JSON.stringify(parsed.allUsersData[uid]));
                        });
                        localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));
                        
                        const targetUser = parsed.activeUserId || (state.users[0] ? state.users[0].id : null);
                        if (targetUser) {
                            selectProfile(targetUser);
                        } else if (state.users.length > 0) {
                            selectProfile(state.users[0].id);
                        }
                    } else {
                        // Restore dari format v2.0 atau sebelumnya
                        const restoredName = parsed.businessName || 'DompetKu';
                        const newId = 'usr_' + Date.now();
                        const restoredProfile = {
                            id: newId,
                            businessName: restoredName,
                            createdAt: new Date().toISOString(),
                            gdriveEmail: state.gdrive.userEmail || null
                        };
                        
                        state.users = [restoredProfile];
                        localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));

                        const restoredData = {
                            businessName: restoredName,
                            logoBase64: parsed.logoBase64 || '',
                            transactions: parsed.transactions || [],
                            categories: parsed.categories || JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
                            categoriesEnabled: parsed.categoriesEnabled !== undefined ? parsed.categoriesEnabled : false
                        };
                        localStorage.setItem(STORAGE_DATA_PREFIX + newId, JSON.stringify(restoredData));
                        selectProfile(newId);
                    }

                    showToast('Data berhasil dipulihkan dari Google Drive!', 'success');
                });

            } catch (err) {
                console.error(err);
                showToast('Gagal memulihkan dari Google Drive.', 'error');
            }
        }

        function saveSyncSettings() {
            const freqEl = document.getElementById('setting-sync-freq');
            state.gdrive.syncFreqDays = freqEl ? Number(freqEl.value) : 1;
            saveGDriveMeta();
            const label = freqEl && freqEl.value === '0' ? 'Auto Backup Dinonaktifkan' : 'Pengaturan Sync Disimpan';
            showToast(label, 'success');
        }

        function saveGDriveMeta() {
            localStorage.setItem(STORAGE_GDRIVE_META, JSON.stringify({
                accessToken: state.gdrive.accessToken,
                tokenExpiry: state.gdrive.tokenExpiry,
                userEmail: state.gdrive.userEmail,
                lastSyncTime: state.gdrive.lastSyncTime,
                syncFreqDays: state.gdrive.syncFreqDays
            }));
        }

        function loadGDriveMeta() {
            const raw = localStorage.getItem(STORAGE_GDRIVE_META);
            if (raw) {
                const parsed = JSON.parse(raw);
                state.gdrive.accessToken = parsed.accessToken || null;
                state.gdrive.tokenExpiry = parsed.tokenExpiry || null;
                state.gdrive.userEmail = parsed.userEmail || null;
                state.gdrive.lastSyncTime = parsed.lastSyncTime || null;
                // Migrasi dari format lama (autoSyncOnClose + syncMaxDays)
                if (parsed.syncFreqDays !== undefined) {
                    state.gdrive.syncFreqDays = Number(parsed.syncFreqDays);
                } else if (parsed.autoSyncOnClose === false) {
                    state.gdrive.syncFreqDays = 0;
                } else {
                    state.gdrive.syncFreqDays = parsed.syncMaxDays || 1;
                }
            }
            updateGDriveUI();
        }

        function updateGDriveUI() {
            const statusLabel = document.getElementById('gdrive-status-label');
            const dot = document.getElementById('gdrive-dot');
            const connectText = document.getElementById('btn-gdrive-connect-text');
            const lastSyncText = document.getElementById('gdrive-last-sync-text');
            const syncBadge = document.getElementById('gdrive-sync-badge');
            const freqEl = document.getElementById('setting-sync-freq');

            if (freqEl) freqEl.value = state.gdrive.syncFreqDays;

            const disconnectBtn = document.getElementById('btn-gdrive-disconnect');

            if (state.gdrive.userEmail) {
                if (statusLabel) statusLabel.innerText = `Terhubung: ${state.gdrive.userEmail}`;
                if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400";
                if (connectText) connectText.innerText = "Sync Sekarang";
                if (disconnectBtn) disconnectBtn.classList.remove('hidden');
                // Update email di kartu profil aktif
                updateActiveProfileEmail(state.gdrive.userEmail);
            } else {
                if (statusLabel) statusLabel.innerText = "Belum Terhubung";
                if (dot) dot.className = "w-2.5 h-2.5 rounded-full bg-slate-500";
                if (connectText) connectText.innerText = "Hubungkan Account";
                if (disconnectBtn) disconnectBtn.classList.add('hidden');
            }

            if (state.gdrive.lastSyncTime) {
                if (lastSyncText) lastSyncText.innerText = `Sync Terakhir: ${new Date(state.gdrive.lastSyncTime).toLocaleString('id-ID')}`;
            } else {
                if (lastSyncText) lastSyncText.innerText = "Belum pernah disinkronkan.";
            }

            if (syncBadge) {
                if (state.hasUnsavedChanges) {
                    syncBadge.classList.remove('hidden');
                } else {
                    syncBadge.classList.add('hidden');
                }
            }
        }

        function updateActiveProfileEmail(email) {
            if (!state.currentUser) return;
            const userIdx = state.users.findIndex(u => u.id === state.currentUser);
            if (userIdx !== -1 && state.users[userIdx].gdriveEmail !== email) {
                state.users[userIdx].gdriveEmail = email;
                localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));
            }
        }

        function checkAutomaticSyncRules() {
            if (!state.gdrive.userEmail) return;
            if (state.gdrive.syncFreqDays === 0) return; // Jangan pernah

            const now = new Date();
            const lastSync = state.gdrive.lastSyncTime ? new Date(state.gdrive.lastSyncTime) : null;

            if (!lastSync) {
                // Belum pernah sync, lakukan jika ada data
                if (state.transactions.length > 0) uploadToGoogleDrive();
                return;
            }

            const diffMs = now - lastSync;
            const diffDays = diffMs / (1000 * 60 * 60 * 24);

            if (diffDays >= state.gdrive.syncFreqDays) {
                uploadToGoogleDrive();
            }
        }

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                checkAutomaticSyncRules();
            }
        });
        window.addEventListener('beforeunload', () => {
            checkAutomaticSyncRules();
        });



        // --- STANDARD APP LOGIC ---
        function isAppInstalled() {
            return window.matchMedia('(display-mode: standalone)').matches
                || window.matchMedia('(display-mode: fullscreen)').matches
                || window.matchMedia('(display-mode: minimal-ui)').matches
                || window.navigator.standalone === true
                || document.referrer.startsWith('android-app_/index.html');
        }

        function updateInstallButton() {
            const btn = document.getElementById('pwa-install-btn');
            if (!btn) return;
            btn.style.display = (!isAppInstalled() && deferredPrompt) ? 'flex' : 'none';
        }

        function initPWA() {
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                deferredPrompt = e;
                updateInstallButton();
            });

            window.addEventListener('appinstalled', () => {
                deferredPrompt = null;
                updateInstallButton();
                showToast('Aplikasi berhasil dipasang di perangkat!', 'success');
            });

            window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallButton);
            updateInstallButton();

            const host = location.hostname;
            const inIframe = window.self !== window.top;
            const isPreview = host.startsWith('id-preview--') || host.startsWith('preview--')
                || host.endsWith('.lovableproject.com') || host.endsWith('.lovableproject-dev.com')
                || host.endsWith('.beta.lovable.dev') || host === 'localhost' || host === '127.0.0.1';
            const killSwitch = new URLSearchParams(location.search).get('sw') === 'off';

            if ('serviceWorker' in navigator) {
                if (inIframe || isPreview || killSwitch) {
                    navigator.serviceWorker.getRegistrations().then((regs) => {
                        regs.forEach((reg) => {
                            if (reg.active && reg.active.scriptURL.indexOf('sw.js') !== -1) reg.unregister();
                        });
                    }).catch(() => {});
                } else {
                    window.addEventListener('load', () => {
                        navigator.serviceWorker.register('sw.js', { scope: '/' }).catch(() => {});
                    });
                }
            }
        }

        function triggerPwaInstall() {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then((choice) => {
                    deferredPrompt = null;
                    updateInstallButton();
                    if (choice.outcome === 'accepted') {
                        showToast('Memasang aplikasi...', 'success');
                    }
                });
            } else if (isAppInstalled()) {
                updateInstallButton();
            } else {
                showToast('Pilih "Tambahkan ke Layar Utama" pada menu browser Anda.', 'info');
            }
        }

        function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            let bgClass = 'bg-slate-800 text-white';
            let iconClass = 'fa-circle-info';
            if (type === 'success') { bgClass = 'bg-emerald-600 text-white'; iconClass = 'fa-circle-check'; }
            if (type === 'error') { bgClass = 'bg-rose-600 text-white'; iconClass = 'fa-circle-xmark'; }
            if (type === 'warning') { bgClass = 'bg-amber-500 text-slate-950'; iconClass = 'fa-triangle-exclamation'; }

            toast.className = `p-3 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 animate-toast ${bgClass}`;
            toast.innerHTML = `<i class="fa-solid ${iconClass} text-sm shrink-0"></i> <span>${message}</span>`;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'all 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        function showConfirmModalHTML(title, html, onConfirm) {
            document.getElementById('confirm-title').innerText = title;
            document.getElementById('confirm-message').innerHTML = html;
            pendingConfirmCallback = onConfirm;
            document.getElementById('modal-confirm').classList.remove('hidden');
        }

        function showConfirmModal(title, message, onConfirm) {
            document.getElementById('confirm-title').innerText = title;
            document.getElementById('confirm-message').innerText = message;
            pendingConfirmCallback = onConfirm;
            document.getElementById('modal-confirm').classList.remove('hidden');
        }

        document.getElementById('confirm-btn-cancel').onclick = () => {
            document.getElementById('modal-confirm').classList.add('hidden');
            pendingConfirmCallback = null;
        };

        document.getElementById('confirm-btn-ok').onclick = () => {
            document.getElementById('modal-confirm').classList.add('hidden');
            if (pendingConfirmCallback) pendingConfirmCallback();
            pendingConfirmCallback = null;
        };

        function migrateOldStorage() {
            let users = [];
            const rawUsers = localStorage.getItem(STORAGE_USERS) || localStorage.getItem('duitku_users_db');
            if (rawUsers) {
                try {
                    const parsed = JSON.parse(rawUsers);
                    if (Array.isArray(parsed)) {
                        // Cek jika format lama { username, password }
                        if (parsed.length > 0 && parsed[0].username && !parsed[0].id) {
                            users = parsed.map((u, idx) => ({
                                id: 'usr_' + (idx === 0 ? 'main' : Date.now() + '_' + idx),
                                businessName: u.username === 'admin' ? 'DompetKu' : u.username,
                                createdAt: new Date().toISOString(),
                                gdriveEmail: null
                            }));
                        } else {
                            users = parsed;
                        }
                    }
                } catch (e) {
                    console.error('Error parsing users', e);
                }
            }

            if (!users || users.length === 0) {
                users = [{
                    id: 'usr_main',
                    businessName: 'DompetKu',
                    createdAt: new Date().toISOString(),
                    gdriveEmail: null
                }];
            }

            state.users = users;
            localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));

            // Migrasi data transaksi lama ke user pertama jika belum ada
            const firstUserId = users[0].id;
            const existingUserData = localStorage.getItem(STORAGE_DATA_PREFIX + firstUserId);
            if (!existingUserData) {
                const oldData = localStorage.getItem('duitku_app_data') || localStorage.getItem('dompetku_app_data');
                if (oldData) {
                    localStorage.setItem(STORAGE_DATA_PREFIX + firstUserId, oldData);
                }
            }
        }

        function loadStorageState() {
            migrateOldStorage();

            const activeSession = localStorage.getItem(STORAGE_SESSION);
            const userExists = state.users.some(u => u.id === activeSession);

            if (activeSession && userExists) {
                state.currentUser = activeSession;
                loadUserData(activeSession);
                document.getElementById('modal-auth').classList.add('hidden');
            } else {
                state.currentUser = null;
                renderProfileScreen();
                showAuthScreen('profiles');
                document.getElementById('modal-auth').classList.remove('hidden');
            }

            loadGDriveMeta();
        }

        function loadUserData(userId) {
            const rawData = localStorage.getItem(STORAGE_DATA_PREFIX + userId);
            const userProfile = state.users.find(u => u.id === userId);
            const defaultName = userProfile ? userProfile.businessName : 'DompetKu';

            if (rawData) {
                try {
                    const parsed = JSON.parse(rawData);
                    state.businessName = parsed.businessName || defaultName;
                    state.logoBase64 = parsed.logoBase64 || '';
                    state.transactions = parsed.transactions || [];
                    state.categories = parsed.categories || JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
                    state.categoriesEnabled = parsed.categoriesEnabled !== undefined ? parsed.categoriesEnabled : false;
                } catch (e) {
                    console.error('Error parsing user data', e);
                    initDefaultUserData(defaultName);
                }
            } else {
                initDefaultUserData(defaultName);
            }
        }

        function initDefaultUserData(name) {
            state.businessName = name || 'DompetKu';
            state.logoBase64 = '';
            state.transactions = getDummyTransactions();
            state.categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
            state.categoriesEnabled = false;
            saveAppData(false);
        }

        function saveAppData(markUnsaved = true) {
            if (markUnsaved) state.hasUnsavedChanges = true;
            if (state.currentUser) {
                localStorage.setItem(STORAGE_DATA_PREFIX + state.currentUser, JSON.stringify({
                    businessName: state.businessName,
                    logoBase64: state.logoBase64,
                    transactions: state.transactions,
                    categories: state.categories,
                    categoriesEnabled: state.categoriesEnabled
                }));
            }
            updateGDriveUI();
        }

        function getDummyTransactions() {
            const today = new Date().toISOString().slice(0, 10);
            return [
             //   { id: '1', date: `${today}T09:00`, entity: 'USAHA', type: 'PEMASUKAN', category: 'Penjualan Produk', amount: 850000, description: 'Penjualan Paket Kopi & Roti', paymentMethod: 'QRIS' },
             //   { id: '2', date: `${today}T10:30`, entity: 'USAHA', type: 'PENGELUARAN', category: 'Bahan Baku', amount: 300000, description: 'Beli Biji Kopi & Susu Fresh', paymentMethod: 'Transfer Bank' }
            ];
        }

        // --- AUTH & PROFILE PICKER FUNCTIONS ---
        function showAuthScreen(screen) {
            const profilesView = document.getElementById('auth-screen-profiles');
            const newProfileView = document.getElementById('auth-screen-new-profile');
            const authSub = document.getElementById('auth-subtitle');

            if (screen === 'profiles') {
                profilesView.classList.remove('hidden');
                newProfileView.classList.add('hidden');
                authSub.innerText = 'Pilih profil usaha Anda';
                renderProfileScreen();
            } else if (screen === 'new-profile') {
                profilesView.classList.add('hidden');
                newProfileView.classList.remove('hidden');
                authSub.innerText = 'Tambah Profil Usaha Baru';
                document.getElementById('input-new-business-name').value = '';
                setTimeout(() => document.getElementById('input-new-business-name').focus(), 150);
            }
        }

        function renderProfileScreen() {
            const grid = document.getElementById('profile-grid');
            if (!grid) return;

            if (state.users.length === 0) {
                grid.innerHTML = `<p class="col-span-2 text-center text-slate-400 py-6 text-xs">Belum ada profil usaha.</p>`;
                return;
            }

            grid.innerHTML = state.users.map((u, idx) => {
                const isFirst = idx === 0;
                const emailInfo = u.gdriveEmail 
                    ? `<span class="text-[9px] text-emerald-600 truncate flex items-center gap-1 font-medium"><i class="fa-brands fa-google text-[9px]"></i> ${u.gdriveEmail}</span>`
                    : `<span class="text-[9px] text-slate-400 italic">Belum backup Google</span>`;

                const deleteBtn = state.users.length > 1 
                    ? `<button type="button" onclick="deleteProfile('${u.id}', event)" title="Hapus profil" class="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-slate-100 hover:bg-rose-100 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-colors text-[10px] z-10"><i class="fa-solid fa-trash-can"></i></button>`
                    : '';

                return `
                    <div class="relative group">
                        <button type="button" onclick="selectProfile('${u.id}')" class="w-full text-left p-3 rounded-2xl bg-slate-50 hover:bg-emerald-50/70 border-2 border-slate-200/80 hover:border-emerald-500 transition-all flex flex-col justify-between min-h-[96px] shadow-xs active:scale-[0.98]">
                            <div class="flex items-center gap-2">
                                <div class="w-8 h-8 rounded-xl ${isFirst ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-200'} flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
                                    <i class="fa-solid fa-store"></i>
                                </div>
                            </div>
                            <div class="mt-2 min-w-0 pr-4">
                                <span class="block text-xs font-extrabold text-slate-800 truncate leading-snug">${u.businessName}</span>
                                <div class="mt-0.5 truncate">${emailInfo}</div>
                            </div>
                        </button>
                        ${deleteBtn}
                    </div>
                `;
            }).join('');
        }

        function selectProfile(userId) {
            state.currentUser = userId;
            localStorage.setItem(STORAGE_SESSION, userId);
            loadUserData(userId);
            document.getElementById('modal-auth').classList.add('hidden');
            refreshUI();
            showToast(`Masuk sebagai ${state.businessName}`, 'success');
            setTimeout(checkGDriveNudge, 800);
        }

        function handleCreateProfile(e) {
            e.preventDefault();
            const name = document.getElementById('input-new-business-name').value.trim();
            if (!name) return;

            const newId = 'usr_' + Date.now();
            const newProfile = {
                id: newId,
                businessName: name,
                createdAt: new Date().toISOString(),
                gdriveEmail: null
            };

            state.users.push(newProfile);
            localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));

            // Inisialisasi data usaha baru dengan template bersih
            state.currentUser = newId;
            initDefaultUserData(name);
            selectProfile(newId);
        }

        function deleteProfile(userId, e) {
            if (e) e.stopPropagation();
            const profile = state.users.find(u => u.id === userId);
            const name = profile ? profile.businessName : 'profil ini';

            showConfirmModal('Hapus Profil Usaha', `Hapus profil "${name}" beserta seluruh data transaksinya? Tindakan ini tidak dapat dibatalkan.`, () => {
                state.users = state.users.filter(u => u.id !== userId);
                localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));
                localStorage.removeItem(STORAGE_DATA_PREFIX + userId);

                if (state.currentUser === userId) {
                    if (state.users.length > 0) {
                        selectProfile(state.users[0].id);
                    } else {
                        state.currentUser = null;
                        localStorage.removeItem(STORAGE_SESSION);
                        renderProfileScreen();
                    }
                } else {
                    renderProfileScreen();
                }
                showToast('Profil usaha telah dihapus.', 'info');
            });
        }

        function logout() {
            showConfirmModal('Ganti Profil Usaha', 'Apakah Anda ingin beralih profil atau keluar?', () => {
                state.currentUser = null;
                localStorage.removeItem(STORAGE_SESSION);
                renderProfileScreen();
                showAuthScreen('profiles');
                document.getElementById('modal-auth').classList.remove('hidden');
            });
        }

        // --- GDRIVE NUDGE POPUP FUNCTIONS ---
        function checkGDriveNudge() {
            if (!state.currentUser) return;
            // Jika sudah terhubung, tidak perlu ingatkan
            if (state.gdrive.userEmail) return;

            // Catat first used jika belum pernah
            let firstUsed = localStorage.getItem(STORAGE_FIRST_USED);
            if (!firstUsed) {
                firstUsed = Date.now().toString();
                localStorage.setItem(STORAGE_FIRST_USED, firstUsed);
            }

            const diffDays = (Date.now() - Number(firstUsed)) / (1000 * 60 * 60 * 24);
            // Muncul jika sudah 7 hari atau lebih
            if (diffDays < 7) return;

            // Cek kapan terakhir nudge ditutup (jangan spam, minimal jeda 3 hari)
            const lastNudge = localStorage.getItem(STORAGE_GDRIVE_NUDGE);
            if (lastNudge) {
                const nudgeDiffDays = (Date.now() - Number(lastNudge)) / (1000 * 60 * 60 * 24);
                if (nudgeDiffDays < 3) return;
            }

            const popup = document.getElementById('modal-gdrive-nudge');
            if (popup) popup.classList.remove('hidden');
        }

        function dismissGDriveNudge() {
            const popup = document.getElementById('modal-gdrive-nudge');
            if (popup) popup.classList.add('hidden');
            localStorage.setItem(STORAGE_GDRIVE_NUDGE, Date.now().toString());
        }

        function connectGDriveFromNudge() {
            dismissGDriveNudge();
            connectGoogleDrive();
        }


        function computeBalances() {
            let saldoUsaha = 0, saldoPribadi = 0;
            state.transactions.forEach(t => {
                const amt = Number(t.amount) || 0;
                if (t.type === 'PEMASUKAN') {
                    if (t.entity === 'USAHA') saldoUsaha += amt;
                    if (t.entity === 'PRIBADI') saldoPribadi += amt;
                } else if (t.type === 'PENGELUARAN') {
                    if (t.entity === 'USAHA') saldoUsaha -= amt;
                    if (t.entity === 'PRIBADI') saldoPribadi -= amt;
                } else if (t.type === 'TRANSFER') {
                    if (t.category === 'Suntik Modal') { saldoPribadi -= amt; saldoUsaha += amt; }
                    else if (t.category === 'Penarikan Prive') { saldoUsaha -= amt; saldoPribadi += amt; }
                }
            });
            return { saldoUsaha, saldoPribadi };
        }

        function computeModalDebt() {
            let suntik = 0, prive = 0;
            state.transactions.forEach(t => {
                if (t.type !== 'TRANSFER') return;
                const amt = Number(t.amount) || 0;
                if (t.category === 'Suntik Modal') suntik += amt;
                else if (t.category === 'Penarikan Prive') prive += amt;
            });
            const priveAktual = Math.max(0, prive - suntik);
            const modalKembali = Math.min(prive, suntik);
            const sisaModal = Math.max(0, suntik - prive);
            return { suntik, prive, priveAktual, modalKembali, sisaModal };
        }

        function renderDashInsights() {
            const box = document.getElementById('dash-insights');
            if (!box) return;
            const { saldoUsaha, saldoPribadi } = computeBalances();
            const d = computeModalDebt();
            let html = '';

            if (saldoUsaha < 0) {
                html += `
                <div class="bg-rose-50 border border-rose-200 rounded-2xl p-3.5">
                    <div class="flex items-center gap-2 mb-1">
                        <i class="fa-solid fa-triangle-exclamation text-rose-600"></i>
                        <h3 class="text-xs font-extrabold text-rose-900">Saldo Usaha Minus ${formatRp(saldoUsaha)}</h3>
                    </div>
                    <p class="text-[11px] text-rose-800/90 leading-relaxed">Uang usaha sudah terpakai melebihi yang masuk. Saran tindakan:</p>
                    <ul class="text-[11px] text-rose-800/90 mt-1 space-y-0.5 list-disc pl-4">
                        <li>Stop dulu penarikan prive ke kantong pribadi.</li>
                        <li>Suntik modal dari kantong pribadi lewat tombol <b>Transfer Saldo</b>.</li>
                        <li>Tunda belanja non-esensial &amp; kejar penjualan/piutang.</li>
                    </ul>
                </div>`;
            }

            if (saldoPribadi < 0) {
                const need = Math.abs(saldoPribadi);
                html += `
                <div class="bg-amber-50 border border-amber-200 rounded-2xl p-3.5">
                    <div class="flex items-center gap-2 mb-1">
                        <i class="fa-solid fa-hand-holding-dollar text-amber-600"></i>
                        <h3 class="text-xs font-extrabold text-amber-900">Saldo Pribadi Minus ${formatRp(saldoPribadi)}</h3>
                    </div>
                    <p class="text-[11px] text-amber-900/90 leading-relaxed">Tambal kekurangan ini dengan prive dari kantong usaha sekali klik.</p>
                    <button type="button" onclick="coverPersonalDeficit()" class="mt-2 w-full bg-amber-500 hover:bg-amber-600 active:scale-[0.99] text-slate-950 font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> Tambal ${formatRp(need)} dari Uang Usaha
                    </button>
                </div>`;
            }

            if (d.sisaModal > 0) {
                const risky = saldoUsaha < d.sisaModal;
                html += `
                <div class="bg-white border ${risky ? 'border-rose-200' : 'border-slate-200/80'} rounded-2xl p-3.5 shadow-xs">
                    <div class="flex items-center justify-between gap-2">
                        <div class="min-w-0">
                            <p class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sisa Modal Pribadi di Usaha</p>
                            <p class="text-sm font-black text-slate-900 mt-0.5">${formatRp(d.sisaModal)}</p>
                        </div>
                        <div class="w-9 h-9 rounded-xl ${risky ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'} flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-scale-balanced"></i>
                        </div>
                    </div>
                    <p class="text-[10px] text-slate-500 mt-1.5 leading-relaxed">Modal pribadi disuntik ${formatRp(d.suntik)} &bull; sudah dikembalikan ${formatRp(d.modalKembali)}.</p>
                    ${risky ? `<p class="text-[11px] font-semibold text-rose-700 mt-1.5"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Saldo usaha (${formatRp(saldoUsaha)}) lebih kecil dari sisa modal pribadi — sebagian uang pribadi sudah terpakai habis.</p>` : `<p class="text-[11px] font-semibold text-emerald-700 mt-1.5"><i class="fa-solid fa-circle-check mr-1"></i>Saldo usaha masih cukup untuk mengembalikan modal pribadi.</p>`}
                </div>`;
            } else if (d.priveAktual > 0) {
                html += `
                <div class="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5">
                    <p class="text-[11px] font-bold text-emerald-900"><i class="fa-solid fa-circle-check mr-1"></i>Modal pribadi sudah balik penuh.</p>
                    <p class="text-[10px] text-emerald-800/90 mt-0.5">Prive (keuntungan) yang diambil: ${formatRp(d.priveAktual)}</p>
                </div>`;
            }

            box.innerHTML = html;
        }

        function coverPersonalDeficit() {
            const { saldoUsaha, saldoPribadi } = computeBalances();
            if (saldoPribadi >= 0) { showToast('Saldo pribadi tidak minus.', 'info'); return; }
            const need = Math.abs(saldoPribadi);
            const d = computeModalDebt();
            const sisaUsaha = saldoUsaha - need;
            const sisaModalSetelah = Math.max(0, d.sisaModal - need);
            showConfirmModalHTML('Tambal Saldo Pribadi', `
                <span class="block mb-2">Sistem akan mencatat <b>Penarikan Prive</b> dari kantong usaha ke kantong pribadi.</span>
                <span class="block bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-1 text-left">
                    <span class="flex justify-between"><span>Nominal prive</span><b>${formatRp(need)}</b></span>
                    <span class="flex justify-between"><span>Saldo pribadi jadi</span><b>Rp 0</b></span>
                    <span class="flex justify-between"><span>Saldo usaha jadi</span><b class="${sisaUsaha < 0 ? 'text-rose-600' : ''}">${formatRp(sisaUsaha)}</b></span>
                    <span class="flex justify-between"><span>Sisa modal pribadi di usaha jadi</span><b>${formatRp(sisaModalSetelah)}</b></span>
                </span>
                ${sisaUsaha < 0 ? '<span class="block mt-2 text-rose-600 font-semibold">Perhatian: saldo usaha akan ikut minus setelah penarikan ini.</span>' : ''}
            `, () => {
                state.transactions.unshift({
                    id: Date.now().toString(),
                    type: 'TRANSFER',
                    entity: 'PRIBADI',
                    amount: need,
                    category: 'Penarikan Prive',
                    date: new Date().toISOString().slice(0, 16),
                    paymentMethod: 'Transfer Bank',
                    description: 'Tambal saldo pribadi minus (prive otomatis)'
                });
                saveAppData();
                refreshUI();
                showToast('Saldo pribadi sudah ditambal jadi Rp 0.', 'success');
            });
        }

        function formatRp(num) {
            return 'Rp ' + Number(num || 0).toLocaleString('id-ID');
        }

        let activeWallet = 'USAHA';

        function openWallet(entity) {
            activeWallet = entity;
            const modal = document.getElementById('modal-transaction');
            modal.querySelector('form').reset();
            document.getElementById('tx-entity').value = entity;
            document.getElementById('tx-datetime').value = new Date().toISOString().slice(0, 16);
            
            document.querySelectorAll('input[name="tx-type"]').forEach(el => el.checked = false);
            toggleTransactionSubmit();

            const isUsaha = entity === 'USAHA';
            const header = document.getElementById('wallet-modal-header');
            header.className = `sticky top-0 z-10 p-4 rounded-t-3xl sm:rounded-t-2xl text-white bg-gradient-to-br ${isUsaha ? 'from-emerald-600 to-emerald-800' : 'from-navy-800 to-navy-900'}`;
            document.getElementById('wallet-modal-title').innerText = isUsaha ? 'Saldo Usaha' : 'Saldo Pribadi';
            const { saldoUsaha, saldoPribadi } = computeBalances();
            document.getElementById('wallet-modal-balance').innerText = formatRp(isUsaha ? saldoUsaha : saldoPribadi);

            updateCategories();
            modal.classList.remove('hidden');
            setTimeout(() => document.getElementById('tx-amount').focus(), 120);
        }

        function addQuickAmount(val) {
            const input = document.getElementById('tx-amount');
            const currentRaw = input.value.replace(/\./g, '');
            const current = currentRaw === '' ? 0 : parseInt(currentRaw);
            const result = val === 0 ? 0 : current + val;
            input.value = result === 0 ? '' : result.toLocaleString('id-ID');
            toggleTransactionSubmit();
        }

        function openModal(id) {
            if (id === 'modal-transaction') {
                openWallet(activeWallet);
                return;
            } else if (id === 'modal-transfer') {
                document.querySelector('#modal-transfer form').reset();
                document.getElementById('transfer-datetime').value = new Date().toISOString().slice(0, 16);
                document.querySelectorAll('input[name="transfer-type-radio"]').forEach(el => el.checked = false);
                toggleTransferSubmit();
            }
            document.getElementById(id).classList.remove('hidden');
        }

        function closeModal(id) {
            document.getElementById(id).classList.add('hidden');
        }

        function switchTab(tabId) {
            ['dashboard', 'transaksi', 'laporan', 'pengaturan'].forEach(t => {
                const view = document.getElementById(`view-${t}`);
                if (view) view.classList.toggle('hidden', `tab-${t}` !== tabId);
                const navBtn = document.getElementById(`nav-tab-${t}`);
                if (navBtn) {
                    navBtn.className = `tab-${t}` === tabId ? 
                        "flex flex-col items-center gap-1 text-emerald-600 font-bold transition-all py-1 px-3" : 
                        "flex flex-col items-center gap-1 text-slate-400 hover:text-slate-600 font-medium transition-all py-1 px-3";
                }
            });

            if (tabId === 'tab-laporan') updateReports();
            if (tabId === 'tab-pengaturan') {
                document.getElementById('input-business-name').value = state.businessName;
                renderCategoryManagement();
            }
        }

        function toggleCategoriesEnabled(enabled) {
            state.categoriesEnabled = !!enabled;
            saveAppData();
            renderCategoryManagement();
            updateCategories();
            showToast(enabled ? 'Kategori diaktifkan.' : 'Kategori dinonaktifkan.', 'info');
        }

        function updateCategories() {
            const wrap = document.getElementById('tx-category-wrap');
            if (wrap) wrap.classList.toggle('hidden', !state.categoriesEnabled);
            if (!state.categoriesEnabled) {
                document.getElementById('tx-category').innerHTML = '<option value="Umum">Umum</option>';
                document.getElementById('tx-category').value = 'Umum';
                return;
            }
            const selectedRadio = document.querySelector('input[name="tx-type"]:checked');
            const type = selectedRadio ? selectedRadio.value : 'PEMASUKAN';
            const catSelect = document.getElementById('tx-category');
            const cats = state.categories[type] || [];
            catSelect.innerHTML = cats.map(c => `<option value="${c}">${c}</option>`).join('');
            const chips = document.getElementById('tx-category-chips');
            if (chips) {
                chips.innerHTML = cats.map((c, i) => `<button type="button" data-cat="${c}" onclick="selectCategory('${c.replace(/'/g, "\\'")}')" class="cat-chip text-[11px] font-bold px-2.5 py-1.5 rounded-xl border transition-all ${i === 0 ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-slate-50 text-slate-600 border-slate-200'}">${c}</button>`).join('')
                    || `<p class="text-[11px] text-slate-400">Belum ada kategori. Tambahkan di Pengaturan.</p>`;
                if (cats.length) catSelect.value = cats[0];
            }
        }

        function selectCategory(cat) {
            document.getElementById('tx-category').value = cat;
            document.querySelectorAll('#tx-category-chips .cat-chip').forEach(btn => {
                const active = btn.getAttribute('data-cat') === cat;
                btn.className = `cat-chip text-[11px] font-bold px-2.5 py-1.5 rounded-xl border transition-all ${active ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-slate-50 text-slate-600 border-slate-200'}`;
            });
        }

        function renderCategoryManagement() {
            const toggle = document.getElementById('toggle-categories-enabled');
            if (toggle) toggle.checked = state.categoriesEnabled;
            const body = document.getElementById('category-manage-body');
            if (body) body.classList.toggle('hidden', !state.categoriesEnabled);
            const container = document.getElementById('category-list-container');
            const selectedRadio = document.querySelector('input[name="cat-type-radio"]:checked');
            const type = selectedRadio ? selectedRadio.value : 'PEMASUKAN';
            const list = state.categories[type] || [];

            container.innerHTML = list.map((cat, idx) => `
                <div class="flex items-center justify-between p-2 bg-slate-50 rounded-xl border border-slate-200/80 text-xs">
                    <span class="text-slate-700 font-medium">${cat}</span>
                    <button type="button" onclick="deleteCategory('${type}', ${idx})" class="text-rose-500 hover:text-rose-700 text-xs px-1.5 py-0.5">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            `).join('');
        }

        function addNewCategory() {
            const selectedRadio = document.querySelector('input[name="cat-type-radio"]:checked');
            const input = document.getElementById('input-new-category');
            const type = selectedRadio ? selectedRadio.value : 'PEMASUKAN';
            const val = input.value.trim();

            if (val && !state.categories[type].includes(val)) {
                state.categories[type].push(val);
                input.value = '';
                saveAppData();
                renderCategoryManagement();
                updateCategories();
                showToast('Kategori ditambahkan!', 'success');
            }
        }

        function deleteCategory(type, index) {
            if (state.categories[type].length <= 1) return;
            state.categories[type].splice(index, 1);
            saveAppData();
            renderCategoryManagement();
            updateCategories();
        }

        function handleLogoUpload(e) {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (evt) => {
                    state.logoBase64 = evt.target.result;
                    renderHeaderLogo();
                };
                reader.readAsDataURL(file);
            }
        }

        function renderHeaderLogo() {
            const logoImg = document.getElementById('header-logo-img');
            const logoIcon = document.getElementById('header-logo-icon');
            if (state.logoBase64) {
                logoImg.src = state.logoBase64;
                logoImg.classList.remove('hidden');
                logoIcon.classList.add('hidden');
            } else {
                logoImg.classList.add('hidden');
                logoIcon.classList.remove('hidden');
            }
        }

        function handleSaveTransaction(e) {
            e.preventDefault();
            
            const selectedType = document.querySelector('input[name="tx-type"]:checked');
            if (!selectedType) {
                showToast('Pilih tipe transaksi terlebih dahulu!', 'warning');
                return;
            }
            
            const amountRaw = document.getElementById('tx-amount').value.replace(/\./g, '');
            const amount = Number(amountRaw) || 0;
            
            if (amount <= 0) {
                showToast('Masukkan nominal yang valid!', 'warning');
                return;
            }
            
            const desc = document.getElementById('tx-description').value.trim();
            const category = state.categoriesEnabled ? (document.getElementById('tx-category').value || 'Umum') : 'Umum';

            const newTx = {
                id: Date.now().toString(),
                type: selectedType.value,
                entity: document.getElementById('tx-entity').value,
                amount: amount,
                category: category,
                date: document.getElementById('tx-datetime').value,
                paymentMethod: document.getElementById('tx-payment-method').value,
                description: desc || category
            };

            state.transactions.unshift(newTx);
            saveAppData();
            refreshUI();
            
            document.querySelectorAll('input[name="tx-type"]').forEach(el => el.checked = false);
            document.getElementById('tx-amount').value = '';
            document.getElementById('tx-description').value = '';
            document.getElementById('tx-datetime').value = new Date().toISOString().slice(0, 16);
            
            toggleTransactionSubmit();
            
            const { saldoUsaha, saldoPribadi } = computeBalances();
            document.getElementById('wallet-modal-balance').innerText = formatRp(activeWallet === 'USAHA' ? saldoUsaha : saldoPribadi);
            
            closeModal('modal-transaction');
            showToast('Transaksi berhasil dicatat!', 'success');
        }

        function handleSaveTransfer(e) {
            e.preventDefault();
            const type = document.getElementById('transfer-type').value;
            if (!type) {
                showToast('Pilih tipe transfer terlebih dahulu!', 'warning');
                return;
            }
            
            const amountRaw = document.getElementById('transfer-amount').value.replace(/\./g, '');
            const amount = Number(amountRaw) || 0;
            const isSuntik = type === 'SUNTIK_MODAL';

            if (amount <= 0) {
                showToast('Masukkan nominal yang valid!', 'warning');
                return;
            }

            const newTx = {
                id: Date.now().toString(),
                type: 'TRANSFER',
                entity: isSuntik ? 'USAHA' : 'PRIBADI',
                amount: amount,
                category: isSuntik ? 'Suntik Modal' : 'Penarikan Prive',
                date: document.getElementById('transfer-datetime').value,
                paymentMethod: 'Transfer Bank',
                description: document.getElementById('transfer-note').value.trim() || (isSuntik ? 'Suntik Modal Usaha' : 'Penarikan Prive Pemilik')
            };

            state.transactions.unshift(newTx);
            saveAppData();
            closeModal('modal-transfer');
            refreshUI();
            showToast('Transfer berhasil!', 'success');
            
            document.querySelectorAll('input[name="transfer-type-radio"]').forEach(el => el.checked = false);
            document.getElementById('transfer-type').value = '';
            document.getElementById('transfer-amount').value = '';
            document.getElementById('transfer-note').value = '';
            toggleTransferSubmit();
        }

        function deleteTransaction(id) {
            showConfirmModal('Hapus Catatan', 'Hapus catatan transaksi ini?', () => {
                state.transactions = state.transactions.filter(t => t.id !== id);
                saveAppData();
                refreshUI();
            });
        }

        function renderTransactions() {
            const container = document.getElementById('full-transactions-list');
            const search = document.getElementById('tx-search').value.toLowerCase();
            const entity = document.getElementById('tx-filter-entity').value;
            const type = document.getElementById('tx-filter-type').value;

            let filtered = state.transactions.filter(t => {
                const matchSearch = t.description.toLowerCase().includes(search) || t.category.toLowerCase().includes(search);
                const matchEntity = entity === 'ALL' || t.entity === entity;
                const matchType = type === 'ALL' || t.type === type;
                return matchSearch && matchEntity && matchType;
            });

            filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

            const total = filtered.length;
            const totalPages = Math.ceil(total / state.transactionLimit) || 1;
            const currentPage = Math.min(state.transactionPage, totalPages);
            const start = (currentPage - 1) * state.transactionLimit;
            const end = Math.min(start + state.transactionLimit, total);
            const pageItems = filtered.slice(start, end);

            let html = '';
            if (pageItems.length === 0) {
                html = `<p class="text-center text-slate-400 py-4 text-xs">Tidak ada transaksi.</p>`;
            } else {
                html = pageItems.map(t => createTransactionItemHTML(t, true)).join('');
            }

            if (total > state.transactionLimit) {
                html += `
                    <div class="flex items-center justify-between mt-3 pt-2 border-t border-slate-200">
                        <button onclick="changeTransactionPage(-1)" 
                            class="px-3 py-1.5 text-xs font-bold rounded-lg ${currentPage <= 1 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}" 
                            ${currentPage <= 1 ? 'disabled' : ''}>
                            <i class="fa-solid fa-chevron-left"></i> Sebelumnya
                        </button>
                        <span class="text-xs text-slate-600 font-medium">${currentPage} / ${totalPages} (${total} transaksi)</span>
                        <button onclick="changeTransactionPage(1)" 
                            class="px-3 py-1.5 text-xs font-bold rounded-lg ${currentPage >= totalPages ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}" 
                            ${currentPage >= totalPages ? 'disabled' : ''}>
                            Selanjutnya <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                `;
            }

            container.innerHTML = html;
        }

        function createTransactionItemHTML(t, allowDelete = false) {
            const isIncome = t.type === 'PEMASUKAN';
            const isTransfer = t.type === 'TRANSFER';
            let colorClass = isIncome ? 'text-emerald-600 bg-emerald-50' : (isTransfer ? 'text-amber-600 bg-amber-50' : 'text-rose-600 bg-rose-50');
            let iconClass = isIncome ? 'fa-circle-arrow-down' : (isTransfer ? 'fa-right-left' : 'fa-circle-arrow-up');
            let prefix = isIncome ? '+' : (isTransfer ? '' : '-');

            return `
                <div class="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-100 shadow-xs">
                    <div class="flex items-center gap-2.5 min-w-0">
                        <div class="w-8 h-8 rounded-xl ${colorClass} flex items-center justify-center shrink-0 ring-1 ring-current/15">
                            <i class="fa-solid ${iconClass} text-sm"></i>
                        </div>
                        <div class="min-w-0">
                            <div class="flex items-center gap-1">
                                <span class="text-xs font-bold text-slate-800 truncate">${t.description}</span>
                                <span class="text-[8px] px-1 py-0.2 rounded font-bold shrink-0 ${t.entity === 'USAHA' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}">${t.entity}</span>
                            </div>
                            <span class="text-[10px] text-slate-400 block truncate">${new Date(t.date).toLocaleDateString('id-ID')} &bull; ${t.category}</span>
                        </div>
                    </div>
                    <div class="text-right shrink-0 ml-2">
                        <span class="text-xs font-bold ${isIncome ? 'text-emerald-600' : (isTransfer ? 'text-slate-800' : 'text-rose-600')} block">${prefix}${formatRp(t.amount)}</span>
                        ${allowDelete ? `<button onclick="deleteTransaction('${t.id}')" class="text-[10px] text-rose-400 hover:text-rose-600"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                    </div>
                </div>`;
        }

        function setReportPeriod(period) {
            state.reportPeriod = period;
            const harianBtn = document.getElementById('period-btn-harian');
            const bulananBtn = document.getElementById('period-btn-bulanan');
            const semuaBtn = document.getElementById('period-btn-semua');
            const monthPicker = document.getElementById('report-month-picker');
            const datePicker = document.getElementById('report-date-picker');
            const pickerLabel = document.getElementById('picker-label');

            [harianBtn, bulananBtn, semuaBtn].forEach(b => b.className = "px-2.5 py-1 text-[10px] sm:text-[11px] font-medium rounded-lg text-slate-600 transition-all");

            if (period === 'HARIAN') {
                harianBtn.className = "px-2.5 py-1 text-[10px] sm:text-[11px] font-medium rounded-lg bg-white text-slate-800 shadow-xs";
                datePicker.classList.remove('hidden');
                monthPicker.classList.add('hidden');
                pickerLabel.innerText = "Pilih Tanggal:";
            } else if (period === 'BULANAN') {
                bulananBtn.className = "px-2.5 py-1 text-[10px] sm:text-[11px] font-medium rounded-lg bg-white text-slate-800 shadow-xs";
                monthPicker.classList.remove('hidden');
                datePicker.classList.add('hidden');
                pickerLabel.innerText = "Pilih Bulan:";
            } else {
                semuaBtn.className = "px-2.5 py-1 text-[10px] sm:text-[11px] font-medium rounded-lg bg-white text-slate-800 shadow-xs";
                monthPicker.classList.add('hidden');
                datePicker.classList.add('hidden');
                pickerLabel.innerText = "Semua Riwayat";
            }

            updateReports();
        }

        function updateReports() {
            state.reportPage = 1;
            
            let filtered = state.transactions;
            if (state.reportPeriod === 'HARIAN') {
                const dateVal = document.getElementById('report-date-picker').value || state.selectedDate;
                filtered = state.transactions.filter(t => t.date.startsWith(dateVal));
            } else if (state.reportPeriod === 'BULANAN') {
                const monthVal = document.getElementById('report-month-picker').value || state.selectedMonth;
                filtered = state.transactions.filter(t => t.date.startsWith(monthVal));
            }

            let pemUsaha = 0, pengUsaha = 0, pengPribadi = 0;
            let privePeriode = 0, suntikPeriode = 0;
            
            filtered.forEach(t => {
                const amt = Number(t.amount);
                if (t.type === 'PEMASUKAN' && t.entity === 'USAHA') pemUsaha += amt;
                if (t.type === 'PENGELUARAN' && t.entity === 'USAHA') pengUsaha += amt;
                if (t.type === 'PENGELUARAN' && t.entity === 'PRIBADI') pengPribadi += amt;
                if (t.type === 'TRANSFER') {
                    if (t.category === 'Suntik Modal') suntikPeriode += amt;
                    if (t.category === 'Penarikan Prive') privePeriode += amt;
                }
            });

            const priveAktual = Math.max(0, privePeriode - suntikPeriode);
            const modalKembali = Math.min(privePeriode, suntikPeriode);
            const sisaModal = Math.max(0, suntikPeriode - privePeriode);
            
            const labaBersih = pemUsaha - pengUsaha;

            document.getElementById('report-pemasukan-usaha').innerText = formatRp(pemUsaha);
            document.getElementById('report-pengeluaran-usaha').innerText = formatRp(pengUsaha);
            document.getElementById('report-laba-bersih').innerText = formatRp(labaBersih);
            document.getElementById('report-total-prive').innerText = formatRp(priveAktual);

            renderAntiBoncosPanel(pemUsaha, pengUsaha, priveAktual, suntikPeriode, privePeriode, modalKembali, sisaModal);
            renderCharts(pemUsaha, pengUsaha, labaBersih, priveAktual, modalKembali);
            renderReportTable(filtered);
        }

        function renderAntiBoncosPanel(pemasukan, pengeluaran, priveAktual, suntikPeriode, penarikanPeriode, modalKembali, sisaModal) {
            const panel = document.getElementById('panel-anti-boncos');
            const laba = pemasukan - pengeluaran;
            
            let statusText = "", colorClass = "", icon = "", advice = "";
            
            let modalStatus = '';
            if (sisaModal > 0) {
                modalStatus = `<i class="fa-solid fa-rotate-left text-blue-500 mr-1"></i> Modal Pribadi di Usaha: ${formatRp(sisaModal)} (belum kembali)`;
            } else if (modalKembali > 0 && priveAktual === 0) {
                modalStatus = `<i class="fa-solid fa-check-circle text-emerald-500 mr-1"></i> Modal Pribadi sudah kembali semua (${formatRp(modalKembali)})`;
            } else if (priveAktual > 0) {
                modalStatus = `<i class="fa-solid fa-coins text-amber-500 mr-1"></i> Prive (Keuntungan) diambil: ${formatRp(priveAktual)}`;
            }

            if (pemasukan === 0 && pengeluaran === 0) {
                colorClass = "bg-slate-100 border-slate-200 text-slate-700";
                icon = "fa-circle-info text-slate-500";
                statusText = "Belum Ada Transaksi";
                advice = "Catat pemasukan dan pengeluaran usaha Anda untuk melihat skor kesehatan arus kas.";
            } else if (laba > 0 && priveAktual <= laba * 0.5) {
                colorClass = "bg-emerald-50 border-emerald-200 text-emerald-900";
                icon = "fa-circle-check text-emerald-600";
                statusText = "Status: Keuangan Sehat & Aman!";
                advice = `Laba usaha Anda memadai (${formatRp(laba)}). Penarikan prive (${formatRp(priveAktual)}) masih dalam batas aman di bawah 50% laba.`;
            } else if (laba > 0 && priveAktual > laba * 0.5) {
                colorClass = "bg-amber-50 border-amber-200 text-amber-900";
                icon = "fa-triangle-exclamation text-amber-600";
                statusText = "Waspada: Prive Terlalu Besar";
                advice = `Usaha Anda mencetak laba (${formatRp(laba)}), namun penarikan prive Anda (${formatRp(priveAktual)}) memakan lebih dari setengah laba usaha. Pertimbangkan menahan modal usaha.`;
            } else {
                colorClass = "bg-rose-50 border-rose-200 text-rose-900";
                icon = "fa-triangle-exclamation text-rose-600";
                statusText = "Peringatan Anti-Boncos!";
                advice = `Pengeluaran usaha melebihi pemasukan (Defisit ${formatRp(Math.abs(laba))}). Kurangi pengeluaran operasional non-esensial atau tingkatkan penjualan.`;
            }

            let modalEdukasi = '';
            if (suntikPeriode > 0 || penarikanPeriode > 0) {
                modalEdukasi = `
                    <div class="mt-3 pt-3 border-t border-slate-200/50">
                        <div class="grid grid-cols-3 gap-2 text-[10px]">
                            <div class="bg-white/50 p-2 rounded-lg">
                                <span class="block font-semibold text-slate-500">Modal Disuntik</span>
                                <span class="block font-bold text-emerald-600">${formatRp(suntikPeriode)}</span>
                            </div>
                            <div class="bg-white/50 p-2 rounded-lg">
                                <span class="block font-semibold text-slate-500">Penarikan</span>
                                <span class="block font-bold text-amber-600">${formatRp(penarikanPeriode)}</span>
                            </div>
                            <div class="bg-white/50 p-2 rounded-lg">
                                <span class="block font-semibold text-slate-500">Prive Aktual</span>
                                <span class="block font-bold text-rose-600">${formatRp(priveAktual)}</span>
                            </div>
                        </div>
                        <p class="text-[10px] text-slate-600 mt-2 leading-relaxed">${modalStatus}</p>
                        ${sisaModal > 0 ? `<p class="text-[10px] text-blue-600 mt-1"><i class="fa-solid fa-lightbulb mr-1"></i>Penarikan Anda saat ini adalah pengembalian modal, BUKAN prive (keuntungan).</p>` : ''}
                        ${priveAktual > 0 ? `<p class="text-[10px] text-emerald-600 mt-1"><i class="fa-solid fa-lightbulb mr-1"></i>Modal sudah kembali. Kelebihan penarikan adalah prive (keuntungan).</p>` : ''}
                    </div>
                `;
            }

            panel.className = `p-3.5 rounded-2xl shadow-xs border transition-all ${colorClass}`;
            panel.innerHTML = `
                <div class="flex items-center gap-2 mb-1">
                    <i class="fa-solid ${icon} text-sm"></i>
                    <h3 class="text-xs font-bold">${statusText}</h3>
                </div>
                <p class="text-[11px] leading-relaxed opacity-90">${advice}</p>
                ${modalEdukasi}
            `;
        }

        function renderCharts(pemUsaha, pengUsaha, labaBersih, priveAktual, modalKembali) {
            const ctxBar = document.getElementById('chart-bar-comparison').getContext('2d');
            if (chartBarInstance) chartBarInstance.destroy();
            
            const barData = {
                labels: ['Pendapatan', 'Pengeluaran', 'Laba Bersih', 'Prive Aktual'],
                datasets: [{
                    data: [pemUsaha, pengUsaha, labaBersih, priveAktual],
                    backgroundColor: ['#10b981', '#f43f5e', '#3b82f6', '#f59e0b'],
                    borderRadius: 8,
                    borderSkipped: false
                }]
            };

            chartBarInstance = new Chart(ctxBar, {
                type: 'bar',
                data: barData,
                options: {
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { 
                            callbacks: { 
                                label: (c) => formatRp(c.raw) 
                            } 
                        }
                    },
                    scales: {
                        x: { 
                            ticks: { 
                                font: { size: 8, weight: 'bold' },
                                maxRotation: 45,
                                minRotation: 45,
                                autoSkip: false,
                                maxTicksLimit: 6
                            } 
                        },
                        y: { 
                            ticks: { 
                                font: { size: 8 }, 
                                callback: (v) => {
                                    if (v >= 1000000) return (v/1000000) + 'Jt';
                                    if (v >= 1000) return (v/1000) + 'Rb';
                                    return v;
                                }
                            } 
                        }
                    }
                }
            });
            
            renderBarLegend(pemUsaha, pengUsaha, labaBersih, priveAktual, modalKembali);

            const ctxPie = document.getElementById('chart-pie-distribution').getContext('2d');
            if (chartPieInstance) chartPieInstance.destroy();
            
            const labaPositif = Math.max(0, labaBersih);
            const privePositif = Math.min(priveAktual, labaPositif);
            const sisaLaba = Math.max(0, labaPositif - privePositif);
            
            chartPieInstance = new Chart(ctxPie, {
                type: 'doughnut',
                data: { 
                    labels: ['Laba Ditahan', 'Prive (Keuntungan Diambil)'], 
                    datasets: [{ 
                        data: [sisaLaba, privePositif], 
                        backgroundColor: ['#3b82f6', '#f59e0b'],
                        borderWidth: 2,
                        borderColor: '#ffffff'
                    }] 
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { 
                        legend: { 
                            position: 'bottom',
                            labels: { 
                                font: { size: 10 },
                                padding: 15
                            }
                        },
                        tooltip: {
                            callbacks: {
                                label: (c) => {
                                    const total = c.dataset.data.reduce((a,b) => a + b, 0);
                                    const pct = total > 0 ? Math.round((c.raw / total) * 100) : 0;
                                    return formatRp(c.raw) + ` (${pct}%)`;
                                }
                            }
                        }
                    } 
                }
            });
        }

        function renderBarLegend(pemUsaha, pengUsaha, labaBersih, priveAktual, modalKembali) {
            const box = document.getElementById('chart-bar-legend');
            if (!box) return;
            
            const rasio = labaBersih > 0 ? Math.round((priveAktual / labaBersih) * 100) : (priveAktual > 0 ? 100 : 0);
            let verdict, vClass;
            
            if (priveAktual === 0) { 
                if (modalKembali > 0) {
                    verdict = `<i class="fa-solid fa-rotate-left text-blue-500 mr-1"></i> ${formatRp(modalKembali)} modal pribadi kembali. Belum ada prive yang diambil.`;
                    vClass = 'bg-blue-50 border-blue-200 text-blue-800';
                } else {
                    verdict = 'Belum ada prive yang diambil dari usaha.';
                    vClass = 'bg-slate-50 border-slate-200 text-slate-700';
                }
            }
            else if (labaBersih > 0 && priveAktual <= labaBersih * 0.5) { 
                verdict = `<i class="fa-solid fa-check-circle text-emerald-500 mr-1"></i> Aman. Prive ${rasio}% dari laba usaha.`;
                vClass = 'bg-emerald-50 border-emerald-200 text-emerald-800'; 
            }
            else if (labaBersih > 0 && priveAktual <= labaBersih) { 
                verdict = `<i class="fa-solid fa-triangle-exclamation text-amber-500 mr-1"></i> Waspada. Prive ${rasio}% dari laba usaha.`;
                vClass = 'bg-amber-50 border-amber-200 text-amber-800'; 
            }
            else { 
                verdict = `<i class="fa-solid fa-circle-exclamation text-rose-500 mr-1"></i> Bahaya! Prive melebihi laba usaha.`;
                vClass = 'bg-rose-50 border-rose-200 text-rose-800'; 
            }

            const rows = [
                { color: '#10b981', label: 'Pendapatan Usaha', val: pemUsaha, desc: 'Seluruh uang masuk ke kantong usaha.' },
                { color: '#f43f5e', label: 'Pengeluaran Usaha', val: pengUsaha, desc: 'Biaya operasional usaha.' },
                { color: '#3b82f6', label: 'Laba Bersih', val: labaBersih, desc: 'Pendapatan - Pengeluaran usaha.' },
                { color: '#f59e0b', label: 'Prive (Keuntungan)', val: priveAktual, desc: 'Keuntungan yang diambil pemilik.' }
            ];

            box.innerHTML = rows.map(r => `
                <div class="flex items-start gap-2">
                    <span class="w-2.5 h-2.5 rounded-sm mt-1 shrink-0" style="background:${r.color}"></span>
                    <div class="min-w-0">
                        <p class="text-[11px] font-bold text-slate-800">${r.label}: ${formatRp(r.val)}</p>
                        <p class="text-[10px] text-slate-500 leading-tight">${r.desc}</p>
                    </div>
                </div>
            `).join('') + `
                <div class="mt-3 rounded-xl border p-3 ${vClass}">
                    <p class="text-[11px] font-bold">Ringkasan:</p>
                    <p class="text-[10px] leading-relaxed mt-1">${verdict}</p>
                    ${modalKembali > 0 ? `<p class="text-[10px] leading-relaxed mt-1"><i class="fa-solid fa-lightbulb mr-1"></i> ${formatRp(modalKembali)} modal pribadi sudah kembali ke pemilik.</p>` : ''}
                </div>
            `;
        }

        function renderReportTable(filtered) {
            const tbody = document.getElementById('report-table-body');
            
            filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
            
            const total = filtered.length;
            const totalPages = Math.ceil(total / state.reportLimit) || 1;
            const currentPage = Math.min(state.reportPage, totalPages);
            const start = (currentPage - 1) * state.reportLimit;
            const end = Math.min(start + state.reportLimit, total);
            const pageItems = filtered.slice(start, end);
            
            let html = '';
            if (pageItems.length === 0) {
                html = `<tr><td colspan="4" class="text-center p-3 text-slate-400">Tidak ada transaksi pada periode ini.</td></tr>`;
            } else {
                html = pageItems.map(t => `
                    <tr class="hover:bg-slate-50">
                        <td class="p-2 text-slate-600">${new Date(t.date).toLocaleDateString('id-ID')}</td>
                        <td class="p-2 font-medium text-slate-800">${t.entity}</td>
                        <td class="p-2 text-slate-600">${t.category}</td>
                        <td class="p-2 text-right font-bold ${t.type === 'PEMASUKAN' ? 'text-emerald-600' : 'text-rose-600'}">${formatRp(t.amount)}</td>
                    </tr>
                `).join('');
            }
            
            tbody.innerHTML = html;
            
            const container = document.getElementById('report-table-container');
            if (total > state.reportLimit) {
                container.innerHTML = `
                    <div class="flex items-center justify-between mt-3 pt-2 border-t border-slate-200">
                        <button onclick="changeReportPage(-1)" 
                            class="px-3 py-1.5 text-xs font-bold rounded-lg ${currentPage <= 1 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}" 
                            ${currentPage <= 1 ? 'disabled' : ''}>
                            <i class="fa-solid fa-chevron-left"></i> Sebelumnya
                        </button>
                        <span class="text-xs text-slate-600 font-medium">${currentPage} / ${totalPages} (${total} transaksi)</span>
                        <button onclick="changeReportPage(1)" 
                            class="px-3 py-1.5 text-xs font-bold rounded-lg ${currentPage >= totalPages ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}" 
                            ${currentPage >= totalPages ? 'disabled' : ''}>
                            Selanjutnya <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </div>
                `;
            } else {
                container.innerHTML = '';
            }
        }

        function refreshUI() {
            document.getElementById('app-business-name').innerText = state.businessName;
            document.getElementById('print-company-name').innerText = state.businessName + ' - Laporan Keuangan';
            renderHeaderLogo();

            const { saldoUsaha, saldoPribadi } = computeBalances();
            document.getElementById('card-saldo-usaha').innerText = formatRp(saldoUsaha);
            document.getElementById('card-saldo-pribadi').innerText = formatRp(saldoPribadi);

            const currentMonthStr = new Date().toISOString().slice(0, 7);
            let monthIn = 0, monthOut = 0;
            state.transactions.forEach(t => {
                if (t.date.startsWith(currentMonthStr)) {
                    if (t.type === 'PEMASUKAN') monthIn += Number(t.amount);
                    if (t.type === 'PENGELUARAN') monthOut += Number(t.amount);
                }
            });

            document.getElementById('metric-pemasukan').innerText = formatRp(monthIn);
            document.getElementById('metric-pengeluaran').innerText = formatRp(monthOut);

            renderDashInsights();
            renderTransactions();
        }

        function saveSettings(e) {
            e.preventDefault();
            const name = document.getElementById('input-business-name').value.trim();

            if (name) {
                state.businessName = name;
                if (state.currentUser) {
                    const idx = state.users.findIndex(u => u.id === state.currentUser);
                    if (idx !== -1) {
                        state.users[idx].businessName = name;
                        localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));
                    }
                }
            }

            saveAppData();
            refreshUI();
            showToast('Pengaturan berhasil disimpan!', 'success');
        }

        function requestResetAllData() {
            showConfirmModal('PERINGATAN RESET DATA', 'Seluruh catatan transaksi usaha & pribadi pada profil ini akan dihapus. Yakin?', () => {
                state.transactions = [];
                saveAppData();
                refreshUI();
                showToast('Semua data transaksi telah dibersihkan.', 'info');
            });
        }

        function exportCSV() {
            let csvContent = "data:text/csv;charset=utf-8,ID,Tanggal,Entitas,Tipe,Kategori,Jumlah,Deskripsi\n";
            state.transactions.forEach(t => {
                csvContent += `"${t.id}","${t.date}","${t.entity}","${t.type}","${t.category}","${t.amount}","${t.description}"\n`;
            });
            const link = document.createElement("a");
            link.setAttribute("href", encodeURI(csvContent));
            link.setAttribute("download", `DompetKu_Laporan_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        }

        function exportJSON() {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
            const dl = document.createElement('a');
            dl.setAttribute("href", dataStr);
            dl.setAttribute("download", `DompetKu_Backup_${new Date().toISOString().slice(0, 10)}.json`);
            dl.click();
            dl.remove();
        }

        function importJSON(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (evt) => {
                try {
                    const parsed = JSON.parse(evt.target.result);
                    if (parsed.transactions) state.transactions = parsed.transactions;
                    if (parsed.businessName) {
                        state.businessName = parsed.businessName;
                        if (state.currentUser) {
                            const idx = state.users.findIndex(u => u.id === state.currentUser);
                            if (idx !== -1) {
                                state.users[idx].businessName = parsed.businessName;
                                localStorage.setItem(STORAGE_USERS, JSON.stringify(state.users));
                            }
                        }
                    }
                    if (parsed.categories) state.categories = parsed.categories;
                    saveAppData();
                    refreshUI();
                    showToast('Data JSON Berhasil di-restore!', 'success');
                } catch(err) {
                    showToast('Format JSON salah atau corrupt.', 'error');
                }
            };
            reader.readAsText(file);
        }

        function exportPDF() {
            document.getElementById('print-date-stamp').innerText = `Dicetak pada: ${new Date().toLocaleString('id-ID')}`;
            window.print();
        }

        // Event listener untuk format input nominal & inisialisasi aplikasi
        document.addEventListener('DOMContentLoaded', function() {
            // Catat waktu pertama kali aplikasi dibuka jika belum ada
            if (!localStorage.getItem(STORAGE_FIRST_USED)) {
                localStorage.setItem(STORAGE_FIRST_USED, Date.now().toString());
            }

            initPWA();
            initGoogleDriveAuth();
            loadStorageState();
            refreshUI();
            
            document.getElementById('report-month-picker').value = state.selectedMonth;
            document.getElementById('report-date-picker').value = state.selectedDate;

            setTimeout(initGoogleDriveAuth, 1000);
            setTimeout(checkGDriveNudge, 1500);
            
            const txAmount = document.getElementById('tx-amount');
            if (txAmount) {
                txAmount.addEventListener('input', function() {
                    formatNumberInput(this);
                    toggleTransactionSubmit();
                });
            }
            
            const transferAmount = document.getElementById('transfer-amount');
            if (transferAmount) {
                transferAmount.addEventListener('input', function() {
                    formatNumberInput(this);
                });
            }
            
            document.querySelectorAll('input[name="transfer-type-radio"]').forEach(el => {
                el.addEventListener('change', toggleTransferSubmit);
            });
        });

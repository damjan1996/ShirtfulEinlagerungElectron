/**
 * RFID Wareneinlagerung - Hauptanwendung für parallele Sessions mit Qualitätskontrolle
 * Ermöglicht mehreren Mitarbeitern gleichzeitig zu arbeiten
 * ERWEITERT für Quality Control mit doppelten QR-Scans und automatischem Session-Reset
 */

class WareneinlagerungApp {
    constructor() {
        // PARALLELE SESSION-VERWALTUNG
        this.activeSessions = new Map(); // userId -> sessionData
        this.selectedSession = null; // Aktuell ausgewählte Session für QR-Scanning
        this.sessionTimers = new Map(); // userId -> timerInterval

        // NEUE DATENSTRUKTUR: Getrennte Scan-Verwaltung pro Session
        this.currentScan = null; // Aktueller Scan (egal ob erfolgreich oder nicht)
        this.successfulScans = []; // Alle erfolgreichen Scans (sitzungsübergreifend)

        // QR-Scanner Status
        this.scannerActive = false;
        this.videoStream = null;
        this.scanLoop = null;
        this.lastScanTime = 0;
        this.scanCooldown = 3000; // 3 Sekunden zwischen Scans

        // QR-Scanner Engine
        this.qrScanner = null;
        this.loadQRLibrary();

        // Verbesserte Duplikat-Vermeidung
        this.globalScannedCodes = new Set();
        this.sessionScannedCodes = new Map(); // sessionId -> Set von QR-Codes
        this.recentlyScanned = new Map(); // Zeitbasierte Duplikat-Vermeidung
        this.pendingScans = new Set(); // Verhindert Race-Conditions
        this.lastProcessedQR = null;
        this.lastProcessedTime = 0;

        // ===== QUALITÄTSKONTROLLE INTEGRATION =====
        this.qcManager = null; // QC Manager Instanz
        this.qcEnabled = false; // QC-System aktiviert
        this.qcMode = 'auto'; // 'auto', 'manual', 'disabled'
        this.qcConfig = {
            enableAutoSessionReset: true,
            showQCProgress: true,
            enableQCNotifications: true,
            enableQCAudio: true,
            defaultEstimatedMinutes: 15,
            overdueThresholdMinutes: 30
        };

        // QC-spezifische UI-Status
        this.qcUIElements = {
            qcPanel: null,
            qcModeIndicator: null,
            qcModeToggle: null,
            qcScanOverlay: null,
            qcInfoRow: null,
            qcColumn: null,
            qcHint: null,
            qcFooterStatus: null
        };

        // QC-Event-Handler
        this.qcEventHandlers = {
            qcStepStarted: this.handleQCStepStarted.bind(this),
            qcStepCompleted: this.handleQCStepCompleted.bind(this),
            qcStepOverdue: this.handleQCStepOverdue.bind(this),
            sessionAutoReset: this.handleSessionAutoReset.bind(this)
        };

        this.init();
    }

    async init() {
        console.log('🚀 Wareneinlagerung-App wird initialisiert...');

        this.setupEventListeners();
        this.setupIPCListeners();
        this.startClockUpdate();
        this.updateSystemInfo();

        // QC-System initialisieren
        await this.initializeQualityControl();

        // Kamera-Verfügbarkeit prüfen
        await this.checkCameraAvailability();

        // Periodisches Laden der aktiven Sessions
        this.startPeriodicSessionUpdate();

        console.log('✅ Wareneinlagerung-App bereit');
    }

    // ===== QUALITY CONTROL INITIALIZATION =====

    async initializeQualityControl() {
        try {
            console.log('🔍 Initialisiere Qualitätskontrolle...');

            // QC-System-Status prüfen
            const systemStatus = await window.electronAPI.system.getStatus();
            this.qcEnabled = systemStatus?.qualityControl?.enabled || false;

            if (this.qcEnabled) {
                // QC Manager initialisieren
                if (typeof QualityControlManager !== 'undefined') {
                    this.qcManager = new QualityControlManager(this);
                    console.log('✅ QC Manager initialisiert');
                } else {
                    console.warn('⚠️ QC Manager nicht verfügbar - loading...');
                    // Versuche QC Manager nachzuladen
                    await this.loadQCManager();
                }

                // QC-UI-Elemente cachen
                this.cacheQCUIElements();

                // QC-spezifische Event-Listener einrichten
                this.setupQCEventListeners();

                // QC-UI aktivieren
                this.activateQCUI();

                console.log('✅ Qualitätskontrolle erfolgreich initialisiert');
            } else {
                console.log('ℹ️ Qualitätskontrolle nicht verfügbar');
                this.hideQCUI();
            }

        } catch (error) {
            console.error('❌ Fehler bei QC-Initialisierung:', error);
            this.qcEnabled = false;
            this.hideQCUI();
        }
    }

    async loadQCManager() {
        return new Promise((resolve, reject) => {
            if (typeof QualityControlManager !== 'undefined') {
                this.qcManager = new QualityControlManager(this);
                resolve();
                return;
            }

            // QC Manager ist noch nicht geladen - warten
            let attempts = 0;
            const maxAttempts = 50;
            const checkInterval = setInterval(() => {
                attempts++;
                if (typeof QualityControlManager !== 'undefined') {
                    clearInterval(checkInterval);
                    this.qcManager = new QualityControlManager(this);
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(checkInterval);
                    console.warn('⚠️ QC Manager konnte nicht geladen werden');
                    reject(new Error('QC Manager timeout'));
                }
            }, 100);
        });
    }

    cacheQCUIElements() {
        this.qcUIElements = {
            qcPanel: document.getElementById('qcPanel'),
            qcModeIndicator: document.getElementById('qcModeIndicator'),
            qcModeToggle: document.getElementById('qcModeToggle'),
            qcScanOverlay: document.getElementById('qcScanOverlay'),
            qcInfoRow: document.getElementById('qcInfoRow'),
            qcColumn: document.getElementById('qcColumn'),
            qcHint: document.getElementById('qcHint'),
            qcFooterStatus: document.getElementById('qcFooterStatus'),
            qcSystemStatus: document.getElementById('qcSystemStatus')
        };
    }

    setupQCEventListeners() {
        if (!this.qcEnabled) return;

        // QC-Modus Toggle
        const qcModeToggle = this.qcUIElements.qcModeToggle;
        if (qcModeToggle) {
            qcModeToggle.addEventListener('click', () => {
                this.toggleQCMode();
            });
        }

        // QC-spezifische Modals
        this.setupQCModals();

        console.log('📡 QC-Event-Listener eingerichtet');
    }

    setupQCModals() {
        // QC Completion Modal
        const qcCompletionModal = document.getElementById('qcCompletionModal');
        const qcCompletionConfirm = document.getElementById('qcCompletionConfirm');
        const qcCompletionCancel = document.getElementById('qcCompletionCancel');
        const qcCompletionClose = document.getElementById('qcCompletionModalClose');

        if (qcCompletionConfirm) {
            qcCompletionConfirm.addEventListener('click', () => this.confirmQCCompletion());
        }

        if (qcCompletionCancel) {
            qcCompletionCancel.addEventListener('click', () => this.hideModal('qcCompletionModal'));
        }

        if (qcCompletionClose) {
            qcCompletionClose.addEventListener('click', () => this.hideModal('qcCompletionModal'));
        }

        // QC Overdue Modal
        const qcOverdueOk = document.getElementById('qcOverdueOk');
        const qcOverdueClose = document.getElementById('qcOverdueModalClose');

        if (qcOverdueOk) {
            qcOverdueOk.addEventListener('click', () => this.hideModal('qcOverdueModal'));
        }

        if (qcOverdueClose) {
            qcOverdueClose.addEventListener('click', () => this.hideModal('qcOverdueModal'));
        }

        // Star Rating System
        document.querySelectorAll('.qc-star').forEach(star => {
            star.addEventListener('click', (e) => {
                const rating = parseInt(e.target.dataset.rating);
                this.setQCRating(rating);
            });
        });

        // Modal Click-Outside-to-Close für QC-Modals
        [qcCompletionModal, document.getElementById('qcOverdueModal')].forEach(modal => {
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        this.hideModal(modal.id);
                    }
                });
            }
        });
    }

    activateQCUI() {
        if (!this.qcEnabled) return;

        // QC-Panel anzeigen
        if (this.qcUIElements.qcPanel) {
            this.qcUIElements.qcPanel.style.display = 'block';
        }

        // QC-System-Status anzeigen
        if (this.qcUIElements.qcSystemStatus) {
            this.qcUIElements.qcSystemStatus.style.display = 'flex';
        }

        // QC-Modus-Toggle anzeigen
        if (this.qcUIElements.qcModeToggle) {
            this.qcUIElements.qcModeToggle.style.display = 'inline-flex';
        }

        // QC-Spalte in Tabelle anzeigen
        if (this.qcUIElements.qcColumn) {
            this.qcUIElements.qcColumn.style.display = 'table-cell';
        }

        // QC-Hinweis anzeigen
        if (this.qcUIElements.qcHint) {
            this.qcUIElements.qcHint.style.display = 'block';
        }

        // QC-Footer-Status anzeigen
        if (this.qcUIElements.qcFooterStatus) {
            this.qcUIElements.qcFooterStatus.style.display = 'inline';
        }

        // QC-Info-Row anzeigen
        if (this.qcUIElements.qcInfoRow) {
            this.qcUIElements.qcInfoRow.style.display = 'flex';
        }

        // Workspace-Grid für QC-Panel anpassen
        const workspace = document.getElementById('workspace');
        if (workspace) {
            workspace.style.gridTemplateColumns = '320px 280px 1fr';
        }

        console.log('🎨 QC-UI aktiviert');
    }

    hideQCUI() {
        // Alle QC-UI-Elemente ausblenden
        Object.values(this.qcUIElements).forEach(element => {
            if (element) {
                element.style.display = 'none';
            }
        });

        // Workspace-Grid ohne QC-Panel
        const workspace = document.getElementById('workspace');
        if (workspace) {
            workspace.style.gridTemplateColumns = '320px 1fr';
        }

        console.log('🎨 QC-UI ausgeblendet');
    }

    // ===== EVENT LISTENERS =====
    setupEventListeners() {
        // Scanner Controls
        document.getElementById('startScannerBtn').addEventListener('click', () => {
            this.startQRScanner();
        });

        document.getElementById('stopScannerBtn').addEventListener('click', () => {
            this.stopQRScanner();
        });

        // Scans Management
        document.getElementById('clearScansBtn').addEventListener('click', () => {
            this.clearRecentScans();
        });

        document.getElementById('refreshScansBtn').addEventListener('click', () => {
            this.refreshScans();
        });

        // Selected User Logout
        document.getElementById('selectedUserLogout').addEventListener('click', () => {
            if (this.selectedSession) {
                this.showLogoutModal(this.selectedSession);
            }
        });

        // Modal Controls
        this.setupModalHandlers();
    }

    setupModalHandlers() {
        // Error Modal
        const errorModal = document.getElementById('errorModal');
        const errorModalClose = document.getElementById('errorModalClose');
        const errorModalOk = document.getElementById('errorModalOk');

        errorModalClose.addEventListener('click', () => this.hideModal('errorModal'));
        errorModalOk.addEventListener('click', () => this.hideModal('errorModal'));

        // Camera Permission Modal
        const cameraModal = document.getElementById('cameraPermissionModal');
        const grantPermission = document.getElementById('grantCameraPermission');
        const cancelPermission = document.getElementById('cancelCameraPermission');

        grantPermission.addEventListener('click', () => {
            this.hideModal('cameraPermissionModal');
            this.requestCameraPermission();
        });

        cancelPermission.addEventListener('click', () => {
            this.hideModal('cameraPermissionModal');
        });

        // Logout Modal
        const logoutModal = document.getElementById('logoutModal');
        const logoutModalClose = document.getElementById('logoutModalClose');
        const confirmLogout = document.getElementById('confirmLogout');
        const cancelLogout = document.getElementById('cancelLogout');

        logoutModalClose.addEventListener('click', () => this.hideModal('logoutModal'));
        cancelLogout.addEventListener('click', () => this.hideModal('logoutModal'));
        confirmLogout.addEventListener('click', () => this.executeLogout());

        // Session Restart Modal
        const restartModal = document.getElementById('sessionRestartModal');
        const restartModalClose = document.getElementById('sessionRestartModalClose');
        const confirmRestart = document.getElementById('confirmSessionRestart');
        const cancelRestart = document.getElementById('cancelSessionRestart');

        restartModalClose.addEventListener('click', () => this.hideModal('sessionRestartModal'));
        cancelRestart.addEventListener('click', () => this.hideModal('sessionRestartModal'));
        confirmRestart.addEventListener('click', () => this.executeSessionRestart());

        // Click outside to close modals
        [errorModal, cameraModal, logoutModal, restartModal].forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.hideModal(modal.id);
                }
            });
        });
    }

    setupIPCListeners() {
        // System bereit
        window.electronAPI.on('system-ready', (data) => {
            console.log('System bereit:', data);
            this.updateSystemStatus('active', 'System bereit');
            this.showNotification('success', 'System bereit', 'RFID und Datenbank verbunden');

            // QC-System-Status aktualisieren
            if (data.qualityControl && data.qualityControl.enabled) {
                this.updateQCSystemStatus('active', 'QC bereit');
            }
        });

        // System-Fehler
        window.electronAPI.on('system-error', (data) => {
            console.error('System-Fehler:', data);
            this.updateSystemStatus('error', 'System-Fehler');
            this.showErrorModal('System-Fehler', data.error);
        });

        // Benutzer-Anmeldung (neue Session)
        window.electronAPI.on('user-login', (data) => {
            console.log('Neue Benutzer-Anmeldung:', data);
            this.handleUserLogin(data.user, data.session, data);
        });

        // Benutzer-Abmeldung
        window.electronAPI.on('user-logout', (data) => {
            console.log('Benutzer-Abmeldung:', data);
            this.handleUserLogout(data.user, data);
        });

        // Session neu gestartet (RFID-Rescan)
        window.electronAPI.on('session-restarted', (data) => {
            console.log('Session neu gestartet:', data);
            this.handleSessionRestarted(data);
        });

        // Session-Timer-Updates
        window.electronAPI.on('session-timer-update', (data) => {
            this.handleSessionTimerUpdate(data);
        });

        // RFID-Fehler
        window.electronAPI.on('rfid-scan-error', (data) => {
            console.error('RFID-Fehler:', data);
            this.showNotification('error', 'RFID-Fehler', data.message);
        });

        // ===== QC-SPEZIFISCHE IPC-LISTENER =====
        if (this.qcEnabled) {
            // QC-Schritt gestartet
            window.electronAPI.on('qc-step-started', (data) => {
                this.handleQCStepStarted(data);
            });

            // QC-Schritt abgeschlossen
            window.electronAPI.on('qc-step-completed', (data) => {
                this.handleQCStepCompleted(data);
            });

            // QC-Schritt überfällig
            window.electronAPI.on('qc-step-overdue', (data) => {
                this.handleQCStepOverdue(data);
            });

            // Session automatisch nach QC beendet
            window.electronAPI.on('session-auto-reset', (data) => {
                this.handleSessionAutoReset(data);
            });
        }
    }

    // ===== QC EVENT HANDLERS =====

    handleQCStepStarted(data) {
        console.log('🔍 QC-Schritt gestartet:', data);

        if (this.qcManager) {
            // QC Manager über neuen Schritt informieren
            this.qcManager.handleQCStepStarted(data);
        }

        // UI-Updates für QC-Start
        this.updateQCModeDisplay(true);
        this.updateQCInfoRow('QC läuft', 'active');

        // Spezielle Benachrichtigung für QC-Start
        this.showNotification('info', 'QC gestartet',
            `Qualitätsprüfung für ${data.qrCode?.substring(0, 8)}... begonnen`);
    }

    handleQCStepCompleted(data) {
        console.log('✅ QC-Schritt abgeschlossen:', data);

        if (this.qcManager) {
            // QC Manager über Abschluss informieren
            this.qcManager.handleQCStepCompleted(data);
        }

        // UI-Updates für QC-Abschluss
        this.updateQCModeDisplay(false);
        this.updateQCInfoRow('QC abgeschlossen', 'completed');

        // QC-Completion-Modal anzeigen (optional)
        if (this.qcConfig.showQCProgress) {
            this.showQCCompletionModal(data);
        }

        // Spezielle Benachrichtigung für QC-Abschluss
        let message = `Qualitätsprüfung abgeschlossen (${data.durationMinutes} Min)`;
        if (data.autoSessionReset) {
            message += ' - Session automatisch beendet';
        }

        this.showNotification('success', 'QC abgeschlossen', message);

        // Session-Reset behandeln
        if (data.autoSessionReset && data.sessionId) {
            this.handleSessionAutoReset({
                sessionId: data.sessionId,
                userId: data.userId,
                reason: 'QC abgeschlossen'
            });
        }
    }

    handleQCStepOverdue(data) {
        console.warn('⚠️ QC-Schritt überfällig:', data);

        if (this.qcManager) {
            // QC Manager über Überfälligkeit informieren
            this.qcManager.handleQCStepOverdue(data);
        }

        // UI-Updates für überfällige QC-Schritte
        this.updateQCInfoRow('QC überfällig', 'overdue');

        // Überfällig-Modal anzeigen
        this.showQCOverdueModal(data);

        // Dringende Benachrichtigung
        this.showNotification('warning', 'QC überfällig',
            `Qualitätsprüfung für ${data.qrCode?.substring(0, 8)}... ist ${data.minutesInProgress} Min überfällig`);
    }

    handleSessionAutoReset(data) {
        console.log('🔄 Session automatisch nach QC beendet:', data);

        // Session aus lokaler Verwaltung entfernen
        if (data.userId) {
            this.activeSessions.delete(data.userId);
            this.stopSessionTimer(data.userId);

            // Falls diese Session ausgewählt war, Auswahl zurücksetzen
            if (this.selectedSession && this.selectedSession.userId === data.userId) {
                this.selectedSession = null;
                this.updateSelectedUserDisplay();
                this.updateScannerInfo();
            }
        }

        // UI aktualisieren
        this.updateActiveUsersDisplay();
        this.updateWorkspaceVisibility();

        // QC-Modus zurücksetzen
        this.updateQCModeDisplay(false);
        this.updateQCInfoRow('Bereit', 'ready');

        // Benachrichtigung
        this.showNotification('info', 'Session beendet',
            `${data.userName || 'Mitarbeiter'} wurde nach QC-Abschluss automatisch abgemeldet`);
    }

    // ===== PARALLELE SESSION MANAGEMENT =====
    async handleUserLogin(user, session, eventData = {}) {
        console.log(`🔑 Benutzer-Anmeldung: ${user.BenutzerName} (Session ${session.ID})`);

        // Session zu lokaler Verwaltung hinzufügen
        this.activeSessions.set(user.ID, {
            sessionId: session.ID,
            userId: user.ID,
            userName: user.BenutzerName,
            department: user.Abteilung || '',
            startTime: new Date(session.StartTS),
            scanCount: 0,
            isActive: true
        });

        // Session-spezifische QR-Code-Duplikat-Erkennung initialisieren
        this.sessionScannedCodes.set(session.ID, new Set());

        // Session-Timer starten
        this.startSessionTimer(user.ID);

        // UI aktualisieren
        this.updateActiveUsersDisplay();
        this.showWorkspace();

        // Spezielle Nachrichten für neue Sessions
        if (eventData.isNewSession) {
            let message = `${user.BenutzerName} ist bereit zum Arbeiten!`;
            if (this.qcEnabled) {
                message += ' QC-Modus verfügbar.';
            }
            this.showNotification('success', 'Neue Session', message);
        } else {
            this.showNotification('success', 'Angemeldet', `${user.BenutzerName} ist bereit!`);
        }

        // Arbeitsbereich nur anzeigen wenn wir Benutzer haben
        this.updateWorkspaceVisibility();
    }

    async handleUserLogout(user, eventData = {}) {
        console.log(`👋 Benutzer-Abmeldung: ${user.BenutzerName}`);

        // Session aus lokaler Verwaltung entfernen
        this.activeSessions.delete(user.ID);

        // Session-Timer stoppen
        this.stopSessionTimer(user.ID);

        // Session-spezifische QR-Codes entfernen
        const userSession = Array.from(this.activeSessions.values()).find(s => s.userId === user.ID);
        if (userSession) {
            this.sessionScannedCodes.delete(userSession.sessionId);
        }

        // Falls ausgewählte Session, Auswahl zurücksetzen
        if (this.selectedSession && this.selectedSession.userId === user.ID) {
            this.selectedSession = null;
            this.updateSelectedUserDisplay();
            this.updateScannerInfo();

            // QC-Modus zurücksetzen
            this.updateQCModeDisplay(false);
            this.updateQCInfoRow('Bereit', 'ready');
        }

        // UI aktualisieren
        this.updateActiveUsersDisplay();
        this.updateWorkspaceVisibility();

        this.showNotification('info', 'Abgemeldet', `${user.BenutzerName} wurde abgemeldet`);
    }

    async handleSessionRestarted(data) {
        console.log(`🔄 Session neu gestartet: ${data.user.BenutzerName}`);

        // Lokale Session-Daten aktualisieren
        const session = this.activeSessions.get(data.user.ID);
        if (session) {
            session.startTime = new Date(data.newStartTime);

            // Timer neu starten
            this.stopSessionTimer(data.user.ID);
            this.startSessionTimer(data.user.ID);
        }

        // UI aktualisieren
        this.updateActiveUsersDisplay();

        // Falls diese Session ausgewählt ist, anzeigen aktualisieren
        if (this.selectedSession && this.selectedSession.userId === data.user.ID) {
            this.updateSelectedUserDisplay();
        }

        let message = `${data.user.BenutzerName}: Timer zurückgesetzt`;
        if (this.qcEnabled && this.qcManager) {
            // QC-Schritte für diese Session abbrechen
            const sessionQCSteps = this.qcManager.getActiveQCStepsForSession(session.sessionId);
            if (sessionQCSteps.length > 0) {
                message += ` (${sessionQCSteps.length} QC-Schritte abgebrochen)`;
            }
        }

        this.showNotification('info', 'Session neu gestartet', message);
    }

    handleSessionTimerUpdate(data) {
        // Timer-Update für spezifische Session
        const session = this.activeSessions.get(data.userId);
        if (session) {
            // Falls diese Session ausgewählt ist, Timer aktualisieren
            if (this.selectedSession && this.selectedSession.userId === data.userId) {
                this.updateSelectedSessionTimer();
            }
        }
    }

    // ===== SESSION TIMER MANAGEMENT =====
    startSessionTimer(userId) {
        // Bestehenden Timer stoppen falls vorhanden
        this.stopSessionTimer(userId);

        // Neuen Timer starten
        const timer = setInterval(() => {
            this.updateSessionTimer(userId);
        }, 1000);

        this.sessionTimers.set(userId, timer);
        console.log(`Session-Timer gestartet für Benutzer ${userId}`);
    }

    stopSessionTimer(userId) {
        const timer = this.sessionTimers.get(userId);
        if (timer) {
            clearInterval(timer);
            this.sessionTimers.delete(userId);
            console.log(`Session-Timer gestoppt für Benutzer ${userId}`);
        }
    }

    updateSessionTimer(userId) {
        const session = this.activeSessions.get(userId);
        if (!session) return;

        // Timer im User-Card aktualisieren
        const userCard = document.querySelector(`[data-user-id="${userId}"]`);
        if (userCard) {
            const timerElement = userCard.querySelector('.user-timer');
            if (timerElement) {
                const duration = utils.calculateSessionDuration(session.startTime);
                timerElement.textContent = utils.formatDuration(duration);
            }
        }

        // Falls diese Session ausgewählt ist, auch dort aktualisieren
        if (this.selectedSession && this.selectedSession.userId === userId) {
            this.updateSelectedSessionTimer();
        }
    }

    updateSelectedSessionTimer() {
        if (!this.selectedSession) return;

        const session = this.activeSessions.get(this.selectedSession.userId);
        if (session) {
            const duration = utils.calculateSessionDuration(session.startTime);
            document.getElementById('selectedSessionTime').textContent = utils.formatDuration(duration);
        }
    }

    // ===== PERIODISCHES SESSION-UPDATE =====
    startPeriodicSessionUpdate() {
        // Alle 30 Sekunden aktive Sessions vom Backend laden
        setInterval(async () => {
            await this.syncActiveSessions();
        }, 30000);

        // Initial einmal laden
        setTimeout(() => this.syncActiveSessions(), 2000);
    }

    async syncActiveSessions() {
        try {
            const backendSessions = await window.electronAPI.session.getAllActive();

            // Prüfe auf neue oder entfernte Sessions
            const backendUserIds = new Set(backendSessions.map(s => s.UserID));
            const localUserIds = new Set(this.activeSessions.keys());

            // Entfernte Sessions
            for (const userId of localUserIds) {
                if (!backendUserIds.has(userId)) {
                    console.log(`Session für Benutzer ${userId} nicht mehr aktiv - entferne lokal`);
                    this.activeSessions.delete(userId);
                    this.stopSessionTimer(userId);
                }
            }

            // Neue Sessions
            for (const backendSession of backendSessions) {
                if (!localUserIds.has(backendSession.UserID)) {
                    console.log(`Neue Session gefunden für Benutzer ${backendSession.UserID}`);

                    this.activeSessions.set(backendSession.UserID, {
                        sessionId: backendSession.ID,
                        userId: backendSession.UserID,
                        userName: backendSession.UserName || 'Unbekannt',
                        department: backendSession.Department || '',
                        startTime: new Date(backendSession.StartTS),
                        scanCount: backendSession.ScanCount || 0,
                        activeQCSteps: backendSession.ActiveQCSteps || 0,
                        completedQCSteps: backendSession.CompletedQCSteps || 0,
                        isActive: true
                    });

                    // Session-Timer starten
                    this.startSessionTimer(backendSession.UserID);

                    // Session-spezifische QR-Code-Duplikat-Erkennung
                    this.sessionScannedCodes.set(backendSession.ID, new Set());
                }
            }

            // UI aktualisieren
            this.updateActiveUsersDisplay();
            this.updateWorkspaceVisibility();

        } catch (error) {
            console.error('Fehler beim Synchronisieren der Sessions:', error);
        }
    }

    // ===== UI MANAGEMENT =====
    updateActiveUsersDisplay() {
        const usersList = document.getElementById('activeUsersList');
        const userCount = document.getElementById('activeUserCount');

        userCount.textContent = this.activeSessions.size;

        if (this.activeSessions.size === 0) {
            usersList.innerHTML = '<div class="no-users">Keine aktiven Mitarbeiter</div>';
            return;
        }

        // Benutzer-Karten erstellen
        const userCards = Array.from(this.activeSessions.values()).map(session => {
            return this.createUserCard(session);
        }).join('');

        usersList.innerHTML = userCards;

        // Event-Listener für Benutzer-Karten hinzufügen
        this.attachUserCardListeners();
    }

    createUserCard(session) {
        const duration = utils.calculateSessionDuration(session.startTime);
        const isSelected = this.selectedSession && this.selectedSession.userId === session.userId;

        // QC-Informationen vorbereiten
        const qcInfo = this.qcEnabled && this.qcManager ?
            this.qcManager.getActiveQCStepsForSession(session.sessionId) : [];
        const hasActiveQC = qcInfo.length > 0;
        const hasOverdueQC = qcInfo.some(step => step.status === 'overdue');

        return `
            <div class="user-card ${isSelected ? 'selected' : ''}" 
                 data-user-id="${session.userId}" 
                 data-session-id="${session.sessionId}">
                <div class="user-main">
                    <div class="user-avatar">👤</div>
                    <div class="user-info">
                        <div class="user-name">
                            ${session.userName}
                            ${hasActiveQC ? `<span class="qc-status-indicator ${hasOverdueQC ? 'overdue' : 'active'}" title="${hasOverdueQC ? 'Überfällige QC-Schritte' : 'Aktive QC-Schritte'}"></span>` : ''}
                        </div>
                        <div class="user-department">${session.department}</div>
                        <div class="user-timer">${utils.formatDuration(duration)}</div>
                        <div class="user-scans">${session.scanCount} Scans</div>
                        ${hasActiveQC ? `<div class="user-qc-info">${qcInfo.length} QC aktiv${hasOverdueQC ? ' (überfällig)' : ''}</div>` : ''}
                    </div>
                </div>
                <div class="user-actions">
                    <button class="btn-icon select-user" title="Für QR-Scanning auswählen">
                        📱
                    </button>
                    <button class="btn-icon restart-session" title="Session neu starten">
                        🔄
                    </button>
                    <button class="btn-icon logout-user" title="Abmelden">
                        🔓
                    </button>
                </div>
            </div>
        `;
    }

    attachUserCardListeners() {
        // Benutzer auswählen
        document.querySelectorAll('.select-user').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userCard = e.target.closest('.user-card');
                const userId = parseInt(userCard.dataset.userId);
                this.selectUser(userId);
            });
        });

        // Session neu starten
        document.querySelectorAll('.restart-session').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userCard = e.target.closest('.user-card');
                const userId = parseInt(userCard.dataset.userId);
                const sessionId = parseInt(userCard.dataset.sessionId);
                this.showSessionRestartModal(userId, sessionId);
            });
        });

        // Benutzer abmelden
        document.querySelectorAll('.logout-user').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const userCard = e.target.closest('.user-card');
                const userId = parseInt(userCard.dataset.userId);
                const session = this.activeSessions.get(userId);
                if (session) {
                    this.showLogoutModal(session);
                }
            });
        });

        // Klick auf ganze Karte = Benutzer auswählen
        document.querySelectorAll('.user-card').forEach(card => {
            card.addEventListener('click', () => {
                const userId = parseInt(card.dataset.userId);
                this.selectUser(userId);
            });
        });
    }

    selectUser(userId) {
        const session = this.activeSessions.get(userId);
        if (!session) return;

        this.selectedSession = session;

        // UI aktualisieren
        document.querySelectorAll('.user-card').forEach(card => {
            card.classList.remove('selected');
        });
        document.querySelector(`[data-user-id="${userId}"]`).classList.add('selected');

        this.updateSelectedUserDisplay();
        this.updateScannerInfo();

        // QC-spezifische Updates
        this.updateQCUserSelection();

        // Scan-Historie für ausgewählten Benutzer laden
        this.refreshScansForSelectedUser();

        console.log(`Benutzer ausgewählt: ${session.userName} (Session ${session.sessionId})`);
    }

    updateSelectedUserDisplay() {
        const panel = document.getElementById('selectedUserPanel');

        if (!this.selectedSession) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';

        document.getElementById('selectedUserName').textContent = this.selectedSession.userName;
        document.getElementById('selectedSessionScans').textContent = this.selectedSession.scanCount;

        // QC-Information für ausgewählten Benutzer
        if (this.qcEnabled && this.qcManager) {
            const qcSteps = this.qcManager.getActiveQCStepsForSession(this.selectedSession.sessionId);
            const qcInfoElement = document.getElementById('selectedSessionQCInfo');
            const qcCountElement = document.getElementById('selectedSessionQC');

            if (qcSteps.length > 0) {
                qcInfoElement.style.display = 'inline';
                qcCountElement.textContent = qcSteps.length;
            } else {
                qcInfoElement.style.display = 'none';
            }
        }

        this.updateSelectedSessionTimer();
    }

    updateScannerInfo() {
        const scannerUserInfo = document.getElementById('scannerUserInfo');

        if (this.selectedSession) {
            scannerUserInfo.textContent = `Scannt für: ${this.selectedSession.userName}`;
            scannerUserInfo.className = 'scanner-user-selected';
        } else {
            scannerUserInfo.textContent = 'Wählen Sie einen Mitarbeiter aus';
            scannerUserInfo.className = 'scanner-user-none';
        }
    }

    updateWorkspaceVisibility() {
        const loginSection = document.getElementById('loginSection');
        const workspace = document.getElementById('workspace');

        if (this.activeSessions.size > 0) {
            loginSection.style.display = 'none';
            workspace.style.display = 'grid';
        } else {
            loginSection.style.display = 'flex';
            workspace.style.display = 'none';
        }
    }

    showWorkspace() {
        this.updateWorkspaceVisibility();
    }

    // ===== QC-SPEZIFISCHE UI UPDATES =====

    updateQCUserSelection() {
        if (!this.qcEnabled) return;

        // QC-Modus-Anzeige aktualisieren
        this.updateQCModeDisplay();

        // QC-Informationen für ausgewählten Benutzer laden
        if (this.selectedSession && this.qcManager) {
            const qcSteps = this.qcManager.getActiveQCStepsForSession(this.selectedSession.sessionId);

            if (qcSteps.length > 0) {
                this.updateQCInfoRow(`${qcSteps.length} QC aktiv`, 'active');
            } else {
                this.updateQCInfoRow('Bereit für QC', 'ready');
            }
        }
    }

    updateQCModeDisplay(active = null) {
        if (!this.qcEnabled) return;

        const qcModeIndicator = this.qcUIElements.qcModeIndicator;

        if (active === null) {
            // Auto-Erkennung basierend auf ausgewähltem Benutzer
            if (this.selectedSession && this.qcManager) {
                const qcSteps = this.qcManager.getActiveQCStepsForSession(this.selectedSession.sessionId);
                active = qcSteps.length > 0;
            } else {
                active = false;
            }
        }

        if (qcModeIndicator) {
            if (active) {
                qcModeIndicator.style.display = 'inline';
                qcModeIndicator.className = 'qc-mode-indicator active';
                qcModeIndicator.textContent = '🔍 QC läuft';
            } else {
                qcModeIndicator.style.display = 'none';
            }
        }

        // QC-Scan-Overlay aktualisieren
        const qcScanOverlay = this.qcUIElements.qcScanOverlay;
        if (qcScanOverlay) {
            if (active) {
                qcScanOverlay.style.display = 'flex';
                const qcScanText = document.getElementById('qcScanText');
                if (qcScanText) {
                    qcScanText.textContent = 'QC-Schritt 2: Ausgang scannen';
                }
            } else {
                qcScanOverlay.style.display = 'none';
            }
        }
    }

    updateQCInfoRow(status, type = 'ready') {
        if (!this.qcEnabled) return;

        const qcStatusInfo = document.getElementById('qcStatusInfo');
        if (qcStatusInfo) {
            qcStatusInfo.textContent = status;
            qcStatusInfo.className = `info-value qc-status-${type}`;
        }
    }

    updateQCSystemStatus(status, message) {
        const qcSystemStatus = this.qcUIElements.qcSystemStatus;
        if (qcSystemStatus) {
            const statusDot = qcSystemStatus.querySelector('.status-dot');
            const statusText = qcSystemStatus.querySelector('.status-text');

            if (statusDot) statusDot.className = `status-dot qc ${status}`;
            if (statusText) statusText.textContent = message;
        }
    }

    // ===== MODAL MANAGEMENT =====
    showLogoutModal(session) {
        document.getElementById('logoutUserName').textContent = session.userName;
        this.logoutSession = session;

        // QC-Warnung für Logout anzeigen
        if (this.qcEnabled && this.qcManager) {
            const qcSteps = this.qcManager.getActiveQCStepsForSession(session.sessionId);
            this.showQCWarningInLogoutModal(qcSteps);
        }

        this.showModal('logoutModal');
    }

    showQCWarningInLogoutModal(qcSteps) {
        const qcWarning = document.getElementById('logoutQCWarning');
        const qcList = document.getElementById('logoutQCList');

        if (qcSteps.length > 0) {
            qcWarning.style.display = 'block';
            qcList.innerHTML = qcSteps.map(step =>
                `<li>${this.getShortQRCode(step.qrCode)} (${step.minutesInProgress || 0} Min)</li>`
            ).join('');
        } else {
            qcWarning.style.display = 'none';
        }
    }

    async executeLogout() {
        if (!this.logoutSession) return;

        try {
            const success = await window.electronAPI.session.end(
                this.logoutSession.sessionId,
                this.logoutSession.userId
            );

            if (success) {
                this.showNotification('success', 'Abmeldung', `${this.logoutSession.userName} wurde abgemeldet`);
            } else {
                this.showNotification('error', 'Fehler', 'Abmeldung fehlgeschlagen');
            }
        } catch (error) {
            console.error('Abmelde-Fehler:', error);
            this.showNotification('error', 'Fehler', 'Abmeldung fehlgeschlagen');
        }

        this.hideModal('logoutModal');
        this.logoutSession = null;
    }

    showSessionRestartModal(userId, sessionId) {
        const session = this.activeSessions.get(userId);
        if (!session) return;

        document.getElementById('restartUserName').textContent = session.userName;
        this.restartSession = { userId, sessionId, userName: session.userName };

        // QC-Warnung für Session-Restart anzeigen
        if (this.qcEnabled && this.qcManager) {
            const qcSteps = this.qcManager.getActiveQCStepsForSession(sessionId);
            this.showQCWarningInRestartModal(qcSteps);
        }

        this.showModal('sessionRestartModal');
    }

    showQCWarningInRestartModal(qcSteps) {
        const qcWarning = document.getElementById('restartQCWarning');
        const qcList = document.getElementById('restartQCList');

        if (qcSteps.length > 0) {
            qcWarning.style.display = 'block';
            qcList.innerHTML = qcSteps.map(step =>
                `<li>${this.getShortQRCode(step.qrCode)} (${step.minutesInProgress || 0} Min)</li>`
            ).join('');
        } else {
            qcWarning.style.display = 'none';
        }
    }

    async executeSessionRestart() {
        if (!this.restartSession) return;

        try {
            const success = await window.electronAPI.session.restart(
                this.restartSession.sessionId,
                this.restartSession.userId
            );

            if (success) {
                this.showNotification('success', 'Session neu gestartet',
                    `${this.restartSession.userName}: Timer zurückgesetzt`);
            } else {
                this.showNotification('error', 'Fehler', 'Session-Restart fehlgeschlagen');
            }
        } catch (error) {
            console.error('Session-Restart-Fehler:', error);
            this.showNotification('error', 'Fehler', 'Session-Restart fehlgeschlagen');
        }

        this.hideModal('sessionRestartModal');
        this.restartSession = null;
    }

    // ===== QC-SPEZIFISCHE MODALS =====

    showQCCompletionModal(data) {
        const modal = document.getElementById('qcCompletionModal');

        // Modal-Daten füllen
        document.getElementById('qcCompletionQRCode').textContent = this.getShortQRCode(data.qrCode);
        document.getElementById('qcCompletionDuration').textContent = data.durationMinutes;
        document.getElementById('qcCompletionUser').textContent = data.userName || 'Unbekannt';

        // Auto-Session-Reset-Checkbox setzen
        const autoResetCheckbox = document.getElementById('qcAutoSessionReset');
        if (autoResetCheckbox) {
            autoResetCheckbox.checked = this.qcConfig.enableAutoSessionReset;
        }

        // QC-Completion-Daten speichern
        this.qcCompletionData = data;

        this.showModal('qcCompletionModal');
    }

    confirmQCCompletion() {
        // Rating und Notizen auslesen (falls implementiert)
        const rating = this.getSelectedQCRating();
        const notes = document.getElementById('qcNotes')?.value || '';
        const autoReset = document.getElementById('qcAutoSessionReset')?.checked || false;

        console.log('QC-Abschluss bestätigt:', {
            rating,
            notes,
            autoReset,
            data: this.qcCompletionData
        });

        // Hier könnten zusätzliche Backend-Calls für Rating/Notes gemacht werden

        this.hideModal('qcCompletionModal');
        this.qcCompletionData = null;
    }

    showQCOverdueModal(data) {
        const modal = document.getElementById('qcOverdueModal');
        const details = document.getElementById('qcOverdueDetails');

        if (details) {
            details.innerHTML = `
                <div class="qc-overdue-item">
                    <strong>QR-Code:</strong> ${this.getShortQRCode(data.qrCode)}<br>
                    <strong>Dauer:</strong> ${data.minutesInProgress} Minuten<br>
                    <strong>Session:</strong> ${data.sessionId}<br>
                    <strong>Status:</strong> Überfällig
                </div>
            `;
        }

        this.showModal('qcOverdueModal');
    }

    setQCRating(rating) {
        // Alle Sterne zurücksetzen
        document.querySelectorAll('.qc-star').forEach(star => {
            star.classList.remove('selected');
        });

        // Sterne bis zur Bewertung markieren
        for (let i = 1; i <= rating; i++) {
            const star = document.querySelector(`[data-rating="${i}"]`);
            if (star) {
                star.classList.add('selected');
            }
        }

        this.selectedQCRating = rating;
    }

    getSelectedQCRating() {
        return this.selectedQCRating || null;
    }

    toggleQCMode() {
        if (!this.qcEnabled) return;

        // QC-Modus zwischen 'auto', 'manual', 'disabled' umschalten
        const modes = ['auto', 'manual', 'disabled'];
        const currentIndex = modes.indexOf(this.qcMode);
        this.qcMode = modes[(currentIndex + 1) % modes.length];

        this.updateQCModeToggle();
        this.showNotification('info', 'QC-Modus', `QC-Modus: ${this.qcMode}`);

        console.log(`🔍 QC-Modus geändert: ${this.qcMode}`);
    }

    updateQCModeToggle() {
        const toggle = this.qcUIElements.qcModeToggle;
        if (toggle) {
            const modeTexts = {
                auto: '🔍 Auto',
                manual: '🔍 Manual',
                disabled: '🔍 Aus'
            };

            toggle.textContent = modeTexts[this.qcMode] || '🔍 QC';
            toggle.className = `btn-qc-toggle ${this.qcMode}`;
        }
    }

    // ===== KAMERA & QR-SCANNER =====
    async loadQRLibrary() {
        try {
            // Versuche jsQR zu laden
            if (typeof jsQR === 'undefined') {
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js';
                script.onload = () => {
                    console.log('✅ jsQR-Bibliothek geladen');
                };
                script.onerror = () => {
                    console.warn('⚠️ jsQR konnte nicht geladen werden - Fallback wird verwendet');
                };
                document.head.appendChild(script);
            }
        } catch (error) {
            console.warn('QR-Bibliothek laden fehlgeschlagen:', error);
        }
    }

    async checkCameraAvailability() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(device => device.kind === 'videoinput');

            if (cameras.length === 0) {
                this.showNotification('warning', 'Keine Kamera', 'Keine Kamera gefunden - QR-Scanner nicht verfügbar');
                return false;
            }

            console.log(`📷 ${cameras.length} Kamera(s) gefunden:`, cameras);
            return true;

        } catch (error) {
            console.error('Kamera-Verfügbarkeit prüfen fehlgeschlagen:', error);
            this.showNotification('error', 'Kamera-Fehler', 'Kamera-Zugriff nicht möglich');
            return false;
        }
    }

    async startQRScanner() {
        if (this.scannerActive) return;

        if (!this.selectedSession) {
            this.showNotification('warning', 'Benutzer auswählen', 'Bitte wählen Sie zuerst einen Mitarbeiter aus');
            return;
        }

        try {
            console.log('📷 Starte QR-Scanner...');

            // Prüfe Kamera-Berechtigung
            const permission = await this.checkCameraPermission();
            if (permission === 'denied') {
                this.showModal('cameraPermissionModal');
                return;
            }

            // Optimierte Kamera-Constraints für bessere Kompatibilität
            const constraints = await this.getOptimalCameraConstraints();

            this.videoStream = await navigator.mediaDevices.getUserMedia(constraints);

            const video = document.getElementById('scannerVideo');
            video.srcObject = this.videoStream;

            // Warte auf Video-Metadaten
            await new Promise((resolve, reject) => {
                video.onloadedmetadata = () => {
                    console.log(`📷 Video bereit: ${video.videoWidth}x${video.videoHeight}`);
                    resolve();
                };
                video.onerror = reject;
                setTimeout(() => reject(new Error('Video-Load-Timeout')), 10000);
            });

            await video.play();

            this.scannerActive = true;
            this.updateScannerUI();
            this.startQRScanLoop();

            let message = `QR-Codes werden für ${this.selectedSession.userName} erkannt`;
            if (this.qcEnabled) {
                message += ' (QC-Modus verfügbar)';
            }

            this.showNotification('success', 'Scanner bereit', message);

        } catch (error) {
            console.error('QR-Scanner Start fehlgeschlagen:', error);
            this.showErrorModal('Scanner-Fehler',
                `Kamera konnte nicht gestartet werden:\n${error.message}\n\n` +
                'Lösungsvorschläge:\n' +
                '• Kamera-Berechtigung erteilen\n' +
                '• Andere Apps schließen die Kamera verwenden\n' +
                '• Anwendung neu starten'
            );
        }
    }

    async getOptimalCameraConstraints() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(device => device.kind === 'videoinput');

            // Basis-Constraints
            let constraints = {
                video: {
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                    frameRate: { ideal: 30, min: 15 }
                }
            };

            // Bevorzuge Rückkamera wenn verfügbar
            const backCamera = cameras.find(camera =>
                camera.label.toLowerCase().includes('back') ||
                camera.label.toLowerCase().includes('rear') ||
                camera.label.toLowerCase().includes('environment')
            );

            if (backCamera) {
                constraints.video.deviceId = { ideal: backCamera.deviceId };
            } else if (cameras.length > 0) {
                // Verwende erste verfügbare Kamera
                constraints.video.deviceId = { ideal: cameras[0].deviceId };
            }

            return constraints;

        } catch (error) {
            console.warn('Optimale Kamera-Constraints fehlgeschlagen, verwende Fallback:', error);
            return {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 }
                }
            };
        }
    }

    async checkCameraPermission() {
        try {
            const result = await navigator.permissions.query({ name: 'camera' });
            return result.state; // 'granted', 'denied', 'prompt'
        } catch (error) {
            return 'unknown';
        }
    }

    async requestCameraPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            // Stoppe Stream sofort wieder - nur für Berechtigung
            stream.getTracks().forEach(track => track.stop());

            this.showNotification('success', 'Berechtigung erteilt', 'Kamera-Zugriff wurde erlaubt');

            // Versuche Scanner zu starten
            setTimeout(() => this.startQRScanner(), 500);

        } catch (error) {
            this.showNotification('error', 'Berechtigung verweigert', 'Kamera-Zugriff wurde nicht erlaubt');
        }
    }

    stopQRScanner() {
        if (!this.scannerActive) return;

        console.log('⏹️ Stoppe QR-Scanner...');

        // Video-Stream stoppen
        if (this.videoStream) {
            this.videoStream.getTracks().forEach(track => {
                track.stop();
                console.log(`Track gestoppt: ${track.kind}`);
            });
            this.videoStream = null;
        }

        // Scan-Loop stoppen
        if (this.scanLoop) {
            cancelAnimationFrame(this.scanLoop);
            this.scanLoop = null;
        }

        // Video-Element leeren
        const video = document.getElementById('scannerVideo');
        video.srcObject = null;

        this.scannerActive = false;
        this.updateScannerUI();

        this.showNotification('info', 'Scanner gestoppt', 'QR-Scanner wurde beendet');
    }

    startQRScanLoop() {
        const video = document.getElementById('scannerVideo');
        const canvas = document.getElementById('scannerCanvas');
        const context = canvas.getContext('2d');

        const scanFrame = () => {
            if (!this.scannerActive || !video.videoWidth || !video.videoHeight) {
                if (this.scannerActive) {
                    this.scanLoop = requestAnimationFrame(scanFrame);
                }
                return;
            }

            try {
                // Canvas auf Video-Größe setzen
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;

                // Video-Frame auf Canvas zeichnen
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Image-Data für QR-Erkennung
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

                // QR-Code erkennen
                if (typeof jsQR !== 'undefined') {
                    const code = jsQR(imageData.data, imageData.width, imageData.height, {
                        inversionAttempts: "dontInvert"
                    });

                    if (code && code.data) {
                        this.handleQRCodeDetected(code.data);
                    }
                } else {
                    // Fallback: Einfache Muster-Erkennung
                    if (this.detectQRPattern(imageData)) {
                        const mockData = `FALLBACK_QR_${Date.now()}`;
                        this.handleQRCodeDetected(mockData);
                    }
                }

            } catch (error) {
                console.error('QR-Scan-Fehler:', error);
            }

            if (this.scannerActive) {
                this.scanLoop = requestAnimationFrame(scanFrame);
            }
        };

        this.scanLoop = requestAnimationFrame(scanFrame);
        console.log('🔄 QR-Scan-Loop gestartet');
    }

    detectQRPattern(imageData) {
        // Einfache QR-Muster-Erkennung als Fallback
        // Erkennt grundlegende Muster von QR-Codes
        const { data, width, height } = imageData;
        let darkPixels = 0;
        let totalPixels = width * height;

        // Zähle dunkle Pixel
        for (let i = 0; i < data.length; i += 4) {
            const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (brightness < 128) darkPixels++;
        }

        // QR-Codes haben typischerweise 40-60% dunkle Pixel
        const darkRatio = darkPixels / totalPixels;
        return darkRatio > 0.3 && darkRatio < 0.7;
    }

    updateScannerUI() {
        const startBtn = document.getElementById('startScannerBtn');
        const stopBtn = document.getElementById('stopScannerBtn');
        const statusText = document.getElementById('scannerStatusText');
        const cameraStatus = document.getElementById('cameraStatus');

        if (this.scannerActive) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'inline-flex';
            statusText.textContent = `Scanner aktiv für ${this.selectedSession?.userName || 'Unbekannt'}`;
            cameraStatus.style.display = 'none';
        } else {
            startBtn.style.display = 'inline-flex';
            stopBtn.style.display = 'none';
            statusText.textContent = 'Scanner gestoppt';
            cameraStatus.style.display = 'flex';
        }
    }

    // ===== QR-CODE VERARBEITUNG FÜR PARALLELE SESSIONS MIT QC =====
    async handleQRCodeDetected(qrData) {
        const now = Date.now();

        // Prüfe ob ein Benutzer ausgewählt ist
        if (!this.selectedSession) {
            this.showNotification('warning', 'Kein Benutzer ausgewählt', 'Bitte wählen Sie zuerst einen Mitarbeiter aus');
            return;
        }

        // 1. Sofortige Duplikat-Prüfung (identischer Code + Zeit)
        if (this.lastProcessedQR === qrData && (now - this.lastProcessedTime) < 2000) {
            console.log('🔄 Identischer QR-Code innerhalb 2s ignoriert');
            return;
        }

        // 2. Prüfung auf kürzlich gescannte Codes (zeitbasiert)
        const recentScanTime = this.recentlyScanned.get(qrData);
        if (recentScanTime && (now - recentScanTime) < this.scanCooldown) {
            console.log(`🔄 QR-Code zu schnell erneut gescannt (${now - recentScanTime}ms < ${this.scanCooldown}ms)`);
            return;
        }

        // 3. Prüfung auf bereits laufende Verarbeitung
        if (this.pendingScans.has(qrData)) {
            console.log('🔄 QR-Code wird bereits verarbeitet, überspringe');
            return;
        }

        // Verarbeitung starten
        this.lastProcessedQR = qrData;
        this.lastProcessedTime = now;
        this.pendingScans.add(qrData);
        this.recentlyScanned.set(qrData, now);

        console.log(`📄 QR-Code erkannt für ${this.selectedSession.userName}:`, qrData);

        try {
            // In Datenbank speichern für ausgewählte Session (mit QC-Integration)
            const result = await window.electronAPI.qr.saveScan(this.selectedSession.sessionId, qrData);

            // QC-spezifische Verarbeitung
            let qcResult = { qcProcessed: false };
            if (this.qcEnabled && this.qcManager && result.qualityControl) {
                qcResult = await this.qcManager.processQRScanForQC(
                    result,
                    qrData,
                    this.selectedSession.sessionId
                );
            }

            // Scan-Ergebnis verarbeiten (inklusive QC-Informationen)
            this.handleScanResult(result, qrData, qcResult);

        } catch (error) {
            console.error('QR-Code Verarbeitung fehlgeschlagen:', error);

            // Auch bei unerwarteten Fehlern strukturierte Antwort erstellen
            const errorResult = {
                success: false,
                status: 'error',
                message: `Unerwarteter Fehler: ${error.message}`,
                data: null,
                timestamp: new Date().toISOString()
            };

            this.handleScanResult(errorResult, qrData, { qcProcessed: false });

        } finally {
            // Verarbeitung abgeschlossen - aus Pending-Set entfernen
            this.pendingScans.delete(qrData);
        }
    }

    // ===== STRUKTURIERTE SCAN-RESULT-BEHANDLUNG MIT QC =====
    handleScanResult(result, qrData, qcResult = { qcProcessed: false }) {
        const { success, status, message, data, duplicateInfo, qualityControl } = result;

        console.log('QR-Scan Ergebnis:', {
            success,
            status,
            message,
            session: this.selectedSession.userName,
            qcProcessed: qcResult.qcProcessed,
            qcAction: qcResult.action
        });

        // Dekodierte Daten extrahieren falls verfügbar
        let decodedData = null;
        if (data && data.DecodedData) {
            decodedData = data.DecodedData;
        } else if (data && data.ParsedPayload && data.ParsedPayload.decoded) {
            decodedData = data.ParsedPayload.decoded;
        }

        // 1. AKTUELLER SCAN: Jeden Scan anzeigen (mit QC-Informationen)
        this.currentScan = {
            id: data?.ID || `temp_${Date.now()}`,
            timestamp: new Date(),
            content: qrData,
            user: this.selectedSession.userName,
            userId: this.selectedSession.userId,
            sessionId: this.selectedSession.sessionId,
            status: status,
            message: message,
            success: success,
            duplicateInfo: duplicateInfo,
            decodedData: decodedData,
            qualityControl: qualityControl,
            qcResult: qcResult
        };

        this.updateCurrentScanDisplay();

        // 2. ERFOLGREICHE SCANS: Nur erfolgreiche Scans zur Tabelle hinzufügen
        if (success && decodedData) {
            // Session-spezifische Duplikat-Prüfung
            const sessionCodes = this.sessionScannedCodes.get(this.selectedSession.sessionId) || new Set();

            if (!sessionCodes.has(qrData)) {
                sessionCodes.add(qrData);
                this.sessionScannedCodes.set(this.selectedSession.sessionId, sessionCodes);

                this.addToSuccessfulScans({
                    id: data.ID,
                    timestamp: new Date(),
                    content: qrData,
                    user: this.selectedSession.userName,
                    userId: this.selectedSession.userId,
                    sessionId: this.selectedSession.sessionId,
                    decodedData: decodedData,
                    qualityControl: qualityControl,
                    qcResult: qcResult
                });

                // Session-Scan-Count aktualisieren
                this.selectedSession.scanCount++;
                this.updateSelectedUserDisplay();
                this.updateActiveUsersDisplay();

                console.log(`✅ Erfolgreicher Scan zur Tabelle hinzugefügt für ${this.selectedSession.userName}`);
            } else {
                console.log(`🔄 Erfolgreicher Scan bereits in Session-Tabelle vorhanden`);
            }
        }

        // 3. VISUAL FEEDBACK je nach Status (erweitert für QC)
        if (success) {
            this.globalScannedCodes.add(qrData);
            this.showScanSuccess(qrData, 'success');

            // Erweiterte Nachricht mit dekodierten Daten und QC-Information
            let enhancedMessage = message;
            if (decodedData) {
                const parts = [];
                if (decodedData.auftrags_nr) parts.push(`Auftrag: ${decodedData.auftrags_nr}`);
                if (decodedData.paket_nr) parts.push(`Paket: ${decodedData.paket_nr}`);
                if (parts.length > 0) {
                    enhancedMessage = `${this.selectedSession.userName}: ${parts.join(', ')}`;
                }
            }

            // QC-spezifische Nachricht anhängen
            if (qcResult.qcProcessed && qcResult.message) {
                enhancedMessage += ` - ${qcResult.message}`;
            }

            this.showNotification('success', 'QR-Code gespeichert', enhancedMessage);

            // Spezielle QC-Behandlung
            if (qcResult.qcProcessed) {
                this.handleQCSpecificFeedback(qcResult);
            }

        } else {
            // Verschiedene Fehler/Duplikat-Typen
            switch (status) {
                case 'duplicate_cache':
                case 'duplicate_database':
                case 'duplicate_transaction':
                    this.globalScannedCodes.add(qrData);
                    this.showScanSuccess(qrData, 'duplicate');
                    this.showNotification('error', 'Duplikat erkannt', `${this.selectedSession.userName}: ${message}`);
                    break;

                case 'rate_limit':
                    this.showScanSuccess(qrData, 'warning');
                    this.showNotification('warning', 'Rate Limit', message);
                    break;

                case 'processing':
                    this.showScanSuccess(qrData, 'info');
                    this.showNotification('info', 'Verarbeitung', message);
                    break;

                case 'database_offline':
                case 'error':
                default:
                    this.showScanSuccess(qrData, 'error');
                    this.showNotification('error', 'Fehler', message);
                    break;
            }
        }

        // Letzte Scan-Zeit aktualisieren
        document.getElementById('lastScanTime').textContent =
            new Date().toLocaleTimeString('de-DE');
    }

    handleQCSpecificFeedback(qcResult) {
        switch (qcResult.action) {
            case 'qc_started':
                // QC-UI für laufenden Prozess aktualisieren
                this.updateQCModeDisplay(true);
                this.updateQCInfoRow('QC läuft', 'active');
                break;

            case 'qc_completed':
                // QC-UI für abgeschlossenen Prozess aktualisieren
                this.updateQCModeDisplay(false);
                this.updateQCInfoRow('QC abgeschlossen', 'completed');

                // Wenn Auto-Session-Reset aktiviert, behandeln
                if (qcResult.autoSessionReset) {
                    setTimeout(() => {
                        this.handleSessionAutoReset({
                            sessionId: this.selectedSession.sessionId,
                            userId: this.selectedSession.userId,
                            userName: this.selectedSession.userName,
                            reason: 'QC abgeschlossen'
                        });
                    }, 2000); // 2 Sekunden Verzögerung für Benutzerfeedback
                }
                break;

            case 'qc_continued':
                // QC läuft weiter - UI-Status beibehalten
                this.updateQCModeDisplay(true);
                this.updateQCInfoRow('QC läuft weiter', 'active');
                break;
        }
    }

    showScanSuccess(qrData, type = 'success') {
        // Visuelles Feedback im Scanner
        const overlay = document.querySelector('.scanner-overlay');

        // CSS-Klassen je nach Typ
        const feedbackClasses = {
            success: 'scan-feedback-success',
            duplicate: 'scan-feedback-error', // Duplikate jetzt rot
            warning: 'scan-feedback-duplicate',
            error: 'scan-feedback-error',
            info: 'scan-feedback-success'
        };

        const feedbackClass = feedbackClasses[type] || 'scan-feedback-success';
        overlay.classList.add(feedbackClass);

        setTimeout(() => {
            overlay.classList.remove(feedbackClass);
        }, 1000);

        // Audio-Feedback (erweitert für QC)
        this.playSuccessSound(type);
    }

    playSuccessSound(type = 'success') {
        try {
            // Verschiedene Töne je nach Typ
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = context.createOscillator();
            const gainNode = context.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(context.destination);

            // Töne je nach Status
            if (type === 'success') {
                oscillator.frequency.setValueAtTime(800, context.currentTime);
                oscillator.frequency.setValueAtTime(1000, context.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.3, context.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
                oscillator.start(context.currentTime);
                oscillator.stop(context.currentTime + 0.3);
            } else if (type === 'duplicate') {
                // BEMERKBARER DUPLIKAT-SOUND: Längerer, tieferer, dringenderer Ton
                oscillator.frequency.setValueAtTime(400, context.currentTime);
                oscillator.frequency.setValueAtTime(350, context.currentTime + 0.2);
                oscillator.frequency.setValueAtTime(400, context.currentTime + 0.4);
                gainNode.gain.setValueAtTime(0.5, context.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.6);
                oscillator.start(context.currentTime);
                oscillator.stop(context.currentTime + 0.6);
            } else if (type === 'warning') {
                oscillator.frequency.setValueAtTime(600, context.currentTime);
                oscillator.frequency.setValueAtTime(700, context.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.3, context.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
                oscillator.start(context.currentTime);
                oscillator.stop(context.currentTime + 0.3);
            } else if (type === 'error') {
                oscillator.frequency.setValueAtTime(400, context.currentTime);
                oscillator.frequency.setValueAtTime(300, context.currentTime + 0.1);
                gainNode.gain.setValueAtTime(0.3, context.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
                oscillator.start(context.currentTime);
                oscillator.stop(context.currentTime + 0.3);
            }
        } catch (error) {
            // Sound-Fehler ignorieren
            console.log('Sound-Feedback nicht verfügbar');
        }
    }

    // ===== CURRENT SCAN DISPLAY MIT QC =====
    updateCurrentScanDisplay() {
        const currentScanDisplay = document.getElementById('currentScanDisplay');
        const currentScanTime = document.getElementById('currentScanTime');
        const currentScanStatus = document.getElementById('currentScanStatus');
        const currentScanContent = document.getElementById('currentScanContent');
        const currentScanMessage = document.getElementById('currentScanMessage');
        const currentScanQCInfo = document.getElementById('currentScanQCInfo');

        if (!this.currentScan) {
            currentScanDisplay.style.display = 'none';
            return;
        }

        const scan = this.currentScan;
        const timeString = scan.timestamp.toLocaleTimeString('de-DE');
        const statusInfo = this.getScanStatusInfo(scan);

        // CSS-Klasse für Status
        currentScanDisplay.className = `current-scan-display ${statusInfo.cssClass}`;
        currentScanDisplay.style.display = 'block';

        // Inhalt aktualisieren
        currentScanTime.textContent = timeString;
        currentScanStatus.innerHTML = `
            <span class="status-icon">${statusInfo.icon}</span>
            <span class="status-text" style="color: ${statusInfo.color};">${statusInfo.label}</span>
            <span class="scan-user">${scan.user}</span>
        `;

        // QR-Code Inhalt (gekürzt für bessere Übersicht)
        const contentPreview = scan.content.length > 150 ?
            scan.content.substring(0, 150) + '...' : scan.content;
        currentScanContent.textContent = contentPreview;

        currentScanMessage.textContent = scan.message;

        // QC-spezifische Informationen anzeigen
        if (this.qcEnabled && scan.qcResult && scan.qcResult.qcProcessed) {
            this.updateCurrentScanQCInfo(scan, currentScanQCInfo);
        } else {
            currentScanQCInfo.style.display = 'none';
        }
    }

    updateCurrentScanQCInfo(scan, qcInfoElement) {
        const qcResult = scan.qcResult;

        if (!qcResult || !qcResult.qcProcessed) {
            qcInfoElement.style.display = 'none';
            return;
        }

        qcInfoElement.style.display = 'block';

        const qcStepLabel = document.getElementById('qcStepLabel');
        const qcStepValue = document.getElementById('qcStepValue');
        const qcDurationValue = document.getElementById('qcDurationValue');
        const qcNextStep = document.getElementById('qcNextStep');

        switch (qcResult.action) {
            case 'qc_started':
                qcStepValue.textContent = '1/2 (Eingang)';
                qcDurationValue.textContent = '0 Min';
                qcNextStep.textContent = 'Scannen Sie den gleichen QR-Code erneut für Ausgang';
                qcInfoElement.className = 'current-scan-qc-info qc-started';
                break;

            case 'qc_completed':
                qcStepValue.textContent = '2/2 (Ausgang)';
                qcDurationValue.textContent = `${qcResult.durationMinutes || 0} Min`;
                qcNextStep.textContent = 'Qualitätsprüfung abgeschlossen';
                qcInfoElement.className = 'current-scan-qc-info qc-completed';
                break;

            case 'qc_continued':
                qcStepValue.textContent = '1/2 (läuft)';
                qcDurationValue.textContent = `${qcResult.minutesInProgress || 0} Min`;
                qcNextStep.textContent = 'QC läuft bereits - scannen Sie erneut für Ausgang';
                qcInfoElement.className = 'current-scan-qc-info qc-continued';
                break;

            default:
                qcInfoElement.style.display = 'none';
                break;
        }
    }

    // ===== SUCCESSFUL SCANS TABLE MIT QC =====
    addToSuccessfulScans(scan) {
        this.successfulScans.unshift(scan);

        // Maximal 100 erfolgreiche Scans behalten (mehr da parallele Sessions)
        if (this.successfulScans.length > 100) {
            this.successfulScans = this.successfulScans.slice(0, 100);
        }

        this.updateSuccessfulScansTable();
    }

    updateSuccessfulScansTable() {
        const tableBody = document.getElementById('successScansTableBody');
        const emptyMessage = document.getElementById('emptySuccessScans');
        const tableContainer = document.querySelector('.success-scans-table-container table');

        if (this.successfulScans.length === 0) {
            tableContainer.style.display = 'none';
            emptyMessage.style.display = 'block';
            return;
        }

        tableContainer.style.display = 'table';
        emptyMessage.style.display = 'none';

        const rowsHtml = this.successfulScans.map(scan => {
            const timeString = scan.timestamp.toLocaleTimeString('de-DE');
            const decoded = scan.decodedData || {};

            // QC-Status für diese Zeile
            let qcStatus = '-';
            if (this.qcEnabled && scan.qcResult && scan.qcResult.qcProcessed) {
                switch (scan.qcResult.action) {
                    case 'qc_started':
                        qcStatus = '🔍 Laufend';
                        break;
                    case 'qc_completed':
                        qcStatus = `✅ ${scan.qcResult.durationMinutes}M`;
                        break;
                    case 'qc_continued':
                        qcStatus = '🔄 Fortsetzung';
                        break;
                    default:
                        qcStatus = '❓ Unbekannt';
                        break;
                }
            }

            return `
                <tr>
                    <td class="scan-time-col">${timeString}</td>
                    <td class="user-col">${scan.user}</td>
                    <td class="auftrag-col">${decoded.auftrags_nr || '-'}</td>
                    <td class="kunde-col">${decoded.kunden_name || decoded.kunden_id || '-'}</td>
                    <td class="paket-col">${decoded.paket_nr || '-'}</td>
                    ${this.qcEnabled ? `<td class="qc-col">${qcStatus}</td>` : ''}
                </tr>
            `;
        }).join('');

        tableBody.innerHTML = rowsHtml;
    }

    async refreshScansForSelectedUser() {
        if (!this.selectedSession) return;

        try {
            const scans = await window.electronAPI.qr.getDecodedScans(this.selectedSession.sessionId, 50);

            // Erfolgreiche Scans für ausgewählten Benutzer aktualisieren
            this.successfulScans = this.successfulScans.filter(s => s.sessionId !== this.selectedSession.sessionId);

            scans.forEach(scan => {
                this.addToSuccessfulScans({
                    id: scan.ID,
                    timestamp: new Date(scan.ScanTime),
                    content: scan.QrCode,
                    user: this.selectedSession.userName,
                    userId: this.selectedSession.userId,
                    sessionId: this.selectedSession.sessionId,
                    decodedData: scan.DecodedData,
                    qualityControl: scan.QualityControl || null
                });
            });

            console.log(`Scan-Historie für ${this.selectedSession.userName} aktualisiert: ${scans.length} Scans`);
        } catch (error) {
            console.error('Fehler beim Aktualisieren der Scan-Historie:', error);
        }
    }

    async refreshScans() {
        if (this.selectedSession) {
            await this.refreshScansForSelectedUser();

            // QC-Daten auch aktualisieren
            if (this.qcEnabled && this.qcManager) {
                await this.qcManager.refreshQCData();
            }

            this.showNotification('info', 'Aktualisiert', 'Scan-Historie und QC-Daten wurden aktualisiert');
        }
    }

    clearRecentScans() {
        // Current Scan zurücksetzen
        this.currentScan = null;
        this.updateCurrentScanDisplay();

        // Erfolgreiche Scans löschen (alle oder nur für ausgewählten Benutzer)
        if (this.selectedSession) {
            this.successfulScans = this.successfulScans.filter(s => s.sessionId !== this.selectedSession.sessionId);
            this.showNotification('info', 'Scans geleert', `Scan-Historie für ${this.selectedSession.userName} wurde geleert`);
        } else {
            this.successfulScans = [];
            this.showNotification('info', 'Scans geleert', 'Komplette Scan-Historie wurde geleert');
        }

        this.updateSuccessfulScansTable();
        console.log('🗑️ Scan-Historie manuell geleert');
    }

    getScanStatusInfo(scan) {
        const { success, status, duplicateInfo, qcResult } = scan;

        if (success) {
            // QC-spezifische Erfolgs-Anzeige
            if (qcResult && qcResult.qcProcessed) {
                switch (qcResult.action) {
                    case 'qc_started':
                        return {
                            cssClass: 'scan-qc-started',
                            icon: '🔍',
                            label: 'QC gestartet',
                            color: '#3b82f6'
                        };
                    case 'qc_completed':
                        return {
                            cssClass: 'scan-qc-completed',
                            icon: '✅',
                            label: 'QC abgeschlossen',
                            color: '#28a745'
                        };
                    case 'qc_continued':
                        return {
                            cssClass: 'scan-qc-continued',
                            icon: '🔄',
                            label: 'QC läuft',
                            color: '#17a2b8'
                        };
                }
            }

            return {
                cssClass: 'scan-success',
                icon: '✅',
                label: 'Gespeichert',
                color: '#28a745'
            };
        }

        switch (status) {
            case 'duplicate_cache':
            case 'duplicate_database':
            case 'duplicate_transaction':
                const timeInfo = duplicateInfo?.minutesAgo ?
                    ` (vor ${duplicateInfo.minutesAgo} Min)` : '';
                return {
                    cssClass: 'scan-duplicate',
                    icon: '🚫',
                    label: `Duplikat${timeInfo}`,
                    color: '#dc3545' // ROT statt gelb
                };

            case 'rate_limit':
                return {
                    cssClass: 'scan-error',
                    icon: '🚫',
                    label: 'Rate Limit',
                    color: '#fd7e14'
                };

            case 'processing':
                return {
                    cssClass: 'scan-info',
                    icon: '🔄',
                    label: 'Verarbeitung',
                    color: '#17a2b8'
                };

            case 'database_offline':
                return {
                    cssClass: 'scan-error',
                    icon: '💾',
                    label: 'DB Offline',
                    color: '#dc3545'
                };

            case 'error':
            default:
                return {
                    cssClass: 'scan-error',
                    icon: '❌',
                    label: 'Fehler',
                    color: '#dc3545'
                };
        }
    }

    // ===== UTILITY METHODS =====

    getShortQRCode(qrCode) {
        if (!qrCode) return '';

        // Zeige nur die letzten 8 Zeichen oder eine intelligent gekürzte Version
        if (qrCode.length <= 12) return qrCode;

        // Versuche strukturierte Daten zu erkennen
        if (qrCode.includes('^')) {
            const parts = qrCode.split('^');
            return parts.length > 3 ? `${parts[1]}...${parts[3]}` : qrCode.substring(0, 12) + '...';
        }

        return qrCode.substring(0, 8) + '...' + qrCode.substring(qrCode.length - 4);
    }

    cleanupOldScans() {
        // Bereinige alte Einträge aus recentlyScanned (älter als 1 Minute)
        const now = Date.now();
        const oneMinute = 60 * 1000;

        for (const [qrData, timestamp] of this.recentlyScanned.entries()) {
            if (now - timestamp > oneMinute) {
                this.recentlyScanned.delete(qrData);
            }
        }
    }

    // ===== UI UPDATES =====
    updateSystemStatus(status, message) {
        const statusDot = document.querySelector('.status-dot');
        const statusText = document.querySelector('.status-text');

        statusDot.className = `status-dot ${status}`;
        statusText.textContent = message;
    }

    updateInstructionText(text) {
        document.getElementById('instructionText').textContent = `💡 ${text}`;
    }

    startClockUpdate() {
        const updateClock = () => {
            const now = new Date();

            // Korrekte deutsche Zeitformatierung mit expliziter Zeitzone
            try {
                const timeOptions = {
                    timeZone: 'Europe/Berlin',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                };

                const dateOptions = {
                    timeZone: 'Europe/Berlin',
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                };

                document.getElementById('currentTime').textContent =
                    now.toLocaleTimeString('de-DE', timeOptions);
                document.getElementById('dateText').textContent =
                    now.toLocaleDateString('de-DE', dateOptions);

            } catch (error) {
                console.error('Fehler bei Zeitformatierung:', error);
                // Fallback zu einfacher Formatierung
                document.getElementById('currentTime').textContent =
                    now.toLocaleTimeString('de-DE');
                document.getElementById('dateText').textContent =
                    now.toLocaleDateString('de-DE');
            }
        };

        updateClock();
        setInterval(updateClock, 1000);

        // Periodische Bereinigung alter Scans
        setInterval(() => {
            this.cleanupOldScans();
        }, 30000); // Alle 30 Sekunden
    }

    async updateSystemInfo() {
        try {
            const systemInfo = await window.electronAPI.app.getSystemInfo();
            document.getElementById('versionText').textContent = `v${systemInfo.version}`;
        } catch (error) {
            console.error('System-Info laden fehlgeschlagen:', error);
        }
    }

    // ===== NOTIFICATIONS & MODALS =====
    showNotification(type, title, message, duration = 4000) {
        const notifications = document.getElementById('notifications');

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        notification.innerHTML = `
            <div class="notification-icon">${icons[type] || 'ℹ️'}</div>
            <div class="notification-content">
                <div class="notification-title">${title}</div>
                <div class="notification-text">${message}</div>
            </div>
        `;

        notifications.appendChild(notification);

        // Auto-Remove
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, duration);
    }

    showErrorModal(title, message) {
        const modal = document.getElementById('errorModal');
        const titleElement = document.querySelector('#errorModal .modal-title .icon');
        const messageElement = document.getElementById('errorMessage');

        titleElement.nextSibling.textContent = title;
        messageElement.textContent = message;

        this.showModal('errorModal');
    }

    showModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('show');
    }

    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.remove('show');
    }

    // ===== PUBLIC API FOR QC MANAGER =====

    /**
     * Ermöglicht dem QC Manager den Zugriff auf Event-System
     */
    on(event, handler) {
        // Einfaches Event-System für QC Manager
        if (!this.eventHandlers) {
            this.eventHandlers = new Map();
        }

        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, new Set());
        }

        this.eventHandlers.get(event).add(handler);
    }

    off(event, handler) {
        if (this.eventHandlers && this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).delete(handler);
        }
    }

    emit(event, data) {
        if (this.eventHandlers && this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`Fehler in Event-Handler für ${event}:`, error);
                }
            });
        }
    }

    /**
     * Cleanup-Methode für QC-System
     */
    cleanup() {
        if (this.qcManager) {
            this.qcManager.cleanup();
        }

        // Event-Handler bereinigen
        if (this.eventHandlers) {
            this.eventHandlers.clear();
        }
    }
}

// ===== APP INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    console.log('🏁 DOM geladen, starte Wareneinlagerung-App mit QC...');
    window.wareneinlagerungApp = new WareneinlagerungApp();
});

// Cleanup beim Fenster schließen
window.addEventListener('beforeunload', () => {
    if (window.wareneinlagerungApp) {
        if (window.wareneinlagerungApp.scannerActive) {
            window.wareneinlagerungApp.stopQRScanner();
        }
        window.wareneinlagerungApp.cleanup();
    }
});

// Global verfügbare Funktionen
window.app = {
    showNotification: (type, title, message) => {
        if (window.wareneinlagerungApp) {
            window.wareneinlagerungApp.showNotification(type, title, message);
        }
    },

    selectUser: (userId) => {
        if (window.wareneinlagerungApp) {
            window.wareneinlagerungApp.selectUser(userId);
        }
    },

    restartSession: (userId, sessionId) => {
        if (window.wareneinlagerungApp) {
            window.wareneinlagerungApp.showSessionRestartModal(userId, sessionId);
        }
    },

    // QC-spezifische Funktionen
    toggleQCMode: () => {
        if (window.wareneinlagerungApp && window.wareneinlagerungApp.qcEnabled) {
            window.wareneinlagerungApp.toggleQCMode();
        }
    },

    getQCStatus: (qrCode) => {
        if (window.wareneinlagerungApp && window.wareneinlagerungApp.qcManager) {
            return window.wareneinlagerungApp.qcManager.getQCStatus(qrCode);
        }
        return null;
    },

    refreshQCData: () => {
        if (window.wareneinlagerungApp && window.wareneinlagerungApp.qcManager) {
            return window.wareneinlagerungApp.qcManager.refreshQCData();
        }
    }
};
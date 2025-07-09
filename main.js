const { app, BrowserWindow, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
require('dotenv').config();

// Console-Encoding für Windows setzen
if (process.platform === 'win32') {
    try {
        process.stdout.setEncoding('utf8');
        process.stderr.setEncoding('utf8');
    } catch (error) {
        // Encoding setzen fehlgeschlagen - nicht kritisch
    }
}

// Nur sichere Module laden
const DatabaseClient = require('./db/db-client');

// SessionTypes Setup-Funktionen importieren
const { setupSessionTypes } = require('./db/constants/session-types');

// Simple RFID Listener laden (ohne native Dependencies)
let SimpleRFIDListener;
try {
    SimpleRFIDListener = require('./rfid/simple-rfid-listener');
    console.log('✅ Simple RFID Listener geladen');
} catch (error) {
    console.warn('⚠️ Simple RFID Listener nicht verfügbar:', error.message);
    console.log('💡 App läuft ohne RFID-Support');
}

class WareneinlagerungMainApp {
    constructor() {
        this.mainWindow = null;
        this.rfidListener = null;
        this.dbClient = null;

        // Status-Tracking
        this.systemStatus = {
            database: false,
            rfid: false,
            sessionTypesSetup: false,
            lastError: null
        };

        // NEUE DATENSTRUKTUR: Parallele Sessions für mehrere Benutzer
        this.activeSessions = new Map(); // userId -> sessionData
        this.activeSessionTimers = new Map(); // sessionId -> timerInterval

        // QR-Scan Rate Limiting (pro Session)
        this.qrScanRateLimit = new Map(); // sessionId -> scanTimes[]
        this.maxQRScansPerMinute = 20;

        // QR-Code Dekodierung Statistiken (global)
        this.decodingStats = {
            totalScans: 0,
            successfulDecodes: 0,
            withAuftrag: 0,
            withPaket: 0,
            withKunde: 0
        };

        // RFID-Scan Tracking
        this.lastRFIDScanTime = 0;
        this.rfidScanCooldown = 2000; // 2 Sekunden zwischen RFID-Scans

        // SessionType Fallback-Konfiguration
        this.sessionTypePriority = ['Wareneinlagerung', 'Wareneinlagerung'];

        this.initializeApp();
    }

    initializeApp() {
        // ===== ERWEITERTE HARDWARE-BESCHLEUNIGUNG ANPASSUNGEN =====

        // Basis GPU-Fixes
        app.commandLine.appendSwitch('--disable-gpu-process-crash-limit');
        app.commandLine.appendSwitch('--disable-gpu-sandbox');
        app.commandLine.appendSwitch('--disable-software-rasterizer');
        app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor');

        // ===== ERWEITERTE FIXES FÜR GPU-CONTEXT-PROBLEME =====

        // WebGL und GPU-Context Probleme beheben
        app.commandLine.appendSwitch('--disable-gl-error-limit');
        app.commandLine.appendSwitch('--disable-gl-extensions');
        app.commandLine.appendSwitch('--disable-accelerated-video-decode');
        app.commandLine.appendSwitch('--disable-accelerated-video-encode');

        // GPU-Process Abstürze verhindern
        app.commandLine.appendSwitch('--disable-gpu-memory-buffer-video-frames');
        app.commandLine.appendSwitch('--disable-gpu-memory-buffer-compositor-resources');

        // Virtualisierung und Shared Context Probleme
        app.commandLine.appendSwitch('--disable-shared-gpu');
        app.commandLine.appendSwitch('--disable-gpu-process-for-dx12-vulkan-info-collection');

        // Für Windows: Umfassende GPU-Probleme vermeiden
        if (process.platform === 'win32') {
            app.commandLine.appendSwitch('--disable-gpu');
            app.commandLine.appendSwitch('--disable-gpu-compositing');

            // ===== ZUSÄTZLICHE WINDOWS-SPEZIFISCHE FIXES =====
            app.commandLine.appendSwitch('--disable-d3d11');
            app.commandLine.appendSwitch('--disable-angle-d3d11');
            app.commandLine.appendSwitch('--force-cpu-draw');
            app.commandLine.appendSwitch('--disable-direct-composition');

            // Falls Hardware-Alt ist
            app.commandLine.appendSwitch('--disable-features', 'VizDisplayCompositor,VizHitTestSurfaceLayer');
            app.commandLine.appendSwitch('--use-gl', 'swiftshader'); // Software-Renderer erzwingen
        }

        console.log('🔧 GPU-Optimierungen angewendet');

        // App bereit
        app.whenReady().then(() => {
            this.createMainWindow();
            this.initializeComponents();

            app.on('activate', () => {
                if (BrowserWindow.getAllWindows().length === 0) {
                    this.createMainWindow();
                }
            });
        });

        // App-Events
        app.on('window-all-closed', () => {
            this.cleanup();
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('before-quit', () => {
            this.cleanup();
        });

        // IPC-Handler einrichten
        this.setupIPCHandlers();
    }

    createMainWindow() {
        const windowWidth = parseInt(process.env.UI_WINDOW_WIDTH) || 1400;
        const windowHeight = parseInt(process.env.UI_WINDOW_HEIGHT) || 900;

        this.mainWindow = new BrowserWindow({
            width: windowWidth,
            height: windowHeight,
            minWidth: 1200,
            minHeight: 700,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js'),
                enableRemoteModule: false,
                webSecurity: true,

                // ===== ZUSÄTZLICHE WEBPREFERENCES FÜR GPU-STABILITÄT =====
                hardwareAcceleration: false,  // Hardware-Beschleunigung deaktivieren
                webgl: false,                  // WebGL deaktivieren wenn nicht benötigt
                experimentalFeatures: false,   // Experimentelle Features deaktivieren

                // GPU-Problem-Workarounds
                disableBlinkFeatures: 'Accelerated2dCanvas,AcceleratedSmallCanvases',
                enableBlinkFeatures: '',

                // Sicherheit
                allowRunningInsecureContent: false,
                safeDialogs: true
            },

            // ===== WINDOW-SPEZIFISCHE GPU-OPTIMIERUNGEN =====
            show: false, // Erst nach ready anzeigen
            title: 'RFID Wareneinlagerung - Shirtful',
            autoHideMenuBar: true,
            frame: true,
            titleBarStyle: 'default',

            // Windows-spezifische Optionen
            ...(process.platform === 'win32' && {
                icon: path.join(__dirname, 'assets/icon.ico')
            })
        });

        // Renderer laden
        this.mainWindow.loadFile('renderer/index.html');

        // Window erst nach vollständiger Initialisierung anzeigen
        this.mainWindow.once('ready-to-show', () => {
            this.mainWindow.show();
            console.log('✅ Hauptfenster erfolgreich geladen (GPU-optimiert)');

            // Development Tools
            if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
                this.mainWindow.webContents.openDevTools();
            }
        });

        // Fenster geschlossen
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        // Prevent navigation away from the app
        this.mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
            const parsedUrl = new URL(navigationUrl);
            if (parsedUrl.origin !== 'file://') {
                event.preventDefault();
            }
        });

        // WebContents-Fehler abfangen
        this.mainWindow.webContents.on('render-process-gone', (event, details) => {
            console.error('Renderer-Prozess abgestürzt:', details);

            if (details.reason !== 'clean-exit') {
                dialog.showErrorBox(
                    'Anwendungsfehler',
                    'Die Anwendung ist unerwartet beendet worden. Sie wird neu gestartet.'
                );

                // Neustart nach kurzer Verzögerung
                setTimeout(() => {
                    this.createMainWindow();
                }, 1000);
            }
        });
    }

    async initializeComponents() {
        console.log('🔄 Initialisiere Systemkomponenten...');

        // Datenbank zuerst
        await this.initializeDatabase();

        // RFID-Listener (mit Fallback)
        await this.initializeRFID();

        // System-Status an Renderer senden
        this.sendSystemStatus();

        console.log('✅ Systemkomponenten initialisiert');
    }

    async initializeDatabase() {
        try {
            console.log('📊 Initialisiere Datenbankverbindung...');

            this.dbClient = new DatabaseClient();
            await this.dbClient.connect();

            this.systemStatus.database = true;
            this.systemStatus.lastError = null;

            console.log('✅ Datenbank erfolgreich verbunden');

            // **KRITISCH: SessionTypes Setup ausführen**
            await this.setupSessionTypes();

            // QR-Code Dekodierung Statistiken laden
            await this.loadDecodingStats();

        } catch (error) {
            this.systemStatus.database = false;
            this.systemStatus.lastError = `Datenbank: ${error.message}`;

            console.error('❌ Datenbank-Initialisierung fehlgeschlagen:', error);

            // Benutzer informieren
            if (this.mainWindow) {
                dialog.showErrorBox(
                    'Datenbank-Verbindung fehlgeschlagen',
                    `Verbindung zur Datenbank konnte nicht hergestellt werden:\n\n${error.message}\n\n` +
                    'Bitte überprüfen Sie:\n' +
                    '• Netzwerkverbindung\n' +
                    '• .env Konfiguration\n' +
                    '• SQL Server Verfügbarkeit'
                );
            }
        }
    }

    /**
     * NEUE FUNKTION: SessionTypes Setup ausführen
     * Stellt sicher, dass alle SessionTypes in der Datenbank vorhanden sind
     */
    async setupSessionTypes() {
        try {
            console.log('🔧 Initialisiere SessionTypes...');

            // SessionTypes Setup mit roher Datenbankverbindung ausführen
            const success = await setupSessionTypes(this.dbClient);

            if (success) {
                this.systemStatus.sessionTypesSetup = true;
                console.log('✅ SessionTypes erfolgreich initialisiert');

                // Verfügbare SessionTypes anzeigen
                const sessionTypes = await this.dbClient.getSessionTypes();
                console.log(`📋 Verfügbare SessionTypes (${sessionTypes.length}):`);
                sessionTypes.forEach(type => {
                    console.log(`   - ${type.TypeName}: ${type.Description}`);
                });

                // SessionType-Priorität basierend auf verfügbaren Types aktualisieren
                this.updateSessionTypePriority(sessionTypes);

            } else {
                this.systemStatus.sessionTypesSetup = false;
                this.systemStatus.lastError = 'SessionTypes Setup fehlgeschlagen';
                console.error('❌ SessionTypes Setup fehlgeschlagen');

                // Weiter ausführen, aber mit Warnung
                console.warn('⚠️ System läuft möglicherweise eingeschränkt ohne SessionTypes');
            }

        } catch (error) {
            this.systemStatus.sessionTypesSetup = false;
            this.systemStatus.lastError = `SessionTypes Setup: ${error.message}`;
            console.error('❌ Fehler beim SessionTypes Setup:', error);

            // Nicht kritisch genug um das System zu stoppen
            console.warn('⚠️ System startet ohne SessionTypes Setup');
        }
    }

    /**
     * Aktualisiert die SessionType-Priorität basierend auf verfügbaren Types
     * @param {Array} availableSessionTypes - Verfügbare SessionTypes aus der DB
     */
    updateSessionTypePriority(availableSessionTypes) {
        const availableTypeNames = availableSessionTypes.map(type => type.TypeName);

        // Filtere nur verfügbare SessionTypes und behalte die Prioritätsreihenfolge bei
        this.sessionTypePriority = this.sessionTypePriority.filter(typeName =>
            availableTypeNames.includes(typeName)
        );

        // Füge weitere verfügbare Types hinzu, falls sie nicht in der Prioritätsliste sind
        availableTypeNames.forEach(typeName => {
            if (!this.sessionTypePriority.includes(typeName)) {
                this.sessionTypePriority.push(typeName);
            }
        });

        console.log(`🔧 SessionType-Priorität aktualisiert: [${this.sessionTypePriority.join(', ')}]`);
    }

    async loadDecodingStats() {
        try {
            if (!this.dbClient || !this.systemStatus.database) return;

            const stats = await this.dbClient.getQRScanStats();
            if (stats) {
                this.decodingStats = {
                    totalScans: stats.TotalScans || 0,
                    successfulDecodes: stats.DecodedScans || 0,
                    withAuftrag: stats.ScansWithAuftrag || 0,
                    withPaket: stats.ScansWithPaket || 0,
                    withKunde: stats.ScansWithKunde || 0,
                    decodingSuccessRate: stats.DecodingSuccessRate || 0
                };

                console.log('📋 QR-Code Dekodierung Statistiken geladen:', this.decodingStats);
            }
        } catch (error) {
            console.error('Fehler beim Laden der Dekodierung-Statistiken:', error);
        }
    }

    async initializeRFID() {
        try {
            console.log('🏷️ Initialisiere RFID-Listener...');

            if (!SimpleRFIDListener) {
                throw new Error('Simple RFID-Listener nicht verfügbar');
            }

            this.rfidListener = new SimpleRFIDListener((tagId) => {
                this.handleRFIDScan(tagId);
            });

            const started = await this.rfidListener.start();

            if (started) {
                this.systemStatus.rfid = true;
                console.log('✅ RFID-Listener erfolgreich gestartet');
            } else {
                throw new Error('RFID-Listener konnte nicht gestartet werden');
            }

        } catch (error) {
            this.systemStatus.rfid = false;
            this.systemStatus.lastError = `RFID: ${error.message}`;

            console.error('❌ RFID-Initialisierung fehlgeschlagen:', error);
            console.log('💡 RFID-Alternativen:');
            console.log('   1. Tags manuell in der UI simulieren');
            console.log('   2. Entwickler-Console für Tests verwenden');
            console.log('   3. Hardware später konfigurieren');

            // RFID ist nicht kritisch - App kann ohne laufen
        }
    }

    /**
     * KORRIGIERTE HILFSFUNKTION: Session mit Fallback erstellen
     * Versucht verschiedene SessionTypes in Prioritätsreihenfolge
     * @param {number} userId - Benutzer ID
     * @param {Array} sessionTypePriority - Prioritätsliste der SessionTypes (optional)
     * @param {boolean} closeExistingSessions - Bestehende Sessions beenden (default: true)
     * @returns {Object} - { session, sessionTypeName, fallbackUsed }
     */
    async createSessionWithFallback(userId, sessionTypePriority = null, closeExistingSessions = true) {
        const typesToTry = sessionTypePriority || this.sessionTypePriority;

        if (typesToTry.length === 0) {
            throw new Error('Keine SessionTypes verfügbar');
        }

        let lastError = null;

        for (const sessionType of typesToTry) {
            try {
                console.log(`🔄 Versuche SessionType: ${sessionType} (closeExisting: ${closeExistingSessions})`);

                // ===== KRITISCH: closeExistingSessions Parameter übergeben =====
                const session = await this.dbClient.createSession(userId, sessionType, closeExistingSessions);

                if (session) {
                    const fallbackUsed = sessionType !== typesToTry[0];
                    console.log(`✅ Session erfolgreich erstellt mit SessionType: ${sessionType}${fallbackUsed ? ' (Fallback)' : ''}`);

                    return {
                        session,
                        sessionTypeName: sessionType,
                        fallbackUsed
                    };
                }
            } catch (error) {
                console.warn(`⚠️ SessionType '${sessionType}' nicht verfügbar: ${error.message}`);
                lastError = error;
                continue;
            }
        }

        // Wenn alle SessionTypes fehlschlagen
        throw new Error(`Alle SessionTypes fehlgeschlagen. Letzter Fehler: ${lastError?.message || 'Unbekannt'}`);
    }

    setupIPCHandlers() {
        // ===== DATENBANK OPERATIONEN =====
        ipcMain.handle('db-query', async (event, query, params) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    throw new Error('Datenbank nicht verbunden');
                }
                return await this.dbClient.query(query, params);
            } catch (error) {
                console.error('DB Query Fehler:', error);
                throw error;
            }
        });

        ipcMain.handle('db-get-user-by-id', async (event, userId) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return null;
                }
                return await this.dbClient.getUserById(userId);
            } catch (error) {
                console.error('Get User by ID Fehler:', error);
                return null;
            }
        });

        // ===== PARALLELE SESSION MANAGEMENT =====
        ipcMain.handle('session-get-all-active', async (event) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return [];
                }

                // Aktive Sessions aus Datenbank laden
                const dbSessions = await this.dbClient.getActiveSessionsWithType();

                // Mit lokalen Session-Daten anreichern
                const enrichedSessions = dbSessions.map(session => {
                    const localSession = this.activeSessions.get(session.UserID);
                    return {
                        ...session,
                        StartTS: this.normalizeTimestamp(session.StartTS),
                        localStartTime: localSession ? localSession.startTime : session.StartTS
                    };
                });

                return enrichedSessions;
            } catch (error) {
                console.error('Fehler beim Abrufen aktiver Sessions:', error);
                return [];
            }
        });

        ipcMain.handle('session-create', async (event, userId) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    throw new Error('Datenbank nicht verbunden');
                }

                // Session mit Fallback erstellen
                const { session, sessionTypeName, fallbackUsed } = await this.createSessionWithFallback(userId);

                if (session) {
                    // Lokale Session-Daten setzen/aktualisieren
                    this.activeSessions.set(userId, {
                        sessionId: session.ID,
                        userId: userId,
                        startTime: session.StartTS,
                        lastActivity: new Date(),
                        sessionType: sessionTypeName
                    });

                    // Session-Timer starten
                    this.startSessionTimer(session.ID, userId);

                    // Rate Limit für neue Session initialisieren
                    this.qrScanRateLimit.set(session.ID, []);

                    // Zeitstempel normalisieren für konsistente Übertragung
                    const normalizedSession = {
                        ...session,
                        StartTS: this.normalizeTimestamp(session.StartTS),
                        SessionTypeName: sessionTypeName,
                        FallbackUsed: fallbackUsed
                    };

                    console.log(`Session erstellt für ${sessionTypeName}:`, normalizedSession);

                    if (fallbackUsed) {
                        console.warn(`⚠️ Fallback SessionType '${sessionTypeName}' verwendet`);
                    }

                    return normalizedSession;
                }

                return null;
            } catch (error) {
                console.error('Session Create Fehler:', error);
                return null;
            }
        });

        // ===== KORRIGIERTER SESSION-RESTART HANDLER =====
        ipcMain.handle('session-restart', async (event, sessionId, userId) => {
            try {
                console.log(`🔄 Session-Restart Request für Session ${sessionId}, User ${userId}`);

                // 1. Aktuelle Session beenden
                const endSuccess = await this.dbClient.endSession(sessionId);

                if (endSuccess) {
                    // 2. Lokale Session-Daten entfernen
                    this.activeSessions.delete(userId);
                    this.stopSessionTimer(sessionId);
                    this.qrScanRateLimit.delete(sessionId);

                    // 3. Neue Session erstellen
                    const { session, sessionTypeName, fallbackUsed } = await this.createSessionWithFallback(userId, null, false);

                    if (session) {
                        // 4. Lokale Session-Daten setzen
                        this.activeSessions.set(userId, {
                            sessionId: session.ID,
                            userId: userId,
                            startTime: new Date(session.StartTS),
                            lastActivity: new Date(),
                            sessionType: sessionTypeName
                        });

                        // 5. Session-Timer starten
                        this.startSessionTimer(session.ID, userId);
                        this.qrScanRateLimit.set(session.ID, []);

                        console.log(`✅ Session-Restart erfolgreich: Alte Session ${sessionId} → Neue Session ${session.ID}`);

                        // 6. Restart-Event senden
                        this.sendToRenderer('session-restarted', {
                            oldSessionId: sessionId,
                            newSessionId: session.ID,
                            userId: userId,
                            sessionType: sessionTypeName,
                            timestamp: new Date().toISOString()
                        });

                        return true;
                    }
                }

                return false;
            } catch (error) {
                console.error('Session-Restart Fehler:', error);
                return false;
            }
        });

        ipcMain.handle('session-end', async (event, sessionId, userId) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return false;
                }

                const success = await this.dbClient.endSession(sessionId);

                if (success) {
                    // Lokale Session-Daten entfernen
                    this.activeSessions.delete(userId);

                    // Session-Timer stoppen
                    this.stopSessionTimer(sessionId);

                    // Rate Limit für Session zurücksetzen
                    this.qrScanRateLimit.delete(sessionId);

                    console.log(`Session ${sessionId} für Benutzer ${userId} beendet`);
                }

                return success;
            } catch (error) {
                console.error('Session End Fehler:', error);
                return false;
            }
        });

        // ===== QR-CODE OPERATIONEN =====
        ipcMain.handle('qr-scan-save', async (event, sessionId, payload) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return {
                        success: false,
                        status: 'database_offline',
                        message: 'Datenbank nicht verbunden',
                        data: null,
                        timestamp: new Date().toISOString()
                    };
                }

                // Rate Limiting prüfen
                if (!this.checkQRScanRateLimit(sessionId)) {
                    return {
                        success: false,
                        status: 'rate_limit',
                        message: 'Zu viele QR-Scans pro Minute - bitte warten Sie',
                        data: null,
                        timestamp: new Date().toISOString()
                    };
                }

                // Payload bereinigen (BOM entfernen falls vorhanden)
                const cleanPayload = payload.replace(/^\ufeff/, '');

                // QR-Scan speichern
                const result = await this.dbClient.saveQRScan(sessionId, cleanPayload);

                // Rate Limit Counter aktualisieren bei erfolgreichen Scans
                if (result.success) {
                    this.updateQRScanRateLimit(sessionId);

                    // Dekodierung-Statistiken aktualisieren
                    await this.updateDecodingStats(result);

                    // Session-Aktivität aktualisieren
                    this.updateSessionActivity(sessionId);
                }

                console.log(`QR-Scan Ergebnis für Session ${sessionId}:`, {
                    success: result.success,
                    status: result.status,
                    message: result.message,
                    hasDecodedData: !!(result.data?.DecodedData)
                });

                return result;

            } catch (error) {
                console.error('QR Scan Save unerwarteter Fehler:', error);
                return {
                    success: false,
                    status: 'error',
                    message: `Unerwarteter Fehler: ${error.message}`,
                    data: null,
                    timestamp: new Date().toISOString()
                };
            }
        });

        // ===== QR-CODE DEKODIERUNG OPERATIONEN =====
        ipcMain.handle('qr-get-decoded-scans', async (event, sessionId, limit = 50) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return [];
                }

                const scans = await this.dbClient.getQRScansBySession(sessionId, limit);

                // Nur Scans mit dekodierten Daten zurückgeben
                return scans.filter(scan => scan.DecodedData && Object.keys(scan.DecodedData).length > 0);
            } catch (error) {
                console.error('Fehler beim Abrufen dekodierter QR-Scans:', error);
                return [];
            }
        });

        ipcMain.handle('qr-search-decoded', async (event, searchTerm, sessionId = null) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return [];
                }

                return await this.dbClient.searchQRScans(searchTerm, sessionId, 20);
            } catch (error) {
                console.error('Fehler bei dekodierter QR-Code-Suche:', error);
                return [];
            }
        });

        ipcMain.handle('qr-get-decoding-stats', async (event, sessionId = null) => {
            try {
                if (!this.dbClient || !this.systemStatus.database) {
                    return this.decodingStats;
                }

                const stats = await this.dbClient.getQRScanStats(sessionId);
                return {
                    ...this.decodingStats,
                    ...stats,
                    lastUpdated: new Date().toISOString()
                };
            } catch (error) {
                console.error('Fehler beim Abrufen der Dekodierung-Statistiken:', error);
                return this.decodingStats;
            }
        });

        // ===== SYSTEM STATUS =====
        ipcMain.handle('get-system-status', async (event) => {
            return {
                database: this.systemStatus.database,
                rfid: this.systemStatus.rfid,
                sessionTypesSetup: this.systemStatus.sessionTypesSetup,
                lastError: this.systemStatus.lastError,
                activeSessions: Array.from(this.activeSessions.values()),
                activeSessionCount: this.activeSessions.size,
                sessionTypePriority: this.sessionTypePriority,
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString(),
                qrScanStats: this.getQRScanStats(),
                decodingStats: this.decodingStats
            };
        });

        ipcMain.handle('get-system-info', async (event) => {
            return {
                version: app.getVersion() || '1.0.0',
                electronVersion: process.versions.electron,
                nodeVersion: process.versions.node,
                platform: process.platform,
                arch: process.arch,
                env: process.env.NODE_ENV || 'production',
                type: 'wareneinlagerung',
                features: {
                    qrDecoding: true,
                    parallelSessions: true,
                    sessionEnd: true,
                    sessionRestart: true, // Session-Restart als Session-Ende + Neue Session
                    sessionTypeFallback: true,
                    sessionTypesSetup: this.systemStatus.sessionTypesSetup,
                    decodingFormats: ['caret_separated', 'pattern_matching', 'structured_data'],
                    supportedFields: ['auftrags_nr', 'paket_nr', 'kunden_name']
                }
            };
        });

        // ===== RFID OPERATIONEN =====
        ipcMain.handle('rfid-get-status', async (event) => {
            return this.rfidListener ? this.rfidListener.getStatus() : {
                listening: false,
                type: 'not-available',
                message: 'RFID-Listener nicht verfügbar'
            };
        });

        ipcMain.handle('rfid-simulate-tag', async (event, tagId) => {
            try {
                if (!this.rfidListener) {
                    // Direkte Simulation wenn kein Listener verfügbar
                    console.log(`🧪 Direkte RFID-Simulation: ${tagId}`);
                    await this.handleRFIDScan(tagId);
                    return true;
                }
                return this.rfidListener.simulateTag(tagId);
            } catch (error) {
                console.error('RFID Simulate Fehler:', error);
                return false;
            }
        });

        // ===== APP STEUERUNG =====
        ipcMain.handle('app-minimize', () => {
            if (this.mainWindow) {
                this.mainWindow.minimize();
            }
        });

        ipcMain.handle('app-close', () => {
            app.quit();
        });

        ipcMain.handle('app-restart', () => {
            app.relaunch();
            app.exit();
        });
    }

    // ===== SESSION TIMER MANAGEMENT =====
    startSessionTimer(sessionId, userId) {
        // Bestehenden Timer stoppen falls vorhanden
        this.stopSessionTimer(sessionId);

        // Neuen Timer starten
        const timer = setInterval(() => {
            this.updateSessionTimer(sessionId, userId);
        }, 1000);

        this.activeSessionTimers.set(sessionId, timer);
        console.log(`Session-Timer gestartet für Session ${sessionId}`);
    }

    stopSessionTimer(sessionId) {
        const timer = this.activeSessionTimers.get(sessionId);
        if (timer) {
            clearInterval(timer);
            this.activeSessionTimers.delete(sessionId);
            console.log(`Session-Timer gestoppt für Session ${sessionId}`);
        }
    }

    updateSessionTimer(sessionId, userId) {
        const localSession = this.activeSessions.get(userId);
        if (localSession) {
            // Timer-Update an Frontend senden
            this.sendToRenderer('session-timer-update', {
                sessionId: sessionId,
                userId: userId,
                startTime: localSession.startTime,
                timestamp: new Date().toISOString()
            });
        }
    }

    updateSessionActivity(sessionId) {
        // Finde zugehörige Session und aktualisiere Aktivität
        for (const [userId, sessionData] of this.activeSessions.entries()) {
            if (sessionData.sessionId === sessionId) {
                sessionData.lastActivity = new Date();
                break;
            }
        }
    }

    // ===== KORRIGIERTE RFID-VERARBEITUNG: SESSION BEENDEN + NEUE SESSION =====
    async handleRFIDScan(tagId) {
        const now = Date.now();

        // Cooldown für RFID-Scans prüfen
        if (now - this.lastRFIDScanTime < this.rfidScanCooldown) {
            console.log(`🔄 RFID-Scan zu schnell, ignoriert: ${tagId} (${now - this.lastRFIDScanTime}ms < ${this.rfidScanCooldown}ms)`);
            return;
        }
        this.lastRFIDScanTime = now;

        console.log(`🏷️ RFID-Tag gescannt: ${tagId}`);

        try {
            if (!this.systemStatus.database) {
                throw new Error('Datenbank nicht verbunden - RFID-Scan kann nicht verarbeitet werden');
            }

            // Benutzer anhand EPC finden
            const user = await this.dbClient.getUserByEPC(tagId);

            if (!user) {
                this.sendToRenderer('rfid-scan-error', {
                    tagId,
                    message: `Unbekannter RFID-Tag: ${tagId}`,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            console.log(`👤 Benutzer gefunden: ${user.BenutzerName} (ID: ${user.ID})`);

            // Prüfen ob Benutzer bereits eine aktive Session hat
            const existingSession = this.activeSessions.get(user.ID);

            if (existingSession) {
                // ===== KORRIGIERTE LOGIK: SESSION BEENDEN + NEUE SESSION STARTEN =====
                console.log(`📝 Beende aktuelle Session für ${user.BenutzerName} (Session ${existingSession.sessionId})`);

                // 1. Aktuelle Session in Datenbank korrekt beenden
                const endResult = await this.dbClient.query(`
                    UPDATE Sessions
                    SET EndTS = SYSDATETIME(), Active = 0
                    WHERE ID = ? AND UserID = ? AND Active = 1
                `, [existingSession.sessionId, user.ID]);

                if (endResult && endResult.rowsAffected && endResult.rowsAffected[0] > 0) {
                    // 2. Arbeitszeit berechnen
                    const duration = Date.now() - existingSession.startTime.getTime();

                    // 3. Session-Timer stoppen
                    this.stopSessionTimer(existingSession.sessionId);

                    // 4. Session aus lokaler Verwaltung entfernen
                    this.activeSessions.delete(user.ID);

                    // 5. Rate Limit für Session zurücksetzen
                    this.qrScanRateLimit.delete(existingSession.sessionId);

                    // 6. Frontend über Session-Ende informieren
                    this.sendToRenderer('session-ended', {
                        user,
                        sessionId: existingSession.sessionId,
                        sessionType: existingSession.sessionType || 'Unbekannt',
                        endTime: new Date().toISOString(),
                        duration: duration,
                        source: 'rfid_scan',
                        durationFormatted: this.formatDuration(duration)
                    });

                    console.log(`✅ Session ${existingSession.sessionId} erfolgreich beendet (Dauer: ${Math.round(duration / 1000)}s)`);

                    // 7. Sofort neue Session erstellen
                    await this.createNewSessionForUser(user);
                } else {
                    console.error('❌ Fehler beim Beenden der Session - keine Zeilen betroffen');
                    this.sendToRenderer('rfid-scan-error', {
                        tagId,
                        message: 'Fehler beim Beenden der aktuellen Session',
                        timestamp: new Date().toISOString()
                    });
                }

            } else {
                // ===== ERSTE ANMELDUNG: NEUE SESSION ERSTELLEN =====
                console.log(`🔑 Erste Anmeldung für ${user.BenutzerName}...`);
                await this.createNewSessionForUser(user);
            }

        } catch (error) {
            console.error('RFID-Verarbeitung Fehler:', error);
            this.sendToRenderer('rfid-scan-error', {
                tagId,
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // ===== KORRIGIERTE HILFSFUNKTION: SESSION ERSTELLEN OHNE BESTEHENDE ZU BEENDEN =====
    async createNewSessionForUser(user) {
        try {
            console.log(`🆕 Erstelle neue Session für ${user.BenutzerName}...`);

            // ===== KRITISCH: closeExistingSessions = false =====
            // Da wir die Session bereits manuell beendet haben
            const { session, sessionTypeName, fallbackUsed } = await this.createSessionWithFallback(
                user.ID,
                null,           // sessionTypePriority default
                false           // closeExistingSessions = false !!!
            );

            if (session) {
                // Lokale Session-Daten setzen
                this.activeSessions.set(user.ID, {
                    sessionId: session.ID,
                    userId: user.ID,
                    startTime: new Date(session.StartTS),
                    lastActivity: new Date(),
                    sessionType: sessionTypeName
                });

                // Session-Timer starten (beginnt bei 0)
                this.startSessionTimer(session.ID, user.ID);

                // Rate Limit für neue Session initialisieren
                this.qrScanRateLimit.set(session.ID, []);

                // Session-Daten mit normalisiertem Zeitstempel senden
                const normalizedSession = {
                    ...session,
                    StartTS: this.normalizeTimestamp(session.StartTS)
                };

                // Login-Event senden
                this.sendToRenderer('user-login', {
                    user,
                    session: normalizedSession,
                    sessionType: sessionTypeName,
                    fallbackUsed: fallbackUsed,
                    timestamp: new Date().toISOString(),
                    source: 'rfid_scan',
                    isNewSession: true
                });

                console.log(`✅ Neue Session erstellt für ${user.BenutzerName} (Session ${session.ID}, Type: ${sessionTypeName})`);

                if (fallbackUsed) {
                    console.warn(`⚠️ Fallback SessionType '${sessionTypeName}' verwendet`);

                    // Warnung an Renderer senden
                    this.sendToRenderer('session-fallback-warning', {
                        user,
                        sessionType: sessionTypeName,
                        primaryType: this.sessionTypePriority[0],
                        message: `Fallback SessionType '${sessionTypeName}' verwendet`,
                        timestamp: new Date().toISOString()
                    });
                }

            } else {
                throw new Error('Session konnte nicht erstellt werden');
            }

        } catch (error) {
            console.error('Neue Session Fehler:', error);
            this.sendToRenderer('rfid-scan-error', {
                tagId: 'unknown',
                message: `Fehler beim Erstellen einer neuen Session: ${error.message}`,
                timestamp: new Date().toISOString()
            });
        }
    }

    // ===== HILFSFUNKTION: DAUER FORMATIEREN =====
    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    // ===== QR-CODE DEKODIERUNG STATISTIKEN =====
    async updateDecodingStats(scanResult) {
        try {
            if (!scanResult.success || !scanResult.data) return;

            this.decodingStats.totalScans++;

            const decodedData = scanResult.data.DecodedData;
            if (decodedData) {
                this.decodingStats.successfulDecodes++;

                if (decodedData.auftrags_nr && decodedData.auftrags_nr.trim()) {
                    this.decodingStats.withAuftrag++;
                }

                if (decodedData.paket_nr && decodedData.paket_nr.trim()) {
                    this.decodingStats.withPaket++;
                }

                if (decodedData.kunden_name && decodedData.kunden_name.trim()) {
                    this.decodingStats.withKunde++;
                }

                // Success Rate berechnen
                this.decodingStats.decodingSuccessRate = Math.round(
                    (this.decodingStats.successfulDecodes / this.decodingStats.totalScans) * 100
                );

                console.log(`📊 Dekodierung-Statistiken aktualisiert:`, {
                    total: this.decodingStats.totalScans,
                    decoded: this.decodingStats.successfulDecodes,
                    rate: this.decodingStats.decodingSuccessRate + '%',
                    auftrag: this.decodingStats.withAuftrag,
                    paket: this.decodingStats.withPaket,
                    kunde: this.decodingStats.withKunde
                });

                // Statistiken an Renderer senden
                this.sendToRenderer('decoding-stats-updated', {
                    stats: this.decodingStats,
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Fehler beim Aktualisieren der Dekodierung-Statistiken:', error);
        }
    }

    // ===== ZEITSTEMPEL NORMALISIERUNG =====
    normalizeTimestamp(timestamp) {
        try {
            let date;

            if (timestamp instanceof Date) {
                date = timestamp;
            } else if (typeof timestamp === 'string') {
                date = new Date(timestamp);
            } else {
                date = new Date(timestamp);
            }

            // Prüfe auf gültiges Datum
            if (isNaN(date.getTime())) {
                console.warn('Ungültiger Zeitstempel für Normalisierung:', timestamp);
                date = new Date(); // Fallback auf aktuelle Zeit
            }

            // ISO-String für konsistente Übertragung
            return date.toISOString();

        } catch (error) {
            console.error('Fehler bei Zeitstempel-Normalisierung:', error, timestamp);
            return new Date().toISOString(); // Fallback
        }
    }

    // ===== QR-SCAN RATE LIMITING =====
    checkQRScanRateLimit(sessionId) {
        const now = Date.now();
        const oneMinute = 60 * 1000;

        if (!this.qrScanRateLimit.has(sessionId)) {
            this.qrScanRateLimit.set(sessionId, []);
        }

        const scanTimes = this.qrScanRateLimit.get(sessionId);

        // Entferne Scans älter als 1 Minute
        const recentScans = scanTimes.filter(time => now - time < oneMinute);
        this.qrScanRateLimit.set(sessionId, recentScans);

        // Prüfe Limit
        return recentScans.length < this.maxQRScansPerMinute;
    }

    updateQRScanRateLimit(sessionId) {
        const now = Date.now();

        if (!this.qrScanRateLimit.has(sessionId)) {
            this.qrScanRateLimit.set(sessionId, []);
        }

        const scanTimes = this.qrScanRateLimit.get(sessionId);
        scanTimes.push(now);

        // Halte nur die letzten Scans
        if (scanTimes.length > this.maxQRScansPerMinute) {
            scanTimes.shift();
        }
    }

    getQRScanStats() {
        const stats = {};
        const now = Date.now();
        const oneMinute = 60 * 1000;

        for (const [sessionId, scanTimes] of this.qrScanRateLimit.entries()) {
            const recentScans = scanTimes.filter(time => now - time < oneMinute);
            stats[sessionId] = {
                scansPerMinute: recentScans.length,
                lastScan: scanTimes.length > 0 ? Math.max(...scanTimes) : null
            };
        }

        return stats;
    }

    // ===== COMMUNICATION =====
    sendToRenderer(channel, data) {
        if (this.mainWindow && this.mainWindow.webContents) {
            this.mainWindow.webContents.send(channel, data);
        }
    }

    sendSystemStatus() {
        this.sendToRenderer('system-ready', {
            database: this.systemStatus.database,
            rfid: this.systemStatus.rfid,
            sessionTypesSetup: this.systemStatus.sessionTypesSetup,
            sessionTypePriority: this.sessionTypePriority,
            lastError: this.systemStatus.lastError,
            timestamp: new Date().toISOString(),
            decodingStats: this.decodingStats,
            activeSessionCount: this.activeSessions.size
        });
    }

    // ===== CLEANUP =====
    async cleanup() {
        console.log('🧹 Anwendung wird bereinigt...');

        try {
            // Alle Session-Timer stoppen
            for (const sessionId of this.activeSessionTimers.keys()) {
                this.stopSessionTimer(sessionId);
            }

            // Alle aktiven Sessions beenden
            for (const [userId, sessionData] of this.activeSessions.entries()) {
                try {
                    await this.dbClient.endSession(sessionData.sessionId);
                    console.log(`Session ${sessionData.sessionId} für Benutzer ${userId} beendet`);
                } catch (error) {
                    console.error(`Fehler beim Beenden der Session ${sessionData.sessionId}:`, error);
                }
            }

            // Lokale Daten zurücksetzen
            this.activeSessions.clear();
            this.activeSessionTimers.clear();
            this.qrScanRateLimit.clear();

            // Dekodierung-Statistiken zurücksetzen
            this.decodingStats = {
                totalScans: 0,
                successfulDecodes: 0,
                withAuftrag: 0,
                withPaket: 0,
                withKunde: 0
            };

            // RFID-Listener stoppen
            if (this.rfidListener) {
                await this.rfidListener.stop();
                this.rfidListener = null;
            }

            // Alle globalen Shortcuts entfernen
            globalShortcut.unregisterAll();

            // Datenbankverbindung schließen
            if (this.dbClient) {
                await this.dbClient.close();
                this.dbClient = null;
            }

            console.log('✅ Cleanup abgeschlossen');

        } catch (error) {
            console.error('❌ Cleanup-Fehler:', error);
        }
    }

    // ===== ERROR HANDLING =====
    handleGlobalError(error) {
        console.error('Globaler Anwendungsfehler:', error);

        this.sendToRenderer('system-error', {
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// ===== ERROR HANDLING =====
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);

    // Versuche die App sauber zu beenden
    if (app) {
        app.quit();
    } else {
        process.exit(1);
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// ===== APP INSTANCE =====
const wareneinlagerungApp = new WareneinlagerungMainApp();

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        // Someone tried to run a second instance, focus our window instead
        if (wareneinlagerungApp.mainWindow) {
            if (wareneinlagerungApp.mainWindow.isMinimized()) {
                wareneinlagerungApp.mainWindow.restore();
            }
            wareneinlagerungApp.mainWindow.focus();
        }
    });
}
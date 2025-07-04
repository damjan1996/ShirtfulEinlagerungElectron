/**
 * Modular Database Client für Wareneinlagerung mit Qualitätskontrolle
 * Composition of specialized database modules for better maintainability
 * Angepasst für parallele Sessions und RFID-Session-Restart-Logik
 * VOLLSTÄNDIG KORRIGIERT für SessionTypes Setup und Wareneinlagerung
 * ERWEITERT für Qualitätskontrolle (QC) mit doppelten QR-Scans
 *
 * This version supports multiple parallel sessions, RFID session restart functionality,
 * and Quality Control workflow with double QR scanning (Entry/Exit).
 */

// ===== CORE IMPORTS =====
const DatabaseConnection = require('./core/db-connection');
const DatabaseUtils = require('./utils/db-utils');

// ===== MODULE IMPORTS =====
const UserModule = require('./modules/db-users');
const SessionModule = require('./modules/db-sessions');
const QRScanModule = require('./modules/db-qrscans');
const StatsModule = require('./modules/db-stats');

// ===== SPECIALIZED IMPORTS =====
const HealthModule = require('./health/db-health');
const SessionTypeConstants = require('./constants/session-types');

/**
 * Enhanced Database Client with Modular Architecture für Wareneinlagerung + Quality Control
 *
 * Supports multiple parallel sessions, RFID session restart functionality,
 * and Quality Control workflow with automatic session reset after QC completion.
 * KORRIGIERT für automatisches SessionTypes Setup
 * ERWEITERT für QC-Funktionalität
 */
class DatabaseClient {
    constructor() {
        // ===== CORE COMPONENTS =====
        this.connection = new DatabaseConnection();
        this.utils = new DatabaseUtils();

        // ===== SPECIALIZED MODULES (werden nach connect() initialisiert) =====
        this.users = null;
        this.sessions = null;
        this.qrscans = null;
        this.stats = null;
        this.health = null;

        // ===== WARENEINLAGERUNG-SPEZIFISCHE KONFIGURATION =====
        this.multiSessionMode = true; // Aktiviert parallele Sessions
        this.allowSessionRestart = true; // Erlaubt RFID-Session-Restart
        this.sessionTypesInitialized = false; // Tracking für SessionTypes Setup

        // ===== QUALITÄTSKONTROLLE KONFIGURATION =====
        this.qualityControlEnabled = true; // QC-Funktionen aktiviert
        this.autoSessionResetAfterQC = true; // Session automatisch nach QC beenden
        this.allowParallelQC = true; // Mehrere QC-Schritte parallel pro Session
        this.qcDefaultEstimatedMinutes = 15; // Standard-Bearbeitungszeit
        this.qcOverdueThresholdMinutes = 30; // Überfällig-Schwellwert

        // ===== QC-TRACKING =====
        this.activeQCSteps = new Map(); // qrCode -> QC-Step-Daten
        this.qcSessionMapping = new Map(); // sessionId -> Set von QR-Codes in QC
        this.qcStatistics = {
            totalQCSteps: 0,
            completedQCSteps: 0,
            averageDurationMinutes: 0,
            qualityRating: 0,
            defectRate: 0
        };

        // ===== BACKWARDS COMPATIBILITY PROPERTIES =====
        // Expose connection properties for compatibility
        Object.defineProperty(this, 'pool', {
            get: () => this.connection.pool
        });

        Object.defineProperty(this, 'isConnected', {
            get: () => this.connection.isConnected
        });

        Object.defineProperty(this, 'config', {
            get: () => this.connection.config
        });

        // Expose utils properties for compatibility
        Object.defineProperty(this, 'duplicateCache', {
            get: () => this.utils.duplicateCache
        });

        Object.defineProperty(this, 'pendingScans', {
            get: () => this.utils.pendingScans
        });
    }

    // ===== CORE CONNECTION METHODS (DELEGATED) =====

    async connect() {
        const connectionResult = await this.connection.connect();

        if (connectionResult) {
            // Module nach erfolgreicher Verbindung initialisieren
            this.users = new UserModule(this.connection, this.utils);
            this.sessions = new SessionModule(this.connection, this.utils);
            this.qrscans = new QRScanModule(this.connection, this.utils);
            this.stats = new StatsModule(this.connection, this.utils);
            this.health = new HealthModule(this.connection, this.utils);

            console.log('✅ DatabaseClient Module initialisiert');

            // SessionTypes automatisch initialisieren
            await this.initializeSessionTypes();

            // QC-System initialisieren
            await this.initializeQualityControl();
        }

        return connectionResult;
    }

    /**
     * NEUE METHODE: SessionTypes automatisch initialisieren
     * Wird automatisch beim connect() aufgerufen
     */
    async initializeSessionTypes() {
        try {
            console.log('🔧 Initialisiere SessionTypes...');

            const success = await SessionTypeConstants.setupSessionTypes(this.connection);

            if (success) {
                this.sessionTypesInitialized = true;
                console.log('✅ SessionTypes erfolgreich initialisiert');

                // Verfügbare SessionTypes loggen
                const types = await this.getSessionTypes();
                console.log(`📋 Verfügbare SessionTypes (${types.length}):`);
                types.forEach(type => {
                    console.log(`   - ${type.TypeName}: ${type.Description}`);
                });
            } else {
                this.sessionTypesInitialized = false;
                console.warn('⚠️ SessionTypes Setup fehlgeschlagen - System läuft eingeschränkt');
            }

        } catch (error) {
            this.sessionTypesInitialized = false;
            console.error('❌ Fehler beim SessionTypes Setup:', error);
            console.warn('⚠️ System startet ohne vollständige SessionTypes');
        }
    }

    /**
     * NEUE METHODE: Qualitätskontrolle-System initialisieren
     * Prüft QC-Tabellen und lädt Statistiken
     */
    async initializeQualityControl() {
        try {
            console.log('🔍 Initialisiere Qualitätskontrolle-System...');

            // Prüfe ob QC-Tabellen existieren
            const qcTablesExist = await this.validateQCTables();

            if (qcTablesExist) {
                this.qualityControlEnabled = true;
                console.log('✅ Qualitätskontrolle-Tabellen gefunden');

                // QC-Statistiken laden
                await this.loadQCStatistics();

                // Aktive QC-Schritte laden
                await this.loadActiveQCSteps();

                console.log('✅ Qualitätskontrolle-System erfolgreich initialisiert');
            } else {
                this.qualityControlEnabled = false;
                console.warn('⚠️ Qualitätskontrolle-Tabellen nicht gefunden - QC-Features deaktiviert');
                console.log('💡 Führen Sie sql/quality-control-schema.sql aus, um QC zu aktivieren');
            }

        } catch (error) {
            this.qualityControlEnabled = false;
            console.error('❌ Fehler beim QC-System Setup:', error);
            console.warn('⚠️ Qualitätskontrolle-Features deaktiviert');
        }
    }

    async close() {
        // Cleanup utils first
        this.utils.cleanup();

        // QC-Tracking bereinigen
        this.activeQCSteps.clear();
        this.qcSessionMapping.clear();

        // Then close connection
        return await this.connection.close();
    }

    async query(queryString, parameters = []) {
        return await this.connection.query(queryString, parameters);
    }

    async transaction(callback) {
        return await this.connection.transaction(callback);
    }

    async validateTables() {
        const baseValidation = await this.connection.validateTables();

        if (this.qualityControlEnabled) {
            const qcValidation = await this.validateQCTables();
            return baseValidation && qcValidation;
        }

        return baseValidation;
    }

    // ===== USER OPERATIONS (DELEGATED) =====

    async getUserByEPC(epcHex) {
        if (!this.users) throw new Error('DatabaseClient nicht verbunden');
        return await this.users.getUserByEPC(epcHex);
    }

    async getUserById(userId) {
        if (!this.users) throw new Error('DatabaseClient nicht verbunden');
        return await this.users.getUserById(userId);
    }

    async getAllActiveUsers() {
        if (!this.users) throw new Error('DatabaseClient nicht verbunden');
        return await this.users.getAllActiveUsers();
    }

    async searchUsers(searchTerm) {
        if (!this.users) throw new Error('DatabaseClient nicht verbunden');
        return await this.users.searchUsers(searchTerm);
    }

    async getUserStats(userId) {
        if (!this.users) throw new Error('DatabaseClient nicht verbunden');
        return await this.users.getUserStats(userId);
    }

    async validateUser(userId) {
        if (!this.users) throw new Error('DatabaseClient nicht verbunden');
        return await this.users.validateUser(userId);
    }

    async getUserActivity(userId, limit = 50) {
        if (!this.users) throw new Error('DatabaseClient nicht verbunden');
        return await this.users.getUserActivity(userId, limit);
    }

    // ===== SESSION OPERATIONS (DELEGATED & ERWEITERT) =====

    /**
     * Erstellt eine neue Session für Wareneinlagerung
     * @param {number} userId - Benutzer ID
     * @param {string} sessionType - Session-Typ (default: 'Wareneinlagerung')
     * @returns {Object} - Session-Daten
     */
    async createSession(userId, sessionType = 'Wareneinlagerung') {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');

        // Prüfe ob SessionTypes initialisiert sind
        if (!this.sessionTypesInitialized) {
            console.warn('⚠️ SessionTypes nicht initialisiert - versuche erneut...');
            await this.initializeSessionTypes();

            if (!this.sessionTypesInitialized) {
                throw new Error('SessionTypes nicht verfügbar - kann keine Session erstellen');
            }
        }

        const session = await this.sessions.createSession(userId, sessionType);

        // QC-Session-Mapping initialisieren
        if (session && this.qualityControlEnabled) {
            this.qcSessionMapping.set(session.ID, new Set());
        }

        return session;
    }

    /**
     * WARENEINLAGERUNG-SPEZIFISCH: Session für Benutzer neu starten
     * Setzt die StartTime auf aktuelle Zeit zurück, ohne die Session zu beenden
     * @param {number} sessionId - Session ID
     * @param {number} userId - Benutzer ID (für Validierung)
     * @returns {Object} - Aktualisierte Session-Daten
     */
    async restartSession(sessionId, userId = null) {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');

        try {
            let result;

            if (userId) {
                // Mit Benutzer-Validierung
                result = await this.sessions.restartSession(sessionId, userId);
            } else {
                // Ohne Benutzer-Validierung (legacy support)
                const updateResult = await this.query(`
                    UPDATE Sessions 
                    SET StartTS = GETDATE()
                    OUTPUT INSERTED.ID, INSERTED.UserID, INSERTED.StartTS, INSERTED.Active
                    WHERE ID = ? AND Active = 1
                `, [sessionId]);

                if (updateResult.recordset.length === 0) {
                    throw new Error(`Session ${sessionId} nicht gefunden oder nicht aktiv`);
                }

                const updatedSession = updateResult.recordset[0];
                console.log(`✅ Session ${sessionId} neu gestartet`);

                result = {
                    ID: updatedSession.ID,
                    UserID: updatedSession.UserID,
                    StartTS: this.utils.normalizeTimestamp(updatedSession.StartTS),
                    Active: updatedSession.Active,
                    restarted: true
                };
            }

            // QC-Schritte für diese Session zurücksetzen bei Session-Restart
            if (this.qualityControlEnabled && result) {
                await this.resetQCStepsForSession(sessionId, 'Session-Restart');
            }

            return result;

        } catch (error) {
            console.error('Fehler beim Neustarten der Session:', error);
            throw error;
        }
    }

    /**
     * WARENEINLAGERUNG-SPEZIFISCH: Prüft ob Benutzer bereits aktive Session hat
     * @param {number} userId - Benutzer ID
     * @returns {Object|null} - Aktive Session oder null
     */
    async getActiveSessionByUserId(userId) {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');
        return await this.sessions.getActiveSessionByUserId(userId);
    }

    /**
     * WARENEINLAGERUNG-SPEZIFISCH: Alle aktiven Sessions abrufen
     * @returns {Array} - Array aller aktiven Sessions
     */
    async getActiveSessions() {
        try {
            const result = await this.query(`
                SELECT s.ID, s.UserID, s.StartTS, s.EndTS, s.Active,
                       u.BenutzerName as UserName, u.Department,
                       COUNT(qr.ID) as ScanCount,
                       ${this.qualityControlEnabled ? 'qc.ActiveQCSteps,' : '0 as ActiveQCSteps,'}
                       ${this.qualityControlEnabled ? 'qc.CompletedQCSteps' : '0 as CompletedQCSteps'}
                FROM Sessions s
                         INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                         LEFT JOIN QrScans qr ON s.ID = qr.SessionID
                         ${this.qualityControlEnabled ? `LEFT JOIN (
                             SELECT SessionID,
                                    SUM(CASE WHEN QCStatus = 'active' AND Completed = 0 THEN 1 ELSE 0 END) as ActiveQCSteps,
                                    SUM(CASE WHEN Completed = 1 THEN 1 ELSE 0 END) as CompletedQCSteps
                             FROM QualityControlSteps
                             GROUP BY SessionID
                         ) qc ON s.ID = qc.SessionID` : ''}
                WHERE s.Active = 1
                GROUP BY s.ID, s.UserID, s.StartTS, s.EndTS, s.Active, u.BenutzerName, u.Department
                         ${this.qualityControlEnabled ? ', qc.ActiveQCSteps, qc.CompletedQCSteps' : ''}
                ORDER BY s.StartTS ASC
            `);

            return result.recordset.map(session => ({
                ID: session.ID,
                UserID: session.UserID,
                UserName: session.UserName,
                Department: session.Department,
                StartTS: this.utils.normalizeTimestamp(session.StartTS),
                EndTS: session.EndTS ? this.utils.normalizeTimestamp(session.EndTS) : null,
                Active: session.Active,
                ScanCount: session.ScanCount || 0,
                ActiveQCSteps: session.ActiveQCSteps || 0,
                CompletedQCSteps: session.CompletedQCSteps || 0
            }));

        } catch (error) {
            console.error('Fehler beim Abrufen aktiver Sessions:', error);
            throw error;
        }
    }

    async getSessionWithType(sessionId) {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');
        return await this.sessions.getSessionWithType(sessionId);
    }

    async getActiveSessionsWithType() {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');
        return await this.sessions.getActiveSessionsWithType();
    }

    async endSession(sessionId) {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');

        // Aktive QC-Schritte für diese Session abbrechen
        if (this.qualityControlEnabled) {
            await this.abortActiveQCStepsForSession(sessionId, 'Session beendet');
        }

        return await this.sessions.endSession(sessionId);
    }

    /**
     * ANGEPASST FÜR WARENEINLAGERUNG: Beendet ALLE aktiven Sessions (nur für Notfälle)
     * Im normalen Wareneinlagerung-Betrieb sollte dies NICHT verwendet werden
     * @returns {Object} - Erfolg, Anzahl beendeter Sessions und betroffene Benutzer
     */
    async endAllActiveSessions() {
        console.warn('⚠️ WARNUNG: endAllActiveSessions() aufgerufen in Wareneinlagerung-Modus!');
        console.warn('⚠️ Dies sollte nur in Notfällen verwendet werden, da Wareneinlagerung parallele Sessions unterstützt.');

        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');

        // Alle aktiven QC-Schritte abbrechen
        if (this.qualityControlEnabled) {
            await this.abortAllActiveQCSteps('Alle Sessions beendet');
        }

        return await this.sessions.endAllActiveSessions();
    }

    async getActiveSession(userId) {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');
        return await this.sessions.getActiveSession(userId);
    }

    async getSessionDuration(sessionId) {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');
        return await this.sessions.getSessionDuration(sessionId);
    }

    async getSessionTypes() {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');
        return await this.sessions.getSessionTypes();
    }

    async getSessionTypeStats(startDate = null, endDate = null) {
        if (!this.sessions) throw new Error('DatabaseClient nicht verbunden');
        return await this.sessions.getSessionTypeStats(startDate, endDate);
    }

    // ===== QR-SCAN OPERATIONS (DELEGATED & ERWEITERT FÜR QC) =====

    /**
     * ERWEITERT FÜR QC: QR-Code scannen mit automatischer QC-Verarbeitung
     * @param {number} sessionId - Session ID
     * @param {string} payload - QR-Code Payload
     * @returns {Object} - Scan-Ergebnis mit QC-Information
     */
    async saveQRScan(sessionId, payload) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');

        try {
            // Normaler QR-Scan speichern
            const scanResult = await this.qrscans.saveQRScan(sessionId, payload);

            // Wenn QC aktiviert und Scan erfolgreich, QC-Workflow prüfen
            if (this.qualityControlEnabled && scanResult.success && scanResult.data) {
                const qcResult = await this.processQCWorkflow(sessionId, payload, scanResult.data.ID);

                // QC-Informationen zum Scan-Ergebnis hinzufügen
                scanResult.qualityControl = qcResult;

                // QC-spezifische Nachrichten
                if (qcResult.action === 'qc_started') {
                    scanResult.message = `QC gestartet: ${scanResult.message}`;
                    scanResult.qcMessage = 'Qualitätsprüfung begonnen - scannen Sie den gleichen QR-Code erneut zum Abschließen';
                } else if (qcResult.action === 'qc_completed') {
                    scanResult.message = `QC abgeschlossen: ${scanResult.message}`;
                    scanResult.qcMessage = `Qualitätsprüfung abgeschlossen (${qcResult.durationMinutes} Min)`;

                    // Session automatisch beenden wenn konfiguriert
                    if (this.autoSessionResetAfterQC && qcResult.autoSessionReset) {
                        scanResult.sessionReset = true;
                        scanResult.qcMessage += ' - Session wird automatisch beendet';
                    }
                } else if (qcResult.action === 'qc_continued') {
                    scanResult.qcMessage = `QC läuft weiter (${qcResult.minutesInProgress} Min in Bearbeitung)`;
                }
            }

            return scanResult;

        } catch (error) {
            console.error('Fehler beim QR-Scan mit QC-Verarbeitung:', error);
            throw error;
        }
    }

    async getQRScansBySession(sessionId, limit = 50) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.getQRScansBySession(sessionId, limit);
    }

    async getQRScanById(scanId) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.getQRScanById(scanId);
    }

    async getRecentQRScans(limit = 20) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.getRecentQRScans(limit);
    }

    async getQrScansWithSessionType(sessionId = null, sessionTypeName = null) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.getQrScansWithSessionType(sessionId, sessionTypeName);
    }

    async getQRScanStats(sessionId = null) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.getQRScanStats(sessionId);
    }

    async searchQRScans(searchTerm, sessionId = null, limit = 20) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.searchQRScans(searchTerm, sessionId, limit);
    }

    async checkQRDuplicate(payload, timeWindowHours = 0.17) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.checkQRDuplicate(payload, timeWindowHours);
    }

    async checkForDuplicates(rawPayload, sessionId, minutesBack = 10) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.checkForDuplicates(rawPayload, sessionId, minutesBack);
    }

    // Alias for backwards compatibility
    async getSessionScans(sessionId, limit = 50) {
        return await this.getQRScansBySession(sessionId, limit);
    }

    // Legacy alias
    async getQRScansForSession(sessionId, limit = 50) {
        return await this.getQRScansBySession(sessionId, limit);
    }

    // ===== QUALITÄTSKONTROLLE (QC) OPERATIONS =====

    /**
     * Validiert QC-Tabellen in der Datenbank
     * @returns {boolean} - True wenn alle QC-Tabellen vorhanden sind
     */
    async validateQCTables() {
        try {
            const result = await this.query(`
                SELECT COUNT(*) as TableCount
                FROM INFORMATION_SCHEMA.TABLES 
                WHERE TABLE_NAME IN ('QualityControlSteps', 'QCStations', 'QCCategories')
            `);

            const tableCount = result.recordset[0]?.TableCount || 0;
            return tableCount === 3;

        } catch (error) {
            console.error('Fehler bei QC-Tabellen-Validierung:', error);
            return false;
        }
    }

    /**
     * QC-Workflow verarbeiten: Entscheidet ob QC startet oder beendet wird
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code Payload
     * @param {number} scanId - ID des gespeicherten QR-Scans
     * @returns {Object} - QC-Workflow Ergebnis
     */
    async processQCWorkflow(sessionId, qrCode, scanId) {
        try {
            // Prüfe ob bereits ein aktiver QC-Schritt für diesen QR-Code existiert
            const existingQCStep = await this.getActiveQCStepByQRCode(qrCode);

            if (existingQCStep) {
                // ZWEITER SCAN: QC-Schritt abschließen
                const result = await this.completeQualityControlStep(
                    qrCode,
                    scanId,
                    existingQCStep.CreatedByUserID
                );

                // Session automatisch beenden nach QC-Abschluss
                let autoSessionReset = false;
                if (this.autoSessionResetAfterQC && result.success) {
                    try {
                        await this.endSession(sessionId);
                        autoSessionReset = true;
                        console.log(`🔄 Session ${sessionId} automatisch nach QC-Abschluss beendet`);
                    } catch (error) {
                        console.error('Fehler beim automatischen Session-Reset:', error);
                    }
                }

                return {
                    action: 'qc_completed',
                    qcStepId: result.qcStepId,
                    durationMinutes: result.durationMinutes,
                    autoSessionReset: autoSessionReset,
                    success: result.success,
                    message: result.message
                };

            } else {
                // ERSTER SCAN: QC-Schritt starten
                const session = await this.getSessionWithType(sessionId);
                const userId = session?.UserID;

                const result = await this.startQualityControlStep(
                    sessionId,
                    qrCode,
                    scanId,
                    1, // Normal priority
                    this.qcDefaultEstimatedMinutes,
                    null, // ProcessingLocation
                    userId
                );

                return {
                    action: 'qc_started',
                    qcStepId: result.qcStepId,
                    estimatedMinutes: this.qcDefaultEstimatedMinutes,
                    success: result.success,
                    message: result.message
                };
            }

        } catch (error) {
            console.error('Fehler im QC-Workflow:', error);
            return {
                action: 'qc_error',
                success: false,
                message: `QC-Workflow Fehler: ${error.message}`
            };
        }
    }

    /**
     * QC-Schritt starten (erster QR-Code Scan)
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} startScanId - ID des Start-Scans
     * @param {number} priority - Priorität (1-3)
     * @param {number} estimatedMinutes - Geschätzte Bearbeitungszeit
     * @param {string} processingLocation - Bearbeitungsort
     * @param {number} createdByUserId - Benutzer ID
     * @returns {Object} - Ergebnis
     */
    async startQualityControlStep(sessionId, qrCode, startScanId, priority = 1, estimatedMinutes = null, processingLocation = null, createdByUserId = null) {
        try {
            const result = await this.query(`
                EXEC SP_StartQualityControlStep 
                    @SessionID = ?, 
                    @QrCode = ?, 
                    @StartScanID = ?, 
                    @Priority = ?, 
                    @EstimatedMinutes = ?, 
                    @ProcessingLocation = ?, 
                    @CreatedByUserID = ?
            `, [sessionId, qrCode, startScanId, priority, estimatedMinutes, processingLocation, createdByUserId]);

            // QC-Step ID aus dem Output-Parameter extrahieren (vereinfacht für Node.js)
            const qcStepId = await this.getLatestQCStepId(qrCode);

            // Lokales Tracking aktualisieren
            this.activeQCSteps.set(qrCode, {
                id: qcStepId,
                sessionId: sessionId,
                startTime: new Date(),
                priority: priority,
                estimatedMinutes: estimatedMinutes
            });

            // Session-Mapping aktualisieren
            const sessionQRCodes = this.qcSessionMapping.get(sessionId) || new Set();
            sessionQRCodes.add(qrCode);
            this.qcSessionMapping.set(sessionId, sessionQRCodes);

            console.log(`🔍 QC-Schritt gestartet: QR=${qrCode}, Session=${sessionId}, ID=${qcStepId}`);

            return {
                success: true,
                qcStepId: qcStepId,
                message: 'Qualitätsprüfung gestartet'
            };

        } catch (error) {
            console.error('Fehler beim QC-Schritt starten:', error);
            return {
                success: false,
                qcStepId: null,
                message: `Fehler beim QC-Start: ${error.message}`
            };
        }
    }

    /**
     * QC-Schritt abschließen (zweiter QR-Code Scan)
     * @param {string} qrCode - QR-Code
     * @param {number} endScanId - ID des End-Scans
     * @param {number} completedByUserId - Benutzer ID
     * @param {number} qualityRating - Qualitätsbewertung (1-5)
     * @param {string} qualityNotes - Qualitätsnotizen
     * @param {boolean} defectsFound - Mängel gefunden
     * @param {string} defectDescription - Mängel-Beschreibung
     * @param {boolean} reworkRequired - Nacharbeit erforderlich
     * @returns {Object} - Ergebnis
     */
    async completeQualityControlStep(qrCode, endScanId, completedByUserId = null, qualityRating = null, qualityNotes = null, defectsFound = false, defectDescription = null, reworkRequired = false) {
        try {
            const result = await this.query(`
                EXEC SP_CompleteQualityControlStep 
                    @QrCode = ?, 
                    @EndScanID = ?, 
                    @CompletedByUserID = ?, 
                    @QualityRating = ?, 
                    @QualityNotes = ?, 
                    @DefectsFound = ?, 
                    @DefectDescription = ?, 
                    @ReworkRequired = ?
            `, [qrCode, endScanId, completedByUserId, qualityRating, qualityNotes, defectsFound, defectDescription, reworkRequired]);

            // QC-Step und Session IDs extrahieren
            const qcStepInfo = await this.getQCStepByQRCode(qrCode);
            const qcStepId = qcStepInfo?.ID;
            const sessionId = qcStepInfo?.SessionID;

            // Dauer berechnen
            const localQCStep = this.activeQCSteps.get(qrCode);
            const durationMinutes = localQCStep ?
                Math.round((new Date() - localQCStep.startTime) / (1000 * 60)) : 0;

            // Lokales Tracking bereinigen
            this.activeQCSteps.delete(qrCode);

            if (sessionId) {
                const sessionQRCodes = this.qcSessionMapping.get(sessionId);
                if (sessionQRCodes) {
                    sessionQRCodes.delete(qrCode);
                    if (sessionQRCodes.size === 0) {
                        this.qcSessionMapping.delete(sessionId);
                    }
                }
            }

            console.log(`✅ QC-Schritt abgeschlossen: QR=${qrCode}, Dauer=${durationMinutes} Min`);

            return {
                success: true,
                qcStepId: qcStepId,
                sessionId: sessionId,
                durationMinutes: durationMinutes,
                message: 'Qualitätsprüfung abgeschlossen'
            };

        } catch (error) {
            console.error('Fehler beim QC-Schritt abschließen:', error);
            return {
                success: false,
                qcStepId: null,
                sessionId: null,
                durationMinutes: 0,
                message: `Fehler beim QC-Abschluss: ${error.message}`
            };
        }
    }

    /**
     * Aktive QC-Schritte für Session abrufen
     * @param {number} sessionId - Session ID
     * @returns {Array} - Array aktiver QC-Schritte
     */
    async getActiveQCStepsForSession(sessionId) {
        if (!this.qualityControlEnabled) return [];

        try {
            const result = await this.query(`
                SELECT * FROM VW_ActiveQualityControlSteps 
                WHERE SessionID = ?
                ORDER BY StartTime ASC
            `, [sessionId]);

            return result.recordset.map(step => ({
                ...step,
                StartTime: this.utils.normalizeTimestamp(step.StartTime),
                SessionStartTime: this.utils.normalizeTimestamp(step.SessionStartTime),
                StartScanTime: step.StartScanTime ? this.utils.normalizeTimestamp(step.StartScanTime) : null
            }));

        } catch (error) {
            console.error('Fehler beim Abrufen aktiver QC-Schritte:', error);
            return [];
        }
    }

    /**
     * Alle aktiven QC-Schritte abrufen
     * @returns {Array} - Array aller aktiven QC-Schritte
     */
    async getAllActiveQCSteps() {
        if (!this.qualityControlEnabled) return [];

        try {
            const result = await this.query(`
                SELECT * FROM VW_ActiveQualityControlSteps 
                ORDER BY Priority DESC, StartTime ASC
            `);

            return result.recordset.map(step => ({
                ...step,
                StartTime: this.utils.normalizeTimestamp(step.StartTime),
                SessionStartTime: this.utils.normalizeTimestamp(step.SessionStartTime),
                StartScanTime: step.StartScanTime ? this.utils.normalizeTimestamp(step.StartScanTime) : null
            }));

        } catch (error) {
            console.error('Fehler beim Abrufen aller aktiven QC-Schritte:', error);
            return [];
        }
    }

    /**
     * QC-Statistiken abrufen
     * @returns {Object} - QC-Statistiken
     */
    async getQCStatistics() {
        if (!this.qualityControlEnabled) return this.qcStatistics;

        try {
            const result = await this.query(`SELECT * FROM VW_QualityControlStats`);

            if (result.recordset.length > 0) {
                const stats = result.recordset[0];

                this.qcStatistics = {
                    totalQCSteps: stats.TotalQCSteps || 0,
                    completedQCSteps: stats.CompletedSteps || 0,
                    activeQCSteps: stats.ActiveSteps || 0,
                    abortedQCSteps: stats.AbortedSteps || 0,
                    averageDurationMinutes: Math.round((stats.AvgDurationSeconds || 0) / 60),
                    minDurationMinutes: Math.round((stats.MinDurationSeconds || 0) / 60),
                    maxDurationMinutes: Math.round((stats.MaxDurationSeconds || 0) / 60),
                    averageQualityRating: Math.round((stats.AvgQualityRating || 0) * 100) / 100,
                    defectRate: stats.TotalQCSteps > 0 ?
                        Math.round((stats.StepsWithDefects / stats.TotalQCSteps) * 100) : 0,
                    reworkRate: stats.TotalQCSteps > 0 ?
                        Math.round((stats.StepsRequiringRework / stats.TotalQCSteps) * 100) : 0,
                    overdueSteps: stats.OverdueSteps || 0,
                    todaySteps: stats.TodaySteps || 0,
                    todayCompletedSteps: stats.TodayCompletedSteps || 0,
                    completionRate: stats.TotalQCSteps > 0 ?
                        Math.round((stats.CompletedSteps / stats.TotalQCSteps) * 100) : 0
                };
            }

            return this.qcStatistics;

        } catch (error) {
            console.error('Fehler beim Abrufen der QC-Statistiken:', error);
            return this.qcStatistics;
        }
    }

    // ===== QC HILFSMETHODEN =====

    async getActiveQCStepByQRCode(qrCode) {
        if (!this.qualityControlEnabled) return null;

        try {
            const result = await this.query(`
                SELECT TOP 1 * FROM QualityControlSteps 
                WHERE QrCode = ? AND QCStatus = 'active' AND Completed = 0
                ORDER BY StartTime DESC
            `, [qrCode]);

            return result.recordset.length > 0 ? result.recordset[0] : null;

        } catch (error) {
            console.error('Fehler beim Abrufen aktiver QC-Schritt by QR-Code:', error);
            return null;
        }
    }

    async getQCStepByQRCode(qrCode) {
        if (!this.qualityControlEnabled) return null;

        try {
            const result = await this.query(`
                SELECT TOP 1 * FROM QualityControlSteps 
                WHERE QrCode = ?
                ORDER BY UpdatedTS DESC
            `, [qrCode]);

            return result.recordset.length > 0 ? result.recordset[0] : null;

        } catch (error) {
            console.error('Fehler beim Abrufen QC-Schritt by QR-Code:', error);
            return null;
        }
    }

    async getLatestQCStepId(qrCode) {
        try {
            const result = await this.query(`
                SELECT TOP 1 ID FROM QualityControlSteps 
                WHERE QrCode = ? 
                ORDER BY CreatedTS DESC
            `, [qrCode]);

            return result.recordset.length > 0 ? result.recordset[0].ID : null;

        } catch (error) {
            console.error('Fehler beim Abrufen der letzten QC-Step-ID:', error);
            return null;
        }
    }

    async resetQCStepsForSession(sessionId, reason = 'Session-Reset') {
        if (!this.qualityControlEnabled) return;

        try {
            const result = await this.query(`
                UPDATE QualityControlSteps 
                SET QCStatus = 'aborted', 
                    QualityNotes = ISNULL(QualityNotes, '') + ' [' + ? + ']'
                WHERE SessionID = ? AND QCStatus = 'active' AND Completed = 0
            `, [reason, sessionId]);

            // Lokales Tracking bereinigen
            const sessionQRCodes = this.qcSessionMapping.get(sessionId);
            if (sessionQRCodes) {
                sessionQRCodes.forEach(qrCode => {
                    this.activeQCSteps.delete(qrCode);
                });
                this.qcSessionMapping.delete(sessionId);
            }

            console.log(`🔄 QC-Schritte für Session ${sessionId} zurückgesetzt: ${reason}`);

        } catch (error) {
            console.error('Fehler beim QC-Reset für Session:', error);
        }
    }

    async abortActiveQCStepsForSession(sessionId, reason = 'Session beendet') {
        if (!this.qualityControlEnabled) return;

        try {
            const result = await this.query(`
                UPDATE QualityControlSteps 
                SET QCStatus = 'aborted',
                    EndTime = GETDATE(),
                    QualityNotes = ISNULL(QualityNotes, '') + ' [Abgebrochen: ' + ? + ']'
                WHERE SessionID = ? AND QCStatus = 'active' AND Completed = 0
            `, [reason, sessionId]);

            const affectedRows = result.rowsAffected[0] || 0;
            if (affectedRows > 0) {
                console.log(`🛑 ${affectedRows} aktive QC-Schritte für Session ${sessionId} abgebrochen`);
            }

            // Lokales Tracking bereinigen
            const sessionQRCodes = this.qcSessionMapping.get(sessionId);
            if (sessionQRCodes) {
                sessionQRCodes.forEach(qrCode => {
                    this.activeQCSteps.delete(qrCode);
                });
                this.qcSessionMapping.delete(sessionId);
            }

        } catch (error) {
            console.error('Fehler beim Abbrechen aktiver QC-Schritte:', error);
        }
    }

    async abortAllActiveQCSteps(reason = 'System-Shutdown') {
        if (!this.qualityControlEnabled) return;

        try {
            const result = await this.query(`
                UPDATE QualityControlSteps 
                SET QCStatus = 'aborted',
                    EndTime = GETDATE(),
                    QualityNotes = ISNULL(QualityNotes, '') + ' [Abgebrochen: ' + ? + ']'
                WHERE QCStatus = 'active' AND Completed = 0
            `, [reason]);

            const affectedRows = result.rowsAffected[0] || 0;
            if (affectedRows > 0) {
                console.log(`🛑 ${affectedRows} aktive QC-Schritte abgebrochen: ${reason}`);
            }

            // Komplettes lokales Tracking leeren
            this.activeQCSteps.clear();
            this.qcSessionMapping.clear();

        } catch (error) {
            console.error('Fehler beim Abbrechen aller aktiven QC-Schritte:', error);
        }
    }

    async loadActiveQCSteps() {
        if (!this.qualityControlEnabled) return;

        try {
            const result = await this.query(`
                SELECT ID, SessionID, QrCode, StartTime, Priority, EstimatedDurationMinutes
                FROM QualityControlSteps 
                WHERE QCStatus = 'active' AND Completed = 0
            `);

            this.activeQCSteps.clear();
            this.qcSessionMapping.clear();

            result.recordset.forEach(step => {
                this.activeQCSteps.set(step.QrCode, {
                    id: step.ID,
                    sessionId: step.SessionID,
                    startTime: new Date(step.StartTime),
                    priority: step.Priority,
                    estimatedMinutes: step.EstimatedDurationMinutes
                });

                // Session-Mapping aktualisieren
                const sessionQRCodes = this.qcSessionMapping.get(step.SessionID) || new Set();
                sessionQRCodes.add(step.QrCode);
                this.qcSessionMapping.set(step.SessionID, sessionQRCodes);
            });

            console.log(`📊 ${result.recordset.length} aktive QC-Schritte geladen`);

        } catch (error) {
            console.error('Fehler beim Laden aktiver QC-Schritte:', error);
        }
    }

    async loadQCStatistics() {
        await this.getQCStatistics();
        console.log('📈 QC-Statistiken geladen:', this.qcStatistics);
    }

    // ===== STATISTICS OPERATIONS (DELEGATED) =====

    async getDailyStats(date = null) {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getDailyStats(date);
    }

    async getRecentActivity(hours = 8) {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getRecentActivity(hours);
    }

    async getUserStatsDetailed(userId = null, startDate = null, endDate = null) {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getUserStats(userId, startDate, endDate);
    }

    async getHourlyActivity(date = null) {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getHourlyActivity(date);
    }

    async getWeeklyTrends(weeks = 4) {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getWeeklyTrends(weeks);
    }

    async getPerformanceMetrics(startDate = null, endDate = null) {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getPerformanceMetrics(startDate, endDate);
    }

    async getTopPerformers(metric = 'scans', limit = 10, startDate = null, endDate = null) {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getTopPerformers(metric, limit, startDate, endDate);
    }

    async getDashboardData(timeframe = 'today') {
        if (!this.stats) throw new Error('DatabaseClient nicht verbunden');
        return await this.stats.getDashboardData(timeframe);
    }

    // ===== WARENEINLAGERUNG-SPEZIFISCHE STATISTIKEN =====

    /**
     * Statistiken für parallele Sessions
     * @returns {Object} - Parallele Session-Statistiken
     */
    async getParallelSessionStats() {
        try {
            const result = await this.query(`
                SELECT
                    COUNT(*) as ActiveSessionCount,
                    COUNT(DISTINCT UserID) as ActiveUserCount,
                    AVG(DATEDIFF(MINUTE, StartTS, GETDATE())) as AvgSessionDurationMinutes,
                    SUM(qr.ScanCount) as TotalActiveScans,
                    ${this.qualityControlEnabled ? 'SUM(qc.ActiveQCSteps) as TotalActiveQCSteps,' : '0 as TotalActiveQCSteps,'}
                    ${this.qualityControlEnabled ? 'SUM(qc.CompletedQCSteps) as TotalCompletedQCSteps' : '0 as TotalCompletedQCSteps'}
                FROM Sessions s
                         LEFT JOIN (
                    SELECT SessionID, COUNT(*) as ScanCount
                    FROM QrScans
                    WHERE CapturedTS >= DATEADD(DAY, -1, GETDATE())
                    GROUP BY SessionID
                ) qr ON s.ID = qr.SessionID
                         ${this.qualityControlEnabled ? `LEFT JOIN (
                    SELECT SessionID,
                           SUM(CASE WHEN QCStatus = 'active' AND Completed = 0 THEN 1 ELSE 0 END) as ActiveQCSteps,
                           SUM(CASE WHEN Completed = 1 THEN 1 ELSE 0 END) as CompletedQCSteps
                    FROM QualityControlSteps
                    GROUP BY SessionID
                ) qc ON s.ID = qc.SessionID` : ''}
                WHERE s.Active = 1
            `);

            const stats = result.recordset[0];
            return {
                activeSessionCount: stats.ActiveSessionCount || 0,
                activeUserCount: stats.ActiveUserCount || 0,
                avgSessionDurationMinutes: Math.round(stats.AvgSessionDurationMinutes || 0),
                totalActiveScans: stats.TotalActiveScans || 0,
                totalActiveQCSteps: stats.TotalActiveQCSteps || 0,
                totalCompletedQCSteps: stats.TotalCompletedQCSteps || 0,
                qualityControlEnabled: this.qualityControlEnabled,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Abrufen der parallelen Session-Statistiken:', error);
            return {
                activeSessionCount: 0,
                activeUserCount: 0,
                avgSessionDurationMinutes: 0,
                totalActiveScans: 0,
                totalActiveQCSteps: 0,
                totalCompletedQCSteps: 0,
                qualityControlEnabled: this.qualityControlEnabled,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Session-Restart-Statistiken
     * @param {number} days - Anzahl Tage rückblickend (default: 7)
     * @returns {Object} - Session-Restart-Statistiken
     */
    async getSessionRestartStats(days = 7) {
        try {
            // Da wir keine explizite Restart-Spalte haben, schätzen wir Restarts
            // basierend auf Sessions mit sehr kurzer Dauer gefolgt von neuen Sessions
            const result = await this.query(`
                WITH SessionDurations AS (
                    SELECT
                        UserID,
                        StartTS,
                        LEAD(StartTS) OVER (PARTITION BY UserID ORDER BY StartTS) as NextStartTime,
                        DATEDIFF(MINUTE, StartTS, ISNULL(EndTS, GETDATE())) as DurationMinutes
                    FROM Sessions
                    WHERE StartTS >= DATEADD(DAY, -?, GETDATE())
                )
                SELECT
                    COUNT(*) as TotalSessions,
                    COUNT(CASE WHEN DurationMinutes < 2 AND NextStartTime IS NOT NULL
                        AND DATEDIFF(MINUTE, StartTS, NextStartTime) < 5
                                   THEN 1 END) as EstimatedRestarts,
                    AVG(DurationMinutes) as AvgSessionDuration,
                    COUNT(DISTINCT UserID) as UsersWithSessions
                FROM SessionDurations
            `, [days]);

            const stats = result.recordset[0];
            return {
                totalSessions: stats.TotalSessions || 0,
                estimatedRestarts: stats.EstimatedRestarts || 0,
                restartRate: stats.TotalSessions > 0 ?
                    Math.round((stats.EstimatedRestarts / stats.TotalSessions) * 100) : 0,
                avgSessionDurationMinutes: Math.round(stats.AvgSessionDuration || 0),
                usersWithSessions: stats.UsersWithSessions || 0,
                daysAnalyzed: days,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Abrufen der Session-Restart-Statistiken:', error);
            return {
                totalSessions: 0,
                estimatedRestarts: 0,
                restartRate: 0,
                avgSessionDurationMinutes: 0,
                usersWithSessions: 0,
                daysAnalyzed: days,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // ===== HEALTH & DIAGNOSTICS (DELEGATED) =====

    async healthCheck() {
        try {
            // Basis-Verbindungstest
            const connectionTest = await this.query('SELECT 1 as test, SYSDATETIME() as currentTime');

            // Tabellen-Validierung
            const tablesValid = await this.validateTables();

            // SessionTypes verfügbar?
            const sessionTypes = await this.getSessionTypes();

            // Aktive Sessions zählen
            const activeSessions = await this.getActiveSessions();

            // QC-System-Status
            let qcSystemStatus = null;
            if (this.qualityControlEnabled) {
                qcSystemStatus = {
                    enabled: true,
                    activeQCSteps: this.activeQCSteps.size,
                    activeSessions: this.qcSessionMapping.size,
                    statistics: await this.getQCStatistics()
                };
            }

            return {
                connection: connectionTest.recordset.length > 0,
                tables: tablesValid,
                sessionTypes: sessionTypes.length > 0,
                sessionTypesInitialized: this.sessionTypesInitialized,
                activeSessionsCount: activeSessions.length,
                multiSessionMode: this.multiSessionMode,
                allowSessionRestart: this.allowSessionRestart,
                qualityControl: qcSystemStatus,
                currentTime: connectionTest.recordset[0]?.currentTime,
                status: 'healthy'
            };

        } catch (error) {
            return {
                connection: false,
                tables: false,
                sessionTypes: false,
                sessionTypesInitialized: false,
                activeSessionsCount: 0,
                multiSessionMode: this.multiSessionMode,
                allowSessionRestart: this.allowSessionRestart,
                qualityControl: null,
                error: error.message,
                status: 'unhealthy'
            };
        }
    }

    async testConnection() {
        if (!this.health) throw new Error('DatabaseClient nicht verbunden');
        return await this.health.testConnection();
    }

    getConnectionStatus() {
        if (!this.health) {
            return {
                connected: false,
                message: 'DatabaseClient nicht verbunden'
            };
        }
        return this.health.getConnectionStatus();
    }

    async debugInfo() {
        const baseInfo = this.health ? await this.health.debugInfo() : {
            connection: 'nicht verfügbar',
            modules: 'nicht initialisiert'
        };

        // Wareneinlagerung-spezifische Debug-Informationen hinzufügen
        const wareneinlagerungInfo = {
            multiSessionMode: this.multiSessionMode,
            allowSessionRestart: this.allowSessionRestart,
            sessionTypesInitialized: this.sessionTypesInitialized,
            parallelSessionStats: await this.getParallelSessionStats(),
            sessionRestartStats: await this.getSessionRestartStats(1), // Letzte 24h
            qualityControl: {
                enabled: this.qualityControlEnabled,
                autoSessionResetAfterQC: this.autoSessionResetAfterQC,
                allowParallelQC: this.allowParallelQC,
                activeQCSteps: this.activeQCSteps.size,
                activeSessions: this.qcSessionMapping.size,
                statistics: this.qualityControlEnabled ? await this.getQCStatistics() : null
            }
        };

        return {
            ...baseInfo,
            wareneinlagerung: wareneinlagerungInfo
        };
    }

    async getPerformanceStats() {
        if (!this.health) throw new Error('DatabaseClient nicht verbunden');
        return await this.health.getPerformanceStats();
    }

    async getDatabaseSize() {
        if (!this.health) throw new Error('DatabaseClient nicht verbunden');
        return await this.health.getDatabaseSize();
    }

    async getTableSizes() {
        if (!this.health) throw new Error('DatabaseClient nicht verbunden');
        return await this.health.getTableSizes();
    }

    async checkSystemHealth() {
        const baseHealth = this.health ? await this.health.checkSystemHealth() : {
            database: false,
            performance: 'unknown'
        };

        // Wareneinlagerung-spezifische Gesundheitsprüfungen
        try {
            const parallelStats = await this.getParallelSessionStats();
            const qcStats = this.qualityControlEnabled ? await this.getQCStatistics() : null;

            const wareneinlagerungHealth = {
                parallelSessionsOperational: parallelStats.activeSessionCount >= 0,
                multiUserMode: this.multiSessionMode,
                sessionRestartEnabled: this.allowSessionRestart,
                sessionTypesReady: this.sessionTypesInitialized,
                recommendedMaxParallelSessions: 10,
                currentParallelSessions: parallelStats.activeSessionCount,
                parallelSessionWarning: parallelStats.activeSessionCount > 15,
                qualityControl: {
                    enabled: this.qualityControlEnabled,
                    operational: this.qualityControlEnabled && qcStats !== null,
                    activeQCSteps: this.activeQCSteps.size,
                    overdueSteps: qcStats?.overdueSteps || 0,
                    completionRate: qcStats?.completionRate || 0,
                    averageDuration: qcStats?.averageDurationMinutes || 0
                }
            };

            return {
                ...baseHealth,
                wareneinlagerung: wareneinlagerungHealth
            };
        } catch (error) {
            return {
                ...baseHealth,
                wareneinlagerung: {
                    error: `Wareneinlagerung-Gesundheitsprüfung fehlgeschlagen: ${error.message}`,
                    parallelSessionsOperational: false,
                    sessionTypesReady: false,
                    qualityControl: {
                        enabled: this.qualityControlEnabled,
                        operational: false,
                        error: error.message
                    }
                }
            };
        }
    }

    async getSystemReport() {
        const baseReport = this.health ? await this.health.getSystemReport() : {
            database: 'nicht verfügbar',
            performance: 'unbekannt'
        };

        // Wareneinlagerung-spezifische Berichtsdaten hinzufügen
        try {
            const [parallelStats, restartStats, qcStats] = await Promise.all([
                this.getParallelSessionStats(),
                this.getSessionRestartStats(7),
                this.qualityControlEnabled ? this.getQCStatistics() : Promise.resolve(null)
            ]);

            const wareneinlagerungReport = {
                mode: 'Wareneinlagerung (Multi-User mit QC)',
                parallelSessionSupport: true,
                sessionRestartSupport: true,
                qualityControlSupport: this.qualityControlEnabled,
                sessionTypesInitialized: this.sessionTypesInitialized,
                currentStats: parallelStats,
                weeklyRestartStats: restartStats,
                qualityControlStats: qcStats,
                configuration: {
                    multiSessionMode: this.multiSessionMode,
                    allowSessionRestart: this.allowSessionRestart,
                    qualityControlEnabled: this.qualityControlEnabled,
                    autoSessionResetAfterQC: this.autoSessionResetAfterQC,
                    allowParallelQC: this.allowParallelQC,
                    qcDefaultEstimatedMinutes: this.qcDefaultEstimatedMinutes,
                    qcOverdueThresholdMinutes: this.qcOverdueThresholdMinutes
                }
            };

            return {
                ...baseReport,
                wareneinlagerung: wareneinlagerungReport
            };
        } catch (error) {
            return {
                ...baseReport,
                wareneinlagerung: {
                    error: `Wareneinlagerung-Bericht-Generierung fehlgeschlagen: ${error.message}`
                }
            };
        }
    }

    // ===== UTILITY METHODS (DELEGATED) =====

    normalizeTimestamp(timestamp) {
        return this.utils.normalizeTimestamp(timestamp);
    }

    formatSQLDateTime(date) {
        return this.utils.formatSQLDateTime(date);
    }

    parseSQLDateTime(sqlDateTime) {
        return this.utils.parseSQLDateTime(sqlDateTime);
    }

    formatRelativeTime(timestamp) {
        return this.utils.formatRelativeTime(timestamp);
    }

    formatSessionDuration(totalSeconds) {
        return this.utils.formatSessionDuration(totalSeconds);
    }

    parseQRCodeData(data) {
        return this.utils.parseQRCodeData(data);
    }

    parsePayloadJson(payloadJson) {
        return this.utils.parsePayloadJson(payloadJson);
    }

    extractDecodedData(payloadJson, rawPayload = null) {
        return this.utils.extractDecodedData(payloadJson, rawPayload);
    }

    getQRCodeFormat(payloadJson, rawPayload = null) {
        return this.utils.getQRCodeFormat(payloadJson, rawPayload);
    }

    clearDuplicateCache() {
        return this.utils.clearDuplicateCache();
    }

    getDuplicateCacheStats() {
        return this.utils.getDuplicateCacheStats();
    }

    // ===== ENHANCED MODULAR METHODS =====

    /**
     * Get all modules for direct access (Advanced Usage)
     * @returns {Object} - All available modules
     */
    getModules() {
        return {
            connection: this.connection,
            utils: this.utils,
            users: this.users,
            sessions: this.sessions,
            qrscans: this.qrscans,
            stats: this.stats,
            health: this.health
        };
    }

    /**
     * Setup SessionTypes (Migration Helper)
     * @returns {boolean} - Success
     */
    async setupSessionTypes() {
        const success = await SessionTypeConstants.setupSessionTypes(this.connection);
        if (success) {
            this.sessionTypesInitialized = true;
        }
        return success;
    }

    /**
     * Get SessionType configuration
     * @param {string} sessionTypeName - Name of the SessionType
     * @returns {Object|null} - SessionType configuration
     */
    getSessionTypeConfig(sessionTypeName) {
        return SessionTypeConstants.getSessionTypeConfig(sessionTypeName);
    }

    /**
     * Validate QR code for specific SessionType
     * @param {string} sessionTypeName - SessionType name
     * @param {Object} qrData - QR code data
     * @returns {Object} - Validation result
     */
    validateQRForSessionType(sessionTypeName, qrData) {
        return SessionTypeConstants.validateQRForSessionType(sessionTypeName, qrData);
    }

    /**
     * Enhanced QR scan with SessionType validation and QC workflow
     * @param {number} sessionId - Session ID
     * @param {string} payload - QR payload
     * @param {Object} options - Additional options
     * @returns {Object} - Enhanced scan result
     */
    async saveQRScanWithValidation(sessionId, payload, options = {}) {
        try {
            // Get session info if validation is requested
            if (options.validateSessionType) {
                const session = await this.getSessionWithType(sessionId);
                if (session && session.SessionTypeName) {
                    const qrData = this.parseQRCodeData(payload);
                    const validation = this.validateQRForSessionType(session.SessionTypeName, {
                        type: 'decoded_qr',
                        decoded: qrData
                    });

                    if (!validation.isValid) {
                        return {
                            success: false,
                            status: 'validation_failed',
                            message: validation.message,
                            data: null,
                            timestamp: new Date().toISOString()
                        };
                    }
                }
            }

            // Proceed with normal scan saving (includes QC workflow)
            return await this.saveQRScan(sessionId, payload);
        } catch (error) {
            return {
                success: false,
                status: 'error',
                message: `Fehler bei validiertem QR-Scan: ${error.message}`,
                data: null,
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Get comprehensive session report (ERWEITERT FÜR WARENEINLAGERUNG + QC)
     * @param {number} sessionId - Session ID
     * @returns {Object} - Comprehensive session report
     */
    async getSessionReport(sessionId) {
        try {
            const [
                session,
                scans,
                duration,
                stats,
                parallelStats,
                qcSteps
            ] = await Promise.all([
                this.getSessionWithType(sessionId),
                this.getQRScansBySession(sessionId),
                this.getSessionDuration(sessionId),
                this.getQRScanStats(sessionId),
                this.getParallelSessionStats(),
                this.qualityControlEnabled ? this.getActiveQCStepsForSession(sessionId) : Promise.resolve([])
            ]);

            return {
                session,
                scans,
                duration,
                stats,
                parallelContext: parallelStats,
                qualityControl: {
                    enabled: this.qualityControlEnabled,
                    activeSteps: qcSteps,
                    activeStepCount: qcSteps.length,
                    completedSteps: qcSteps.filter(step => step.Completed).length
                },
                summary: {
                    sessionId: sessionId,
                    totalScans: scans.length,
                    validScans: scans.filter(s => s.Valid).length,
                    duration: duration,
                    sessionType: session?.SessionTypeName || 'Wareneinlagerung',
                    user: session ? {
                        id: session.UserID,
                        name: session.UserName || 'Unknown'
                    } : null,
                    parallelSessions: parallelStats.activeSessionCount,
                    qualityControl: {
                        activeSteps: qcSteps.length,
                        completedSteps: qcSteps.filter(step => step.Completed).length
                    },
                    mode: 'Wareneinlagerung (Multi-User mit QC)'
                },
                generatedAt: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Fehler beim Erstellen des Session-Reports: ${error.message}`);
        }
    }

    /**
     * WARENEINLAGERUNG-SPEZIFISCH: Multi-User Dashboard-Daten mit QC
     * @returns {Object} - Dashboard-Daten für parallele Sessions mit QC
     */
    async getMultiUserDashboard() {
        try {
            const [
                activeSessions,
                parallelStats,
                recentActivity,
                topPerformers,
                qcStats,
                allActiveQCSteps
            ] = await Promise.all([
                this.getActiveSessions(),
                this.getParallelSessionStats(),
                this.getRecentActivity(2), // Letzte 2 Stunden
                this.getTopPerformers('scans', 5), // Top 5 Performer
                this.qualityControlEnabled ? this.getQCStatistics() : Promise.resolve(null),
                this.qualityControlEnabled ? this.getAllActiveQCSteps() : Promise.resolve([])
            ]);

            return {
                overview: {
                    mode: 'Wareneinlagerung Multi-User mit QC',
                    activeUsers: parallelStats.activeUserCount,
                    activeSessions: parallelStats.activeSessionCount,
                    totalActiveScans: parallelStats.totalActiveScans,
                    avgSessionDuration: parallelStats.avgSessionDurationMinutes,
                    sessionTypesReady: this.sessionTypesInitialized,
                    qualityControl: {
                        enabled: this.qualityControlEnabled,
                        activeSteps: parallelStats.totalActiveQCSteps,
                        completedToday: qcStats?.todayCompletedSteps || 0,
                        completionRate: qcStats?.completionRate || 0,
                        averageDuration: qcStats?.averageDurationMinutes || 0
                    }
                },
                activeSessions: activeSessions.map(session => ({
                    sessionId: session.ID,
                    userId: session.UserID,
                    userName: session.UserName,
                    department: session.Department,
                    startTime: session.StartTS,
                    scanCount: session.ScanCount,
                    activeQCSteps: session.ActiveQCSteps,
                    completedQCSteps: session.CompletedQCSteps,
                    durationMinutes: Math.round((new Date() - new Date(session.StartTS)) / (1000 * 60))
                })),
                qualityControl: {
                    enabled: this.qualityControlEnabled,
                    statistics: qcStats,
                    activeSteps: allActiveQCSteps.slice(0, 10), // Top 10 aktive QC-Schritte
                    overdueSteps: allActiveQCSteps.filter(step => step.IsOverdue),
                    highPrioritySteps: allActiveQCSteps.filter(step => step.Priority >= 2)
                },
                recentActivity: recentActivity,
                topPerformers: topPerformers,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Erstellen des Multi-User-Dashboards mit QC:', error);
            throw error;
        }
    }

    /**
     * System-Reset für Entwicklung/Tests (VORSICHT!)
     * @returns {Object} - Reset-Ergebnis
     */
    async resetForDevelopment() {
        console.warn('🚨 ACHTUNG: Entwicklungs-Reset wird ausgeführt!');

        try {
            // Alle aktiven QC-Schritte abbrechen
            if (this.qualityControlEnabled) {
                await this.abortAllActiveQCSteps('Entwicklungs-Reset');
            }

            // ALLE aktiven Sessions beenden
            await this.endAllActiveSessions();

            // Utils-Cache leeren
            this.utils.cleanup();

            // QC-Tracking zurücksetzen
            this.activeQCSteps.clear();
            this.qcSessionMapping.clear();

            return {
                success: true,
                message: 'System für Entwicklung zurückgesetzt (inkl. QC)',
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Entwicklungs-Reset:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// ===== BACKWARDS COMPATIBILITY EXPORTS =====

// Standard-Export bleibt DatabaseClient (für bestehenden Code)
module.exports = DatabaseClient;

// Named Exports für erweiterte Nutzung
module.exports.DatabaseClient = DatabaseClient;
module.exports.SESSION_TYPES = SessionTypeConstants.SESSION_TYPES;
module.exports.createWareneinlagerungSession = SessionTypeConstants.createWareneinlagerungSession;
module.exports.getWareneinlagerungSessionTypeId = SessionTypeConstants.getWareneinlagerungSessionTypeId;

// Module exports für direkte Nutzung (Advanced)
module.exports.modules = {
    DatabaseConnection,
    DatabaseUtils,
    UserModule,
    SessionModule,
    QRScanModule,
    StatsModule,
    HealthModule,
    SessionTypeConstants
};
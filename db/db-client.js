/**
 * Modular Database Client für Wareneinlagerung
 * Composition of specialized database modules for better maintainability
 * Angepasst für parallele Sessions und RFID-Session-Restart-Logik
 * VOLLSTÄNDIG KORRIGIERT für SessionTypes Setup und Wareneinlagerung
 *
 * This version supports multiple parallel sessions and RFID session restart functionality.
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
 * Enhanced Database Client with Modular Architecture für Wareneinlagerung
 *
 * Supports multiple parallel sessions and RFID session restart functionality
 * while providing better code organization through specialized modules.
 * KORRIGIERT für automatisches SessionTypes Setup
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

    async close() {
        // Cleanup utils first
        this.utils.cleanup();

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
        return await this.connection.validateTables();
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

        return await this.sessions.createSession(userId, sessionType);
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
            if (userId) {
                // Mit Benutzer-Validierung
                return await this.sessions.restartSession(sessionId, userId);
            } else {
                // Ohne Benutzer-Validierung (legacy support)
                const result = await this.query(`
                    UPDATE Sessions 
                    SET StartTS = GETDATE()
                    OUTPUT INSERTED.ID, INSERTED.UserID, INSERTED.StartTS, INSERTED.Active
                    WHERE ID = ? AND Active = 1
                `, [sessionId]);

                if (result.recordset.length === 0) {
                    throw new Error(`Session ${sessionId} nicht gefunden oder nicht aktiv`);
                }

                const updatedSession = result.recordset[0];
                console.log(`✅ Session ${sessionId} neu gestartet`);

                return {
                    ID: updatedSession.ID,
                    UserID: updatedSession.UserID,
                    StartTS: this.utils.normalizeTimestamp(updatedSession.StartTS),
                    Active: updatedSession.Active,
                    restarted: true
                };
            }

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
                       COUNT(qr.ID) as ScanCount
                FROM Sessions s
                         INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                         LEFT JOIN QrScans qr ON s.ID = qr.SessionID
                WHERE s.Active = 1
                GROUP BY s.ID, s.UserID, s.StartTS, s.EndTS, s.Active, u.BenutzerName, u.Department
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
                ScanCount: session.ScanCount || 0
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

    // ===== QR-SCAN OPERATIONS (DELEGATED) =====

    async saveQRScan(sessionId, payload) {
        if (!this.qrscans) throw new Error('DatabaseClient nicht verbunden');
        return await this.qrscans.saveQRScan(sessionId, payload);
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
                    SUM(qr.ScanCount) as TotalActiveScans
                FROM Sessions s
                         LEFT JOIN (
                    SELECT SessionID, COUNT(*) as ScanCount
                    FROM QrScans
                    WHERE CapturedTS >= DATEADD(DAY, -1, GETDATE())
                    GROUP BY SessionID
                ) qr ON s.ID = qr.SessionID
                WHERE s.Active = 1
            `);

            const stats = result.recordset[0];
            return {
                activeSessionCount: stats.ActiveSessionCount || 0,
                activeUserCount: stats.ActiveUserCount || 0,
                avgSessionDurationMinutes: Math.round(stats.AvgSessionDurationMinutes || 0),
                totalActiveScans: stats.TotalActiveScans || 0,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Abrufen der parallelen Session-Statistiken:', error);
            return {
                activeSessionCount: 0,
                activeUserCount: 0,
                avgSessionDurationMinutes: 0,
                totalActiveScans: 0,
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

            return {
                connection: connectionTest.recordset.length > 0,
                tables: tablesValid,
                sessionTypes: sessionTypes.length > 0,
                sessionTypesInitialized: this.sessionTypesInitialized,
                activeSessionsCount: activeSessions.length,
                multiSessionMode: this.multiSessionMode,
                allowSessionRestart: this.allowSessionRestart,
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
            sessionRestartStats: await this.getSessionRestartStats(1) // Letzte 24h
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
            const wareneinlagerungHealth = {
                parallelSessionsOperational: parallelStats.activeSessionCount >= 0,
                multiUserMode: this.multiSessionMode,
                sessionRestartEnabled: this.allowSessionRestart,
                sessionTypesReady: this.sessionTypesInitialized,
                recommendedMaxParallelSessions: 10,
                currentParallelSessions: parallelStats.activeSessionCount,
                parallelSessionWarning: parallelStats.activeSessionCount > 15
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
                    sessionTypesReady: false
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
            const [parallelStats, restartStats] = await Promise.all([
                this.getParallelSessionStats(),
                this.getSessionRestartStats(7)
            ]);

            const wareneinlagerungReport = {
                mode: 'Wareneinlagerung (Multi-User)',
                parallelSessionSupport: true,
                sessionRestartSupport: true,
                sessionTypesInitialized: this.sessionTypesInitialized,
                currentStats: parallelStats,
                weeklyRestartStats: restartStats,
                configuration: {
                    multiSessionMode: this.multiSessionMode,
                    allowSessionRestart: this.allowSessionRestart
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
     * Enhanced QR scan with SessionType validation
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

            // Proceed with normal scan saving
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
     * Get comprehensive session report (ERWEITERT FÜR WARENEINLAGERUNG)
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
                parallelStats
            ] = await Promise.all([
                this.getSessionWithType(sessionId),
                this.getQRScansBySession(sessionId),
                this.getSessionDuration(sessionId),
                this.getQRScanStats(sessionId),
                this.getParallelSessionStats()
            ]);

            return {
                session,
                scans,
                duration,
                stats,
                parallelContext: parallelStats,
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
                    mode: 'Wareneinlagerung (Multi-User)'
                },
                generatedAt: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Fehler beim Erstellen des Session-Reports: ${error.message}`);
        }
    }

    /**
     * WARENEINLAGERUNG-SPEZIFISCH: Multi-User Dashboard-Daten
     * @returns {Object} - Dashboard-Daten für parallele Sessions
     */
    async getMultiUserDashboard() {
        try {
            const [
                activeSessions,
                parallelStats,
                recentActivity,
                topPerformers
            ] = await Promise.all([
                this.getActiveSessions(),
                this.getParallelSessionStats(),
                this.getRecentActivity(2), // Letzte 2 Stunden
                this.getTopPerformers('scans', 5) // Top 5 Performer
            ]);

            return {
                overview: {
                    mode: 'Wareneinlagerung Multi-User',
                    activeUsers: parallelStats.activeUserCount,
                    activeSessions: parallelStats.activeSessionCount,
                    totalActiveScans: parallelStats.totalActiveScans,
                    avgSessionDuration: parallelStats.avgSessionDurationMinutes,
                    sessionTypesReady: this.sessionTypesInitialized
                },
                activeSessions: activeSessions.map(session => ({
                    sessionId: session.ID,
                    userId: session.UserID,
                    userName: session.UserName,
                    department: session.Department,
                    startTime: session.StartTS,
                    scanCount: session.ScanCount,
                    durationMinutes: Math.round((new Date() - new Date(session.StartTS)) / (1000 * 60))
                })),
                recentActivity: recentActivity,
                topPerformers: topPerformers,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Fehler beim Erstellen des Multi-User-Dashboards:', error);
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
            // ALLE aktiven Sessions beenden
            await this.endAllActiveSessions();

            // Utils-Cache leeren
            this.utils.cleanup();

            return {
                success: true,
                message: 'System für Entwicklung zurückgesetzt',
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
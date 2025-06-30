/**
 * Modular Database Client für Wareneinlagerung
 * Composition of specialized database modules for better maintainability
 * Angepasst für parallele Sessions und RFID-Session-Restart-Logik
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
 */
class DatabaseClient {
    constructor() {
        // ===== CORE COMPONENTS =====
        this.connection = new DatabaseConnection();
        this.utils = new DatabaseUtils();

        // ===== SPECIALIZED MODULES =====
        this.users = new UserModule(this.connection, this.utils);
        this.sessions = new SessionModule(this.connection, this.utils);
        this.qrscans = new QRScanModule(this.connection, this.utils);
        this.stats = new StatsModule(this.connection, this.utils);
        this.health = new HealthModule(this.connection, this.utils);

        // ===== WARENEINLAGERUNG-SPEZIFISCHE KONFIGURATION =====
        this.multiSessionMode = true; // Aktiviert parallele Sessions
        this.allowSessionRestart = true; // Erlaubt RFID-Session-Restart

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
        return await this.connection.connect();
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
        return await this.users.getUserByEPC(epcHex);
    }

    async getUserById(userId) {
        return await this.users.getUserById(userId);
    }

    async getAllActiveUsers() {
        return await this.users.getAllActiveUsers();
    }

    async searchUsers(searchTerm) {
        return await this.users.searchUsers(searchTerm);
    }

    async getUserStats(userId) {
        return await this.users.getUserStats(userId);
    }

    async validateUser(userId) {
        return await this.users.validateUser(userId);
    }

    async getUserActivity(userId, limit = 50) {
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
        return await this.sessions.createSession(userId, sessionType);
    }

    /**
     * WARENEINLAGERUNG-SPEZIFISCH: Session für Benutzer neu starten
     * Setzt die StartTime auf aktuelle Zeit zurück, ohne die Session zu beenden
     * @param {number} sessionId - Session ID
     * @returns {Object} - Aktualisierte Session-Daten
     */
    async restartSession(sessionId) {
        try {
            const result = await this.query(`
                UPDATE Sessions 
                SET StartTime = GETDATE()
                OUTPUT INSERTED.ID, INSERTED.UserID, INSERTED.StartTime, INSERTED.Active
                WHERE ID = ? AND Active = 1
            `, [sessionId]);

            if (result.recordset.length === 0) {
                throw new Error(`Session ${sessionId} nicht gefunden oder nicht aktiv`);
            }

            const updatedSession = result.recordset[0];
            console.log(`✅ Session ${sessionId} neu gestartet für Benutzer ${updatedSession.UserID}`);

            return {
                ID: updatedSession.ID,
                UserID: updatedSession.UserID,
                StartTS: this.utils.normalizeTimestamp(updatedSession.StartTime),
                Active: updatedSession.Active,
                restarted: true
            };

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
        try {
            const result = await this.query(`
                SELECT s.ID, s.UserID, s.StartTime, s.EndTime, s.Active,
                       u.BenutzerName as UserName
                FROM Sessions s
                INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                WHERE s.UserID = ? AND s.Active = 1
            `, [userId]);

            if (result.recordset.length === 0) {
                return null;
            }

            const session = result.recordset[0];
            return {
                ID: session.ID,
                UserID: session.UserID,
                UserName: session.UserName,
                StartTime: this.utils.normalizeTimestamp(session.StartTime),
                EndTime: session.EndTime ? this.utils.normalizeTimestamp(session.EndTime) : null,
                Active: session.Active
            };

        } catch (error) {
            console.error('Fehler beim Abrufen der aktiven Session:', error);
            throw error;
        }
    }

    /**
     * WARENEINLAGERUNG-SPEZIFISCH: Alle aktiven Sessions abrufen
     * @returns {Array} - Array aller aktiven Sessions
     */
    async getActiveSessions() {
        try {
            const result = await this.query(`
                SELECT s.ID, s.UserID, s.StartTime, s.EndTime, s.Active,
                       u.BenutzerName as UserName, u.Department,
                       COUNT(qr.ID) as ScanCount
                FROM Sessions s
                INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                LEFT JOIN QrScans qr ON s.ID = qr.SessionID
                WHERE s.Active = 1
                GROUP BY s.ID, s.UserID, s.StartTime, s.EndTime, s.Active, u.BenutzerName, u.Department
                ORDER BY s.StartTime ASC
            `);

            return result.recordset.map(session => ({
                ID: session.ID,
                UserID: session.UserID,
                UserName: session.UserName,
                Department: session.Department,
                StartTime: this.utils.normalizeTimestamp(session.StartTime),
                EndTime: session.EndTime ? this.utils.normalizeTimestamp(session.EndTime) : null,
                Active: session.Active,
                ScanCount: session.ScanCount || 0
            }));

        } catch (error) {
            console.error('Fehler beim Abrufen aktiver Sessions:', error);
            throw error;
        }
    }

    async getSessionWithType(sessionId) {
        return await this.sessions.getSessionWithType(sessionId);
    }

    async getActiveSessionsWithType() {
        return await this.sessions.getActiveSessionsWithType();
    }

    async endSession(sessionId) {
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

        try {
            // Zuerst alle aktiven Sessions abrufen für Logging
            const activeSessions = await this.getActiveSessions();

            if (activeSessions.length === 0) {
                return {
                    success: true,
                    endedCount: 0,
                    endedUsers: [],
                    message: 'Keine aktiven Sessions gefunden'
                };
            }

            // Alle aktiven Sessions beenden
            const result = await this.query(`
                UPDATE Sessions
                SET EndTime = GETDATE(), Active = 0
                OUTPUT INSERTED.ID, INSERTED.UserID
                WHERE Active = 1
            `);

            const endedUsers = activeSessions.map(session => ({
                sessionId: session.ID,
                userId: session.UserID,
                userName: session.UserName
            }));

            console.log(`🚨 NOTFALL: ${result.recordset.length} aktive Sessions in Wareneinlagerung beendet`);

            return {
                success: true,
                endedCount: result.recordset.length,
                endedUsers: endedUsers,
                message: `${result.recordset.length} Sessions in Notfall beendet`
            };

        } catch (error) {
            console.error('Fehler beim Beenden aller aktiven Sessions:', error);
            return {
                success: false,
                endedCount: 0,
                endedUsers: [],
                error: error.message
            };
        }
    }

    async getActiveSession(userId) {
        return await this.sessions.getActiveSession(userId);
    }

    async getSessionDuration(sessionId) {
        return await this.sessions.getSessionDuration(sessionId);
    }

    async getSessionTypes() {
        return await this.sessions.getSessionTypes();
    }

    async getSessionTypeStats(startDate = null, endDate = null) {
        return await this.sessions.getSessionTypeStats(startDate, endDate);
    }

    // ===== QR-SCAN OPERATIONS (DELEGATED) =====

    async saveQRScan(sessionId, payload) {
        return await this.qrscans.saveQRScan(sessionId, payload);
    }

    async getQRScansBySession(sessionId, limit = 50) {
        return await this.qrscans.getQRScansBySession(sessionId, limit);
    }

    async getQRScanById(scanId) {
        return await this.qrscans.getQRScanById(scanId);
    }

    async getRecentQRScans(limit = 20) {
        return await this.qrscans.getRecentQRScans(limit);
    }

    async getQrScansWithSessionType(sessionId = null, sessionTypeName = null) {
        return await this.qrscans.getQrScansWithSessionType(sessionId, sessionTypeName);
    }

    async getQRScanStats(sessionId = null) {
        return await this.qrscans.getQRScanStats(sessionId);
    }

    async searchQRScans(searchTerm, sessionId = null, limit = 20) {
        return await this.qrscans.searchQRScans(searchTerm, sessionId, limit);
    }

    async checkQRDuplicate(payload, timeWindowHours = 0.17) {
        return await this.qrscans.checkQRDuplicate(payload, timeWindowHours);
    }

    async checkForDuplicates(rawPayload, sessionId, minutesBack = 10) {
        return await this.qrscans.checkForDuplicates(rawPayload, sessionId, minutesBack);
    }

    // Alias for backwards compatibility
    async getSessionScans(sessionId, limit = 50) {
        return await this.qrscans.getSessionScans(sessionId, limit);
    }

    // ===== STATISTICS OPERATIONS (DELEGATED) =====

    async getDailyStats(date = null) {
        return await this.stats.getDailyStats(date);
    }

    async getRecentActivity(hours = 8) {
        return await this.stats.getRecentActivity(hours);
    }

    async getUserStatsDetailed(userId = null, startDate = null, endDate = null) {
        return await this.stats.getUserStats(userId, startDate, endDate);
    }

    async getHourlyActivity(date = null) {
        return await this.stats.getHourlyActivity(date);
    }

    async getWeeklyTrends(weeks = 4) {
        return await this.stats.getWeeklyTrends(weeks);
    }

    async getPerformanceMetrics(startDate = null, endDate = null) {
        return await this.stats.getPerformanceMetrics(startDate, endDate);
    }

    async getTopPerformers(metric = 'scans', limit = 10, startDate = null, endDate = null) {
        return await this.stats.getTopPerformers(metric, limit, startDate, endDate);
    }

    async getDashboardData(timeframe = 'today') {
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
                    AVG(DATEDIFF(MINUTE, StartTime, GETDATE())) as AvgSessionDurationMinutes,
                    SUM(qr.ScanCount) as TotalActiveScans
                FROM Sessions s
                LEFT JOIN (
                    SELECT SessionID, COUNT(*) as ScanCount
                    FROM QrScans
                    WHERE ScanTime >= DATEADD(DAY, -1, GETDATE())
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
                        StartTime,
                        LEAD(StartTime) OVER (PARTITION BY UserID ORDER BY StartTime) as NextStartTime,
                        DATEDIFF(MINUTE, StartTime, ISNULL(EndTime, GETDATE())) as DurationMinutes
                    FROM Sessions
                    WHERE StartTime >= DATEADD(DAY, -?, GETDATE())
                )
                SELECT 
                    COUNT(*) as TotalSessions,
                    COUNT(CASE WHEN DurationMinutes < 2 AND NextStartTime IS NOT NULL 
                               AND DATEDIFF(MINUTE, StartTime, NextStartTime) < 5 
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
        return await this.health.healthCheck();
    }

    async testConnection() {
        return await this.health.testConnection();
    }

    getConnectionStatus() {
        return this.health.getConnectionStatus();
    }

    async debugInfo() {
        const baseInfo = await this.health.debugInfo();

        // Wareneinlagerung-spezifische Debug-Informationen hinzufügen
        const wareneinlagerungInfo = {
            multiSessionMode: this.multiSessionMode,
            allowSessionRestart: this.allowSessionRestart,
            parallelSessionStats: await this.getParallelSessionStats(),
            sessionRestartStats: await this.getSessionRestartStats(1) // Letzte 24h
        };

        return {
            ...baseInfo,
            wareneinlagerung: wareneinlagerungInfo
        };
    }

    async getPerformanceStats() {
        return await this.health.getPerformanceStats();
    }

    async getDatabaseSize() {
        return await this.health.getDatabaseSize();
    }

    async getTableSizes() {
        return await this.health.getTableSizes();
    }

    async checkSystemHealth() {
        const baseHealth = await this.health.checkSystemHealth();

        // Wareneinlagerung-spezifische Gesundheitsprüfungen
        try {
            const parallelStats = await this.getParallelSessionStats();
            const wareneinlagerungHealth = {
                parallelSessionsOperational: parallelStats.activeSessionCount >= 0,
                multiUserMode: this.multiSessionMode,
                sessionRestartEnabled: this.allowSessionRestart,
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
                    parallelSessionsOperational: false
                }
            };
        }
    }

    async getSystemReport() {
        const baseReport = await this.health.getSystemReport();

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
        return await SessionTypeConstants.setupSessionTypes(this.connection);
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
                    avgSessionDuration: parallelStats.avgSessionDurationMinutes
                },
                activeSessions: activeSessions.map(session => ({
                    sessionId: session.ID,
                    userId: session.UserID,
                    userName: session.UserName,
                    department: session.Department,
                    startTime: session.StartTime,
                    scanCount: session.ScanCount,
                    durationMinutes: Math.round((new Date() - new Date(session.StartTime)) / (1000 * 60))
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
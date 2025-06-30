// Console-Utils für bessere Ausgabe - mit Fallback
let customConsole;
try {
    customConsole = require('../../utils/console-utils');
} catch (error) {
    customConsole = {
        success: (msg, ...args) => console.log('[OK]', msg, ...args),
        error: (msg, ...args) => console.error('[ERROR]', msg, ...args),
        warning: (msg, ...args) => console.warn('[WARN]', msg, ...args),
        info: (msg, ...args) => console.log('[INFO]', msg, ...args),
        database: (msg, ...args) => console.log('[DB]', msg, ...args),
        log: (level, msg, ...args) => console.log(`[${level.toUpperCase()}]`, msg, ...args)
    };
}

/**
 * Session Management Module
 * Handles session creation, management, and SessionType operations
 * KORRIGIERT für Wareneinlagerung mit automatischem SessionTypes Setup
 */
class SessionModule {
    constructor(dbConnection, utils) {
        this.db = dbConnection;
        this.utils = utils;
    }

    // ===== SESSION MANAGEMENT MIT SESSIONTYPE-UNTERSTÜTZUNG =====

    /**
     * Erweiterte createSession Methode mit SessionType-Unterstützung
     * @param {number} userId - Benutzer-ID
     * @param {number|string} sessionType - SessionType ID oder Name (default: 'Wareneinlagerung')
     * @returns {Object|null} - Neue Session oder null bei Fehler
     */
    async createSession(userId, sessionType = 'Wareneinlagerung') {
        try {
            customConsole.info(`Session wird erstellt für User ${userId}, SessionType: ${sessionType}`);

            // Bestehende aktive Sessions für diesen User beenden (für Single-User Modus)
            // In Wareneinlagerung-Modus normalerweise nicht erforderlich, aber als Sicherheit
            await this.db.query(`
                UPDATE dbo.Sessions
                SET EndTS = SYSDATETIME(), Active = 0
                WHERE UserID = ? AND Active = 1
            `, [userId]);

            // SessionType ID ermitteln
            let sessionTypeId;

            if (typeof sessionType === 'number') {
                // SessionType ist bereits eine ID
                sessionTypeId = sessionType;
            } else {
                // SessionType Name zu ID konvertieren
                const typeResult = await this.db.query(`
                    SELECT ID FROM dbo.SessionTypes
                    WHERE TypeName = ? AND IsActive = 1
                `, [sessionType]);

                if (typeResult.recordset.length === 0) {
                    // Versuche zuerst SessionTypes Setup falls noch nicht vorhanden
                    customConsole.warning(`SessionType '${sessionType}' nicht gefunden - versuche automatisches Setup...`);

                    try {
                        const { setupSessionTypes } = require('../constants/session-types');
                        const setupSuccess = await setupSessionTypes(this.db);

                        if (setupSuccess) {
                            // Nochmal versuchen
                            const retryResult = await this.db.query(`
                                SELECT ID FROM dbo.SessionTypes
                                WHERE TypeName = ? AND IsActive = 1
                            `, [sessionType]);

                            if (retryResult.recordset.length > 0) {
                                sessionTypeId = retryResult.recordset[0].ID;
                                customConsole.success(`SessionType '${sessionType}' nach automatischem Setup gefunden`);
                            } else {
                                throw new Error(`SessionType '${sessionType}' auch nach Setup nicht gefunden`);
                            }
                        } else {
                            throw new Error(`SessionType '${sessionType}' nicht gefunden und automatisches Setup fehlgeschlagen`);
                        }
                    } catch (setupError) {
                        customConsole.error('Automatisches SessionTypes Setup fehlgeschlagen:', setupError);
                        throw new Error(`SessionType '${sessionType}' nicht gefunden`);
                    }
                } else {
                    sessionTypeId = typeResult.recordset[0].ID;
                }
            }

            // Neue Session erstellen mit SessionType
            const result = await this.db.query(`
                INSERT INTO dbo.Sessions (UserID, StartTS, Active, SessionTypeID)
                    OUTPUT INSERTED.ID, INSERTED.StartTS, INSERTED.SessionTypeID
                VALUES (?, SYSDATETIME(), 1, ?)
            `, [userId, sessionTypeId]);

            if (result.recordset.length > 0) {
                const session = result.recordset[0];

                // SessionType-Info für Rückgabe laden
                const sessionWithType = await this.getSessionWithType(session.ID);

                customConsole.success(`Session erstellt: ID ${session.ID}, Type: ${sessionWithType.SessionTypeName}, Start: ${session.StartTS}`);
                return sessionWithType;
            }
            return null;
        } catch (error) {
            customConsole.error('Fehler beim Erstellen der Session:', error);
            return null;
        }
    }

    /**
     * ===== NEUE METHODE: ALLE AKTIVEN SESSIONS BEENDEN =====
     * Beendet alle aktiven Sessions - verwendet für Single-User-Mode
     * @returns {Object} - Anzahl beendeter Sessions und Liste der betroffenen Benutzer
     */
    async endAllActiveSessions() {
        try {
            customConsole.info('Beende alle aktiven Sessions...');

            // Erst die aktuell aktiven Sessions abrufen (für Logging/Events)
            const activeSessionsResult = await this.db.query(`
                SELECT
                    s.ID as SessionID,
                    s.UserID,
                    u.BenutzerName,
                    s.StartTS
                FROM dbo.Sessions s
                         INNER JOIN dbo.ScannBenutzer u ON s.UserID = u.ID
                WHERE s.Active = 1
            `);

            const activeSessions = activeSessionsResult.recordset;

            if (activeSessions.length === 0) {
                customConsole.info('Keine aktiven Sessions gefunden');
                return {
                    success: true,
                    endedCount: 0,
                    endedUsers: []
                };
            }

            // Alle aktiven Sessions beenden
            const endResult = await this.db.query(`
                UPDATE dbo.Sessions
                SET EndTS = SYSDATETIME(), Active = 0
                WHERE Active = 1
            `);

            const endedCount = endResult.rowsAffected && endResult.rowsAffected[0] || 0;

            customConsole.success(`${endedCount} aktive Session(s) beendet`);

            // Return-Objekt mit Details für Event-Handling
            return {
                success: true,
                endedCount: endedCount,
                endedUsers: activeSessions.map(session => ({
                    sessionId: session.SessionID,
                    userId: session.UserID,
                    userName: session.BenutzerName,
                    startTime: this.utils.normalizeTimestamp(session.StartTS)
                }))
            };

        } catch (error) {
            customConsole.error('Fehler beim Beenden aller aktiven Sessions:', error);
            return {
                success: false,
                endedCount: 0,
                endedUsers: [],
                error: error.message
            };
        }
    }

    /**
     * Session mit SessionType-Informationen abrufen
     * @param {number} sessionId - Session ID
     * @returns {Object|null} - Session mit SessionType-Details
     */
    async getSessionWithType(sessionId) {
        try {
            const result = await this.db.query(`
                SELECT
                    s.ID,
                    s.UserID,
                    s.StartTS,
                    s.EndTS,
                    s.Active,
                    s.SessionTypeID,
                    st.TypeName as SessionTypeName,
                    st.Description as SessionTypeDescription,
                    DATEDIFF(SECOND, s.StartTS, ISNULL(s.EndTS, SYSDATETIME())) as DurationSeconds
                FROM dbo.Sessions s
                         LEFT JOIN dbo.SessionTypes st ON s.SessionTypeID = st.ID
                WHERE s.ID = ?
            `, [sessionId]);

            if (result.recordset.length > 0) {
                const session = result.recordset[0];
                return {
                    ...session,
                    StartTS: this.utils.normalizeTimestamp(session.StartTS),
                    EndTS: session.EndTS ? this.utils.normalizeTimestamp(session.EndTS) : null
                };
            }
            return null;
        } catch (error) {
            customConsole.error('Fehler beim Abrufen der Session:', error);
            return null;
        }
    }

    /**
     * Alle aktiven Sessions mit SessionType-Informationen abrufen
     * @returns {Array} - Array von aktiven Sessions mit SessionType-Details
     */
    async getActiveSessionsWithType() {
        try {
            const result = await this.db.query(`
                SELECT
                    s.ID,
                    s.UserID,
                    s.StartTS,
                    s.SessionTypeID,
                    st.TypeName as SessionTypeName,
                    st.Description as SessionTypeDescription,
                    sb.Vorname,
                    sb.Nachname,
                    sb.Benutzer,
                    sb.BenutzerName,
                    DATEDIFF(SECOND, s.StartTS, SYSDATETIME()) as DurationSeconds
                FROM dbo.Sessions s
                         LEFT JOIN dbo.SessionTypes st ON s.SessionTypeID = st.ID
                         LEFT JOIN dbo.ScannBenutzer sb ON s.UserID = sb.ID
                WHERE s.Active = 1
                ORDER BY s.StartTS ASC
            `);

            return result.recordset.map(session => ({
                ...session,
                StartTS: this.utils.normalizeTimestamp(session.StartTS),
                FullName: `${session.Vorname || ''} ${session.Nachname || ''}`.trim()
            }));
        } catch (error) {
            customConsole.error('Fehler beim Abrufen aktiver Sessions:', error);
            return [];
        }
    }

    async endSession(sessionId) {
        try {
            customConsole.info(`Beende Session: ${sessionId}`);

            const result = await this.db.query(`
                UPDATE dbo.Sessions
                SET EndTS = SYSDATETIME(), Active = 0
                WHERE ID = ? AND Active = 1
            `, [sessionId]);

            const success = result.rowsAffected && result.rowsAffected[0] > 0;

            if (success) {
                customConsole.success(`Session ${sessionId} erfolgreich beendet`);
            } else {
                customConsole.warning(`Session ${sessionId} war bereits beendet oder nicht gefunden`);
            }

            return success;
        } catch (error) {
            customConsole.error('Fehler beim Beenden der Session:', error);
            return false;
        }
    }

    async getActiveSession(userId) {
        try {
            const result = await this.db.query(`
                SELECT ID, StartTS,
                       DATEDIFF(SECOND, StartTS, SYSDATETIME()) as DurationSeconds
                FROM dbo.Sessions
                WHERE UserID = ? AND Active = 1
            `, [userId]);

            if (result.recordset.length > 0) {
                const session = result.recordset[0];
                return {
                    ...session,
                    StartTS: this.utils.normalizeTimestamp(session.StartTS)
                };
            }

            return null;
        } catch (error) {
            customConsole.error('Fehler beim Abrufen der aktiven Session:', error);
            return null;
        }
    }

    async getSessionDuration(sessionId) {
        try {
            const result = await this.db.query(`
                SELECT
                    ID,
                    StartTS,
                    EndTS,
                    Active,
                    DATEDIFF(SECOND, StartTS, ISNULL(EndTS, SYSDATETIME())) as DurationSeconds
                FROM dbo.Sessions
                WHERE ID = ?
            `, [sessionId]);

            if (result.recordset.length === 0) {
                return null;
            }

            const session = result.recordset[0];
            return {
                sessionId: session.ID,
                startTime: this.utils.normalizeTimestamp(session.StartTS),
                endTime: session.EndTS ? this.utils.normalizeTimestamp(session.EndTS) : null,
                duration: session.DurationSeconds * 1000, // in Millisekunden
                isActive: session.Active === 1,
                formattedDuration: this.utils.formatSessionDuration(session.DurationSeconds)
            };
        } catch (error) {
            customConsole.error('Fehler beim Abrufen der Session-Dauer:', error);
            return null;
        }
    }

    // ===== SESSIONTYPE OPERATIONS =====

    /**
     * Alle verfügbaren SessionTypes abrufen
     * @returns {Array} - Array von verfügbaren SessionTypes
     */
    async getSessionTypes() {
        try {
            const result = await this.db.query(`
                SELECT ID, TypeName, Description
                FROM dbo.SessionTypes
                WHERE IsActive = 1
                ORDER BY TypeName
            `);

            return result.recordset;
        } catch (error) {
            customConsole.error('Fehler beim Abrufen der SessionTypes:', error);
            return [];
        }
    }

    /**
     * SessionType-Statistiken abrufen
     * @param {Date} startDate - Startdatum für Statistik (optional)
     * @param {Date} endDate - Enddatum für Statistik (optional)
     * @returns {Array} - Statistiken pro SessionType
     */
    async getSessionTypeStats(startDate = null, endDate = null) {
        try {
            let whereClause = '';
            let params = [];

            if (startDate && endDate) {
                whereClause = 'WHERE s.StartTS >= ? AND s.StartTS <= ?';
                params = [startDate, endDate];
            }

            const result = await this.db.query(`
                SELECT
                    st.TypeName,
                    st.Description,
                    COUNT(s.ID) as TotalSessions,
                    COUNT(CASE WHEN s.Active = 1 THEN 1 END) as ActiveSessions,
                    AVG(CASE WHEN s.EndTS IS NOT NULL
                                 THEN DATEDIFF(SECOND, s.StartTS, s.EndTS)
                             ELSE NULL END) as AvgDurationSeconds,
                    SUM(CASE WHEN s.EndTS IS NOT NULL
                                 THEN DATEDIFF(SECOND, s.StartTS, s.EndTS)
                             ELSE 0 END) as TotalDurationSeconds
                FROM dbo.SessionTypes st
                         LEFT JOIN dbo.Sessions s ON st.ID = s.SessionTypeID ${whereClause}
                GROUP BY st.ID, st.TypeName, st.Description
                ORDER BY TotalSessions DESC
            `, params);

            return result.recordset.map(stat => ({
                ...stat,
                AvgDurationMinutes: stat.AvgDurationSeconds ? Math.round(stat.AvgDurationSeconds / 60) : 0,
                TotalDurationHours: Math.round(stat.TotalDurationSeconds / 3600 * 100) / 100
            }));
        } catch (error) {
            customConsole.error('Fehler beim Abrufen der SessionType-Statistiken:', error);
            return [];
        }
    }

    // ===== WARENEINLAGERUNG-SPEZIFISCHE METHODEN =====

    /**
     * WARENEINLAGERUNG: Session für Benutzer neu starten (Timer zurücksetzen)
     * @param {number} sessionId - Session ID
     * @param {number} userId - Benutzer ID (für Validierung)
     * @returns {Object|null} - Aktualisierte Session-Daten
     */
    async restartSession(sessionId, userId) {
        try {
            customConsole.info(`Session ${sessionId} wird für Benutzer ${userId} neu gestartet...`);

            const result = await this.db.query(`
                UPDATE dbo.Sessions 
                SET StartTS = SYSDATETIME()
                OUTPUT INSERTED.ID, INSERTED.UserID, INSERTED.StartTS, INSERTED.Active, INSERTED.SessionTypeID
                WHERE ID = ? AND UserID = ? AND Active = 1
            `, [sessionId, userId]);

            if (result.recordset.length === 0) {
                customConsole.warning(`Session ${sessionId} für Benutzer ${userId} nicht gefunden oder nicht aktiv`);
                return null;
            }

            const updatedSession = result.recordset[0];

            // Session mit Typ-Informationen abrufen für vollständige Rückgabe
            const sessionWithType = await this.getSessionWithType(sessionId);

            customConsole.success(`Session ${sessionId} erfolgreich neu gestartet für Benutzer ${userId}`);
            return sessionWithType;

        } catch (error) {
            customConsole.error('Fehler beim Neustarten der Session:', error);
            return null;
        }
    }

    /**
     * WARENEINLAGERUNG: Prüft ob Benutzer bereits aktive Session hat
     * @param {number} userId - Benutzer ID
     * @returns {Object|null} - Aktive Session oder null
     */
    async getActiveSessionByUserId(userId) {
        try {
            const result = await this.db.query(`
                SELECT 
                    s.ID, 
                    s.UserID, 
                    s.StartTS, 
                    s.EndTS, 
                    s.Active,
                    s.SessionTypeID,
                    st.TypeName as SessionTypeName,
                    u.BenutzerName as UserName
                FROM dbo.Sessions s
                LEFT JOIN dbo.SessionTypes st ON s.SessionTypeID = st.ID
                INNER JOIN dbo.ScannBenutzer u ON s.UserID = u.ID
                WHERE s.UserID = ? AND s.Active = 1
                ORDER BY s.StartTS DESC
            `, [userId]);

            if (result.recordset.length === 0) {
                return null;
            }

            const session = result.recordset[0];
            return {
                ID: session.ID,
                UserID: session.UserID,
                UserName: session.UserName,
                SessionTypeID: session.SessionTypeID,
                SessionTypeName: session.SessionTypeName,
                StartTS: this.utils.normalizeTimestamp(session.StartTS),
                EndTS: session.EndTS ? this.utils.normalizeTimestamp(session.EndTS) : null,
                Active: session.Active
            };

        } catch (error) {
            customConsole.error('Fehler beim Abrufen der aktiven Session für Benutzer:', error);
            return null;
        }
    }

    /**
     * WARENEINLAGERUNG: Erweiterte Session-Informationen mit Scan-Counts
     * @param {number} sessionId - Session ID
     * @returns {Object|null} - Erweiterte Session-Informationen
     */
    async getSessionDetails(sessionId) {
        try {
            const result = await this.db.query(`
                SELECT
                    s.ID,
                    s.UserID,
                    s.StartTS,
                    s.EndTS,
                    s.Active,
                    s.SessionTypeID,
                    st.TypeName as SessionTypeName,
                    st.Description as SessionTypeDescription,
                    u.BenutzerName as UserName,
                    u.Vorname,
                    u.Nachname,
                    DATEDIFF(SECOND, s.StartTS, ISNULL(s.EndTS, SYSDATETIME())) as DurationSeconds,
                    COUNT(qr.ID) as TotalScans,
                    COUNT(CASE WHEN qr.DecodedPayload IS NOT NULL AND qr.DecodedPayload != '{}' THEN 1 END) as ValidScans,
                    MAX(qr.CapturedTS) as LastScanTime
                FROM dbo.Sessions s
                LEFT JOIN dbo.SessionTypes st ON s.SessionTypeID = st.ID
                LEFT JOIN dbo.ScannBenutzer u ON s.UserID = u.ID
                LEFT JOIN dbo.QrScans qr ON s.ID = qr.SessionID
                WHERE s.ID = ?
                GROUP BY s.ID, s.UserID, s.StartTS, s.EndTS, s.Active, s.SessionTypeID, 
                         st.TypeName, st.Description, u.BenutzerName, u.Vorname, u.Nachname
            `, [sessionId]);

            if (result.recordset.length === 0) {
                return null;
            }

            const session = result.recordset[0];
            return {
                ...session,
                StartTS: this.utils.normalizeTimestamp(session.StartTS),
                EndTS: session.EndTS ? this.utils.normalizeTimestamp(session.EndTS) : null,
                LastScanTime: session.LastScanTime ? this.utils.normalizeTimestamp(session.LastScanTime) : null,
                FullName: `${session.Vorname || ''} ${session.Nachname || ''}`.trim(),
                FormattedDuration: this.utils.formatSessionDuration(session.DurationSeconds)
            };
        } catch (error) {
            customConsole.error('Fehler beim Abrufen der Session-Details:', error);
            return null;
        }
    }

    /**
     * Setup SessionTypes falls noch nicht vorhanden
     * @returns {boolean} - Success
     */
    async ensureSessionTypesExist() {
        try {
            customConsole.info('Prüfe SessionTypes-Verfügbarkeit...');

            // Prüfe ob SessionTypes Tabelle existiert und SessionTypes vorhanden sind
            const typesResult = await this.db.query(`
                SELECT COUNT(*) as count FROM dbo.SessionTypes WHERE IsActive = 1
            `);

            const existingTypesCount = typesResult.recordset[0].count;

            if (existingTypesCount === 0) {
                customConsole.info('Keine SessionTypes gefunden - führe automatisches Setup aus...');

                const { setupSessionTypes } = require('../constants/session-types');
                const setupSuccess = await setupSessionTypes(this.db);

                if (setupSuccess) {
                    customConsole.success('SessionTypes automatisch eingerichtet');
                    return true;
                } else {
                    customConsole.error('Automatisches SessionTypes Setup fehlgeschlagen');
                    return false;
                }
            } else {
                customConsole.info(`${existingTypesCount} SessionTypes bereits vorhanden`);
                return true;
            }

        } catch (error) {
            customConsole.error('Fehler beim Prüfen/Einrichten der SessionTypes:', error);
            return false;
        }
    }
}

module.exports = SessionModule;
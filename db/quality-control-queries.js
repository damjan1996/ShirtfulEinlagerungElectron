/**
 * Quality Control Database Queries Module
 * Specialized SQL queries for Quality Control operations
 * Handles QualityControlSteps table operations and complex QC workflows
 *
 * Features:
 * - QC step creation and completion
 * - Active QC step tracking
 * - QC statistics and reporting
 * - Overdue detection
 * - Session integration
 * - Performance optimized queries
 */

class QualityControlQueries {
    constructor(dbConnection, dbUtils) {
        this.connection = dbConnection;
        this.utils = dbUtils;

        // Query Cache für bessere Performance
        this.queryCache = new Map();
        this.cacheTimeout = 30000; // 30 Sekunden

        console.log('🔍 QualityControlQueries Module initialisiert');
    }

    // ===== QC STEP CREATION & MANAGEMENT =====

    /**
     * Startet neuen QC-Schritt (Stored Procedure)
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {number} startScanId - Start-Scan ID
     * @param {number} priority - Priorität (1-3)
     * @param {number} estimatedMinutes - Geschätzte Dauer
     * @param {string} processingLocation - Bearbeitungsort
     * @param {number} createdByUserId - Ersteller Benutzer ID
     * @returns {Object} - Ergebnis mit QC-Step ID
     */
    async startQualityControlStep(sessionId, qrCode, startScanId, priority = 1, estimatedMinutes = null, processingLocation = null, createdByUserId = null) {
        try {
            // Validierung
            if (!sessionId || !qrCode || !startScanId) {
                throw new Error('Fehlende Parameter für QC-Schritt-Start');
            }

            // Prüfe ob bereits aktiver QC-Schritt existiert
            const existingStep = await this.getActiveQCStepByQRCode(qrCode);
            if (existingStep) {
                throw new Error(`QC-Schritt für QR-Code ${qrCode} bereits aktiv`);
            }

            // Stored Procedure ausführen
            const result = await this.connection.query(`
                DECLARE @QualityControlStepID INT;
                
                EXEC SP_StartQualityControlStep 
                    @SessionID = ?, 
                    @QrCode = ?, 
                    @StartScanID = ?, 
                    @Priority = ?, 
                    @EstimatedMinutes = ?, 
                    @ProcessingLocation = ?, 
                    @CreatedByUserID = ?,
                    @QualityControlStepID = @QualityControlStepID OUTPUT;
                    
                SELECT @QualityControlStepID as QCStepID;
            `, [sessionId, qrCode, startScanId, priority, estimatedMinutes, processingLocation, createdByUserId]);

            const qcStepId = result.recordset[0]?.QCStepID;

            if (!qcStepId) {
                // Fallback: Direkte Erstellung wenn Stored Procedure nicht verfügbar
                const insertResult = await this.connection.query(`
                    INSERT INTO QualityControlSteps (
                        SessionID, QrCode, StartScanID, Priority,
                        EstimatedDurationMinutes, ProcessingLocation, CreatedByUserID
                    )
                    OUTPUT INSERTED.ID
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [sessionId, qrCode, startScanId, priority, estimatedMinutes, processingLocation, createdByUserId]);

                const fallbackId = insertResult.recordset[0]?.ID;
                if (!fallbackId) {
                    throw new Error('QC-Schritt konnte nicht erstellt werden');
                }

                console.log(`✅ QC-Schritt direkt erstellt (Fallback): ID=${fallbackId}`);
                return {
                    success: true,
                    qcStepId: fallbackId,
                    message: 'QC-Schritt erfolgreich gestartet (Fallback)'
                };
            }

            console.log(`✅ QC-Schritt über SP erstellt: ID=${qcStepId}`);
            return {
                success: true,
                qcStepId: qcStepId,
                message: 'QC-Schritt erfolgreich gestartet'
            };

        } catch (error) {
            console.error('❌ Fehler beim QC-Schritt-Start:', error);
            return {
                success: false,
                qcStepId: null,
                message: `Fehler beim QC-Start: ${error.message}`
            };
        }
    }

    /**
     * Schließt QC-Schritt ab (Stored Procedure)
     * @param {string} qrCode - QR-Code
     * @param {number} endScanId - End-Scan ID
     * @param {number} completedByUserId - Abschließender Benutzer
     * @param {number} qualityRating - Qualitätsbewertung (1-5)
     * @param {string} qualityNotes - Qualitätsnotizen
     * @param {boolean} defectsFound - Mängel gefunden
     * @param {string} defectDescription - Mängel-Beschreibung
     * @param {boolean} reworkRequired - Nacharbeit erforderlich
     * @returns {Object} - Ergebnis mit Dauer
     */
    async completeQualityControlStep(qrCode, endScanId, completedByUserId = null, qualityRating = null, qualityNotes = null, defectsFound = false, defectDescription = null, reworkRequired = false) {
        try {
            // Validierung
            if (!qrCode || !endScanId) {
                throw new Error('Fehlende Parameter für QC-Schritt-Abschluss');
            }

            // Prüfe ob aktiver QC-Schritt existiert
            const existingStep = await this.getActiveQCStepByQRCode(qrCode);
            if (!existingStep) {
                throw new Error(`Kein aktiver QC-Schritt für QR-Code ${qrCode} gefunden`);
            }

            // Stored Procedure ausführen
            const result = await this.connection.query(`
                DECLARE @QualityControlStepID INT, @SessionID INT;
                
                EXEC SP_CompleteQualityControlStep 
                    @QrCode = ?, 
                    @EndScanID = ?, 
                    @CompletedByUserID = ?, 
                    @QualityRating = ?, 
                    @QualityNotes = ?, 
                    @DefectsFound = ?, 
                    @DefectDescription = ?, 
                    @ReworkRequired = ?,
                    @QualityControlStepID = @QualityControlStepID OUTPUT,
                    @SessionID = @SessionID OUTPUT;
                    
                SELECT @QualityControlStepID as QCStepID, @SessionID as SessionID;
            `, [qrCode, endScanId, completedByUserId, qualityRating, qualityNotes, defectsFound, defectDescription, reworkRequired]);

            let qcStepId = result.recordset[0]?.QCStepID;
            let sessionId = result.recordset[0]?.SessionID;

            if (!qcStepId) {
                // Fallback: Direkte Aktualisierung
                const updateResult = await this.connection.query(`
                    UPDATE QualityControlSteps
                    SET EndScanID = ?,
                        EndTime = GETDATE(),
                        Completed = 1,
                        QCStatus = 'completed',
                        CompletedByUserID = ?,
                        QualityRating = ?,
                        QualityNotes = ?,
                        DefectsFound = ?,
                        DefectDescription = ?,
                        ReworkRequired = ?
                    OUTPUT INSERTED.ID, INSERTED.SessionID,
                           DATEDIFF(MINUTE, INSERTED.StartTime, INSERTED.EndTime) as DurationMinutes
                    WHERE QrCode = ? AND QCStatus = 'active' AND Completed = 0
                `, [endScanId, completedByUserId, qualityRating, qualityNotes, defectsFound, defectDescription, reworkRequired, qrCode]);

                if (updateResult.recordset.length === 0) {
                    throw new Error('QC-Schritt konnte nicht abgeschlossen werden');
                }

                qcStepId = updateResult.recordset[0].ID;
                sessionId = updateResult.recordset[0].SessionID;
                const durationMinutes = updateResult.recordset[0].DurationMinutes;

                console.log(`✅ QC-Schritt direkt abgeschlossen (Fallback): ID=${qcStepId}`);
                return {
                    success: true,
                    qcStepId: qcStepId,
                    sessionId: sessionId,
                    durationMinutes: durationMinutes,
                    message: 'QC-Schritt erfolgreich abgeschlossen (Fallback)'
                };
            }

            // Dauer berechnen für SP-Ergebnis
            const durationResult = await this.connection.query(`
                SELECT DATEDIFF(MINUTE, StartTime, EndTime) as DurationMinutes
                FROM QualityControlSteps
                WHERE ID = ?
            `, [qcStepId]);

            const durationMinutes = durationResult.recordset[0]?.DurationMinutes || 0;

            console.log(`✅ QC-Schritt über SP abgeschlossen: ID=${qcStepId}`);
            return {
                success: true,
                qcStepId: qcStepId,
                sessionId: sessionId,
                durationMinutes: durationMinutes,
                message: 'QC-Schritt erfolgreich abgeschlossen'
            };

        } catch (error) {
            console.error('❌ Fehler beim QC-Schritt-Abschluss:', error);
            return {
                success: false,
                qcStepId: null,
                sessionId: null,
                durationMinutes: 0,
                message: `Fehler beim QC-Abschluss: ${error.message}`
            };
        }
    }

    // ===== QC STEP QUERIES =====

    /**
     * Gibt aktiven QC-Schritt für QR-Code zurück
     * @param {string} qrCode - QR-Code
     * @returns {Object|null} - QC-Schritt oder null
     */
    async getActiveQCStepByQRCode(qrCode) {
        try {
            const result = await this.connection.query(`
                SELECT TOP 1 * 
                FROM QualityControlSteps 
                WHERE QrCode = ? AND QCStatus = 'active' AND Completed = 0
                ORDER BY StartTime DESC
            `, [qrCode]);

            return result.recordset.length > 0 ? result.recordset[0] : null;

        } catch (error) {
            console.error('❌ Fehler beim Abrufen aktiver QC-Schritt:', error);
            return null;
        }
    }

    /**
     * Gibt QC-Schritt nach ID zurück
     * @param {number} qcStepId - QC-Schritt ID
     * @returns {Object|null} - QC-Schritt oder null
     */
    async getQCStepById(qcStepId) {
        try {
            const result = await this.connection.query(`
                SELECT qcs.*, 
                       s.UserID, s.StartTS as SessionStartTime,
                       u.BenutzerName as UserName,
                       qs_start.CapturedTS as StartScanTime,
                       qs_end.CapturedTS as EndScanTime
                FROM QualityControlSteps qcs
                INNER JOIN Sessions s ON qcs.SessionID = s.ID
                INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                LEFT JOIN QrScans qs_start ON qcs.StartScanID = qs_start.ID
                LEFT JOIN QrScans qs_end ON qcs.EndScanID = qs_end.ID
                WHERE qcs.ID = ?
            `, [qcStepId]);

            if (result.recordset.length === 0) return null;

            const step = result.recordset[0];
            return {
                ...step,
                StartTime: this.utils.normalizeTimestamp(step.StartTime),
                EndTime: step.EndTime ? this.utils.normalizeTimestamp(step.EndTime) : null,
                SessionStartTime: this.utils.normalizeTimestamp(step.SessionStartTime),
                StartScanTime: step.StartScanTime ? this.utils.normalizeTimestamp(step.StartScanTime) : null,
                EndScanTime: step.EndScanTime ? this.utils.normalizeTimestamp(step.EndScanTime) : null
            };

        } catch (error) {
            console.error('❌ Fehler beim Abrufen QC-Schritt by ID:', error);
            return null;
        }
    }

    /**
     * Gibt alle aktiven QC-Schritte zurück (mit View)
     * @returns {Array} - Array aktiver QC-Schritte
     */
    async getAllActiveQCSteps() {
        try {
            const result = await this.connection.query(`
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
            console.error('❌ Fehler beim Abrufen aller aktiven QC-Schritte:', error);
            return [];
        }
    }

    /**
     * Gibt aktive QC-Schritte für Session zurück
     * @param {number} sessionId - Session ID
     * @returns {Array} - Array aktiver QC-Schritte
     */
    async getActiveQCStepsForSession(sessionId) {
        try {
            const result = await this.connection.query(`
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
            console.error('❌ Fehler beim Abrufen aktiver QC-Schritte für Session:', error);
            return [];
        }
    }

    /**
     * Gibt aktive QC-Schritte für Benutzer zurück
     * @param {number} userId - Benutzer ID
     * @returns {Array} - Array aktiver QC-Schritte
     */
    async getActiveQCStepsForUser(userId) {
        try {
            const result = await this.connection.query(`
                SELECT qcs.* FROM VW_ActiveQualityControlSteps qcs
                WHERE qcs.UserID = ?
                ORDER BY qcs.StartTime ASC
            `, [userId]);

            return result.recordset.map(step => ({
                ...step,
                StartTime: this.utils.normalizeTimestamp(step.StartTime),
                SessionStartTime: this.utils.normalizeTimestamp(step.SessionStartTime),
                StartScanTime: step.StartScanTime ? this.utils.normalizeTimestamp(step.StartScanTime) : null
            }));

        } catch (error) {
            console.error('❌ Fehler beim Abrufen aktiver QC-Schritte für Benutzer:', error);
            return [];
        }
    }

    /**
     * Gibt überfällige QC-Schritte zurück
     * @param {number} overdueThresholdMinutes - Überfällig-Schwellwert in Minuten
     * @returns {Array} - Array überfälliger QC-Schritte
     */
    async getOverdueQCSteps(overdueThresholdMinutes = 30) {
        try {
            const result = await this.connection.query(`
                SELECT * FROM VW_ActiveQualityControlSteps 
                WHERE MinutesInProgress > ?
                ORDER BY MinutesInProgress DESC
            `, [overdueThresholdMinutes]);

            return result.recordset.map(step => ({
                ...step,
                StartTime: this.utils.normalizeTimestamp(step.StartTime),
                SessionStartTime: this.utils.normalizeTimestamp(step.SessionStartTime),
                StartScanTime: step.StartScanTime ? this.utils.normalizeTimestamp(step.StartScanTime) : null
            }));

        } catch (error) {
            console.error('❌ Fehler beim Abrufen überfälliger QC-Schritte:', error);
            return [];
        }
    }

    // ===== QC STEP HISTORY & COMPLETED =====

    /**
     * Gibt abgeschlossene QC-Schritte für Session zurück
     * @param {number} sessionId - Session ID
     * @param {number} limit - Maximale Anzahl
     * @returns {Array} - Array abgeschlossener QC-Schritte
     */
    async getCompletedQCStepsForSession(sessionId, limit = 50) {
        try {
            const result = await this.connection.query(`
                SELECT TOP (?) qcs.*, 
                       s.UserID, u.BenutzerName as UserName,
                       qs_start.CapturedTS as StartScanTime,
                       qs_end.CapturedTS as EndScanTime,
                       DATEDIFF(MINUTE, qcs.StartTime, qcs.EndTime) as DurationMinutes
                FROM QualityControlSteps qcs
                INNER JOIN Sessions s ON qcs.SessionID = s.ID
                INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                LEFT JOIN QrScans qs_start ON qcs.StartScanID = qs_start.ID
                LEFT JOIN QrScans qs_end ON qcs.EndScanID = qs_end.ID
                WHERE qcs.SessionID = ? AND qcs.Completed = 1
                ORDER BY qcs.EndTime DESC
            `, [limit, sessionId]);

            return result.recordset.map(step => ({
                ...step,
                StartTime: this.utils.normalizeTimestamp(step.StartTime),
                EndTime: this.utils.normalizeTimestamp(step.EndTime),
                StartScanTime: step.StartScanTime ? this.utils.normalizeTimestamp(step.StartScanTime) : null,
                EndScanTime: step.EndScanTime ? this.utils.normalizeTimestamp(step.EndScanTime) : null
            }));

        } catch (error) {
            console.error('❌ Fehler beim Abrufen abgeschlossener QC-Schritte:', error);
            return [];
        }
    }

    /**
     * Gibt QC-Historie für QR-Code zurück
     * @param {string} qrCode - QR-Code
     * @param {number} limit - Maximale Anzahl
     * @returns {Array} - Array aller QC-Schritte für diesen QR-Code
     */
    async getQCHistoryForQRCode(qrCode, limit = 10) {
        try {
            const result = await this.connection.query(`
                SELECT TOP (?) qcs.*, 
                       s.UserID, u.BenutzerName as UserName,
                       qs_start.CapturedTS as StartScanTime,
                       qs_end.CapturedTS as EndScanTime,
                       CASE WHEN qcs.Completed = 1 
                            THEN DATEDIFF(MINUTE, qcs.StartTime, qcs.EndTime)
                            ELSE DATEDIFF(MINUTE, qcs.StartTime, GETDATE())
                       END as DurationMinutes
                FROM QualityControlSteps qcs
                INNER JOIN Sessions s ON qcs.SessionID = s.ID
                INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                LEFT JOIN QrScans qs_start ON qcs.StartScanID = qs_start.ID
                LEFT JOIN QrScans qs_end ON qcs.EndScanID = qs_end.ID
                WHERE qcs.QrCode = ?
                ORDER BY qcs.CreatedTS DESC
            `, [limit, qrCode]);

            return result.recordset.map(step => ({
                ...step,
                StartTime: this.utils.normalizeTimestamp(step.StartTime),
                EndTime: step.EndTime ? this.utils.normalizeTimestamp(step.EndTime) : null,
                StartScanTime: step.StartScanTime ? this.utils.normalizeTimestamp(step.StartScanTime) : null,
                EndScanTime: step.EndScanTime ? this.utils.normalizeTimestamp(step.EndScanTime) : null
            }));

        } catch (error) {
            console.error('❌ Fehler beim Abrufen QC-Historie für QR-Code:', error);
            return [];
        }
    }

    // ===== QC STATISTICS =====

    /**
     * Gibt QC-Statistiken zurück (aus View)
     * @returns {Object} - QC-Statistiken
     */
    async getQCStatistics() {
        try {
            // Verwende gecachte Statistiken wenn verfügbar
            const cacheKey = 'qc_statistics';
            const cached = this.getFromCache(cacheKey);
            if (cached) return cached;

            const result = await this.connection.query(`
                SELECT * FROM VW_QualityControlStats
            `);

            if (result.recordset.length === 0) {
                return this.getDefaultQCStatistics();
            }

            const stats = result.recordset[0];
            const formattedStats = {
                totalQCSteps: stats.TotalQCSteps || 0,
                completedQCSteps: stats.CompletedSteps || 0,
                activeQCSteps: stats.ActiveSteps || 0,
                abortedQCSteps: stats.AbortedSteps || 0,
                averageDurationMinutes: Math.round((stats.AvgDurationSeconds || 0) / 60),
                minDurationMinutes: Math.round((stats.MinDurationSeconds || 0) / 60),
                maxDurationMinutes: Math.round((stats.MaxDurationSeconds || 0) / 60),
                averageQualityRating: Math.round((stats.AvgQualityRating || 0) * 100) / 100,
                stepsWithDefects: stats.StepsWithDefects || 0,
                stepsRequiringRework: stats.StepsRequiringRework || 0,
                overdueSteps: stats.OverdueSteps || 0,
                todaySteps: stats.TodaySteps || 0,
                todayCompletedSteps: stats.TodayCompletedSteps || 0,
                completionRate: stats.TotalQCSteps > 0 ?
                    Math.round((stats.CompletedSteps / stats.TotalQCSteps) * 100) : 0,
                defectRate: stats.TotalQCSteps > 0 ?
                    Math.round((stats.StepsWithDefects / stats.TotalQCSteps) * 100) : 0,
                reworkRate: stats.TotalQCSteps > 0 ?
                    Math.round((stats.StepsRequiringRework / stats.TotalQCSteps) * 100) : 0,
                lastUpdated: new Date().toISOString()
            };

            // Cache für 30 Sekunden
            this.setCache(cacheKey, formattedStats);

            return formattedStats;

        } catch (error) {
            console.error('❌ Fehler beim Abrufen der QC-Statistiken:', error);
            return this.getDefaultQCStatistics();
        }
    }

    /**
     * Gibt QC-Statistiken für Session zurück
     * @param {number} sessionId - Session ID
     * @returns {Object} - Session-spezifische QC-Statistiken
     */
    async getQCStatisticsForSession(sessionId) {
        try {
            const result = await this.connection.query(`
                SELECT 
                    COUNT(*) as TotalSteps,
                    COUNT(CASE WHEN Completed = 1 THEN 1 END) as CompletedSteps,
                    COUNT(CASE WHEN QCStatus = 'active' THEN 1 END) as ActiveSteps,
                    COUNT(CASE WHEN QCStatus = 'aborted' THEN 1 END) as AbortedSteps,
                    AVG(CASE WHEN Completed = 1 THEN ActualDurationSeconds END) as AvgDurationSeconds,
                    AVG(CASE WHEN QualityRating IS NOT NULL THEN CAST(QualityRating AS FLOAT) END) as AvgQualityRating,
                    COUNT(CASE WHEN DefectsFound = 1 THEN 1 END) as StepsWithDefects,
                    COUNT(CASE WHEN ReworkRequired = 1 THEN 1 END) as StepsRequiringRework
                FROM QualityControlSteps
                WHERE SessionID = ?
            `, [sessionId]);

            if (result.recordset.length === 0) {
                return {
                    sessionId: sessionId,
                    totalSteps: 0,
                    completedSteps: 0,
                    activeSteps: 0,
                    abortedSteps: 0,
                    averageDurationMinutes: 0,
                    averageQualityRating: 0,
                    stepsWithDefects: 0,
                    stepsRequiringRework: 0,
                    completionRate: 0,
                    defectRate: 0,
                    reworkRate: 0
                };
            }

            const stats = result.recordset[0];
            return {
                sessionId: sessionId,
                totalSteps: stats.TotalSteps || 0,
                completedSteps: stats.CompletedSteps || 0,
                activeSteps: stats.ActiveSteps || 0,
                abortedSteps: stats.AbortedSteps || 0,
                averageDurationMinutes: Math.round((stats.AvgDurationSeconds || 0) / 60),
                averageQualityRating: Math.round((stats.AvgQualityRating || 0) * 100) / 100,
                stepsWithDefects: stats.StepsWithDefects || 0,
                stepsRequiringRework: stats.StepsRequiringRework || 0,
                completionRate: stats.TotalSteps > 0 ?
                    Math.round((stats.CompletedSteps / stats.TotalSteps) * 100) : 0,
                defectRate: stats.TotalSteps > 0 ?
                    Math.round((stats.StepsWithDefects / stats.TotalSteps) * 100) : 0,
                reworkRate: stats.TotalSteps > 0 ?
                    Math.round((stats.StepsRequiringRework / stats.TotalSteps) * 100) : 0
            };

        } catch (error) {
            console.error('❌ Fehler beim Abrufen der Session-QC-Statistiken:', error);
            return {
                sessionId: sessionId,
                totalSteps: 0,
                completedSteps: 0,
                activeSteps: 0,
                error: error.message
            };
        }
    }

    /**
     * Gibt QC-Trends für die letzten Tage zurück
     * @param {number} days - Anzahl Tage
     * @returns {Array} - QC-Trends
     */
    async getQCTrends(days = 7) {
        try {
            const result = await this.connection.query(`
                SELECT 
                    CAST(CreatedTS AS DATE) as Date,
                    COUNT(*) as TotalSteps,
                    COUNT(CASE WHEN Completed = 1 THEN 1 END) as CompletedSteps,
                    AVG(CASE WHEN Completed = 1 THEN ActualDurationSeconds END) as AvgDurationSeconds,
                    COUNT(CASE WHEN DefectsFound = 1 THEN 1 END) as StepsWithDefects
                FROM QualityControlSteps
                WHERE CreatedTS >= DATEADD(DAY, -?, GETDATE())
                GROUP BY CAST(CreatedTS AS DATE)
                ORDER BY Date DESC
            `, [days]);

            return result.recordset.map(day => ({
                date: day.Date,
                totalSteps: day.TotalSteps || 0,
                completedSteps: day.CompletedSteps || 0,
                averageDurationMinutes: Math.round((day.AvgDurationSeconds || 0) / 60),
                stepsWithDefects: day.StepsWithDefects || 0,
                completionRate: day.TotalSteps > 0 ?
                    Math.round((day.CompletedSteps / day.TotalSteps) * 100) : 0,
                defectRate: day.TotalSteps > 0 ?
                    Math.round((day.StepsWithDefects / day.TotalSteps) * 100) : 0
            }));

        } catch (error) {
            console.error('❌ Fehler beim Abrufen der QC-Trends:', error);
            return [];
        }
    }

    // ===== QC MANAGEMENT OPERATIONS =====

    /**
     * Bricht QC-Schritt ab
     * @param {string} qrCode - QR-Code
     * @param {string} reason - Abbruch-Grund
     * @returns {boolean} - Erfolg
     */
    async abortQCStep(qrCode, reason = 'Manuell abgebrochen') {
        try {
            const result = await this.connection.query(`
                UPDATE QualityControlSteps 
                SET QCStatus = 'aborted',
                    EndTime = GETDATE(),
                    QualityNotes = ISNULL(QualityNotes, '') + ' [Abgebrochen: ' + ? + ']'
                WHERE QrCode = ? AND QCStatus = 'active' AND Completed = 0
            `, [reason, qrCode]);

            const affectedRows = result.rowsAffected[0] || 0;
            return affectedRows > 0;

        } catch (error) {
            console.error('❌ Fehler beim QC-Schritt-Abbruch:', error);
            return false;
        }
    }

    /**
     * Bricht alle QC-Schritte für Session ab
     * @param {number} sessionId - Session ID
     * @param {string} reason - Abbruch-Grund
     * @returns {number} - Anzahl abgebrochener Schritte
     */
    async abortQCStepsForSession(sessionId, reason = 'Session beendet') {
        try {
            const result = await this.connection.query(`
                UPDATE QualityControlSteps 
                SET QCStatus = 'aborted',
                    EndTime = GETDATE(),
                    QualityNotes = ISNULL(QualityNotes, '') + ' [Abgebrochen: ' + ? + ']'
                WHERE SessionID = ? AND QCStatus = 'active' AND Completed = 0
            `, [reason, sessionId]);

            return result.rowsAffected[0] || 0;

        } catch (error) {
            console.error('❌ Fehler beim Session-QC-Abbruch:', error);
            return 0;
        }
    }

    /**
     * Bricht alle aktiven QC-Schritte ab
     * @param {string} reason - Abbruch-Grund
     * @returns {number} - Anzahl abgebrochener Schritte
     */
    async abortAllActiveQCSteps(reason = 'System-Shutdown') {
        try {
            const result = await this.connection.query(`
                UPDATE QualityControlSteps 
                SET QCStatus = 'aborted',
                    EndTime = GETDATE(),
                    QualityNotes = ISNULL(QualityNotes, '') + ' [Abgebrochen: ' + ? + ']'
                WHERE QCStatus = 'active' AND Completed = 0
            `, [reason]);

            return result.rowsAffected[0] || 0;

        } catch (error) {
            console.error('❌ Fehler beim Abbrechen aller aktiven QC-Schritte:', error);
            return 0;
        }
    }

    // ===== QC REPORTING =====

    /**
     * Gibt detaillierten QC-Bericht zurück
     * @param {Date} startDate - Start-Datum
     * @param {Date} endDate - End-Datum
     * @returns {Object} - Detaillierter QC-Bericht
     */
    async getQCReport(startDate = null, endDate = null) {
        try {
            const dateFilter = startDate && endDate ?
                'WHERE qcs.CreatedTS BETWEEN ? AND ?' :
                'WHERE qcs.CreatedTS >= DATEADD(DAY, -7, GETDATE())';

            const params = startDate && endDate ? [startDate, endDate] : [];

            const result = await this.connection.query(`
                SELECT 
                    -- Grundstatistiken
                    COUNT(*) as TotalSteps,
                    COUNT(CASE WHEN qcs.Completed = 1 THEN 1 END) as CompletedSteps,
                    COUNT(CASE WHEN qcs.QCStatus = 'active' THEN 1 END) as ActiveSteps,
                    COUNT(CASE WHEN qcs.QCStatus = 'aborted' THEN 1 END) as AbortedSteps,
                    
                    -- Zeitstatistiken
                    AVG(CASE WHEN qcs.Completed = 1 THEN qcs.ActualDurationSeconds END) as AvgDurationSeconds,
                    MIN(CASE WHEN qcs.Completed = 1 THEN qcs.ActualDurationSeconds END) as MinDurationSeconds,
                    MAX(CASE WHEN qcs.Completed = 1 THEN qcs.ActualDurationSeconds END) as MaxDurationSeconds,
                    
                    -- Qualitätsstatistiken
                    AVG(CASE WHEN qcs.QualityRating IS NOT NULL THEN CAST(qcs.QualityRating AS FLOAT) END) as AvgQualityRating,
                    COUNT(CASE WHEN qcs.DefectsFound = 1 THEN 1 END) as StepsWithDefects,
                    COUNT(CASE WHEN qcs.ReworkRequired = 1 THEN 1 END) as StepsRequiringRework,
                    
                    -- Benutzerstatistiken
                    COUNT(DISTINCT s.UserID) as UsersInvolved,
                    COUNT(DISTINCT qcs.SessionID) as SessionsInvolved
                    
                FROM QualityControlSteps qcs
                INNER JOIN Sessions s ON qcs.SessionID = s.ID
                ${dateFilter}
            `, params);

            if (result.recordset.length === 0) {
                return this.getDefaultQCReport(startDate, endDate);
            }

            const stats = result.recordset[0];

            // Top-Performer abrufen
            const topPerformersResult = await this.connection.query(`
                SELECT TOP 5
                    u.BenutzerName as UserName,
                    COUNT(*) as CompletedSteps,
                    AVG(CASE WHEN qcs.Completed = 1 THEN qcs.ActualDurationSeconds END) as AvgDurationSeconds,
                    AVG(CASE WHEN qcs.QualityRating IS NOT NULL THEN CAST(qcs.QualityRating AS FLOAT) END) as AvgQualityRating
                FROM QualityControlSteps qcs
                INNER JOIN Sessions s ON qcs.SessionID = s.ID
                INNER JOIN ScannBenutzer u ON s.UserID = u.ID
                ${dateFilter} AND qcs.Completed = 1
                GROUP BY u.BenutzerName
                ORDER BY CompletedSteps DESC
            `, params);

            return {
                period: {
                    startDate: startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                    endDate: endDate || new Date()
                },
                summary: {
                    totalSteps: stats.TotalSteps || 0,
                    completedSteps: stats.CompletedSteps || 0,
                    activeSteps: stats.ActiveSteps || 0,
                    abortedSteps: stats.AbortedSteps || 0,
                    completionRate: stats.TotalSteps > 0 ?
                        Math.round((stats.CompletedSteps / stats.TotalSteps) * 100) : 0,
                    usersInvolved: stats.UsersInvolved || 0,
                    sessionsInvolved: stats.SessionsInvolved || 0
                },
                timing: {
                    averageDurationMinutes: Math.round((stats.AvgDurationSeconds || 0) / 60),
                    minDurationMinutes: Math.round((stats.MinDurationSeconds || 0) / 60),
                    maxDurationMinutes: Math.round((stats.MaxDurationSeconds || 0) / 60)
                },
                quality: {
                    averageRating: Math.round((stats.AvgQualityRating || 0) * 100) / 100,
                    stepsWithDefects: stats.StepsWithDefects || 0,
                    stepsRequiringRework: stats.StepsRequiringRework || 0,
                    defectRate: stats.TotalSteps > 0 ?
                        Math.round((stats.StepsWithDefects / stats.TotalSteps) * 100) : 0,
                    reworkRate: stats.TotalSteps > 0 ?
                        Math.round((stats.StepsRequiringRework / stats.TotalSteps) * 100) : 0
                },
                topPerformers: topPerformersResult.recordset.map(user => ({
                    userName: user.UserName,
                    completedSteps: user.CompletedSteps || 0,
                    averageDurationMinutes: Math.round((user.AvgDurationSeconds || 0) / 60),
                    averageQualityRating: Math.round((user.AvgQualityRating || 0) * 100) / 100
                })),
                generatedAt: new Date().toISOString()
            };

        } catch (error) {
            console.error('❌ Fehler beim Erstellen des QC-Berichts:', error);
            return this.getDefaultQCReport(startDate, endDate);
        }
    }

    // ===== CACHE MANAGEMENT =====

    getFromCache(key) {
        const cached = this.queryCache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    setCache(key, data) {
        this.queryCache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.queryCache.clear();
    }

    // ===== DEFAULT VALUES =====

    getDefaultQCStatistics() {
        return {
            totalQCSteps: 0,
            completedQCSteps: 0,
            activeQCSteps: 0,
            abortedQCSteps: 0,
            averageDurationMinutes: 0,
            minDurationMinutes: 0,
            maxDurationMinutes: 0,
            averageQualityRating: 0,
            stepsWithDefects: 0,
            stepsRequiringRework: 0,
            overdueSteps: 0,
            todaySteps: 0,
            todayCompletedSteps: 0,
            completionRate: 0,
            defectRate: 0,
            reworkRate: 0,
            lastUpdated: new Date().toISOString()
        };
    }

    getDefaultQCReport(startDate, endDate) {
        return {
            period: {
                startDate: startDate || new Date(),
                endDate: endDate || new Date()
            },
            summary: {
                totalSteps: 0,
                completedSteps: 0,
                activeSteps: 0,
                abortedSteps: 0,
                completionRate: 0,
                usersInvolved: 0,
                sessionsInvolved: 0
            },
            timing: {
                averageDurationMinutes: 0,
                minDurationMinutes: 0,
                maxDurationMinutes: 0
            },
            quality: {
                averageRating: 0,
                stepsWithDefects: 0,
                stepsRequiringRework: 0,
                defectRate: 0,
                reworkRate: 0
            },
            topPerformers: [],
            generatedAt: new Date().toISOString(),
            error: 'Keine QC-Daten verfügbar'
        };
    }

    // ===== CLEANUP =====

    cleanup() {
        this.clearCache();
        console.log('🧹 QualityControlQueries bereinigt');
    }
}

module.exports = QualityControlQueries;
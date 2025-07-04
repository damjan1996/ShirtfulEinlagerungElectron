/**
 * Quality Control Logic - Hauptlogik für QR-Doppelscanning
 * Manages the complete QC workflow with double QR scanning (Entry/Exit)
 * Integrates with parallel sessions and automatic session reset
 *
 * Features:
 * - Double QR-Code scanning (Entry → Exit)
 * - Automatic session reset after QC completion
 * - Parallel QC steps across multiple users
 * - QC step progress tracking
 * - Overdue detection and management
 * - Integration with session management
 */

const EventEmitter = require('events');

class QualityControlLogic extends EventEmitter {
    constructor(dbClient) {
        super();

        this.dbClient = dbClient;

        // ===== QC-WORKFLOW STATE =====
        this.activeQCSteps = new Map(); // qrCode -> QCStepData
        this.qcSessionMapping = new Map(); // sessionId -> Set<qrCode>
        this.qcUserMapping = new Map(); // userId -> Set<qrCode>

        // ===== QC-CONFIGURATION =====
        this.config = {
            // Workflow
            autoSessionResetAfterQC: true,
            allowParallelQCSteps: true,
            enableQCTimeTracking: true,
            enableQCQualityRating: true,

            // Timing
            defaultEstimatedMinutes: 15,
            overdueThresholdMinutes: 30,
            criticalOverdueMinutes: 60,

            // Notifications
            enableOverdueNotifications: true,
            enableCompletionNotifications: true,
            notificationIntervalMinutes: 10,

            // Session Management
            resetSessionAfterQC: true,
            allowQCSessionRestart: false,
            maxParallelQCPerUser: 5,

            // Quality Control
            requireQualityRating: false,
            enableDefectTracking: true,
            enableReworkTracking: true,
            autoGenerateQCReport: true
        };

        // ===== QC-STATISTICS =====
        this.statistics = {
            totalQCSteps: 0,
            completedQCSteps: 0,
            activeQCSteps: 0,
            overdueQCSteps: 0,
            averageDurationMinutes: 0,
            averageQualityRating: 0,
            defectRate: 0,
            reworkRate: 0,
            sessionResetRate: 0
        };

        // ===== QC-TIMERS =====
        this.overdueCheckTimer = null;
        this.statisticsUpdateTimer = null;
        this.notificationTimer = null;

        // ===== EVENT HANDLERS =====
        this.setupEventHandlers();

        console.log('🔍 QualityControlLogic initialisiert');
    }

    // ===== INITIALIZATION =====

    setupEventHandlers() {
        // QC-spezifische Events abonnieren
        this.on('qc-step-started', this.handleQCStepStarted.bind(this));
        this.on('qc-step-completed', this.handleQCStepCompleted.bind(this));
        this.on('qc-step-overdue', this.handleQCStepOverdue.bind(this));
        this.on('session-reset-after-qc', this.handleSessionResetAfterQC.bind(this));

        console.log('📡 QC-Event-Handler eingerichtet');
    }

    async initialize() {
        try {
            console.log('🔍 Initialisiere QualityControlLogic...');

            // Aktive QC-Schritte aus Datenbank laden
            await this.loadActiveQCSteps();

            // Statistiken laden
            await this.loadQCStatistics();

            // Timer starten
            this.startTimers();

            console.log('✅ QualityControlLogic erfolgreich initialisiert');
            return true;

        } catch (error) {
            console.error('❌ Fehler bei QC-Initialisierung:', error);
            return false;
        }
    }

    startTimers() {
        // Überfällige QC-Schritte prüfen (alle 5 Minuten)
        this.overdueCheckTimer = setInterval(() => {
            this.checkOverdueQCSteps();
        }, 5 * 60 * 1000);

        // Statistiken aktualisieren (alle 10 Minuten)
        this.statisticsUpdateTimer = setInterval(() => {
            this.updateStatistics();
        }, 10 * 60 * 1000);

        // Benachrichtigungen (alle 10 Minuten)
        if (this.config.enableOverdueNotifications) {
            this.notificationTimer = setInterval(() => {
                this.sendOverdueNotifications();
            }, this.config.notificationIntervalMinutes * 60 * 1000);
        }

        console.log('⏰ QC-Timer gestartet');
    }

    // ===== CORE QC WORKFLOW =====

    /**
     * Verarbeitet QR-Code-Scan für QC-Workflow
     * Entscheidet ob QC startet oder beendet wird
     * @param {string} qrCode - QR-Code
     * @param {number} sessionId - Session ID
     * @param {number} scanId - Scan ID aus der Datenbank
     * @param {number} userId - Benutzer ID
     * @returns {Object} - QC-Workflow Ergebnis
     */
    async processQRScanForQC(qrCode, sessionId, scanId, userId) {
        try {
            console.log(`🔍 QC-Workflow für QR-Code: ${qrCode}, Session: ${sessionId}`);

            // Prüfe ob bereits ein aktiver QC-Schritt für diesen QR-Code existiert
            const existingQCStep = this.activeQCSteps.get(qrCode);

            if (existingQCStep) {
                // ===== ZWEITER SCAN: QC-Schritt abschließen =====
                return await this.completeQCStep(qrCode, sessionId, scanId, userId);

            } else {
                // ===== ERSTER SCAN: QC-Schritt starten =====
                return await this.startQCStep(qrCode, sessionId, scanId, userId);
            }

        } catch (error) {
            console.error('❌ Fehler beim QC-Workflow:', error);
            return {
                qcProcessed: false,
                action: 'qc_error',
                success: false,
                message: `QC-Workflow Fehler: ${error.message}`
            };
        }
    }

    /**
     * Startet neuen QC-Schritt (erster QR-Code Scan)
     * @param {string} qrCode - QR-Code
     * @param {number} sessionId - Session ID
     * @param {number} scanId - Scan ID
     * @param {number} userId - Benutzer ID
     * @returns {Object} - QC-Start Ergebnis
     */
    async startQCStep(qrCode, sessionId, scanId, userId) {
        try {
            // Prüfe Limits für parallele QC-Schritte pro Benutzer
            if (!this.canUserStartNewQC(userId)) {
                return {
                    qcProcessed: false,
                    action: 'qc_limit_reached',
                    success: false,
                    message: `Maximale Anzahl paralleler QC-Schritte erreicht (${this.config.maxParallelQCPerUser})`
                };
            }

            // QC-Schritt in Datenbank erstellen
            const dbResult = await this.dbClient.startQualityControlStep(
                sessionId,
                qrCode,
                scanId,
                1, // Normal priority
                this.config.defaultEstimatedMinutes,
                null, // Processing location
                userId
            );

            if (!dbResult.success) {
                throw new Error(dbResult.message);
            }

            // Lokales QC-Schritt-Tracking
            const qcStepData = {
                id: dbResult.qcStepId,
                qrCode: qrCode,
                sessionId: sessionId,
                userId: userId,
                startTime: new Date(),
                startScanId: scanId,
                estimatedMinutes: this.config.defaultEstimatedMinutes,
                priority: 1,
                status: 'active'
            };

            this.activeQCSteps.set(qrCode, qcStepData);

            // Session-Mapping aktualisieren
            this.updateSessionMapping(sessionId, qrCode, 'add');
            this.updateUserMapping(userId, qrCode, 'add');

            // Statistiken aktualisieren
            this.statistics.activeQCSteps++;
            this.statistics.totalQCSteps++;

            // Event emittieren
            this.emit('qc-step-started', {
                qrCode,
                sessionId,
                userId,
                qcStepId: dbResult.qcStepId,
                estimatedMinutes: this.config.defaultEstimatedMinutes
            });

            console.log(`✅ QC-Schritt gestartet: ${qrCode} (ID: ${dbResult.qcStepId})`);

            return {
                qcProcessed: true,
                action: 'qc_started',
                success: true,
                qcStepId: dbResult.qcStepId,
                estimatedMinutes: this.config.defaultEstimatedMinutes,
                message: 'Qualitätsprüfung gestartet'
            };

        } catch (error) {
            console.error('❌ Fehler beim QC-Schritt-Start:', error);
            return {
                qcProcessed: false,
                action: 'qc_start_error',
                success: false,
                message: `Fehler beim QC-Start: ${error.message}`
            };
        }
    }

    /**
     * Schließt QC-Schritt ab (zweiter QR-Code Scan)
     * @param {string} qrCode - QR-Code
     * @param {number} sessionId - Session ID
     * @param {number} scanId - Scan ID
     * @param {number} userId - Benutzer ID
     * @returns {Object} - QC-Abschluss Ergebnis
     */
    async completeQCStep(qrCode, sessionId, scanId, userId) {
        try {
            const qcStepData = this.activeQCSteps.get(qrCode);
            if (!qcStepData) {
                throw new Error(`QC-Schritt für QR-Code ${qrCode} nicht gefunden`);
            }

            // Dauer berechnen
            const durationMinutes = Math.round(
                (new Date() - qcStepData.startTime) / (1000 * 60)
            );

            // QC-Schritt in Datenbank abschließen
            const dbResult = await this.dbClient.completeQualityControlStep(
                qrCode,
                scanId,
                userId,
                null, // Quality rating (optional)
                null, // Quality notes (optional)
                false, // Defects found
                null, // Defect description
                false  // Rework required
            );

            if (!dbResult.success) {
                throw new Error(dbResult.message);
            }

            // Lokales Tracking bereinigen
            this.activeQCSteps.delete(qrCode);
            this.updateSessionMapping(sessionId, qrCode, 'remove');
            this.updateUserMapping(userId, qrCode, 'remove');

            // Statistiken aktualisieren
            this.statistics.activeQCSteps--;
            this.statistics.completedQCSteps++;
            this.updateAverageDuration(durationMinutes);

            // Event emittieren
            this.emit('qc-step-completed', {
                qrCode,
                sessionId,
                userId,
                qcStepId: qcStepData.id,
                durationMinutes,
                autoSessionReset: this.config.autoSessionResetAfterQC
            });

            // Session automatisch beenden wenn konfiguriert
            let sessionReset = false;
            if (this.config.autoSessionResetAfterQC) {
                try {
                    await this.dbClient.endSession(sessionId);
                    sessionReset = true;
                    this.statistics.sessionResetRate++;

                    this.emit('session-reset-after-qc', {
                        sessionId,
                        userId,
                        qrCode,
                        reason: 'QC abgeschlossen'
                    });

                    console.log(`🔄 Session ${sessionId} automatisch nach QC beendet`);
                } catch (resetError) {
                    console.error('❌ Fehler beim automatischen Session-Reset:', resetError);
                }
            }

            console.log(`✅ QC-Schritt abgeschlossen: ${qrCode} (${durationMinutes} Min)`);

            return {
                qcProcessed: true,
                action: 'qc_completed',
                success: true,
                qcStepId: qcStepData.id,
                durationMinutes,
                autoSessionReset: sessionReset,
                message: `Qualitätsprüfung abgeschlossen (${durationMinutes} Min)`
            };

        } catch (error) {
            console.error('❌ Fehler beim QC-Schritt-Abschluss:', error);
            return {
                qcProcessed: false,
                action: 'qc_complete_error',
                success: false,
                message: `Fehler beim QC-Abschluss: ${error.message}`
            };
        }
    }

    // ===== QC-STEP MANAGEMENT =====

    /**
     * Bricht QC-Schritt ab
     * @param {string} qrCode - QR-Code
     * @param {string} reason - Abbruch-Grund
     * @returns {boolean} - Erfolg
     */
    async abortQCStep(qrCode, reason = 'Manuell abgebrochen') {
        try {
            const qcStepData = this.activeQCSteps.get(qrCode);
            if (!qcStepData) {
                console.warn(`QC-Schritt für QR-Code ${qrCode} nicht gefunden`);
                return false;
            }

            // In Datenbank als abgebrochen markieren
            await this.dbClient.query(`
                UPDATE QualityControlSteps 
                SET QCStatus = 'aborted',
                    EndTime = GETDATE(),
                    QualityNotes = ISNULL(QualityNotes, '') + ' [Abgebrochen: ' + ? + ']'
                WHERE QrCode = ? AND QCStatus = 'active' AND Completed = 0
            `, [reason, qrCode]);

            // Lokales Tracking bereinigen
            this.activeQCSteps.delete(qrCode);
            this.updateSessionMapping(qcStepData.sessionId, qrCode, 'remove');
            this.updateUserMapping(qcStepData.userId, qrCode, 'remove');

            // Statistiken aktualisieren
            this.statistics.activeQCSteps--;

            console.log(`🛑 QC-Schritt abgebrochen: ${qrCode} (${reason})`);
            return true;

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
            const sessionQRCodes = this.qcSessionMapping.get(sessionId);
            if (!sessionQRCodes || sessionQRCodes.size === 0) {
                return 0;
            }

            let abortedCount = 0;
            for (const qrCode of sessionQRCodes) {
                const success = await this.abortQCStep(qrCode, reason);
                if (success) abortedCount++;
            }

            console.log(`🛑 ${abortedCount} QC-Schritte für Session ${sessionId} abgebrochen`);
            return abortedCount;

        } catch (error) {
            console.error('❌ Fehler beim Session-QC-Abbruch:', error);
            return 0;
        }
    }

    /**
     * Bricht alle QC-Schritte für Benutzer ab
     * @param {number} userId - Benutzer ID
     * @param {string} reason - Abbruch-Grund
     * @returns {number} - Anzahl abgebrochener Schritte
     */
    async abortQCStepsForUser(userId, reason = 'Benutzer abgemeldet') {
        try {
            const userQRCodes = this.qcUserMapping.get(userId);
            if (!userQRCodes || userQRCodes.size === 0) {
                return 0;
            }

            let abortedCount = 0;
            for (const qrCode of userQRCodes) {
                const success = await this.abortQCStep(qrCode, reason);
                if (success) abortedCount++;
            }

            console.log(`🛑 ${abortedCount} QC-Schritte für Benutzer ${userId} abgebrochen`);
            return abortedCount;

        } catch (error) {
            console.error('❌ Fehler beim Benutzer-QC-Abbruch:', error);
            return 0;
        }
    }

    // ===== QC-STATUS & INFORMATION =====

    /**
     * Gibt QC-Status für QR-Code zurück
     * @param {string} qrCode - QR-Code
     * @returns {Object|null} - QC-Status
     */
    getQCStatus(qrCode) {
        const qcStepData = this.activeQCSteps.get(qrCode);
        if (!qcStepData) return null;

        const now = new Date();
        const durationMinutes = Math.round((now - qcStepData.startTime) / (1000 * 60));
        const isOverdue = durationMinutes > this.config.overdueThresholdMinutes;
        const isCritical = durationMinutes > this.config.criticalOverdueMinutes;

        return {
            id: qcStepData.id,
            qrCode: qrCode,
            sessionId: qcStepData.sessionId,
            userId: qcStepData.userId,
            status: qcStepData.status,
            startTime: qcStepData.startTime,
            durationMinutes: durationMinutes,
            estimatedMinutes: qcStepData.estimatedMinutes,
            isOverdue: isOverdue,
            isCritical: isCritical,
            priority: qcStepData.priority,
            remainingMinutes: Math.max(0, qcStepData.estimatedMinutes - durationMinutes)
        };
    }

    /**
     * Gibt alle aktiven QC-Schritte für Session zurück
     * @param {number} sessionId - Session ID
     * @returns {Array} - QC-Schritte
     */
    getActiveQCStepsForSession(sessionId) {
        const sessionQRCodes = this.qcSessionMapping.get(sessionId);
        if (!sessionQRCodes) return [];

        const qcSteps = [];
        for (const qrCode of sessionQRCodes) {
            const status = this.getQCStatus(qrCode);
            if (status) qcSteps.push(status);
        }

        return qcSteps.sort((a, b) => a.startTime - b.startTime);
    }

    /**
     * Gibt alle aktiven QC-Schritte für Benutzer zurück
     * @param {number} userId - Benutzer ID
     * @returns {Array} - QC-Schritte
     */
    getActiveQCStepsForUser(userId) {
        const userQRCodes = this.qcUserMapping.get(userId);
        if (!userQRCodes) return [];

        const qcSteps = [];
        for (const qrCode of userQRCodes) {
            const status = this.getQCStatus(qrCode);
            if (status) qcSteps.push(status);
        }

        return qcSteps.sort((a, b) => a.startTime - b.startTime);
    }

    /**
     * Gibt alle aktiven QC-Schritte zurück
     * @returns {Array} - Alle aktiven QC-Schritte
     */
    getAllActiveQCSteps() {
        const allSteps = [];
        for (const qrCode of this.activeQCSteps.keys()) {
            const status = this.getQCStatus(qrCode);
            if (status) allSteps.push(status);
        }

        return allSteps.sort((a, b) => {
            // Sortierung: Kritisch → Überfällig → Priorität → Startzeit
            if (a.isCritical !== b.isCritical) return b.isCritical - a.isCritical;
            if (a.isOverdue !== b.isOverdue) return b.isOverdue - a.isOverdue;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.startTime - b.startTime;
        });
    }

    /**
     * Gibt überfällige QC-Schritte zurück
     * @returns {Array} - Überfällige QC-Schritte
     */
    getOverdueQCSteps() {
        return this.getAllActiveQCSteps().filter(step => step.isOverdue);
    }

    /**
     * Gibt kritische QC-Schritte zurück
     * @returns {Array} - Kritische QC-Schritte
     */
    getCriticalQCSteps() {
        return this.getAllActiveQCSteps().filter(step => step.isCritical);
    }

    // ===== MONITORING & MAINTENANCE =====

    /**
     * Prüft auf überfällige QC-Schritte
     */
    async checkOverdueQCSteps() {
        try {
            const overdueSteps = this.getOverdueQCSteps();
            const criticalSteps = this.getCriticalQCSteps();

            this.statistics.overdueQCSteps = overdueSteps.length;

            // Events für überfällige Schritte
            for (const step of overdueSteps) {
                this.emit('qc-step-overdue', step);
            }

            // Events für kritische Schritte
            for (const step of criticalSteps) {
                this.emit('qc-step-critical', step);
            }

            if (overdueSteps.length > 0) {
                console.warn(`⚠️ ${overdueSteps.length} überfällige QC-Schritte gefunden`);
            }

        } catch (error) {
            console.error('❌ Fehler beim Überprüfen überfälliger QC-Schritte:', error);
        }
    }

    /**
     * Sendet Benachrichtigungen für überfällige QC-Schritte
     */
    async sendOverdueNotifications() {
        if (!this.config.enableOverdueNotifications) return;

        try {
            const overdueSteps = this.getOverdueQCSteps();

            for (const step of overdueSteps) {
                this.emit('qc-overdue-notification', {
                    qrCode: step.qrCode,
                    userId: step.userId,
                    sessionId: step.sessionId,
                    durationMinutes: step.durationMinutes,
                    isCritical: step.isCritical
                });
            }

        } catch (error) {
            console.error('❌ Fehler beim Senden von Überfällig-Benachrichtigungen:', error);
        }
    }

    /**
     * Aktualisiert QC-Statistiken
     */
    async updateStatistics() {
        try {
            // Lokale Statistiken aktualisieren
            this.statistics.activeQCSteps = this.activeQCSteps.size;

            // Datenbankstatistiken laden
            const dbStats = await this.dbClient.getQCStatistics();
            if (dbStats) {
                this.statistics = {
                    ...this.statistics,
                    ...dbStats
                };
            }

            console.log('📊 QC-Statistiken aktualisiert:', this.statistics);

        } catch (error) {
            console.error('❌ Fehler beim Aktualisieren der QC-Statistiken:', error);
        }
    }

    // ===== HELPER METHODS =====

    /**
     * Prüft ob Benutzer neuen QC-Schritt starten kann
     * @param {number} userId - Benutzer ID
     * @returns {boolean} - Kann starten
     */
    canUserStartNewQC(userId) {
        const userQRCodes = this.qcUserMapping.get(userId);
        const currentCount = userQRCodes ? userQRCodes.size : 0;
        return currentCount < this.config.maxParallelQCPerUser;
    }

    /**
     * Aktualisiert Session-Mapping
     * @param {number} sessionId - Session ID
     * @param {string} qrCode - QR-Code
     * @param {string} action - 'add' oder 'remove'
     */
    updateSessionMapping(sessionId, qrCode, action) {
        if (!this.qcSessionMapping.has(sessionId)) {
            this.qcSessionMapping.set(sessionId, new Set());
        }

        const sessionSet = this.qcSessionMapping.get(sessionId);
        if (action === 'add') {
            sessionSet.add(qrCode);
        } else if (action === 'remove') {
            sessionSet.delete(qrCode);
            if (sessionSet.size === 0) {
                this.qcSessionMapping.delete(sessionId);
            }
        }
    }

    /**
     * Aktualisiert Benutzer-Mapping
     * @param {number} userId - Benutzer ID
     * @param {string} qrCode - QR-Code
     * @param {string} action - 'add' oder 'remove'
     */
    updateUserMapping(userId, qrCode, action) {
        if (!this.qcUserMapping.has(userId)) {
            this.qcUserMapping.set(userId, new Set());
        }

        const userSet = this.qcUserMapping.get(userId);
        if (action === 'add') {
            userSet.add(qrCode);
        } else if (action === 'remove') {
            userSet.delete(qrCode);
            if (userSet.size === 0) {
                this.qcUserMapping.delete(userId);
            }
        }
    }

    /**
     * Aktualisiert durchschnittliche Dauer
     * @param {number} durationMinutes - Neue Dauer in Minuten
     */
    updateAverageDuration(durationMinutes) {
        const totalCompleted = this.statistics.completedQCSteps;
        const currentAvg = this.statistics.averageDurationMinutes;

        // Gewichteter Durchschnitt
        this.statistics.averageDurationMinutes = Math.round(
            (currentAvg * (totalCompleted - 1) + durationMinutes) / totalCompleted
        );
    }

    // ===== DATA LOADING =====

    /**
     * Lädt aktive QC-Schritte aus der Datenbank
     */
    async loadActiveQCSteps() {
        try {
            const activeSteps = await this.dbClient.getAllActiveQCSteps();

            this.activeQCSteps.clear();
            this.qcSessionMapping.clear();
            this.qcUserMapping.clear();

            for (const step of activeSteps) {
                const qcStepData = {
                    id: step.ID,
                    qrCode: step.QrCode,
                    sessionId: step.SessionID,
                    userId: step.UserID,
                    startTime: new Date(step.StartTime),
                    startScanId: step.StartScanID,
                    estimatedMinutes: step.EstimatedDurationMinutes || this.config.defaultEstimatedMinutes,
                    priority: step.Priority || 1,
                    status: 'active'
                };

                this.activeQCSteps.set(step.QrCode, qcStepData);
                this.updateSessionMapping(step.SessionID, step.QrCode, 'add');
                this.updateUserMapping(step.UserID, step.QrCode, 'add');
            }

            console.log(`📊 ${activeSteps.length} aktive QC-Schritte geladen`);

        } catch (error) {
            console.error('❌ Fehler beim Laden aktiver QC-Schritte:', error);
        }
    }

    /**
     * Lädt QC-Statistiken aus der Datenbank
     */
    async loadQCStatistics() {
        try {
            const dbStats = await this.dbClient.getQCStatistics();
            if (dbStats) {
                this.statistics = {
                    ...this.statistics,
                    ...dbStats
                };
            }

            console.log('📈 QC-Statistiken geladen');

        } catch (error) {
            console.error('❌ Fehler beim Laden der QC-Statistiken:', error);
        }
    }

    // ===== EVENT HANDLERS =====

    handleQCStepStarted(data) {
        console.log(`🔍 QC-Schritt gestartet: ${data.qrCode} für Session ${data.sessionId}`);
    }

    handleQCStepCompleted(data) {
        console.log(`✅ QC-Schritt abgeschlossen: ${data.qrCode} (${data.durationMinutes} Min)`);
    }

    handleQCStepOverdue(data) {
        console.warn(`⚠️ QC-Schritt überfällig: ${data.qrCode} (${data.durationMinutes} Min)`);
    }

    handleSessionResetAfterQC(data) {
        console.log(`🔄 Session automatisch nach QC beendet: ${data.sessionId}`);
    }

    // ===== PUBLIC API =====

    /**
     * Gibt aktuellen QC-Status zurück
     * @returns {Object} - QC-System-Status
     */
    getSystemStatus() {
        return {
            enabled: true,
            activeSteps: this.statistics.activeQCSteps,
            overdueSteps: this.statistics.overdueQCSteps,
            completedToday: this.statistics.completedQCSteps, // TODO: Filtern auf heute
            statistics: this.statistics,
            configuration: this.config,
            mappings: {
                sessions: this.qcSessionMapping.size,
                users: this.qcUserMapping.size
            }
        };
    }

    /**
     * Aktualisiert QC-Konfiguration
     * @param {Object} newConfig - Neue Konfiguration
     */
    updateConfiguration(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };

        console.log('🔧 QC-Konfiguration aktualisiert:', newConfig);
    }

    /**
     * Bereinigt QC-System (Shutdown)
     */
    async cleanup() {
        try {
            console.log('🧹 QC-System wird bereinigt...');

            // Timer stoppen
            if (this.overdueCheckTimer) clearInterval(this.overdueCheckTimer);
            if (this.statisticsUpdateTimer) clearInterval(this.statisticsUpdateTimer);
            if (this.notificationTimer) clearInterval(this.notificationTimer);

            // Event-Listener entfernen
            this.removeAllListeners();

            // Lokale Daten zurücksetzen
            this.activeQCSteps.clear();
            this.qcSessionMapping.clear();
            this.qcUserMapping.clear();

            console.log('✅ QC-System erfolgreich bereinigt');

        } catch (error) {
            console.error('❌ Fehler beim QC-System-Cleanup:', error);
        }
    }
}

module.exports = QualityControlLogic;
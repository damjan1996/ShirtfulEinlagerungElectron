/**
 * QC Session Handler für Qualitätskontrolle-Sessions
 * Verwaltet QC-spezifische Session-Logik und automatischen Session-Reset
 * Version: 1.0.0 - Wareneinlagerung Multi-User QC System
 */

const EventEmitter = require('events');

class QCSessionHandler extends EventEmitter {
    constructor(qcManager, appInstance) {
        super();

        this.qcManager = qcManager;
        this.app = appInstance;

        // QC-Session-Konfiguration
        this.config = {
            autoResetAfterQC: true,
            resetDelaySeconds: 5,
            maxQCStepsPerSession: 5,
            enableSessionIsolation: true,
            enableQCSessionNotifications: true,
            enableQCSessionAudio: true
        };

        // QC-Session-Tracking
        this.qcSessions = new Map(); // sessionId -> QCSessionData
        this.qcStepsBySession = new Map(); // sessionId -> Set(qrCodes)
        this.sessionResetTimers = new Map(); // sessionId -> Timer

        // QC-Session-Statistiken
        this.sessionStats = {
            totalQCSessions: 0,
            autoResets: 0,
            manualResets: 0,
            avgQCStepsPerSession: 0,
            avgSessionDuration: 0
        };

        this.setupEventHandlers();
        console.log('🎯 QC Session Handler initialisiert');
    }

    // ===== INITIALIZATION =====

    setupEventHandlers() {
        // QC Manager Events
        if (this.qcManager) {
            this.qcManager.on('qc-step-started', this.handleQCStepStarted.bind(this));
            this.qcManager.on('qc-step-completed', this.handleQCStepCompleted.bind(this));
            this.qcManager.on('qc-step-aborted', this.handleQCStepAborted.bind(this));
        }

        // App Events (wenn verfügbar)
        if (this.app && typeof this.app.on === 'function') {
            this.app.on('session-created', this.handleSessionCreated.bind(this));
            this.app.on('session-ended', this.handleSessionEnded.bind(this));
            this.app.on('user-logout', this.handleUserLogout.bind(this));
        }

        console.log('📡 QC Session Event-Handler eingerichtet');
    }

    // ===== QC SESSION MANAGEMENT =====

    /**
     * Initialisiert QC-Session-Tracking für neue Session
     */
    initializeQCSession(sessionId, userId, sessionType = 'Qualitätskontrolle') {
        const qcSession = {
            sessionId: sessionId,
            userId: userId,
            sessionType: sessionType,
            startTime: new Date(),
            endTime: null,
            activeQCSteps: new Set(),
            completedQCSteps: [],
            abortedQCSteps: [],
            totalQCSteps: 0,
            autoResetScheduled: false,
            lastActivity: new Date()
        };

        this.qcSessions.set(sessionId, qcSession);
        this.qcStepsBySession.set(sessionId, new Set());

        this.sessionStats.totalQCSessions++;

        console.log(`🎯 QC-Session initialisiert: ${sessionId} (User: ${userId})`);

        this.emit('qc-session-initialized', {
            sessionId: sessionId,
            userId: userId,
            sessionType: sessionType
        });

        return qcSession;
    }

    /**
     * Ruft QC-Session-Daten ab
     */
    getQCSession(sessionId) {
        return this.qcSessions.get(sessionId);
    }

    /**
     * Aktualisiert QC-Session-Aktivität
     */
    updateSessionActivity(sessionId) {
        const qcSession = this.qcSessions.get(sessionId);
        if (qcSession) {
            qcSession.lastActivity = new Date();
        }
    }

    /**
     * Prüft ob Session QC-fähig ist
     */
    isQCSession(sessionId) {
        const qcSession = this.qcSessions.get(sessionId);
        return qcSession && qcSession.sessionType === 'Qualitätskontrolle';
    }

    // ===== QC STEP EVENT HANDLERS =====

    /**
     * Behandelt QC-Schritt-Start
     */
    handleQCStepStarted(data) {
        const { qrCode, sessionId, userId } = data;

        // QC-Session initialisieren falls nicht vorhanden
        let qcSession = this.getQCSession(sessionId);
        if (!qcSession) {
            qcSession = this.initializeQCSession(sessionId, userId);
        }

        // QC-Schritt zur Session hinzufügen
        qcSession.activeQCSteps.add(qrCode);
        qcSession.totalQCSteps++;
        this.qcStepsBySession.get(sessionId).add(qrCode);

        this.updateSessionActivity(sessionId);

        // Eventuell geplanten Auto-Reset abbrechen
        this.cancelAutoReset(sessionId);

        console.log(`🔍 QC-Schritt gestartet in Session ${sessionId}: ${qrCode}`);

        this.emit('qc-session-step-started', {
            sessionId: sessionId,
            qrCode: qrCode,
            activeSteps: qcSession.activeQCSteps.size,
            totalSteps: qcSession.totalQCSteps
        });

        // Session-Benachrichtigung
        this.notifySessionQCEvent(sessionId, 'qc_started', {
            qrCode: qrCode,
            activeSteps: qcSession.activeQCSteps.size
        });
    }

    /**
     * Behandelt QC-Schritt-Abschluss
     */
    handleQCStepCompleted(data) {
        const { qrCode, sessionId, durationMinutes, autoSessionReset } = data;

        const qcSession = this.getQCSession(sessionId);
        if (!qcSession) {
            console.warn(`QC-Session ${sessionId} nicht gefunden für Abschluss`);
            return;
        }

        // QC-Schritt von aktiv zu abgeschlossen verschieben
        qcSession.activeQCSteps.delete(qrCode);
        qcSession.completedQCSteps.push({
            qrCode: qrCode,
            completedAt: new Date(),
            durationMinutes: durationMinutes
        });

        this.updateSessionActivity(sessionId);

        console.log(`✅ QC-Schritt abgeschlossen in Session ${sessionId}: ${qrCode}`);

        this.emit('qc-session-step-completed', {
            sessionId: sessionId,
            qrCode: qrCode,
            durationMinutes: durationMinutes,
            activeSteps: qcSession.activeQCSteps.size,
            completedSteps: qcSession.completedQCSteps.length
        });

        // Session-Benachrichtigung
        this.notifySessionQCEvent(sessionId, 'qc_completed', {
            qrCode: qrCode,
            durationMinutes: durationMinutes,
            activeSteps: qcSession.activeQCSteps.size
        });

        // Automatischer Session-Reset wenn konfiguriert
        if (this.config.autoResetAfterQC && autoSessionReset) {
            this.scheduleAutoReset(sessionId, durationMinutes);
        }
    }

    /**
     * Behandelt QC-Schritt-Abbruch
     */
    handleQCStepAborted(data) {
        const { qrCode, sessionId, reason } = data;

        const qcSession = this.getQCSession(sessionId);
        if (!qcSession) {
            console.warn(`QC-Session ${sessionId} nicht gefunden für Abbruch`);
            return;
        }

        // QC-Schritt von aktiv zu abgebrochen verschieben
        qcSession.activeQCSteps.delete(qrCode);
        qcSession.abortedQCSteps.push({
            qrCode: qrCode,
            abortedAt: new Date(),
            reason: reason
        });

        this.updateSessionActivity(sessionId);

        console.log(`🛑 QC-Schritt abgebrochen in Session ${sessionId}: ${qrCode} (${reason})`);

        this.emit('qc-session-step-aborted', {
            sessionId: sessionId,
            qrCode: qrCode,
            reason: reason,
            activeSteps: qcSession.activeQCSteps.size,
            abortedSteps: qcSession.abortedQCSteps.length
        });

        // Session-Benachrichtigung
        this.notifySessionQCEvent(sessionId, 'qc_aborted', {
            qrCode: qrCode,
            reason: reason,
            activeSteps: qcSession.activeQCSteps.size
        });
    }

    // ===== AUTO-RESET FUNCTIONALITY =====

    /**
     * Plant automatischen Session-Reset
     */
    scheduleAutoReset(sessionId, triggerDurationMinutes = 0) {
        if (!this.config.autoResetAfterQC) return;

        const qcSession = this.getQCSession(sessionId);
        if (!qcSession || qcSession.autoResetScheduled) return;

        // Prüfe ob noch aktive QC-Schritte vorhanden
        if (qcSession.activeQCSteps.size > 0) {
            console.log(`⏸️ Auto-Reset verschoben - noch ${qcSession.activeQCSteps.size} aktive QC-Schritte`);
            return;
        }

        qcSession.autoResetScheduled = true;

        const delayMs = this.config.resetDelaySeconds * 1000;

        const resetTimer = setTimeout(() => {
            this.executeAutoReset(sessionId, triggerDurationMinutes);
        }, delayMs);

        this.sessionResetTimers.set(sessionId, resetTimer);

        console.log(`⏰ Auto-Reset geplant für Session ${sessionId} in ${this.config.resetDelaySeconds}s`);

        this.emit('qc-auto-reset-scheduled', {
            sessionId: sessionId,
            delaySeconds: this.config.resetDelaySeconds,
            triggerDurationMinutes: triggerDurationMinutes
        });

        // Benachrichtigung mit Countdown
        this.notifyAutoResetScheduled(sessionId, this.config.resetDelaySeconds);
    }

    /**
     * Bricht geplanten Auto-Reset ab
     */
    cancelAutoReset(sessionId) {
        const timer = this.sessionResetTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.sessionResetTimers.delete(sessionId);

            const qcSession = this.getQCSession(sessionId);
            if (qcSession) {
                qcSession.autoResetScheduled = false;
            }

            console.log(`❌ Auto-Reset abgebrochen für Session ${sessionId}`);

            this.emit('qc-auto-reset-cancelled', { sessionId: sessionId });
        }
    }

    /**
     * Führt automatischen Session-Reset aus
     */
    async executeAutoReset(sessionId, triggerDurationMinutes) {
        try {
            const qcSession = this.getQCSession(sessionId);
            if (!qcSession) {
                console.warn(`QC-Session ${sessionId} nicht gefunden für Auto-Reset`);
                return;
            }

            // Prüfe nochmals ob noch aktive QC-Schritte vorhanden
            if (qcSession.activeQCSteps.size > 0) {
                console.log(`⏸️ Auto-Reset abgebrochen - noch aktive QC-Schritte vorhanden`);
                qcSession.autoResetScheduled = false;
                return;
            }

            console.log(`🔄 Führe Auto-Reset aus für Session ${sessionId}`);

            // Session-Ende markieren
            qcSession.endTime = new Date();
            qcSession.autoResetScheduled = false;

            // Statistiken aktualisieren
            this.sessionStats.autoResets++;
            this.updateSessionStatistics(qcSession);

            // Session über App beenden (falls möglich)
            if (this.app && typeof this.app.endSession === 'function') {
                await this.app.endSession(sessionId);
            }

            // QC-Session-Daten bereinigen
            this.cleanupQCSession(sessionId);

            this.emit('qc-auto-reset-executed', {
                sessionId: sessionId,
                userId: qcSession.userId,
                completedSteps: qcSession.completedQCSteps.length,
                totalSteps: qcSession.totalQCSteps,
                triggerDurationMinutes: triggerDurationMinutes
            });

            // Erfolgs-Benachrichtigung
            this.notifyAutoResetCompleted(sessionId, qcSession);

        } catch (error) {
            console.error(`Fehler beim Auto-Reset für Session ${sessionId}:`, error);

            this.emit('qc-auto-reset-failed', {
                sessionId: sessionId,
                error: error.message
            });
        }
    }

    // ===== SESSION EVENT HANDLERS =====

    /**
     * Behandelt Session-Erstellung
     */
    handleSessionCreated(data) {
        const { sessionId, userId, sessionType } = data;

        // Nur für QC-relevante Sessions
        if (sessionType === 'Qualitätskontrolle' || sessionType === 'Wareneinlagerung') {
            this.initializeQCSession(sessionId, userId, sessionType);
        }
    }

    /**
     * Behandelt Session-Ende
     */
    handleSessionEnded(data) {
        const sessionId = data.sessionId || data.ID;

        // Auto-Reset abbrechen falls geplant
        this.cancelAutoReset(sessionId);

        // QC-Session bereinigen
        this.cleanupQCSession(sessionId);
    }

    /**
     * Behandelt User-Logout
     */
    handleUserLogout(data) {
        const userId = data.userId || data.ID;

        // Alle QC-Sessions des Benutzers bereinigen
        for (const [sessionId, qcSession] of this.qcSessions) {
            if (qcSession.userId === userId) {
                this.cancelAutoReset(sessionId);
                this.cleanupQCSession(sessionId);
            }
        }
    }

    // ===== NOTIFICATIONS =====

    /**
     * Benachrichtigung über QC-Session-Events
     */
    notifySessionQCEvent(sessionId, eventType, data) {
        if (!this.config.enableQCSessionNotifications) return;

        const messages = {
            qc_started: `QC gestartet: ${this.getShortQRCode(data.qrCode)}`,
            qc_completed: `QC abgeschlossen: ${this.getShortQRCode(data.qrCode)} (${data.durationMinutes} Min)`,
            qc_aborted: `QC abgebrochen: ${this.getShortQRCode(data.qrCode)}`
        };

        const message = messages[eventType] || `QC-Event: ${eventType}`;

        if (this.app && typeof this.app.showNotification === 'function') {
            this.app.showNotification('info', 'QC-Session', message);
        }

        this.playSessionQCAudio(eventType);
    }

    /**
     * Benachrichtigung über geplanten Auto-Reset
     */
    notifyAutoResetScheduled(sessionId, delaySeconds) {
        if (!this.config.enableQCSessionNotifications) return;

        if (this.app && typeof this.app.showNotification === 'function') {
            this.app.showNotification('warning', 'Auto-Reset geplant',
                `Session wird in ${delaySeconds} Sekunden automatisch beendet`);
        }

        this.playSessionQCAudio('auto_reset_scheduled');
    }

    /**
     * Benachrichtigung über abgeschlossenen Auto-Reset
     */
    notifyAutoResetCompleted(sessionId, qcSession) {
        if (!this.config.enableQCSessionNotifications) return;

        if (this.app && typeof this.app.showNotification === 'function') {
            this.app.showNotification('success', 'Session beendet',
                `${qcSession.completedQCSteps.length} QC-Schritte abgeschlossen - Session automatisch beendet`);
        }

        this.playSessionQCAudio('auto_reset_completed');
    }

    // ===== AUDIO FEEDBACK =====

    /**
     * Spielt QC-Session-Audio ab
     */
    playSessionQCAudio(eventType) {
        if (!this.config.enableQCSessionAudio) return;

        try {
            const audioPatterns = {
                qc_started: [800, 1000],
                qc_completed: [1200, 1000, 800],
                qc_aborted: [600, 400],
                auto_reset_scheduled: [1000, 800, 1000],
                auto_reset_completed: [1200, 1400, 1600]
            };

            const pattern = audioPatterns[eventType] || [800];

            if (typeof window !== 'undefined' && window.AudioContext) {
                const context = new (window.AudioContext || window.webkitAudioContext)();

                pattern.forEach((frequency, index) => {
                    const oscillator = context.createOscillator();
                    const gainNode = context.createGain();

                    oscillator.connect(gainNode);
                    gainNode.connect(context.destination);

                    oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.2);
                    gainNode.gain.setValueAtTime(0.2, context.currentTime + index * 0.2);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + (index + 1) * 0.2);

                    oscillator.start(context.currentTime + index * 0.2);
                    oscillator.stop(context.currentTime + (index + 1) * 0.2);
                });
            }
        } catch (error) {
            console.log('QC-Session Audio nicht verfügbar');
        }
    }

    // ===== STATISTICS =====

    /**
     * Aktualisiert Session-Statistiken
     */
    updateSessionStatistics(qcSession) {
        const sessionDurationMinutes = qcSession.endTime ?
            Math.round((qcSession.endTime - qcSession.startTime) / (1000 * 60)) : 0;

        // Durchschnittliche QC-Schritte pro Session
        const totalSessions = this.sessionStats.totalQCSessions;
        const currentAvgSteps = this.sessionStats.avgQCStepsPerSession;
        this.sessionStats.avgQCStepsPerSession =
            ((currentAvgSteps * (totalSessions - 1)) + qcSession.totalQCSteps) / totalSessions;

        // Durchschnittliche Session-Dauer
        const currentAvgDuration = this.sessionStats.avgSessionDuration;
        this.sessionStats.avgSessionDuration =
            ((currentAvgDuration * (totalSessions - 1)) + sessionDurationMinutes) / totalSessions;
    }

    /**
     * Ruft QC-Session-Statistiken ab
     */
    getQCSessionStatistics() {
        return {
            ...this.sessionStats,
            activeSessions: this.qcSessions.size,
            sessionsWithActiveQC: this.getSessionsWithActiveQC().length,
            avgQCStepsPerSession: Math.round(this.sessionStats.avgQCStepsPerSession * 100) / 100,
            avgSessionDuration: Math.round(this.sessionStats.avgSessionDuration * 100) / 100,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Ruft Sessions mit aktiven QC-Schritten ab
     */
    getSessionsWithActiveQC() {
        const sessionsWithQC = [];

        for (const [sessionId, qcSession] of this.qcSessions) {
            if (qcSession.activeQCSteps.size > 0) {
                sessionsWithQC.push({
                    sessionId: sessionId,
                    userId: qcSession.userId,
                    activeSteps: qcSession.activeQCSteps.size,
                    completedSteps: qcSession.completedQCSteps.length,
                    totalSteps: qcSession.totalQCSteps,
                    startTime: qcSession.startTime,
                    lastActivity: qcSession.lastActivity
                });
            }
        }

        return sessionsWithQC;
    }

    // ===== UTILITY METHODS =====

    /**
     * Bereinigt QC-Session-Daten
     */
    cleanupQCSession(sessionId) {
        const qcSession = this.qcSessions.get(sessionId);
        if (qcSession) {
            // Statistiken aktualisieren falls noch nicht geschehen
            if (!qcSession.endTime) {
                qcSession.endTime = new Date();
                this.updateSessionStatistics(qcSession);
            }
        }

        // Timer bereinigen
        const timer = this.sessionResetTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.sessionResetTimers.delete(sessionId);
        }

        // Session-Daten entfernen
        this.qcSessions.delete(sessionId);
        this.qcStepsBySession.delete(sessionId);

        console.log(`🧹 QC-Session bereinigt: ${sessionId}`);
    }

    /**
     * Erstellt kurze QR-Code-Anzeige
     */
    getShortQRCode(qrCode) {
        if (!qrCode) return '';

        if (qrCode.length <= 12) return qrCode;

        if (qrCode.includes('^')) {
            const parts = qrCode.split('^');
            return parts.length > 3 ? `${parts[1]}...${parts[3]}` : qrCode.substring(0, 12) + '...';
        }

        return qrCode.substring(0, 8) + '...' + qrCode.substring(qrCode.length - 4);
    }

    // ===== CONFIGURATION =====

    /**
     * Aktualisiert QC-Session-Konfiguration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('QC-Session-Konfiguration aktualisiert:', this.config);
    }

    /**
     * Aktiviert/Deaktiviert Auto-Reset
     */
    setAutoResetEnabled(enabled) {
        this.config.autoResetAfterQC = enabled;

        if (!enabled) {
            // Alle geplanten Auto-Resets abbrechen
            for (const sessionId of this.sessionResetTimers.keys()) {
                this.cancelAutoReset(sessionId);
            }
        }

        console.log(`QC Auto-Reset ${enabled ? 'aktiviert' : 'deaktiviert'}`);
    }

    // ===== CLEANUP =====

    /**
     * Bereinigt QC-Session-Handler
     */
    cleanup() {
        console.log('🧹 QC Session Handler wird bereinigt...');

        // Alle Timer stoppen
        for (const timer of this.sessionResetTimers.values()) {
            clearTimeout(timer);
        }
        this.sessionResetTimers.clear();

        // Session-Daten bereinigen
        this.qcSessions.clear();
        this.qcStepsBySession.clear();

        // Event-Listener entfernen
        this.removeAllListeners();

        console.log('✅ QC Session Handler bereinigt');
    }
}

module.exports = QCSessionHandler;
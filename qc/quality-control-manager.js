/**
 * Quality Control Manager für doppelte QR-Scans
 * Zentrale Verwaltung der QC-Workflows mit automatischem Session-Reset
 * Version: 1.0.0 - Wareneinlagerung Multi-User QC System
 */

const EventEmitter = require('events');

class QualityControlManager extends EventEmitter {
    constructor(appInstance) {
        super();

        // Referenz zur Hauptanwendung
        this.app = appInstance;

        // QC-Status Tracking
        this.activeQCSteps = new Map(); // qrCode -> QC-Step-Data
        this.qcSessionMapping = new Map(); // sessionId -> Set von QR-Codes
        this.qcTimers = new Map(); // qrCode -> Timer für Überfälligkeits-Check

        // QC-Konfiguration
        this.config = {
            enabled: true,
            autoSessionReset: true,
            showProgressIndicators: true,
            enableAudioFeedback: true,
            enableNotifications: true,
            defaultEstimatedMinutes: 15,
            overdueThresholdMinutes: 30,
            enableOverdueWarnings: true,
            maxParallelQCSteps: 5
        };

        // QC-Statistiken
        this.statistics = {
            totalStarted: 0,
            totalCompleted: 0,
            totalAborted: 0,
            averageDurationMinutes: 0,
            completionRate: 0,
            overdueCount: 0
        };

        // Event-Handler einrichten
        this.setupEventHandlers();

        console.log('🔍 QualityControlManager initialisiert');
    }

    // ===== INITIALIZATION =====

    setupEventHandlers() {
        // App-Events abonnieren
        if (this.app && typeof this.app.on === 'function') {
            this.app.on('qr-scan-processed', this.handleQRScanProcessed.bind(this));
            this.app.on('session-ended', this.handleSessionEnded.bind(this));
            this.app.on('user-logout', this.handleUserLogout.bind(this));
        }

        // Periodische Überfälligkeits-Checks
        this.overdueCheckInterval = setInterval(() => {
            this.checkOverdueQCSteps();
        }, 60000); // Jede Minute

        console.log('📡 QC Event-Handler eingerichtet');
    }

    // ===== QC-WORKFLOW VERARBEITUNG =====

    /**
     * Verarbeitet QR-Scan für QC-Workflow
     * @param {Object} scanResult - Ergebnis des QR-Scans
     * @param {string} qrCode - QR-Code
     * @param {number} sessionId - Session-ID
     * @returns {Object} - QC-Verarbeitungsresultat
     */
    async processQRScanForQC(scanResult, qrCode, sessionId) {
        try {
            console.log(`🔍 QC-Verarbeitung für QR: ${qrCode}, Session: ${sessionId}`);

            // Prüfe ob bereits ein aktiver QC-Schritt existiert
            const existingQCStep = this.getActiveQCStep(qrCode);

            if (existingQCStep) {
                // ZWEITER SCAN: QC-Schritt abschließen
                return await this.completeQCStep(qrCode, scanResult, sessionId);
            } else {
                // ERSTER SCAN: QC-Schritt starten
                return await this.startQCStep(qrCode, scanResult, sessionId);
            }

        } catch (error) {
            console.error('Fehler bei QC-Verarbeitung:', error);
            return {
                qcProcessed: false,
                action: 'qc_error',
                message: `QC-Fehler: ${error.message}`
            };
        }
    }

    /**
     * Startet einen neuen QC-Schritt (erster QR-Scan)
     */
    async startQCStep(qrCode, scanResult, sessionId) {
        try {
            const startTime = new Date();
            const estimatedMinutes = this.config.defaultEstimatedMinutes;

            // QC-Schritt-Daten erstellen
            const qcStep = {
                qrCode: qrCode,
                sessionId: sessionId,
                scanId: scanResult.data?.ID,
                startTime: startTime,
                estimatedMinutes: estimatedMinutes,
                priority: 1,
                status: 'active',
                userId: this.getUserIdForSession(sessionId)
            };

            // In lokaler Verwaltung speichern
            this.activeQCSteps.set(qrCode, qcStep);

            // Session-Mapping aktualisieren
            if (!this.qcSessionMapping.has(sessionId)) {
                this.qcSessionMapping.set(sessionId, new Set());
            }
            this.qcSessionMapping.get(sessionId).add(qrCode);

            // Überfälligkeits-Timer starten
            this.startOverdueTimer(qrCode);

            // Statistiken aktualisieren
            this.statistics.totalStarted++;

            // Events emittieren
            this.emit('qc-step-started', {
                qrCode: qrCode,
                sessionId: sessionId,
                estimatedMinutes: estimatedMinutes,
                startTime: startTime,
                userId: qcStep.userId
            });

            this.notifyQCStarted(qrCode, sessionId);

            console.log(`🔍 QC-Schritt gestartet: ${qrCode}`);

            return {
                qcProcessed: true,
                action: 'qc_started',
                qrCode: qrCode,
                sessionId: sessionId,
                estimatedMinutes: estimatedMinutes,
                message: 'Qualitätsprüfung gestartet - scannen Sie erneut zum Abschließen'
            };

        } catch (error) {
            console.error('Fehler beim QC-Start:', error);
            return {
                qcProcessed: false,
                action: 'qc_start_error',
                message: `QC-Start fehlgeschlagen: ${error.message}`
            };
        }
    }

    /**
     * Schließt einen QC-Schritt ab (zweiter QR-Scan)
     */
    async completeQCStep(qrCode, scanResult, sessionId) {
        try {
            const qcStep = this.activeQCSteps.get(qrCode);
            if (!qcStep) {
                throw new Error(`QC-Schritt für ${qrCode} nicht gefunden`);
            }

            const endTime = new Date();
            const durationMinutes = Math.round((endTime - qcStep.startTime) / (1000 * 60));

            // QC-Schritt abschließen
            qcStep.endTime = endTime;
            qcStep.durationMinutes = durationMinutes;
            qcStep.status = 'completed';
            qcStep.endScanId = scanResult.data?.ID;

            // Überfälligkeits-Timer stoppen
            this.stopOverdueTimer(qrCode);

            // Aus aktiver Verwaltung entfernen
            this.activeQCSteps.delete(qrCode);

            // Session-Mapping aktualisieren
            const sessionQRCodes = this.qcSessionMapping.get(sessionId);
            if (sessionQRCodes) {
                sessionQRCodes.delete(qrCode);
                if (sessionQRCodes.size === 0) {
                    this.qcSessionMapping.delete(sessionId);
                }
            }

            // Statistiken aktualisieren
            this.statistics.totalCompleted++;
            this.updateAverageDuration(durationMinutes);
            this.updateCompletionRate();

            // Events emittieren
            this.emit('qc-step-completed', {
                qrCode: qrCode,
                sessionId: sessionId,
                durationMinutes: durationMinutes,
                userId: qcStep.userId,
                autoSessionReset: this.config.autoSessionReset
            });

            this.notifyQCCompleted(qrCode, sessionId, durationMinutes);

            console.log(`✅ QC-Schritt abgeschlossen: ${qrCode} (${durationMinutes} Min)`);

            return {
                qcProcessed: true,
                action: 'qc_completed',
                qrCode: qrCode,
                sessionId: sessionId,
                durationMinutes: durationMinutes,
                autoSessionReset: this.config.autoSessionReset,
                message: `Qualitätsprüfung abgeschlossen (${durationMinutes} Min)`
            };

        } catch (error) {
            console.error('Fehler beim QC-Abschluss:', error);
            return {
                qcProcessed: false,
                action: 'qc_complete_error',
                message: `QC-Abschluss fehlgeschlagen: ${error.message}`
            };
        }
    }

    // ===== QC-STATUS MANAGEMENT =====

    /**
     * Ruft aktiven QC-Schritt für QR-Code ab
     */
    getActiveQCStep(qrCode) {
        return this.activeQCSteps.get(qrCode) || null;
    }

    /**
     * Ruft alle aktiven QC-Schritte für Session ab
     */
    getActiveQCStepsForSession(sessionId) {
        const sessionQRCodes = this.qcSessionMapping.get(sessionId);
        if (!sessionQRCodes) return [];

        const steps = [];
        for (const qrCode of sessionQRCodes) {
            const step = this.activeQCSteps.get(qrCode);
            if (step) {
                steps.push({
                    qrCode: qrCode,
                    startTime: step.startTime,
                    estimatedMinutes: step.estimatedMinutes,
                    minutesInProgress: Math.round((new Date() - step.startTime) / (1000 * 60)),
                    isOverdue: this.isQCStepOverdue(step),
                    priority: step.priority,
                    status: step.status
                });
            }
        }

        return steps.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Ruft alle aktiven QC-Schritte ab
     */
    getAllActiveQCSteps() {
        const steps = [];

        for (const [qrCode, step] of this.activeQCSteps) {
            steps.push({
                qrCode: qrCode,
                sessionId: step.sessionId,
                startTime: step.startTime,
                estimatedMinutes: step.estimatedMinutes,
                minutesInProgress: Math.round((new Date() - step.startTime) / (1000 * 60)),
                isOverdue: this.isQCStepOverdue(step),
                priority: step.priority,
                status: step.status,
                userId: step.userId
            });
        }

        return steps.sort((a, b) => {
            // Sortierung: Überfällige zuerst, dann nach Priorität, dann nach Zeit
            if (a.isOverdue !== b.isOverdue) return b.isOverdue - a.isOverdue;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.startTime - b.startTime;
        });
    }

    /**
     * Prüft ob QC-Schritt überfällig ist
     */
    isQCStepOverdue(qcStep) {
        if (!qcStep.estimatedMinutes) return false;

        const minutesInProgress = Math.round((new Date() - qcStep.startTime) / (1000 * 60));
        return minutesInProgress > (qcStep.estimatedMinutes + 5); // 5 Min Toleranz
    }

    // ===== SESSION-MANAGEMENT =====

    /**
     * Behandelt Session-Ende-Events
     */
    async handleSessionEnded(sessionData) {
        try {
            const sessionId = sessionData.sessionId || sessionData.ID;
            await this.abortQCStepsForSession(sessionId, 'Session beendet');
        } catch (error) {
            console.error('Fehler beim Session-Ende QC-Handling:', error);
        }
    }

    /**
     * Behandelt User-Logout-Events
     */
    async handleUserLogout(userData) {
        try {
            // Alle Sessions des Benutzers finden und QC-Schritte abbrechen
            const userId = userData.userId || userData.ID;

            for (const [sessionId, qrCodes] of this.qcSessionMapping) {
                const sessionUserId = this.getUserIdForSession(sessionId);
                if (sessionUserId === userId) {
                    await this.abortQCStepsForSession(sessionId, 'Benutzer abgemeldet');
                }
            }
        } catch (error) {
            console.error('Fehler beim User-Logout QC-Handling:', error);
        }
    }

    /**
     * Bricht alle QC-Schritte für eine Session ab
     */
    async abortQCStepsForSession(sessionId, reason = 'Session beendet') {
        try {
            const sessionQRCodes = this.qcSessionMapping.get(sessionId);
            if (!sessionQRCodes) return;

            const abortedSteps = [];

            for (const qrCode of sessionQRCodes) {
                const qcStep = this.activeQCSteps.get(qrCode);
                if (qcStep) {
                    // QC-Schritt abbrechen
                    qcStep.status = 'aborted';
                    qcStep.endTime = new Date();
                    qcStep.abortReason = reason;

                    // Timer stoppen
                    this.stopOverdueTimer(qrCode);

                    // Aus aktiver Verwaltung entfernen
                    this.activeQCSteps.delete(qrCode);

                    abortedSteps.push(qrCode);

                    // Event emittieren
                    this.emit('qc-step-aborted', {
                        qrCode: qrCode,
                        sessionId: sessionId,
                        reason: reason,
                        userId: qcStep.userId
                    });
                }
            }

            // Session-Mapping bereinigen
            this.qcSessionMapping.delete(sessionId);

            // Statistiken aktualisieren
            this.statistics.totalAborted += abortedSteps.length;
            this.updateCompletionRate();

            console.log(`🛑 ${abortedSteps.length} QC-Schritte für Session ${sessionId} abgebrochen: ${reason}`);

        } catch (error) {
            console.error('Fehler beim Abbrechen der QC-Schritte:', error);
        }
    }

    // ===== ÜBERFÄLLIGKEITS-MANAGEMENT =====

    /**
     * Startet Überfälligkeits-Timer für QC-Schritt
     */
    startOverdueTimer(qrCode) {
        const qcStep = this.activeQCSteps.get(qrCode);
        if (!qcStep || !qcStep.estimatedMinutes) return;

        const timeoutMs = (qcStep.estimatedMinutes + 5) * 60 * 1000; // +5 Min Toleranz

        const timer = setTimeout(() => {
            this.handleOverdueQCStep(qrCode);
        }, timeoutMs);

        this.qcTimers.set(qrCode, timer);
    }

    /**
     * Stoppt Überfälligkeits-Timer für QC-Schritt
     */
    stopOverdueTimer(qrCode) {
        const timer = this.qcTimers.get(qrCode);
        if (timer) {
            clearTimeout(timer);
            this.qcTimers.delete(qrCode);
        }
    }

    /**
     * Behandelt überfällige QC-Schritte
     */
    handleOverdueQCStep(qrCode) {
        const qcStep = this.activeQCSteps.get(qrCode);
        if (!qcStep) return;

        const minutesInProgress = Math.round((new Date() - qcStep.startTime) / (1000 * 60));

        console.warn(`⚠️ QC-Schritt überfällig: ${qrCode} (${minutesInProgress} Min)`);

        // Statistiken aktualisieren
        this.statistics.overdueCount++;

        // Event emittieren
        this.emit('qc-step-overdue', {
            qrCode: qrCode,
            sessionId: qcStep.sessionId,
            minutesInProgress: minutesInProgress,
            estimatedMinutes: qcStep.estimatedMinutes,
            userId: qcStep.userId
        });

        // Benachrichtigung senden
        this.notifyQCOverdue(qrCode, qcStep.sessionId, minutesInProgress);
    }

    /**
     * Prüft alle aktiven QC-Schritte auf Überfälligkeit
     */
    checkOverdueQCSteps() {
        const now = new Date();

        for (const [qrCode, qcStep] of this.activeQCSteps) {
            if (this.isQCStepOverdue(qcStep)) {
                const minutesInProgress = Math.round((now - qcStep.startTime) / (1000 * 60));

                // Nur wenn noch nicht als überfällig behandelt
                if (!qcStep.overdueNotified) {
                    qcStep.overdueNotified = true;
                    this.handleOverdueQCStep(qrCode);
                }
            }
        }
    }

    // ===== BENACHRICHTIGUNGEN =====

    notifyQCStarted(qrCode, sessionId) {
        if (!this.config.enableNotifications) return;

        const shortCode = this.getShortQRCode(qrCode);

        if (this.app && typeof this.app.showNotification === 'function') {
            this.app.showNotification('info', 'QC gestartet',
                `Qualitätsprüfung für ${shortCode} begonnen`);
        }

        this.playQCAudio('start');
    }

    notifyQCCompleted(qrCode, sessionId, durationMinutes) {
        if (!this.config.enableNotifications) return;

        const shortCode = this.getShortQRCode(qrCode);

        if (this.app && typeof this.app.showNotification === 'function') {
            this.app.showNotification('success', 'QC abgeschlossen',
                `Qualitätsprüfung für ${shortCode} abgeschlossen (${durationMinutes} Min)`);
        }

        this.playQCAudio('complete');
    }

    notifyQCOverdue(qrCode, sessionId, minutesInProgress) {
        if (!this.config.enableNotifications) return;

        const shortCode = this.getShortQRCode(qrCode);

        if (this.app && typeof this.app.showNotification === 'function') {
            this.app.showNotification('warning', 'QC überfällig',
                `Qualitätsprüfung für ${shortCode} ist ${minutesInProgress} Min überfällig`);
        }

        this.playQCAudio('overdue');
    }

    // ===== AUDIO-FEEDBACK =====

    playQCAudio(type) {
        if (!this.config.enableAudioFeedback) return;

        try {
            // Verschiedene Töne für verschiedene QC-Events
            const frequencies = {
                start: [800, 1000], // Aufsteigend
                complete: [1200, 1000, 800], // Absteigend (Erfolg)
                overdue: [400, 600, 400] // Warnton
            };

            const freq = frequencies[type] || [800];

            if (typeof window !== 'undefined' && window.AudioContext) {
                const context = new (window.AudioContext || window.webkitAudioContext)();

                freq.forEach((frequency, index) => {
                    const oscillator = context.createOscillator();
                    const gainNode = context.createGain();

                    oscillator.connect(gainNode);
                    gainNode.connect(context.destination);

                    oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.15);
                    gainNode.gain.setValueAtTime(0.3, context.currentTime + index * 0.15);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + (index + 1) * 0.15);

                    oscillator.start(context.currentTime + index * 0.15);
                    oscillator.stop(context.currentTime + (index + 1) * 0.15);
                });
            }
        } catch (error) {
            console.log('QC Audio-Feedback nicht verfügbar');
        }
    }

    // ===== STATISTIKEN =====

    updateAverageDuration(newDuration) {
        if (this.statistics.totalCompleted === 1) {
            this.statistics.averageDurationMinutes = newDuration;
        } else {
            const totalMinutes = this.statistics.averageDurationMinutes * (this.statistics.totalCompleted - 1) + newDuration;
            this.statistics.averageDurationMinutes = Math.round(totalMinutes / this.statistics.totalCompleted);
        }
    }

    updateCompletionRate() {
        const total = this.statistics.totalStarted;
        if (total > 0) {
            this.statistics.completionRate = Math.round((this.statistics.totalCompleted / total) * 100);
        }
    }

    getQCStatistics() {
        return {
            ...this.statistics,
            activeSteps: this.activeQCSteps.size,
            activeSessions: this.qcSessionMapping.size,
            overdueSteps: this.getOverdueStepCount(),
            timestamp: new Date().toISOString()
        };
    }

    getOverdueStepCount() {
        let count = 0;
        for (const qcStep of this.activeQCSteps.values()) {
            if (this.isQCStepOverdue(qcStep)) {
                count++;
            }
        }
        return count;
    }

    // ===== UTILITY METHODS =====

    getUserIdForSession(sessionId) {
        // Versuche User-ID aus aktivem Session-Mapping der App zu holen
        if (this.app && this.app.activeSessions) {
            for (const [userId, sessionData] of this.app.activeSessions) {
                if (sessionData.sessionId === sessionId) {
                    return userId;
                }
            }
        }
        return null;
    }

    getShortQRCode(qrCode) {
        if (!qrCode) return '';

        if (qrCode.length <= 12) return qrCode;

        // Strukturierte Daten erkennen
        if (qrCode.includes('^')) {
            const parts = qrCode.split('^');
            return parts.length > 3 ? `${parts[1]}...${parts[3]}` : qrCode.substring(0, 12) + '...';
        }

        return qrCode.substring(0, 8) + '...' + qrCode.substring(qrCode.length - 4);
    }

    // ===== CONFIGURATION =====

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        console.log('QC-Konfiguration aktualisiert:', this.config);
    }

    isEnabled() {
        return this.config.enabled;
    }

    setEnabled(enabled) {
        this.config.enabled = enabled;

        if (!enabled) {
            // Alle aktiven QC-Schritte abbrechen wenn QC deaktiviert wird
            for (const [qrCode] of this.activeQCSteps) {
                this.stopOverdueTimer(qrCode);
            }
            this.activeQCSteps.clear();
            this.qcSessionMapping.clear();
        }

        console.log(`QC-System ${enabled ? 'aktiviert' : 'deaktiviert'}`);
    }

    // ===== DATA REFRESH =====

    async refreshQCData() {
        try {
            // QC-Statistiken neu laden (falls über Backend verfügbar)
            if (this.app && typeof this.app.electronAPI !== 'undefined') {
                // Placeholder für Backend-Statistiken
                console.log('QC-Daten werden aktualisiert...');
            }

            // Lokale Statistiken neu berechnen
            this.updateCompletionRate();

            console.log('QC-Daten aktualisiert');
            return true;
        } catch (error) {
            console.error('Fehler beim Aktualisieren der QC-Daten:', error);
            return false;
        }
    }

    // ===== CLEANUP =====

    cleanup() {
        console.log('🧹 QC Manager wird bereinigt...');

        // Alle Timer stoppen
        for (const timer of this.qcTimers.values()) {
            clearTimeout(timer);
        }
        this.qcTimers.clear();

        // Überfälligkeits-Check stoppen
        if (this.overdueCheckInterval) {
            clearInterval(this.overdueCheckInterval);
        }

        // QC-Daten zurücksetzen
        this.activeQCSteps.clear();
        this.qcSessionMapping.clear();

        // Event-Listener entfernen
        this.removeAllListeners();

        console.log('✅ QC Manager bereinigt');
    }

    // ===== EVENT HANDLERS FOR APP INTEGRATION =====

    handleQRScanProcessed(data) {
        // Wird von der App aufgerufen wenn ein QR-Scan verarbeitet wurde
        // Hier können zusätzliche QC-spezifische Aktionen implementiert werden
        console.log('QR-Scan für QC verarbeitet:', data);
    }
}

module.exports = QualityControlManager;
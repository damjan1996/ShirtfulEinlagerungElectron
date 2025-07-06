/**
 * QC State Machine für Qualitätskontrolle-Workflows
 * Verwaltet Zustandsübergänge und Workflow-Logik für QC-Schritte
 * Version: 1.0.0 - Wareneinlagerung Multi-User QC System
 */

const EventEmitter = require('events');

class QCStateMachine extends EventEmitter {
    constructor() {
        super();

        // QC-Zustandsdefinitionen
        this.states = {
            IDLE: 'idle',
            QC_PENDING: 'qc_pending',
            QC_ACTIVE: 'qc_active',
            QC_COMPLETED: 'qc_completed',
            QC_ABORTED: 'qc_aborted',
            QC_OVERDUE: 'qc_overdue',
            QC_ERROR: 'qc_error'
        };

        // QC-Events
        this.events = {
            START_QC: 'start_qc',
            COMPLETE_QC: 'complete_qc',
            ABORT_QC: 'abort_qc',
            QC_TIMEOUT: 'qc_timeout',
            QC_ERROR: 'qc_error',
            RESET: 'reset'
        };

        // QC-Zustandsübergänge
        this.transitions = {
            [this.states.IDLE]: {
                [this.events.START_QC]: this.states.QC_ACTIVE
            },
            [this.states.QC_ACTIVE]: {
                [this.events.COMPLETE_QC]: this.states.QC_COMPLETED,
                [this.events.ABORT_QC]: this.states.QC_ABORTED,
                [this.events.QC_TIMEOUT]: this.states.QC_OVERDUE,
                [this.events.QC_ERROR]: this.states.QC_ERROR
            },
            [this.states.QC_COMPLETED]: {
                [this.events.RESET]: this.states.IDLE,
                [this.events.START_QC]: this.states.QC_ACTIVE // Neuer QC-Schritt
            },
            [this.states.QC_ABORTED]: {
                [this.events.RESET]: this.states.IDLE,
                [this.events.START_QC]: this.states.QC_ACTIVE // Neustart
            },
            [this.states.QC_OVERDUE]: {
                [this.events.COMPLETE_QC]: this.states.QC_COMPLETED,
                [this.events.ABORT_QC]: this.states.QC_ABORTED,
                [this.events.RESET]: this.states.IDLE
            },
            [this.states.QC_ERROR]: {
                [this.events.RESET]: this.states.IDLE,
                [this.events.START_QC]: this.states.QC_ACTIVE // Retry
            }
        };

        // Aktuelle QC-Instanzen verwalten
        this.qcInstances = new Map(); // qrCode -> QCInstance

        console.log('🔄 QC State Machine initialisiert');
    }

    // ===== QC INSTANCE MANAGEMENT =====

    /**
     * Erstellt eine neue QC-Instanz für einen QR-Code
     */
    createQCInstance(qrCode, sessionId, options = {}) {
        const instance = {
            qrCode: qrCode,
            sessionId: sessionId,
            state: this.states.IDLE,
            startTime: null,
            endTime: null,
            estimatedDuration: options.estimatedDuration || 15,
            priority: options.priority || 1,
            metadata: options.metadata || {},
            history: [],
            timers: new Map()
        };

        this.qcInstances.set(qrCode, instance);
        this.logStateChange(instance, null, this.states.IDLE, 'QC-Instanz erstellt');

        console.log(`🆕 QC-Instanz erstellt: ${qrCode}`);
        return instance;
    }

    /**
     * Ruft QC-Instanz für QR-Code ab
     */
    getQCInstance(qrCode) {
        return this.qcInstances.get(qrCode);
    }

    /**
     * Entfernt QC-Instanz
     */
    removeQCInstance(qrCode) {
        const instance = this.qcInstances.get(qrCode);
        if (instance) {
            // Alle Timer stoppen
            for (const timer of instance.timers.values()) {
                clearTimeout(timer);
            }

            this.qcInstances.delete(qrCode);
            console.log(`🗑️ QC-Instanz entfernt: ${qrCode}`);
        }
    }

    // ===== STATE TRANSITIONS =====

    /**
     * Führt Zustandsübergang aus
     */
    transition(qrCode, event, data = {}) {
        const instance = this.getQCInstance(qrCode);
        if (!instance) {
            console.error(`QC-Instanz für ${qrCode} nicht gefunden`);
            return false;
        }

        const currentState = instance.state;
        const validTransitions = this.transitions[currentState];

        if (!validTransitions || !validTransitions[event]) {
            console.warn(`Ungültiger Übergang: ${currentState} -> ${event} für ${qrCode}`);
            return false;
        }

        const newState = validTransitions[event];
        const oldState = instance.state;

        // Zustand aktualisieren
        instance.state = newState;

        // Zeitstempel setzen
        if (event === this.events.START_QC) {
            instance.startTime = new Date();
        } else if (event === this.events.COMPLETE_QC) {
            instance.endTime = new Date();
        }

        // Metadaten aktualisieren
        if (data) {
            instance.metadata = { ...instance.metadata, ...data };
        }

        // Verlauf protokollieren
        this.logStateChange(instance, oldState, newState, event, data);

        // State-spezifische Aktionen ausführen
        this.executeStateActions(instance, newState, event, data);

        // Event emittieren
        this.emit('state-changed', {
            qrCode: qrCode,
            oldState: oldState,
            newState: newState,
            event: event,
            data: data,
            instance: instance
        });

        console.log(`🔄 QC-Zustand: ${qrCode} ${oldState} -> ${newState} (${event})`);
        return true;
    }

    // ===== STATE-SPECIFIC ACTIONS =====

    /**
     * Führt zustandsspezifische Aktionen aus
     */
    executeStateActions(instance, state, event, data) {
        switch (state) {
            case this.states.QC_ACTIVE:
                this.onQCActive(instance, data);
                break;

            case this.states.QC_COMPLETED:
                this.onQCCompleted(instance, data);
                break;

            case this.states.QC_ABORTED:
                this.onQCAborted(instance, data);
                break;

            case this.states.QC_OVERDUE:
                this.onQCOverdue(instance, data);
                break;

            case this.states.QC_ERROR:
                this.onQCError(instance, data);
                break;
        }
    }

    /**
     * QC-Schritt wird aktiv
     */
    onQCActive(instance, data) {
        // Timeout-Timer starten
        const timeoutMs = (instance.estimatedDuration + 5) * 60 * 1000; // +5 Min Toleranz

        const timer = setTimeout(() => {
            this.transition(instance.qrCode, this.events.QC_TIMEOUT, {
                reason: 'Zeitüberschreitung',
                overdueMinutes: Math.round((new Date() - instance.startTime) / (1000 * 60))
            });
        }, timeoutMs);

        instance.timers.set('timeout', timer);

        // Progress-Tracking-Timer (optional)
        const progressTimer = setInterval(() => {
            this.emitProgressUpdate(instance);
        }, 30000); // Alle 30 Sekunden

        instance.timers.set('progress', progressTimer);

        this.emit('qc-started', {
            qrCode: instance.qrCode,
            sessionId: instance.sessionId,
            estimatedDuration: instance.estimatedDuration,
            priority: instance.priority
        });
    }

    /**
     * QC-Schritt abgeschlossen
     */
    onQCCompleted(instance, data) {
        // Timer stoppen
        this.stopAllTimers(instance);

        // Dauer berechnen
        const duration = instance.endTime - instance.startTime;
        const durationMinutes = Math.round(duration / (1000 * 60));

        instance.metadata.actualDuration = durationMinutes;
        instance.metadata.completedAt = instance.endTime;

        this.emit('qc-completed', {
            qrCode: instance.qrCode,
            sessionId: instance.sessionId,
            durationMinutes: durationMinutes,
            estimatedDuration: instance.estimatedDuration,
            quality: data.quality || null,
            notes: data.notes || null
        });

        // Auto-Reset nach kurzer Verzögerung
        setTimeout(() => {
            this.transition(instance.qrCode, this.events.RESET);
        }, 5000);
    }

    /**
     * QC-Schritt abgebrochen
     */
    onQCAborted(instance, data) {
        // Timer stoppen
        this.stopAllTimers(instance);

        instance.metadata.abortedAt = new Date();
        instance.metadata.abortReason = data.reason || 'Unbekannt';

        this.emit('qc-aborted', {
            qrCode: instance.qrCode,
            sessionId: instance.sessionId,
            reason: data.reason,
            duration: instance.startTime ? Math.round((new Date() - instance.startTime) / (1000 * 60)) : 0
        });

        // Auto-Reset nach kurzer Verzögerung
        setTimeout(() => {
            this.transition(instance.qrCode, this.events.RESET);
        }, 3000);
    }

    /**
     * QC-Schritt überfällig
     */
    onQCOverdue(instance, data) {
        instance.metadata.overdueAt = new Date();
        instance.metadata.overdueMinutes = data.overdueMinutes || 0;

        this.emit('qc-overdue', {
            qrCode: instance.qrCode,
            sessionId: instance.sessionId,
            overdueMinutes: data.overdueMinutes,
            estimatedDuration: instance.estimatedDuration
        });

        // Weiterhin Progress-Updates senden
        if (!instance.timers.has('overdue_progress')) {
            const overdueTimer = setInterval(() => {
                this.emitOverdueUpdate(instance);
            }, 60000); // Jede Minute

            instance.timers.set('overdue_progress', overdueTimer);
        }
    }

    /**
     * QC-Fehler aufgetreten
     */
    onQCError(instance, data) {
        // Timer stoppen
        this.stopAllTimers(instance);

        instance.metadata.errorAt = new Date();
        instance.metadata.errorMessage = data.error || 'Unbekannter Fehler';

        this.emit('qc-error', {
            qrCode: instance.qrCode,
            sessionId: instance.sessionId,
            error: data.error,
            canRetry: data.canRetry !== false
        });

        // Auto-Reset nach Verzögerung (außer bei kritischen Fehlern)
        if (data.canRetry !== false) {
            setTimeout(() => {
                this.transition(instance.qrCode, this.events.RESET);
            }, 10000);
        }
    }

    // ===== TIMER MANAGEMENT =====

    /**
     * Stoppt alle Timer für eine Instanz
     */
    stopAllTimers(instance) {
        for (const [name, timer] of instance.timers) {
            clearTimeout(timer);
            clearInterval(timer);
        }
        instance.timers.clear();
    }

    // ===== PROGRESS UPDATES =====

    /**
     * Sendet Progress-Update für aktiven QC-Schritt
     */
    emitProgressUpdate(instance) {
        if (instance.state !== this.states.QC_ACTIVE) return;

        const minutesInProgress = Math.round((new Date() - instance.startTime) / (1000 * 60));
        const progressPercent = Math.min(100, Math.round((minutesInProgress / instance.estimatedDuration) * 100));

        this.emit('qc-progress', {
            qrCode: instance.qrCode,
            sessionId: instance.sessionId,
            minutesInProgress: minutesInProgress,
            estimatedDuration: instance.estimatedDuration,
            progressPercent: progressPercent,
            isNearingEstimate: progressPercent > 80
        });
    }

    /**
     * Sendet Progress-Update für überfälligen QC-Schritt
     */
    emitOverdueUpdate(instance) {
        const minutesInProgress = Math.round((new Date() - instance.startTime) / (1000 * 60));
        const overdueMinutes = minutesInProgress - instance.estimatedDuration;

        this.emit('qc-overdue-progress', {
            qrCode: instance.qrCode,
            sessionId: instance.sessionId,
            minutesInProgress: minutesInProgress,
            overdueMinutes: overdueMinutes,
            estimatedDuration: instance.estimatedDuration
        });
    }

    // ===== WORKFLOW METHODS =====

    /**
     * Startet QC-Workflow für QR-Code
     */
    startQC(qrCode, sessionId, options = {}) {
        let instance = this.getQCInstance(qrCode);

        if (!instance) {
            instance = this.createQCInstance(qrCode, sessionId, options);
        }

        return this.transition(qrCode, this.events.START_QC, options);
    }

    /**
     * Schließt QC-Workflow ab
     */
    completeQC(qrCode, data = {}) {
        return this.transition(qrCode, this.events.COMPLETE_QC, data);
    }

    /**
     * Bricht QC-Workflow ab
     */
    abortQC(qrCode, reason = 'Abgebrochen') {
        return this.transition(qrCode, this.events.ABORT_QC, { reason });
    }

    /**
     * Setzt QC-Workflow zurück
     */
    resetQC(qrCode) {
        const success = this.transition(qrCode, this.events.RESET);
        if (success) {
            this.removeQCInstance(qrCode);
        }
        return success;
    }

    // ===== QUERY METHODS =====

    /**
     * Prüft ob QR-Code aktiven QC-Schritt hat
     */
    hasActiveQC(qrCode) {
        const instance = this.getQCInstance(qrCode);
        return instance && instance.state === this.states.QC_ACTIVE;
    }

    /**
     * Prüft ob QR-Code überfälligen QC-Schritt hat
     */
    hasOverdueQC(qrCode) {
        const instance = this.getQCInstance(qrCode);
        return instance && instance.state === this.states.QC_OVERDUE;
    }

    /**
     * Ruft aktuellen Zustand für QR-Code ab
     */
    getState(qrCode) {
        const instance = this.getQCInstance(qrCode);
        return instance ? instance.state : this.states.IDLE;
    }

    /**
     * Ruft alle aktiven QC-Schritte ab
     */
    getActiveQCSteps() {
        const activeSteps = [];

        for (const [qrCode, instance] of this.qcInstances) {
            if (instance.state === this.states.QC_ACTIVE || instance.state === this.states.QC_OVERDUE) {
                activeSteps.push({
                    qrCode: qrCode,
                    sessionId: instance.sessionId,
                    state: instance.state,
                    startTime: instance.startTime,
                    estimatedDuration: instance.estimatedDuration,
                    priority: instance.priority,
                    minutesInProgress: instance.startTime ?
                        Math.round((new Date() - instance.startTime) / (1000 * 60)) : 0,
                    isOverdue: instance.state === this.states.QC_OVERDUE
                });
            }
        }

        return activeSteps.sort((a, b) => {
            // Sortierung: Überfällige zuerst, dann nach Priorität
            if (a.isOverdue !== b.isOverdue) return b.isOverdue - a.isOverdue;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return a.startTime - b.startTime;
        });
    }

    /**
     * Ruft QC-Schritte für Session ab
     */
    getQCStepsForSession(sessionId) {
        const sessionSteps = [];

        for (const [qrCode, instance] of this.qcInstances) {
            if (instance.sessionId === sessionId) {
                sessionSteps.push({
                    qrCode: qrCode,
                    state: instance.state,
                    startTime: instance.startTime,
                    endTime: instance.endTime,
                    estimatedDuration: instance.estimatedDuration,
                    priority: instance.priority,
                    metadata: instance.metadata
                });
            }
        }

        return sessionSteps;
    }

    // ===== STATISTICS =====

    /**
     * Ruft QC-Statistiken ab
     */
    getStatistics() {
        const stats = {
            totalInstances: this.qcInstances.size,
            activeSteps: 0,
            overdueSteps: 0,
            completedSteps: 0,
            abortedSteps: 0,
            errorSteps: 0,
            stateDistribution: {}
        };

        // Zustandsverteilung initialisieren
        for (const state of Object.values(this.states)) {
            stats.stateDistribution[state] = 0;
        }

        // Statistiken sammeln
        for (const instance of this.qcInstances.values()) {
            stats.stateDistribution[instance.state]++;

            switch (instance.state) {
                case this.states.QC_ACTIVE:
                    stats.activeSteps++;
                    break;
                case this.states.QC_OVERDUE:
                    stats.overdueSteps++;
                    break;
                case this.states.QC_COMPLETED:
                    stats.completedSteps++;
                    break;
                case this.states.QC_ABORTED:
                    stats.abortedSteps++;
                    break;
                case this.states.QC_ERROR:
                    stats.errorSteps++;
                    break;
            }
        }

        return stats;
    }

    // ===== LOGGING =====

    /**
     * Protokolliert Zustandsänderung
     */
    logStateChange(instance, oldState, newState, event, data = {}) {
        const logEntry = {
            timestamp: new Date(),
            oldState: oldState,
            newState: newState,
            event: event,
            data: data
        };

        instance.history.push(logEntry);

        // Verlauf begrenzen (letzte 20 Einträge)
        if (instance.history.length > 20) {
            instance.history = instance.history.slice(-20);
        }
    }

    /**
     * Ruft Verlauf für QR-Code ab
     */
    getHistory(qrCode) {
        const instance = this.getQCInstance(qrCode);
        return instance ? instance.history : [];
    }

    // ===== CLEANUP =====

    /**
     * Bereinigt alle QC-Instanzen
     */
    cleanup() {
        console.log('🧹 QC State Machine wird bereinigt...');

        for (const [qrCode, instance] of this.qcInstances) {
            this.stopAllTimers(instance);
        }

        this.qcInstances.clear();
        this.removeAllListeners();

        console.log('✅ QC State Machine bereinigt');
    }

    /**
     * Bereinigt abgeschlossene/abgebrochene Instanzen
     */
    cleanupCompletedInstances() {
        const toRemove = [];

        for (const [qrCode, instance] of this.qcInstances) {
            if (instance.state === this.states.QC_COMPLETED ||
                instance.state === this.states.QC_ABORTED ||
                instance.state === this.states.IDLE) {

                // Nur entfernen wenn seit Abschluss genug Zeit vergangen ist
                const timeSinceEnd = instance.endTime ?
                    new Date() - instance.endTime :
                    new Date() - instance.startTime;

                if (timeSinceEnd > 5 * 60 * 1000) { // 5 Minuten
                    toRemove.push(qrCode);
                }
            }
        }

        for (const qrCode of toRemove) {
            this.removeQCInstance(qrCode);
        }

        if (toRemove.length > 0) {
            console.log(`🧹 ${toRemove.length} abgeschlossene QC-Instanzen bereinigt`);
        }
    }
}

module.exports = QCStateMachine;
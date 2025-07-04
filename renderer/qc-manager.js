/**
 * Quality Control Manager für Wareneinlagerung
 * Verwaltet QC-Workflows mit doppelten QR-Scans und automatischem Session-Reset
 *
 * Features:
 * - Doppelte QR-Scans (Eingang/Ausgang)
 * - Automatischer Session-Reset nach QC-Abschluss
 * - Parallele QC-Schritte für mehrere Mitarbeiter
 * - Überfällige QC-Schritte-Erkennung
 * - QC-Statistiken und Reporting
 */

class QualityControlManager {
    constructor(wareneinlagerungApp) {
        this.app = wareneinlagerungApp;

        // QC-Status-Tracking
        this.activeQCSteps = new Map(); // qrCode -> QC-Step-Daten
        this.qcStepsPerSession = new Map(); // sessionId -> Set von QR-Codes
        this.qcTimers = new Map(); // qrCode -> timer for overdue detection

        // QC-Konfiguration
        this.config = {
            enableQC: true,
            autoSessionResetAfterQC: true,
            defaultEstimatedMinutes: 15,
            overdueThresholdMinutes: 30,
            maxParallelQCPerSession: 5,
            showQCProgressInUI: true,
            enableQCTimers: true,
            enableQCAudio: true,
            enableOverdueWarnings: true
        };

        // QC-Statistiken
        this.statistics = {
            totalQCSteps: 0,
            completedQCSteps: 0,
            abortedQCSteps: 0,
            averageDurationMinutes: 0,
            overdueQCSteps: 0,
            completionRate: 0,
            defectRate: 0
        };

        // UI-Elemente Cache
        this.uiElements = {
            qcPanel: null,
            qcStepsList: null,
            qcStatistics: null,
            qcOverdueWarnings: null
        };

        // Event-Handler
        this.boundHandlers = {
            qcStepCompleted: this.handleQCStepCompleted.bind(this),
            sessionEnded: this.handleSessionEnded.bind(this),
            systemShutdown: this.handleSystemShutdown.bind(this)
        };

        this.init();
    }

    // ===== INITIALIZATION =====

    async init() {
        console.log('🔍 Initialisiere Quality Control Manager...');

        try {
            // QC-System-Status prüfen
            await this.checkQCSystemStatus();

            if (!this.config.enableQC) {
                console.log('⚠️ QC-System nicht verfügbar - Manager deaktiviert');
                return;
            }

            // UI-Elemente initialisieren
            this.initializeUI();

            // Event-Listener einrichten
            this.setupEventListeners();

            // Aktive QC-Schritte laden
            await this.loadActiveQCSteps();

            // QC-Statistiken laden
            await this.loadQCStatistics();

            // QC-Timer starten
            if (this.config.enableQCTimers) {
                this.startQCTimers();
            }

            console.log('✅ Quality Control Manager erfolgreich initialisiert');

        } catch (error) {
            console.error('❌ Fehler bei QC-Manager Initialisierung:', error);
            this.config.enableQC = false;
        }
    }

    async checkQCSystemStatus() {
        try {
            const systemStatus = await window.electronAPI.system.getStatus();

            if (systemStatus && systemStatus.qualityControl) {
                this.config.enableQC = systemStatus.qualityControl.enabled || false;
                console.log(`🔍 QC-System Status: ${this.config.enableQC ? 'Aktiviert' : 'Deaktiviert'}`);
            } else {
                this.config.enableQC = false;
                console.log('⚠️ QC-System-Status nicht verfügbar');
            }

        } catch (error) {
            console.error('Fehler beim QC-System-Status-Check:', error);
            this.config.enableQC = false;
        }
    }

    initializeUI() {
        if (!this.config.enableQC) return;

        // QC-Panel zur Benutzeroberfläche hinzufügen
        this.createQCPanel();

        // QC-Status-Anzeigen in bestehende UI integrieren
        this.enhanceExistingUI();

        console.log('🎨 QC-UI-Elemente initialisiert');
    }

    createQCPanel() {
        // QC-Panel erstellen und in die Hauptansicht integrieren
        const workspace = document.getElementById('workspace');
        if (!workspace) return;

        const qcPanelHTML = `
            <div class="qc-panel" id="qcPanel">
                <div class="qc-header">
                    <h3>🔍 Qualitätskontrolle</h3>
                    <div class="qc-status" id="qcStatus">
                        <span class="qc-status-dot active"></span>
                        <span class="qc-status-text">System bereit</span>
                    </div>
                </div>
                
                <div class="qc-content">
                    <!-- Aktive QC-Schritte -->
                    <div class="qc-section">
                        <div class="qc-section-header">
                            <h4>📋 Aktive QC-Schritte</h4>
                            <span class="qc-counter" id="activeQCCounter">0</span>
                        </div>
                        <div class="qc-steps-list" id="qcStepsList">
                            <div class="qc-no-steps">Keine aktiven QC-Schritte</div>
                        </div>
                    </div>
                    
                    <!-- QC-Statistiken -->
                    <div class="qc-section">
                        <div class="qc-section-header">
                            <h4>📊 QC-Statistiken</h4>
                            <button class="btn-small qc-refresh-btn" id="qcRefreshBtn">🔄</button>
                        </div>
                        <div class="qc-statistics" id="qcStatistics">
                            <div class="qc-stat">
                                <span class="qc-stat-label">Abgeschlossen heute:</span>
                                <span class="qc-stat-value" id="qcCompletedToday">0</span>
                            </div>
                            <div class="qc-stat">
                                <span class="qc-stat-label">Durchschnittsdauer:</span>
                                <span class="qc-stat-value" id="qcAvgDuration">0 Min</span>
                            </div>
                            <div class="qc-stat">
                                <span class="qc-stat-label">Abschlussrate:</span>
                                <span class="qc-stat-value" id="qcCompletionRate">0%</span>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Überfällige Warnungen -->
                    <div class="qc-section qc-overdue-section" id="qcOverdueSection" style="display: none;">
                        <div class="qc-section-header">
                            <h4>⚠️ Überfällige QC-Schritte</h4>
                            <span class="qc-counter warning" id="overdueQCCounter">0</span>
                        </div>
                        <div class="qc-overdue-list" id="qcOverdueList"></div>
                    </div>
                </div>
            </div>
        `;

        // QC-Panel nach der users-sidebar hinzufügen
        const usersSidebar = document.querySelector('.users-sidebar');
        if (usersSidebar) {
            usersSidebar.insertAdjacentHTML('afterend', qcPanelHTML);

            // UI-Elemente-Cache aktualisieren
            this.uiElements = {
                qcPanel: document.getElementById('qcPanel'),
                qcStepsList: document.getElementById('qcStepsList'),
                qcStatistics: document.getElementById('qcStatistics'),
                qcOverdueWarnings: document.getElementById('qcOverdueList'),
                qcStatus: document.getElementById('qcStatus'),
                activeQCCounter: document.getElementById('activeQCCounter'),
                overdueQCCounter: document.getElementById('overdueQCCounter'),
                qcOverdueSection: document.getElementById('qcOverdueSection')
            };

            // Grid-Layout anpassen für QC-Panel
            workspace.style.gridTemplateColumns = '320px 280px 1fr';
        }
    }

    enhanceExistingUI() {
        // QC-Status zu Benutzer-Karten hinzufügen
        this.addQCStatusToUserCards();

        // QC-Informationen zu Scan-Ergebnissen hinzufügen
        this.enhanceScanResults();

        // QC-bezogene Benachrichtigungen aktivieren
        this.setupQCNotifications();
    }

    addQCStatusToUserCards() {
        // CSS für QC-Status in Benutzer-Karten hinzufügen
        const style = document.createElement('style');
        style.textContent = `
            .user-card .qc-status-indicator {
                display: inline-block;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                margin-left: 5px;
                background: #94a3b8;
            }
            .user-card .qc-status-indicator.active {
                background: #f59e0b;
                animation: pulse 2s infinite;
            }
            .user-card .qc-status-indicator.overdue {
                background: #ef4444;
                animation: pulse 1s infinite;
            }
            .user-card .qc-info {
                font-size: 11px;
                color: var(--text-muted);
                margin-top: 2px;
            }
        `;
        document.head.appendChild(style);
    }

    enhanceScanResults() {
        // Erweitere die Scan-Ergebnis-Anzeige um QC-Informationen
        const originalUpdateCurrentScanDisplay = this.app.updateCurrentScanDisplay;

        this.app.updateCurrentScanDisplay = () => {
            originalUpdateCurrentScanDisplay.call(this.app);
            this.addQCInfoToCurrentScan();
        };
    }

    setupEventListeners() {
        if (!this.config.enableQC) return;

        // QC-Panel Event-Listener
        const refreshBtn = document.getElementById('qcRefreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.refreshQCData();
            });
        }

        // App-Event-Listener
        if (this.app) {
            this.app.on = this.app.on || (() => {}); // Fallback
            this.app.on('qc-step-completed', this.boundHandlers.qcStepCompleted);
            this.app.on('session-ended', this.boundHandlers.sessionEnded);
            this.app.on('system-shutdown', this.boundHandlers.systemShutdown);
        }

        // Backend-Event-Listener
        if (window.electronAPI && window.electronAPI.on) {
            window.electronAPI.on('qc-step-started', (data) => {
                this.handleQCStepStarted(data);
            });

            window.electronAPI.on('qc-step-completed', (data) => {
                this.handleQCStepCompleted(data);
            });

            window.electronAPI.on('qc-step-overdue', (data) => {
                this.handleQCStepOverdue(data);
            });
        }

        console.log('📡 QC-Event-Listener eingerichtet');
    }

    setupQCNotifications() {
        // QC-spezifische Benachrichtigungstypen definieren
        this.notificationTypes = {
            qcStarted: {
                icon: '🔍',
                title: 'QC gestartet',
                duration: 3000,
                type: 'info'
            },
            qcCompleted: {
                icon: '✅',
                title: 'QC abgeschlossen',
                duration: 4000,
                type: 'success'
            },
            qcOverdue: {
                icon: '⚠️',
                title: 'QC überfällig',
                duration: 6000,
                type: 'warning'
            },
            sessionResetAfterQC: {
                icon: '🔄',
                title: 'Session automatisch beendet',
                duration: 4000,
                type: 'info'
            }
        };
    }

    // ===== QC-WORKFLOW MANAGEMENT =====

    /**
     * Verarbeitet QR-Scan im QC-Kontext
     * @param {Object} scanResult - Ergebnis des QR-Scans
     * @param {string} qrCode - QR-Code Payload
     * @param {number} sessionId - Session ID
     * @returns {Object} - QC-spezifische Verarbeitungsergebnisse
     */
    async processQRScanForQC(scanResult, qrCode, sessionId) {
        if (!this.config.enableQC || !scanResult.success) {
            return { qcProcessed: false };
        }

        try {
            const qcInfo = scanResult.qualityControl;

            if (!qcInfo) {
                return { qcProcessed: false };
            }

            switch (qcInfo.action) {
                case 'qc_started':
                    return await this.handleQCStartedLocal(qrCode, sessionId, qcInfo);

                case 'qc_completed':
                    return await this.handleQCCompletedLocal(qrCode, sessionId, qcInfo);

                case 'qc_continued':
                    return await this.handleQCContinuedLocal(qrCode, sessionId, qcInfo);

                default:
                    return { qcProcessed: false };
            }

        } catch (error) {
            console.error('Fehler bei QC-Verarbeitung:', error);
            return {
                qcProcessed: false,
                error: error.message
            };
        }
    }

    async handleQCStartedLocal(qrCode, sessionId, qcInfo) {
        console.log(`🔍 QC gestartet: ${qrCode} für Session ${sessionId}`);

        // Lokales QC-Tracking aktualisieren
        this.activeQCSteps.set(qrCode, {
            qrCode: qrCode,
            sessionId: sessionId,
            qcStepId: qcInfo.qcStepId,
            startTime: new Date(),
            estimatedMinutes: qcInfo.estimatedMinutes || this.config.defaultEstimatedMinutes,
            status: 'active',
            overdueTime: new Date(Date.now() + (qcInfo.estimatedMinutes || this.config.defaultEstimatedMinutes) * 60000)
        });

        // Session-Mapping aktualisieren
        const sessionQRCodes = this.qcStepsPerSession.get(sessionId) || new Set();
        sessionQRCodes.add(qrCode);
        this.qcStepsPerSession.set(sessionId, sessionQRCodes);

        // Überfällig-Timer starten
        if (this.config.enableQCTimers) {
            this.startOverdueTimer(qrCode);
        }

        // UI aktualisieren
        this.updateQCUI();

        // Benachrichtigung anzeigen
        this.showQCNotification('qcStarted',
            `QC gestartet für ${this.getShortQRCode(qrCode)} - ${qcInfo.estimatedMinutes || this.config.defaultEstimatedMinutes} Min geschätzt`);

        // Audio-Feedback
        if (this.config.enableQCAudio) {
            this.playQCAudio('qc_started');
        }

        return {
            qcProcessed: true,
            action: 'qc_started',
            message: 'Qualitätsprüfung begonnen - scannen Sie den gleichen QR-Code erneut zum Abschließen'
        };
    }

    async handleQCCompletedLocal(qrCode, sessionId, qcInfo) {
        console.log(`✅ QC abgeschlossen: ${qrCode} für Session ${sessionId} (${qcInfo.durationMinutes} Min)`);

        // Lokales QC-Tracking bereinigen
        const qcStep = this.activeQCSteps.get(qrCode);
        this.activeQCSteps.delete(qrCode);

        // Session-Mapping aktualisieren
        const sessionQRCodes = this.qcStepsPerSession.get(sessionId);
        if (sessionQRCodes) {
            sessionQRCodes.delete(qrCode);
            if (sessionQRCodes.size === 0) {
                this.qcStepsPerSession.delete(sessionId);
            }
        }

        // Überfällig-Timer stoppen
        this.stopOverdueTimer(qrCode);

        // Statistiken aktualisieren
        this.statistics.completedQCSteps++;
        this.updateQCStatistics();

        // UI aktualisieren
        this.updateQCUI();

        // Benachrichtigung anzeigen
        let message = `QC abgeschlossen für ${this.getShortQRCode(qrCode)} (${qcInfo.durationMinutes} Min)`;

        if (qcInfo.autoSessionReset) {
            message += ' - Session automatisch beendet';
            this.showQCNotification('sessionResetAfterQC', message);

            // Session aus lokaler Verwaltung entfernen (wird vom Hauptsystem behandelt)
            this.handleSessionResetAfterQC(sessionId);
        } else {
            this.showQCNotification('qcCompleted', message);
        }

        // Audio-Feedback
        if (this.config.enableQCAudio) {
            this.playQCAudio('qc_completed');
        }

        return {
            qcProcessed: true,
            action: 'qc_completed',
            autoSessionReset: qcInfo.autoSessionReset,
            message: `Qualitätsprüfung abgeschlossen (${qcInfo.durationMinutes} Min)`
        };
    }

    async handleQCContinuedLocal(qrCode, sessionId, qcInfo) {
        console.log(`🔄 QC läuft weiter: ${qrCode} (${qcInfo.minutesInProgress} Min)`);

        // QC-Schritt-Daten aktualisieren falls vorhanden
        const qcStep = this.activeQCSteps.get(qrCode);
        if (qcStep) {
            qcStep.minutesInProgress = qcInfo.minutesInProgress;

            // Prüfe auf Überfälligkeit
            if (qcInfo.minutesInProgress > this.config.overdueThresholdMinutes) {
                qcStep.status = 'overdue';
                this.handleQCStepOverdue({ qrCode, sessionId, minutesInProgress: qcInfo.minutesInProgress });
            }
        }

        return {
            qcProcessed: true,
            action: 'qc_continued',
            message: `QC läuft bereits (${qcInfo.minutesInProgress} Min)`
        };
    }

    handleSessionResetAfterQC(sessionId) {
        // Alle QC-Schritte für diese Session bereinigen
        const sessionQRCodes = this.qcStepsPerSession.get(sessionId);
        if (sessionQRCodes) {
            sessionQRCodes.forEach(qrCode => {
                this.activeQCSteps.delete(qrCode);
                this.stopOverdueTimer(qrCode);
            });
            this.qcStepsPerSession.delete(sessionId);
        }

        console.log(`🔄 QC-Daten für Session ${sessionId} nach Auto-Reset bereinigt`);
        this.updateQCUI();
    }

    // ===== OVERDUE MANAGEMENT =====

    startOverdueTimer(qrCode) {
        const qcStep = this.activeQCSteps.get(qrCode);
        if (!qcStep || !this.config.enableOverdueWarnings) return;

        const overdueDelay = qcStep.estimatedMinutes * 60 * 1000; // Minuten in Millisekunden

        const timer = setTimeout(() => {
            this.handleQCStepOverdue({
                qrCode: qrCode,
                sessionId: qcStep.sessionId,
                minutesInProgress: Math.round((Date.now() - qcStep.startTime.getTime()) / (1000 * 60))
            });
        }, overdueDelay);

        this.qcTimers.set(qrCode, timer);
    }

    stopOverdueTimer(qrCode) {
        const timer = this.qcTimers.get(qrCode);
        if (timer) {
            clearTimeout(timer);
            this.qcTimers.delete(qrCode);
        }
    }

    handleQCStepOverdue(data) {
        const { qrCode, sessionId, minutesInProgress } = data;

        console.warn(`⚠️ QC-Schritt überfällig: ${qrCode} (${minutesInProgress} Min)`);

        // QC-Schritt-Status aktualisieren
        const qcStep = this.activeQCSteps.get(qrCode);
        if (qcStep) {
            qcStep.status = 'overdue';
            qcStep.minutesInProgress = minutesInProgress;
        }

        // Statistiken aktualisieren
        this.statistics.overdueQCSteps++;

        // UI aktualisieren
        this.updateQCUI();
        this.updateOverdueWarnings();

        // Benachrichtigung anzeigen
        this.showQCNotification('qcOverdue',
            `QC überfällig: ${this.getShortQRCode(qrCode)} (${minutesInProgress} Min)`);

        // Audio-Warnung
        if (this.config.enableQCAudio) {
            this.playQCAudio('qc_overdue');
        }
    }

    // ===== EVENT HANDLERS =====

    handleQCStepStarted(data) {
        console.log('🔍 QC-Schritt gestartet (Backend-Event):', data);
        // Wird bereits durch processQRScanForQC behandelt
    }

    handleQCStepCompleted(data) {
        console.log('✅ QC-Schritt abgeschlossen (Backend-Event):', data);

        // Lokale Bereinigung falls noch nicht erfolgt
        if (data.qrCode && this.activeQCSteps.has(data.qrCode)) {
            this.activeQCSteps.delete(data.qrCode);
            this.stopOverdueTimer(data.qrCode);
            this.updateQCUI();
        }
    }

    handleSessionEnded(data) {
        console.log('🔚 Session beendet - QC bereinigen:', data);

        if (data.sessionId) {
            this.handleSessionResetAfterQC(data.sessionId);
        }
    }

    handleSystemShutdown(data) {
        console.log('🛑 System-Shutdown - QC bereinigen');

        // Alle QC-Timer stoppen
        this.qcTimers.forEach((timer, qrCode) => {
            clearTimeout(timer);
        });
        this.qcTimers.clear();

        // QC-Daten zurücksetzen
        this.activeQCSteps.clear();
        this.qcStepsPerSession.clear();
    }

    // ===== DATA MANAGEMENT =====

    async loadActiveQCSteps() {
        if (!this.config.enableQC) return;

        try {
            const activeSteps = await window.electronAPI.qc.getActiveSteps();

            this.activeQCSteps.clear();
            this.qcStepsPerSession.clear();

            activeSteps.forEach(step => {
                this.activeQCSteps.set(step.QrCode, {
                    qrCode: step.QrCode,
                    sessionId: step.SessionID,
                    qcStepId: step.ID,
                    startTime: new Date(step.StartTime),
                    estimatedMinutes: step.EstimatedDurationMinutes || this.config.defaultEstimatedMinutes,
                    minutesInProgress: step.MinutesInProgress || 0,
                    status: step.IsOverdue ? 'overdue' : 'active',
                    overdueTime: new Date(step.StartTime).getTime() + (step.EstimatedDurationMinutes || this.config.defaultEstimatedMinutes) * 60000
                });

                // Session-Mapping aktualisieren
                const sessionQRCodes = this.qcStepsPerSession.get(step.SessionID) || new Set();
                sessionQRCodes.add(step.QrCode);
                this.qcStepsPerSession.set(step.SessionID, sessionQRCodes);

                // Überfällig-Timer für noch nicht überfällige Schritte starten
                if (!step.IsOverdue && this.config.enableQCTimers) {
                    this.startOverdueTimer(step.QrCode);
                }
            });

            console.log(`📊 ${activeSteps.length} aktive QC-Schritte geladen`);
            this.updateQCUI();

        } catch (error) {
            console.error('Fehler beim Laden aktiver QC-Schritte:', error);
        }
    }

    async loadQCStatistics() {
        if (!this.config.enableQC) return;

        try {
            const stats = await window.electronAPI.qc.getStatistics();

            if (stats) {
                this.statistics = {
                    totalQCSteps: stats.totalQCSteps || 0,
                    completedQCSteps: stats.completedQCSteps || 0,
                    abortedQCSteps: stats.abortedQCSteps || 0,
                    averageDurationMinutes: stats.averageDurationMinutes || 0,
                    overdueQCSteps: stats.overdueQCSteps || 0,
                    completionRate: stats.completionRate || 0,
                    defectRate: stats.defectRate || 0,
                    todayCompletedSteps: stats.todayCompletedSteps || 0
                };

                console.log('📈 QC-Statistiken geladen:', this.statistics);
                this.updateQCStatisticsUI();
            }

        } catch (error) {
            console.error('Fehler beim Laden der QC-Statistiken:', error);
        }
    }

    async refreshQCData() {
        console.log('🔄 Aktualisiere QC-Daten...');

        try {
            await Promise.all([
                this.loadActiveQCSteps(),
                this.loadQCStatistics()
            ]);

            this.app.showNotification('info', 'QC-Daten aktualisiert', 'Aktuelle QC-Informationen wurden geladen');

        } catch (error) {
            console.error('Fehler beim QC-Daten-Refresh:', error);
            this.app.showNotification('error', 'QC-Refresh fehlgeschlagen', error.message);
        }
    }

    // ===== UI UPDATES =====

    updateQCUI() {
        if (!this.config.enableQC || !this.uiElements.qcPanel) return;

        this.updateActiveQCStepsList();
        this.updateQCCounters();
        this.updateOverdueWarnings();
        this.updateUserCardQCStatus();
    }

    updateActiveQCStepsList() {
        const stepsList = this.uiElements.qcStepsList;
        if (!stepsList) return;

        const activeSteps = Array.from(this.activeQCSteps.values());

        if (activeSteps.length === 0) {
            stepsList.innerHTML = '<div class="qc-no-steps">Keine aktiven QC-Schritte</div>';
            return;
        }

        const stepsHTML = activeSteps
            .sort((a, b) => {
                // Sortiere nach Status (overdue zuerst) und dann nach Zeit
                if (a.status === 'overdue' && b.status !== 'overdue') return -1;
                if (b.status === 'overdue' && a.status !== 'overdue') return 1;
                return b.startTime - a.startTime;
            })
            .map(step => this.createQCStepHTML(step))
            .join('');

        stepsList.innerHTML = stepsHTML;
    }

    createQCStepHTML(step) {
        const durationMinutes = Math.round((Date.now() - step.startTime.getTime()) / (1000 * 60));
        const isOverdue = step.status === 'overdue' || durationMinutes > step.estimatedMinutes;
        const progressPercent = Math.min((durationMinutes / step.estimatedMinutes) * 100, 100);

        return `
            <div class="qc-step ${isOverdue ? 'overdue' : ''}" data-qr-code="${step.qrCode}">
                <div class="qc-step-header">
                    <div class="qc-step-qr">${this.getShortQRCode(step.qrCode)}</div>
                    <div class="qc-step-duration ${isOverdue ? 'overdue' : ''}">
                        ${durationMinutes}/${step.estimatedMinutes} Min
                    </div>
                </div>
                <div class="qc-step-progress">
                    <div class="qc-progress-bar">
                        <div class="qc-progress-fill ${isOverdue ? 'overdue' : ''}" 
                             style="width: ${progressPercent}%"></div>
                    </div>
                </div>
                <div class="qc-step-info">
                    <span class="qc-step-session">Session ${step.sessionId}</span>
                    <span class="qc-step-status ${step.status}">${this.getQCStatusText(step.status)}</span>
                </div>
                ${isOverdue ? '<div class="qc-step-warning">⚠️ Überfällig</div>' : ''}
            </div>
        `;
    }

    updateQCCounters() {
        if (this.uiElements.activeQCCounter) {
            this.uiElements.activeQCCounter.textContent = this.activeQCSteps.size;
        }

        const overdueCount = Array.from(this.activeQCSteps.values())
            .filter(step => step.status === 'overdue').length;

        if (this.uiElements.overdueQCCounter) {
            this.uiElements.overdueQCCounter.textContent = overdueCount;
        }
    }

    updateOverdueWarnings() {
        const overdueSteps = Array.from(this.activeQCSteps.values())
            .filter(step => step.status === 'overdue');

        if (overdueSteps.length > 0) {
            this.uiElements.qcOverdueSection.style.display = 'block';

            const overdueHTML = overdueSteps.map(step => {
                const durationMinutes = Math.round((Date.now() - step.startTime.getTime()) / (1000 * 60));
                return `
                    <div class="qc-overdue-item">
                        <div class="qc-overdue-qr">${this.getShortQRCode(step.qrCode)}</div>
                        <div class="qc-overdue-duration">${durationMinutes} Min</div>
                        <div class="qc-overdue-session">Session ${step.sessionId}</div>
                    </div>
                `;
            }).join('');

            if (this.uiElements.qcOverdueWarnings) {
                this.uiElements.qcOverdueWarnings.innerHTML = overdueHTML;
            }
        } else {
            this.uiElements.qcOverdueSection.style.display = 'none';
        }
    }

    updateQCStatisticsUI() {
        if (!this.uiElements.qcStatistics) return;

        const completedTodayEl = document.getElementById('qcCompletedToday');
        if (completedTodayEl) {
            completedTodayEl.textContent = this.statistics.todayCompletedSteps;
        }

        const avgDurationEl = document.getElementById('qcAvgDuration');
        if (avgDurationEl) {
            avgDurationEl.textContent = `${this.statistics.averageDurationMinutes} Min`;
        }

        const completionRateEl = document.getElementById('qcCompletionRate');
        if (completionRateEl) {
            completionRateEl.textContent = `${this.statistics.completionRate}%`;
        }
    }

    updateUserCardQCStatus() {
        // QC-Status zu Benutzer-Karten hinzufügen
        document.querySelectorAll('.user-card').forEach(card => {
            const sessionId = parseInt(card.dataset.sessionId);
            if (!sessionId) return;

            const sessionQRCodes = this.qcStepsPerSession.get(sessionId);
            const activeQCCount = sessionQRCodes ? sessionQRCodes.size : 0;

            // Bestehende QC-Indikatoren entfernen
            const existingIndicator = card.querySelector('.qc-status-indicator');
            const existingInfo = card.querySelector('.qc-info');
            if (existingIndicator) existingIndicator.remove();
            if (existingInfo) existingInfo.remove();

            if (activeQCCount > 0) {
                // QC-Status-Indikator hinzufügen
                const userInfo = card.querySelector('.user-info');
                if (userInfo) {
                    const hasOverdue = Array.from(sessionQRCodes).some(qrCode => {
                        const step = this.activeQCSteps.get(qrCode);
                        return step && step.status === 'overdue';
                    });

                    const indicator = document.createElement('span');
                    indicator.className = `qc-status-indicator ${hasOverdue ? 'overdue' : 'active'}`;
                    indicator.title = hasOverdue ? 'Überfällige QC-Schritte' : 'Aktive QC-Schritte';

                    const userName = userInfo.querySelector('.user-name');
                    if (userName) {
                        userName.appendChild(indicator);
                    }

                    // QC-Info hinzufügen
                    const qcInfo = document.createElement('div');
                    qcInfo.className = 'qc-info';
                    qcInfo.textContent = `${activeQCCount} aktive QC${hasOverdue ? ' (überfällig)' : ''}`;
                    userInfo.appendChild(qcInfo);
                }
            }
        });
    }

    addQCInfoToCurrentScan() {
        if (!this.config.enableQC || !this.app.currentScan) return;

        const currentScanDisplay = document.getElementById('currentScanDisplay');
        if (!currentScanDisplay) return;

        const qrCode = this.app.currentScan.content;
        const qcStep = this.activeQCSteps.get(qrCode);

        if (qcStep) {
            const durationMinutes = Math.round((Date.now() - qcStep.startTime.getTime()) / (1000 * 60));
            const isOverdue = qcStep.status === 'overdue';

            const qcInfoHTML = `
                <div class="current-scan-qc-info ${isOverdue ? 'overdue' : ''}">
                    <span class="qc-label">🔍 QC:</span>
                    <span class="qc-duration">${durationMinutes}/${qcStep.estimatedMinutes} Min</span>
                    <span class="qc-status">${this.getQCStatusText(qcStep.status)}</span>
                    ${isOverdue ? '<span class="qc-overdue-badge">Überfällig</span>' : ''}
                </div>
            `;

            currentScanDisplay.insertAdjacentHTML('beforeend', qcInfoHTML);
        }
    }

    // ===== UTILITY METHODS =====

    getShortQRCode(qrCode) {
        if (!qrCode) return '';

        // Zeige nur die letzten 8 Zeichen oder eine intelligent gekürzte Version
        if (qrCode.length <= 12) return qrCode;

        // Versuche strukturierte Daten zu erkennen
        if (qrCode.includes('^')) {
            const parts = qrCode.split('^');
            return parts.length > 3 ? `${parts[1]}...${parts[3]}` : qrCode.substring(0, 12) + '...';
        }

        return qrCode.substring(0, 8) + '...' + qrCode.substring(qrCode.length - 4);
    }

    getQCStatusText(status) {
        const statusTexts = {
            active: 'Aktiv',
            overdue: 'Überfällig',
            completed: 'Abgeschlossen',
            aborted: 'Abgebrochen'
        };

        return statusTexts[status] || status;
    }

    showQCNotification(type, message) {
        if (!this.app || !this.app.showNotification) return;

        const notification = this.notificationTypes[type];
        if (notification) {
            this.app.showNotification(
                notification.type,
                notification.title,
                message,
                notification.duration
            );
        }
    }

    playQCAudio(type) {
        if (!this.config.enableQCAudio) return;

        try {
            const context = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = context.createOscillator();
            const gainNode = context.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(context.destination);

            switch (type) {
                case 'qc_started':
                    // Freundlicher Aufwärts-Sweep
                    oscillator.frequency.setValueAtTime(600, context.currentTime);
                    oscillator.frequency.exponentialRampToValueAtTime(800, context.currentTime + 0.2);
                    gainNode.gain.setValueAtTime(0.2, context.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
                    oscillator.start(context.currentTime);
                    oscillator.stop(context.currentTime + 0.3);
                    break;

                case 'qc_completed':
                    // Erfolgreicher Doppel-Ton
                    oscillator.frequency.setValueAtTime(800, context.currentTime);
                    oscillator.frequency.setValueAtTime(1000, context.currentTime + 0.1);
                    oscillator.frequency.setValueAtTime(800, context.currentTime + 0.2);
                    gainNode.gain.setValueAtTime(0.3, context.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.4);
                    oscillator.start(context.currentTime);
                    oscillator.stop(context.currentTime + 0.4);
                    break;

                case 'qc_overdue':
                    // Dringender Warn-Ton
                    oscillator.frequency.setValueAtTime(400, context.currentTime);
                    oscillator.frequency.setValueAtTime(600, context.currentTime + 0.15);
                    oscillator.frequency.setValueAtTime(400, context.currentTime + 0.3);
                    gainNode.gain.setValueAtTime(0.4, context.currentTime);
                    gainNode.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.5);
                    oscillator.start(context.currentTime);
                    oscillator.stop(context.currentTime + 0.5);
                    break;
            }
        } catch (error) {
            // Audio-Fehler ignorieren
            console.log('QC-Audio nicht verfügbar');
        }
    }

    updateQCStatistics() {
        // Interne Statistiken-Updates für lokale Änderungen
        if (this.statistics.totalQCSteps > 0) {
            this.statistics.completionRate = Math.round(
                (this.statistics.completedQCSteps / this.statistics.totalQCSteps) * 100
            );
        }
    }

    startQCTimers() {
        // Periodische Updates für QC-Anzeigen
        setInterval(() => {
            if (this.activeQCSteps.size > 0) {
                this.updateQCUI();
            }
        }, 30000); // Alle 30 Sekunden

        console.log('⏱️ QC-Timer gestartet');
    }

    // ===== PUBLIC API =====

    /**
     * Prüft ob QC für einen QR-Code aktiv ist
     * @param {string} qrCode - QR-Code
     * @returns {boolean} - True wenn QC aktiv
     */
    isQCActive(qrCode) {
        return this.activeQCSteps.has(qrCode);
    }

    /**
     * Ruft QC-Status für einen QR-Code ab
     * @param {string} qrCode - QR-Code
     * @returns {Object|null} - QC-Status oder null
     */
    getQCStatus(qrCode) {
        return this.activeQCSteps.get(qrCode) || null;
    }

    /**
     * Ruft aktive QC-Schritte für eine Session ab
     * @param {number} sessionId - Session ID
     * @returns {Array} - Array aktiver QC-Schritte
     */
    getActiveQCStepsForSession(sessionId) {
        const sessionQRCodes = this.qcStepsPerSession.get(sessionId);
        if (!sessionQRCodes) return [];

        return Array.from(sessionQRCodes).map(qrCode => this.activeQCSteps.get(qrCode)).filter(Boolean);
    }

    /**
     * Ruft QC-Statistiken ab
     * @returns {Object} - QC-Statistiken
     */
    getQCStatistics() {
        return { ...this.statistics };
    }

    /**
     * Aktiviert/Deaktiviert QC-Features
     * @param {boolean} enable - QC aktivieren/deaktivieren
     */
    setQCEnabled(enable) {
        this.config.enableQC = enable;

        if (!enable) {
            // QC deaktivieren - alle Timer stoppen und UI ausblenden
            this.qcTimers.forEach((timer, qrCode) => {
                clearTimeout(timer);
            });
            this.qcTimers.clear();

            if (this.uiElements.qcPanel) {
                this.uiElements.qcPanel.style.display = 'none';
            }
        } else {
            // QC aktivieren - UI anzeigen und Daten laden
            if (this.uiElements.qcPanel) {
                this.uiElements.qcPanel.style.display = 'block';
            }
            this.refreshQCData();
        }

        console.log(`🔍 QC ${enable ? 'aktiviert' : 'deaktiviert'}`);
    }

    /**
     * Cleanup-Methode für Shutdown
     */
    cleanup() {
        console.log('🧹 QC-Manager wird bereinigt...');

        // Alle Timer stoppen
        this.qcTimers.forEach((timer, qrCode) => {
            clearTimeout(timer);
        });
        this.qcTimers.clear();

        // Event-Listener entfernen
        if (this.app) {
            this.app.off('qc-step-completed', this.boundHandlers.qcStepCompleted);
            this.app.off('session-ended', this.boundHandlers.sessionEnded);
            this.app.off('system-shutdown', this.boundHandlers.systemShutdown);
        }

        // Daten zurücksetzen
        this.activeQCSteps.clear();
        this.qcStepsPerSession.clear();

        console.log('✅ QC-Manager bereinigt');
    }
}

// ===== EXPORT =====
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QualityControlManager;
} else {
    window.QualityControlManager = QualityControlManager;
}
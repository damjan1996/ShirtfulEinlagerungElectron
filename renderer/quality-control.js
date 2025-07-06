/**
 * Quality Control Frontend Manager
 * Handles all QC-related UI interactions and updates
 * Integrates with the main app for seamless QC workflow
 *
 * Features:
 * - QC-Panel management and updates
 * - Active QC steps display
 * - QC statistics visualization
 * - Overdue notifications
 * - QC step progress tracking
 * - Integration with parallel sessions
 * - Real-time updates
 */

class QualityControlManager {
    constructor(mainApp) {
        this.mainApp = mainApp;

        // ===== QC-STATE =====
        this.activeQCSteps = new Map(); // qrCode -> qcStepData
        this.qcStatistics = null;
        this.overdueSteps = [];
        this.lastUpdate = new Date();

        // ===== QC-CONFIGURATION =====
        this.config = {
            refreshInterval: 30000, // 30 Sekunden
            overdueCheckInterval: 60000, // 1 Minute
            statisticsRefreshInterval: 120000, // 2 Minuten
            enableRealTimeUpdates: true,
            enableOverdueNotifications: true,
            enableQCStepPreview: true,
            enableQCProgressAnimation: true,
            maxDisplayedQCSteps: 10,
            overdueThresholdMinutes: 30,
            criticalThresholdMinutes: 60
        };

        // ===== UI-ELEMENTS =====
        this.uiElements = {
            // QC-Panel
            qcPanel: null,
            qcStatus: null,
            qcStepsList: null,
            qcStatistics: null,
            qcOverdueSection: null,

            // Counters
            activeQCCounter: null,
            overdueQCCounter: null,
            qcCompletedToday: null,
            qcAvgDuration: null,
            qcCompletionRate: null,

            // Controls
            qcRefreshBtn: null,
            qcModeToggle: null,
            qcFilterBtn: null,

            // Current Scan QC Info
            currentScanQCInfo: null,
            qcStepLabel: null,
            qcStepValue: null,
            qcDurationValue: null,
            qcNextStep: null
        };

        // ===== TIMERS =====
        this.refreshTimer = null;
        this.overdueCheckTimer = null;
        this.statisticsTimer = null;
        this.animationTimer = null;

        this.initialize();
    }

    // ===== INITIALIZATION =====

    async initialize() {
        try {
            console.log('🔍 Initialisiere QualityControlManager...');

            // UI-Elemente cachen
            this.cacheUIElements();

            // Event-Listener einrichten
            this.setupEventListeners();

            // Initiale Daten laden
            await this.loadInitialData();

            // Timer starten
            this.startTimers();

            // UI aktualisieren
            this.updateUI();

            console.log('✅ QualityControlManager erfolgreich initialisiert');

        } catch (error) {
            console.error('❌ Fehler bei QC-Manager-Initialisierung:', error);
        }
    }

    cacheUIElements() {
        // QC-Panel Elemente
        this.uiElements.qcPanel = document.getElementById('qcPanel');
        this.uiElements.qcStatus = document.getElementById('qcStatus');
        this.uiElements.qcStepsList = document.getElementById('qcStepsList');
        this.uiElements.qcStatistics = document.getElementById('qcStatistics');
        this.uiElements.qcOverdueSection = document.getElementById('qcOverdueSection');

        // Counter Elemente
        this.uiElements.activeQCCounter = document.getElementById('activeQCCounter');
        this.uiElements.overdueQCCounter = document.getElementById('overdueQCCounter');
        this.uiElements.qcCompletedToday = document.getElementById('qcCompletedToday');
        this.uiElements.qcAvgDuration = document.getElementById('qcAvgDuration');
        this.uiElements.qcCompletionRate = document.getElementById('qcCompletionRate');

        // Control Elemente
        this.uiElements.qcRefreshBtn = document.getElementById('qcRefreshBtn');
        this.uiElements.qcModeToggle = document.getElementById('qcModeToggle');
        this.uiElements.qcFilterBtn = document.getElementById('qcFilterBtn');

        // Current Scan QC Info
        this.uiElements.currentScanQCInfo = document.getElementById('currentScanQCInfo');
        this.uiElements.qcStepLabel = document.getElementById('qcStepLabel');
        this.uiElements.qcStepValue = document.getElementById('qcStepValue');
        this.uiElements.qcDurationValue = document.getElementById('qcDurationValue');
        this.uiElements.qcNextStep = document.getElementById('qcNextStep');

        console.log('📋 QC-UI-Elemente gecacht');
    }

    setupEventListeners() {
        // QC-Refresh Button
        if (this.uiElements.qcRefreshBtn) {
            this.uiElements.qcRefreshBtn.addEventListener('click', () => {
                this.refreshQCData();
            });
        }

        // QC-Mode Toggle (falls implementiert)
        if (this.uiElements.qcModeToggle) {
            this.uiElements.qcModeToggle.addEventListener('click', () => {
                this.toggleQCMode();
            });
        }

        // QC-Filter Button
        if (this.uiElements.qcFilterBtn) {
            this.uiElements.qcFilterBtn.addEventListener('click', () => {
                this.toggleQCFilter();
            });
        }

        // QC-spezifische Events von Main App
        if (this.mainApp) {
            this.mainApp.on('qc-step-started', this.handleQCStepStarted.bind(this));
            this.mainApp.on('qc-step-completed', this.handleQCStepCompleted.bind(this));
            this.mainApp.on('qc-step-overdue', this.handleQCStepOverdue.bind(this));
            this.mainApp.on('session-auto-reset', this.handleSessionAutoReset.bind(this));
        }

        console.log('📡 QC-Event-Listener eingerichtet');
    }

    async loadInitialData() {
        try {
            // Aktive QC-Schritte laden
            await this.loadActiveQCSteps();

            // QC-Statistiken laden
            await this.loadQCStatistics();

            // Überfällige Schritte prüfen
            this.checkOverdueSteps();

            console.log('📊 QC-Initial-Daten geladen');

        } catch (error) {
            console.error('❌ Fehler beim Laden der QC-Initial-Daten:', error);
        }
    }

    startTimers() {
        // Hauptrefresh-Timer
        this.refreshTimer = setInterval(() => {
            this.refreshQCData();
        }, this.config.refreshInterval);

        // Überfällig-Check-Timer
        this.overdueCheckTimer = setInterval(() => {
            this.checkOverdueSteps();
        }, this.config.overdueCheckInterval);

        // Statistik-Timer
        this.statisticsTimer = setInterval(() => {
            this.loadQCStatistics();
        }, this.config.statisticsRefreshInterval);

        // Animation-Timer für Progress
        if (this.config.enableQCProgressAnimation) {
            this.animationTimer = setInterval(() => {
                this.updateQCProgressAnimations();
            }, 1000);
        }

        console.log('⏰ QC-Timer gestartet');
    }

    // ===== DATA LOADING =====

    async loadActiveQCSteps() {
        try {
            if (this.mainApp && this.mainApp.selectedSession) {
                // QC-Schritte für ausgewählte Session laden
                const sessionQCSteps = await window.electronAPI.qr.getActiveQCStepsForSession?.(
                    this.mainApp.selectedSession.sessionId
                );

                if (sessionQCSteps) {
                    this.updateActiveQCSteps(sessionQCSteps);
                }
            }

            // Alle aktiven QC-Schritte laden (für Übersicht)
            const allQCSteps = await window.electronAPI.qr.getAllActiveQCSteps?.();
            if (allQCSteps) {
                this.updateAllActiveQCSteps(allQCSteps);
            }

        } catch (error) {
            console.error('❌ Fehler beim Laden aktiver QC-Schritte:', error);
        }
    }

    async loadQCStatistics() {
        try {
            const statistics = await window.electronAPI.qr.getQCStatistics?.();
            if (statistics) {
                this.qcStatistics = statistics;
                this.updateQCStatisticsDisplay();
            }

        } catch (error) {
            console.error('❌ Fehler beim Laden der QC-Statistiken:', error);
        }
    }

    // ===== UI UPDATES =====

    updateUI() {
        this.updateActiveQCStepsDisplay();
        this.updateQCStatisticsDisplay();
        this.updateOverdueDisplay();
        this.updateQCStatus();
    }

    updateActiveQCStepsDisplay() {
        if (!this.uiElements.qcStepsList) return;

        const activeSteps = Array.from(this.activeQCSteps.values());

        // Counter aktualisieren
        if (this.uiElements.activeQCCounter) {
            this.uiElements.activeQCCounter.textContent = activeSteps.length;
        }

        // Liste leeren
        this.uiElements.qcStepsList.innerHTML = '';

        if (activeSteps.length === 0) {
            this.uiElements.qcStepsList.innerHTML = `
                <div class="qc-no-steps">
                    <div class="qc-no-steps-icon">🔍</div>
                    <div class="qc-no-steps-text">Keine aktiven QC-Schritte</div>
                </div>
            `;
            return;
        }

        // QC-Schritte sortieren (Überfällig → Priorität → Zeit)
        activeSteps.sort((a, b) => {
            if (a.isOverdue !== b.isOverdue) return b.isOverdue - a.isOverdue;
            if (a.priority !== b.priority) return b.priority - a.priority;
            return new Date(a.startTime) - new Date(b.startTime);
        });

        // Nur die ersten N Schritte anzeigen
        const displaySteps = activeSteps.slice(0, this.config.maxDisplayedQCSteps);

        displaySteps.forEach(step => {
            const stepElement = this.createQCStepElement(step);
            this.uiElements.qcStepsList.appendChild(stepElement);
        });

        // "Mehr anzeigen" Link wenn mehr Schritte vorhanden
        if (activeSteps.length > this.config.maxDisplayedQCSteps) {
            const moreElement = document.createElement('div');
            moreElement.className = 'qc-more-steps';
            moreElement.innerHTML = `
                <span class="qc-more-text">+${activeSteps.length - this.config.maxDisplayedQCSteps} weitere QC-Schritte</span>
            `;
            this.uiElements.qcStepsList.appendChild(moreElement);
        }
    }

    createQCStepElement(step) {
        const element = document.createElement('div');
        element.className = `qc-step-item ${step.isOverdue ? 'overdue' : ''} ${step.isCritical ? 'critical' : ''}`;
        element.dataset.qrCode = step.qrCode;

        const shortQRCode = this.getShortQRCode(step.qrCode);
        const durationText = this.formatDuration(step.durationMinutes);
        const remainingText = step.estimatedMinutes ?
            `${Math.max(0, step.estimatedMinutes - step.durationMinutes)} Min verbleibend` : '';

        const priorityIcon = this.getPriorityIcon(step.priority);
        const statusIcon = step.isOverdue ? '⚠️' : step.isCritical ? '🚨' : '🔍';

        element.innerHTML = `
            <div class="qc-step-header">
                <div class="qc-step-info">
                    <span class="qc-step-status">${statusIcon}</span>
                    <span class="qc-step-qr">${shortQRCode}</span>
                    <span class="qc-step-priority">${priorityIcon}</span>
                </div>
                <div class="qc-step-time">${durationText}</div>
            </div>
            <div class="qc-step-details">
                <div class="qc-step-user">${step.userName || 'Unbekannt'}</div>
                <div class="qc-step-session">Session ${step.sessionId}</div>
                ${remainingText ? `<div class="qc-step-remaining">${remainingText}</div>` : ''}
            </div>
            <div class="qc-step-progress">
                <div class="qc-progress-bar">
                    <div class="qc-progress-fill" style="width: ${this.calculateProgress(step)}%"></div>
                </div>
            </div>
        `;

        // Click-Handler für QC-Schritt-Details
        element.addEventListener('click', () => {
            this.showQCStepDetails(step);
        });

        return element;
    }

    updateQCStatisticsDisplay() {
        if (!this.qcStatistics) return;

        // Counter aktualisieren
        if (this.uiElements.qcCompletedToday) {
            this.uiElements.qcCompletedToday.textContent = this.qcStatistics.todayCompletedSteps || 0;
        }

        if (this.uiElements.qcAvgDuration) {
            this.uiElements.qcAvgDuration.textContent = `${this.qcStatistics.averageDurationMinutes || 0} Min`;
        }

        if (this.uiElements.qcCompletionRate) {
            this.uiElements.qcCompletionRate.textContent = `${this.qcStatistics.completionRate || 0}%`;
        }
    }

    updateOverdueDisplay() {
        if (!this.uiElements.qcOverdueSection) return;

        const overdueCount = this.overdueSteps.length;

        // Counter aktualisieren
        if (this.uiElements.overdueQCCounter) {
            this.uiElements.overdueQCCounter.textContent = overdueCount;
        }

        // Sektion anzeigen/verstecken
        if (overdueCount > 0) {
            this.uiElements.qcOverdueSection.style.display = 'block';
            this.updateOverdueList();
        } else {
            this.uiElements.qcOverdueSection.style.display = 'none';
        }
    }

    updateOverdueList() {
        const overdueList = document.getElementById('qcOverdueList');
        if (!overdueList) return;

        overdueList.innerHTML = '';

        this.overdueSteps.forEach(step => {
            const listItem = document.createElement('div');
            listItem.className = 'qc-overdue-item';
            listItem.innerHTML = `
                <div class="qc-overdue-qr">${this.getShortQRCode(step.qrCode)}</div>
                <div class="qc-overdue-time">${step.durationMinutes} Min</div>
                <div class="qc-overdue-user">${step.userName || 'Unbekannt'}</div>
            `;
            overdueList.appendChild(listItem);
        });
    }

    updateQCStatus() {
        if (!this.uiElements.qcStatus) return;

        const totalActive = this.activeQCSteps.size;
        const overdueCount = this.overdueSteps.length;

        let statusText = 'System bereit';
        let statusClass = 'active';

        if (overdueCount > 0) {
            statusText = `${overdueCount} überfällig`;
            statusClass = 'overdue';
        } else if (totalActive > 0) {
            statusText = `${totalActive} aktiv`;
            statusClass = 'active';
        }

        // Status-Dot und Text aktualisieren
        const statusDot = this.uiElements.qcStatus.querySelector('.qc-status-dot');
        const statusTextEl = this.uiElements.qcStatus.querySelector('.qc-status-text');

        if (statusDot) {
            statusDot.className = `qc-status-dot ${statusClass}`;
        }

        if (statusTextEl) {
            statusTextEl.textContent = statusText;
        }
    }

    // ===== CURRENT SCAN QC INFO =====

    updateCurrentScanQCInfo(scanResult) {
        if (!this.uiElements.currentScanQCInfo || !scanResult.qcResult?.qcProcessed) {
            if (this.uiElements.currentScanQCInfo) {
                this.uiElements.currentScanQCInfo.style.display = 'none';
            }
            return;
        }

        const qcResult = scanResult.qcResult;
        this.uiElements.currentScanQCInfo.style.display = 'block';

        switch (qcResult.action) {
            case 'qc_started':
                this.updateQCInfo('1/2 (Eingang)', '0 Min', 'Scannen Sie den gleichen QR-Code erneut für Ausgang', 'qc-started');
                break;

            case 'qc_completed':
                this.updateQCInfo('2/2 (Ausgang)', `${qcResult.durationMinutes || 0} Min`, 'Qualitätsprüfung abgeschlossen', 'qc-completed');
                break;

            case 'qc_continued':
                this.updateQCInfo('1/2 (läuft)', `${qcResult.minutesInProgress || 0} Min`, 'QC läuft bereits - scannen Sie erneut für Ausgang', 'qc-continued');
                break;

            default:
                this.uiElements.currentScanQCInfo.style.display = 'none';
                break;
        }
    }

    updateQCInfo(stepValue, durationValue, nextStep, className) {
        if (this.uiElements.qcStepValue) {
            this.uiElements.qcStepValue.textContent = stepValue;
        }

        if (this.uiElements.qcDurationValue) {
            this.uiElements.qcDurationValue.textContent = durationValue;
        }

        if (this.uiElements.qcNextStep) {
            this.uiElements.qcNextStep.textContent = nextStep;
        }

        if (this.uiElements.currentScanQCInfo) {
            this.uiElements.currentScanQCInfo.className = `current-scan-qc-info ${className}`;
        }
    }

    // ===== EVENT HANDLERS =====

    handleQCStepStarted(data) {
        console.log('🔍 QC-Schritt gestartet:', data);

        // QC-Schritt zu lokaler Verwaltung hinzufügen
        this.activeQCSteps.set(data.qrCode, {
            id: data.qcStepId,
            qrCode: data.qrCode,
            sessionId: data.sessionId,
            userId: data.userId,
            startTime: new Date(),
            estimatedMinutes: data.estimatedMinutes,
            priority: 1,
            isOverdue: false,
            isCritical: false,
            durationMinutes: 0
        });

        // UI aktualisieren
        this.updateActiveQCStepsDisplay();
        this.updateQCStatus();

        // Erfolgs-Animation
        this.playQCAnimation('started');
    }

    handleQCStepCompleted(data) {
        console.log('✅ QC-Schritt abgeschlossen:', data);

        // QC-Schritt aus lokaler Verwaltung entfernen
        this.activeQCSteps.delete(data.qrCode);

        // Aus überfälligen entfernen falls vorhanden
        this.overdueSteps = this.overdueSteps.filter(step => step.qrCode !== data.qrCode);

        // UI aktualisieren
        this.updateActiveQCStepsDisplay();
        this.updateOverdueDisplay();
        this.updateQCStatus();

        // Erfolgs-Animation
        this.playQCAnimation('completed');

        // Session-Reset-Behandlung
        if (data.autoSessionReset) {
            this.handleSessionAutoReset(data);
        }
    }

    handleQCStepOverdue(data) {
        console.warn('⚠️ QC-Schritt überfällig:', data);

        // QC-Schritt als überfällig markieren
        const step = this.activeQCSteps.get(data.qrCode);
        if (step) {
            step.isOverdue = true;
            step.isCritical = data.durationMinutes > this.config.criticalThresholdMinutes;
        }

        // Zu überfälligen hinzufügen
        if (!this.overdueSteps.find(s => s.qrCode === data.qrCode)) {
            this.overdueSteps.push(data);
        }

        // UI aktualisieren
        this.updateActiveQCStepsDisplay();
        this.updateOverdueDisplay();
        this.updateQCStatus();

        // Überfällig-Benachrichtigung
        if (this.config.enableOverdueNotifications) {
            this.showOverdueNotification(data);
        }
    }

    handleSessionAutoReset(data) {
        console.log('🔄 Session automatisch nach QC beendet:', data);

        // Alle QC-Schritte für diese Session entfernen
        for (const [qrCode, step] of this.activeQCSteps.entries()) {
            if (step.sessionId === data.sessionId) {
                this.activeQCSteps.delete(qrCode);
            }
        }

        // Überfällige für diese Session entfernen
        this.overdueSteps = this.overdueSteps.filter(step => step.sessionId !== data.sessionId);

        // UI aktualisieren
        this.updateUI();
    }

    // ===== QC WORKFLOW INTEGRATION =====

    /**
     * Verarbeitet QR-Scan für QC-Workflow (Integration mit Main App)
     * @param {Object} scanResult - Scan-Ergebnis
     * @param {string} qrCode - QR-Code
     * @param {number} sessionId - Session ID
     * @returns {Object} - QC-verarbeitetes Ergebnis
     */
    async processQRScanForQC(scanResult, qrCode, sessionId) {
        try {
            if (!scanResult.success || !sessionId) {
                return { qcProcessed: false };
            }

            // Prüfe ob QC-System aktiv und Session ausgewählt
            if (!this.mainApp.selectedSession || this.mainApp.selectedSession.sessionId !== sessionId) {
                return { qcProcessed: false };
            }

            // Prüfe ob bereits aktiver QC-Schritt für diesen QR-Code existiert
            const existingQCStep = this.activeQCSteps.get(qrCode);

            if (existingQCStep) {
                // ===== ZWEITER SCAN: QC-Schritt abschließen =====
                const result = await this.completeQCStep(qrCode, sessionId, scanResult.data.ID);

                // Current Scan QC Info aktualisieren
                this.updateCurrentScanQCInfo({
                    qcResult: result
                });

                return result;

            } else {
                // ===== ERSTER SCAN: QC-Schritt starten =====
                const result = await this.startQCStep(qrCode, sessionId, scanResult.data.ID);

                // Current Scan QC Info aktualisieren
                this.updateCurrentScanQCInfo({
                    qcResult: result
                });

                return result;
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

    async startQCStep(qrCode, sessionId, scanId) {
        // Diese Methode wird vom Backend aufgerufen
        // Hier nur UI-Updates, da die eigentliche Logik im Backend stattfindet
        return {
            qcProcessed: true,
            action: 'qc_started',
            success: true,
            estimatedMinutes: 15,
            message: 'Qualitätsprüfung gestartet'
        };
    }

    async completeQCStep(qrCode, sessionId, scanId) {
        // Diese Methode wird vom Backend aufgerufen
        // Hier nur UI-Updates, da die eigentliche Logik im Backend stattfindet
        const step = this.activeQCSteps.get(qrCode);
        const durationMinutes = step ?
            Math.round((new Date() - step.startTime) / (1000 * 60)) : 0;

        return {
            qcProcessed: true,
            action: 'qc_completed',
            success: true,
            durationMinutes: durationMinutes,
            autoSessionReset: true,
            message: `Qualitätsprüfung abgeschlossen (${durationMinutes} Min)`
        };
    }

    // ===== USER INTERACTIONS =====

    async refreshQCData() {
        try {
            console.log('🔄 Aktualisiere QC-Daten...');

            // Loading-Animation starten
            this.showRefreshAnimation();

            // Daten laden
            await this.loadActiveQCSteps();
            await this.loadQCStatistics();

            // UI aktualisieren
            this.updateUI();

            // Update-Zeit aktualisieren
            this.lastUpdate = new Date();

            // Success-Feedback
            this.showRefreshSuccess();

        } catch (error) {
            console.error('❌ Fehler beim QC-Daten-Refresh:', error);
            this.showRefreshError();
        }
    }

    toggleQCMode() {
        // QC-Modus-Toggle (falls implementiert)
        console.log('🔍 QC-Modus Toggle (Platzhalter)');
    }

    toggleQCFilter() {
        // QC-Filter umschalten (zeige nur QC-relevante Scans)
        console.log('🔍 QC-Filter Toggle (Platzhalter)');
    }

    showQCStepDetails(step) {
        // QC-Schritt-Details Modal anzeigen
        console.log('🔍 QC-Schritt-Details:', step);

        // Hier könnte ein Modal mit detaillierten QC-Informationen gezeigt werden
        if (this.mainApp && this.mainApp.showNotification) {
            this.mainApp.showNotification('info', 'QC-Schritt Details',
                `QR: ${this.getShortQRCode(step.qrCode)} • ${step.durationMinutes} Min`);
        }
    }

    // ===== HELPER METHODS =====

    updateActiveQCSteps(qcSteps) {
        // Aktive QC-Schritte aktualisieren (für spezifische Session)
        qcSteps.forEach(step => {
            this.activeQCSteps.set(step.qrCode, {
                id: step.id,
                qrCode: step.qrCode,
                sessionId: step.sessionId,
                userId: step.userId,
                userName: step.userName,
                startTime: new Date(step.startTime),
                estimatedMinutes: step.estimatedMinutes,
                priority: step.priority,
                isOverdue: step.durationMinutes > this.config.overdueThresholdMinutes,
                isCritical: step.durationMinutes > this.config.criticalThresholdMinutes,
                durationMinutes: step.durationMinutes
            });
        });
    }

    updateAllActiveQCSteps(allQCSteps) {
        // Globale QC-Schritte für Überfällig-Check
        this.overdueSteps = allQCSteps.filter(step =>
            step.durationMinutes > this.config.overdueThresholdMinutes
        );
    }

    checkOverdueSteps() {
        // Lokale überfällige Schritte prüfen
        const now = new Date();

        for (const [qrCode, step] of this.activeQCSteps.entries()) {
            const durationMinutes = Math.round((now - step.startTime) / (1000 * 60));
            const wasOverdue = step.isOverdue;

            step.durationMinutes = durationMinutes;
            step.isOverdue = durationMinutes > this.config.overdueThresholdMinutes;
            step.isCritical = durationMinutes > this.config.criticalThresholdMinutes;

            // Neu überfällig geworden
            if (step.isOverdue && !wasOverdue) {
                this.handleQCStepOverdue({
                    qrCode: step.qrCode,
                    sessionId: step.sessionId,
                    userId: step.userId,
                    userName: step.userName,
                    durationMinutes: durationMinutes
                });
            }
        }
    }

    updateQCProgressAnimations() {
        // Progress-Bars animieren
        if (!this.config.enableQCProgressAnimation) return;

        document.querySelectorAll('.qc-progress-fill').forEach(progressBar => {
            const stepElement = progressBar.closest('.qc-step-item');
            if (stepElement) {
                const qrCode = stepElement.dataset.qrCode;
                const step = this.activeQCSteps.get(qrCode);
                if (step) {
                    const progress = this.calculateProgress(step);
                    progressBar.style.width = `${progress}%`;
                }
            }
        });
    }

    calculateProgress(step) {
        if (!step.estimatedMinutes) return 0;

        const progress = Math.min(100, (step.durationMinutes / step.estimatedMinutes) * 100);
        return Math.max(0, progress);
    }

    getShortQRCode(qrCode) {
        if (!qrCode) return '';

        if (qrCode.length <= 12) return qrCode;

        if (qrCode.includes('^')) {
            const parts = qrCode.split('^');
            return parts.length > 3 ? `${parts[1]}...${parts[3]}` : qrCode.substring(0, 12) + '...';
        }

        return qrCode.substring(0, 8) + '...' + qrCode.substring(qrCode.length - 4);
    }

    getPriorityIcon(priority) {
        switch (priority) {
            case 1: return '🔵'; // Normal
            case 2: return '🟡'; // Hoch
            case 3: return '🔴'; // Kritisch
            default: return '⚪'; // Unbekannt
        }
    }

    formatDuration(minutes) {
        if (minutes < 60) {
            return `${minutes} Min`;
        } else {
            const hours = Math.floor(minutes / 60);
            const remainingMinutes = minutes % 60;
            return `${hours}h ${remainingMinutes}m`;
        }
    }

    // ===== ANIMATIONS & FEEDBACK =====

    playQCAnimation(type) {
        if (!this.config.enableQCProgressAnimation) return;

        switch (type) {
            case 'started':
                this.flashElement(this.uiElements.qcPanel, 'qc-animation-started');
                break;
            case 'completed':
                this.flashElement(this.uiElements.qcPanel, 'qc-animation-completed');
                break;
            case 'overdue':
                this.flashElement(this.uiElements.qcPanel, 'qc-animation-overdue');
                break;
        }
    }

    flashElement(element, className) {
        if (!element) return;

        element.classList.add(className);
        setTimeout(() => {
            element.classList.remove(className);
        }, 1000);
    }

    showRefreshAnimation() {
        if (this.uiElements.qcRefreshBtn) {
            this.uiElements.qcRefreshBtn.classList.add('refreshing');
        }
    }

    showRefreshSuccess() {
        if (this.uiElements.qcRefreshBtn) {
            this.uiElements.qcRefreshBtn.classList.remove('refreshing');
            this.uiElements.qcRefreshBtn.classList.add('refresh-success');

            setTimeout(() => {
                this.uiElements.qcRefreshBtn.classList.remove('refresh-success');
            }, 1000);
        }
    }

    showRefreshError() {
        if (this.uiElements.qcRefreshBtn) {
            this.uiElements.qcRefreshBtn.classList.remove('refreshing');
            this.uiElements.qcRefreshBtn.classList.add('refresh-error');

            setTimeout(() => {
                this.uiElements.qcRefreshBtn.classList.remove('refresh-error');
            }, 2000);
        }
    }

    showOverdueNotification(step) {
        if (this.mainApp && this.mainApp.showNotification) {
            this.mainApp.showNotification('warning', 'QC überfällig',
                `${this.getShortQRCode(step.qrCode)} ist ${step.durationMinutes} Min überfällig`);
        }
    }

    // ===== PUBLIC API FOR MAIN APP =====

    /**
     * Gibt aktive QC-Schritte für Session zurück
     * @param {number} sessionId - Session ID
     * @returns {Array} - QC-Schritte
     */
    getActiveQCStepsForSession(sessionId) {
        const steps = [];
        for (const step of this.activeQCSteps.values()) {
            if (step.sessionId === sessionId) {
                steps.push(step);
            }
        }
        return steps;
    }

    /**
     * Gibt QC-Status für QR-Code zurück
     * @param {string} qrCode - QR-Code
     * @returns {Object|null} - QC-Status
     */
    getQCStatus(qrCode) {
        return this.activeQCSteps.get(qrCode) || null;
    }

    /**
     * Gibt aktuellen QC-System-Status zurück
     * @returns {Object} - QC-System-Status
     */
    getSystemStatus() {
        return {
            enabled: true,
            activeSteps: this.activeQCSteps.size,
            overdueSteps: this.overdueSteps.length,
            statistics: this.qcStatistics,
            lastUpdate: this.lastUpdate,
            config: this.config
        };
    }

    // ===== CLEANUP =====

    cleanup() {
        try {
            console.log('🧹 QC-Manager wird bereinigt...');

            // Timer stoppen
            if (this.refreshTimer) clearInterval(this.refreshTimer);
            if (this.overdueCheckTimer) clearInterval(this.overdueCheckTimer);
            if (this.statisticsTimer) clearInterval(this.statisticsTimer);
            if (this.animationTimer) clearInterval(this.animationTimer);

            // Event-Listener entfernen
            if (this.mainApp) {
                this.mainApp.off('qc-step-started', this.handleQCStepStarted);
                this.mainApp.off('qc-step-completed', this.handleQCStepCompleted);
                this.mainApp.off('qc-step-overdue', this.handleQCStepOverdue);
                this.mainApp.off('session-auto-reset', this.handleSessionAutoReset);
            }

            // Daten zurücksetzen
            this.activeQCSteps.clear();
            this.overdueSteps = [];
            this.qcStatistics = null;

            console.log('✅ QC-Manager erfolgreich bereinigt');

        } catch (error) {
            console.error('❌ Fehler beim QC-Manager-Cleanup:', error);
        }
    }
}

// Export für globale Verfügbarkeit
if (typeof window !== 'undefined') {
    window.QualityControlManager = QualityControlManager;
}

console.log('🔍 QualityControlManager geladen');
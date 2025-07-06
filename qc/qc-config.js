/**
 * Qualitätskontrolle Konfiguration
 * Zentrale Konfiguration für QC-Workflows und -Einstellungen
 * Version: 1.0.0 - Wareneinlagerung Multi-User QC System
 */

class QCConfig {
    constructor() {
        // ===== CORE QC CONFIGURATION =====
        this.core = {
            enabled: process.env.QC_ENABLED === 'true' || true,
            mode: process.env.QC_MODE || 'auto', // 'auto', 'manual', 'disabled'
            version: '1.0.0',
            supportedModes: ['auto', 'manual', 'disabled']
        };

        // ===== QC WORKFLOW CONFIGURATION =====
        this.workflow = {
            enableDoubleScanning: true,
            autoSessionResetAfterQC: process.env.QC_AUTO_SESSION_RESET === 'true' || true,
            sessionResetDelaySeconds: parseInt(process.env.QC_SESSION_RESET_DELAY) || 5,
            enableParallelQCSteps: true,
            maxParallelQCStepsPerSession: parseInt(process.env.QC_MAX_PARALLEL_PER_SESSION) || 5,
            maxParallelQCStepsGlobal: parseInt(process.env.QC_MAX_PARALLEL_GLOBAL) || 25,
            requireQCCompletion: true,
            allowQCSkip: false
        };

        // ===== QC TIMING CONFIGURATION =====
        this.timing = {
            defaultEstimatedMinutes: parseInt(process.env.QC_DEFAULT_ESTIMATED_MINUTES) || 15,
            overdueThresholdMinutes: parseInt(process.env.QC_OVERDUE_THRESHOLD_MINUTES) || 30,
            warningThresholdMinutes: parseInt(process.env.QC_WARNING_THRESHOLD_MINUTES) || 20,
            maxQCDurationMinutes: parseInt(process.env.QC_MAX_DURATION_MINUTES) || 60,
            scanCooldownSeconds: parseInt(process.env.QC_SCAN_COOLDOWN_SECONDS) || 3,
            overdueCheckIntervalMinutes: parseInt(process.env.QC_OVERDUE_CHECK_INTERVAL) || 1
        };

        // ===== QC NOTIFICATION CONFIGURATION =====
        this.notifications = {
            enableQCNotifications: process.env.QC_ENABLE_NOTIFICATIONS === 'true' || true,
            enableQCStartNotifications: true,
            enableQCCompleteNotifications: true,
            enableQCOverdueNotifications: true,
            enableSessionResetNotifications: true,
            notificationDisplayDurationMs: parseInt(process.env.QC_NOTIFICATION_DURATION) || 4000,
            enableDesktopNotifications: process.env.QC_ENABLE_DESKTOP_NOTIFICATIONS === 'true' || false
        };

        // ===== QC AUDIO CONFIGURATION =====
        this.audio = {
            enableQCAudio: process.env.QC_ENABLE_AUDIO === 'true' || true,
            enableQCStartAudio: true,
            enableQCCompleteAudio: true,
            enableQCOverdueAudio: true,
            enableSessionResetAudio: true,
            audioVolume: parseFloat(process.env.QC_AUDIO_VOLUME) || 0.3,
            audioFrequencies: {
                qcStart: [800, 1000],
                qcComplete: [1200, 1000, 800],
                qcOverdue: [400, 600, 400],
                sessionReset: [1000, 1200, 1400]
            }
        };

        // ===== QC UI CONFIGURATION =====
        this.ui = {
            showQCPanel: true,
            showQCStatusInHeader: true,
            showQCProgressIndicators: true,
            showQCTimers: true,
            showQCStatistics: true,
            enableQCModeToggle: true,
            qcPanelWidth: parseInt(process.env.QC_PANEL_WIDTH) || 280,
            qcUpdateIntervalMs: parseInt(process.env.QC_UPDATE_INTERVAL) || 1000,
            showQCInScanTable: true,
            highlightActiveQCSteps: true,
            showQCDurationInTable: true
        };

        // ===== QC QUALITY RATING CONFIGURATION =====
        this.qualityRating = {
            enableQualityRating: process.env.QC_ENABLE_QUALITY_RATING === 'true' || false,
            requiredForCompletion: false,
            ratingScale: 5, // 1-5 Sterne
            enableQualityNotes: true,
            enableDefectTracking: true,
            enableReworkTracking: true,
            qualityThresholds: {
                excellent: 5,
                good: 4,
                acceptable: 3,
                poor: 2,
                unacceptable: 1
            }
        };

        // ===== QC DATA CONFIGURATION =====
        this.data = {
            enableQCDataPersistence: true,
            enableQCAuditLog: process.env.QC_ENABLE_AUDIT_LOG === 'true' || true,
            enableQCStatisticsTracking: true,
            qcDataRetentionDays: parseInt(process.env.QC_DATA_RETENTION_DAYS) || 90,
            enableQCPerformanceMetrics: true,
            enableQCReporting: true
        };

        // ===== QC STATION CONFIGURATION =====
        this.stations = {
            enableMultipleStations: false,
            defaultStation: 'Wareneingang',
            autoAssignStations: false,
            enableStationSpecificQC: false,
            maxConcurrentQCPerStation: 10
        };

        // ===== QC CATEGORY CONFIGURATION =====
        this.categories = {
            enableQCCategories: false,
            defaultCategory: 'Standard-Textilien',
            autoDetectCategory: false,
            categorySpecificTimings: false
        };

        // ===== QC VALIDATION CONFIGURATION =====
        this.validation = {
            enableQRCodeValidation: true,
            enableSessionValidation: true,
            enableUserValidation: true,
            strictModeEnabled: false,
            allowEmptyQRCodes: false,
            maxQRCodeLength: 500,
            minQRCodeLength: 5
        };

        // ===== QC PERFORMANCE CONFIGURATION =====
        this.performance = {
            enableQCCaching: true,
            cacheSize: parseInt(process.env.QC_CACHE_SIZE) || 100,
            enableQCBatching: false,
            batchSize: parseInt(process.env.QC_BATCH_SIZE) || 10,
            enableQCCompression: false,
            maxMemoryUsageMB: parseInt(process.env.QC_MAX_MEMORY_MB) || 50
        };

        // ===== QC INTEGRATION CONFIGURATION =====
        this.integration = {
            enableInventoryIntegration: false,
            enableERPIntegration: false,
            enableWarehouseIntegration: false,
            enableQualitySystemIntegration: false,
            webhookUrl: process.env.QC_WEBHOOK_URL || null,
            apiKey: process.env.QC_API_KEY || null
        };

        // ===== QC DEBUG CONFIGURATION =====
        this.debug = {
            enableQCLogging: process.env.QC_ENABLE_LOGGING === 'true' || true,
            logLevel: process.env.QC_LOG_LEVEL || 'info', // 'debug', 'info', 'warn', 'error'
            enableQCMetrics: process.env.QC_ENABLE_METRICS === 'true' || false,
            enableQCTracing: process.env.QC_ENABLE_TRACING === 'true' || false,
            metricsUpdateIntervalMs: parseInt(process.env.QC_METRICS_INTERVAL) || 30000
        };

        // Konfiguration validieren
        this.validateConfiguration();

        console.log('⚙️ QC-Konfiguration geladen:', {
            enabled: this.core.enabled,
            mode: this.core.mode,
            autoSessionReset: this.workflow.autoSessionResetAfterQC,
            defaultEstimated: this.timing.defaultEstimatedMinutes,
            notifications: this.notifications.enableQCNotifications,
            audio: this.audio.enableQCAudio
        });
    }

    // ===== CONFIGURATION METHODS =====

    /**
     * Validiert die Konfiguration
     */
    validateConfiguration() {
        // Core validation
        if (!this.core.supportedModes.includes(this.core.mode)) {
            console.warn(`Ungültiger QC-Modus: ${this.core.mode}, verwende 'auto'`);
            this.core.mode = 'auto';
        }

        // Timing validation
        if (this.timing.defaultEstimatedMinutes < 1) {
            console.warn('QC default estimated minutes zu niedrig, setze auf 15');
            this.timing.defaultEstimatedMinutes = 15;
        }

        if (this.timing.overdueThresholdMinutes <= this.timing.defaultEstimatedMinutes) {
            console.warn('QC overdue threshold zu niedrig, passe an');
            this.timing.overdueThresholdMinutes = this.timing.defaultEstimatedMinutes + 15;
        }

        // Workflow validation
        if (this.workflow.maxParallelQCStepsPerSession > this.workflow.maxParallelQCStepsGlobal) {
            console.warn('QC max parallel per session höher als global, korrigiere');
            this.workflow.maxParallelQCStepsPerSession =
                Math.min(this.workflow.maxParallelQCStepsPerSession, this.workflow.maxParallelQCStepsGlobal);
        }

        // Audio validation
        if (this.audio.audioVolume < 0 || this.audio.audioVolume > 1) {
            console.warn('QC audio volume außerhalb gültigen Bereichs, setze auf 0.3');
            this.audio.audioVolume = 0.3;
        }

        console.log('✅ QC-Konfiguration validiert');
    }

    /**
     * Aktualisiert Konfiguration
     */
    updateConfiguration(section, updates) {
        if (!this[section]) {
            console.error(`Unbekannte QC-Konfiguration Sektion: ${section}`);
            return false;
        }

        const oldValues = { ...this[section] };
        this[section] = { ...this[section], ...updates };

        // Re-validierung
        this.validateConfiguration();

        console.log(`⚙️ QC-Konfiguration aktualisiert [${section}]:`, {
            old: oldValues,
            new: this[section]
        });

        return true;
    }

    /**
     * Setzt Konfiguration auf Standard zurück
     */
    resetToDefaults() {
        console.log('🔄 QC-Konfiguration wird auf Standard zurückgesetzt');

        // Konstruktor erneut ausführen
        const defaultConfig = new QCConfig();

        // Alle Eigenschaften kopieren
        Object.keys(defaultConfig).forEach(key => {
            if (typeof defaultConfig[key] === 'object' && defaultConfig[key] !== null) {
                this[key] = { ...defaultConfig[key] };
            } else {
                this[key] = defaultConfig[key];
            }
        });

        console.log('✅ QC-Konfiguration auf Standard zurückgesetzt');
    }

    // ===== GETTER METHODS =====

    /**
     * Prüft ob QC aktiviert ist
     */
    isEnabled() {
        return this.core.enabled && this.core.mode !== 'disabled';
    }

    /**
     * Prüft ob Auto-Modus aktiv ist
     */
    isAutoMode() {
        return this.core.mode === 'auto';
    }

    /**
     * Prüft ob manueller Modus aktiv ist
     */
    isManualMode() {
        return this.core.mode === 'manual';
    }

    /**
     * Ruft QC-Workflow-Konfiguration ab
     */
    getWorkflowConfig() {
        return {
            ...this.workflow,
            ...this.timing
        };
    }

    /**
     * Ruft QC-UI-Konfiguration ab
     */
    getUIConfig() {
        return {
            ...this.ui,
            notifications: this.notifications,
            audio: this.audio
        };
    }

    /**
     * Ruft QC-Qualitätsbewertungs-Konfiguration ab
     */
    getQualityConfig() {
        return this.qualityRating;
    }

    /**
     * Ruft vollständige Konfiguration ab
     */
    getFullConfig() {
        return {
            core: this.core,
            workflow: this.workflow,
            timing: this.timing,
            notifications: this.notifications,
            audio: this.audio,
            ui: this.ui,
            qualityRating: this.qualityRating,
            data: this.data,
            stations: this.stations,
            categories: this.categories,
            validation: this.validation,
            performance: this.performance,
            integration: this.integration,
            debug: this.debug
        };
    }

    // ===== PRESET CONFIGURATIONS =====

    /**
     * Lädt Schnell-QC-Preset
     */
    loadQuickQCPreset() {
        console.log('🚀 Lade Schnell-QC-Preset');

        this.updateConfiguration('timing', {
            defaultEstimatedMinutes: 5,
            overdueThresholdMinutes: 10,
            warningThresholdMinutes: 7
        });

        this.updateConfiguration('workflow', {
            autoSessionResetAfterQC: true,
            sessionResetDelaySeconds: 2
        });

        this.updateConfiguration('notifications', {
            notificationDisplayDurationMs: 2000
        });
    }

    /**
     * Lädt Standard-QC-Preset
     */
    loadStandardQCPreset() {
        console.log('📋 Lade Standard-QC-Preset');

        this.updateConfiguration('timing', {
            defaultEstimatedMinutes: 15,
            overdueThresholdMinutes: 30,
            warningThresholdMinutes: 20
        });

        this.updateConfiguration('workflow', {
            autoSessionResetAfterQC: true,
            sessionResetDelaySeconds: 5
        });
    }

    /**
     * Lädt Detail-QC-Preset
     */
    loadDetailedQCPreset() {
        console.log('🔍 Lade Detail-QC-Preset');

        this.updateConfiguration('timing', {
            defaultEstimatedMinutes: 30,
            overdueThresholdMinutes: 45,
            warningThresholdMinutes: 35
        });

        this.updateConfiguration('qualityRating', {
            enableQualityRating: true,
            requiredForCompletion: true,
            enableQualityNotes: true,
            enableDefectTracking: true
        });

        this.updateConfiguration('workflow', {
            autoSessionResetAfterQC: false
        });
    }

    /**
     * Lädt Silent-QC-Preset (ohne Audio/Notifications)
     */
    loadSilentQCPreset() {
        console.log('🔇 Lade Silent-QC-Preset');

        this.updateConfiguration('notifications', {
            enableQCNotifications: false,
            enableDesktopNotifications: false
        });

        this.updateConfiguration('audio', {
            enableQCAudio: false,
            enableQCStartAudio: false,
            enableQCCompleteAudio: false,
            enableQCOverdueAudio: false
        });
    }

    // ===== ENVIRONMENT HELPERS =====

    /**
     * Lädt Konfiguration aus Umgebungsvariablen
     */
    loadFromEnvironment() {
        console.log('🌍 Lade QC-Konfiguration aus Umgebungsvariablen');

        // Core
        if (process.env.QC_ENABLED !== undefined) {
            this.core.enabled = process.env.QC_ENABLED === 'true';
        }

        if (process.env.QC_MODE) {
            this.core.mode = process.env.QC_MODE;
        }

        // Workflow
        if (process.env.QC_AUTO_SESSION_RESET !== undefined) {
            this.workflow.autoSessionResetAfterQC = process.env.QC_AUTO_SESSION_RESET === 'true';
        }

        // Re-validierung nach Umgebungsladung
        this.validateConfiguration();

        console.log('✅ QC-Konfiguration aus Umgebung geladen');
    }

    /**
     * Exportiert Konfiguration für .env Datei
     */
    exportToEnvironment() {
        const envVars = {
            QC_ENABLED: this.core.enabled,
            QC_MODE: this.core.mode,
            QC_AUTO_SESSION_RESET: this.workflow.autoSessionResetAfterQC,
            QC_SESSION_RESET_DELAY: this.workflow.sessionResetDelaySeconds,
            QC_DEFAULT_ESTIMATED_MINUTES: this.timing.defaultEstimatedMinutes,
            QC_OVERDUE_THRESHOLD_MINUTES: this.timing.overdueThresholdMinutes,
            QC_ENABLE_NOTIFICATIONS: this.notifications.enableQCNotifications,
            QC_ENABLE_AUDIO: this.audio.enableQCAudio,
            QC_AUDIO_VOLUME: this.audio.audioVolume,
            QC_PANEL_WIDTH: this.ui.qcPanelWidth,
            QC_UPDATE_INTERVAL: this.ui.qcUpdateIntervalMs
        };

        return envVars;
    }

    // ===== UTILITY METHODS =====

    /**
     * Erstellt Konfigurationsbericht
     */
    generateConfigReport() {
        const report = {
            timestamp: new Date().toISOString(),
            version: this.core.version,
            summary: {
                enabled: this.isEnabled(),
                mode: this.core.mode,
                autoSessionReset: this.workflow.autoSessionResetAfterQC,
                defaultEstimatedMinutes: this.timing.defaultEstimatedMinutes,
                overdueThresholdMinutes: this.timing.overdueThresholdMinutes,
                notificationsEnabled: this.notifications.enableQCNotifications,
                audioEnabled: this.audio.enableQCAudio,
                qualityRatingEnabled: this.qualityRating.enableQualityRating
            },
            full: this.getFullConfig()
        };

        return report;
    }

    /**
     * Validiert QC-Konfiguration gegen Systemvoraussetzungen
     */
    validateSystemCompatibility() {
        const issues = [];

        // Prüfe Browser-Kompatibilität für Audio
        if (this.audio.enableQCAudio && typeof window !== 'undefined' && !window.AudioContext) {
            issues.push('Audio-Features nicht unterstützt (AudioContext nicht verfügbar)');
        }

        // Prüfe Desktop-Notification-Support
        if (this.notifications.enableDesktopNotifications && typeof window !== 'undefined' && !window.Notification) {
            issues.push('Desktop-Benachrichtigungen nicht unterstützt');
        }

        // Prüfe Memory-Limits
        if (this.performance.maxMemoryUsageMB > 200) {
            issues.push('QC Memory-Limit möglicherweise zu hoch');
        }

        return {
            compatible: issues.length === 0,
            issues: issues
        };
    }
}

// ===== SINGLETON PATTERN =====
let qcConfigInstance = null;

/**
 * Ruft QC-Konfiguration-Singleton ab
 */
function getQCConfig() {
    if (!qcConfigInstance) {
        qcConfigInstance = new QCConfig();
    }
    return qcConfigInstance;
}

/**
 * Setzt neue QC-Konfiguration-Instanz
 */
function setQCConfig(config) {
    qcConfigInstance = config;
    return qcConfigInstance;
}

/**
 * Setzt QC-Konfiguration zurück
 */
function resetQCConfig() {
    qcConfigInstance = new QCConfig();
    return qcConfigInstance;
}

// ===== EXPORTS =====
module.exports = {
    QCConfig,
    getQCConfig,
    setQCConfig,
    resetQCConfig
};
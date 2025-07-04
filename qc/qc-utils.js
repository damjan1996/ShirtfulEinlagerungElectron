/**
 * QC Utility Functions für Qualitätskontrolle
 * Helper-Funktionen für QC-Operationen und -Verarbeitung
 * Version: 1.0.0 - Wareneinlagerung Multi-User QC System
 */

/**
 * QC-spezifische Utility-Klasse
 */
class QCUtils {

    // ===== QR-CODE UTILITIES =====

    /**
     * Extrahiert QC-relevante Daten aus QR-Code
     * @param {string} qrCode - QR-Code Payload
     * @returns {Object} - Extrahierte QC-Daten
     */
    static extractQCDataFromQR(qrCode) {
        if (!qrCode || typeof qrCode !== 'string') {
            return null;
        }

        const qcData = {
            qrCode: qrCode,
            shortCode: this.getShortQRCode(qrCode),
            category: this.detectQCCategory(qrCode),
            priority: this.detectQCPriority(qrCode),
            estimatedDuration: this.estimateQCDuration(qrCode),
            complexity: this.assessQCComplexity(qrCode),
            isValid: this.validateQRForQC(qrCode)
        };

        return qcData;
    }

    /**
     * Erstellt kurze QR-Code-Anzeige für UI
     * @param {string} qrCode - QR-Code
     * @returns {string} - Gekürzte Anzeige
     */
    static getShortQRCode(qrCode) {
        if (!qrCode) return '';

        if (qrCode.length <= 12) return qrCode;

        // Strukturierte Daten erkennen (durch ^ getrennt)
        if (qrCode.includes('^')) {
            const parts = qrCode.split('^');
            if (parts.length >= 4) {
                // Zeige Auftrag und Paket
                return `${parts[1]}...${parts[3]}`;
            }
            return qrCode.substring(0, 12) + '...';
        }

        // Standardkürzung
        return qrCode.substring(0, 8) + '...' + qrCode.substring(qrCode.length - 4);
    }

    /**
     * Erkennt QC-Kategorie basierend auf QR-Code-Inhalt
     * @param {string} qrCode - QR-Code
     * @returns {string} - QC-Kategorie
     */
    static detectQCCategory(qrCode) {
        if (!qrCode) return 'Standard';

        const lowerCode = qrCode.toLowerCase();

        // Textil-spezifische Muster
        if (lowerCode.includes('shirt') || lowerCode.includes('textil')) {
            return 'Standard-Textilien';
        }

        if (lowerCode.includes('premium') || lowerCode.includes('luxury')) {
            return 'Premium-Textilien';
        }

        if (lowerCode.includes('print') || lowerCode.includes('druck')) {
            return 'Druckerzeugnisse';
        }

        if (lowerCode.includes('stick') || lowerCode.includes('embroidery')) {
            return 'Stickwaren';
        }

        if (lowerCode.includes('custom') || lowerCode.includes('special')) {
            return 'Sonderanfertigungen';
        }

        return 'Standard-Textilien';
    }

    /**
     * Erkennt QC-Priorität basierend auf QR-Code
     * @param {string} qrCode - QR-Code
     * @returns {number} - Priorität (1=Normal, 2=Hoch, 3=Kritisch)
     */
    static detectQCPriority(qrCode) {
        if (!qrCode) return 1;

        const lowerCode = qrCode.toLowerCase();

        // Kritische Priorität
        if (lowerCode.includes('urgent') || lowerCode.includes('critical') ||
            lowerCode.includes('express') || lowerCode.includes('rush')) {
            return 3;
        }

        // Hohe Priorität
        if (lowerCode.includes('high') || lowerCode.includes('priority') ||
            lowerCode.includes('important') || lowerCode.includes('premium')) {
            return 2;
        }

        // Normale Priorität
        return 1;
    }

    /**
     * Schätzt QC-Dauer basierend auf QR-Code-Eigenschaften
     * @param {string} qrCode - QR-Code
     * @returns {number} - Geschätzte Dauer in Minuten
     */
    static estimateQCDuration(qrCode) {
        const category = this.detectQCCategory(qrCode);
        const complexity = this.assessQCComplexity(qrCode);

        // Basis-Dauer nach Kategorie
        const baseDurations = {
            'Standard-Textilien': 10,
            'Premium-Textilien': 20,
            'Druckerzeugnisse': 15,
            'Stickwaren': 18,
            'Sonderanfertigungen': 30
        };

        let duration = baseDurations[category] || 15;

        // Komplexitäts-Modifier
        switch (complexity) {
            case 'low':
                duration *= 0.8;
                break;
            case 'high':
                duration *= 1.3;
                break;
            case 'very_high':
                duration *= 1.6;
                break;
        }

        return Math.round(Math.max(5, Math.min(60, duration)));
    }

    /**
     * Bewertet QC-Komplexität basierend auf QR-Code
     * @param {string} qrCode - QR-Code
     * @returns {string} - Komplexität ('low', 'medium', 'high', 'very_high')
     */
    static assessQCComplexity(qrCode) {
        if (!qrCode) return 'medium';

        let complexityScore = 0;
        const lowerCode = qrCode.toLowerCase();

        // Längen-basierte Komplexität
        if (qrCode.length > 200) complexityScore += 2;
        else if (qrCode.length > 100) complexityScore += 1;

        // Inhalts-basierte Komplexität
        if (lowerCode.includes('custom') || lowerCode.includes('special')) complexityScore += 2;
        if (lowerCode.includes('multi') || lowerCode.includes('variant')) complexityScore += 1;
        if (lowerCode.includes('premium') || lowerCode.includes('luxury')) complexityScore += 1;
        if (lowerCode.includes('print') && lowerCode.includes('stick')) complexityScore += 2;

        // Strukturelle Komplexität (durch ^ getrennte Daten)
        if (qrCode.includes('^')) {
            const parts = qrCode.split('^');
            if (parts.length > 6) complexityScore += 2;
            else if (parts.length > 4) complexityScore += 1;
        }

        // JSON-Komplexität
        if (this.isJSON(qrCode)) {
            try {
                const jsonData = JSON.parse(qrCode);
                const keyCount = Object.keys(jsonData).length;
                if (keyCount > 10) complexityScore += 2;
                else if (keyCount > 5) complexityScore += 1;
            } catch (e) {
                // Ignore parsing errors
            }
        }

        // Komplexitätsbewertung
        if (complexityScore >= 6) return 'very_high';
        if (complexityScore >= 4) return 'high';
        if (complexityScore >= 2) return 'medium';
        return 'low';
    }

    /**
     * Validiert QR-Code für QC-Verarbeitung
     * @param {string} qrCode - QR-Code
     * @returns {boolean} - Gültig für QC
     */
    static validateQRForQC(qrCode) {
        if (!qrCode || typeof qrCode !== 'string') return false;

        // Längen-Validierung
        if (qrCode.length < 5 || qrCode.length > 500) return false;

        // Leer-String-Check
        if (qrCode.trim().length === 0) return false;

        // Ungültige Zeichen prüfen
        const invalidChars = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/;
        if (invalidChars.test(qrCode)) return false;

        return true;
    }

    // ===== TIME UTILITIES =====

    /**
     * Formatiert QC-Dauer für Anzeige
     * @param {number} minutes - Dauer in Minuten
     * @returns {string} - Formatierte Dauer
     */
    static formatQCDuration(minutes) {
        if (typeof minutes !== 'number' || minutes < 0) return '0 Min';

        if (minutes < 60) {
            return `${Math.round(minutes)} Min`;
        }

        const hours = Math.floor(minutes / 60);
        const remainingMinutes = Math.round(minutes % 60);

        if (remainingMinutes === 0) {
            return `${hours}h`;
        }

        return `${hours}h ${remainingMinutes}Min`;
    }

    /**
     * Berechnet QC-Fortschritt in Prozent
     * @param {Date} startTime - Start-Zeit
     * @param {number} estimatedMinutes - Geschätzte Dauer in Minuten
     * @returns {Object} - Fortschritts-Informationen
     */
    static calculateQCProgress(startTime, estimatedMinutes) {
        if (!startTime || !estimatedMinutes) {
            return { percent: 0, status: 'unknown', minutesElapsed: 0 };
        }

        const now = new Date();
        const elapsedMs = now - startTime;
        const minutesElapsed = Math.round(elapsedMs / (1000 * 60));
        const estimatedMs = estimatedMinutes * 60 * 1000;

        let percent = Math.round((elapsedMs / estimatedMs) * 100);
        percent = Math.max(0, Math.min(200, percent)); // Cap bei 200%

        let status = 'on_track';
        if (percent > 120) status = 'overdue';
        else if (percent > 100) status = 'over_estimate';
        else if (percent > 80) status = 'nearing_completion';
        else if (percent > 50) status = 'in_progress';
        else status = 'started';

        return {
            percent: percent,
            status: status,
            minutesElapsed: minutesElapsed,
            minutesRemaining: Math.max(0, estimatedMinutes - minutesElapsed),
            isOverdue: percent > 100,
            isNearingCompletion: percent > 80 && percent <= 100
        };
    }

    /**
     * Formatiert Zeitstempel für QC-Anzeige
     * @param {Date|string} timestamp - Zeitstempel
     * @param {string} format - Format ('time', 'relative', 'full')
     * @returns {string} - Formatierte Zeit
     */
    static formatQCTimestamp(timestamp, format = 'time') {
        if (!timestamp) return '--:--';

        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return '--:--';

        switch (format) {
            case 'time':
                return date.toLocaleTimeString('de-DE', {
                    hour: '2-digit',
                    minute: '2-digit'
                });

            case 'relative':
                return this.getRelativeTime(date);

            case 'full':
                return date.toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });

            default:
                return date.toLocaleTimeString('de-DE');
        }
    }

    /**
     * Berechnet relative Zeit (vor X Minuten)
     * @param {Date} date - Datum
     * @returns {string} - Relative Zeit
     */
    static getRelativeTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        if (diffMinutes < 1) return 'gerade eben';
        if (diffMinutes < 60) return `vor ${diffMinutes} Min`;

        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) return `vor ${diffHours}h`;

        const diffDays = Math.floor(diffHours / 24);
        return `vor ${diffDays} Tag${diffDays !== 1 ? 'en' : ''}`;
    }

    // ===== QC STATUS UTILITIES =====

    /**
     * Erstellt QC-Status-Informationen
     * @param {Object} qcStep - QC-Schritt-Daten
     * @returns {Object} - Status-Informationen
     */
    static createQCStatusInfo(qcStep) {
        if (!qcStep) {
            return {
                status: 'none',
                icon: '📄',
                label: 'Kein QC',
                color: '#6b7280',
                priority: 0
            };
        }

        const progress = this.calculateQCProgress(qcStep.startTime, qcStep.estimatedMinutes);

        const statusMap = {
            started: {
                icon: '🔍',
                label: 'QC läuft',
                color: '#3b82f6',
                priority: 2
            },
            in_progress: {
                icon: '🔄',
                label: 'In Bearbeitung',
                color: '#6366f1',
                priority: 2
            },
            nearing_completion: {
                icon: '⏰',
                label: 'Fast fertig',
                color: '#f59e0b',
                priority: 3
            },
            over_estimate: {
                icon: '⚠️',
                label: 'Über Zeit',
                color: '#f97316',
                priority: 4
            },
            overdue: {
                icon: '🚨',
                label: 'Überfällig',
                color: '#ef4444',
                priority: 5
            },
            completed: {
                icon: '✅',
                label: 'Abgeschlossen',
                color: '#10b981',
                priority: 1
            },
            aborted: {
                icon: '❌',
                label: 'Abgebrochen',
                color: '#ef4444',
                priority: 1
            }
        };

        const statusInfo = statusMap[progress.status] || statusMap.started;

        return {
            status: progress.status,
            icon: statusInfo.icon,
            label: statusInfo.label,
            color: statusInfo.color,
            priority: statusInfo.priority,
            progress: progress,
            duration: this.formatQCDuration(progress.minutesElapsed),
            estimated: this.formatQCDuration(qcStep.estimatedMinutes)
        };
    }

    /**
     * Sortiert QC-Schritte nach Priorität und Status
     * @param {Array} qcSteps - QC-Schritte
     * @returns {Array} - Sortierte QC-Schritte
     */
    static sortQCSteps(qcSteps) {
        if (!Array.isArray(qcSteps)) return [];

        return qcSteps.sort((a, b) => {
            // Erst nach QC-Status-Priorität
            const statusA = this.createQCStatusInfo(a);
            const statusB = this.createQCStatusInfo(b);

            if (statusA.priority !== statusB.priority) {
                return statusB.priority - statusA.priority; // Höhere Priorität zuerst
            }

            // Dann nach QC-Schritt-Priorität
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }

            // Dann nach Start-Zeit
            return new Date(a.startTime) - new Date(b.startTime);
        });
    }

    // ===== DATA UTILITIES =====

    /**
     * Prüft ob String JSON ist
     * @param {string} str - String
     * @returns {boolean} - Ist JSON
     */
    static isJSON(str) {
        if (typeof str !== 'string') return false;

        try {
            JSON.parse(str);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Säubert QR-Code-Daten für QC-Verarbeitung
     * @param {string} qrCode - QR-Code
     * @returns {string} - Gesäuberter QR-Code
     */
    static sanitizeQRCode(qrCode) {
        if (typeof qrCode !== 'string') return '';

        // BOM entfernen
        let clean = qrCode.replace(/^\ufeff/, '');

        // Führende/nachfolgende Whitespaces
        clean = clean.trim();

        // Steuerzeichen entfernen (außer Tabs und Newlines)
        clean = clean.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

        return clean;
    }

    /**
     * Extrahiert Metadaten aus QR-Code für QC
     * @param {string} qrCode - QR-Code
     * @returns {Object} - Metadaten
     */
    static extractQCMetadata(qrCode) {
        const metadata = {
            length: qrCode ? qrCode.length : 0,
            hasStructuredData: qrCode ? qrCode.includes('^') : false,
            isJSON: this.isJSON(qrCode),
            encoding: 'utf-8',
            estimatedComplexity: this.assessQCComplexity(qrCode),
            qcCategory: this.detectQCCategory(qrCode),
            qcPriority: this.detectQCPriority(qrCode),
            checksum: this.calculateSimpleChecksum(qrCode)
        };

        // JSON-spezifische Metadaten
        if (metadata.isJSON) {
            try {
                const jsonData = JSON.parse(qrCode);
                metadata.jsonKeys = Object.keys(jsonData);
                metadata.jsonDepth = this.getJSONDepth(jsonData);
            } catch (e) {
                metadata.isJSON = false;
            }
        }

        // Strukturierte Daten-Metadaten
        if (metadata.hasStructuredData) {
            const parts = qrCode.split('^');
            metadata.structuredParts = parts.length;
            metadata.structuredFields = parts.filter(p => p.trim().length > 0).length;
        }

        return metadata;
    }

    /**
     * Berechnet einfache Checksum für QR-Code
     * @param {string} str - String
     * @returns {string} - Checksum
     */
    static calculateSimpleChecksum(str) {
        if (!str) return '0';

        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }

        return Math.abs(hash).toString(16);
    }

    /**
     * Berechnet JSON-Verschachtelungstiefe
     * @param {Object} obj - JSON-Objekt
     * @returns {number} - Verschachtelungstiefe
     */
    static getJSONDepth(obj) {
        if (typeof obj !== 'object' || obj === null) return 0;

        let maxDepth = 0;

        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                const depth = 1 + this.getJSONDepth(obj[key]);
                maxDepth = Math.max(maxDepth, depth);
            }
        }

        return maxDepth;
    }

    // ===== NOTIFICATION UTILITIES =====

    /**
     * Erstellt QC-Benachrichtigungs-Daten
     * @param {string} type - Benachrichtigungstyp
     * @param {Object} qcData - QC-Daten
     * @returns {Object} - Benachrichtigungs-Daten
     */
    static createQCNotification(type, qcData) {
        const notifications = {
            qc_started: {
                icon: '🔍',
                title: 'QC gestartet',
                type: 'info',
                duration: 3000
            },
            qc_completed: {
                icon: '✅',
                title: 'QC abgeschlossen',
                type: 'success',
                duration: 4000
            },
            qc_overdue: {
                icon: '⚠️',
                title: 'QC überfällig',
                type: 'warning',
                duration: 6000
            },
            qc_aborted: {
                icon: '❌',
                title: 'QC abgebrochen',
                type: 'error',
                duration: 4000
            },
            session_reset: {
                icon: '🔄',
                title: 'Session beendet',
                type: 'info',
                duration: 3000
            }
        };

        const template = notifications[type] || notifications.qc_started;

        return {
            ...template,
            message: this.createNotificationMessage(type, qcData),
            timestamp: new Date().toISOString(),
            qcData: qcData
        };
    }

    /**
     * Erstellt Benachrichtigungs-Nachricht basierend auf QC-Daten
     * @param {string} type - Benachrichtigungstyp
     * @param {Object} qcData - QC-Daten
     * @returns {string} - Nachricht
     */
    static createNotificationMessage(type, qcData) {
        const shortCode = this.getShortQRCode(qcData.qrCode);

        switch (type) {
            case 'qc_started':
                return `Qualitätsprüfung für ${shortCode} gestartet`;

            case 'qc_completed':
                const duration = qcData.durationMinutes || 0;
                return `Qualitätsprüfung für ${shortCode} abgeschlossen (${duration} Min)`;

            case 'qc_overdue':
                const overdueMinutes = qcData.minutesInProgress || 0;
                return `Qualitätsprüfung für ${shortCode} ist ${overdueMinutes} Min überfällig`;

            case 'qc_aborted':
                const reason = qcData.reason || 'Unbekannt';
                return `Qualitätsprüfung für ${shortCode} abgebrochen: ${reason}`;

            case 'session_reset':
                const completedSteps = qcData.completedSteps || 0;
                return `${completedSteps} QC-Schritt${completedSteps !== 1 ? 'e' : ''} abgeschlossen - Session automatisch beendet`;

            default:
                return `QC-Event für ${shortCode}`;
        }
    }

    // ===== VALIDATION UTILITIES =====

    /**
     * Validiert QC-Konfiguration
     * @param {Object} config - QC-Konfiguration
     * @returns {Object} - Validierungs-Ergebnis
     */
    static validateQCConfig(config) {
        const errors = [];
        const warnings = [];

        if (!config) {
            errors.push('QC-Konfiguration fehlt');
            return { valid: false, errors, warnings };
        }

        // Timing-Validierung
        if (config.defaultEstimatedMinutes < 1) {
            errors.push('Default estimated minutes muss >= 1 sein');
        }

        if (config.overdueThresholdMinutes <= config.defaultEstimatedMinutes) {
            warnings.push('Overdue threshold sollte höher als default estimated minutes sein');
        }

        // Workflow-Validierung
        if (config.maxParallelQCStepsPerSession > config.maxParallelQCStepsGlobal) {
            errors.push('Max parallel per session kann nicht höher als global limit sein');
        }

        // Audio-Validierung
        if (config.audioVolume < 0 || config.audioVolume > 1) {
            errors.push('Audio volume muss zwischen 0 und 1 liegen');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validiert QC-Schritt-Daten
     * @param {Object} qcStep - QC-Schritt-Daten
     * @returns {Object} - Validierungs-Ergebnis
     */
    static validateQCStep(qcStep) {
        const errors = [];

        if (!qcStep) {
            errors.push('QC-Schritt-Daten fehlen');
            return { valid: false, errors };
        }

        if (!qcStep.qrCode || typeof qcStep.qrCode !== 'string') {
            errors.push('QR-Code fehlt oder ungültig');
        }

        if (!qcStep.sessionId || typeof qcStep.sessionId !== 'number') {
            errors.push('Session-ID fehlt oder ungültig');
        }

        if (qcStep.priority && (qcStep.priority < 1 || qcStep.priority > 3)) {
            errors.push('Priorität muss zwischen 1 und 3 liegen');
        }

        if (qcStep.estimatedMinutes && qcStep.estimatedMinutes < 1) {
            errors.push('Geschätzte Dauer muss >= 1 Minute sein');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    // ===== EXPORT UTILITIES =====

    /**
     * Exportiert QC-Daten für Reporting
     * @param {Array} qcSteps - QC-Schritte
     * @param {string} format - Export-Format ('json', 'csv')
     * @returns {string} - Exportierte Daten
     */
    static exportQCData(qcSteps, format = 'json') {
        if (!Array.isArray(qcSteps)) return '';

        const exportData = qcSteps.map(step => ({
            qrCode: step.qrCode,
            shortCode: this.getShortQRCode(step.qrCode),
            sessionId: step.sessionId,
            startTime: step.startTime,
            endTime: step.endTime,
            durationMinutes: step.durationMinutes,
            category: this.detectQCCategory(step.qrCode),
            priority: step.priority,
            status: step.status,
            completedAt: step.completedAt,
            userId: step.userId
        }));

        if (format === 'csv') {
            return this.convertToCSV(exportData);
        }

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Konvertiert Daten zu CSV
     * @param {Array} data - Daten-Array
     * @returns {string} - CSV-String
     */
    static convertToCSV(data) {
        if (!Array.isArray(data) || data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const csvHeaders = headers.join(',');

        const csvRows = data.map(row => {
            return headers.map(header => {
                const value = row[header];
                if (value === null || value === undefined) return '';
                if (typeof value === 'string' && value.includes(',')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',');
        });

        return [csvHeaders, ...csvRows].join('\n');
    }
}

// ===== CONSTANTS =====

/**
 * QC-Konstanten
 */
const QC_CONSTANTS = {
    // QC-Status
    STATUS: {
        NONE: 'none',
        STARTED: 'started',
        IN_PROGRESS: 'in_progress',
        NEARING_COMPLETION: 'nearing_completion',
        OVER_ESTIMATE: 'over_estimate',
        OVERDUE: 'overdue',
        COMPLETED: 'completed',
        ABORTED: 'aborted'
    },

    // QC-Prioritäten
    PRIORITY: {
        NORMAL: 1,
        HIGH: 2,
        CRITICAL: 3
    },

    // QC-Kategorien
    CATEGORIES: {
        STANDARD_TEXTILES: 'Standard-Textilien',
        PREMIUM_TEXTILES: 'Premium-Textilien',
        PRINT_PRODUCTS: 'Druckerzeugnisse',
        EMBROIDERY: 'Stickwaren',
        CUSTOM_PRODUCTS: 'Sonderanfertigungen'
    },

    // QC-Komplexität
    COMPLEXITY: {
        LOW: 'low',
        MEDIUM: 'medium',
        HIGH: 'high',
        VERY_HIGH: 'very_high'
    },

    // Standard-Zeiten (Minuten)
    DEFAULT_DURATIONS: {
        STANDARD_TEXTILES: 10,
        PREMIUM_TEXTILES: 20,
        PRINT_PRODUCTS: 15,
        EMBROIDERY: 18,
        CUSTOM_PRODUCTS: 30
    },

    // UI-Farben für QC-Status
    COLORS: {
        NONE: '#6b7280',
        STARTED: '#3b82f6',
        IN_PROGRESS: '#6366f1',
        NEARING_COMPLETION: '#f59e0b',
        OVER_ESTIMATE: '#f97316',
        OVERDUE: '#ef4444',
        COMPLETED: '#10b981',
        ABORTED: '#ef4444'
    }
};

// ===== EXPORTS =====
module.exports = {
    QCUtils,
    QC_CONSTANTS
};
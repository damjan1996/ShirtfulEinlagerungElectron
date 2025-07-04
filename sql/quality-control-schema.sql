-- ===================================================================
-- Qualitätskontrolle Datenbankschema für doppelte QR-Scans
-- Erweitert das bestehende Wareneinlagerung-Schema um QC-spezifische Tabellen
-- Version: 1.0.0 - Wareneinlagerung Multi-User QC System
-- ===================================================================

USE [RdScanner];
GO

-- ===== QUALITÄTSKONTROLLE HAUPTTABELLE =====

-- QualityControlSteps: Verfolgt jeden QC-Schritt von Eingang bis Ausgang
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'QualityControlSteps')
BEGIN
CREATE TABLE dbo.QualityControlSteps (
                                         ID INT IDENTITY(1,1) PRIMARY KEY,

    -- Session-Verknüpfung
                                         SessionID INT NOT NULL,
                                         QrCode NVARCHAR(500) NOT NULL,

    -- QC-Workflow Tracking
                                         StartScanID INT NULL,                       -- ID des ersten QR-Scans (Eingang)
                                         EndScanID INT NULL,                         -- ID des zweiten QR-Scans (Ausgang)
                                         StartTime DATETIME2 NOT NULL DEFAULT GETDATE(),
                                         EndTime DATETIME2 NULL,
                                         Completed BIT NOT NULL DEFAULT 0,          -- TRUE wenn beide Scans erfolgt

    -- QC-Status
                                         QCStatus NVARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'completed', 'aborted'
                                         Priority TINYINT NOT NULL DEFAULT 1,       -- 1=Normal, 2=Hoch, 3=Kritisch
                                         EstimatedDurationMinutes INT NULL,         -- Geschätzte Bearbeitungszeit
                                         ActualDurationSeconds AS (
            CASE
                WHEN EndTime IS NOT NULL THEN DATEDIFF(SECOND, StartTime, EndTime)
                ELSE DATEDIFF(SECOND, StartTime, GETDATE())
            END
        ),

    -- Qualitätsdaten
                                         QualityRating TINYINT NULL,                -- 1-5 Bewertung (optional)
                                         QualityNotes NVARCHAR(1000) NULL,         -- Notizen zur Qualitätsprüfung
                                         DefectsFound BIT DEFAULT 0,               -- Mängel gefunden?
                                         DefectDescription NVARCHAR(500) NULL,     -- Beschreibung der Mängel

    -- Metadaten
                                         ProcessingLocation NVARCHAR(100) NULL,    -- Bearbeitungsort/Station
                                         BatchNumber NVARCHAR(50) NULL,            -- Chargennummer falls relevant
                                         ReworkRequired BIT DEFAULT 0,             -- Nacharbeit erforderlich?

    -- Audit-Felder
                                         CreatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),
                                         UpdatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),
                                         CreatedByUserID INT NULL,
                                         CompletedByUserID INT NULL,

    -- Foreign Key Constraints
                                         CONSTRAINT FK_QualityControlSteps_SessionID
                                             FOREIGN KEY (SessionID) REFERENCES Sessions(ID),
                                         CONSTRAINT FK_QualityControlSteps_StartScanID
                                             FOREIGN KEY (StartScanID) REFERENCES QrScans(ID),
                                         CONSTRAINT FK_QualityControlSteps_EndScanID
                                             FOREIGN KEY (EndScanID) REFERENCES QrScans(ID),
                                         CONSTRAINT FK_QualityControlSteps_CreatedByUserID
                                             FOREIGN KEY (CreatedByUserID) REFERENCES ScannBenutzer(ID),
                                         CONSTRAINT FK_QualityControlSteps_CompletedByUserID
                                             FOREIGN KEY (CompletedByUserID) REFERENCES ScannBenutzer(ID),

    -- Business Logic Constraints
                                         CONSTRAINT CK_QualityControlSteps_QrCode
                                             CHECK (LEN(TRIM(QrCode)) > 0),
                                         CONSTRAINT CK_QualityControlSteps_QCStatus
                                             CHECK (QCStatus IN ('active', 'completed', 'aborted')),
                                         CONSTRAINT CK_QualityControlSteps_Priority
                                             CHECK (Priority BETWEEN 1 AND 3),
                                         CONSTRAINT CK_QualityControlSteps_QualityRating
                                             CHECK (QualityRating IS NULL OR QualityRating BETWEEN 1 AND 5),
                                         CONSTRAINT CK_QualityControlSteps_Times
                                             CHECK (EndTime IS NULL OR EndTime >= StartTime),
                                         CONSTRAINT CK_QualityControlSteps_Completion
                                             CHECK ((Completed = 0 AND EndTime IS NULL AND EndScanID IS NULL) OR
                                                    (Completed = 1 AND EndTime IS NOT NULL AND EndScanID IS NOT NULL))
);

-- Indizes für Performance
CREATE INDEX IX_QualityControlSteps_SessionID ON QualityControlSteps(SessionID);
CREATE INDEX IX_QualityControlSteps_QrCode ON QualityControlSteps(QrCode);
CREATE INDEX IX_QualityControlSteps_QCStatus ON QualityControlSteps(QCStatus);
CREATE INDEX IX_QualityControlSteps_Completed ON QualityControlSteps(Completed);
CREATE INDEX IX_QualityControlSteps_StartTime ON QualityControlSteps(StartTime);
CREATE INDEX IX_QualityControlSteps_Priority ON QualityControlSteps(Priority);

-- Composite Index für häufige Abfragen
CREATE INDEX IX_QualityControlSteps_Session_Status ON QualityControlSteps(SessionID, QCStatus, Completed);
CREATE INDEX IX_QualityControlSteps_QrCode_Status ON QualityControlSteps(QrCode, QCStatus);
CREATE INDEX IX_QualityControlSteps_Active_Sessions ON QualityControlSteps(SessionID, StartTime)
    WHERE QCStatus = 'active' AND Completed = 0;

PRINT '✅ Tabelle QualityControlSteps erstellt';
END
ELSE
BEGIN
    PRINT '⚠️ Tabelle QualityControlSteps existiert bereits';
END
GO

-- ===== QC-WORKFLOW TRIGGER =====

-- Trigger für automatische UpdatedTS Aktualisierung
IF NOT EXISTS (SELECT * FROM sys.triggers WHERE name = 'TR_QualityControlSteps_UpdatedTS')
BEGIN
EXEC('
    CREATE TRIGGER TR_QualityControlSteps_UpdatedTS
    ON QualityControlSteps
    AFTER UPDATE
    AS
    BEGIN
        SET NOCOUNT ON;

        UPDATE qcs
        SET UpdatedTS = GETDATE()
        FROM QualityControlSteps qcs
        INNER JOIN inserted i ON qcs.ID = i.ID;
    END
    ');

    PRINT '✅ Trigger TR_QualityControlSteps_UpdatedTS erstellt';
END
GO

-- ===== QC-HILFSTABELLEN =====

-- QC-Stationen für verschiedene Bearbeitungsplätze
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'QCStations')
BEGIN
CREATE TABLE dbo.QCStations (
                                ID INT IDENTITY(1,1) PRIMARY KEY,
                                StationName NVARCHAR(100) NOT NULL UNIQUE,
                                StationDescription NVARCHAR(500) NULL,
                                Location NVARCHAR(100) NULL,
                                Active BIT NOT NULL DEFAULT 1,
                                MaxConcurrentQC INT NOT NULL DEFAULT 5,
                                AverageProcessingMinutes INT NULL,
                                CreatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),

                                CONSTRAINT CK_QCStations_StationName
                                    CHECK (LEN(TRIM(StationName)) > 0),
                                CONSTRAINT CK_QCStations_MaxConcurrent
                                    CHECK (MaxConcurrentQC > 0)
);

CREATE INDEX IX_QCStations_Active ON QCStations(Active);
CREATE INDEX IX_QCStations_Location ON QCStations(Location);

PRINT '✅ Tabelle QCStations erstellt';
END
GO

-- QC-Kategorien für verschiedene Produkttypen
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'QCCategories')
BEGIN
CREATE TABLE dbo.QCCategories (
                                  ID INT IDENTITY(1,1) PRIMARY KEY,
                                  CategoryName NVARCHAR(100) NOT NULL UNIQUE,
                                  CategoryDescription NVARCHAR(500) NULL,
                                  EstimatedMinutes INT NOT NULL DEFAULT 15,
                                  RequiresPhotos BIT NOT NULL DEFAULT 0,
                                  RequiresNotes BIT NOT NULL DEFAULT 0,
                                  AutoCompleteAfterMinutes INT NULL,
                                  Active BIT NOT NULL DEFAULT 1,
                                  CreatedTS DATETIME2 NOT NULL DEFAULT GETDATE(),

                                  CONSTRAINT CK_QCCategories_CategoryName
                                      CHECK (LEN(TRIM(CategoryName)) > 0),
                                  CONSTRAINT CK_QCCategories_EstimatedMinutes
                                      CHECK (EstimatedMinutes > 0)
);

CREATE INDEX IX_QCCategories_Active ON QCCategories(Active);

PRINT '✅ Tabelle QCCategories erstellt';
END
GO

-- ===== ERWEITERTE QC-FUNKTIONEN =====

-- View für aktive QC-Schritte mit Benutzerinformationen
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'VW_ActiveQualityControlSteps')
BEGIN
EXEC('
    CREATE VIEW VW_ActiveQualityControlSteps AS
    SELECT
        qcs.ID,
        qcs.SessionID,
        qcs.QrCode,
        qcs.StartTime,
        qcs.Priority,
        qcs.EstimatedDurationMinutes,
        qcs.ActualDurationSeconds,
        qcs.ProcessingLocation,
        qcs.QualityNotes,

        -- Session-Informationen
        s.UserID,
        s.StartTS as SessionStartTime,

        -- Benutzer-Informationen
        u.BenutzerName as UserName,
        u.Abteilung as Department,

        -- Start-Scan Informationen
        qs_start.CapturedTS as StartScanTime,
        qs_start.JsonPayload as StartScanData,

        -- Berechnete Felder
        DATEDIFF(MINUTE, qcs.StartTime, GETDATE()) as MinutesInProgress,
        CASE
            WHEN qcs.EstimatedDurationMinutes IS NOT NULL AND
                 DATEDIFF(MINUTE, qcs.StartTime, GETDATE()) > qcs.EstimatedDurationMinutes
            THEN 1
            ELSE 0
        END as IsOverdue,

        CASE qcs.Priority
            WHEN 1 THEN ''Normal''
            WHEN 2 THEN ''Hoch''
            WHEN 3 THEN ''Kritisch''
            ELSE ''Unbekannt''
        END as PriorityText

    FROM QualityControlSteps qcs
    INNER JOIN Sessions s ON qcs.SessionID = s.ID
    INNER JOIN ScannBenutzer u ON s.UserID = u.ID
    LEFT JOIN QrScans qs_start ON qcs.StartScanID = qs_start.ID
    WHERE qcs.QCStatus = ''active'' AND qcs.Completed = 0
    ');

    PRINT '✅ View VW_ActiveQualityControlSteps erstellt';
END
GO

-- ===== STORED PROCEDURES FÜR QC-WORKFLOW =====

-- Stored Procedure: QC-Schritt starten (erster Scan)
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'SP_StartQualityControlStep')
BEGIN
EXEC('
    CREATE PROCEDURE SP_StartQualityControlStep
        @SessionID INT,
        @QrCode NVARCHAR(500),
        @StartScanID INT,
        @Priority TINYINT = 1,
        @EstimatedMinutes INT = NULL,
        @ProcessingLocation NVARCHAR(100) = NULL,
        @CreatedByUserID INT = NULL,
        @QualityControlStepID INT OUTPUT
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @ErrorMessage NVARCHAR(500);

        -- Validierung
        IF NOT EXISTS (SELECT 1 FROM Sessions WHERE ID = @SessionID AND Active = 1)
        BEGIN
            SET @ErrorMessage = ''Session nicht gefunden oder nicht aktiv'';
            THROW 50001, @ErrorMessage, 1;
        END

        IF @Priority NOT BETWEEN 1 AND 3
        BEGIN
            SET @ErrorMessage = ''Ungültige Priorität. Muss zwischen 1 und 3 liegen'';
            THROW 50002, @ErrorMessage, 1;
        END

        -- Prüfe ob bereits ein aktiver QC-Schritt für diesen QR-Code existiert
        IF EXISTS (
            SELECT 1 FROM QualityControlSteps
            WHERE QrCode = @QrCode AND QCStatus = ''active'' AND Completed = 0
        )
        BEGIN
            SET @ErrorMessage = ''QC-Schritt für diesen QR-Code bereits aktiv'';
            THROW 50003, @ErrorMessage, 1;
        END

        -- QC-Schritt erstellen
        INSERT INTO QualityControlSteps (
            SessionID, QrCode, StartScanID, Priority,
            EstimatedDurationMinutes, ProcessingLocation, CreatedByUserID
        )
        VALUES (
            @SessionID, @QrCode, @StartScanID, @Priority,
            @EstimatedMinutes, @ProcessingLocation, @CreatedByUserID
        );

        SET @QualityControlStepID = SCOPE_IDENTITY();

        -- Log-Eintrag
        PRINT ''QC-Schritt gestartet: ID='' + CAST(@QualityControlStepID AS NVARCHAR(10)) +
              '', QrCode='' + @QrCode + '', Session='' + CAST(@SessionID AS NVARCHAR(10));
    END
    ');

    PRINT '✅ Stored Procedure SP_StartQualityControlStep erstellt';
END
GO

-- Stored Procedure: QC-Schritt abschließen (zweiter Scan)
IF NOT EXISTS (SELECT * FROM sys.procedures WHERE name = 'SP_CompleteQualityControlStep')
BEGIN
EXEC('
    CREATE PROCEDURE SP_CompleteQualityControlStep
        @QrCode NVARCHAR(500),
        @EndScanID INT,
        @CompletedByUserID INT = NULL,
        @QualityRating TINYINT = NULL,
        @QualityNotes NVARCHAR(1000) = NULL,
        @DefectsFound BIT = 0,
        @DefectDescription NVARCHAR(500) = NULL,
        @ReworkRequired BIT = 0,
        @QualityControlStepID INT OUTPUT,
        @SessionID INT OUTPUT
    AS
    BEGIN
        SET NOCOUNT ON;

        DECLARE @ErrorMessage NVARCHAR(500);
        DECLARE @StartTime DATETIME2;

        -- Aktiven QC-Schritt für diesen QR-Code finden
        SELECT @QualityControlStepID = ID, @SessionID = SessionID, @StartTime = StartTime
        FROM QualityControlSteps
        WHERE QrCode = @QrCode AND QCStatus = ''active'' AND Completed = 0;

        IF @QualityControlStepID IS NULL
        BEGIN
            SET @ErrorMessage = ''Kein aktiver QC-Schritt für QR-Code gefunden: '' + @QrCode;
            THROW 50004, @ErrorMessage, 1;
        END

        -- Validierung Quality Rating
        IF @QualityRating IS NOT NULL AND @QualityRating NOT BETWEEN 1 AND 5
        BEGIN
            SET @ErrorMessage = ''Ungültige Qualitätsbewertung. Muss zwischen 1 und 5 liegen'';
            THROW 50005, @ErrorMessage, 1;
        END

        -- QC-Schritt abschließen
        UPDATE QualityControlSteps
        SET
            EndScanID = @EndScanID,
            EndTime = GETDATE(),
            Completed = 1,
            QCStatus = ''completed'',
            CompletedByUserID = @CompletedByUserID,
            QualityRating = @QualityRating,
            QualityNotes = @QualityNotes,
            DefectsFound = @DefectsFound,
            DefectDescription = @DefectDescription,
            ReworkRequired = @ReworkRequired
        WHERE ID = @QualityControlStepID;

        -- Log-Eintrag mit Dauer
        DECLARE @DurationMinutes INT = DATEDIFF(MINUTE, @StartTime, GETDATE());
        PRINT ''QC-Schritt abgeschlossen: ID='' + CAST(@QualityControlStepID AS NVARCHAR(10)) +
              '', QrCode='' + @QrCode + '', Dauer='' + CAST(@DurationMinutes AS NVARCHAR(10)) + '' Min'';
    END
    ');

    PRINT '✅ Stored Procedure SP_CompleteQualityControlStep erstellt';
END
GO

-- ===== STANDARD-DATEN EINFÜGEN =====

-- Standard QC-Stationen
IF NOT EXISTS (SELECT 1 FROM QCStations WHERE StationName = 'Wareneingang')
BEGIN
INSERT INTO QCStations (StationName, StationDescription, Location, MaxConcurrentQC, AverageProcessingMinutes)
VALUES
    ('Wareneingang', 'Hauptstation für Wareneingang und Qualitätsprüfung', 'Lager-Erdgeschoss', 10, 15),
    ('Express-QC', 'Schnelle Qualitätsprüfung für Eilaufträge', 'Lager-1.OG', 5, 5),
    ('Detail-QC', 'Detaillierte Qualitätsprüfung für kritische Waren', 'QC-Labor', 3, 30),
    ('Nacharbeit', 'Station für Nacharbeiten und Korrekturen', 'Werkstatt', 5, 45);

PRINT '✅ Standard QC-Stationen eingefügt';
END
GO

-- Standard QC-Kategorien
IF NOT EXISTS (SELECT 1 FROM QCCategories WHERE CategoryName = 'Standard-Textilien')
BEGIN
INSERT INTO QCCategories (CategoryName, CategoryDescription, EstimatedMinutes, RequiresPhotos, RequiresNotes)
VALUES
    ('Standard-Textilien', 'Normale Textilprodukte (T-Shirts, Pullover, etc.)', 10, 0, 0),
    ('Premium-Textilien', 'Hochwertige Textilprodukte mit spezieller Prüfung', 20, 1, 1),
    ('Druckerzeugnisse', 'Bedruckte Artikel mit Druckqualitätsprüfung', 15, 1, 0),
    ('Stickwaren', 'Bestickte Artikel mit Stickqualitätsprüfung', 18, 1, 1),
    ('Sonderanfertigungen', 'Kundenspezifische Sonderanfertigungen', 30, 1, 1);

PRINT '✅ Standard QC-Kategorien eingefügt';
END
GO

-- ===== UTILITY FUNCTIONS =====

-- Function: Aktive QC-Schritte für Session abrufen
IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'FN_GetActiveQCStepsForSession' AND type = 'FN')
BEGIN
EXEC('
    CREATE FUNCTION FN_GetActiveQCStepsForSession(@SessionID INT)
    RETURNS INT
    AS
    BEGIN
        DECLARE @Count INT;

        SELECT @Count = COUNT(*)
        FROM QualityControlSteps
        WHERE SessionID = @SessionID AND QCStatus = ''active'' AND Completed = 0;

        RETURN ISNULL(@Count, 0);
    END
    ');

    PRINT '✅ Function FN_GetActiveQCStepsForSession erstellt';
END
GO

-- ===== QC-BERICHTSWESEN =====

-- View für QC-Statistiken
IF NOT EXISTS (SELECT * FROM sys.views WHERE name = 'VW_QualityControlStats')
BEGIN
EXEC('
    CREATE VIEW VW_QualityControlStats AS
    SELECT
        -- Allgemeine Statistiken
        COUNT(*) as TotalQCSteps,
        COUNT(CASE WHEN Completed = 1 THEN 1 END) as CompletedSteps,
        COUNT(CASE WHEN QCStatus = ''active'' THEN 1 END) as ActiveSteps,
        COUNT(CASE WHEN QCStatus = ''aborted'' THEN 1 END) as AbortedSteps,

        -- Zeitstatistiken (nur abgeschlossene)
        AVG(CASE WHEN Completed = 1 THEN ActualDurationSeconds END) as AvgDurationSeconds,
        MIN(CASE WHEN Completed = 1 THEN ActualDurationSeconds END) as MinDurationSeconds,
        MAX(CASE WHEN Completed = 1 THEN ActualDurationSeconds END) as MaxDurationSeconds,

        -- Qualitätsstatistiken
        AVG(CASE WHEN QualityRating IS NOT NULL THEN CAST(QualityRating AS FLOAT) END) as AvgQualityRating,
        COUNT(CASE WHEN DefectsFound = 1 THEN 1 END) as StepsWithDefects,
        COUNT(CASE WHEN ReworkRequired = 1 THEN 1 END) as StepsRequiringRework,

        -- Überfällige Schritte
        COUNT(CASE
            WHEN QCStatus = ''active'' AND EstimatedDurationMinutes IS NOT NULL
            AND DATEDIFF(MINUTE, StartTime, GETDATE()) > EstimatedDurationMinutes
            THEN 1
        END) as OverdueSteps,

        -- Heutige Statistiken
        COUNT(CASE WHEN CAST(CreatedTS AS DATE) = CAST(GETDATE() AS DATE) THEN 1 END) as TodaySteps,
        COUNT(CASE
            WHEN CAST(CreatedTS AS DATE) = CAST(GETDATE() AS DATE) AND Completed = 1
            THEN 1
        END) as TodayCompletedSteps

    FROM QualityControlSteps
    WHERE CreatedTS >= DATEADD(DAY, -30, GETDATE()) -- Letzte 30 Tage
    ');

    PRINT '✅ View VW_QualityControlStats erstellt';
END
GO

-- ===== ABSCHLUSS =====

PRINT '';
PRINT '🎉 ===================================================================';
PRINT '   Qualitätskontrolle-Schema erfolgreich installiert!';
PRINT '===================================================================';
PRINT '';
PRINT '📊 Erstelle Tabellen:';
PRINT '   ✅ QualityControlSteps - Haupttabelle für QC-Workflow';
PRINT '   ✅ QCStations - QC-Stationen/Arbeitsplätze';
PRINT '   ✅ QCCategories - QC-Kategorien für Produkttypen';
PRINT '';
PRINT '🔧 Erstelle Funktionen:';
PRINT '   ✅ SP_StartQualityControlStep - QC-Schritt starten';
PRINT '   ✅ SP_CompleteQualityControlStep - QC-Schritt abschließen';
PRINT '   ✅ VW_ActiveQualityControlSteps - Aktive QC-Schritte anzeigen';
PRINT '   ✅ VW_QualityControlStats - QC-Statistiken';
PRINT '';
PRINT '🚀 QC-Workflow bereit:';
PRINT '   1. Erster QR-Scan → QC-Schritt startet (Eingang)';
PRINT '   2. Zweiter QR-Scan → QC-Schritt abgeschlossen (Ausgang)';
PRINT '   3. Automatischer Session-Reset nach Abschluss';
PRINT '   4. Parallele QC-Schritte für mehrere Mitarbeiter';
PRINT '';
PRINT '📝 Standard-Daten eingefügt:';
PRINT '   ✅ 4 QC-Stationen (Wareneingang, Express-QC, Detail-QC, Nacharbeit)';
PRINT '   ✅ 5 QC-Kategorien (Standard-Textilien bis Sonderanfertigungen)';
PRINT '';

-- Finale Validierung
DECLARE @TablesCreated INT = 0;
DECLARE @ProceduresCreated INT = 0;
DECLARE @ViewsCreated INT = 0;

SELECT @TablesCreated = COUNT(*)
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME IN ('QualityControlSteps', 'QCStations', 'QCCategories');

SELECT @ProceduresCreated = COUNT(*)
FROM sys.procedures
WHERE name IN ('SP_StartQualityControlStep', 'SP_CompleteQualityControlStep');

SELECT @ViewsCreated = COUNT(*)
FROM sys.views
WHERE name IN ('VW_ActiveQualityControlSteps', 'VW_QualityControlStats');

PRINT '🔍 Validierung:';
PRINT '   📋 Tabellen: ' + CAST(@TablesCreated AS NVARCHAR(2)) + '/3';
PRINT '   ⚙️ Procedures: ' + CAST(@ProceduresCreated AS NVARCHAR(2)) + '/2';
PRINT '   👁️ Views: ' + CAST(@ViewsCreated AS NVARCHAR(2)) + '/2';

IF @TablesCreated = 3 AND @ProceduresCreated = 2 AND @ViewsCreated = 2
BEGIN
    PRINT '';
    PRINT '✅ Alle Komponenten erfolgreich erstellt!';
    PRINT '🎯 Qualitätskontrolle-System ist einsatzbereit.';
END
ELSE
BEGIN
    PRINT '';
    PRINT '⚠️ Nicht alle Komponenten konnten erstellt werden.';
    PRINT '💡 Überprüfen Sie die Berechtigungen und führen Sie das Script erneut aus.';
END

PRINT '';
PRINT '===================================================================🎉';
GO
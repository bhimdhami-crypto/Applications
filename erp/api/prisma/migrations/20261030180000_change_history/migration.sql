BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[AuditLog] ADD [companyId] INT,
[label] NVARCHAR(100);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_companyId_at_idx] ON [dbo].[AuditLog]([companyId], [at]);

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

-- The audit log is append-only. Only a test database (its name ends in _test) may clear it, so the
-- automated tests can start clean; anywhere else an update or delete is refused and rolled back.
EXEC('CREATE TRIGGER [dbo].[AuditLog_append_only] ON [dbo].[AuditLog] AFTER UPDATE, DELETE AS
BEGIN
    SET NOCOUNT ON;
    IF DB_NAME() NOT LIKE ''%[_]test''
        THROW 51000, ''The audit log is append-only: entries cannot be changed or deleted'', 1;
END');

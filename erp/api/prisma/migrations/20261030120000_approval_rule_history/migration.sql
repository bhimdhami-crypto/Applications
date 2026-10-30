BEGIN TRY
BEGIN TRAN;
-- AlterTable
ALTER TABLE [dbo].[ApprovalRule] ADD [createdAt] DATETIME2 NOT NULL CONSTRAINT [ApprovalRule_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
[createdById] INT,
[retiredAt] DATETIME2,
[retiredById] INT;
-- AddForeignKey
ALTER TABLE [dbo].[ApprovalRule] ADD CONSTRAINT [ApprovalRule_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE [dbo].[ApprovalRule] ADD CONSTRAINT [ApprovalRule_retiredById_fkey] FOREIGN KEY ([retiredById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW
END CATCH

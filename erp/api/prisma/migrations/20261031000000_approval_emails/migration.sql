BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[User] ADD [emailAlerts] BIT NOT NULL CONSTRAINT [User_emailAlerts_df] DEFAULT 1;

-- CreateTable
CREATE TABLE [dbo].[EmailMessage] (
    [id] INT NOT NULL IDENTITY(1,1),
    [kind] NVARCHAR(30) NOT NULL,
    [userId] INT,
    [toEmail] NVARCHAR(200) NOT NULL,
    [subject] NVARCHAR(300) NOT NULL,
    [text] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    [voucherId] INT,
    [status] NVARCHAR(10) NOT NULL CONSTRAINT [EmailMessage_status_df] DEFAULT 'PENDING',
    [attempts] INT NOT NULL CONSTRAINT [EmailMessage_attempts_df] DEFAULT 0,
    [nextAttemptAt] DATETIME2 NOT NULL CONSTRAINT [EmailMessage_nextAttemptAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastError] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EmailMessage_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [sentAt] DATETIME2,
    CONSTRAINT [EmailMessage_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmailMessage_status_nextAttemptAt_idx] ON [dbo].[EmailMessage]([status], [nextAttemptAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmailMessage_userId_kind_createdAt_idx] ON [dbo].[EmailMessage]([userId], [kind], [createdAt]);

-- AddForeignKey
ALTER TABLE [dbo].[EmailMessage] ADD CONSTRAINT [EmailMessage_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[EmailMessage] ADD CONSTRAINT [EmailMessage_voucherId_fkey] FOREIGN KEY ([voucherId]) REFERENCES [dbo].[Voucher]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH


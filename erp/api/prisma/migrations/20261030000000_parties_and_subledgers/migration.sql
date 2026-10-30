BEGIN TRY
BEGIN TRAN;
-- AlterTable
ALTER TABLE [dbo].[GlAccount] ADD [subledger] NVARCHAR(2);
-- AlterTable
ALTER TABLE [dbo].[LedgerEntry] ADD [dueDate] DATE,
[partyId] INT;
-- AlterTable
ALTER TABLE [dbo].[VoucherLine] ADD [dueDate] DATE,
[partyId] INT;
-- CreateTable
CREATE TABLE [dbo].[Party] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [kind] NVARCHAR(10) NOT NULL,
    [code] NVARCHAR(50) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [currencyCode] CHAR(3),
    [termsDays] INT NOT NULL CONSTRAINT [Party_termsDays_df] DEFAULT 30,
    [creditLimit] DECIMAL(19,4),
    [taxNumber] NVARCHAR(50),
    [email] NVARCHAR(200),
    [phone] NVARCHAR(50),
    [isActive] BIT NOT NULL CONSTRAINT [Party_isActive_df] DEFAULT 1,
    [sourceLinkId] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Party_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Party_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Party_companyId_kind_code_key] UNIQUE NONCLUSTERED ([companyId],[kind],[code])
);
-- CreateIndex
CREATE NONCLUSTERED INDEX [Party_companyId_kind_sourceLinkId_idx] ON [dbo].[Party]([companyId], [kind], [sourceLinkId]);
-- CreateIndex
CREATE NONCLUSTERED INDEX [LedgerEntry_partyId_txDate_idx] ON [dbo].[LedgerEntry]([partyId], [txDate]);
-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_partyId_fkey] FOREIGN KEY ([partyId]) REFERENCES [dbo].[Party]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE [dbo].[VoucherLine] ADD CONSTRAINT [VoucherLine_partyId_fkey] FOREIGN KEY ([partyId]) REFERENCES [dbo].[Party]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE [dbo].[Party] ADD CONSTRAINT [Party_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE [dbo].[Party] ADD CONSTRAINT [Party_currencyCode_fkey] FOREIGN KEY ([currencyCode]) REFERENCES [dbo].[Currency]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW
END CATCH

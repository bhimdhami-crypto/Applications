BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[BankAccount] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [glAccountId] INT NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [bankName] NVARCHAR(100),
    [accountNumber] NVARCHAR(50),
    [currencyCode] CHAR(3) NOT NULL,
    [reconcileFrom] DATE NOT NULL,
    [csvLayout] NVARCHAR(max),
    [isActive] BIT NOT NULL CONSTRAINT [BankAccount_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BankAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BankAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BankAccount_glAccountId_key] UNIQUE NONCLUSTERED ([glAccountId]),
    CONSTRAINT [BankAccount_companyId_name_key] UNIQUE NONCLUSTERED ([companyId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[BankStatement] (
    [id] INT NOT NULL IDENTITY(1,1),
    [bankAccountId] INT NOT NULL,
    [fileName] NVARCHAR(260) NOT NULL,
    [sha256] CHAR(64) NOT NULL,
    [storageKey] NVARCHAR(400) NOT NULL,
    [fromDate] DATE NOT NULL,
    [toDate] DATE NOT NULL,
    [lineCount] INT NOT NULL,
    [skipped] INT NOT NULL,
    [importedById] INT NOT NULL,
    [importedAt] DATETIME2 NOT NULL CONSTRAINT [BankStatement_importedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BankStatement_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BankStatement_bankAccountId_sha256_key] UNIQUE NONCLUSTERED ([bankAccountId],[sha256])
);

-- CreateTable
CREATE TABLE [dbo].[BankStatementLine] (
    [id] INT NOT NULL IDENTITY(1,1),
    [statementId] INT NOT NULL,
    [bankAccountId] INT NOT NULL,
    [lineNo] INT NOT NULL,
    [txDate] DATE NOT NULL,
    [description] NVARCHAR(400) NOT NULL,
    [reference] NVARCHAR(100),
    [amount] DECIMAL(19,4) NOT NULL,
    [balance] DECIMAL(19,4),
    [fingerprint] CHAR(64) NOT NULL,
    [matchId] INT,
    CONSTRAINT [BankStatementLine_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BankStatementLine_bankAccountId_fingerprint_key] UNIQUE NONCLUSTERED ([bankAccountId],[fingerprint])
);

-- CreateTable
CREATE TABLE [dbo].[BankMatch] (
    [id] INT NOT NULL IDENTITY(1,1),
    [bankAccountId] INT NOT NULL,
    [method] NVARCHAR(10) NOT NULL,
    [matchedById] INT NOT NULL,
    [matchedAt] DATETIME2 NOT NULL CONSTRAINT [BankMatch_matchedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [BankMatch_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BankMatchEntry] (
    [id] INT NOT NULL IDENTITY(1,1),
    [matchId] INT NOT NULL,
    [ledgerEntryId] BIGINT NOT NULL,
    CONSTRAINT [BankMatchEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BankMatchEntry_ledgerEntryId_key] UNIQUE NONCLUSTERED ([ledgerEntryId])
);

-- CreateTable
CREATE TABLE [dbo].[BankReconciliation] (
    [id] INT NOT NULL IDENTITY(1,1),
    [bankAccountId] INT NOT NULL,
    [asAt] DATE NOT NULL,
    [statementBalance] DECIMAL(19,4) NOT NULL,
    [depositsInTransit] DECIMAL(19,4) NOT NULL,
    [unpresentedPayments] DECIMAL(19,4) NOT NULL,
    [bankMoneyIn] DECIMAL(19,4) NOT NULL,
    [bankMoneyOut] DECIMAL(19,4) NOT NULL,
    [ledgerBalance] DECIMAL(19,4) NOT NULL,
    [difference] DECIMAL(19,4) NOT NULL,
    [note] NVARCHAR(1000),
    [preparedById] INT NOT NULL,
    [preparedAt] DATETIME2 NOT NULL CONSTRAINT [BankReconciliation_preparedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [reviewedById] INT,
    [reviewedAt] DATETIME2,
    CONSTRAINT [BankReconciliation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BankReconciliation_bankAccountId_asAt_key] UNIQUE NONCLUSTERED ([bankAccountId],[asAt])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BankStatementLine_bankAccountId_txDate_idx] ON [dbo].[BankStatementLine]([bankAccountId], [txDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BankStatementLine_matchId_idx] ON [dbo].[BankStatementLine]([matchId]);

-- AddForeignKey
ALTER TABLE [dbo].[BankAccount] ADD CONSTRAINT [BankAccount_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BankAccount] ADD CONSTRAINT [BankAccount_glAccountId_fkey] FOREIGN KEY ([glAccountId]) REFERENCES [dbo].[GlAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankAccount] ADD CONSTRAINT [BankAccount_currencyCode_fkey] FOREIGN KEY ([currencyCode]) REFERENCES [dbo].[Currency]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankStatement] ADD CONSTRAINT [BankStatement_bankAccountId_fkey] FOREIGN KEY ([bankAccountId]) REFERENCES [dbo].[BankAccount]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BankStatement] ADD CONSTRAINT [BankStatement_importedById_fkey] FOREIGN KEY ([importedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankStatementLine] ADD CONSTRAINT [BankStatementLine_statementId_fkey] FOREIGN KEY ([statementId]) REFERENCES [dbo].[BankStatement]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BankStatementLine] ADD CONSTRAINT [BankStatementLine_bankAccountId_fkey] FOREIGN KEY ([bankAccountId]) REFERENCES [dbo].[BankAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankStatementLine] ADD CONSTRAINT [BankStatementLine_matchId_fkey] FOREIGN KEY ([matchId]) REFERENCES [dbo].[BankMatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankMatch] ADD CONSTRAINT [BankMatch_bankAccountId_fkey] FOREIGN KEY ([bankAccountId]) REFERENCES [dbo].[BankAccount]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BankMatch] ADD CONSTRAINT [BankMatch_matchedById_fkey] FOREIGN KEY ([matchedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankMatchEntry] ADD CONSTRAINT [BankMatchEntry_matchId_fkey] FOREIGN KEY ([matchId]) REFERENCES [dbo].[BankMatch]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BankMatchEntry] ADD CONSTRAINT [BankMatchEntry_ledgerEntryId_fkey] FOREIGN KEY ([ledgerEntryId]) REFERENCES [dbo].[LedgerEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankReconciliation] ADD CONSTRAINT [BankReconciliation_bankAccountId_fkey] FOREIGN KEY ([bankAccountId]) REFERENCES [dbo].[BankAccount]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[BankReconciliation] ADD CONSTRAINT [BankReconciliation_preparedById_fkey] FOREIGN KEY ([preparedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BankReconciliation] ADD CONSTRAINT [BankReconciliation_reviewedById_fkey] FOREIGN KEY ([reviewedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH


BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[Company] (
    [id] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(20) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [homeCurrency] CHAR(3) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [Company_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Company_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Company_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Company_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] INT NOT NULL IDENTITY(1,1),
    [email] NVARCHAR(200) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [passwordHash] NVARCHAR(100) NOT NULL,
    [role] NVARCHAR(20) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [User_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Currency] (
    [code] CHAR(3) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [decimals] INT NOT NULL CONSTRAINT [Currency_decimals_df] DEFAULT 2,
    CONSTRAINT [Currency_pkey] PRIMARY KEY CLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[ExchangeRate] (
    [id] INT NOT NULL IDENTITY(1,1),
    [currencyCode] CHAR(3) NOT NULL,
    [rateDate] DATE NOT NULL,
    [rate] DECIMAL(19,6) NOT NULL,
    CONSTRAINT [ExchangeRate_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ExchangeRate_currencyCode_rateDate_key] UNIQUE NONCLUSTERED ([currencyCode],[rateDate])
);

-- CreateTable
CREATE TABLE [dbo].[FiscalPeriod] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [year] INT NOT NULL,
    [number] INT NOT NULL,
    [startDate] DATE NOT NULL,
    [endDate] DATE NOT NULL,
    [isClosed] BIT NOT NULL CONSTRAINT [FiscalPeriod_isClosed_df] DEFAULT 0,
    CONSTRAINT [FiscalPeriod_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FiscalPeriod_companyId_year_number_key] UNIQUE NONCLUSTERED ([companyId],[year],[number])
);

-- CreateTable
CREATE TABLE [dbo].[TaxCode] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [code] NVARCHAR(20) NOT NULL,
    [description] NVARCHAR(200) NOT NULL,
    [rate] DECIMAL(9,4) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [TaxCode_isActive_df] DEFAULT 1,
    CONSTRAINT [TaxCode_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TaxCode_companyId_code_key] UNIQUE NONCLUSTERED ([companyId],[code])
);

-- CreateTable
CREATE TABLE [dbo].[Project] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [code] NVARCHAR(30) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [Project_isActive_df] DEFAULT 1,
    CONSTRAINT [Project_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Project_companyId_code_key] UNIQUE NONCLUSTERED ([companyId],[code])
);

-- CreateTable
CREATE TABLE [dbo].[GlAccount] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [code] NVARCHAR(50) NOT NULL,
    [description] NVARCHAR(200) NOT NULL,
    [type] NVARCHAR(20) NOT NULL,
    [parentId] INT,
    [isPostable] BIT NOT NULL CONSTRAINT [GlAccount_isPostable_df] DEFAULT 1,
    [isActive] BIT NOT NULL CONSTRAINT [GlAccount_isActive_df] DEFAULT 1,
    [costCentre] NVARCHAR(50),
    [sector] NVARCHAR(50),
    [reportGroup] NVARCHAR(100),
    [sourceLinkId] INT,
    CONSTRAINT [GlAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [GlAccount_companyId_code_key] UNIQUE NONCLUSTERED ([companyId],[code])
);

-- CreateTable
CREATE TABLE [dbo].[PostingBatch] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [auditNo] NVARCHAR(20) NOT NULL,
    [source] NVARCHAR(10) NOT NULL,
    [documentType] NVARCHAR(20) NOT NULL,
    [reference] NVARCHAR(50),
    [description] NVARCHAR(400) NOT NULL,
    [txDate] DATE NOT NULL,
    [periodId] INT NOT NULL,
    [postedById] INT NOT NULL,
    [postedAt] DATETIME2 NOT NULL CONSTRAINT [PostingBatch_postedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [reversesId] INT,
    CONSTRAINT [PostingBatch_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PostingBatch_companyId_auditNo_key] UNIQUE NONCLUSTERED ([companyId],[auditNo])
);

-- CreateTable
CREATE TABLE [dbo].[LedgerEntry] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [batchId] INT NOT NULL,
    [companyId] INT NOT NULL,
    [lineNo] INT NOT NULL,
    [accountId] INT NOT NULL,
    [txDate] DATE NOT NULL,
    [periodId] INT NOT NULL,
    [debit] DECIMAL(19,4) NOT NULL CONSTRAINT [LedgerEntry_debit_df] DEFAULT 0,
    [credit] DECIMAL(19,4) NOT NULL CONSTRAINT [LedgerEntry_credit_df] DEFAULT 0,
    [currencyCode] CHAR(3) NOT NULL,
    [exchangeRate] DECIMAL(19,6) NOT NULL CONSTRAINT [LedgerEntry_exchangeRate_df] DEFAULT 1,
    [foreignDebit] DECIMAL(19,4) NOT NULL CONSTRAINT [LedgerEntry_foreignDebit_df] DEFAULT 0,
    [foreignCredit] DECIMAL(19,4) NOT NULL CONSTRAINT [LedgerEntry_foreignCredit_df] DEFAULT 0,
    [description] NVARCHAR(400),
    [projectId] INT,
    [taxCodeId] INT,
    CONSTRAINT [LedgerEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [LedgerEntry_batchId_lineNo_key] UNIQUE NONCLUSTERED ([batchId],[lineNo])
);

-- CreateTable
CREATE TABLE [dbo].[NumberSequence] (
    [companyId] INT NOT NULL,
    [name] NVARCHAR(20) NOT NULL,
    [prefix] NVARCHAR(10) NOT NULL,
    [next] INT NOT NULL CONSTRAINT [NumberSequence_next_df] DEFAULT 1,
    CONSTRAINT [NumberSequence_pkey] PRIMARY KEY CLUSTERED ([companyId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [userId] INT,
    [action] NVARCHAR(50) NOT NULL,
    [entity] NVARCHAR(50) NOT NULL,
    [entityId] NVARCHAR(50),
    [detail] NVARCHAR(max),
    [at] DATETIME2 NOT NULL CONSTRAINT [AuditLog_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [FiscalPeriod_companyId_startDate_idx] ON [dbo].[FiscalPeriod]([companyId], [startDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GlAccount_companyId_sourceLinkId_idx] ON [dbo].[GlAccount]([companyId], [sourceLinkId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PostingBatch_companyId_txDate_idx] ON [dbo].[PostingBatch]([companyId], [txDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LedgerEntry_companyId_accountId_txDate_idx] ON [dbo].[LedgerEntry]([companyId], [accountId], [txDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LedgerEntry_companyId_periodId_idx] ON [dbo].[LedgerEntry]([companyId], [periodId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_entity_entityId_idx] ON [dbo].[AuditLog]([entity], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_at_idx] ON [dbo].[AuditLog]([at]);

-- AddForeignKey
ALTER TABLE [dbo].[Company] ADD CONSTRAINT [Company_homeCurrency_fkey] FOREIGN KEY ([homeCurrency]) REFERENCES [dbo].[Currency]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExchangeRate] ADD CONSTRAINT [ExchangeRate_currencyCode_fkey] FOREIGN KEY ([currencyCode]) REFERENCES [dbo].[Currency]([code]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[FiscalPeriod] ADD CONSTRAINT [FiscalPeriod_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[TaxCode] ADD CONSTRAINT [TaxCode_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Project] ADD CONSTRAINT [Project_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[GlAccount] ADD CONSTRAINT [GlAccount_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[GlAccount] ADD CONSTRAINT [GlAccount_parentId_fkey] FOREIGN KEY ([parentId]) REFERENCES [dbo].[GlAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PostingBatch] ADD CONSTRAINT [PostingBatch_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PostingBatch] ADD CONSTRAINT [PostingBatch_periodId_fkey] FOREIGN KEY ([periodId]) REFERENCES [dbo].[FiscalPeriod]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PostingBatch] ADD CONSTRAINT [PostingBatch_postedById_fkey] FOREIGN KEY ([postedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PostingBatch] ADD CONSTRAINT [PostingBatch_reversesId_fkey] FOREIGN KEY ([reversesId]) REFERENCES [dbo].[PostingBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_batchId_fkey] FOREIGN KEY ([batchId]) REFERENCES [dbo].[PostingBatch]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[GlAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_periodId_fkey] FOREIGN KEY ([periodId]) REFERENCES [dbo].[FiscalPeriod]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_currencyCode_fkey] FOREIGN KEY ([currencyCode]) REFERENCES [dbo].[Currency]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_projectId_fkey] FOREIGN KEY ([projectId]) REFERENCES [dbo].[Project]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_taxCodeId_fkey] FOREIGN KEY ([taxCodeId]) REFERENCES [dbo].[TaxCode]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NumberSequence] ADD CONSTRAINT [NumberSequence_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[AuditLog] ADD CONSTRAINT [AuditLog_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- A batch can be reversed once. Filtered index because a SQL Server UNIQUE constraint allows only one NULL (added by hand)
CREATE UNIQUE NONCLUSTERED INDEX [PostingBatch_reversesId_key] ON [dbo].[PostingBatch]([reversesId]) WHERE [reversesId] IS NOT NULL;

-- Ledger rows hold one side only, never negative (added by hand: Prisma cannot express CHECK constraints)
ALTER TABLE [dbo].[LedgerEntry] ADD CONSTRAINT [LedgerEntry_one_side_ck] CHECK (
    [debit] >= 0 AND [credit] >= 0 AND [foreignDebit] >= 0 AND [foreignCredit] >= 0
    AND ([debit] = 0 OR [credit] = 0) AND [exchangeRate] > 0
);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH


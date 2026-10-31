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
    [intercompanyOfId] INT,
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

-- CreateTable
CREATE TABLE [dbo].[Voucher] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [voucherNo] NVARCHAR(20) NOT NULL,
    [documentType] NVARCHAR(20) NOT NULL,
    [status] NVARCHAR(20) NOT NULL,
    [txDate] DATE NOT NULL,
    [description] NVARCHAR(400) NOT NULL,
    [reference] NVARCHAR(50),
    [totalAmount] DECIMAL(19,4),
    [ruleId] INT,
    [currentStage] INT,
    [createdById] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Voucher_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [submittedAt] DATETIME2,
    [reversesBatchId] INT,
    [postedBatchId] INT,
    CONSTRAINT [Voucher_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Voucher_companyId_voucherNo_key] UNIQUE NONCLUSTERED ([companyId],[voucherNo])
);

-- CreateTable
CREATE TABLE [dbo].[VoucherLine] (
    [id] INT NOT NULL IDENTITY(1,1),
    [voucherId] INT NOT NULL,
    [lineNo] INT NOT NULL,
    [accountId] INT NOT NULL,
    [debit] DECIMAL(19,4),
    [credit] DECIMAL(19,4),
    [currencyCode] CHAR(3),
    [exchangeRate] DECIMAL(19,6),
    [foreignAmount] DECIMAL(19,4),
    [description] NVARCHAR(400),
    [projectId] INT,
    [taxCodeId] INT,
    [partnerCompanyId] INT,
    [partnerAccountId] INT,
    CONSTRAINT [VoucherLine_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [VoucherLine_voucherId_lineNo_key] UNIQUE NONCLUSTERED ([voucherId],[lineNo])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalRule] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [documentType] NVARCHAR(20) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [sopReference] NVARCHAR(50),
    [minAmount] DECIMAL(19,4) NOT NULL CONSTRAINT [ApprovalRule_minAmount_df] DEFAULT 0,
    [maxAmount] DECIMAL(19,4),
    [isActive] BIT NOT NULL CONSTRAINT [ApprovalRule_isActive_df] DEFAULT 1,
    CONSTRAINT [ApprovalRule_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalRuleStage] (
    [id] INT NOT NULL IDENTITY(1,1),
    [ruleId] INT NOT NULL,
    [stageNo] INT NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [approverRole] NVARCHAR(20) NOT NULL,
    CONSTRAINT [ApprovalRuleStage_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ApprovalRuleStage_ruleId_stageNo_key] UNIQUE NONCLUSTERED ([ruleId],[stageNo])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalAction] (
    [id] INT NOT NULL IDENTITY(1,1),
    [voucherId] INT NOT NULL,
    [stageNo] INT,
    [action] NVARCHAR(20) NOT NULL,
    [userId] INT NOT NULL,
    [comment] NVARCHAR(1000),
    [at] DATETIME2 NOT NULL CONSTRAINT [ApprovalAction_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ApprovalAction_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[IntercompanyLink] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [partnerCompanyId] INT NOT NULL,
    [accountId] INT NOT NULL,
    CONSTRAINT [IntercompanyLink_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [IntercompanyLink_companyId_partnerCompanyId_key] UNIQUE NONCLUSTERED ([companyId],[partnerCompanyId])
);

-- CreateTable
CREATE TABLE [dbo].[Attachment] (
    [id] INT NOT NULL IDENTITY(1,1),
    [companyId] INT NOT NULL,
    [entityType] NVARCHAR(20) NOT NULL,
    [entityId] INT NOT NULL,
    [fileName] NVARCHAR(260) NOT NULL,
    [contentType] NVARCHAR(100) NOT NULL,
    [size] INT NOT NULL,
    [sha256] CHAR(64) NOT NULL,
    [storageKey] NVARCHAR(400) NOT NULL,
    [description] NVARCHAR(400),
    [uploadedById] INT NOT NULL,
    [uploadedAt] DATETIME2 NOT NULL CONSTRAINT [Attachment_uploadedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Attachment_pkey] PRIMARY KEY CLUSTERED ([id])
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

-- CreateIndex
CREATE NONCLUSTERED INDEX [Voucher_companyId_status_idx] ON [dbo].[Voucher]([companyId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalRule_companyId_documentType_idx] ON [dbo].[ApprovalRule]([companyId], [documentType]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalAction_voucherId_idx] ON [dbo].[ApprovalAction]([voucherId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Attachment_companyId_entityType_entityId_idx] ON [dbo].[Attachment]([companyId], [entityType], [entityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Attachment_companyId_uploadedAt_idx] ON [dbo].[Attachment]([companyId], [uploadedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Attachment_sha256_idx] ON [dbo].[Attachment]([sha256]);

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
ALTER TABLE [dbo].[PostingBatch] ADD CONSTRAINT [PostingBatch_intercompanyOfId_fkey] FOREIGN KEY ([intercompanyOfId]) REFERENCES [dbo].[PostingBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

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

-- AddForeignKey
ALTER TABLE [dbo].[Voucher] ADD CONSTRAINT [Voucher_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Voucher] ADD CONSTRAINT [Voucher_ruleId_fkey] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[ApprovalRule]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Voucher] ADD CONSTRAINT [Voucher_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Voucher] ADD CONSTRAINT [Voucher_postedBatchId_fkey] FOREIGN KEY ([postedBatchId]) REFERENCES [dbo].[PostingBatch]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VoucherLine] ADD CONSTRAINT [VoucherLine_voucherId_fkey] FOREIGN KEY ([voucherId]) REFERENCES [dbo].[Voucher]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[VoucherLine] ADD CONSTRAINT [VoucherLine_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[GlAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VoucherLine] ADD CONSTRAINT [VoucherLine_partnerCompanyId_fkey] FOREIGN KEY ([partnerCompanyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VoucherLine] ADD CONSTRAINT [VoucherLine_partnerAccountId_fkey] FOREIGN KEY ([partnerAccountId]) REFERENCES [dbo].[GlAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalRule] ADD CONSTRAINT [ApprovalRule_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalRuleStage] ADD CONSTRAINT [ApprovalRuleStage_ruleId_fkey] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[ApprovalRule]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalAction] ADD CONSTRAINT [ApprovalAction_voucherId_fkey] FOREIGN KEY ([voucherId]) REFERENCES [dbo].[Voucher]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalAction] ADD CONSTRAINT [ApprovalAction_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[IntercompanyLink] ADD CONSTRAINT [IntercompanyLink_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[IntercompanyLink] ADD CONSTRAINT [IntercompanyLink_partnerCompanyId_fkey] FOREIGN KEY ([partnerCompanyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[IntercompanyLink] ADD CONSTRAINT [IntercompanyLink_accountId_fkey] FOREIGN KEY ([accountId]) REFERENCES [dbo].[GlAccount]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Attachment] ADD CONSTRAINT [Attachment_companyId_fkey] FOREIGN KEY ([companyId]) REFERENCES [dbo].[Company]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Attachment] ADD CONSTRAINT [Attachment_uploadedById_fkey] FOREIGN KEY ([uploadedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Filtered unique indexes: a SQL Server UNIQUE constraint allows only one NULL (added by hand).
-- A batch can be reversed once, and a voucher posts to one batch.
CREATE UNIQUE NONCLUSTERED INDEX [PostingBatch_reversesId_key] ON [dbo].[PostingBatch]([reversesId]) WHERE [reversesId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [Voucher_postedBatchId_key] ON [dbo].[Voucher]([postedBatchId]) WHERE [postedBatchId] IS NOT NULL;

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


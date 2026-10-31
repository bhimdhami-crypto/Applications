-- Before-and-after snapshot: run once, post one document in Evolution, run again, compare.
-- New rows have AutoIdx/AutoIndex above the "before" maximum. Read-only.
SELECT 'PostGL' AS table_name, COUNT_BIG(*) AS row_count, MAX(AutoIdx) AS max_id FROM dbo.PostGL
UNION ALL SELECT 'PostAR', COUNT_BIG(*), MAX(AutoIdx) FROM dbo.PostAR
UNION ALL SELECT 'PostAP', COUNT_BIG(*), MAX(AutoIdx) FROM dbo.PostAP
UNION ALL SELECT 'PostST', COUNT_BIG(*), MAX(AutoIdx) FROM dbo.PostST
UNION ALL SELECT 'InvNum', COUNT_BIG(*), MAX(AutoIndex) FROM dbo.InvNum
UNION ALL SELECT '_btblInvoiceLines', COUNT_BIG(*), MAX(idInvoiceLines) FROM dbo._btblInvoiceLines;

-- After posting: every ledger row the document wrote, tied together by audit number.
-- Replace 0 with the PostGL max_id from the "before" run.
DECLARE @before bigint = 0;
SELECT 'GL' AS ledger, g.AutoIdx, g.TxDate, g.Id, g.cAuditNumber, a.Master_Sub_Account AS account,
       g.Debit, g.Credit, g.Reference, g.Description
FROM dbo.PostGL g
LEFT JOIN dbo.Accounts a ON a.AccountLink = g.AccountLink
WHERE g.AutoIdx > @before
UNION ALL
SELECT 'AR', r.AutoIdx, r.TxDate, r.Id, r.cAuditNumber, c.Account, r.Debit, r.Credit, r.Reference, r.Description
FROM dbo.PostAR r
LEFT JOIN dbo.Client c ON c.DCLink = r.AccountLink
WHERE r.cAuditNumber IN (SELECT cAuditNumber FROM dbo.PostGL WHERE AutoIdx > @before)
UNION ALL
SELECT 'ST', s.AutoIdx, s.TxDate, s.Id, s.cAuditNumber, i.Code, s.Debit, s.Credit, s.Reference, s.Description
FROM dbo.PostST s
LEFT JOIN dbo.StkItem i ON i.StockLink = s.AccountLink
WHERE s.cAuditNumber IN (SELECT cAuditNumber FROM dbo.PostGL WHERE AutoIdx > @before)
ORDER BY cAuditNumber, ledger, AutoIdx;

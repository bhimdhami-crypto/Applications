-- Needs SQL Server 2017 or later (STRING_AGG).
-- Which iAccountType number means which kind of account in this Evolution install. Read-only.
-- Use the result to fill erp/etl/account-types.json, e.g. { "1": "ASSET", "2": "LIABILITY", ... }
-- The examples per type make it clear: bank and debtors control are assets, sales is income, and so on.
SELECT
    a.iAccountType,
    MAX(a.total) AS accounts,
    STRING_AGG(CAST(a.Master_Sub_Account + ' ' + a.Description AS nvarchar(max)), ' | ')
        WITHIN GROUP (ORDER BY a.Master_Sub_Account) AS examples
FROM (
    SELECT iAccountType, Master_Sub_Account, Description,
           ROW_NUMBER() OVER (PARTITION BY iAccountType ORDER BY Master_Sub_Account) AS rn,
           COUNT(*) OVER (PARTITION BY iAccountType) AS total
    FROM dbo.Accounts
) a
WHERE a.rn <= 5
GROUP BY a.iAccountType
ORDER BY a.iAccountType;

-- Learn how Evolution posts a document by watching the SQL it sends. Read-only for your data:
-- it only records statements. Needs ALTER ANY EVENT SESSION (sysadmin on most installs).
--
-- 1. Run part 1 (change the database name if needed).
-- 2. In Evolution, post ONE document (for example a single-line invoice) in that company.
-- 3. Run part 2 to read what Evolution did, then part 3 to remove the session.
-- Best on a test copy of the company, never during month-end.

-- Part 1: start recording statements from Evolution against MFI-DS
CREATE EVENT SESSION [evo_posting_trace] ON SERVER
ADD EVENT sqlserver.sql_batch_completed (
    ACTION (sqlserver.client_app_name, sqlserver.username)
    WHERE sqlserver.database_name = N'MFI-DS'),
ADD EVENT sqlserver.rpc_completed (
    ACTION (sqlserver.client_app_name, sqlserver.username)
    WHERE sqlserver.database_name = N'MFI-DS')
ADD TARGET package0.ring_buffer (SET max_memory = 51200)
WITH (MAX_DISPATCH_LATENCY = 2 SECONDS);
ALTER EVENT SESSION [evo_posting_trace] ON SERVER STATE = START;

-- Part 2: what was run, in order. Look for INSERTs into PostGL, PostAR, PostST, InvNum and _btblInvoiceLines
;WITH x AS (
    SELECT CAST(t.target_data AS xml) AS d
    FROM sys.dm_xe_session_targets t
    JOIN sys.dm_xe_sessions s ON s.address = t.event_session_address
    WHERE s.name = N'evo_posting_trace')
SELECT
    e.value('@timestamp', 'datetime2')                                         AS at_utc,
    e.value('@name', 'nvarchar(60)')                                           AS event,
    e.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(200)')     AS app,
    COALESCE(e.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
             e.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'))   AS sql_text
FROM x CROSS APPLY d.nodes('RingBufferTarget/event') AS n(e)
ORDER BY at_utc;

-- Part 3: stop and remove the session
ALTER EVENT SESSION [evo_posting_trace] ON SERVER STATE = STOP;
DROP EVENT SESSION [evo_posting_trace] ON SERVER;

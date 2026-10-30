-- Run in SSMS against one Evolution company database (MFI-DS, MFI-MDS or MFI-TS). Read-only.
-- Size and row count of every table, biggest first: tells us what the migration must move.
SELECT
    t.name                                   AS table_name,
    SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END) AS row_count,
    CAST(SUM(a.total_pages) * 8 / 1024.0 AS decimal(12, 1))    AS size_mb
FROM sys.tables t
JOIN sys.partitions p       ON p.object_id = t.object_id
JOIN sys.allocation_units a ON a.container_id = p.partition_id
GROUP BY t.name
ORDER BY size_mb DESC;

-- Database size against the 10 GB SQL Server Express limit
SELECT DB_NAME() AS database_name,
       CAST(SUM(size) * 8 / 1024.0 / 1024.0 AS decimal(8, 2)) AS data_gb
FROM sys.database_files
WHERE type_desc = 'ROWS';

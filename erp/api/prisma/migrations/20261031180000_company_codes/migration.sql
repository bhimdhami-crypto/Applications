BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Company] ADD [sourceDatabase] NVARCHAR(128);

-- The companies take Mindspace codes; the Evolution database each was read from is kept for the migration tool.
-- Run through EXEC because the column is new in this batch.
EXEC('UPDATE [dbo].[Company] SET [sourceDatabase] = [code], [code] = ''MS-AI'' WHERE [code] = ''MFI-DS''');
EXEC('UPDATE [dbo].[Company] SET [sourceDatabase] = [code], [code] = ''MS-TS'' WHERE [code] = ''MFI-MDS''');
EXEC('UPDATE [dbo].[Company] SET [sourceDatabase] = [code], [code] = ''MS-SI'' WHERE [code] = ''MFI-TS''');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

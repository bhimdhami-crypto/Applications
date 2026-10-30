/**
 * Files the archive accepts. The kind is recognised from the file's first bytes and must agree with its
 * extension, so a renamed executable is refused.
 */
const KINDS = [
  { ext: ['pdf'], mime: 'application/pdf', magic: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { ext: ['png'], mime: 'image/png', magic: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: ['jpg', 'jpeg'], mime: 'image/jpeg', magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: ['tif', 'tiff'],
    mime: 'image/tiff',
    magic: (b: Buffer) => ['II*\0', 'MM\0*'].includes(b.subarray(0, 4).toString('latin1')),
  },
  // Office files are ZIP containers
  { ext: ['xlsx'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: isZip },
  { ext: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: isZip },
  // Outlook messages and old Excel files are OLE compound files
  { ext: ['msg'], mime: 'application/vnd.ms-outlook', magic: isOle },
  { ext: ['xls'], mime: 'application/vnd.ms-excel', magic: isOle },
  { ext: ['csv'], mime: 'text/csv', magic: isText },
  { ext: ['txt'], mime: 'text/plain', magic: isText },
  { ext: ['eml'], mime: 'message/rfc822', magic: isText },
];

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = KINDS.flatMap((k) => k.ext);

/** The MIME type to store, or null when the file is not an accepted kind or its content does not match its name */
export function recogniseFile(fileName: string, data: Buffer): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const kind = KINDS.find((k) => k.ext.includes(ext));
  if (!kind || data.length === 0) return null;
  return kind.magic(data) ? kind.mime : null;
}

/** A name safe to use in a storage path: letters, digits, dot, dash and underscore, at most 100 characters */
export function safeFileName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(-100) || 'file';
}

function isZip(b: Buffer) {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

function isOle(b: Buffer) {
  return b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}

/** Plain text: no NUL bytes in the first 8 KB */
function isText(b: Buffer) {
  return !b.subarray(0, 8192).includes(0);
}

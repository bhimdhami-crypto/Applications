// CSV export of a report, in a form Excel opens directly: UTF-8 with a byte order mark, quoted cells, CRLF.
type Cell = string | number | null | undefined;

function quote(cell: Cell) {
  let text = cell == null ? '' : String(cell);
  // A description starting with = or + would run as a formula in Excel; amounts like -500 stay numbers
  if (/^[=+\-@]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(fileName: string, rows: Cell[][]) {
  const body = rows.map((r) => r.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

'use client';

import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';

/** Matches what the archive accepts; the server checks the content too */
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.xlsx,.xls,.docx,.csv,.txt,.msg,.eml';

/**
 * A box that takes files by drag and drop, or by click for people who prefer the file picker.
 * It lights up while files are dragged over it.
 */
export function DropZone({
  title,
  hint,
  onFiles,
  disabled,
  compact,
  accept = ACCEPT,
  multiple = true,
}: {
  title: string;
  hint?: string;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  accept?: string;
  multiple?: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  return (
    <div
      className={`dropzone${over ? ' over' : ''}${compact ? ' compact' : ''}${disabled ? ' disabled' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && input.current?.click()}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
    >
      <Upload size={compact ? 16 : 22} style={{ marginBottom: 4 }} />
      <strong>{title}</strong>
      {hint && <span className="muted">{hint}</span>}
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={accept}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

export function filesForm(files: File[], description?: string) {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  if (description) form.append('description', description);
  return form;
}

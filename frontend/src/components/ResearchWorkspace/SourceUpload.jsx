import { useRef, useState } from 'react'
import { ACCEPTED_UPLOAD_TYPES } from '../../utils/constants'
import Icon from '../Icon/Icon'

function SourceUpload({ files, onFilesChange }) {
  const inputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isOpen, setIsOpen] = useState(true)

  const acceptList = Object.keys(ACCEPTED_UPLOAD_TYPES).join(',')

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter((file) => {
      const byType = ACCEPTED_UPLOAD_TYPES[file.type]
      const byExt = /\.pdf$/i.test(file.name)
      return byType || byExt
    })

    if (!incoming.length) return

    const next = [...files]
    incoming.forEach((file) => {
      if (!next.some((item) => item.name === file.name && item.size === file.size)) {
        next.push(file)
      }
    })
    onFilesChange(next)
  }

  const removeFile = (index) => {
    onFilesChange(files.filter((_, i) => i !== index))
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="mb-2 flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Upload Sources
          {files.length > 0 && (
            <span className="ml-2 normal-case tracking-normal text-accent">
              ({files.length})
            </span>
          )}
        </span>
        <Icon
          name="chevron"
          className={`h-4 w-4 text-ink-muted ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <>
          <div
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setIsDragging(false)
              addFiles(event.dataTransfer.files)
            }}
            className={`rounded-2xl border border-dashed px-4 py-5 text-center ${
              isDragging
                ? 'border-accent bg-accent/5 dark:bg-accent/10'
                : 'border-border bg-panel/60 hover:border-accent/40 dark:bg-panel/40'
            }`}
          >
            <Icon name="upload" className="mx-auto h-5 w-5 text-accent" />
            <p className="mt-2 text-sm text-ink-soft">
              Drag and drop PDF only
            </p>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-3 text-xs font-semibold text-accent hover:text-accent-deep"
            >
              Browse files
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={acceptList}
              multiple
              className="hidden"
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </div>

          {files.length > 0 && (
            <ul className="mt-3 space-y-2">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}`}
                  className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 dark:bg-panel"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="file" className="h-4 w-4 shrink-0 text-accent" />
                    <span className="truncate text-xs text-ink-soft">{file.name}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeFile(index)}
                    className="text-ink-muted hover:text-ink"
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

export default SourceUpload

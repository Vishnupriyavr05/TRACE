import { useState } from 'react'
import Icon from '../Icon/Icon'
import { exportResearchReportPdf } from '../../utils/exportReportPdf'

function ExportReport({ disabled, report, researchQuestion }) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!report || disabled || isExporting) return

    setIsExporting(true)
    try {
      await exportResearchReportPdf({
        report,
        researchQuestion,
      })
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleExport}
        disabled={disabled || isExporting}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-ink hover:border-accent/40 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 dark:bg-panel dark:hover:border-accent/40"
      >
        <Icon name="download" className="h-4 w-4" />
        {isExporting ? 'Generating PDF…' : 'Export Report (PDF)'}
      </button>
      {disabled && (
        <p className="mt-2 text-center text-xs text-ink-muted">
          Complete a TRACE run to export the research report.
        </p>
      )}
    </div>
  )
}

export default ExportReport

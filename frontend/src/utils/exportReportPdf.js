async function loadLogoDataUrl() {
  try {
    const response = await fetch('/assets/logo.png')
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function writeWrappedText(doc, text, x, y, maxWidth, lineHeight = 5.2) {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth)
  doc.text(lines, x, y)
  return y + lines.length * lineHeight
}

function ensureSpace(doc, y, needed = 24) {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (y + needed < pageHeight - 18) return y
  doc.addPage()
  return 24
}

function writeSectionHeading(doc, title, y) {
  const nextY = ensureSpace(doc, y, 16)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(15, 23, 42)
  doc.text(title, 20, nextY)
  doc.setDrawColor(79, 124, 255)
  doc.setLineWidth(0.4)
  doc.line(20, nextY + 1.8, 52, nextY + 1.8)
  return nextY + 8
}

/**
 * Generates a professional TRACE research report PDF.
 */
export async function exportResearchReportPdf({ report, researchQuestion }) {
  if (!report) return

  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - 40
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const timeLabel = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const logo = await loadLogoDataUrl()
  if (logo) {
    doc.addImage(logo, 'PNG', 20, 14, 28, 10)
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(79, 124, 255)
    doc.text('TRACE', 20, 22)
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text('Explainable AI Research Platform', pageWidth - 20, 18, { align: 'right' })
  doc.text(`${dateLabel} · ${timeLabel}`, pageWidth - 20, 24, { align: 'right' })

  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(20, 30, pageWidth - 20, 30)

  let y = 40

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(15, 23, 42)
  doc.text('TRACE Research Report', 20, y)
  y += 10

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(79, 124, 255)
  doc.text('Research Question', 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(51, 65, 85)
  y = writeWrappedText(doc, researchQuestion || '—', 20, y, contentWidth, 5.5)
  y += 8

  y = writeSectionHeading(doc, 'Research Summary', y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  y = writeWrappedText(doc, report.summary, 20, y, contentWidth)
  y += 8

  y = writeSectionHeading(doc, 'Key Findings', y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  report.findings.forEach((item, index) => {
    y = ensureSpace(doc, y, 14)
    y = writeWrappedText(doc, `${index + 1}. ${item}`, 20, y, contentWidth)
    y += 3
  })
  y += 5

  y = writeSectionHeading(doc, 'Research Gap Analysis', y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(79, 124, 255)
  doc.text(report.researchGaps.title, 20, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(51, 65, 85)
  y = writeWrappedText(doc, report.researchGaps.summary, 20, y, contentWidth)
  y = writeWrappedText(doc, report.researchGaps.evidence, 20, y + 2, contentWidth)
  y += 8

  y = writeSectionHeading(doc, 'Contradictions', y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  report.contradictions.forEach((item, index) => {
    y = ensureSpace(doc, y, 14)
    y = writeWrappedText(doc, `${index + 1}. ${item}`, 20, y, contentWidth)
    y += 3
  })
  y += 5

  y = writeSectionHeading(doc, 'Confidence Score', y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(79, 124, 255)
  doc.text(`${report.confidence}%`, 20, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(100, 116, 139)
  doc.text('Overall confidence in synthesized findings', 42, y)
  y += 10

  y = writeSectionHeading(doc, 'References', y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(51, 65, 85)
  report.references.forEach((item, index) => {
    y = ensureSpace(doc, y, 14)
    y = writeWrappedText(doc, `${index + 1}. ${item}`, 20, y, contentWidth)
    y += 3
  })

  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(148, 163, 184)
    doc.text(
      'Generated by TRACE',
      20,
      doc.internal.pageSize.getHeight() - 10,
    )
    doc.text(
      'Every discovery begins with a trace.',
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' },
    )
    doc.text(
      `Page ${page} of ${pageCount}`,
      pageWidth - 20,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'right' },
    )
  }

  const safeName = (researchQuestion || 'research-report')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)

  doc.save(`trace-${safeName || 'research-report'}.pdf`)
}

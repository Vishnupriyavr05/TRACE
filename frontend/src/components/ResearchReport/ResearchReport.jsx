import { useEffect, useState } from 'react'
import { REPORT_SECTIONS } from '../../utils/constants'
import AccordionSection from './AccordionSection'
import ExportReport from './ExportReport'
import Icon from '../Icon/Icon'
import PanelScroll from '../PanelScroll/PanelScroll'
import ResearchGapAnalysis from './ResearchGapAnalysis'
import EvidenceInspector from './EvidenceInspector'

function ParentSection({ id, title, isOpen, onToggle, children }) {
  return (
    <section aria-labelledby={`${id}-title`}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-panel/45 px-3.5 py-2.5 text-left transition hover:border-accent/35"
      >
        <span
          id={`${id}-title`}
          className="text-xs font-semibold uppercase tracking-[0.14em] text-ink"
        >
          {title}
        </span>
        <Icon
          name="chevron"
          className={`h-4 w-4 text-ink-muted transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      {isOpen && <div className="mt-3">{children}</div>}
    </section>
  )
}

function FindingBadge({ finding }) {
  const label = finding?.confidence
  const handling = String(finding?.handling || '').toUpperCase()
  if (!label && handling !== 'QUALIFY') return null
  return (
    <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
      {[label, handling === 'QUALIFY' ? 'Limited evidence' : null]
        .filter(Boolean)
        .join(' · ')}
    </span>
  )
}

function ResearchReport({
  sectionStatus,
  report,
  researchQuestion,
  selectedPaper,
  papers,
  paperFeedback,
  selectedFindingIndex,
  onSelectPaper,
  onPaperFeedback,
  onOpenPaper,
  onReplacePaper,
  onRemovePaper,
  onSelectFinding,
}) {
  const [openParent, setOpenParent] = useState('insights')
  const [openSection, setOpenSection] = useState('summary')

  useEffect(() => {
    if (!report) {
      setOpenParent('insights')
      setOpenSection('summary')
    }
  }, [report])

  // Selecting a paper (Citation Explorer or Concept Graph) switches the
  // parent accordion to the Evidence Inspector.
  useEffect(() => {
    setOpenParent(selectedPaper ? 'inspector' : 'insights')
  }, [selectedPaper])

  const handleParentToggle = (id) => {
    setOpenParent((current) => (current === id ? null : id))
  }

  const handleToggle = (id) => {
    setOpenSection((current) => (current === id ? null : id))
  }

  const structuredFindings = report?.structuredFindings || []

  const renderContent = (sectionId) => {
    if (!report) {
      return <p className="text-ink-muted">Run TRACE to generate this section.</p>
    }

    switch (sectionId) {
      case 'summary':
        return (
          <div className="space-y-3">
            {report.qualityWarning ? (
              <p className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                Quality check did not meet the required threshold. Review findings
                carefully before relying on this report.
              </p>
            ) : null}
            {report.researchObjective ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Research objective
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">
                  {report.researchObjective}
                </p>
              </div>
            ) : null}
            <p>{report.summary}</p>
            {Array.isArray(report.recommendations) &&
            report.recommendations.length ? (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
                  Recommendations
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-soft">
                  {report.recommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )
      case 'findings':
        return (
          <ul className="space-y-2">
            {(structuredFindings.length
              ? structuredFindings.map((f) => f.statement)
              : report.findings
            ).map((item, index) => {
              const finding = structuredFindings[index] || null
              const isSelected = selectedFindingIndex === index

              return (
                <li key={finding?.id || `${index}-${item}`}>
                  <button
                    type="button"
                    onClick={() => onSelectFinding(index)}
                    className={`flex w-full gap-2 rounded-xl border px-3 py-2 text-left text-xs leading-relaxed ${
                      isSelected
                        ? 'border-accent/45 bg-accent/5 text-ink'
                        : 'border-border bg-panel/35 text-ink-soft hover:border-accent/30'
                    }`}
                  >
                    <span className="font-semibold text-accent">{index + 1}.</span>
                    <span>
                      {item}
                      <FindingBadge finding={finding} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )
      case 'contradictions':
        return report.contradictions?.length ? (
          <ul className="list-disc space-y-2 pl-5">
            {report.contradictions.map((item) => (
              <li key={typeof item === 'string' ? item : item.description || JSON.stringify(item)}>
                {typeof item === 'string'
                  ? item
                  : item.description || item.statement || String(item)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">No contradictions reported.</p>
        )
      case 'gaps':
        return <ResearchGapAnalysis gap={report.researchGaps} />
      case 'confidence':
        return (
          <div>
            <div className="mb-2 flex items-end justify-between">
              <span className="text-ink-muted">Overall confidence</span>
              <span className="font-serif text-2xl font-semibold text-accent">
                {report.confidenceLabel || `${report.confidence}%`}
              </span>
            </div>
            {report.confidenceLabel ? (
              <p className="mb-2 text-xs text-ink-muted">
                Score: {report.confidence}%
              </p>
            ) : null}
            <div className="h-2 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-accent transition-all duration-700"
                style={{ width: `${report.confidence}%` }}
              />
            </div>
            {report.confidenceBasis ? (
              <p className="mt-3 text-xs leading-relaxed text-ink-soft">
                {report.confidenceBasis}
              </p>
            ) : null}
          </div>
        )
      case 'references':
        return (
          <ol className="list-decimal space-y-2 pl-5">
            {report.references.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        )
      default:
        return null
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-2xl border border-border bg-card shadow-sm">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="font-serif text-lg font-semibold text-ink">Research Report</h2>
      </div>

      <PanelScroll className="min-h-0 flex-1 px-4 py-4">
        <div className="space-y-3">
          <ParentSection
            id="insights"
            title="Research Insights"
            isOpen={openParent === 'insights'}
            onToggle={handleParentToggle}
          >
            <div className="space-y-3">
              {REPORT_SECTIONS.map((section) => (
                <AccordionSection
                  key={section.id}
                  id={section.id}
                  title={section.title}
                  isOpen={openSection === section.id}
                  onToggle={handleToggle}
                  status={sectionStatus[section.id] || 'idle'}
                >
                  {renderContent(section.id)}
                </AccordionSection>
              ))}
            </div>
          </ParentSection>

          <ParentSection
            id="inspector"
            title="Evidence Inspector"
            isOpen={openParent === 'inspector'}
            onToggle={handleParentToggle}
          >
            <EvidenceInspector
              selectedPaper={selectedPaper}
              papers={papers}
              methodology={report?.methodology}
              evidenceRegistry={report?.findingConceptMap?.finalEvidenceRegistry}
              integrity={report?.integrity}
              feedback={selectedPaper ? paperFeedback[selectedPaper.id] : null}
              onSelectPaper={onSelectPaper}
              onFeedback={onPaperFeedback}
              onOpenPaper={onOpenPaper}
              onReplace={onReplacePaper}
              onRemove={onRemovePaper}
            />
          </ParentSection>
        </div>
      </PanelScroll>

      <div className="shrink-0 border-t border-border px-4 py-3">
        <ExportReport
          disabled={!report || sectionStatus.references !== 'ready'}
          report={report}
          researchQuestion={researchQuestion}
        />
      </div>
    </section>
  )
}

export default ResearchReport

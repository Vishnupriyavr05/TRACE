import { useEffect, useMemo, useState } from 'react'
import { EVIDENCE_INSPECTOR_SECTIONS } from '../../utils/constants'
import Icon from '../Icon/Icon'
import AccordionSection from './AccordionSection'
import IntegrityReview from './IntegrityReview'
import MethodologyReview from './MethodologyReview'
import PaperActionsToolbar from './PaperActionsToolbar'
import { buildMethodologyReviewForPaper } from '../../utils/methodologyReview'

function BooleanValue({ value }) {
  if (value === true) {
    return <span className="font-semibold text-accent">Yes</span>
  }
  if (value === false) {
    return <span className="text-ink-muted">No</span>
  }
  return <span className="text-ink-muted">Unknown</span>
}

function formatTriState(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return 'Unknown'
}

function hasResolvedGrobidLocation(location) {
  if (!location || typeof location !== 'object') return false
  return Boolean(
    location.page ||
      location.section ||
      location.paragraph ||
      location.sentence ||
      location.sentenceIndex,
  )
}

function formatEvidenceLevelLabel(paper) {
  const level = String(paper?.evidenceLevel || '').toUpperCase()
  if (level === 'FULL_TEXT') return 'Full-text (GROBID)'
  if (level === 'ABSTRACT') return 'Abstract'
  if (level === 'METADATA') return 'Metadata only'
  if (level === 'UNAVAILABLE') return 'Unavailable'
  return 'Abstract / metadata'
}

function formatFallbackReason(reason) {
  const text = String(reason || '').trim()
  if (!text) return null
  if (text.startsWith('grobid_unavailable')) {
    return 'GROBID service is not reachable. Full-text extraction was not attempted.'
  }
  if (text === 'grobid_unconfigured') {
    return 'GROBID is not configured (GROBID_BASE_URL missing).'
  }
  if (text === 'no_pdf_url' || text === 'no_pdf') {
    return 'No open-access PDF URL was available for this paper.'
  }
  if (text === 'invalid_pdf' || text === 'html_response') {
    return 'A candidate URL did not return a valid PDF.'
  }
  if (text.startsWith('GROBID')) {
    return text
  }
  return text
}

function ExactEvidencePanel({ selectedPaper }) {
  const location = selectedPaper?.evidenceLocation
  const level = String(selectedPaper?.evidenceLevel || '').toUpperCase()
  const hasGrobid = level === 'FULL_TEXT' && hasResolvedGrobidLocation(location)
  const fallbackReason = formatFallbackReason(selectedPaper?.fallbackReason)

  if (!hasGrobid) {
    return (
      <div className="space-y-3 text-xs">
        <div className="rounded-xl border border-border bg-panel/35 px-3 py-2.5">
          <p className="font-semibold text-ink">Evidence level</p>
          <p className="mt-1 text-ink-soft">{formatEvidenceLevelLabel(selectedPaper)}</p>
          <p className="mt-2 text-ink-muted">
            {fallbackReason ||
              (level === 'ABSTRACT' || level === 'METADATA'
                ? 'Full text was not acquired. Evidence is limited to abstract or bibliographic metadata.'
                : 'Exact page, section, paragraph, and sentence locations are not available.')}
          </p>
        </div>
        {selectedPaper?.abstract ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
              Available evidence text
            </p>
            <p className="mt-1 border-l-2 border-accent/40 pl-2 italic leading-relaxed text-ink-soft">
              “{selectedPaper.abstract}”
            </p>
            <p className="mt-2 text-[11px] text-ink-muted">
              Shown from abstract/metadata only — not a pinpoint citation.
            </p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <dl className="grid grid-cols-3 gap-3 text-xs">
      <div className="col-span-3">
        <dt className="text-ink-muted">Evidence level</dt>
        <dd className="mt-1 font-semibold text-ink">
          {formatEvidenceLevelLabel(selectedPaper)}
        </dd>
      </div>
      <div>
        <dt className="text-ink-muted">Page</dt>
        <dd className="mt-1 font-semibold text-ink">{location.page ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-ink-muted">Section</dt>
        <dd className="mt-1 font-semibold text-ink">{location.section || '—'}</dd>
      </div>
      <div>
        <dt className="text-ink-muted">Paragraph</dt>
        <dd className="mt-1 font-semibold text-ink">{location.paragraph ?? '—'}</dd>
      </div>
      {location.sentenceIndex != null ? (
        <div>
          <dt className="text-ink-muted">Sentence #</dt>
          <dd className="mt-1 font-semibold text-ink">{location.sentenceIndex}</dd>
        </div>
      ) : null}
      <div className="col-span-3">
        <dt className="text-ink-muted">Evidence Sentence</dt>
        <dd className="mt-1 border-l-2 border-accent/40 pl-2 italic leading-relaxed text-ink-soft">
          “{location.sentence || '—'}”
        </dd>
      </div>
    </dl>
  )
}

function EvidenceInspector({
  selectedPaper,
  papers,
  methodology,
  evidenceRegistry,
  integrity,
  feedback,
  onSelectPaper,
  onFeedback,
  onOpenPaper,
  onReplace,
  onRemove,
}) {
  const [openSection, setOpenSection] = useState('metadata')

  const paperMethodology = useMemo(() => {
    if (!selectedPaper) {
      return methodology || {
        strengths: ['Insufficient evidence retrieved.'],
        weaknesses: ['Insufficient evidence retrieved.'],
        limitations: 'Insufficient evidence retrieved.',
      }
    }
    return buildMethodologyReviewForPaper(evidenceRegistry, selectedPaper.id)
  }, [selectedPaper, evidenceRegistry, methodology])

  useEffect(() => {
    setOpenSection('metadata')
  }, [selectedPaper?.id])

  if (!selectedPaper) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-panel/35 px-4 py-6 text-center">
        <p className="text-sm text-ink-muted">
          Select a supporting paper from the Citation Explorer or Concept Graph
          to inspect its evidence.
        </p>
      </div>
    )
  }

  const renderContent = (sectionId) => {
    switch (sectionId) {
      case 'literature':
        return (
          <ul className="space-y-2">
            {papers.map((paper) => (
              <li key={paper.id}>
                <button
                  type="button"
                  onClick={() => onSelectPaper(paper)}
                  className={`w-full rounded-xl border px-3 py-2 text-left ${
                    paper.id === selectedPaper.id
                      ? 'border-accent/45 bg-accent/5'
                      : 'border-border bg-panel/35 hover:border-accent/30'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate text-xs font-semibold text-ink">
                    {paper.pinned && (
                      <Icon name="pin" className="h-3 w-3 shrink-0 text-accent" />
                    )}
                    <span className="truncate">{paper.title}</span>
                  </span>
                  <span className="mt-1 block text-[11px] text-ink-muted">
                    {paper.year ?? '—'} · {paper.venue || 'Unknown venue'} ·{' '}
                    {(paper.citationCount ?? 0).toLocaleString()} citations
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      case 'integrity':
        return <IntegrityReview indicators={integrity} papers={[selectedPaper]} />
      case 'exact-evidence':
        return <ExactEvidencePanel selectedPaper={selectedPaper} />
      case 'methodology':
        return (
          <div>
            <MethodologyReview review={paperMethodology} />
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-muted">
                Limitations
              </p>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">
                {paperMethodology.limitations ||
                  'Insufficient evidence retrieved.'}
              </p>
            </div>
          </div>
        )
      case 'metadata':
        return (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <div className="col-span-2">
              <dt className="text-ink-muted">Title</dt>
              <dd className="mt-1 font-semibold text-ink">{selectedPaper.title}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-muted">Authors</dt>
              <dd className="mt-1 text-ink">
                {(selectedPaper.authors || []).join(', ') || 'Unknown authors'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Venue</dt>
              <dd className="mt-1 font-medium text-ink">{selectedPaper.venue}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Publication Year</dt>
              <dd className="mt-1 font-medium text-ink">{selectedPaper.year}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">DOI</dt>
              <dd className="mt-1 break-all font-medium text-ink">
                {selectedPaper.doi || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Citation Count</dt>
              <dd className="mt-1 font-medium text-ink">
                {(selectedPaper.citationCount ?? 0).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Peer reviewed</dt>
              <dd className="mt-1 font-medium text-ink">
                {formatTriState(
                  selectedPaper.integrity?.peerReviewed ?? selectedPaper.peerReviewed,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Open access</dt>
              <dd className="mt-1 font-medium text-ink">
                {formatTriState(
                  selectedPaper.integrity?.openAccess ?? selectedPaper.openAccess,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Source</dt>
              <dd className="mt-1 font-medium capitalize text-ink">
                {(selectedPaper.source || 'unknown').replace(/_/g, ' ')}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Discovery Method</dt>
              <dd className="mt-1 font-medium text-ink">
                {selectedPaper.discoveryMethod || '—'}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-muted">Evidence level</dt>
              <dd className="mt-1 font-medium text-ink">
                {formatEvidenceLevelLabel(selectedPaper)}
              </dd>
            </div>
            {selectedPaper.fallbackReason ? (
              <div className="col-span-2">
                <dt className="text-ink-muted">Acquisition status</dt>
                <dd className="mt-1 text-ink-soft">
                  {formatFallbackReason(selectedPaper.fallbackReason)}
                </dd>
              </div>
            ) : null}
            <div className="col-span-2">
              <dt className="text-ink-muted">Keywords</dt>
              <dd className="mt-1 text-ink">
                {selectedPaper.keywords?.length
                  ? selectedPaper.keywords.join(', ')
                  : '—'}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-muted">PDF</dt>
              <dd className="mt-1 break-all font-medium text-ink">
                {selectedPaper.url || 'Unavailable'}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-muted">Abstract</dt>
              <dd className="mt-1 leading-relaxed text-ink-soft">
                {selectedPaper.abstract || 'No abstract available.'}
              </dd>
            </div>
          </dl>
        )
      case 'reproducibility':
        return (
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-ink-muted">Code Available</dt>
              <dd className="mt-1">
                <BooleanValue value={selectedPaper.reproducibility?.codeAvailable} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Dataset Available</dt>
              <dd className="mt-1">
                <BooleanValue value={selectedPaper.reproducibility?.datasetAvailable} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">GitHub Repository</dt>
              <dd className="mt-1 break-all font-medium text-ink">
                {selectedPaper.reproducibility?.githubRepository || 'Unavailable'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">Papers With Code</dt>
              <dd className="mt-1">
                <BooleanValue value={selectedPaper.reproducibility?.papersWithCode} />
              </dd>
            </div>
          </dl>
        )
      default:
        return null
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {EVIDENCE_INSPECTOR_SECTIONS.map((section) => (
          <AccordionSection
            key={section.id}
            id={section.id}
            title={section.title}
            isOpen={openSection === section.id}
            onToggle={(id) =>
              setOpenSection((current) => (current === id ? null : id))
            }
            status="ready"
          >
            {renderContent(section.id)}
          </AccordionSection>
        ))}
      </div>

      <PaperActionsToolbar
        paper={selectedPaper}
        feedback={feedback}
        onOpen={onOpenPaper}
        onReplace={onReplace}
        onRemove={onRemove}
        onFeedback={onFeedback}
      />
    </div>
  )
}

export default EvidenceInspector

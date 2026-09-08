/**
 * @fileoverview Evidence-backed graph enrichment from TRACE artifacts.
 * When finalEvidenceRegistry is present it is authoritative for findings + evidence items.
 */

const FINDING_NODE_TYPE = 'Finding'
const SUPPORTS_EDGE = 'SUPPORTS'

/**
 * @param {string} evidenceId
 * @returns {string}
 */
function evidenceNodeId(evidenceId) {
  return `evidence:${String(evidenceId || '').replace(/[^a-zA-Z0-9_-]+/g, '_')}`
}

/**
 * @param {object} finding
 * @returns {string}
 */
function findingLabel(finding) {
  return String(
    finding.statement || finding.claim || finding.summary || finding.id || '',
  ).slice(0, 120)
}

/**
 * @param {object} traceArtifacts
 * @returns {object[]}
 */
function resolveEnrichmentEvidenceItems(traceArtifacts = {}) {
  const registry = traceArtifacts.finalEvidenceRegistry
  if (Array.isArray(registry?.evidenceItems) && registry.evidenceItems.length) {
    return registry.evidenceItems
  }

  const packageItems = [
    ...(traceArtifacts.evidencePackage?.allExtractedEvidenceItems || []),
    ...(traceArtifacts.evidencePackage?.extractedEvidenceItems || []),
  ]
  const seen = new Set()
  /** @type {object[]} */
  const items = []
  for (const item of packageItems) {
    const evidenceId = String(item?.evidenceId || '')
    if (!evidenceId || seen.has(evidenceId)) continue
    if (String(item.evidenceLevel || '').toUpperCase() !== 'FULL_TEXT') continue
    seen.add(evidenceId)
    items.push(item)
  }
  return items
}

/**
 * @param {object} traceArtifacts
 * @returns {object[]}
 */
function resolveEnrichmentFindings(traceArtifacts = {}) {
  const registry = traceArtifacts.finalEvidenceRegistry
  if (Array.isArray(registry?.findings) && registry.findings.length) {
    return registry.findings
  }
  return traceArtifacts.analyticalFindings?.findings || []
}

/**
 * @param {object} built
 * @param {{ analyticalFindings?: object, evidencePackage?: object, finalEvidenceRegistry?: object }} traceArtifacts
 * @returns {{ nodes: object[], links: object[], enrichmentStats: object }}
 */
export function enrichGraphFromTraceEvidence(built, traceArtifacts = {}) {
  const nodes = [...(built?.nodes || [])]
  const links = [...(built?.links || [])]
  const nodeIds = new Set(nodes.map((n) => n.id))
  const linkKeys = new Set(
    links.map((l) => `${l.source}|${l.target}|${l.type}`),
  )

  let findingsAdded = 0
  let supportEdgesAdded = 0
  let evidenceItemsAdded = 0
  let hasEvidenceEdgesAdded = 0

  const registry = traceArtifacts.finalEvidenceRegistry
  const findings = resolveEnrichmentFindings(traceArtifacts)

  for (const finding of findings) {
    const fid = finding.id || finding.findingId || finding.claim?.slice(0, 40)
    if (!fid) continue
    const findingNodeId = `finding:${String(fid).replace(/[^a-zA-Z0-9_-]+/g, '_')}`

    if (!nodeIds.has(findingNodeId)) {
      nodes.push({
        id: findingNodeId,
        type: FINDING_NODE_TYPE,
        label: findingLabel(finding),
        properties: {
          findingId: String(fid),
          handling: finding.handling || null,
          evidenceLevel: finding.evidenceLevel || null,
          confidence: finding.confidence || null,
          origin: registry ? 'final_evidence_registry' : 'trace_analyst',
        },
      })
      nodeIds.add(findingNodeId)
      findingsAdded += 1
    }

    const uniquePaperIds = [...new Set((finding.paperIds || []).map(String))]
    for (const pid of uniquePaperIds) {
      const targetPaperNodeId = `paper:${pid}`
      if (!nodeIds.has(targetPaperNodeId)) continue
      const key = `${targetPaperNodeId}|${findingNodeId}|${SUPPORTS_EDGE}`
      if (linkKeys.has(key)) continue
      links.push({
        id: `edge:${key}`,
        source: targetPaperNodeId,
        target: findingNodeId,
        type: SUPPORTS_EDGE,
        explanation: registry
          ? 'Final report finding linked to paper via evidenceIds/paperIds'
          : 'Analyst finding linked to paper via evidenceIds/paperIds',
        confidence: finding.evidenceLevel === 'FULL_TEXT' ? 85 : 65,
        supportingPaperIds: [pid],
        properties: {
          evidenceIds: finding.evidenceIds || [],
          evidenceLevel: finding.evidenceLevel || null,
          handling: finding.handling || null,
          origin: registry ? 'final_evidence_registry' : 'trace_analyst',
        },
      })
      linkKeys.add(key)
      supportEdgesAdded += 1
    }
  }

  const evidenceItems = resolveEnrichmentEvidenceItems(traceArtifacts)
  for (const item of evidenceItems) {
    const pid = String(item.paperId || '')
    const evidenceId = String(item.evidenceId || '')
    if (!pid || !evidenceId) continue
    const paperNode = `paper:${pid}`
    if (!nodeIds.has(paperNode)) continue

    const evidenceNodeIdValue = evidenceNodeId(evidenceId)
    if (!nodeIds.has(evidenceNodeIdValue)) {
      nodes.push({
        id: evidenceNodeIdValue,
        type: 'EvidenceItem',
        label: String(item.text || evidenceId).slice(0, 100),
        properties: {
          evidenceId,
          paperId: pid,
          section: item.section ?? null,
          paragraphIndex: item.paragraphIndex ?? null,
          sentenceIndex: item.sentenceIndex ?? null,
          page: item.page ?? null,
          text: item.text || null,
          evidenceLevel: item.evidenceLevel || null,
          origin: registry ? 'final_evidence_registry' : 'full_text_acquisition',
        },
      })
      nodeIds.add(evidenceNodeIdValue)
      evidenceItemsAdded += 1
    }

    const evKey = `${paperNode}|${evidenceNodeIdValue}|HAS_EVIDENCE`
    if (!linkKeys.has(evKey)) {
      links.push({
        id: `edge:${evKey}`,
        source: paperNode,
        target: evidenceNodeIdValue,
        type: 'HAS_EVIDENCE',
        explanation: registry
          ? 'Final registry evidence item linked to paper'
          : 'Full-text evidence item extracted from paper',
        confidence:
          String(item.evidenceLevel || '').toUpperCase() === 'FULL_TEXT' ? 90 : 70,
        supportingPaperIds: [pid],
        properties: {
          evidenceId,
          section: item.section ?? null,
          paragraphIndex: item.paragraphIndex ?? null,
          sentenceIndex: item.sentenceIndex ?? null,
          origin: registry ? 'final_evidence_registry' : 'full_text_acquisition',
        },
      })
      linkKeys.add(evKey)
      hasEvidenceEdgesAdded += 1
    }
  }

  return {
    nodes,
    links,
    enrichmentStats: {
      findingsAdded,
      supportEdgesAdded,
      evidenceItemsAdded,
      hasEvidenceEdgesAdded,
      registryBacked: Boolean(registry),
      totalNodes: nodes.length,
      totalLinks: links.length,
    },
  }
}

export default {
  enrichGraphFromTraceEvidence,
  FINDING_NODE_TYPE,
  SUPPORTS_EDGE,
}

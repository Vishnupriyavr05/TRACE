/**
 * @fileoverview Named XAI method patterns shared by retrieval helpers.
 */
export const NAMED_METHOD_PATTERNS = [
  {
    pattern: /\bgrad[\s-]?cam\b/i,
    label: 'Grad-CAM',
    queryTerms: ['Grad-CAM'],
  },
  { pattern: /\bshap\b/i, label: 'SHAP', queryTerms: ['SHAP'] },
  { pattern: /\blime\b/i, label: 'LIME', queryTerms: ['LIME'] },
  {
    pattern: /\bprotopnet\b/i,
    label: 'ProtoPNet',
    queryTerms: ['ProtoPNet', 'prototype network'],
  },
  {
    pattern: /\bprototype[\s-]?(network|net)s?\b/i,
    label: 'prototype network',
    queryTerms: ['prototype network', 'ProtoPNet'],
  },
  {
    pattern: /\bintegrated gradients\b/i,
    label: 'integrated gradients',
    queryTerms: ['integrated gradients'],
  },
]

export default {
  NAMED_METHOD_PATTERNS,
}

import { SPECS } from './specs'
import type { NodeType } from './types'

const normalize = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Adjacent transpositions count as one typo, as do a missing, extra or replaced letter. */
export const typoDistance = (a: string, b: string): number => {
  const rows = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0))
  for (let i = 0; i <= a.length; i++) rows[i]![0] = i
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1)
  }
  return rows[a.length]![b.length]!
}

/** Rank names first, then algorithms and properties; require every query word to match. */
export const searchNodes = (query: string): NodeType[] => {
  const words = normalize(query).split(' ').filter(Boolean)
  return Object.values(SPECS).filter(s => !['group', 'groupInput', 'groupOutput'].includes(s.type)).map(spec => {
    const fields: [string, number][] = [[`${spec.title} ${spec.type}`, 0], [spec.algorithm, 0.3], [spec.parameters.map(p => `${p.key} ${p.label}`).join(' '), 0.5], [[...spec.inputs, ...spec.outputs].map(p => p.label).join(' '), 0.7], [spec.category, 1], [spec.description, 2]]
    let score = 0
    for (const word of words) {
      let best = Infinity
      for (const [text, weight] of fields) for (const candidate of normalize(text).split(' ')) {
        if (!candidate) continue
        if (candidate === word) best = Math.min(best, weight)
        else if (candidate.startsWith(word)) best = Math.min(best, weight + 0.2)
        else if (candidate.includes(word)) best = Math.min(best, weight + 0.6)
        else if (word.length >= 3 && Math.abs(word.length - candidate.length) <= 2) {
          const distance = typoDistance(word, candidate), allowed = word.length >= 7 ? 2 : 1
          if (distance <= allowed) best = Math.min(best, weight + distance + 1)
        }
      }
      score += best
    }
    return { type: spec.type, score }
  }).filter(hit => Number.isFinite(hit.score)).sort((a, b) => a.score - b.score || SPECS[a.type].title.localeCompare(SPECS[b.type].title)).map(hit => hit.type)
}

/** The same typo rules apply to user-named utilities and their exposed properties. */
export const matchesQuery = (query: string, text: string): boolean => normalize(query).split(' ').filter(Boolean).every(word => normalize(text).split(' ').some(candidate => candidate.includes(word) || word.length >= 3 && Math.abs(word.length - candidate.length) <= 2 && typoDistance(word, candidate) <= (word.length >= 7 ? 2 : 1)))

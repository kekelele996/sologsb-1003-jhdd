import { analyzeDocument } from './markdown'
import type { GlossaryTerm, Segment, TranslationIssue } from './types'

export const CHECK_BATCH_SIZE = 40
export const CHECK_CACHE_KEY = 'sologsb-1003-check-cache-v1'

/** FNV-1a 32 位哈希，用于内容指纹，输出短字符串。 */
export const hashString = (input: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** 单个术语的版本指纹：译法、源词或大小写规则变化都会改变它。 */
export const termFingerprint = (term: GlossaryTerm): string =>
  hashString([term.id, term.source, term.target, term.caseSensitive ? '1' : '0'].join('|'))

export const termMatchesSegment = (term: GlossaryTerm, segment: Segment): boolean =>
  term.caseSensitive
    ? segment.sourceText.includes(term.source)
    : segment.sourceText.toLowerCase().includes(term.source.toLowerCase())

/**
 * 片段指纹 = 片段自身内容 + 引用到的术语版本。
 * 只有译文/源文变动，或引用术语的译法变动，指纹才会变化。
 */
export const segmentFingerprint = (segment: Segment, glossary: GlossaryTerm[]): string =>
  hashString(JSON.stringify([
    segment.id,
    segment.kind,
    segment.status,
    segment.sourceText,
    segment.targetText,
    glossary.filter((term) => termMatchesSegment(term, segment)).map(termFingerprint),
  ]))

export interface CheckBatch {
  id: string
  segmentIds: string[]
  fingerprint: string
}

export interface CachedBatch {
  fingerprint: string
  issues: TranslationIssue[]
  checkedAt: number
}

export type CheckCache = Record<string, CachedBatch>

export const buildBatches = (segments: Segment[], glossary: GlossaryTerm[], size = CHECK_BATCH_SIZE): CheckBatch[] => {
  const batches: CheckBatch[] = []
  for (let start = 0; start < segments.length; start += size) {
    const slice = segments.slice(start, start + size)
    batches.push({
      id: `batch-${start / size}`,
      segmentIds: slice.map((segment) => segment.id),
      fingerprint: hashString(slice.map((segment) => segmentFingerprint(segment, glossary)).join(',')),
    })
  }
  return batches
}

export const loadCheckCache = (): CheckCache => {
  try {
    const raw = localStorage.getItem(CHECK_CACHE_KEY)
    return raw ? (JSON.parse(raw) as CheckCache) : {}
  } catch {
    return {}
  }
}

export const saveCheckCache = (cache: CheckCache) => {
  try { localStorage.setItem(CHECK_CACHE_KEY, JSON.stringify(cache)) } catch { /* storage may be unavailable */ }
}

/** 丢弃已不存在批次的缓存，避免无限增长。 */
export const pruneCheckCache = (cache: CheckCache, batches: CheckBatch[]): CheckCache => {
  const validIds = new Set(batches.map((batch) => batch.id))
  return Object.fromEntries(Object.entries(cache).filter(([key]) => validIds.has(key)))
}

export const freshBatches = (batches: CheckBatch[], cache: CheckCache) =>
  batches.filter((batch) => cache[batch.id]?.fingerprint === batch.fingerprint)

/** 接口不可用时的本地兜底分析，与 /api/check 使用同一套规则。 */
export const analyzeBatchLocally = (segments: Segment[], glossary: GlossaryTerm[]) =>
  analyzeDocument(segments, glossary)

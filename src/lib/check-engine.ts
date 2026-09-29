import type { GlossaryTerm, Segment, TranslationIssue } from './types'
import { analyzeSegment } from './markdown'

/** 每批检查的片段数量，避免单次请求携带全部片段导致超时。 */
export const CHECK_BATCH_SIZE = 40
const CHECK_STATE_VERSION = 1
const CHECK_STATE_KEY_PREFIX = 'sologsb-1003-check-state-v1:'

export interface SegmentCheckResult {
  segmentId: string
  fingerprint: string
  issues: TranslationIssue[]
  checkedAt: number
}

export interface CheckState {
  version: number
  documentId: string
  results: Record<string, SegmentCheckResult>
  updatedAt: number
}

/**
 * cyrb53 快速字符串哈希，分布足够好且开销小，适合在每次渲染时计算指纹。
 * 返回 base36 字符串。
 */
export const hashString = (text: string, seed = 0): string => {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** 术语指纹：只取参与检查的字段（source / target / caseSensitive），备注改动不影响检查结果。 */
export const termFingerprint = (term: GlossaryTerm): string =>
  hashString(JSON.stringify([term.source, term.target, term.caseSensitive]))

/** 术语表整体指纹，用于展示术语表版本。 */
export const glossaryFingerprint = (glossary: GlossaryTerm[]): string =>
  hashString(glossary.map((term) => `${term.id}:${termFingerprint(term)}`).sort().join('|'))

const termAppliesToSegment = (segment: Segment, term: GlossaryTerm): boolean =>
  term.caseSensitive
    ? segment.sourceText.includes(term.source)
    : segment.sourceText.toLowerCase().includes(term.source.toLowerCase())

/**
 * 片段检查指纹 = 片段内容指纹 + 命中该片段的术语指纹。
 *  - 片段译文/状态/受保护标记变化 → 内容指纹变化 → 该片段重查
 *  - 某个术语译法变化 → 只有引用（命中）该术语的片段指纹变化 → 仅这些片段重查
 *  - 新增/删除术语 → 命中集合变化的片段才重查
 */
export const segmentFingerprint = (segment: Segment, glossary: GlossaryTerm[]): string => {
  const contentHash = hashString(JSON.stringify([
    segment.kind,
    segment.sourceText,
    segment.targetText,
    segment.status,
    segment.protectedTokens,
  ]))
  const applicableHash = hashString(glossary
    .filter((term) => termAppliesToSegment(segment, term))
    .map((term) => `${term.id}:${termFingerprint(term)}`)
    .sort()
    .join('|'))
  return `${contentHash}-${applicableHash}`
}

export const chunk = <T,>(items: T[], size: number): T[][] => {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

/**
 * 计划需要重查的片段：
 *  - 已确认片段跳过（analyzeDocument 本就跳过确认片段）
 *  - 无缓存结果或缓存指纹与当前指纹不一致的片段需要重查
 * force 时返回全部未确认片段（用于“全部重查”）。
 */
export const planDirtySegments = (
  segments: Segment[],
  glossary: GlossaryTerm[],
  results: Record<string, SegmentCheckResult>,
  force = false,
): Segment[] => {
  if (force) return segments.filter((segment) => segment.status !== 'confirmed')
  return segments.filter((segment) => {
    if (segment.status === 'confirmed') return false
    const cached = results[segment.id]
    if (!cached) return true
    return cached.fingerprint !== segmentFingerprint(segment, glossary)
  })
}

/** 统计当前已是最新缓存的片段数（含已确认片段）。 */
export const countFreshSegments = (
  segments: Segment[],
  glossary: GlossaryTerm[],
  results: Record<string, SegmentCheckResult>,
): number => segments.filter((segment) => {
  if (segment.status === 'confirmed') return true
  const cached = results[segment.id]
  return !!cached && cached.fingerprint === segmentFingerprint(segment, glossary)
}).length

const checkStateKey = (documentId: string): string => `${CHECK_STATE_KEY_PREFIX}${documentId}`

/** 从 localStorage 恢复检查状态；不可用或版本不符时返回 null。 */
export const loadCheckState = (documentId: string): CheckState | null => {
  try {
    const raw = localStorage.getItem(checkStateKey(documentId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CheckState
    if (parsed.version !== CHECK_STATE_VERSION || parsed.documentId !== documentId) return null
    return parsed
  } catch {
    return null
  }
}

/** 持久化检查状态，每个批次完成后调用，崩溃后重开可从最后一个批次续查。 */
export const saveCheckState = (state: CheckState): void => {
  try {
    localStorage.setItem(checkStateKey(state.documentId), JSON.stringify(state))
  } catch { /* 存储不可用时仅保留内存态 */ }
}

export const clearCheckState = (documentId: string): void => {
  try { localStorage.removeItem(checkStateKey(documentId)) } catch { /* ignore */ }
}

/** 恢复后校验：丢弃已删除片段和指纹已失效的缓存结果。 */
export const reconcileCheckState = (
  state: CheckState,
  segments: Segment[],
  glossary: GlossaryTerm[],
): CheckState => {
  const byId = new Map(segments.map((segment) => [segment.id, segment]))
  const results: Record<string, SegmentCheckResult> = {}
  for (const [id, result] of Object.entries(state.results)) {
    const segment = byId.get(id)
    if (!segment || result.fingerprint !== segmentFingerprint(segment, glossary)) continue
    results[id] = result
  }
  return { ...state, results, updatedAt: state.updatedAt }
}

/**
 * 实时检查结果缓存：按片段指纹缓存 analyzeSegment 结果，
 * 同一片段内容未变时不重复计算，避免每次渲染全量分析几千片段。
 */
const liveIssueCache = new Map<string, TranslationIssue[]>()
const LIVE_CACHE_LIMIT = 5000

export const liveIssuesForSegment = (segment: Segment, glossary: GlossaryTerm[]): TranslationIssue[] => {
  const fingerprint = segmentFingerprint(segment, glossary)
  const cached = liveIssueCache.get(fingerprint)
  if (cached) return cached
  const computed = analyzeSegment(segment, glossary)
  if (liveIssueCache.size >= LIVE_CACHE_LIMIT) liveIssueCache.clear()
  liveIssueCache.set(fingerprint, computed)
  return computed
}

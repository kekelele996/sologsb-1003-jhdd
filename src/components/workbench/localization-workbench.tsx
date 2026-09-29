'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  AlertCircle, ArrowDown, ArrowUp, BookOpen, Check, CheckCheck, ChevronLeft, ChevronRight,
  CircleAlert, Cloud, CloudOff, Code2, Download, FileText, GitCompare, History, Import,
  Languages, Link2, Loader2, MessageSquare, RefreshCw, RotateCcw, RotateCw, Save, Search,
  Send, ShieldCheck, Sparkles, Undo2, UndoDot, Variable, X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { analyzeDocument, extractVariables, parseMarkdown, renderTargetMarkdown } from '@/lib/markdown'
import { seedConflicts, seedDiscussions, seedDocument, seedGlossary, seedHistory, seedSegments } from '@/lib/seed'
import type { Discussion, GlossaryTerm, HistoryEntry, Segment, SegmentStatus, TranslationConflict, TranslationIssue } from '@/lib/types'
import { cn } from '@/lib/utils'

const DRAFT_KEY = 'sologsb-1003-localization-draft-v1'
const kindIcon = { heading: <FileText className="h-3.5 w-3.5" />, paragraph: <FileText className="h-3.5 w-3.5" />, code: <Code2 className="h-3.5 w-3.5" />, link: <Link2 className="h-3.5 w-3.5" />, variable: <Variable className="h-3.5 w-3.5" /> }
const kindLabel: Record<Segment['kind'], string> = { heading: '标题', paragraph: '段落', code: '代码块', link: '链接', variable: '占位符' }
const statusLabel: Record<SegmentStatus, string> = { draft: '草稿', 'needs-work': '待处理', confirmed: '已确认', returned: '已退回' }
const statusClass: Record<SegmentStatus, string> = {
  draft: 'bg-slate-100 text-slate-700', 'needs-work': 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800', returned: 'bg-red-100 text-red-800',
}
const issueLabel: Record<TranslationIssue['type'], string> = {
  'missing-translation': '漏译', 'missing-variable': '变量缺失', 'link-mismatch': '链接不一致', glossary: '术语不一致', 'code-format': '代码格式',
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

interface EditorSnapshot {
  segments: Segment[]
  discussions: Discussion[]
}

export function LocalizationWorkbench() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [segments, setSegments] = useState<Segment[]>(seedSegments)
  const [glossary, setGlossary] = useState<GlossaryTerm[]>(seedGlossary)
  const [discussions, setDiscussions] = useState<Discussion[]>(seedDiscussions)
  const [history, setHistory] = useState<HistoryEntry[]>(seedHistory)
  const [conflicts, setConflicts] = useState<TranslationConflict[]>(seedConflicts)
  const [checkedIssues, setCheckedIssues] = useState<TranslationIssue[] | null>(null)
  const [selectedSegmentId, setSelectedSegmentId] = useState('seg-05')
  const [mode, setMode] = useState<'translate' | 'review'>('translate')
  const [filter, setFilter] = useState<'all' | 'issues' | 'untranslated' | 'confirmed'>('all')
  const [glossarySearch, setGlossarySearch] = useState('')
  const [discussionDraft, setDiscussionDraft] = useState('')
  const [selectedForReturn, setSelectedForReturn] = useState<Set<string>>(new Set())
  const [returnReason, setReturnReason] = useState('请根据术语表修改后重新提交。')
  const [dirty, setDirty] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [past, setPast] = useState<EditorSnapshot[]>([])
  const [future, setFuture] = useState<EditorSnapshot[]>([])

  const documentQuery = useQuery({
    queryKey: ['localization-document'],
    queryFn: async () => {
      const response = await fetch('/api/document')
      if (!response.ok) throw new Error('document request failed')
      return response.json()
    },
    initialData: seedDocument,
  })
  const historyQuery = useQuery({
    queryKey: ['localization-history'],
    queryFn: async () => {
      const response = await fetch('/api/history')
      if (!response.ok) throw new Error('history request failed')
      return response.json() as Promise<HistoryEntry[]>
    },
    initialData: seedHistory,
  })
  const conflictQuery = useQuery({
    queryKey: ['localization-conflicts'],
    queryFn: async () => {
      const response = await fetch('/api/conflicts')
      if (!response.ok) throw new Error('conflicts request failed')
      return response.json() as Promise<TranslationConflict[]>
    },
    initialData: seedConflicts,
  })

  const checkMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ segments, glossary }) })
      if (!response.ok) throw new Error('check failed')
      return response.json() as Promise<{ checkedAt: number; issues: TranslationIssue[] }>
    },
    onSuccess: (data) => {
      setCheckedIssues(data.issues)
      setFilter('issues')
    },
  })
  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: seedDocument.id, segments, discussions }) })
      if (!response.ok) throw new Error('save failed')
      return response.json()
    },
    onSuccess: () => {
      setDirty(false)
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ segments, discussions, glossary, history })) } catch { /* storage may be unavailable */ }
    },
  })
  const reviewMutation = useMutation({
    mutationFn: async (payload: { action: string; segmentIds: string[]; reason?: string }) => {
      const response = await fetch('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!response.ok) throw new Error('review failed')
      return response.json()
    },
  })

  const liveIssues = useMemo(() => analyzeDocument(segments, glossary), [segments, glossary])
  const issues = checkedIssues ?? liveIssues
  const issueMap = useMemo(() => issues.reduce<Record<string, TranslationIssue[]>>((map, issue) => {
    map[issue.segmentId] = [...(map[issue.segmentId] ?? []), issue]
    return map
  }, {}), [issues])
  const issueSegmentIds = useMemo(() => new Set(issues.map((issue) => issue.segmentId)), [issues])
  const filteredSegments = useMemo(() => segments.filter((segment) => {
    if (filter === 'issues') return issueSegmentIds.has(segment.id)
    if (filter === 'untranslated') return !segment.targetText.trim()
    if (filter === 'confirmed') return segment.status === 'confirmed'
    return true
  }), [filter, issueSegmentIds, segments])
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId) ?? segments[0]
  const confirmedCount = segments.filter((segment) => segment.status === 'confirmed').length
  const translatedCount = segments.filter((segment) => segment.targetText.trim()).length
  const progress = segments.length ? Math.round((confirmedCount / segments.length) * 100) : 0
  const filteredGlossary = glossary.filter((term) => `${term.source} ${term.target}`.toLowerCase().includes(glossarySearch.toLowerCase()))
  const selectedDiscussions = discussions.filter((discussion) => discussion.segmentId === selectedSegment?.id)
  const mockConnected = documentQuery.isFetched && historyQuery.isFetched && conflictQuery.isFetched

  useEffect(() => {
    if (hydrated) return
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const draft = JSON.parse(raw) as { segments: Segment[]; discussions: Discussion[]; glossary: GlossaryTerm[]; history: HistoryEntry[] }
        if (draft.segments?.length) {
          setSegments(draft.segments)
          setDiscussions(draft.discussions ?? seedDiscussions)
          setGlossary(draft.glossary ?? seedGlossary)
          setHistory(draft.history ?? seedHistory)
        }
      }
    } catch { /* start from seed */ }
    setHydrated(true)
  }, [hydrated])

  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ segments, discussions, glossary, history })) } catch { /* storage may be unavailable */ }
  }, [discussions, glossary, history, hydrated, segments])

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  const snapshot = (): EditorSnapshot => ({ segments: clone(segments), discussions: clone(discussions) })
  const pushHistoryEntry = (segmentId: string, action: HistoryEntry['action'], before: string, after: string, author = '当前用户') => {
    setHistory((current) => [{ id: `history-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, segmentId, author, action, before, after, createdAt: Date.now() }, ...current])
  }
  const replaceState = (next: EditorSnapshot, markDirty = true) => {
    setPast((current) => [...current.slice(-49), snapshot()])
    setFuture([])
    setSegments(next.segments)
    setDiscussions(next.discussions)
    setCheckedIssues(null)
    if (markDirty) setDirty(true)
  }
  const updateTarget = (segment: Segment, targetText: string) => {
    const next = segments.map((item) => item.id === segment.id ? { ...item, targetText, status: item.status === 'confirmed' ? 'draft' as const : item.status } : item)
    replaceState({ segments: next, discussions: clone(discussions) })
  }
  const updateStatus = (segmentId: string, status: SegmentStatus, action: HistoryEntry['action'] = status === 'confirmed' ? 'confirm' : 'return') => {
    const segment = segments.find((item) => item.id === segmentId)
    if (!segment) return
    const next = segments.map((item) => item.id === segmentId ? { ...item, status } : item)
    replaceState({ segments: next, discussions: clone(discussions) })
    pushHistoryEntry(segmentId, action, segment.targetText, segment.targetText)
    setSelectedForReturn((current) => { const copy = new Set(current); copy.delete(segmentId); return copy })
  }
  const undo = () => {
    const previous = past.at(-1)
    if (!previous) return
    setFuture((current) => [snapshot(), ...current])
    setPast((current) => current.slice(0, -1))
    setSegments(previous.segments)
    setDiscussions(previous.discussions)
    setCheckedIssues(null)
    setDirty(true)
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setPast((current) => [...current, snapshot()])
    setFuture((current) => current.slice(1))
    setSegments(next.segments)
    setDiscussions(next.discussions)
    setCheckedIssues(null)
    setDirty(true)
  }
  const selectAndScroll = (segmentId: string) => {
    setSelectedSegmentId(segmentId)
    requestAnimationFrame(() => document.getElementById(`segment-${segmentId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  const nextIssue = (direction: 1 | -1 = 1) => {
    const ids = Array.from(new Set(issues.map((issue) => issue.segmentId)))
    if (!ids.length) return
    const index = Math.max(0, ids.indexOf(selectedSegmentId))
    const nextIndex = direction > 0 ? (index + 1) % ids.length : (index - 1 + ids.length) % ids.length
    selectAndScroll(ids[nextIndex])
  }
  const addDiscussion = () => {
    if (!selectedSegment || !discussionDraft.trim()) return
    const nextDiscussion: Discussion = { id: `discussion-${Date.now()}`, segmentId: selectedSegment.id, author: '译者 · 当前用户', body: discussionDraft.trim(), resolved: false, createdAt: Date.now() }
    replaceState({ segments: clone(segments), discussions: [nextDiscussion, ...discussions] })
    pushHistoryEntry(selectedSegment.id, 'discussion', '', nextDiscussion.body)
    setDiscussionDraft('')
  }
  const bulkReturn = () => {
    if (!selectedForReturn.size) return
    const ids = Array.from(selectedForReturn)
    const next = segments.map((segment) => ids.includes(segment.id) ? { ...segment, status: 'returned' as const } : segment)
    replaceState({ segments: next, discussions: clone(discussions) })
    ids.forEach((id) => pushHistoryEntry(id, 'return', returnReason, `退回原因：${returnReason}`, '审校 · 当前用户'))
    void reviewMutation.mutateAsync({ action: 'bulk-return', segmentIds: ids, reason: returnReason })
    setSelectedForReturn(new Set())
  }
  const resolveConflict = (conflict: TranslationConflict, strategy: 'local' | 'remote') => {
    const targetText = strategy === 'local' ? conflict.localText : conflict.remoteText
    const segment = segments.find((item) => item.id === conflict.segmentId)
    const next = segments.map((item) => item.id === conflict.segmentId ? { ...item, targetText, status: 'draft' as const } : item)
    replaceState({ segments: next, discussions: clone(discussions) })
    if (segment) pushHistoryEntry(segment.id, 'resolve-conflict', segment.targetText, targetText, strategy === 'local' ? '保留本地' : conflict.remoteAuthor)
    setConflicts((current) => current.filter((item) => item.id !== conflict.id))
  }
  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const imported = parseMarkdown(await file.text())
    if (!imported.length) return
    replaceState({ segments: imported, discussions: [] })
    pushHistoryEntry(imported[0].id, 'import', '', file.name)
    setSelectedSegmentId(imported[0].id)
    event.target.value = ''
  }
  const exportMarkdown = () => {
    const blob = new Blob([renderTargetMarkdown(segments)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = documentQuery.data.sourceFile.replace(/\.md$/, '.zh-CN.md')
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const toggleReturnSelection = (segmentId: string) => {
    setSelectedForReturn((current) => {
      const next = new Set(current)
      next.has(segmentId) ? next.delete(segmentId) : next.add(segmentId)
      return next
    })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); event.shiftKey ? redo() : undo(); return
      }
      if (editing) return
      if (event.key.toLowerCase() === 'j') { event.preventDefault(); nextIssue(1) }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); nextIssue(-1) }
      if (event.key.toLowerCase() === 'c' && selectedSegment && mode === 'review') updateStatus(selectedSegment.id, 'confirmed')
      if (event.key.toLowerCase() === 'r' && selectedSegment && mode === 'review') updateStatus(selectedSegment.id, 'returned')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#e8f1ff_0,transparent_32%)] pb-24">
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-slate-950/95 text-white shadow-xl backdrop-blur">
        <div className="mx-auto flex max-w-[1800px] items-center gap-5 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-blue-400/30 bg-blue-500/15 text-blue-300"><Languages className="h-5 w-5" /></div>
            <div className="min-w-0"><h1 className="truncate font-semibold tracking-tight">开源文档本地化工作台</h1><p className="truncate text-[11px] text-slate-400">{documentQuery.data.sourceFile} · {documentQuery.data.title}</p></div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Badge className={cn(mockConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300', 'border-0')}>{mockConnected ? <Cloud className="mr-1 h-3 w-3" /> : <CloudOff className="mr-1 h-3 w-3" />}{mockConnected ? 'MSW 已连接' : '连接模拟接口'}</Badge>
            <Badge className={cn('border-0', dirty ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-700 text-slate-200')}>{saveMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}{saveMutation.isPending ? '保存中' : dirty ? '草稿未保存' : '已持久化'}</Badge>
          </div>
          <div className="header-actions ml-auto flex items-center gap-2">
            <Tabs value={mode} onValueChange={(value) => setMode(value as 'translate' | 'review')}><TabsList className="bg-slate-800"><TabsTrigger value="translate" className="text-slate-300 data-[state=active]:bg-blue-600 data-[state=active]:text-white">翻译</TabsTrigger><TabsTrigger value="review" className="text-slate-300 data-[state=active]:bg-blue-600 data-[state=active]:text-white">审校</TabsTrigger></TabsList></Tabs>
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={undo} disabled={!past.length}><Undo2 className="h-4 w-4" />撤销</Button>
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={redo} disabled={!future.length}><RotateCw className="h-4 w-4" />重做</Button>
            <input ref={fileInput} type="file" accept=".md,.markdown,text/markdown" className="hidden" onChange={(event) => void importMarkdown(event)} />
            <Button variant="outline" size="sm" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white" onClick={() => fileInput.current?.click()}><Import className="h-4 w-4" />导入</Button>
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}><Save className="h-4 w-4" />保存</Button>
          </div>
        </div>
      </header>

      <div className="border-b bg-white/85 px-4 py-2.5 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-600">
          <span><b className="text-slate-900">{segments.length}</b> 个内容块</span>
          <span><b className="text-slate-900">{translatedCount}</b> 已翻译</span>
          <span className="flex items-center gap-1"><CircleAlert className="h-3.5 w-3.5 text-amber-600" /><b className="text-slate-900">{issues.length}</b> 个检查结果</span>
          <span className="flex items-center gap-1"><CheckCheck className="h-3.5 w-3.5 text-emerald-600" /><b className="text-slate-900">{confirmedCount}</b> 已确认</span>
          <div className="ml-auto flex min-w-[220px] items-center gap-3"><span>审校进度 {progress}%</span><Progress value={progress} className="w-36" /></div>
          <Button size="sm" variant="secondary" onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending}>{checkMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}运行本地术语检查</Button>
          <Button size="sm" variant="outline" onClick={exportMarkdown}><Download className="h-4 w-4" />导出译文</Button>
        </div>
      </div>

      <main className="workbench-grid mx-auto grid max-w-[1800px] grid-cols-[270px_minmax(620px,1fr)_340px] gap-4 p-4 lg:p-5">
        <aside className="workbench-left space-y-4">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><BookOpen className="h-4 w-4 text-blue-600" />本地术语表 <Badge variant="secondary">{glossary.length}</Badge></CardTitle><div className="relative mt-2"><Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" /><Input value={glossarySearch} onChange={(event) => setGlossarySearch(event.target.value)} placeholder="搜索术语" className="h-9 pl-8 text-xs" /></div></CardHeader>
            <CardContent className="space-y-2">
              {filteredGlossary.map((term) => <div key={term.id} className="rounded-lg border bg-slate-50/70 p-2.5"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-slate-800">{term.source}</span><ChevronRight className="h-3.5 w-3.5 text-slate-400" /><span className="text-xs font-semibold text-blue-700">{term.target}</span></div><p className="mt-1 text-[10px] leading-relaxed text-slate-500">{term.note}</p></div>)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><AlertCircle className="h-4 w-4 text-amber-600" />问题导航 <Badge variant={issues.length ? 'warning' : 'success'}>{issues.length}</Badge></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {issues.slice(0, 14).map((issue) => {
                const segment = segments.find((item) => item.id === issue.segmentId)
                return <button key={issue.id} className={cn('w-full rounded-lg border p-2.5 text-left transition hover:border-blue-300 hover:bg-blue-50', selectedSegmentId === issue.segmentId && 'border-blue-300 bg-blue-50')} onClick={() => selectAndScroll(issue.segmentId)}><div className="flex items-center justify-between gap-2"><Badge variant={issue.severity === 'error' ? 'destructive' : 'warning'}>{issueLabel[issue.type]}</Badge><span className="text-[10px] text-slate-400">#{segment?.index}</span></div><p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{issue.message}</p></button>
              })}
              {!issues.length && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-xs text-emerald-700"><Check className="mx-auto mb-2 h-5 w-5" />所有检查已通过</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm"><GitCompare className="h-4 w-4 text-violet-600" />批量退回</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-3 text-[11px] leading-relaxed text-slate-500">在段落标题处勾选需要退回的片段，填写原因后统一提交。</p>
              <Textarea value={returnReason} onChange={(event) => setReturnReason(event.target.value)} rows={3} className="text-xs" />
              <Button className="mt-3 w-full" variant="destructive" disabled={!selectedForReturn.size || reviewMutation.isPending} onClick={bulkReturn}>{reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UndoDot className="h-4 w-4" />}批量退回 {selectedForReturn.size || ''}</Button>
            </CardContent>
          </Card>
        </aside>

        <section className="workbench-center min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-2.5 shadow-sm">
            <div className="flex items-center rounded-lg bg-slate-100 p-1">
              {([['all', '全部'], ['issues', '问题'], ['untranslated', '漏译'], ['confirmed', '已确认']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', filter === value ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>{label}</button>)}
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-500"><span>{filteredSegments.length} / {segments.length}</span><Button variant="outline" size="sm" onClick={() => nextIssue(-1)}><ArrowUp className="h-3.5 w-3.5" />上一问题</Button><Button variant="outline" size="sm" onClick={() => nextIssue(1)}>下一问题<ArrowDown className="h-3.5 w-3.5" /></Button></div>
          </div>

          {filteredSegments.map((segment) => {
            const segmentIssues = issueMap[segment.id] ?? []
            const isSelected = selectedSegment?.id === segment.id
            const isReturnSelected = selectedForReturn.has(segment.id)
            return (
              <article id={`segment-${segment.id}`} key={segment.id} onClick={() => setSelectedSegmentId(segment.id)} className={cn('scroll-mt-32 overflow-hidden rounded-xl border bg-white shadow-sm transition', isSelected && 'ring-2 ring-blue-500/30', segment.status === 'returned' && 'border-red-200', segmentIssues.some((issue) => issue.severity === 'error') && 'border-red-200')}>
                <header className="flex flex-wrap items-center gap-2 border-b bg-slate-50/80 px-3 py-2.5">
                  <input type="checkbox" checked={isReturnSelected} onChange={() => toggleReturnSelection(segment.id)} className="h-4 w-4 rounded border-slate-300 accent-blue-600" aria-label={`选择片段 ${segment.index}`} />
                  <span className="text-[11px] font-semibold text-slate-500">#{String(segment.index).padStart(2, '0')}</span>
                  <Badge variant="outline" className="gap-1 text-[10px]">{kindIcon[segment.kind]}{kindLabel[segment.kind]}</Badge>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusClass[segment.status])}>{statusLabel[segment.status]}</span>
                  {segment.protectedTokens.length > 0 && <Badge variant="secondary" className="gap-1 text-[10px]"><Variable className="h-3 w-3" />{segment.protectedTokens.length} 个受保护标记</Badge>}
                  {!!segmentIssues.length && <Badge variant="destructive" className="ml-auto">{segmentIssues.length} 个问题</Badge>}
                  <div className={cn('flex gap-1.5', !segmentIssues.length && 'ml-auto')}>
                    {mode === 'review' && <><Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={(event) => { event.stopPropagation(); updateStatus(segment.id, 'confirmed') }}><Check className="h-3.5 w-3.5" />确认</Button><Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={(event) => { event.stopPropagation(); updateStatus(segment.id, 'returned') }}><X className="h-3.5 w-3.5" />退回</Button></>}
                  </div>
                </header>
                <div className="compare-grid grid grid-cols-2 divide-x">
                  <div className="min-w-0 p-3.5">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">English · Source</span><Badge variant="outline" className="text-[9px]">只读</Badge></div>
                    <div className={cn('document-prose text-sm leading-6 text-slate-700', segment.kind === 'code' && 'markdown-code rounded-lg bg-slate-950 p-3 text-xs text-slate-100')}>{segment.sourceText}</div>
                    {segment.note && <p className="mt-3 rounded-md bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700">译者备注：{segment.note}</p>}
                  </div>
                  <div className="min-w-0 p-3.5">
                    <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-blue-500">简体中文 · Target</span>{mode === 'translate' ? <Badge variant="outline" className="text-[9px]">编辑中</Badge> : <Badge variant="secondary" className="text-[9px]">审校只读</Badge>}</div>
                    <Textarea id={`target-${segment.id}`} value={segment.targetText} readOnly={mode === 'review'} onChange={(event) => updateTarget(segment, event.target.value)} rows={Math.max(3, Math.ceil(segment.sourceText.length / 46))} className={cn('min-h-[84px] resize-y border-slate-200 bg-slate-50/40 text-sm leading-6 focus-visible:bg-white', segment.kind === 'code' && 'markdown-code text-xs')} placeholder="在此输入译文，或保留代码块原样…" />
                    {segment.protectedTokens.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{segment.protectedTokens.map((token) => <code key={token} className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">{token}</code>)}</div>}
                  </div>
                </div>
                {!!segmentIssues.length && <div className="border-t bg-red-50/50 px-3.5 py-2.5"><div className="space-y-1.5">{segmentIssues.map((issue) => <div key={issue.id} className="flex items-start gap-2 text-[11px]"><CircleAlert className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', issue.severity === 'error' ? 'text-red-600' : 'text-amber-600')} /><span className={issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>{issue.message}</span></div>)}</div></div>}
                <footer className="flex items-center gap-2 border-t bg-white px-3 py-2 text-[10px] text-slate-400"><span>点击正文可切换当前片段</span><span>·</span><span>MSW 本地校验</span><button className="ml-auto flex items-center gap-1 text-blue-600 hover:underline" onClick={(event) => { event.stopPropagation(); setSelectedSegmentId(segment.id); document.getElementById('discussion-tab')?.click() }}><MessageSquare className="h-3 w-3" />讨论 {discussions.filter((item) => item.segmentId === segment.id && !item.resolved).length}</button></footer>
              </article>
            )
          })}
          {!filteredSegments.length && <Card><CardContent className="grid min-h-52 place-items-center text-center"><div><Sparkles className="mx-auto h-7 w-7 text-blue-500" /><p className="mt-3 text-sm font-medium">当前筛选下没有片段</p><p className="mt-1 text-xs text-slate-500">切换筛选条件或运行检查。</p></div></CardContent></Card>}
        </section>

        <aside className="workbench-right min-w-0">
          <Card className="sticky top-[74px] max-h-[calc(100vh-96px)] overflow-hidden">
            <Tabs defaultValue="discussion" className="flex h-full flex-col">
              <TabsList className="mx-3 mt-3 grid grid-cols-4"><TabsTrigger id="discussion-tab" value="discussion" className="px-1 text-[11px]">讨论</TabsTrigger><TabsTrigger value="issues" className="px-1 text-[11px]">问题</TabsTrigger><TabsTrigger value="history" className="px-1 text-[11px]">历史</TabsTrigger><TabsTrigger value="conflicts" className="px-1 text-[11px]">冲突 {conflicts.length ? `(${conflicts.length})` : ''}</TabsTrigger></TabsList>
              <TabsContent value="discussion" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3">
                <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-2.5"><p className="text-[10px] font-semibold text-blue-800">当前片段 #{selectedSegment?.index}</p><p className="mt-1 line-clamp-3 text-xs leading-5 text-blue-700">{selectedSegment?.targetText || selectedSegment?.sourceText}</p></div>
                <div className="mt-3 flex gap-2"><Textarea value={discussionDraft} onChange={(event) => setDiscussionDraft(event.target.value)} rows={2} placeholder="针对当前句子留下讨论…" className="text-xs" /><Button size="icon" className="h-auto self-stretch" onClick={addDiscussion}><Send className="h-4 w-4" /></Button></div>
                <div className="mt-4 space-y-3">{selectedDiscussions.map((discussion) => <div key={discussion.id} className="rounded-lg border p-3"><div className="flex items-center justify-between"><b className="text-xs text-slate-800">{discussion.author}</b><Badge variant={discussion.resolved ? 'success' : 'warning'}>{discussion.resolved ? '已解决' : '待回应'}</Badge></div><p className="mt-2 text-xs leading-5 text-slate-600">{discussion.body}</p><p className="mt-2 text-[10px] text-slate-400">{hydrated ? new Date(discussion.createdAt).toLocaleString('zh-CN') : null}</p></div>)}{!selectedDiscussions.length && <p className="py-8 text-center text-xs text-slate-400">当前片段还没有讨论</p>}</div>
              </TabsContent>
              <TabsContent value="issues" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-2">{issues.map((issue) => <button key={issue.id} onClick={() => selectAndScroll(issue.segmentId)} className="w-full rounded-lg border p-3 text-left hover:border-amber-300 hover:bg-amber-50"><div className="flex items-center justify-between"><Badge variant={issue.severity === 'error' ? 'destructive' : 'warning'}>{issueLabel[issue.type]}</Badge><span className="text-[10px] text-slate-400">#{segments.find((item) => item.id === issue.segmentId)?.index}</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{issue.message}</p></button>)}{!issues.length && <p className="py-8 text-center text-xs text-emerald-600">没有待处理问题</p>}</div></TabsContent>
              <TabsContent value="history" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-0">{history.map((entry) => <div key={entry.id} className="relative border-l border-slate-200 pb-4 pl-4"><span className="absolute -left-1.5 top-0 h-3 w-3 rounded-full border-2 border-white bg-blue-500" /><div className="flex items-center justify-between"><b className="text-[11px] text-slate-700">{entry.author}</b><span className="text-[9px] text-slate-400">{hydrated ? new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null}</span></div><p className="mt-1 text-[10px] text-slate-500">片段 #{segments.find((item) => item.id === entry.segmentId)?.index ?? '—'} · {entry.action}</p>{entry.after && <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-slate-400">{entry.after}</p>}</div>)}</div></TabsContent>
              <TabsContent value="conflicts" className="m-0 max-h-[calc(100vh-160px)] overflow-auto p-3"><div className="space-y-3">{conflicts.map((conflict) => <div key={conflict.id} className="overflow-hidden rounded-lg border border-red-200"><div className="bg-red-50 px-3 py-2"><b className="text-xs text-red-800">片段 #{segments.find((item) => item.id === conflict.segmentId)?.index} 存在并发修改</b><p className="mt-1 text-[10px] text-red-600">{conflict.remoteAuthor} 修改了同一句</p></div><div className="space-y-2 p-3"><div><span className="text-[9px] font-semibold text-slate-400">本地版本</span><p className="mt-1 text-[11px] leading-5 text-slate-600">{conflict.localText}</p></div><div><span className="text-[9px] font-semibold text-slate-400">远端版本</span><p className="mt-1 text-[11px] leading-5 text-blue-700">{conflict.remoteText}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => resolveConflict(conflict, 'local')}>保留本地</Button><Button size="sm" onClick={() => resolveConflict(conflict, 'remote')}>采用远端</Button></div></div></div>)}{!conflicts.length && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center text-xs text-emerald-700"><Check className="mx-auto mb-2 h-5 w-5" />所有冲突已解决</div>}</div></TabsContent>
            </Tabs>
          </Card>
          <div className="mt-3 rounded-xl border bg-slate-950 px-3 py-3 text-[10px] text-slate-400"><p className="mb-2 font-semibold text-slate-200">键盘操作</p><div className="grid grid-cols-2 gap-2"><span><kbd>J</kbd> 下一问题</span><span><kbd>K</kbd> 上一问题</span><span><kbd>C</kbd> 确认</span><span><kbd>R</kbd> 退回</span><span><kbd>⌘ Z</kbd> 撤销</span><span><kbd>⌘ ⇧ Z</kbd> 重做</span></div></div>
        </aside>
      </main>

      {selectedForReturn.size > 0 && <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-slate-950 px-4 py-3 text-white shadow-2xl"><div className="mx-auto flex max-w-[1800px] items-center gap-3"><ShieldCheck className="h-4 w-4 text-amber-300" /><span className="text-xs">已选择 <b>{selectedForReturn.size}</b> 个片段</span><Input value={returnReason} onChange={(event) => setReturnReason(event.target.value)} className="ml-auto max-w-lg border-slate-700 bg-slate-900 text-white" /><Button variant="destructive" size="sm" onClick={bulkReturn}>确认批量退回</Button><Button variant="ghost" size="sm" className="text-slate-300" onClick={() => setSelectedForReturn(new Set())}>取消</Button></div></div>}
    </div>
  )
}

/**
 * 浏览器环境下的 window.api 桥(Docker / Web 部署)。
 *
 * 桌面版:preload(contextBridge)在渲染进程启动前装好 window.api。
 * 浏览器:本模块在 main.tsx 顶部 import,检测 window.api 未定义(无 preload)
 * 时安装同形状的 Web 实现——UI 代码零改动,同一构建产物双环境直跑。
 *
 * 实现映射(对端 = src/main/server/web.ts):
 * - invoke 系方法 → fetch POST /api/invoke {channel, args} → {ok, result};
 * - onStatus/onHit/onLog/onDailyReport/onCategoryReport → 单条共享 EventSource('/api/events'),
 *   按 message 里的 channel 分发给订阅者(EventSource 自带断线重连);
 * - openExternal → 服务端白名单校验通过后 window.open(桌面是 shell.openExternal);
 * - exportBackup → GET /api/backup/export 走 Blob 下载;importBackup → 隐藏
 *   file input 选包上传 POST(桌面是系统对话框)。
 *
 * 认证:服务端配了 token 时,401 会展示一次全屏认证页并存 localStorage
 * ('fw.webToken'),此后请求带 Bearer 头、SSE 带 ?token= 查询参数。并发请求
 * 共用同一轮输入，避免页面初始化时叠出多个系统 prompt。
 *
 * 环境标记:实际安装时在 window 打 __FW_WEB__ = true,isWebMode()/webPort()
 * 导出给 UI 判「桌面 vs 浏览器」(UA 法在嵌入式浏览器会误判,见 Titlebar)。
 */
import type {
  CategoryReportEvent,
  CategoryReportKind,
  DesktopApi,
  Disposition,
  HitFeedbackRequest,
  HitFeedbackResult,
  HitQueryOptions,
  HitQueryResult,
  MatchTestRequest,
  MatchTestResult,
  StatsResult,
  UpdateCheckStatus
} from '@shared/ipc'
import type { DailyReportInfo, EngineStatus, HitRecord, LogEntry } from '@shared/types'
import { IPC } from '@shared/ipc'

const TOKEN_STORAGE_KEY = 'fw.webToken'

function storedToken(): string {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function saveToken(token: string): void {
  try {
    if (token === '') localStorage.removeItem(TOKEN_STORAGE_KEY)
    else localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    /* 隐私模式等存储不可用:每次 401 都会再问一次,可接受 */
  }
}

let pendingTokenRequest: Promise<string | null> | null = null

/**
 * Web 管理端的令牌页。它刻意不走 window.prompt：系统弹窗不能协调并发的 401，
 * 也无法展示令牌错误。页面只会同时存在一份，所有失败请求等它的同一结果。
 */
function requestToken(error = false): Promise<string | null> {
  if (pendingTokenRequest !== null) return pendingTokenRequest

  pendingTokenRequest = new Promise((resolve) => {
    const page = document.createElement('main')
    page.className = 'web-auth-page'
    page.innerHTML = `
      <section class="web-auth-card" aria-labelledby="web-auth-title">
        <div class="web-auth-mark" aria-hidden="true">FW</div>
        <p class="web-auth-kicker">FORUMWATCH</p>
        <h1 id="web-auth-title">请输入访问令牌</h1>
        <p class="web-auth-copy">此管理界面受保护。输入令牌后继续。</p>
        <form class="web-auth-form">
          <label class="web-auth-label" for="web-auth-token">访问令牌</label>
          <input id="web-auth-token" class="input web-auth-input" type="password" autocomplete="current-password" required />
          <p class="web-auth-error" role="alert"${error ? '' : ' hidden'}>令牌无效，请检查后重试。</p>
          <div class="web-auth-actions">
            <button class="btn" type="button" data-web-auth-cancel>取消</button>
            <button class="btn btn-primary" type="submit">进入管理台</button>
          </div>
        </form>
      </section>`

    const input = page.querySelector<HTMLInputElement>('#web-auth-token')!
    const form = page.querySelector<HTMLFormElement>('.web-auth-form')!
    const cancel = page.querySelector<HTMLButtonElement>('[data-web-auth-cancel]')!
    const finish = (token: string | null) => {
      page.remove()
      pendingTokenRequest = null
      resolve(token)
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const token = input.value.trim()
      if (token !== '') finish(token)
    })
    cancel.addEventListener('click', () => finish(null))
    document.body.append(page)
    input.focus()
  })

  return pendingTokenRequest
}

/** 带认证的 fetch：401 时共享一次令牌输入，并在重试前重新读取已保存的令牌。 */
async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const withAuth = (i?: RequestInit): RequestInit => ({
    ...i,
    headers: {
      ...(i?.headers as Record<string, string> | undefined),
      ...(storedToken() !== '' ? { authorization: `Bearer ${storedToken()}` } : {})
    }
  })
  let res = await fetch(input, withAuth(init))
  while (res.status === 401) {
    const asked = await requestToken(storedToken() !== '')
    if (asked === null) return res
    saveToken(asked)
    res = await fetch(input, withAuth(init))
    if (res.status !== 401) refreshEventSource()
  }
  return res
}

/** 单次 invoke:POST /api/invoke;网络层失败也按 {ok:false} 收敛(UI 契约:不 reject) */
async function invokeRaw(channel: string, args: unknown[]): Promise<unknown> {
  let res: Response
  try {
    res = await authFetch('/api/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel, args })
    })
  } catch (err) {
    throw new Error(`网络请求失败(服务不可达?): ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    throw new Error(`服务响应 ${res.status}`)
  }
  const envelope = (await res.json()) as { ok: boolean; result?: unknown; error?: string }
  if (!envelope.ok) throw new Error(envelope.error ?? 'invoke failed')
  return envelope.result
}

type Listener<T> = (payload: T) => void

/** 共享 EventSource:首个订阅时创建;channel → 订阅者集合 */
const subscribers = new Map<string, Set<(payload: unknown) => void>>()
let source: EventSource | null = null

/** 令牌更新后让已建立的未认证 SSE 连接携带新令牌重连。 */
function refreshEventSource(): void {
  if (source === null) return
  source.close()
  source = null
  if (subscribers.size > 0) ensureEventSource()
}

function ensureEventSource(): void {
  if (source !== null) return
  const token = storedToken()
  const qs = token !== '' ? `?token=${encodeURIComponent(token)}` : ''
  source = new EventSource(`/api/events${qs}`)
  source.onmessage = (ev: MessageEvent<string>) => {
    try {
      const { channel, payload } = JSON.parse(ev.data) as { channel: string; payload: unknown }
      const set = subscribers.get(channel)
      if (set !== undefined) for (const fn of set) fn(payload)
    } catch {
      /* 坏帧丢弃 */
    }
  }
}

function subscribe<T>(channel: string, callback: Listener<T>): () => void {
  let set = subscribers.get(channel)
  if (set === undefined) {
    set = new Set()
    subscribers.set(channel, set)
  }
  const fn = callback as (payload: unknown) => void
  set.add(fn)
  ensureEventSource()
  return () => {
    set?.delete(fn)
  }
}

/** 触发浏览器下载一个 Blob(authFetch 拿响应后转存) */
function downloadBlob(res: Response, filename: string): void {
  void res.blob().then((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  })
}

/** 隐藏 file input 选一个 JSON 文件并读文本(导入备份用) */
function pickJsonFile(): Promise<string | null> {
  return new Promise((resolvePick) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file === undefined) {
        resolvePick(null)
        return
      }
      void file.text().then(resolvePick, () => resolvePick(null))
    }
    // 取消选择不触发 change;input 失焦兜底(用户点掉对话框)
    input.oncancel = () => resolvePick(null)
    document.body.appendChild(input)
    input.click()
    input.remove()
  })
}

/** 组装 Web 版 DesktopApi(形状与 preload 完全一致) */
export function createWebApi(): DesktopApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    invokeRaw(channel, args) as Promise<T>

  /**
   * 契约「永不 reject」的通道的兜底(IPC 注释逐条列明:matchTest/queryHits/
   * getStats/hitFeedback/checkUpdate/getUpdateStatus/dispositions*)——网络瞬断
   * (容器重启/发版)时按各自的空值形状返回,不让异常打进 UI 的 effect 链。
   * 其余通道保持 reject(用户动作驱动,UI 有错误展示路径)。
   */
  const safe = <T>(channel: string, fallback: () => T, ...args: unknown[]): Promise<T> =>
    invokeRaw(channel, args)
      .then((r) => r as T)
      .catch((err: unknown) => {
        console.warn(`[web-shim] ${channel} failed, using fallback:`, err)
        return fallback()
      })

  const zeroStats = () => ({
    total: 0,
    byDay: [],
    byMatchedBy: { literal: 0, semantic: 0, rule: 0, matchall: 0 },
    bySource: [],
    keywordHits: [],
    pushFailRate: 0
  })

  return {
    getConfig: () => call('config:get'),
    saveConfig: (config) => call('config:save', config),
    getStatus: () => call('status:get'),
    getHits: () => call('hits:get'),
    getLogs: () => call('logs:get'),
    engineControl: (command) => call('engine:control', command),
    // 服务端做了与桌面一致的白名单校验;通过后浏览器自己开新页
    openExternal: async (url) => {
      const r = await call<{ ok: boolean }>('external:open', url)
      if (r.ok) window.open(url, '_blank', 'noopener,noreferrer')
      return r
    },
    testAiProvider: () => call('ai:test'),
    getDailyReport: (dateLocal) => call('report:get', dateLocal),
    generateDailyReport: () => call('report:generate'),
    listDailyReports: () => call('report:list'),
    // 分类阶段报告(R17):与日报通道同级,保持 reject 语义(UI 有错误展示路径)
    getCategoryReport: (kind: CategoryReportKind, periodKey?: string) =>
      call('category-report:get', kind, periodKey),
    generateCategoryReport: (kind: CategoryReportKind) => call('category-report:generate', kind),
    listCategoryReports: (kind: CategoryReportKind) => call('category-report:list', kind),
    matchTest: (req: MatchTestRequest) =>
      safe('match:test', () => ({
        wouldPush: false,
        stages: [
          {
            stage: 'error',
            label: '网络',
            outcome: 'skip',
            detail: '请求失败:管理服务不可达,请稍后重试'
          }
        ]
      }) satisfies MatchTestResult, req),
    dispositionsRecent: () => safe('dispositions:recent', () => [] as Disposition[]),
    dispositionsDay: (dateLocal) => safe('dispositions:day', () => [] as Disposition[], dateLocal),
    queryHits: (opts: HitQueryOptions) =>
      safe('hits:query', () => ({ total: 0, items: [] }) satisfies HitQueryResult, opts),
    getStats: (days) => safe('stats:get', zeroStats satisfies () => StatsResult, days),
    hitFeedback: (req: HitFeedbackRequest) =>
      safe('hit:feedback', () => ({ ok: false, error: '网络请求失败' }) satisfies HitFeedbackResult, req),
    checkUpdate: () =>
      safe(
        'update:check',
        () =>
          ({
            state: 'error',
            current: '',
            checkedAt: new Date().toISOString(),
            error: '网络请求失败'
          }) satisfies UpdateCheckStatus
      ),
    getUpdateStatus: () =>
      safe(
        'update:status',
        () =>
          ({
            state: 'idle',
            current: '',
            checkedAt: null
          }) satisfies UpdateCheckStatus
      ),
    // 网页端备份:下载/上传(桌面版是系统对话框)
    exportBackup: async () => {
      const res = await authFetch('/api/backup/export')
      if (!res.ok) return { ok: false, error: `导出失败(HTTP ${res.status})` }
      const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
      downloadBlob(res, `forumwatch-backup-${today}.json`)
      return { ok: true, path: `forumwatch-backup-${today}.json(已下载)` }
    },
    importBackup: async () => {
      const text = await pickJsonFile()
      if (text === null) return { ok: false, error: '已取消导入' }
      let res: Response
      try {
        res = await authFetch('/api/backup/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: text
        })
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      if (!res.ok) return { ok: false, error: `导入失败(HTTP ${res.status})` }
      return (await res.json()) as { ok: true; needsRestart: true } | { ok: false; error: string }
    },
    onStatus: (callback: Listener<EngineStatus>) => subscribe(IPC.evStatus, callback),
    onHit: (callback: Listener<HitRecord>) => subscribe(IPC.evHit, callback),
    onLog: (callback: Listener<LogEntry>) => subscribe(IPC.evLog, callback),
    onDailyReport: (callback: Listener<DailyReportInfo>) => subscribe(IPC.evDailyReport, callback),
    onCategoryReport: (callback: Listener<CategoryReportEvent>) =>
      subscribe(IPC.evCategoryReport, callback)
  }
}

/**
 * 入口副作用(main.tsx 顶部 import):浏览器环境(无 preload)安装 Web 版 api。
 * Electron 里 preload 先行装好 window.api → 本函数 no-op(也不打标记)。
 * 实际安装时在 window 打 __FW_WEB__ 标记,供 isWebMode() 判「桌面 vs 浏览器」。
 */
export function installWebApiIfAbsent(): void {
  if (typeof window === 'undefined') return
  const w = window as { api?: DesktopApi; __FW_WEB__?: boolean }
  if (w.api === undefined) {
    w.api = createWebApi()
    w.__FW_WEB__ = true
  }
}

/**
 * 是否 web-shim 浏览器模式:读安装标记。必须渲染时现读、不能缓存模块级值——
 * 安装发生在 main.tsx render 前,但组件模块的 import 早于安装执行,模块级
 * 求值只会读到安装前的 false。(不用 UA 判:嵌入式浏览器宿主是 Electron 应用
 * 时 UA 继承宿主的 'Electron/' 令牌,会把浏览器误判成桌面。)
 */
export function isWebMode(): boolean {
  return (window as { __FW_WEB__?: boolean }).__FW_WEB__ === true
}

/** 浏览器模式下的访问端口(location.port);默认端口(80/443)为 '',归一 null(不拼假端口) */
export function webPort(): string | null {
  return location.port !== '' ? location.port : null
}

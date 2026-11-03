/**
 * 「关于」卡片（R8-B/E1）：当前版本号 + 更新检查（手动 force check / 最近结果
 * 缓存）+ 有新版时「打开下载页」（openExternal——github.com 已并入主进程
 * openExternal 白名单）。三态如实展示：有新版 / 已最新 / 检查失败。
 *
 * 数据面：挂载拉一次 getUpdateStatus（主进程启动 15s 后还有一轮定时检查会
 * 刷新缓存，但本卡不订阅推送——设置页通常短暂停留，下次进来重新拉即可）。
 */
import { useEffect, useState } from 'react'
import type { UpdateCheckStatus } from '@shared/ipc'
import { Field } from './Field'
import { IconCheck, IconRadar } from './icons'
import { formatClock } from '../lib/time'
import { isWebMode } from '../lib/web-shim'

export function AboutCard() {
  const [status, setStatus] = useState<UpdateCheckStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [openErr, setOpenErr] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [confirmUpdate, setConfirmUpdate] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api
      .getUpdateStatus()
      .then((s) => {
        if (!cancelled) setStatus(s)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function check(): Promise<void> {
    setChecking(true)
    try {
      setStatus(await window.api.checkUpdate())
    } catch {
      setStatus((prev) => ({
        state: 'error', current: prev?.current ?? '未知',
        checkedAt: new Date().toISOString(),
        error: '无法连接更新检查服务，请稍后重试或打开官方发布页'
      }))
    } finally {
      setChecking(false)
    }
  }

  async function applyDockerUpdate(): Promise<void> {
    setConfirmUpdate(false)
    setUpdateError(null)
    setUpdating(true)
    const result = await window.api.applyDockerUpdate()
    if (!result.ok) {
      setUpdateError(result.error)
      setUpdating(false)
    }
  }

  async function openDownload(url: string): Promise<void> {
    setOpenErr(false)
    const r = await window.api.openExternal(url)
    if (!r.ok) setOpenErr(true)
  }

  /** 状态行文案（checking 时按钮转圈 .busy、文字不换；这里只描最近结果） */
  const statusText = (): { kind: 'ok' | 'warn' | 'err' | 'muted'; text: string } | null => {
    if (status === null) return null
    const at = status.checkedAt !== null ? ` · ${formatClock(status.checkedAt)}` : ''
    switch (status.state) {
      case 'idle':
        return { kind: 'muted', text: '尚未检查（应用启动 15 秒后自动检查一次）' }
      case 'available':
        return { kind: 'warn', text: `有新版本：v${status.current} → ${status.latest ?? '?'}${at}` }
      case 'up-to-date':
        return { kind: 'ok', text: `已是最新版本（v${status.latest ?? status.current}）${at}` }
      case 'error':
        return { kind: 'err', text: `检查失败：${status.error ?? '未知错误'}${at}` }
    }
  }

  const st = statusText()

  return (
    <section className="card snot">
      <div className="card-head">
        <span className="card-head-group">
          {/* 品牌 logo 走 R12 图标砖（wash 承托 + --color-primary 图形档，§3.4 关于卡）；
              版本号等宽由 .num 承担 */}
          <span className="about-logo">
            <IconRadar size={18} />
          </span>
          <span className="card-title">关于</span>
        </span>
        <span className="card-title-aux num">v{status?.current ?? '…'}</span>
      </div>
      <Field
        label="当前版本"
        hint="版本号来自应用包（package.json）；新版本经 GitHub Releases 发布。"
      >
        <span className="feedback muted num">v{status?.current ?? '…'}</span>
      </Field>
      <Field
        label="检查更新"
        hint="应用启动 15 秒后自动检查一次，此后每 24 小时检查；GitHub API 限流或拒绝访问时自动回退官方发布页。检查失败不影响监控；Docker 部署需手动拉取新镜像。"
      >
        <div className="input-row">
          <button
            type="button"
            className={`btn${checking ? ' busy' : ''}`}
            disabled={checking}
            onClick={() => void check()}
          >
            检查更新
          </button>
          {status?.state === 'error' && (
            <button type="button" className="btn" onClick={() => void openDownload('https://github.com/DeraDream/ForumWatch/releases/latest')}>
              打开官方发布页
            </button>
          )}
          {status?.state === 'available' && isWebMode() && (
            <button type="button" className="btn btn-primary" disabled={updating} onClick={() => setConfirmUpdate(true)}>
              {updating ? '正在更新…' : `立即更新（${status.latest}）`}
            </button>
          )}
          {status?.state === 'available' && !isWebMode() && status.downloadUrl !== undefined && (
            <button type="button" className="btn btn-primary" onClick={() => void openDownload(status.downloadUrl as string)}>
              打开下载页（{status.latest}）
            </button>
          )}
        </div>
        {/* 检查结果反馈位常驻：三态（有新版/已最新/失败）+ 检查时刻 */}
        <div className="op-feedback">
          {st !== null && (
            <span className={`feedback ${st.kind}`}>
              {st.kind === 'ok' && <IconCheck size={12} />}
              {st.text}
            </span>
          )}
        </div>
        {updating && <div className="notice muted-notice">更新进度：正在请求更新器 → 下载镜像 → 重建服务。网页断开后会自动重连并刷新。</div>}
        {updateError !== null && <div className="notice muted-notice">更新未启动：{updateError}</div>}
        {openErr && (
          <div className="notice muted-notice">
            打开下载页失败（浏览器唤起被拒）；可手动访问 GitHub Releases 页面。
          </div>
        )}
      </Field>
      {confirmUpdate && (
        <div className="update-modal-backdrop" role="presentation">
          <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="docker-update-title">
            <h3 id="docker-update-title">更新 ForumWatch</h3>
            <p>将下载新版镜像并短暂重建服务，配置与历史数据不会丢失。</p>
            <div className="input-row">
              <button type="button" className="btn" onClick={() => setConfirmUpdate(false)}>取消</button>
              <button type="button" className="btn btn-primary" onClick={() => void applyDockerUpdate()}>立即更新</button>
            </div>
          </section>
        </div>
      )}
      {updating && (
        <div className="update-modal-backdrop" role="presentation">
          <section className="update-modal" role="dialog" aria-modal="true" aria-labelledby="docker-update-progress-title">
            <h3 id="docker-update-progress-title">正在更新</h3>
            <p>正在请求更新器。镜像已预拉取时会很快完成；服务重建后页面将自动刷新。</p>
            <div className="update-progress" aria-label="更新进行中"><span /></div>
            <p className="feedback muted">检查镜像 → 重建服务 → 等待恢复</p>
          </section>
        </div>
      )}
      {status?.state === 'available' && (
        <Field label="最新版本" hint="下载页含 macOS（dmg）与 Windows（nsis 安装器）两种安装包。">
          <span className="feedback warn num">
            {status.latest}（当前 v{status.current}）
          </span>
        </Field>
      )}
    </section>
  )
}

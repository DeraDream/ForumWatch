/**
 * 「推送策略」卡片（R6-W4）：notify 段的 UI——
 * - 推送总开关（阶段 5a 起「行为」卡废止，本 Field 自该卡并入为首行，
 *   settings.md §7；字段仍存于 draft 顶层 notifyEnabled，由 Settings 下发回写）；
 * - mode 单选：instant 命中即推 / digest 摘要攒批；
 * - digestIntervalMin 数字输入（sanitize 钳 [1,120]，前端只提示不拦截）；
 * - 免打扰：开关 + start/end（HH:MM 时间输入，跨午夜合法——23:00-08:00 表示
 *   当日 23 点到次日 8 点；同值视为空区间不静默）。
 * 窗内模式：silent 立即静默发送；defer（默认）挂起到窗尾逐条补发。
 * 挂起语义（DEC-11）：defer 与摘要模式的命中挂起（不入已读、不计命中）；
 * 挂起队列是内存态，重启丢弃——仍在首页的帖子
 * 会被重新处理（窗内重新入队 / 窗外直接推），不会丢也不会双发。
 */
import type { NotifyConfig } from '@shared/types'
import { Field } from './Field'

const NOTIFY_MODES: { value: NotifyConfig['mode']; title: string; desc: string }[] = [
  { value: 'instant', title: '实时推送', desc: '命中即推（免打扰窗内除外）' },
  { value: 'digest', title: '摘要攒批', desc: '命中先挂起，到间隔后按批合并推送' }
]

export function NotifyCard(props: {
  notify: NotifyConfig
  onChange: (notify: NotifyConfig) => void
  /** 推送总开关（临时静音）——不传则不渲染该 Field（机制字段在 draft 顶层） */
  notifyEnabled?: boolean
  onNotifyEnabledToggle?: () => void
  silentTest?: {
    disabled: boolean
    testing: boolean
    msg: { kind: string; text: string } | null
    onTest: () => void
  }
}) {
  const { notify, onChange } = props

  const intervalNum = Number(String(notify.digestIntervalMin))
  const intervalBad = !Number.isFinite(intervalNum) || intervalNum < 1 || intervalNum > 120

  return (
    <section className="card snot">
      <div className="card-head">
        <span className="card-title">推送策略</span>
        <span className="card-title-aux">
          {notify.mode === 'digest' ? `摘要 · ${notify.digestIntervalMin} 分钟` : '实时'}
          {props.notifyEnabled === false ? ' · 静音中' : ''}
        </span>
      </div>
      {props.notifyEnabled != null && props.onNotifyEnabledToggle != null && (
        <Field label="推送总开关" hint="临时静音：仍记录命中但不推送。">
          <div className="switch-row">
            <button
              type="button"
              role="switch"
              aria-checked={props.notifyEnabled}
              className="switch"
              aria-label="推送总开关"
              onClick={props.onNotifyEnabledToggle}
            />
            <span className="feedback muted">{props.notifyEnabled ? '开启' : '已静音'}</span>
          </div>
        </Field>
      )}
      <Field
        label="推送模式"
        htmlFor="notify-mode-instant"
        hint={
          <span>
            摘要模式下命中不即时推送：先进挂起队列，到达间隔后按插入序合并冲刷
            （每条仍独立成消息，锐评在命中时已生成、冲刷不重打 AI）。
          </span>
        }
      >
        <div className="radios radios-card">
          {NOTIFY_MODES.map((m) => (
            <label className="radio" key={m.value}>
              <input
                id={`notify-mode-${m.value}`}
                type="radio"
                name="notify-mode"
                checked={notify.mode === m.value}
                onChange={() => onChange({ ...notify, mode: m.value })}
              />
              <span className="radio-text">
                <span className="radio-title">{m.title}</span>
                <span className="radio-desc">{m.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </Field>
      <Field
        label="摘要间隔"
        htmlFor="notify-digest-interval"
        hint={
          intervalBad ? (
            <span className="err">需为 1-120 的分钟数（保存时会被钳制）</span>
          ) : (
            <span>摘要模式的攒批窗口（分钟）；从本批第一条挂起起算，保存时钳到 [1,120]。</span>
          )
        }
      >
        <div className="input-row">
          <input
            id="notify-digest-interval"
            className={`input num${intervalBad ? ' invalid' : ''}`}
            type="number"
            min={1}
            max={120}
            step={1}
            value={notify.digestIntervalMin}
            disabled={notify.mode !== 'digest'}
            aria-label="摘要间隔（分钟）"
            onChange={(e) => onChange({ ...notify, digestIntervalMin: Number(e.target.value) })}
          />
          <span className="feedback muted">分钟</span>
        </div>
      </Field>
      <Field
        label="免打扰时段"
        htmlFor="notify-quiet-start"
        hint={
          <span>
            仅在实时模式下生效，窗内按下方「免打扰模式」处理，窗外正常推送。
            时间以运行环境时区为准（Docker 建议 TZ=Asia/Shanghai）。支持<strong>跨午夜</strong>：如 23:00 → 08:00 表示当晚 23 点到
            次日 8 点；起止相同视为未配置。
          </span>
        }
      >
        <div className="switch-row">
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={notify.quietHours.enabled}
            aria-label="免打扰时段"
            onClick={() =>
              onChange({
                ...notify,
                quietHours: { ...notify.quietHours, enabled: !notify.quietHours.enabled }
              })
            }
          />
          <input
            id="notify-quiet-start"
            className={`input input-time num${notify.quietHours.enabled ? '' : ' input-disabled'}`}
            type="time"
            value={notify.quietHours.startHHMM}
            disabled={!notify.quietHours.enabled}
            aria-label="免打扰开始时刻"
            onChange={(e) =>
              onChange({ ...notify, quietHours: { ...notify.quietHours, startHHMM: e.target.value } })
            }
          />
          <span className="feedback muted">至</span>
          <input
            id="notify-quiet-end"
            className={`input input-time num${notify.quietHours.enabled ? '' : ' input-disabled'}`}
            type="time"
            value={notify.quietHours.endHHMM}
            disabled={!notify.quietHours.enabled}
            aria-label="免打扰结束时刻"
            onChange={(e) =>
              onChange({ ...notify, quietHours: { ...notify.quietHours, endHHMM: e.target.value } })
            }
          />
          <span className="feedback muted">{notify.quietHours.enabled ? '开启' : '关闭'}</span>
        </div>
      </Field>
      <Field
        label="免打扰模式"
        hint={
          <span>
            静默推送：窗内立即发送，不积压；Telegram 请求无声通知，Bark 使用被动通知，
            ntfy 使用最低优先级，Webhook 携带 silent 标记（需接收端支持）。声音与振动最终取决于客户端设置。
            不推送：窗内暂存，结束后逐条补发，并非丢弃消息。
            关闭免打扰或不在时段内时，恢复正常推送；摘要模式仍按摘要间隔发送，不叠加免打扰。
            测试前需选择静默推送并保存所有设置；测试会立即向已保存的就绪通道发送，
            不受免打扰开关、时段、监控状态和推送总开关限制。
          </span>
        }
      >
        <div className="quiet-mode-row">
          <div className="quick quiet-mode-tabs" role="group" aria-label="免打扰模式">
            {([
              { value: 'silent', label: '静默推送' },
              { value: 'defer', label: '不推送' }
            ] as const).map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={`btn${(notify.quietHours.mode ?? 'defer') === mode.value ? ' active' : ''}`}
                aria-pressed={(notify.quietHours.mode ?? 'defer') === mode.value}
                disabled={!notify.quietHours.enabled || notify.mode !== 'instant'}
                onClick={() => onChange({
                  ...notify,
                  quietHours: { ...notify.quietHours, mode: mode.value }
                })}
              >
                {mode.label}
              </button>
            ))}
          </div>
          {props.silentTest && (
            <button
              type="button"
              className="btn quiet-test-button"
              disabled={notify.quietHours.mode !== 'silent' || props.silentTest.disabled || props.silentTest.testing}
              onClick={props.silentTest.onTest}
              title="选择静默推送并保存设置后可测试；不受免打扰开关和时段限制"
            >
              {props.silentTest.testing ? '发送中…' : '测试静默推送'}
            </button>
          )}
        </div>
        {props.silentTest?.msg && (
          <div role="status" className={`feedback mt-md ${props.silentTest.msg.kind}`}>
            {props.silentTest.msg.text}
          </div>
        )}
      </Field>
      <Field label="挂起与重启" hint="监控台的「挂起待推送」行实时显示队列条数。">
        <div className="notice muted-notice">
          选择「不推送」时，免打扰窗内的命中会挂起；摘要模式的命中也会挂起
          （不入已读、暂不计数），窗尾 / 到点逐条补发；「静默推送」不进入挂起队列。
          挂起队列保存在内存里，重启会丢弃——仍在首页的帖子重启后会被重新处理
          （窗内重新入队、窗外直接推送），不丢推也不双发。
        </div>
      </Field>
    </section>
  )
}

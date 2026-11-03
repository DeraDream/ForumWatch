import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_APP_CONFIG, type NotifyConfig } from '@shared/types'
import { NotifyCard } from './NotifyCard'

function render(enabled: boolean, mode?: 'silent' | 'defer', notifyMode: NotifyConfig['mode'] = 'instant', unsaved = false) {
  return renderToStaticMarkup(createElement(NotifyCard, {
    notify: {
      ...DEFAULT_APP_CONFIG.notify,
      mode: notifyMode,
      quietHours: { ...DEFAULT_APP_CONFIG.notify.quietHours, enabled, mode }
    },
    onChange: () => {},
    silentTest: { disabled: unsaved, testing: false, msg: null, onTest: () => {} }
  }))
}

describe('免打扰模式切换', () => {
  it('测试按钮仅静默且已保存可点，不受免打扰开关与摘要模式影响', () => {
    expect(render(false, 'silent')).toMatch(/title="[^"]*">测试静默推送/)
    expect(render(false, 'silent', 'digest')).not.toMatch(/disabled="" title="[^"]*">测试静默推送/)
    expect(render(true, 'defer')).toMatch(/disabled="" title="[^"]*">测试静默推送/)
    expect(render(true, 'silent', 'instant', true)).toMatch(/disabled="" title="[^"]*">测试静默推送/)
  })

  it('置于时段下方，默认不推送，包含补发和客户端限制说明', () => {
    const html = render(true)
    expect(html.indexOf('aria-label="免打扰模式"')).toBeGreaterThan(html.indexOf('id="notify-quiet-end"'))
    expect(html).toMatch(/aria-pressed="true">不推送/)
    expect(html).toContain('结束后逐条补发')
    expect(html).toContain('声音与振动最终取决于客户端设置')
  })

  it('选中静默；免打扰关闭或摘要模式下禁用两个选项', () => {
    expect(render(true, 'silent')).toMatch(/aria-pressed="true">静默推送/)
    for (const html of [render(false, 'silent'), render(true, 'silent', 'digest')]) {
      expect(html).toMatch(/disabled="">静默推送/)
      expect(html).toMatch(/disabled="">不推送/)
    }
  })
})

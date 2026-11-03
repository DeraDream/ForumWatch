import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollWithin } from './scroll-within'

afterEach(() => vi.unstubAllGlobals())

function fixture(top = 500, margin = '20px') {
  const scrollTo = vi.fn()
  const scrollIntoView = vi.fn()
  const container = {
    contains: () => true,
    scrollTop: 100,
    clientTop: 1,
    getBoundingClientRect: () => ({ top: 70 }),
    scrollTo
  } as unknown as HTMLElement
  const target = {
    getBoundingClientRect: () => ({ top }), scrollIntoView
  } as unknown as HTMLElement
  vi.stubGlobal('getComputedStyle', () => ({ scrollMarginTop: margin }))
  return { container, target, scrollTo, scrollIntoView }
}

describe('设置页局部锚点滚动', () => {
  it('只滚动内部容器，保留滚动位置与锚点上边距，不调用 scrollIntoView', () => {
    const h = fixture()
    scrollWithin(h.container, h.target, 'smooth')
    expect(h.scrollTo).toHaveBeenCalledWith({ top: 509, behavior: 'smooth' })
    expect(h.scrollIntoView).not.toHaveBeenCalled()
  })

  it('支持减弱动画的 auto 行为，顶部不会滚为负数', () => {
    const h = fixture(-200, 'auto')
    scrollWithin(h.container, h.target, 'auto')
    expect(h.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })

  it('目标不属于容器时不滚动任何祖先', () => {
    const h = fixture()
    h.container.contains = () => false
    scrollWithin(h.container, h.target, 'smooth')
    expect(h.scrollTo).not.toHaveBeenCalled()
    expect(h.scrollIntoView).not.toHaveBeenCalled()
  })
})

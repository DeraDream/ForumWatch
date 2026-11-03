/** 仅滚动指定容器；scrollIntoView 会连带滚动 overflow:hidden 的外层，造成页面错位。 */
export function scrollWithin(
  container: HTMLElement,
  target: HTMLElement,
  behavior: ScrollBehavior
): void {
  if (!container.contains(target)) return
  const margin = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0
  const top = target.getBoundingClientRect().top - container.getBoundingClientRect().top +
    container.scrollTop - container.clientTop - margin
  container.scrollTo({ top: Math.max(0, top), behavior })
}

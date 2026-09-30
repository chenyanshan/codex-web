// Exercise the real event bindings without clicking either paging control.
export async function scrollGesture(page, direction, mobile = page.viewportSize().width < 980, { edge = true } = {}) {
  if (edge) await page.locator('#timeline').evaluate((element, direction) => {
    element.scrollTop = direction < 0 ? Math.min(300, element.clientHeight / 2) : element.scrollHeight - element.clientHeight - Math.min(300, element.clientHeight / 2);
  }, direction);
  const before = await page.locator('#timeline').evaluate(element => {
    const rect = element.getBoundingClientRect();
    const node = [...element.querySelectorAll('[data-timeline-id]')].find(item => item.getBoundingClientRect().bottom > rect.top && item.getBoundingClientRect().top < rect.bottom);
    return { top: element.scrollTop, id: node?.getAttribute('data-timeline-id'), offset: node ? node.getBoundingClientRect().top - rect.top : 0 };
  });
  await page.locator('#timeline').evaluate((element, { direction, mobile }) => {
    if (mobile) {
      const touch = y => new Touch({ identifier: 1, target: element, clientX: 120, clientY: y });
      element.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(240)], bubbles: true }));
      element.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(240 - direction * 40)], bubbles: true }));
      element.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
    } else element.dispatchEvent(new WheelEvent('wheel', { deltaY: direction * 40, bubbles: true, cancelable: true }));
  }, { direction, mobile });
  return before;
}

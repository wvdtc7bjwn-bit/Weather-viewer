export function setupTabs({ onChange }) {
  const root = document.getElementById("main-tabs");
  const buttons = [...document.querySelectorAll(".tab-button")];
  const isMobileSlider = () => window.matchMedia("(max-width: 800px) and (orientation: portrait)").matches;
  let dragPointerId = null;
  let dragStartX = 0;
  let dragStartIndicatorX = 0;
  let dragMoved = false;
  let pendingIndicatorFrame = 0;
  let pendingIndicatorX = 0;
  let suppressClickUntil = 0;

  function setActiveButton(tabId) {
    const previousTab = root?.dataset.activeTab;
    buttons.forEach((item) => item.classList.toggle("active", item.dataset.tab === tabId));
    const activeIndex = buttons.findIndex((item) => item.dataset.tab === tabId);
    if (root) {
      root.dataset.activeTab = tabId;
      if (!root.classList.contains("is-dragging")) {
        root.style.removeProperty("--tab-indicator-x");
      }
    }
    return previousTab !== tabId && activeIndex >= 0;
  }

  function activateTab(tabId) {
    if (!tabId) return;
    if (setActiveButton(tabId)) onChange?.(tabId);
  }

  function getTabFromPoint(clientX) {
    if (!root || buttons.length === 0) return null;
    const rect = root.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(1, rect.width);
    const index = Math.min(buttons.length - 1, Math.max(0, Math.floor(ratio * buttons.length)));
    return buttons[index]?.dataset.tab ?? null;
  }

  function getIndicatorLimits() {
    if (!root || buttons.length === 0) return;
    const rootRect = root.getBoundingClientRect();
    const firstRect = buttons[0].getBoundingClientRect();
    const indicatorWidth = Math.max(1, firstRect.width);
    const shellPadding = Math.max(0, firstRect.left - rootRect.left);
    const maxOffset = Math.max(0, rootRect.width - shellPadding * 2 - indicatorWidth);
    return { maxOffset, shellPadding };
  }

  function getActiveIndicatorOffset() {
    if (!root || buttons.length === 0) return 0;
    const limits = getIndicatorLimits();
    if (!limits) return 0;
    const activeButton = buttons.find((button) => button.classList.contains("active")) ?? buttons[0];
    const rootRect = root.getBoundingClientRect();
    const activeRect = activeButton.getBoundingClientRect();
    return Math.min(limits.maxOffset, Math.max(0, activeRect.left - rootRect.left - limits.shellPadding));
  }

  function setIndicatorOffset(offset) {
    const limits = getIndicatorLimits();
    if (!root || !limits) return;
    pendingIndicatorX = Math.min(limits.maxOffset, Math.max(0, offset));
    if (pendingIndicatorFrame) return;
    pendingIndicatorFrame = window.requestAnimationFrame(() => {
      root.style.setProperty("--tab-indicator-x", `${pendingIndicatorX}px`);
      pendingIndicatorFrame = 0;
    });
  }

  function stopIndicatorDrag() {
    if (!root) return;
    root.classList.remove("is-dragging");
    if (pendingIndicatorFrame) {
      window.cancelAnimationFrame(pendingIndicatorFrame);
      pendingIndicatorFrame = 0;
    }
    window.requestAnimationFrame(() => {
      root.style.removeProperty("--tab-indicator-x");
    });
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      if (Date.now() < suppressClickUntil) return;
      const tabId = button.dataset.tab;
      activateTab(tabId);
    });
  });

  root?.addEventListener("pointerdown", (event) => {
    if (!isMobileSlider()) return;
    dragPointerId = event.pointerId;
    dragStartX = event.clientX;
    dragStartIndicatorX = getActiveIndicatorOffset();
    dragMoved = false;
    root.classList.add("is-dragging");
    setIndicatorOffset(dragStartIndicatorX);
    root.setPointerCapture?.(event.pointerId);
  });

  root?.addEventListener("pointermove", (event) => {
    if (dragPointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - dragStartX) > 6) dragMoved = true;
    if (!dragMoved) return;
    event.preventDefault();
    setIndicatorOffset(dragStartIndicatorX + event.clientX - dragStartX);
  });

  function finishDrag(event) {
    if (dragPointerId !== event.pointerId) return;
    root?.releasePointerCapture?.(event.pointerId);
    if (dragMoved) {
      suppressClickUntil = Date.now() + 250;
      activateTab(getTabFromPoint(event.clientX));
    }
    stopIndicatorDrag();
    dragPointerId = null;
    dragMoved = false;
  }

  root?.addEventListener("pointerup", finishDrag);
  root?.addEventListener("pointercancel", finishDrag);

  const initialTab = buttons.find((button) => button.classList.contains("active"))?.dataset.tab ?? buttons[0]?.dataset.tab;
  if (initialTab) setActiveButton(initialTab);

  return { setActiveButton };
}

let panelToggleInitialized = false;

export function setupPanelToggle({ onLayoutChange } = {}) {
  if (panelToggleInitialized) return;
  panelToggleInitialized = true;

  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const isMobileSheet = () => window.matchMedia("(max-width: 800px)").matches;
  let handle = document.getElementById("sidebar-drawer-handle");
  if (!handle) {
    handle = document.createElement("div");
    handle.id = "sidebar-drawer-handle";
    handle.setAttribute("role", "button");
    handle.setAttribute("tabindex", "0");
    handle.setAttribute("aria-label", "情報シートを開閉");
    handle.setAttribute("aria-expanded", "false");
    sidebar.prepend(handle);
  }

  let drawerState = "peek";
  let drawerOffset = null;
  let dragging = false;
  let startY = 0;
  let startOffset = 0;
  let currentOffset = 0;
  let suppressClickUntil = 0;

  function getSheetHeight() {
    return sidebar.getBoundingClientRect().height || 0;
  }

  function getPeekVisibleHeight() {
    const viewportHeight = window.innerHeight || 0;
    return Math.min(260, Math.max(178, viewportHeight * 0.34));
  }

  function getMiddleVisibleHeight() {
    const sidebarHeight = getSheetHeight();
    const viewportHeight = window.innerHeight || 0;
    const peekHeight = getPeekVisibleHeight();
    return Math.min(
      Math.max(peekHeight + 132, viewportHeight * 0.56),
      Math.max(peekHeight, sidebarHeight - 52),
      sidebarHeight
    );
  }

  function getSnapOffsets() {
    const sidebarHeight = getSheetHeight();
    const peek = Math.max(0, sidebarHeight - getPeekVisibleHeight());
    const middle = Math.max(0, sidebarHeight - getMiddleVisibleHeight());
    return {
      full: 0,
      middle,
      peek
    };
  }

  function getOffsetForState(state) {
    const offsets = getSnapOffsets();
    return offsets[state] ?? offsets.peek;
  }

  function clampOffset(offset) {
    const maxOffset = getSnapOffsets().peek;
    return Math.min(maxOffset, Math.max(0, offset));
  }

  function getCurrentOffset() {
    return drawerOffset ?? getOffsetForState(drawerState);
  }

  function updateDrawerStateFromOffset(offset) {
    const offsets = getSnapOffsets();
    if (offset <= 2) {
      drawerState = "full";
      return;
    }
    if (offset >= offsets.peek - 2) {
      drawerState = "peek";
      return;
    }
    drawerState = "free";
  }

  function setVisibleHeight(offset) {
    const sidebarHeight = getSheetHeight();
    const visibleHeight = Math.max(0, sidebarHeight - offset);
    document.documentElement.style.setProperty("--mobile-sidebar-visible-height", `${visibleHeight}px`);
  }

  function notifyLayoutChange() {
    onLayoutChange?.();
    window.dispatchEvent(new CustomEvent("sidebar-layout-change"));
  }

  function applyTransform(offset = null) {
    if (!isMobileSheet()) {
      sidebar.style.transform = "";
      sidebar.classList.remove("drawer-open");
      sidebar.classList.remove("drawer-middle");
      handle.setAttribute("aria-expanded", "false");
      document.documentElement.style.removeProperty("--mobile-sidebar-visible-height");
      drawerOffset = null;
      return;
    }

    const nextOffset = clampOffset(offset ?? getCurrentOffset());
    sidebar.style.transform = `translateY(${nextOffset}px)`;
    sidebar.classList.toggle("drawer-open", nextOffset <= 2);
    sidebar.classList.toggle("drawer-middle", nextOffset > 2 && nextOffset < getSnapOffsets().peek - 2);
    handle.setAttribute("aria-expanded", String(nextOffset < getSnapOffsets().peek - 2));
    setVisibleHeight(nextOffset);
  }

  function setDrawerState(state) {
    drawerState = state;
    drawerOffset = null;
    sidebar.style.transition = "transform 220ms ease";
    applyTransform();
    window.setTimeout(notifyLayoutChange, 230);
  }

  function setDrawerOffset(offset, { transition = false } = {}) {
    drawerOffset = clampOffset(offset);
    updateDrawerStateFromOffset(drawerOffset);
    sidebar.style.transition = transition ? "transform 160ms ease" : "none";
    applyTransform(drawerOffset);
    notifyLayoutChange();
  }

  handle.addEventListener("pointerdown", (event) => {
    if (!isMobileSheet()) return;
    dragging = true;
    startY = event.clientY;
    startOffset = getCurrentOffset();
    currentOffset = startOffset;
    sidebar.style.transition = "none";
    handle.setPointerCapture?.(event.pointerId);
  });

  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const maxOffset = getSnapOffsets().peek;
    currentOffset = Math.min(maxOffset, Math.max(0, startOffset + event.clientY - startY));
    applyTransform(currentOffset);
    notifyLayoutChange();
  });

  function finishDrag(event) {
    if (!dragging) return;
    dragging = false;
    suppressClickUntil = Date.now() + 250;
    handle.releasePointerCapture?.(event.pointerId);
    setDrawerOffset(currentOffset);
  }

  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
  handle.addEventListener("click", () => {
    if (Date.now() < suppressClickUntil || !isMobileSheet()) return;
    setDrawerState(drawerState === "full" ? "peek" : "full");
  });
  handle.addEventListener("keydown", (event) => {
    if (!isMobileSheet()) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setDrawerOffset(getCurrentOffset() - 96, { transition: true });
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setDrawerOffset(getCurrentOffset() + 96, { transition: true });
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setDrawerState(drawerState === "full" ? "peek" : "full");
  });

  window.addEventListener("resize", () => {
    applyTransform();
    notifyLayoutChange();
  }, { passive: true });
  window.addEventListener("orientationchange", () => {
    window.setTimeout(() => {
      applyTransform();
      notifyLayoutChange();
    }, 250);
  }, { passive: true });

  applyTransform();
}

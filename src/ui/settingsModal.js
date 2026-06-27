let settingsModalInitialized = false;
let settingsOptions = {};
let settingsSearchRequestId = 0;

export function setupSettingsModal(options = {}) {
  settingsOptions = options;
  if (settingsModalInitialized) return;
  settingsModalInitialized = true;

  const button = document.getElementById("settings-button");
  const modal = document.getElementById("settings-modal");
  if (!button || !modal) return;

  button.addEventListener("click", openSettingsModal);
  modal.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-settings-modal-close]")) closeSettingsModal();
    const addResult = event.target.closest("[data-settings-add-my-area]");
    if (addResult) {
      const area = parseAreaDataset(addResult.dataset);
      settingsOptions.onAddArea?.(area);
      clearSettingsSearch();
      return;
    }

    const removeButton = event.target.closest("[data-settings-remove-my-area]");
    if (removeButton?.dataset.settingsRemoveMyArea) {
      settingsOptions.onRemoveArea?.(removeButton.dataset.settingsRemoveMyArea);
      return;
    }

    if (event.target.closest("[data-settings-add-current-location]")) {
      settingsOptions.onAddCurrentLocation?.();
    }
  });

  document.getElementById("settings-my-area-search")?.addEventListener("input", (event) => {
    renderSettingsAreaSearch(event.currentTarget.value);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSettingsModal();
  });
}

export function refreshSettingsModalView() {
  const modal = document.getElementById("settings-modal");
  if (!modal || modal.hidden) return;
  renderSettingsMyAreas();
}

function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  const button = document.getElementById("settings-button");
  if (!modal) return;
  modal.hidden = false;
  button?.setAttribute("aria-expanded", "true");
  document.body.classList.add("modal-open");
  renderSettingsMyAreas();
}

function closeSettingsModal() {
  const modal = document.getElementById("settings-modal");
  const button = document.getElementById("settings-button");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  button?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("modal-open");
}

function renderSettingsMyAreas() {
  const state = settingsOptions.getState?.() ?? {};
  const areas = state.myAreas ?? [];
  const limit = state.myAreaLimit ?? 8;
  const list = document.getElementById("settings-my-area-list");
  const count = document.getElementById("settings-my-area-count");
  const currentButton = document.getElementById("settings-my-area-current");
  if (count) count.textContent = `${areas.length}/${limit}`;

  if (currentButton) {
    const canAddCurrent = state.currentLocation?.status === "found" && state.currentLocation?.areaCode;
    currentButton.disabled = !canAddCurrent || areas.length >= limit;
    currentButton.textContent = canAddCurrent
      ? `${state.currentLocation.prefecture ?? ""}${state.currentLocation.areaName ?? ""}を追加`
      : "現在地をマイエリアに追加";
  }

  if (!list) return;
  if (!areas.length) {
    list.innerHTML = `<p class="settings-my-area-empty">マイエリアはまだ登録されていません。</p>`;
    return;
  }

  list.innerHTML = areas.map((area) => `
    <div class="settings-my-area-item">
      <div>
        <strong>${escapeHtml(area.areaName)}</strong>
        <span>${escapeHtml(area.prefecture || "地域未取得")}</span>
      </div>
      <button type="button" data-settings-remove-my-area="${escapeHtml(area.areaCode)}">削除</button>
    </div>
  `).join("");
}

async function renderSettingsAreaSearch(query) {
  const results = document.getElementById("settings-my-area-results");
  if (!results) return;
  const trimmed = String(query ?? "").trim();
  const requestId = ++settingsSearchRequestId;
  if (!trimmed) {
    results.innerHTML = "";
    return;
  }

  results.innerHTML = `<p class="settings-my-area-empty">検索中...</p>`;
  try {
    const areas = await settingsOptions.onSearchArea?.(trimmed) ?? [];
    if (requestId !== settingsSearchRequestId) return;
    if (!areas.length) {
      results.innerHTML = `<p class="settings-my-area-empty">該当する市区町村が見つかりません。</p>`;
      return;
    }
    results.innerHTML = areas.map((area) => `
      <button
        type="button"
        class="settings-my-area-result"
        data-settings-add-my-area
        data-area-code="${escapeHtml(area.areaCode)}"
        data-area-name="${escapeHtml(area.areaName)}"
        data-prefecture="${escapeHtml(area.prefecture)}"
        data-coordinates="${escapeHtml(JSON.stringify(area.coordinates ?? null))}"
      >
        <strong>${escapeHtml(area.areaName)}</strong>
        <span>${escapeHtml(area.prefecture)}</span>
      </button>
    `).join("");
  } catch (error) {
    if (requestId !== settingsSearchRequestId) return;
    console.warn("[Weather Viewer] settings area search failed", error);
    results.innerHTML = `<p class="settings-my-area-empty">検索できませんでした。</p>`;
  }
}

function clearSettingsSearch() {
  const input = document.getElementById("settings-my-area-search");
  const results = document.getElementById("settings-my-area-results");
  if (input) input.value = "";
  if (results) results.innerHTML = "";
}

function parseAreaDataset(dataset) {
  let coordinates = null;
  try {
    coordinates = JSON.parse(dataset.coordinates ?? "null");
  } catch {
    coordinates = null;
  }
  return {
    areaCode: dataset.areaCode,
    areaName: dataset.areaName,
    prefecture: dataset.prefecture,
    coordinates
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

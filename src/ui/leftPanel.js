const detailsByTab = {
  radar: ["最新レーダー時刻", "降水強度タイル", "将来: アニメーション再生"],
  amedas: ["観測地点", "気温", "将来: 降水量・風向風速・積雪"],
  warnings: ["市区町村別ポリゴン", "注意報", "警報", "特別警報"],
  typhoon: ["台風一覧", "現在位置", "予報円", "暴風警戒域"]
};

const legendsByTab = {
  radar: [["弱い雨", "legend-rain-low"], ["強い雨", "legend-rain-high"]],
  amedas: [["観測地点", "legend-amedas"]],
  warnings: [["注意報", "legend-advisory"], ["警報", "legend-warning"], ["特別警報", "legend-emergency"]],
  typhoon: [["進路", "legend-typhoon"], ["予報円", "legend-forecast"]]
};

export function updateLeftPanel(tab, state = {}) {
  setText("mode-label", tab.label);
  setText("panel-title", tab.title);
  setText("primary-value", tab.primary);
  setText("panel-description", buildDescription(tab, state));
  setText("panel-time", buildTimeText(state));
  renderList("detail-list", detailsByTab[tab.id] ?? []);
  renderLegend(tab.id);

  const primaryCard = document.getElementById("primary-card");
  if (primaryCard) {
    primaryCard.className = `primary-card ${tab.id}-card`;
  }
}

function buildDescription(tab, state) {
  if (state.status === "loading") return `${tab.description}\nデータを取得中です。`;
  if (state.status === "error") return `${tab.description}\n取得に失敗しました。CORSまたはURL変更の可能性があります。`;
  return tab.description;
}

function buildTimeText(state) {
  if (state.status === "loading") return "更新時刻を取得中...";
  if (state.status === "error") return "更新時刻: 取得失敗";
  const value = state.data?.latestTime ?? state.data?.updatedAt ?? state.data?.summary;
  return value ? `更新時刻: ${value}` : "更新時刻: 未取得";
}

function renderList(elementId, items) {
  const root = document.getElementById(elementId);
  if (!root) return;
  root.innerHTML = items.map((item) => `<div class="detail-item">${escapeHtml(item)}</div>`).join("");
}

function renderLegend(tabId) {
  const root = document.getElementById("legend-list");
  if (!root) return;
  root.innerHTML = (legendsByTab[tabId] ?? [])
    .map(([label, className]) => `<div class="legend-item"><span class="legend-swatch ${className}"></span>${escapeHtml(label)}</div>`)
    .join("");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

import {
  AMEDAS_METRICS,
  AMEDAS_PRECIPITATION_LEVELS,
  AMEDAS_SNOW_LEVELS,
  AMEDAS_TEMPERATURE_LEVELS,
  AMEDAS_WIND_LEVELS,
  KIKIKURU_LAYER_OPTIONS,
  KIKIKURU_LEVELS
} from "../config.js";
import { NO_TYPHOON_MESSAGE } from "../jma/typhoon.js";

let selectedWarningAreaCode = "";
let amedasRankingOrder = "top";
let activeWarningAreasByCode = new Map();

const AMEDAS_RANKING_LIMIT = 20;

const legendsByTab = {
  amedas: [["観測地点", "legend-amedas"]],
  warnings: [
    ["特別警報", "legend-emergency"],
    ["危険警報", "legend-danger"],
    ["警報", "legend-warning"],
    ["注意報", "legend-advisory"]
  ],
  typhoon: [
    ["暴風域 (25m/s以上)", "legend-typhoon-storm"],
    ["暴風警戒域", "legend-typhoon-warning-area"],
    ["強風域 (15m/s以上)", "legend-typhoon-strong"],
    ["過去の経路", "legend-typhoon-track"],
    ["警戒領域・予報円", "legend-typhoon-forecast"]
  ]
};

export function updateLeftPanel(tab, state = {}) {
  const amedasMetric = getAmedasMetric(state.amedasMetric ?? state.data?.activeMetric);
  const warningView = state.warningView ?? state.data?.activeWarningView ?? "status";
  const activeKikikuruLayer = state.activeKikikuruLayer ?? state.data?.activeKikikuruLayer ?? KIKIKURU_LAYER_OPTIONS[0]?.id;
  setText("mode-label", tab.label);
  setText("panel-title", buildPanelTitle(tab, state));
  setPanelTitleVisible(tab.id === "typhoon" && state.data?.hasTyphoon !== false);
  setText("panel-description", buildDescription(tab, state));
  setText("panel-time", buildTimeText(state));
  setPanelTimeVisible(tab.id !== "radar");
  renderWarningSubTabs(tab, warningView);
  renderKikikuruLayerTabs(tab, warningView, activeKikikuruLayer);
  renderAmedasSubTabs(tab, amedasMetric.id);
  renderRadarControls(tab, state);
  renderWarningDetails(tab, state, warningView);
  renderTyphoonDetails(tab, state);
  renderAmedasRanking(tab, state, amedasMetric);
  renderLegend(tab.id, amedasMetric.id, warningView);
}

export function setupAmedasSubTabs({ onChange }) {
  const buttons = [...document.querySelectorAll(".amedas-sub-button")];
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const metricId = button.dataset.amedasMetric;
      buttons.forEach((item) => item.classList.toggle("active", item === button));
      onChange?.(metricId);
    });
  });
}

export function setupAmedasRankingToggle({ onChange }) {
  const root = document.getElementById("amedas-ranking");
  if (!root) return;

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-amedas-ranking-order]");
    if (!button) return;
    const order = button.dataset.amedasRankingOrder;
    if (order !== "top" && order !== "bottom") return;
    amedasRankingOrder = order;
    onChange?.();
  });
}

export function setupWarningSubTabs({ onChange }) {
  const buttons = [...document.querySelectorAll(".warning-sub-button")];
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const viewId = button.dataset.warningView;
      buttons.forEach((item) => item.classList.toggle("active", item === button));
      onChange?.(viewId);
    });
  });
}

export function setupKikikuruLayerToggles({ onChange }) {
  const root = document.getElementById("kikikuru-layer-tabs");
  if (!root) return;

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest("[data-kikikuru-layer]");
    if (!button) return;
    onChange?.(button.dataset.kikikuruLayer);
  });
}

export function setupRadarControls({ onSeek, onStep, onTogglePlay, onGoLatest }) {
  document.getElementById("radar-time-slider")?.addEventListener("input", (event) => {
    onSeek?.(Number(event.currentTarget.value));
  });
  document.getElementById("radar-prev")?.addEventListener("click", () => onStep?.(-1));
  document.getElementById("radar-next")?.addEventListener("click", () => onStep?.(1));
  document.getElementById("radar-play")?.addEventListener("click", () => onTogglePlay?.());
  document.getElementById("radar-now")?.addEventListener("click", () => onGoLatest?.());
}

function buildDescription(tab, state) {
  if (tab.id === "amedas") {
    const metric = getAmedasMetric(state.amedasMetric ?? state.data?.activeMetric);
    if (state.status === "loading") return `${metric.label}データを取得中です。`;
    if (state.status === "error") return `${metric.label}データを取得できませんでした。`;
    const count = countAmedasPoints(state.data, metric.id);
    return `アメダス観測地点の${metric.label}を表示しています。${count > 0 ? `\n表示地点: ${count}地点` : ""}`;
  }
  if (tab.id === "warnings") {
    if (state.status === "loading") return "市区町村ごとの警報・注意報を取得中です。";
    if (state.status === "error") return "警報・注意報データを取得できませんでした。";
    if (state.data?.activeWarningView === "kikikuru") {
      if (state.data?.kikikuru?.unavailable) return "キキクルのタイルを取得できませんでした。";
      return "土砂・浸水キキクルを地図上に重ねて表示しています。";
    }
    return "都道府県ごとに、市区町村の注意報・警報・危険警報・特別警報を表示しています。";
  }
  if (tab.id === "typhoon") {
    if (state.status === "loading") return "台風データを取得中です。";
    if (state.status === "error") return "台風データを取得できませんでした。";
    if (state.data?.isPastTelegram) return "提供された過去実電文の台風解析・予報情報を表示しています。";
    if (state.data?.hasTyphoon === false) return "";
    if (state.data?.unavailable) return "台風データを取得できませんでした。詳細項目は未取得として表示しています。";
    return "台風の解析値を表示しています。";
  }
  if (state.status === "loading") return `${tab.description}\nデータを取得中です。`;
  if (state.status === "error") return `${tab.description}\n取得に失敗しました。CORSまたはURL変更の可能性があります。`;
  return tab.description;
}

function buildPanelTitle(tab, state) {
  if (tab.id !== "typhoon") return tab.title;
  if (state.status === "loading") return "台風データ取得中";
  const name = state.data?.details?.name;
  return name && name !== "未取得" ? name : "台風名 未取得";
}

function buildTimeText(state) {
  if (state.status === "loading") return "更新時刻を取得中...";
  if (state.status === "error") return "更新時刻: 取得失敗";
  if (state.data?.hasTyphoon === false) return "更新時刻: --";
  if (state.data?.activeWarningView === "kikikuru") {
    const value = state.data?.kikikuru?.latestTime;
    return value ? `更新時刻: ${value}` : "更新時刻: 未取得";
  }
  const value = state.data?.latestTime ?? state.data?.updatedAt ?? state.data?.summary;
  return value ? `更新時刻: ${value}` : "更新時刻: 未取得";
}

function renderLegend(tabId, amedasMetricId, warningView = "status") {
  const root = document.getElementById("legend-list");
  if (!root) return;
  const items = buildLegendItems(tabId, amedasMetricId, warningView);

  root.innerHTML = items
    .map(([label, className, color]) => {
      const swatchStyle = color ? ` style="background:${escapeHtml(color)}"` : "";
      return `<div class="legend-item"><span class="legend-swatch ${className}"${swatchStyle}></span>${escapeHtml(label)}</div>`;
    })
    .join("");

  if (tabId === "typhoon") {
    root.insertAdjacentHTML("beforeend", `
      <div class="legend-note">
        ※赤い実線は暴風警戒域、白い点線は予報円・予想進路中心線<br>
        ※白い×は台風の中心位置
      </div>
    `);
  }
}

function buildLegendItems(tabId, amedasMetricId, warningView = "status") {
  if (tabId === "radar") {
    return AMEDAS_PRECIPITATION_LEVELS.map((level) => [level.label, "", level.color]);
  }
  if (tabId === "amedas") {
    return getAmedasLevels(amedasMetricId).map((level) => [level.label, "", level.color]);
  }
  if (tabId === "warnings" && warningView === "kikikuru") {
    return KIKIKURU_LEVELS.map((level) => [level.label, "", level.color]);
  }
  return legendsByTab[tabId] ?? [];
}

function renderWarningSubTabs(tab, activeView) {
  const root = document.getElementById("warning-sub-tabs");
  if (!root) return;

  const isWarnings = tab.id === "warnings";
  root.hidden = !isWarnings;
  if (!isWarnings) return;

  [...root.querySelectorAll(".warning-sub-button")].forEach((button) => {
    button.classList.toggle("active", button.dataset.warningView === activeView);
  });
}

function renderKikikuruLayerTabs(tab, warningView, activeLayer) {
  const root = document.getElementById("kikikuru-layer-tabs");
  if (!root) return;

  const isKikikuru = tab.id === "warnings" && warningView === "kikikuru";
  root.hidden = !isKikikuru;
  if (!isKikikuru) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = KIKIKURU_LAYER_OPTIONS.map((element) => `
    <button
      type="button"
      class="kikikuru-layer-button${activeLayer === element.id ? " active" : ""}"
      data-kikikuru-layer="${escapeHtml(element.id)}"
      aria-pressed="${activeLayer === element.id ? "true" : "false"}"
    >${escapeHtml(element.label)}</button>
  `).join("");
}

function renderAmedasSubTabs(tab, activeMetricId) {
  const root = document.getElementById("amedas-sub-tabs");
  if (!root) return;

  const isAmedas = tab.id === "amedas";
  root.hidden = !isAmedas;
  if (!isAmedas) return;

  [...root.querySelectorAll(".amedas-sub-button")].forEach((button) => {
    button.classList.toggle("active", button.dataset.amedasMetric === activeMetricId);
  });
}

function renderRadarControls(tab, state) {
  const root = document.getElementById("radar-time-controls");
  const slider = document.getElementById("radar-time-slider");
  const label = document.getElementById("radar-time-label");
  const kind = document.getElementById("radar-time-kind");
  if (!root || !slider || !label || !kind) return;

  const isRadar = tab.id === "radar";
  root.hidden = !isRadar;
  if (!isRadar) return;

  const frames = state.data?.frames ?? [];
  const activeIndex = Number(state.data?.activeFrameIndex ?? 0);
  const activeFrame = frames[activeIndex] ?? null;
  const latestObservationIndex = findLatestObservationIndex(frames);

  slider.max = String(Math.max(0, frames.length - 1));
  slider.value = String(Math.min(activeIndex, Math.max(0, frames.length - 1)));
  slider.disabled = frames.length <= 1 || state.status === "loading" || state.status === "error";
  slider.style.background = buildSliderBackground(activeIndex, latestObservationIndex, frames.length);

  label.textContent = activeFrame?.label
    ? `更新時刻: ${activeFrame.label}`
    : (state.status === "loading" ? "更新時刻: 取得中" : "更新時刻: --");
  kind.textContent = activeFrame?.isForecast ? "予測" : "観測";
  kind.classList.toggle("forecast", Boolean(activeFrame?.isForecast));

  document.getElementById("radar-play")?.classList.toggle("playing", Boolean(state.radarPlaying));
  const playButton = document.getElementById("radar-play");
  if (playButton) playButton.textContent = state.radarPlaying ? "停止" : "再生";
}

export function setupWarningAreaSelection() {
  const root = document.getElementById("warning-detail-list");
  if (!root) return;

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest(".warning-area-row");
    if (!row?.dataset.warningAreaCode) return;
    selectWarningArea(row.dataset.warningAreaCode, { scroll: false, openModal: true });
  });

  window.addEventListener("weather-warning-area-select", (event) => {
    const areaCode = event.detail?.areaCode;
    if (areaCode) selectWarningArea(areaCode, { scroll: true, openModal: true });
  });

  document.getElementById("warning-modal")?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest("[data-warning-modal-close]")) closeWarningModal();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWarningModal();
  });
}

function selectWarningArea(areaCode, { scroll, openModal } = {}) {
  selectedWarningAreaCode = String(areaCode);
  const root = document.getElementById("warning-detail-list");
  if (!root || root.hidden) return;

  root.querySelectorAll(".warning-area-row.selected").forEach((row) => {
    row.classList.remove("selected");
  });

  const row = root.querySelector(`[data-warning-area-code="${cssEscape(selectedWarningAreaCode)}"]`);
  if (!row) return;

  row.classList.add("selected");
  if (openModal) openWarningModal(selectedWarningAreaCode);
  if (!scroll) return;

  const rootRect = root.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  root.scrollBy({
    top: rowRect.top - rootRect.top - root.clientHeight * 0.38,
    behavior: "smooth"
  });
}

function getAmedasMetric(metricId) {
  return AMEDAS_METRICS.find((item) => item.id === metricId) ?? AMEDAS_METRICS[0];
}

function countAmedasPoints(data = {}, metricId) {
  return (data.points ?? []).filter((point) => {
    const value = point.values?.[metricId];
    return shouldIncludeAmedasValue(metricId, value);
  }).length;
}

function findLatestObservationIndex(frames) {
  return frames.reduce((latestIndex, frame, index) => frame.isForecast ? latestIndex : index, -1);
}

function buildProgressPercent(index, length) {
  if (!length || length <= 1 || index < 0) return "0%";
  return `${Math.max(0, Math.min(100, (index / (length - 1)) * 100))}%`;
}

function buildSliderBackground(activeIndex, observedIndex, length) {
  const active = buildProgressPercent(activeIndex, length);
  const observed = buildProgressPercent(observedIndex, length);
  if (activeIndex <= observedIndex) {
    return `linear-gradient(to right,
      #4cb7f2 0%, #4cb7f2 ${active},
      rgba(255,255,255,0.16) ${active}, rgba(255,255,255,0.16) ${observed},
      rgba(72,196,107,0.34) ${observed}, rgba(72,196,107,0.34) 100%)`;
  }
  return `linear-gradient(to right,
    #4cb7f2 0%, #4cb7f2 ${observed},
    rgba(72,196,107,0.76) ${observed}, rgba(72,196,107,0.76) ${active},
    rgba(255,255,255,0.16) ${active}, rgba(255,255,255,0.16) 100%)`;
}

function renderWarningDetails(tab, state, warningView = "status") {
  const root = document.getElementById("warning-detail-list");
  if (!root) return;

  const isWarnings = tab.id === "warnings" && warningView === "status";
  root.hidden = !isWarnings;
  if (!isWarnings) {
    root.innerHTML = "";
    activeWarningAreasByCode = new Map();
    closeWarningModal();
    return;
  }

  if (state.status === "loading") {
    root.innerHTML = `<div class="warning-empty">取得中...</div>`;
    activeWarningAreasByCode = new Map();
    return;
  }

  if (state.status === "error") {
    root.innerHTML = `<div class="warning-empty">取得失敗</div>`;
    activeWarningAreasByCode = new Map();
    return;
  }

  const groups = state.data?.groups ?? [];
  if (groups.length === 0) {
    root.innerHTML = `<div class="warning-empty">発表中の警報・注意報はありません</div>`;
    activeWarningAreasByCode = new Map();
    return;
  }

  activeWarningAreasByCode = new Map(
    groups.flatMap((group) => group.areas.map((area) => [String(area.areaCode), area]))
  );

  root.innerHTML = groups.map((group) => `
    <div class="warning-prefecture-label">${escapeHtml(group.prefecture)}<span>${escapeHtml(group.count ?? group.areas.length)}件</span></div>
    ${group.areas.map((area) => `
      <article class="warning-area-row${String(area.areaCode) === selectedWarningAreaCode ? " selected" : ""}" data-warning-area-code="${escapeHtml(area.areaCode)}">
        <strong>${escapeHtml(area.areaName)}</strong>
        <div class="warning-badges">
          ${area.warnings.map((warning) => `
            <span class="warning-badge warning-badge-${escapeHtml(warning.level)}">${escapeHtml(warning.label)}</span>
          `).join("")}
        </div>
      </article>
    `).join("")}
  `).join("");
}

function openWarningModal(areaCode) {
  const area = activeWarningAreasByCode.get(String(areaCode));
  const modal = document.getElementById("warning-modal");
  const content = document.getElementById("warning-modal-content");
  if (!area || !modal || !content) return;

  const warnings = area.warnings ?? [];
  const outlookRows = area.outlook ?? [];
  content.innerHTML = `
    <header class="warning-modal-head">
      <span>${escapeHtml(area.prefecture ?? "")}</span>
      <h2 id="warning-modal-title">${escapeHtml(area.areaName)}</h2>
      <p>更新時刻: ${escapeHtml(formatWarningTime(area.updatedAt))}</p>
    </header>
    <section class="warning-modal-section">
      <h3>発表中の警報・注意報</h3>
      <div class="warning-modal-warning-list">
        ${warnings.map((warning) => `
          <article class="warning-modal-warning">
            <span class="warning-badge warning-badge-${escapeHtml(warning.level)}">${escapeHtml(warning.label)}</span>
            <dl>
              <div><dt>更新時刻</dt><dd>${escapeHtml(formatWarningTime(warning.updatedAt))}</dd></div>
              ${warning.status ? `<div><dt>状態</dt><dd>${escapeHtml(warning.status)}</dd></div>` : ""}
            </dl>
          </article>
        `).join("")}
      </div>
    </section>
    <section class="warning-modal-section">
      <h3>今後の見通し</h3>
      ${buildWarningOutlookTable(outlookRows)}
    </section>
  `;
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

function buildWarningOutlookTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return `<p class="warning-modal-empty">今後の見通しはありません。</p>`;
  }

  const times = rows[0]?.slots ?? [];
  return `
    <div class="warning-outlook-scroll">
      <table class="warning-outlook-table">
        <thead>
          <tr>
            <th>種別</th>
            ${times.map((slot) => `<th>${escapeHtml(formatOutlookTime(slot))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <th>${escapeHtml(row.type)}${row.localName ? `<span>${escapeHtml(row.localName)}</span>` : ""}</th>
              ${row.slots.map((slot) => `
                <td class="warning-outlook-level-${escapeHtml(slot.level ?? 0)}">${escapeHtml(formatOutlookCellLabel(slot))}</td>
              `).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatOutlookCellLabel(slot) {
  if (slot?.label) return slot.label;
  return slot?.level >= 2 ? "" : "-";
}

function closeWarningModal() {
  const modal = document.getElementById("warning-modal");
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function renderAmedasRanking(tab, state, metric) {
  const root = document.getElementById("amedas-ranking");
  if (!root) return;

  const isAmedas = tab.id === "amedas";
  root.hidden = !isAmedas;
  if (!isAmedas) {
    root.innerHTML = "";
    return;
  }

  if (state.status === "loading") {
    root.innerHTML = `<div class="amedas-ranking-empty">ランキング取得中...</div>`;
    return;
  }

  if (state.status === "error") {
    root.innerHTML = `<div class="amedas-ranking-empty">ランキングを表示できません</div>`;
    return;
  }

  const order = metric.id === "temperature" ? amedasRankingOrder : "top";
  const items = buildAmedasRankingItems(state.data, metric, order).slice(0, AMEDAS_RANKING_LIMIT);
  if (items.length === 0) {
    root.innerHTML = `<div class="amedas-ranking-empty">表示できる観測値がありません</div>`;
    return;
  }
  const orderLabel = order === "bottom" ? "下位" : "上位";
  const orderControls = metric.id === "temperature" ? `
    <div class="amedas-ranking-toggle" aria-label="気温ランキング切替">
      <button type="button" data-amedas-ranking-order="top" class="${order === "top" ? "active" : ""}">高い順</button>
      <button type="button" data-amedas-ranking-order="bottom" class="${order === "bottom" ? "active" : ""}">低い順</button>
    </div>
  ` : "";

  root.innerHTML = `
    <div class="amedas-ranking-head">
      <span>${escapeHtml(metric.label)}ランキング</span>
      <small>${orderLabel}${items.length}地点</small>
    </div>
    ${orderControls}
    <div class="amedas-ranking-list">
      ${items.map((item, index) => `
        <div class="amedas-ranking-row">
          <span class="amedas-ranking-rank">${index + 1}</span>
          <span class="amedas-ranking-name">${escapeHtml(item.name)}</span>
          <strong class="amedas-ranking-value" style="--rank-color:${escapeHtml(item.color)}">${escapeHtml(formatAmedasRankingValue(item.value, metric))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function buildAmedasRankingItems(data = {}, metric, order = "top") {
  return (data.points ?? [])
    .map((point) => ({
      name: point.name,
      value: point.values?.[metric.id],
      color: getAmedasLevelColor(metric.id, point.values?.[metric.id])
    }))
    .filter((item) => shouldIncludeAmedasValue(metric.id, item.value))
    .sort((a, b) => order === "bottom" ? a.value - b.value : b.value - a.value);
}

function shouldIncludeAmedasValue(metricId, value) {
  if (!Number.isFinite(value)) return false;
  if (metricId === "precipitation") return value >= 0.1;
  if (metricId === "snow") return value >= 1;
  return true;
}

function formatAmedasRankingValue(value, metric) {
  const fractionDigits = Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(fractionDigits)}${metric.unit}`;
}

function getAmedasLevelColor(metricId, value) {
  const levels = getAmedasLevels(metricId);
  return levels.find((level) => value >= level.min)?.color ?? "#d8e6f7";
}

function getAmedasLevels(metricId) {
  if (metricId === "temperature") return AMEDAS_TEMPERATURE_LEVELS;
  if (metricId === "precipitation") return AMEDAS_PRECIPITATION_LEVELS;
  if (metricId === "wind") return AMEDAS_WIND_LEVELS;
  if (metricId === "snow") return AMEDAS_SNOW_LEVELS;
  return [];
}

function renderTyphoonDetails(tab, state) {
  const root = document.getElementById("typhoon-detail-grid");
  if (!root) return;

  const isTyphoon = tab.id === "typhoon";
  root.hidden = !isTyphoon;
  if (!isTyphoon) {
    root.innerHTML = "";
    return;
  }

  if (state.data?.hasTyphoon === false) {
    root.innerHTML = `
      <div class="typhoon-empty">
        <strong>${escapeHtml(NO_TYPHOON_MESSAGE)}</strong>
      </div>
    `;
    return;
  }

  const details = getTyphoonDetails(state);
  root.innerHTML = [
    ["中心気圧", details.pressure],
    ["最大風速", details.maxWind],
    ["最大瞬間風速", details.maxGust],
    ["移動方向", details.direction],
    ["移動速度", details.speed],
    ["中心位置", details.position]
  ].map(([label, value]) => `
    <div class="typhoon-detail-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function getTyphoonDetails(state) {
  if (state.status === "loading") {
    return buildEmptyTyphoonDetails("取得中");
  }
  if (state.status === "error") {
    return buildEmptyTyphoonDetails("未取得");
  }

  return state.data?.details ?? buildEmptyTyphoonDetails("未取得");
}

function buildEmptyTyphoonDetails(value) {
  return {
    pressure: value,
    maxWind: value,
    maxGust: value,
    direction: value,
    speed: value,
    position: value
  };
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setPanelTitleVisible(isVisible) {
  const element = document.getElementById("panel-title");
  if (element) element.hidden = !isVisible;
}

function setPanelTimeVisible(isVisible) {
  const element = document.getElementById("panel-time");
  if (element) element.hidden = !isVisible;
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

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function formatWarningTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo"
  }).formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${getPart("month")}/${getPart("day")} ${getPart("hour")}:${getPart("minute")}`;
}

function formatOutlookTime(slot) {
  const start = new Date(slot?.time ?? "");
  if (Number.isNaN(start.getTime())) return "--";
  const end = new Date(start.getTime() + parseDurationHours(slot?.duration) * 60 * 60 * 1000);
  const startHour = formatHour(start);
  const endHour = Number.isNaN(end.getTime()) ? "" : formatHour(end);
  return endHour ? `${startHour}-${endHour}` : startHour;
}

function parseDurationHours(value) {
  const match = String(value ?? "").match(/PT(\d+)H/);
  return match ? Number(match[1]) : 0;
}

function formatHour(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo"
  }).format(date);
}

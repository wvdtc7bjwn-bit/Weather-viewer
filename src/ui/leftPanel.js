import {
  AMEDAS_METRICS,
  AMEDAS_PRECIPITATION_LEVELS,
  AMEDAS_SNOW_LEVELS,
  AMEDAS_TEMPERATURE_LEVELS,
  AMEDAS_WIND_LEVELS
} from "../config.js";
import { NO_TYPHOON_MESSAGE } from "../jma/typhoon.js";

let selectedWarningAreaCode = "";

const legendsByTab = {
  amedas: [["観測地点", "legend-amedas"]],
  warnings: [
    ["注意報", "legend-advisory"],
    ["警報", "legend-warning"],
    ["危険警報", "legend-danger"],
    ["特別警報", "legend-emergency"]
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
  setText("mode-label", tab.label);
  setText("panel-title", buildPanelTitle(tab, state));
  setPanelTitleVisible(tab.id === "typhoon" && state.data?.hasTyphoon !== false);
  setText("panel-description", buildDescription(tab, state));
  setText("panel-time", buildTimeText(state));
  renderAmedasSubTabs(tab, amedasMetric.id);
  renderRadarControls(tab, state);
  renderWarningDetails(tab, state);
  renderTyphoonDetails(tab, state);
  renderAmedasRanking(tab, state, amedasMetric);
  renderLegend(tab.id, amedasMetric.id);
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
  const value = state.data?.latestTime ?? state.data?.updatedAt ?? state.data?.summary;
  return value ? `更新時刻: ${value}` : "更新時刻: 未取得";
}

function renderLegend(tabId, amedasMetricId) {
  const root = document.getElementById("legend-list");
  if (!root) return;
  const items = buildLegendItems(tabId, amedasMetricId);

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

function buildLegendItems(tabId, amedasMetricId) {
  if (tabId === "radar") {
    return AMEDAS_PRECIPITATION_LEVELS.map((level) => [level.label, "", level.color]);
  }
  if (tabId === "amedas") {
    return getAmedasLevels(amedasMetricId).map((level) => [level.label, "", level.color]);
  }
  return legendsByTab[tabId] ?? [];
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

  label.textContent = activeFrame?.label ?? (state.status === "loading" ? "取得中" : "--:--");
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
    const row = event.target.closest(".warning-area-row");
    if (!row?.dataset.warningAreaCode) return;
    selectWarningArea(row.dataset.warningAreaCode, { scroll: false });
  });

  window.addEventListener("weather-warning-area-select", (event) => {
    const areaCode = event.detail?.areaCode;
    if (areaCode) selectWarningArea(areaCode, { scroll: true });
  });
}

function selectWarningArea(areaCode, { scroll } = {}) {
  selectedWarningAreaCode = String(areaCode);
  const root = document.getElementById("warning-detail-list");
  if (!root || root.hidden) return;

  root.querySelectorAll(".warning-area-row.selected").forEach((row) => {
    row.classList.remove("selected");
  });

  const row = root.querySelector(`[data-warning-area-code="${cssEscape(selectedWarningAreaCode)}"]`);
  if (!row) return;

  row.classList.add("selected");
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

function renderWarningDetails(tab, state) {
  const root = document.getElementById("warning-detail-list");
  if (!root) return;

  const isWarnings = tab.id === "warnings";
  root.hidden = !isWarnings;
  if (!isWarnings) {
    root.innerHTML = "";
    return;
  }

  if (state.status === "loading") {
    root.innerHTML = `<div class="warning-empty">取得中...</div>`;
    return;
  }

  if (state.status === "error") {
    root.innerHTML = `<div class="warning-empty">取得失敗</div>`;
    return;
  }

  const groups = state.data?.groups ?? [];
  if (groups.length === 0) {
    root.innerHTML = `<div class="warning-empty">発表中の警報・注意報はありません</div>`;
    return;
  }

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

  const items = buildAmedasRankingItems(state.data, metric).slice(0, 5);
  if (items.length === 0) {
    root.innerHTML = `<div class="amedas-ranking-empty">表示できる観測値がありません</div>`;
    return;
  }

  root.innerHTML = `
    <div class="amedas-ranking-head">
      <span>${escapeHtml(metric.label)}ランキング</span>
      <small>上位${items.length}地点</small>
    </div>
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

function buildAmedasRankingItems(data = {}, metric) {
  return (data.points ?? [])
    .map((point) => ({
      name: point.name,
      value: point.values?.[metric.id],
      color: getAmedasLevelColor(metric.id, point.values?.[metric.id])
    }))
    .filter((item) => shouldIncludeAmedasValue(metric.id, item.value))
    .sort((a, b) => b.value - a.value);
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

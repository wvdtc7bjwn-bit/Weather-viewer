import { AMEDAS_METRICS, KIKIKURU_LAYER_OPTIONS, TABS } from "./config.js";
import { createWeatherMap } from "./map/weatherMap.js";
import { setupTabs } from "./ui/tabs.js";
import { setupAmedasRankingToggle, setupAmedasSubTabs, setupKikikuruLayerToggles, setupRadarControls, setupWarningAreaSelection, setupWarningSubTabs, updateLeftPanel } from "./ui/leftPanel.js";
import { setupLegendToggle } from "./ui/legendToggle.js";
import { setupPanelToggle } from "./ui/panelToggle.js";
import { startClock } from "./ui/time.js";
import { fetchRadarTimes } from "./jma/radar.js";
import { fetchAmedasLatestTime } from "./jma/amedas.js";
import { fetchWarningMap } from "./jma/warnings.js";
import { fetchTyphoonList } from "./jma/typhoon.js";
import { fetchKikikuruTiles } from "./jma/kikikuru.js";

const loaders = {
  radar: fetchRadarTimes,
  amedas: fetchAmedasLatestTime,
  warnings: fetchWarningTabData,
  typhoon: fetchTyphoonList
};

async function fetchWarningTabData() {
  const [warningResult, kikikuruResult] = await Promise.allSettled([
    fetchWarningMap(),
    fetchKikikuruTiles()
  ]);

  if (warningResult.status === "rejected") throw warningResult.reason;

  return {
    ...warningResult.value,
    kikikuru: kikikuruResult.status === "fulfilled"
      ? kikikuruResult.value
      : { unavailable: true, error: kikikuruResult.reason }
  };
}

export function createWeatherApp() {
  const launchOptions = getLaunchOptions();
  let activeTab = launchOptions.initialTab;
  let activeAmedasMetric = AMEDAS_METRICS[0].id;
  let activeWarningView = "status";
  let activeKikikuruLayer = KIKIKURU_LAYER_OPTIONS[0]?.id ?? "land";
  let weatherMap = null;
  let latestDataByTab = {};
  let radarPlayTimer = null;
  let tabControls = null;

  async function selectTab(tabId) {
    const tab = TABS.find((item) => item.id === tabId) ?? TABS[0];
    activeTab = tab.id;
    tabControls?.setActiveButton(tab.id);
    if (tab.id !== "radar") stopRadarPlayback();
    updateLeftPanel(tab, {
      status: "loading",
      amedasMetric: activeAmedasMetric,
      warningView: activeWarningView,
      activeKikikuruLayer,
      radarPlaying: Boolean(radarPlayTimer)
    });
    weatherMap?.setMode(tab.id);

    try {
      const data = await loadTabData(tab.id);
      latestDataByTab[tab.id] = data;
      updateCurrentView(tab, data);
    } catch (error) {
      console.warn(`[Weather Viewer] ${tab.id} load failed`, error);
      updateLeftPanel(tab, {
        status: "error",
        error,
        amedasMetric: activeAmedasMetric,
        warningView: activeWarningView,
        activeKikikuruLayer,
        radarPlaying: Boolean(radarPlayTimer)
      });
    }
  }

  function selectAmedasMetric(metricId) {
    activeAmedasMetric = AMEDAS_METRICS.some((item) => item.id === metricId) ? metricId : AMEDAS_METRICS[0].id;
    if (activeTab !== "amedas") return;
    const tab = TABS.find((item) => item.id === "amedas");
    updateCurrentView(tab, latestDataByTab.amedas);
  }

  function selectWarningView(viewId) {
    activeWarningView = viewId === "kikikuru" ? "kikikuru" : "status";
    if (activeTab !== "warnings") return;
    const tab = TABS.find((item) => item.id === "warnings");
    updateCurrentView(tab, latestDataByTab.warnings);
  }

  function selectKikikuruLayer(layerId) {
    if (!KIKIKURU_LAYER_OPTIONS.some((element) => element.id === layerId)) return;
    activeKikikuruLayer = layerId;
    if (activeTab !== "warnings") return;
    const tab = TABS.find((item) => item.id === "warnings");
    updateCurrentView(tab, latestDataByTab.warnings);
  }

  function updateCurrentView(tab, data) {
    const displayData = buildDisplayData(tab, data);
    updateLeftPanel(tab, {
      status: "ok",
      data: displayData,
      amedasMetric: activeAmedasMetric,
      warningView: activeWarningView,
      activeKikikuruLayer,
      radarPlaying: Boolean(radarPlayTimer)
    });
    weatherMap?.renderData(tab.id, displayData);
  }

  function buildDisplayData(tab, data = {}) {
    if (tab.id === "amedas") return { ...data, activeMetric: activeAmedasMetric };
    if (tab.id === "warnings") return { ...data, activeWarningView, activeKikikuruLayer };
    if (tab.id !== "radar") return data;

    const frames = data.frames ?? [];
    const activeFrameIndex = clampRadarIndex(data.activeFrameIndex ?? 0, frames);
    const activeFrame = frames[activeFrameIndex] ?? null;
    return {
      ...data,
      activeFrameIndex,
      activeFrame,
      latestTime: activeFrame?.label ?? data.latestTime,
      latestRawTime: activeFrame?.validtime ?? data.latestRawTime,
      radarTileUrl: activeFrame?.radarTileUrl ?? data.radarTileUrl
    };
  }

  function selectRadarFrame(index) {
    if (activeTab !== "radar") return;
    const radarData = latestDataByTab.radar;
    if (!radarData?.frames?.length) return;
    radarData.activeFrameIndex = clampRadarIndex(index, radarData.frames);
    const tab = TABS.find((item) => item.id === "radar");
    updateCurrentView(tab, radarData);
  }

  function stepRadarFrame(delta) {
    const radarData = latestDataByTab.radar;
    if (!radarData?.frames?.length) return;
    selectRadarFrame((radarData.activeFrameIndex ?? 0) + delta);
  }

  function goLatestRadarObservation() {
    const radarData = latestDataByTab.radar;
    if (!radarData?.frames?.length) return;
    const latestObservationIndex = radarData.frames.reduce(
      (latestIndex, frame, index) => frame.isForecast ? latestIndex : index,
      -1
    );
    selectRadarFrame(latestObservationIndex >= 0 ? latestObservationIndex : radarData.frames.length - 1);
  }

  function toggleRadarPlayback() {
    if (radarPlayTimer) {
      stopRadarPlayback();
      refreshRadarPanel();
      return;
    }

    radarPlayTimer = window.setInterval(() => {
      const radarData = latestDataByTab.radar;
      if (!radarData?.frames?.length || activeTab !== "radar") {
        stopRadarPlayback();
        return;
      }
      const nextIndex = ((radarData.activeFrameIndex ?? 0) + 1) % radarData.frames.length;
      selectRadarFrame(nextIndex);
    }, 850);
    refreshRadarPanel();
  }

  function stopRadarPlayback() {
    if (!radarPlayTimer) return;
    window.clearInterval(radarPlayTimer);
    radarPlayTimer = null;
  }

  function refreshRadarPanel() {
    if (activeTab !== "radar" || !latestDataByTab.radar) return;
    const tab = TABS.find((item) => item.id === "radar");
    updateCurrentView(tab, latestDataByTab.radar);
  }

  function refreshAmedasPanel() {
    if (activeTab !== "amedas" || !latestDataByTab.amedas) return;
    const tab = TABS.find((item) => item.id === "amedas");
    updateCurrentView(tab, latestDataByTab.amedas);
  }

  function clampRadarIndex(index, frames = []) {
    if (!frames.length) return 0;
    return Math.max(0, Math.min(frames.length - 1, Number(index) || 0));
  }

  async function loadTabData(tabId) {
    return loaders[tabId]?.();
  }

  function start() {
    weatherMap = createWeatherMap("map");
    weatherMap.initialize();
    tabControls = setupTabs({ onChange: selectTab });
    setupAmedasSubTabs({ onChange: selectAmedasMetric });
    setupAmedasRankingToggle({ onChange: refreshAmedasPanel });
    setupWarningSubTabs({ onChange: selectWarningView });
    setupKikikuruLayerToggles({ onChange: selectKikikuruLayer });
    setupWarningAreaSelection();
    setupRadarControls({
      onSeek: selectRadarFrame,
      onStep: stepRadarFrame,
      onTogglePlay: toggleRadarPlayback,
      onGoLatest: goLatestRadarObservation
    });
    setupLegendToggle();
    setupPanelToggle({ onLayoutChange: () => weatherMap?.resize() });
    startClock("clock");
    selectTab(activeTab);
  }

  return { start, selectTab };
}

function getLaunchOptions() {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get("tab");
  const initialTab = TABS.some((tab) => tab.id === tabParam) ? tabParam : "radar";
  return { initialTab };
}

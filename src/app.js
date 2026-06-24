import { AMEDAS_METRICS, AUTO_REFRESH_INTERVAL_MS, AUTO_REFRESH_RESUME_THROTTLE_MS, KIKIKURU_LAYER_OPTIONS, TABS } from "./config.js";
import { createWeatherMap } from "./map/weatherMap.js";
import { setupTabs } from "./ui/tabs.js";
import { setupAmedasRankingToggle, setupAmedasSubTabs, setupKikikuruLayerToggles, setupRadarControls, setupTyphoonSelector, setupWarningAreaSelection, setupWarningSubTabs, updateLeftPanel } from "./ui/leftPanel.js";
import { setupLegendToggle } from "./ui/legendToggle.js";
import { setupPanelToggle } from "./ui/panelToggle.js";
import { startClock } from "./ui/time.js";
import { fetchRadarTimes } from "./jma/radar.js";
import { fetchAmedasLatestTime } from "./jma/amedas.js";
import { fetchWarningMap } from "./jma/warnings.js";
import { fetchTyphoonList } from "./jma/typhoon.js";
import { fetchKikikuruTiles } from "./jma/kikikuru.js";
import { resolveCurrentLocationInfo } from "./location/currentLocation.js";

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
  let activeTyphoonId = "";
  let weatherMap = null;
  let latestDataByTab = {};
  let radarPlayTimer = null;
  let autoRefreshTimer = null;
  let activeLoadRequestId = 0;
  let autoRefreshInFlight = false;
  let lastAutoRefreshStartedAt = 0;
  let tabControls = null;
  let currentLocationInfo = { status: "idle" };

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
      radarPlaying: Boolean(radarPlayTimer),
      currentLocation: currentLocationInfo
    });
    weatherMap?.setMode(tab.id);

    const requestId = ++activeLoadRequestId;
    try {
      const data = await loadTabData(tab.id);
      if (requestId !== activeLoadRequestId || activeTab !== tab.id) return;
      latestDataByTab[tab.id] = data;
      updateCurrentView(tab, data);
    } catch (error) {
      if (requestId !== activeLoadRequestId || activeTab !== tab.id) return;
      console.warn(`[Weather Viewer] ${tab.id} load failed`, error);
      updateLeftPanel(tab, {
        status: "error",
        error,
        amedasMetric: activeAmedasMetric,
        warningView: activeWarningView,
        activeKikikuruLayer,
        radarPlaying: Boolean(radarPlayTimer),
        currentLocation: currentLocationInfo
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

  function selectTyphoon(typhoonId) {
    activeTyphoonId = String(typhoonId ?? "");
    if (activeTab !== "typhoon") return;
    const tab = TABS.find((item) => item.id === "typhoon");
    updateCurrentView(tab, latestDataByTab.typhoon);
  }

  function updateCurrentView(tab, data) {
    const displayData = buildDisplayData(tab, data);
    updateLeftPanel(tab, {
      status: "ok",
      data: displayData,
      amedasMetric: activeAmedasMetric,
      warningView: activeWarningView,
      activeKikikuruLayer,
      radarPlaying: Boolean(radarPlayTimer),
      currentLocation: currentLocationInfo
    });
    weatherMap?.renderData(tab.id, displayData);
  }

  function buildDisplayData(tab, data = {}) {
    if (tab.id === "amedas") return { ...data, activeMetric: activeAmedasMetric };
    if (tab.id === "warnings") return { ...data, activeWarningView, activeKikikuruLayer };
    if (tab.id === "typhoon") return buildTyphoonDisplayData(data);
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

  function buildTyphoonDisplayData(data = {}) {
    const typhoons = data.typhoons ?? [];
    if (!typhoons.length) {
      activeTyphoonId = "";
      return data;
    }

    const selected = typhoons.find((typhoon) => String(typhoon.id) === String(activeTyphoonId))
      ?? typhoons[0];
    activeTyphoonId = String(selected.id ?? "");

    return {
      ...data,
      selectedTyphoonId: activeTyphoonId,
      selectedTyphoon: selected,
      details: selected.details ?? data.details,
      latestTime: selected.updatedAt ?? data.latestTime,
      updatedAt: selected.updatedAt ?? data.updatedAt
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
    const latestObservationIndex = findLatestObservationIndex(radarData.frames);
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

  async function refreshActiveTab({ force = false } = {}) {
    if (document.hidden || autoRefreshInFlight) return;
    const now = Date.now();
    if (!force && now - lastAutoRefreshStartedAt < AUTO_REFRESH_RESUME_THROTTLE_MS) return;

    const tab = TABS.find((item) => item.id === activeTab) ?? TABS[0];
    if (!loaders[tab.id]) return;

    autoRefreshInFlight = true;
    lastAutoRefreshStartedAt = now;
    try {
      const nextData = await loadTabData(tab.id);
      if (activeTab !== tab.id) return;
      latestDataByTab[tab.id] = mergeRefreshedData(tab.id, latestDataByTab[tab.id], nextData);
      updateCurrentView(tab, latestDataByTab[tab.id]);
    } catch (error) {
      console.warn(`[Weather Viewer] ${tab.id} auto refresh failed`, error);
    } finally {
      autoRefreshInFlight = false;
    }
  }

  async function locateCurrentPosition() {
    if (!navigator.geolocation) {
      currentLocationInfo = {
        status: "error",
        message: "このブラウザでは位置情報を利用できません。"
      };
      refreshActivePanel();
      return;
    }

    setLocateButtonBusy(true);
    currentLocationInfo = {
      status: "loading",
      message: "現在地を取得中です..."
    };
    refreshActivePanel();

    try {
      const position = await requestCurrentPosition();
      const coordinates = [position.coords.longitude, position.coords.latitude];
      weatherMap?.showCurrentLocation(coordinates, position.coords.accuracy);
      weatherMap?.flyToLocation(coordinates);

      const warningData = latestDataByTab.warnings ?? await fetchWarningTabData();
      latestDataByTab.warnings = warningData;
      currentLocationInfo = await resolveCurrentLocationInfo(coordinates, warningData);

      if (activeTab !== "warnings") {
        activeTab = "warnings";
        tabControls?.setActiveButton(activeTab);
        stopRadarPlayback();
        weatherMap?.setMode(activeTab);
      }

      const tab = TABS.find((item) => item.id === "warnings");
      updateCurrentView(tab, warningData);
    } catch (error) {
      currentLocationInfo = buildCurrentLocationError(error);
      refreshActivePanel();
    } finally {
      setLocateButtonBusy(false);
    }
  }

  function refreshActivePanel() {
    const tab = TABS.find((item) => item.id === activeTab) ?? TABS[0];
    const data = latestDataByTab[tab.id];
    if (data) {
      updateCurrentView(tab, data);
      return;
    }

    updateLeftPanel(tab, {
      status: "loading",
      amedasMetric: activeAmedasMetric,
      warningView: activeWarningView,
      activeKikikuruLayer,
      radarPlaying: Boolean(radarPlayTimer),
      currentLocation: currentLocationInfo
    });
  }

  function setLocateButtonBusy(isBusy) {
    const button = document.getElementById("locate-button");
    if (!button) return;
    button.classList.toggle("loading", isBusy);
    button.disabled = isBusy;
    button.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  function startAutoRefresh() {
    if (autoRefreshTimer) window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = window.setInterval(() => {
      refreshActiveTab({ force: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshActiveTab();
    });
    window.addEventListener("focus", () => refreshActiveTab());
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
    setupTyphoonSelector({ onChange: selectTyphoon });
    setupRadarControls({
      onSeek: selectRadarFrame,
      onStep: stepRadarFrame,
      onTogglePlay: toggleRadarPlayback,
      onGoLatest: goLatestRadarObservation
    });
    setupLegendToggle();
    setupPanelToggle({ onLayoutChange: () => weatherMap?.resize() });
    document.getElementById("locate-button")?.addEventListener("click", locateCurrentPosition);
    startClock("clock");
    startAutoRefresh();
    selectTab(activeTab);
  }

  return { start, selectTab };
}

function requestCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 60 * 1000
    });
  });
}

function buildCurrentLocationError(error) {
  const code = Number(error?.code);
  if (code === 1) {
    return {
      status: "error",
      message: "位置情報の利用が許可されていません。"
    };
  }
  if (code === 3) {
    return {
      status: "error",
      message: "位置情報の取得がタイムアウトしました。"
    };
  }
  return {
    status: "error",
    message: "現在地を取得できませんでした。"
  };
}

function getLaunchOptions() {
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get("tab");
  const initialTab = TABS.some((tab) => tab.id === tabParam) ? tabParam : "radar";
  return { initialTab };
}

function mergeRefreshedData(tabId, currentData, nextData) {
  if (tabId !== "radar" || !currentData?.frames?.length || !nextData?.frames?.length) return nextData;

  const currentIndex = clampIndex(currentData.activeFrameIndex, currentData.frames);
  const currentFrame = currentData.frames[currentIndex] ?? null;
  const currentLatestObservationIndex = findLatestObservationIndex(currentData.frames);
  const nextLatestObservationIndex = findLatestObservationIndex(nextData.frames);

  if (currentIndex === currentLatestObservationIndex && nextLatestObservationIndex >= 0) {
    return { ...nextData, activeFrameIndex: nextLatestObservationIndex };
  }

  const sameFrameIndex = nextData.frames.findIndex((frame) =>
    frame.validtime === currentFrame?.validtime &&
    frame.isForecast === currentFrame?.isForecast
  );

  return {
    ...nextData,
    activeFrameIndex: sameFrameIndex >= 0
      ? sameFrameIndex
      : clampIndex(currentIndex, nextData.frames)
  };
}

function findLatestObservationIndex(frames = []) {
  return frames.reduce((latestIndex, frame, index) => frame.isForecast ? latestIndex : index, -1);
}

function clampIndex(index, items = []) {
  if (!items.length) return 0;
  return Math.max(0, Math.min(items.length - 1, Number(index) || 0));
}

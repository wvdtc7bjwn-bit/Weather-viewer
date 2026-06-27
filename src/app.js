import { AMEDAS_METRICS, AUTO_REFRESH_INTERVAL_MS, AUTO_REFRESH_RESUME_THROTTLE_MS, KIKIKURU_LAYER_OPTIONS, TABS } from "./config.js";
import { createWeatherMap } from "./map/weatherMap.js";
import { setupTabs } from "./ui/tabs.js";
import { setupAmedasRankingToggle, setupAmedasSubTabs, setupKikikuruLayerToggles, setupRadarControls, setupTyphoonSelector, setupWarningAreaSelection, updateLeftPanel } from "./ui/leftPanel.js";
import { setupLegendToggle } from "./ui/legendToggle.js";
import { setupPanelToggle } from "./ui/panelToggle.js";
import { refreshSettingsModalView, setupSettingsModal } from "./ui/settingsModal.js";
import { startClock } from "./ui/time.js";
import { fetchRadarTimes } from "./jma/radar.js";
import { fetchAmedasLatestTime } from "./jma/amedas.js";
import { fetchWarningDetails, fetchWarningMap } from "./jma/warnings.js";
import { fetchTyphoonList } from "./jma/typhoon.js";
import { fetchKikikuruTiles } from "./jma/kikikuru.js";
import { resolveCurrentLocationInfo, searchMunicipalities } from "./location/currentLocation.js";
import { addMyArea, getMyAreaLimit, loadMyAreas, removeMyArea } from "./location/myAreas.js";
import { buildLocationRadarTimeline } from "./location/radarTimeline.js";

const loaders = {
  radar: fetchRadarTimes,
  amedas: fetchAmedasLatestTime,
  warnings: fetchWarningTabData,
  typhoon: fetchTyphoonList
};

const KIKIKURU_DATA_TTL_MS = 60 * 1000;
const WARNING_DETAILS_TTL_MS = 60 * 1000;
const LOCATION_WATCH_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 20000,
  maximumAge: 60 * 1000
};
const LOCATION_RESOLVE_MIN_DISTANCE_METERS = 250;
const LOCATION_RESOLVE_MIN_INTERVAL_MS = 60 * 1000;

async function fetchWarningTabData(options = {}) {
  const includeDetails = Boolean(options.includeDetails);
  if (!includeDetails) {
    return {
      ...await fetchWarningMap({ includeDetails: false }),
      kikikuru: { unavailable: true, deferred: true }
    };
  }

  return await fetchWarningDetails();
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
  let myAreas = loadMyAreas();
  let locationRadarTimeline = { status: "idle", points: [] };
  let locationRadarRequestId = 0;
  let locationWatchId = null;
  let locationResolveRequestId = 0;
  let lastResolvedLocation = null;
  const loadRequestsByTab = new Map();
  let warningDetailsRequest = null;
  let warningKikikuruRequest = null;
  let warningDetailsTimer = null;
  let warningFullRefreshTimer = null;
  let warningDetailsLoadedAt = 0;
  let warningKikikuruLoadedAt = 0;
  let backgroundPrefetchStarted = false;

  async function selectTab(tabId) {
    const tab = TABS.find((item) => item.id === tabId) ?? TABS[0];
    activeTab = tab.id;
    tabControls?.setActiveButton(tab.id);
    if (tab.id !== "radar") stopRadarPlayback();
    weatherMap?.setMode(tab.id);

    const requestId = ++activeLoadRequestId;
    const cachedData = latestDataByTab[tab.id];
    if (cachedData) {
      updateCurrentView(tab, cachedData);
      if (tab.id === "warnings") {
        queueWarningFullRefresh({ delayMs: 700 });
        scheduleBackgroundPrefetch(tab.id);
        return;
      }
    } else {
      updateLeftPanel(tab, {
        status: "loading",
        amedasMetric: activeAmedasMetric,
        warningView: activeWarningView,
        activeKikikuruLayer,
        radarPlaying: Boolean(radarPlayTimer),
        currentLocation: currentLocationInfo,
        myAreas,
        locationInsights: buildLocationInsights(tab.id, null)
      });
    }

    try {
      const data = await loadTabData(tab.id);
      if (requestId !== activeLoadRequestId || activeTab !== tab.id) return;
      latestDataByTab[tab.id] = data;
      updateCurrentView(tab, data);
      if (tab.id === "warnings") queueWarningFullRefresh({ delayMs: 350 });
      scheduleBackgroundPrefetch(tab.id);
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
        currentLocation: currentLocationInfo,
        myAreas,
        locationInsights: buildLocationInsights(tab.id, null)
      });
    }
  }

  function selectAmedasMetric(metricId) {
    activeAmedasMetric = AMEDAS_METRICS.some((item) => item.id === metricId) ? metricId : AMEDAS_METRICS[0].id;
    if (activeTab !== "amedas") return;
    const tab = TABS.find((item) => item.id === "amedas");
    updateCurrentView(tab, latestDataByTab.amedas);
  }

  function selectKikikuruLayer(layerId) {
    if (layerId === "status") {
      activeWarningView = activeWarningView === "status" ? "early" : "status";
      if (activeTab !== "warnings") return;
      const tab = TABS.find((item) => item.id === "warnings");
      updateCurrentView(tab, latestDataByTab.warnings);
      if (activeWarningView === "early") refreshWarningDetails();
      else scheduleWarningDetailsRefresh();
      return;
    }

    if (layerId === "early") {
      activeWarningView = "early";
      if (activeTab !== "warnings") return;
      const tab = TABS.find((item) => item.id === "warnings");
      updateCurrentView(tab, latestDataByTab.warnings);
      refreshWarningDetails();
      return;
    }

    if (layerId !== "kikikuru" && !KIKIKURU_LAYER_OPTIONS.some((element) => element.id === layerId)) return;
    const previousWarningView = activeWarningView;
    activeWarningView = "kikikuru";
    activeKikikuruLayer = layerId === "kikikuru"
      ? getNextKikikuruLayer(previousWarningView, activeKikikuruLayer)
      : layerId;
    if (activeTab !== "warnings") return;
    const tab = TABS.find((item) => item.id === "warnings");
    updateCurrentView(tab, latestDataByTab.warnings);
    cancelScheduledWarningDetailsRefresh();
    refreshKikikuruData();
  }

  function selectTyphoon(typhoonId) {
    activeTyphoonId = String(typhoonId ?? "");
    if (activeTab !== "typhoon") return;
    const tab = TABS.find((item) => item.id === "typhoon");
    updateCurrentView(tab, latestDataByTab.typhoon);
  }

  function updateCurrentView(tab, data) {
    const displayData = buildDisplayData(tab, data);
    if (tab.id === "radar") ensureLocationRadarTimeline(displayData);
    updateLeftPanel(tab, {
      status: "ok",
      data: displayData,
      amedasMetric: activeAmedasMetric,
      warningView: activeWarningView,
      activeKikikuruLayer,
      radarPlaying: Boolean(radarPlayTimer),
      currentLocation: currentLocationInfo,
      myAreas,
      locationInsights: buildLocationInsights(tab.id, displayData)
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

  function buildLocationInsights(tabId, data) {
    if (tabId === "radar") {
      return {
        type: "radar",
        currentLocation: getCurrentLocationTarget(),
        timeline: locationRadarTimeline
      };
    }

    if (tabId === "warnings") {
      return {
        type: "myAreas",
        areas: buildMyAreaWarningSummaries(data ?? latestDataByTab.warnings)
      };
    }

    return null;
  }

  function getCurrentLocationTarget() {
    if (currentLocationInfo?.status !== "found" || !Array.isArray(currentLocationInfo.coordinates)) return null;
    return {
      id: "current-location",
      kind: "current",
      label: currentLocationInfo.areaName ? `現在地 (${currentLocationInfo.areaName})` : "現在地",
      areaCode: currentLocationInfo.areaCode,
      areaName: currentLocationInfo.areaName,
      prefecture: currentLocationInfo.prefecture,
      coordinates: currentLocationInfo.coordinates
    };
  }

  function buildMyAreaWarningSummaries(data = {}) {
    if (!myAreas.length) return [];
    const activeAreaByCode = new Map((data?.activeAreas ?? []).map((area) => [String(area.areaCode), area]));
    return myAreas.map((area) => {
      const activeArea = activeAreaByCode.get(String(area.areaCode));
      return {
        ...area,
        warnings: activeArea?.warnings ?? [],
        updatedAt: activeArea?.updatedAt ?? data?.updatedAt ?? data?.latestTime ?? "",
        hasWarnings: Boolean(activeArea?.warnings?.length)
      };
    });
  }

  function ensureLocationRadarTimeline(radarData) {
    const current = getCurrentLocationTarget();
    if (!current) {
      locationRadarTimeline = { status: "idle", points: [] };
      return;
    }

    const frames = radarData?.frames ?? [];
    if (!frames.length) {
      locationRadarTimeline = {
        status: "unavailable",
        points: [],
        message: "雨雲時系列を表示できません。"
      };
      return;
    }

    const sourceKey = [
      current.coordinates.join(","),
      frames.map((frame) => frame.validtime ?? frame.label ?? "").join("|")
    ].join("::");
    if (locationRadarTimeline.sourceKey === sourceKey && locationRadarTimeline.status !== "idle") return;

    const requestId = ++locationRadarRequestId;
    locationRadarTimeline = {
      status: "loading",
      points: [],
      sourceKey,
      location: current,
      message: "現在地周辺の雨雲を読み取っています。"
    };

    buildLocationRadarTimeline(current.coordinates, radarData)
      .then((timeline) => {
        if (requestId !== locationRadarRequestId) return;
        locationRadarTimeline = {
          ...timeline,
          sourceKey,
          location: current
        };
        if (activeTab === "radar") refreshActivePanel();
      })
      .catch((error) => {
        if (requestId !== locationRadarRequestId) return;
        console.warn("[Weather Viewer] current location radar timeline failed", error);
        locationRadarTimeline = {
          status: "unavailable",
          points: [],
          sourceKey,
          location: current,
          message: "現在地周辺の雨雲時系列を取得できませんでした。"
        };
        if (activeTab === "radar") refreshActivePanel();
      });
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
    if (!loaders[tabId]) return null;
    const inFlight = loadRequestsByTab.get(tabId);
    if (inFlight) return inFlight;

    const request = loaders[tabId]()
      .finally(() => {
        loadRequestsByTab.delete(tabId);
      });
    loadRequestsByTab.set(tabId, request);
    return request;
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
      if (tab.id === "warnings") queueWarningFullRefresh({ force: true, delayMs: 0 });
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
      refreshSettingsModalView();
      refreshActivePanel();
      return;
    }

    setLocateButtonBusy(true);
    if (locationWatchId === null) startLocationWatch();
    currentLocationInfo = {
      status: "loading",
      message: "現在地を取得中です..."
    };
    refreshActivePanel();

    try {
      const position = await requestCurrentPosition();
      await applyCurrentPosition(position, { forceResolve: true, flyTo: true });
    } catch (error) {
      currentLocationInfo = buildCurrentLocationError(error);
      refreshSettingsModalView();
      refreshActivePanel();
    } finally {
      setLocateButtonBusy(false);
    }
  }

  function startLocationWatch() {
    if (!navigator.geolocation) {
      currentLocationInfo = {
        status: "error",
        message: "このブラウザでは位置情報を利用できません。"
      };
      refreshSettingsModalView();
      refreshActivePanel();
      return;
    }
    if (locationWatchId !== null) return;

    currentLocationInfo = {
      status: "loading",
      message: "現在地を取得中です..."
    };
    refreshSettingsModalView();
    refreshActivePanel();

    locationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        applyCurrentPosition(position).catch((error) => {
          console.warn("[Weather Viewer] current location watch update failed", error);
        });
      },
      (error) => {
        if (Number(error?.code) === 1) stopLocationWatch();
        currentLocationInfo = buildCurrentLocationError(error);
        refreshSettingsModalView();
        refreshActivePanel();
      },
      LOCATION_WATCH_OPTIONS
    );
  }

  async function applyCurrentPosition(position, options = {}) {
    const coordinates = getPositionCoordinates(position);
    if (!coordinates) {
      currentLocationInfo = {
        status: "error",
        message: "現在地の座標を読み取れませんでした。"
      };
      refreshSettingsModalView();
      refreshActivePanel();
      return;
    }

    weatherMap?.showCurrentLocation(coordinates, position.coords.accuracy);
    if (options.flyTo) weatherMap?.flyToLocation(coordinates);

    if (!shouldResolveCurrentLocation(coordinates, options.forceResolve)) return;

    const requestId = ++locationResolveRequestId;
    try {
      const warningData = latestDataByTab.warnings ?? await fetchWarningTabData();
      if (requestId !== locationResolveRequestId) return;
      latestDataByTab.warnings = warningData;
      const nextInfo = await resolveCurrentLocationInfo(coordinates, warningData);
      if (requestId !== locationResolveRequestId) return;
      currentLocationInfo = nextInfo;
      lastResolvedLocation = {
        coordinates,
        resolvedAt: Date.now()
      };
      resetLocationRadarTimeline();
      refreshSettingsModalView();
      refreshActivePanel();
    } catch (error) {
      if (requestId !== locationResolveRequestId) return;
      currentLocationInfo = buildCurrentLocationError(error);
      refreshSettingsModalView();
      refreshActivePanel();
    }
  }

  function shouldResolveCurrentLocation(coordinates, forceResolve = false) {
    if (forceResolve || !lastResolvedLocation) return true;

    const movedMeters = getDistanceMeters(lastResolvedLocation.coordinates, coordinates);
    const elapsedMs = Date.now() - lastResolvedLocation.resolvedAt;
    return movedMeters >= LOCATION_RESOLVE_MIN_DISTANCE_METERS || elapsedMs >= LOCATION_RESOLVE_MIN_INTERVAL_MS;
  }

  function resetLocationRadarTimeline() {
    locationRadarRequestId += 1;
    locationRadarTimeline = { status: "idle", points: [] };
  }

  function stopLocationWatch() {
    if (locationWatchId === null || !navigator.geolocation?.clearWatch) return;
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
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
      currentLocation: currentLocationInfo,
      myAreas,
      locationInsights: buildLocationInsights(tab.id, null)
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

  function scheduleBackgroundPrefetch(excludeTabId) {
    if (backgroundPrefetchStarted) return;
    backgroundPrefetchStarted = true;

    const run = () => {
      TABS
        .filter((tab) => tab.id !== excludeTabId && loaders[tab.id])
        .forEach((tab, index) => {
          window.setTimeout(() => {
            prefetchTabData(tab.id);
          }, index * 600);
        });
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 2500 });
    } else {
      window.setTimeout(run, 1200);
    }
  }

  async function prefetchTabData(tabId) {
    if (latestDataByTab[tabId] || document.hidden) return;
    try {
      latestDataByTab[tabId] = await loadTabData(tabId);
    } catch (error) {
      console.warn(`[Weather Viewer] ${tabId} prefetch failed`, error);
    }
  }

  function scheduleWarningDetailsRefresh() {
    if (latestDataByTab.warnings?.detailsLoaded || warningDetailsRequest || warningDetailsTimer) return;
    warningDetailsTimer = window.setTimeout(() => {
      warningDetailsTimer = null;
      if (activeTab !== "warnings" || activeWarningView !== "status") return;
      refreshWarningDetails();
    }, 1800);
  }

  function cancelScheduledWarningDetailsRefresh() {
    if (!warningDetailsTimer) return;
    window.clearTimeout(warningDetailsTimer);
    warningDetailsTimer = null;
  }

  function queueWarningFullRefresh({ force = false, delayMs = 0 } = {}) {
    if (warningFullRefreshTimer) {
      window.clearTimeout(warningFullRefreshTimer);
      warningFullRefreshTimer = null;
    }
    warningFullRefreshTimer = window.setTimeout(() => {
      warningFullRefreshTimer = null;
      if (activeTab !== "warnings") return;
      refreshAllWarningData({ force });
    }, delayMs);
  }

  async function refreshWarningDetails() {
    return refreshWarningDetailsData();
  }

  async function refreshWarningDetailsData({ force = false } = {}) {
    if (!force && hasFreshWarningDetails(latestDataByTab.warnings, warningDetailsLoadedAt)) return latestDataByTab.warnings;
    if (warningDetailsRequest) return warningDetailsRequest;
    cancelScheduledWarningDetailsRefresh();
    warningDetailsRequest = fetchWarningTabData({ includeDetails: true })
      .then((detailsData) => {
        latestDataByTab.warnings = mergeWarningTabData(latestDataByTab.warnings, detailsData);
        warningDetailsLoadedAt = Date.now();
        refreshWarningsView();
        return latestDataByTab.warnings;
      })
      .catch((error) => {
        console.warn("[Weather Viewer] warning detail load failed", error);
        return latestDataByTab.warnings;
      })
      .finally(() => {
        warningDetailsRequest = null;
      });
    return warningDetailsRequest;
  }

  async function refreshAllWarningData({ force = false } = {}) {
    const [detailsResult, kikikuruResult] = await Promise.allSettled([
      refreshWarningDetailsData({ force }),
      refreshKikikuruData({ force })
    ]);
    if (detailsResult.status === "rejected") {
      console.warn("[Weather Viewer] warning detail refresh failed", detailsResult.reason);
    }
    if (kikikuruResult.status === "rejected") {
      console.warn("[Weather Viewer] kikikuru refresh failed", kikikuruResult.reason);
    }
    return latestDataByTab.warnings;
  }

  async function refreshKikikuruData({ force = false } = {}) {
    const currentKikikuru = latestDataByTab.warnings?.kikikuru;
    if (!force && hasFreshKikikuruData(currentKikikuru, warningKikikuruLoadedAt)) return latestDataByTab.warnings;
    if (warningKikikuruRequest) return warningKikikuruRequest;

    warningKikikuruRequest = fetchKikikuruTiles()
      .then((kikikuruData) => {
        latestDataByTab.warnings = {
          ...(latestDataByTab.warnings ?? {}),
          kikikuru: kikikuruData
        };
        warningKikikuruLoadedAt = Date.now();
        refreshWarningsView({ view: "kikikuru" });
        return latestDataByTab.warnings;
      })
      .catch((error) => {
        console.warn("[Weather Viewer] kikikuru tile load failed", error);
        latestDataByTab.warnings = {
          ...(latestDataByTab.warnings ?? {}),
          kikikuru: { unavailable: true, error }
        };
        refreshWarningsView({ view: "kikikuru" });
        return latestDataByTab.warnings;
      })
      .finally(() => {
        warningKikikuruRequest = null;
      });
    return warningKikikuruRequest;
  }

  function refreshWarningsView(options = {}) {
    if (activeTab !== "warnings") return;
    if (options.view && activeWarningView !== options.view) return;
    const tab = TABS.find((item) => item.id === "warnings");
    updateCurrentView(tab, latestDataByTab.warnings);
  }

  function getSettingsState() {
    return {
      myAreas,
      currentLocation: currentLocationInfo,
      myAreaLimit: getMyAreaLimit()
    };
  }

  async function searchSettingsAreas(query) {
    return searchMunicipalities(query);
  }

  function addSettingsMyArea(area) {
    myAreas = addMyArea(myAreas, area);
    refreshSettingsModalView();
    refreshActivePanel();
  }

  function addCurrentLocationToMyAreas() {
    if (currentLocationInfo?.status !== "found" || !currentLocationInfo.areaCode) return;
    addSettingsMyArea({
      areaCode: currentLocationInfo.areaCode,
      areaName: currentLocationInfo.areaName,
      prefecture: currentLocationInfo.prefecture,
      coordinates: currentLocationInfo.coordinates ?? currentLocationInfo.center
    });
  }

  function removeSettingsMyArea(areaCode) {
    myAreas = removeMyArea(myAreas, areaCode);
    refreshSettingsModalView();
    refreshActivePanel();
  }

  function start() {
    weatherMap = createWeatherMap("map");
    weatherMap.initialize();
    tabControls = setupTabs({ onChange: selectTab });
    setupAmedasSubTabs({ onChange: selectAmedasMetric });
    setupAmedasRankingToggle({ onChange: refreshAmedasPanel });
    setupKikikuruLayerToggles({ onChange: selectKikikuruLayer });
    setupWarningAreaSelection({ onDetailRequest: () => refreshWarningDetails() });
    setupTyphoonSelector({ onChange: selectTyphoon });
    setupRadarControls({
      onSeek: selectRadarFrame,
      onStep: stepRadarFrame,
      onTogglePlay: toggleRadarPlayback,
      onGoLatest: goLatestRadarObservation
    });
    setupLegendToggle();
    setupPanelToggle({ onLayoutChange: () => weatherMap?.resize() });
    setupSettingsModal({
      getState: getSettingsState,
      onSearchArea: searchSettingsAreas,
      onAddArea: addSettingsMyArea,
      onAddCurrentLocation: addCurrentLocationToMyAreas,
      onRemoveArea: removeSettingsMyArea
    });
    document.getElementById("locate-button")?.addEventListener("click", locateCurrentPosition);
    startClock("clock");
    startAutoRefresh();
    startLocationWatch();
    selectTab(activeTab);
  }

  return { start, selectTab };
}

function getNextKikikuruLayer(currentView, currentLayer) {
  if (currentView !== "kikikuru") return currentLayer === "inund" ? "inund" : "land";
  return currentLayer === "land" ? "inund" : "land";
}

function hasFreshKikikuruData(kikikuru, loadedAt) {
  return Boolean(
    kikikuru?.tileUrls &&
    !kikikuru.deferred &&
    !kikikuru.unavailable &&
    Date.now() - loadedAt < KIKIKURU_DATA_TTL_MS
  );
}

function hasFreshWarningDetails(warningData, loadedAt) {
  return Boolean(
    warningData?.detailsLoaded &&
    loadedAt > 0 &&
    Date.now() - loadedAt < WARNING_DETAILS_TTL_MS
  );
}

function requestCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, LOCATION_WATCH_OPTIONS);
  });
}

function getPositionCoordinates(position) {
  const longitude = Number(position?.coords?.longitude);
  const latitude = Number(position?.coords?.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [longitude, latitude];
}

function getDistanceMeters(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to)) return Number.POSITIVE_INFINITY;
  const [fromLon, fromLat] = from.map(Number);
  const [toLon, toLat] = to.map(Number);
  if (![fromLon, fromLat, toLon, toLat].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const earthRadiusMeters = 6371000;
  const toRadians = (value) => value * Math.PI / 180;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  if (tabId === "warnings") return mergeWarningTabData(currentData, nextData);
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

function mergeWarningTabData(currentData, nextData = {}) {
  if (!currentData) return nextData;
  if (nextData.detailsLoaded) {
    return {
      ...currentData,
      ...nextData,
      kikikuru: nextData.kikikuru ?? currentData.kikikuru
    };
  }

  return {
    ...currentData,
    ...nextData,
    earlyWarnings: currentData.earlyWarnings ?? nextData.earlyWarnings,
    earlyAreas: currentData.earlyAreas ?? nextData.earlyAreas,
    earlyMunicipalityAreas: currentData.earlyMunicipalityAreas ?? nextData.earlyMunicipalityAreas,
    kikikuru: currentData.kikikuru ?? nextData.kikikuru,
    detailsLoaded: Boolean(nextData.detailsLoaded)
  };
}

function findLatestObservationIndex(frames = []) {
  return frames.reduce((latestIndex, frame, index) => frame.isForecast ? latestIndex : index, -1);
}

function clampIndex(index, items = []) {
  if (!items.length) return 0;
  return Math.max(0, Math.min(items.length - 1, Number(index) || 0));
}

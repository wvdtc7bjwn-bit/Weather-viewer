import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AMEDAS_METRICS,
  AMEDAS_PRECIPITATION_LEVELS,
  AMEDAS_SNOW_LEVELS,
  AMEDAS_TEMPERATURE_LEVELS,
  AMEDAS_WIND_LEVELS,
  DEFAULT_VIEW,
  JMA_ENDPOINTS
} from "../config.js";
import { worldLandGeoJson } from "./data/worldLandGeoJson.js";
import { worldCountriesGeoJson } from "./data/worldCountriesGeoJson.js";

const MODE_CLASS = {
  radar: "mode-radar",
  amedas: "mode-amedas",
  warnings: "mode-warnings",
  typhoon: "mode-typhoon"
};

const SAMPLE_SOURCE_ID = "weather-samples";
const SAMPLE_LAYERS = ["sample-fill", "sample-line", "sample-circle", "sample-wind-arrow", "sample-label"];
const WIND_ARROW_IMAGE_ID = "amedas-wind-arrow";
const RADAR_COVERAGE_SOURCE_ID = "jma-nowcast-coverage";
const RADAR_COVERAGE_LAYER_ID = "jma-nowcast-coverage";
const RADAR_SOURCE_PREFIX = "jma-nowcast-radar-z";
const RADAR_LAYER_PREFIX = "jma-nowcast-radar-z";
const RADAR_ZOOM_LEVELS = [
  { id: "z2", z: 2, minzoom: 1, maxzoom: 3 },
  { id: "z4", z: 4, minzoom: 3, maxzoom: 5 },
  { id: "z6", z: 6, minzoom: 5, maxzoom: 7 },
  { id: "z8", z: 8, minzoom: 7, maxzoom: 9 },
  { id: "z10", z: 10, minzoom: 9, maxzoom: 22 }
];
const MUNICIPALITY_SOURCE_ID = "jma-weather-warning-municipalities";
const WARNING_SOURCE_ID = "jma-active-warning-municipalities";
const MUNICIPALITY_FILL_LAYER_ID = "jma-municipality-fill";
const WARNING_OVERLAY_LAYER_ID = "jma-warning-overlay";
const WARNING_HATCH_LAYER_ID = "jma-warning-emergency-hatch";
const WARNING_HATCH_IMAGE_ID = "jma-warning-emergency-hatch-pattern";
const DEFAULT_LAND_FILL = "#3c3d40";
const NATURAL_EARTH_JAPAN_MASK_BOUNDS = {
  minLng: 122.0,
  maxLng: 149.5,
  minLat: 23.0,
  maxLat: 46.5
};

const baseMapData = {
  worldLand: buildWorldLandWithoutJapanData(),
  worldCountries: buildWorldCountriesWithoutJapanData()
};
let warningMunicipalityDataPromise = null;

export function createWeatherMap(elementId) {
  let map = null;
  let pendingRender = null;
  let activeMode = "radar";
  let warningAreasByCode = new Map();

  function initialize() {
    map = new maplibregl.Map({
      container: elementId,
      center: [DEFAULT_VIEW.center[1], DEFAULT_VIEW.center[0]],
      zoom: DEFAULT_VIEW.zoom,
      minZoom: DEFAULT_VIEW.minZoom,
      maxZoom: DEFAULT_VIEW.maxZoom,
      renderWorldCopies: false,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: false,
      style: createBaseStyle()
    });
    map.touchZoomRotate.disableRotation();

    map.on("load", () => {
      setupSampleLayers();
      setMode(activeMode);
      if (pendingRender) {
        renderData(pendingRender.mode, pendingRender.data);
        pendingRender = null;
      }
    });
  }

  function setMode(mode) {
    activeMode = mode;
    const container = map?.getContainer();
    if (!container) return;
    Object.values(MODE_CLASS).forEach((className) => container.classList.remove(className));
    container.classList.add(MODE_CLASS[mode] ?? MODE_CLASS.radar);
    setRadarVisible(map, mode === "radar");
    if (mode !== "warnings") updateWarningMunicipalityPaint(map, mode);
  }

  function renderData(mode, data) {
    if (!map || !map.isStyleLoaded() || !map.getSource(SAMPLE_SOURCE_ID)) {
      pendingRender = { mode, data };
      return;
    }

    const source = map.getSource(SAMPLE_SOURCE_ID);
    source.setData(createSampleFeatureCollection(mode, data));
    updateWarningAreaLookup(mode, data);
    updateRadarLayer(map, mode, data);
    updateWarningMunicipalityPaint(map, mode, data);
  }

  function setupSampleLayers() {
    map.addSource(SAMPLE_SOURCE_ID, {
      type: "geojson",
      data: createSampleFeatureCollection(activeMode)
    });
    setupWindArrowImage(map);
    setupWarningHatchImage(map);

    map.addLayer({
      id: WARNING_HATCH_LAYER_ID,
      type: "fill",
      source: WARNING_SOURCE_ID,
      paint: {
        "fill-pattern": WARNING_HATCH_IMAGE_ID,
        "fill-opacity": 0
      }
    }, "jma-municipality-line");

    map.addLayer({
      id: "sample-fill",
      type: "fill",
      source: SAMPLE_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.2]
      }
    });

    map.addLayer({
      id: "sample-line",
      type: "line",
      source: SAMPLE_SOURCE_ID,
      filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.9,
        "line-width": ["coalesce", ["get", "lineWidth"], 2]
      }
    });

    map.addLayer({
      id: "sample-circle",
      type: "circle",
      source: SAMPLE_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "markerType"], "wind"]],
      paint: {
        "circle-color": ["get", "color"],
        "circle-opacity": 0.92,
        "circle-radius": ["coalesce", ["get", "radius"], 8],
        "circle-stroke-color": "#f8fbff",
        "circle-stroke-width": 2
      }
    });

    map.addLayer({
      id: "sample-wind-arrow",
      type: "symbol",
      source: SAMPLE_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "markerType"], "wind"]],
      layout: {
        "icon-image": WIND_ARROW_IMAGE_ID,
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4,
          0.36,
          7,
          0.48,
          10,
          0.62
        ],
        "icon-rotate": ["get", "rotation"],
        "icon-rotation-alignment": "map",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-padding": 0
      },
      paint: {
        "icon-color": ["get", "color"],
        "icon-opacity": 0.94,
        "icon-halo-color": "rgba(5, 9, 20, 0.72)",
        "icon-halo-width": 1.1
      }
    });

    map.addLayer({
      id: "sample-label",
      type: "symbol",
      source: SAMPLE_SOURCE_ID,
      minzoom: 7,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["has", "label"]],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          7,
          10,
          10,
          13
        ],
        "text-offset": [0, 1.35],
        "text-anchor": "top",
        "text-allow-overlap": false,
        "text-ignore-placement": false,
        "text-padding": 3
      },
      paint: {
        "text-color": "#f8fbff",
        "text-halo-color": "rgba(5, 9, 20, 0.86)",
        "text-halo-width": 2,
        "text-halo-blur": 0.4
      }
    });

    SAMPLE_LAYERS.forEach((layerId) => {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("click", layerId, (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        new maplibregl.Popup({ closeButton: false })
          .setLngLat(event.lngLat)
          .setHTML(feature.properties?.popup ?? "")
          .addTo(map);
      });
    });

    map.on("mouseenter", WARNING_OVERLAY_LAYER_ID, (event) => {
      const feature = event.features?.[0];
      const area = warningAreasByCode.get(String(feature?.properties?.code ?? ""));
      if (area) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", WARNING_OVERLAY_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("click", WARNING_OVERLAY_LAYER_ID, (event) => {
      const feature = event.features?.[0];
      const area = warningAreasByCode.get(String(feature?.properties?.code ?? ""));
      if (!area) return;
      new maplibregl.Popup({ closeButton: false })
        .setLngLat(event.lngLat)
        .setHTML(buildWarningPopup(area))
        .addTo(map);
    });
  }

  function updateWarningAreaLookup(mode, data = {}) {
    warningAreasByCode = mode === "warnings" && Array.isArray(data?.activeAreas)
      ? new Map(data.activeAreas.map((area) => [String(area.areaCode), area]))
      : new Map();
  }

  return { initialize, setMode, renderData };
}

function createBaseStyle() {
  return {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      "world-land": {
        type: "geojson",
        data: baseMapData.worldLand
      },
      "world-countries": {
        type: "geojson",
        data: baseMapData.worldCountries
      },
      [MUNICIPALITY_SOURCE_ID]: {
        type: "geojson",
        data: "/data/jma-weather-warning-municipalities.geojson",
        promoteId: "code"
      },
      [WARNING_SOURCE_ID]: {
        type: "geojson",
        data: createEmptyFeatureCollection(),
        promoteId: "code"
      },
      [RADAR_COVERAGE_SOURCE_ID]: {
        type: "geojson",
        data: createRadarCoverageFeature()
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0c1326" }
      },
      {
        id: "world-land-fill",
        type: "fill",
        source: "world-land",
        paint: {
          "fill-color": "#252a33",
          "fill-antialias": false,
          "fill-opacity": 1
        }
      },
      {
        id: "world-country-line",
        type: "line",
        source: "world-countries",
        paint: {
          "line-color": "#5e6672",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2,
            0.35,
            5,
            0.65,
            8,
            1
          ],
          "line-opacity": 0.42
        }
      },
      {
        id: MUNICIPALITY_FILL_LAYER_ID,
        type: "fill",
        source: MUNICIPALITY_SOURCE_ID,
        paint: {
          "fill-color": DEFAULT_LAND_FILL,
          "fill-antialias": false,
          "fill-opacity": 1
        }
      },
      {
        id: WARNING_OVERLAY_LAYER_ID,
        type: "fill",
        source: WARNING_SOURCE_ID,
        paint: {
          "fill-color": "rgba(0, 0, 0, 0)",
          "fill-antialias": false,
          "fill-opacity": 0
        }
      },
      {
        id: RADAR_COVERAGE_LAYER_ID,
        type: "fill",
        source: RADAR_COVERAGE_SOURCE_ID,
        layout: {
          visibility: "none"
        },
        paint: {
          "fill-color": "#3ba7ff",
          "fill-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.09,
            7,
            0.055,
            10,
            0.04
          ]
        }
      },
      {
        id: "jma-municipality-line",
        type: "line",
        source: MUNICIPALITY_SOURCE_ID,
        paint: {
          "line-color": "#848a94",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.45,
            7,
            0.85,
            10,
            1.25
          ],
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.55,
            7,
            0.82,
            10,
            0.95
          ]
        }
      }
    ]
  };
}

function buildWorldLandWithoutJapanData() {
  const data = cloneGeoJson(worldLandGeoJson);
  data.features = data.features.filter((feature) => !isSmallNaturalEarthJapanFeature(feature));
  return data;
}

function buildWorldCountriesWithoutJapanData() {
  const data = cloneGeoJson(worldCountriesGeoJson);
  data.features = data.features.filter((feature) =>
    String(feature?.properties?.ISO_A3 ?? "").toUpperCase() !== "JPN"
  );
  return data;
}

function cloneGeoJson(data) {
  return JSON.parse(JSON.stringify(data));
}

function setupWindArrowImage(map) {
  if (map.hasImage(WIND_ARROW_IMAGE_ID)) return;

  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, size, size);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(32, 4);
  context.lineTo(52, 31);
  context.lineTo(40, 28);
  context.lineTo(40, 58);
  context.lineTo(24, 58);
  context.lineTo(24, 28);
  context.lineTo(12, 31);
  context.closePath();
  context.fill();

  map.addImage(WIND_ARROW_IMAGE_ID, context.getImageData(0, 0, size, size), { sdf: true });
}

function setupWarningHatchImage(map) {
  if (map.hasImage(WARNING_HATCH_IMAGE_ID)) return;

  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, size, size);
  context.strokeStyle = "rgba(0, 0, 0, 0.9)";
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(-4, size + 4);
  context.lineTo(size + 4, -4);
  context.moveTo(size - 4, size + 4);
  context.lineTo(size + 4, size - 4);
  context.stroke();

  map.addImage(WARNING_HATCH_IMAGE_ID, context.getImageData(0, 0, size, size));
}

function isSmallNaturalEarthJapanFeature(feature) {
  const bounds = computeGeometryBounds(feature?.geometry);
  if (!Number.isFinite(bounds.minLng)) return false;

  const centerLng = (bounds.minLng + bounds.maxLng) / 2;
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const spanLng = bounds.maxLng - bounds.minLng;
  const spanLat = bounds.maxLat - bounds.minLat;
  const isJapanMainRange = centerLng >= 127.0;
  const isSouthwestIslandsRange = centerLng >= 122.0 && centerLat <= 27.5;

  return (
    centerLng >= NATURAL_EARTH_JAPAN_MASK_BOUNDS.minLng &&
    centerLng <= NATURAL_EARTH_JAPAN_MASK_BOUNDS.maxLng &&
    centerLat >= NATURAL_EARTH_JAPAN_MASK_BOUNDS.minLat &&
    centerLat <= NATURAL_EARTH_JAPAN_MASK_BOUNDS.maxLat &&
    (isJapanMainRange || isSouthwestIslandsRange) &&
    spanLng <= 18 &&
    spanLat <= 14
  );
}

function computeGeometryBounds(geometry) {
  const bounds = {
    minLng: Infinity,
    maxLng: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity
  };

  function walk(coords) {
    if (!Array.isArray(coords)) return;

    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        bounds.minLng = Math.min(bounds.minLng, lng);
        bounds.maxLng = Math.max(bounds.maxLng, lng);
        bounds.minLat = Math.min(bounds.minLat, lat);
        bounds.maxLat = Math.max(bounds.maxLat, lat);
      }
      return;
    }

    coords.forEach(walk);
  }

  if (geometry?.type === "GeometryCollection") {
    geometry.geometries?.forEach((child) => {
      const childBounds = computeGeometryBounds(child);
      if (Number.isFinite(childBounds.minLng)) {
        bounds.minLng = Math.min(bounds.minLng, childBounds.minLng);
        bounds.maxLng = Math.max(bounds.maxLng, childBounds.maxLng);
        bounds.minLat = Math.min(bounds.minLat, childBounds.minLat);
        bounds.maxLat = Math.max(bounds.maxLat, childBounds.maxLat);
      }
    });
  } else {
    walk(geometry?.coordinates);
  }

  return bounds;
}

function updateWarningMunicipalityPaint(map, mode, data = {}) {
  if (!map?.getLayer(WARNING_OVERLAY_LAYER_ID)) return;

  const activeAreas = mode === "warnings" && Array.isArray(data?.activeAreas)
    ? data.activeAreas
    : [];
  void updateWarningMunicipalitySource(map, activeAreas);

  if (activeAreas.length === 0) {
    map.setPaintProperty(WARNING_OVERLAY_LAYER_ID, "fill-color", "rgba(0, 0, 0, 0)");
    map.setPaintProperty(WARNING_OVERLAY_LAYER_ID, "fill-opacity", 0);
    updateWarningHatchPaint(map, []);
    return;
  }

  map.setPaintProperty(WARNING_OVERLAY_LAYER_ID, "fill-color", [
    "match",
    ["get", "warningLevel"],
    "emergency",
    getWarningColor("emergency"),
    "danger",
    getWarningColor("danger"),
    "warning",
    getWarningColor("warning"),
    "advisory",
    getWarningColor("advisory"),
    "rgba(0, 0, 0, 0)"
  ]);
  map.setPaintProperty(WARNING_OVERLAY_LAYER_ID, "fill-opacity", [
    "interpolate",
    ["linear"],
    ["zoom"],
    4,
    0.68,
    8,
    0.78
  ]);
  updateWarningHatchPaint(map, activeAreas);
}

async function updateWarningMunicipalitySource(map, activeAreas) {
  const source = map?.getSource(WARNING_SOURCE_ID);
  if (!source?.setData) return;

  try {
    if (activeAreas.length === 0) {
      source.setData(createEmptyFeatureCollection());
      return;
    }

    const municipalityData = await loadWarningMunicipalityData();
    const activeAreasByCode = new Map(activeAreas.map((area) => [String(area.areaCode), area]));
    source.setData({
      ...municipalityData,
      features: municipalityData.features
        .map((feature) => {
          const code = String(feature?.properties?.code ?? "");
          const activeArea = activeAreasByCode.get(code);
          if (!activeArea?.level) return null;
          return {
            ...feature,
            properties: {
              ...feature.properties,
              warningLevel: activeArea.level
            }
          };
        })
        .filter(Boolean)
    });
    map.triggerRepaint();
  } catch (error) {
    console.warn("[Weather Viewer] warning municipality source update failed", error);
  }
}

function loadWarningMunicipalityData() {
  if (!warningMunicipalityDataPromise) {
    warningMunicipalityDataPromise = fetch(JMA_ENDPOINTS.warningMunicipalities)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      });
  }
  return warningMunicipalityDataPromise;
}

function updateWarningHatchPaint(map, activeAreas) {
  if (!map?.getLayer(WARNING_HATCH_LAYER_ID)) return;

  map.setFilter(WARNING_HATCH_LAYER_ID, [
    "==",
    ["get", "warningLevel"],
    "emergency"
  ]);
  map.setPaintProperty(
    WARNING_HATCH_LAYER_ID,
    "fill-opacity",
    activeAreas.some((area) => area.level === "emergency") ? 0.7 : 0
  );
}

function updateRadarLayer(map, mode, data = {}) {
  if (mode !== "radar" || !data?.radarTileUrl) {
    setRadarVisible(map, false);
    return;
  }

  const currentSource = map.getSource(getRadarSourceId(RADAR_ZOOM_LEVELS[0].id));
  if (currentSource && currentSource.tiles?.[0] === getRadarTileUrl(data.radarTileUrl, RADAR_ZOOM_LEVELS[0])) {
    setRadarVisible(map, true);
    return;
  }

  removeRadarLayer(map);
  RADAR_ZOOM_LEVELS.forEach((level) => {
    const { z, minzoom, maxzoom } = level;
    const sourceId = getRadarSourceId(level.id);
    const layerId = getRadarLayerId(level.id);
    map.addSource(sourceId, {
      type: "raster",
      tiles: [getRadarTileUrl(data.radarTileUrl, level)],
      tileSize: 256,
      minzoom: 0,
      maxzoom: z,
      bounds: [118, 20, 150, 48],
      attribution: "気象庁"
    });
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      minzoom,
      maxzoom,
      paint: {
        "raster-opacity": 0.9,
        "raster-fade-duration": 0,
        "raster-resampling": "nearest"
      }
    }, "jma-municipality-line");
  });
}

function setRadarVisible(map, isVisible) {
  if (map?.getLayer(RADAR_COVERAGE_LAYER_ID)) {
    map.setLayoutProperty(RADAR_COVERAGE_LAYER_ID, "visibility", isVisible ? "visible" : "none");
  }
  RADAR_ZOOM_LEVELS.forEach(({ id }) => {
    const layerId = getRadarLayerId(id);
    if (map?.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none");
    }
  });
}

function removeRadarLayer(map) {
  [...RADAR_ZOOM_LEVELS].reverse().forEach(({ id }) => {
    const layerId = getRadarLayerId(id);
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  });
  [...RADAR_ZOOM_LEVELS].reverse().forEach(({ id }) => {
    const sourceId = getRadarSourceId(id);
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  });
}

function getRadarSourceId(id) {
  return `${RADAR_SOURCE_PREFIX}${id}`;
}

function getRadarLayerId(id) {
  return `${RADAR_LAYER_PREFIX}${id}`;
}

function getRadarTileUrl(tileUrl, level) {
  return tileUrl.replace("{z}", String(level.z));
}

function getWarningColor(level) {
  if (level === "emergency") return "#b400ff";
  if (level === "danger") return "#b400ff";
  if (level === "warning") return "#ff2b12";
  return "#fff000";
}

function createEmptyFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: []
  };
}

function createRadarCoverageFeature() {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [118.0, 20.0],
            [154.0, 20.0],
            [154.0, 49.0],
            [118.0, 49.0],
            [118.0, 20.0]
          ]]
        },
        properties: {}
      }
    ]
  };
}

function createSampleFeatureCollection(mode, data = {}) {
  const builders = {
    radar: createRadarFeatures,
    amedas: createAmedasFeatures,
    warnings: createWarningFeatures,
    typhoon: createTyphoonFeatures
  };

  return {
    type: "FeatureCollection",
    features: builders[mode]?.(data) ?? []
  };
}

function createRadarFeatures(data) {
  return [];
}

function createAmedasFeatures(data) {
  const metric = AMEDAS_METRICS.find((item) => item.id === data?.activeMetric) ?? AMEDAS_METRICS[0];
  return (data?.points ?? []).flatMap((point) => {
    const value = point.values?.[metric.id];
    if (!Number.isFinite(value)) return [];
    if (metric.id === "precipitation" && value < 0.1) return [];
    if (metric.id === "snow" && value < 1) return [];

    return [{
      type: "Feature",
      geometry: { type: "Point", coordinates: point.coordinates },
      properties: {
        color: getAmedasColor(metric.id, value),
        markerType: metric.id === "wind" ? "wind" : "circle",
        rotation: metric.id === "wind" ? getWindArrowRotation(point.windDirection) : 0,
        radius: getAmedasRadius(metric.id, value),
        label: `${point.name} ${formatAmedasValue(value)}${metric.unit}`,
        popup: buildAmedasPopup(point, metric, value, data?.latestTime)
      }
    }];
  });
}

function createWarningFeatures(data) {
  return [];
}

function buildWarningPopup(area) {
  const warnings = (area.warnings ?? [])
    .map((warning) => `<span class="warning-badge warning-badge-${escapePopup(warning.level)}">${escapePopup(warning.label)}</span>`)
    .join("");
  return `
    <strong>${escapePopup(area.areaName ?? area.areaCode)}</strong><br>
    <span>${escapePopup(area.prefecture ?? "")}</span>
    <div class="warning-popup-badges">${warnings}</div>
    <span>更新: ${escapePopup(area.updatedAt ?? "未取得")}</span>
  `;
}

function createTyphoonFeatures(data) {
  return [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [132.0, 20.5],
          [134.0, 23.5],
          [136.0, 27.0],
          [138.0, 31.0]
        ]
      },
      properties: {
        color: "#d5a6ff",
        lineWidth: 3,
        popup: `台風情報<br>${data?.summary ?? "台風データ接続待ち"}`
      }
    }
  ];
}

function buildAmedasPopup(point, metric, value, latestTime) {
  const windDirection = Number.isFinite(point.windDirection)
    ? `<br>風向: ${getWindDirectionLabel(point.windDirection)}から`
    : "";
  return `${escapePopup(point.name)}<br>${metric.label}: ${formatAmedasValue(value)} ${metric.unit}${windDirection}<br>アメダス最新時刻: ${latestTime ?? "未取得"}`;
}

function getAmedasColor(metricId, value) {
  if (metricId === "temperature") {
    return interpolateLevelColor(AMEDAS_TEMPERATURE_LEVELS, value);
  }
  if (metricId === "precipitation") {
    return AMEDAS_PRECIPITATION_LEVELS.find((level) => value >= level.min)?.color ?? "#a8d8ff";
  }
  if (metricId === "wind") {
    return interpolateLevelColor(AMEDAS_WIND_LEVELS, value);
  }
  if (metricId === "snow") {
    return interpolateLevelColor(AMEDAS_SNOW_LEVELS, value);
  }
  return "#d8e6f7";
}

function interpolateLevelColor(levels, value) {
  const stops = [...levels]
    .filter((level) => Number.isFinite(level.min))
    .sort((a, b) => a.min - b.min);

  if (value <= stops[0].min) return levels.at(-1).color;
  if (value >= stops.at(-1).min) return stops.at(-1).color;

  const upper = stops.find((level) => value <= level.min) ?? stops.at(-1);
  const lower = stops[Math.max(0, stops.indexOf(upper) - 1)];
  const ratio = (value - lower.min) / (upper.min - lower.min);
  return mixHexColor(lower.color, upper.color, ratio);
}

function mixHexColor(start, end, ratio) {
  const startRgb = hexToRgb(start);
  const endRgb = hexToRgb(end);
  const amount = Math.max(0, Math.min(1, ratio));
  const mixed = startRgb.map((channel, index) =>
    Math.round(channel + (endRgb[index] - channel) * amount)
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16)
  ];
}

function getAmedasRadius(metricId, value) {
  if (metricId === "precipitation") return Math.min(14, 5 + value / 6);
  if (metricId === "wind") return Math.min(13, 5 + value / 4);
  if (metricId === "snow") return Math.min(13, 5 + value / 30);
  return 7;
}

function getWindDirectionLabel(value) {
  const labels = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
  const index = Math.round(Number(value)) % 16;
  return labels[index] ?? `${value}`;
}

function getWindArrowRotation(value) {
  if (!Number.isFinite(value)) return 0;
  return ((Math.round(Number(value)) % 16) * 22.5 + 180) % 360;
}

function formatAmedasValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function escapePopup(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  }[char]));
}

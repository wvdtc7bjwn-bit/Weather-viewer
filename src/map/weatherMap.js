import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AMEDAS_METRICS,
  AMEDAS_PRECIPITATION_LEVELS,
  AMEDAS_SNOW_LEVELS,
  AMEDAS_TEMPERATURE_LEVELS,
  AMEDAS_WIND_LEVELS,
  DEFAULT_VIEW,
  JMA_ENDPOINTS,
  KIKIKURU_ELEMENTS
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
const SAMPLE_LAYERS = ["sample-fill", "sample-line", "sample-line-dashed", "sample-circle", "sample-wind-arrow", "sample-label"];
const TYPHOON_SOURCE_ID = "jma-typhoon";
const TYPHOON_LAYERS = [
  "typhoon-wind-area-fill",
  "typhoon-wind-area-line",
  "typhoon-forecast-area-fill",
  "typhoon-forecast-circle-fill",
  "typhoon-forecast-area",
  "typhoon-warning-area-fill",
  "typhoon-warning-area",
  "typhoon-forecast-circle",
  "layer-typhoon-past-track",
  "typhoon-forecast-route",
  "typhoon-center-x",
  "typhoon-forecast-label",
  "typhoon-label"
];
const WIND_ARROW_IMAGE_ID = "amedas-wind-arrow";
const RADAR_COVERAGE_SOURCE_ID = "jma-nowcast-coverage";
const RADAR_COVERAGE_LAYER_ID = "jma-nowcast-coverage";
const RADAR_SOURCE_PREFIX = "jma-nowcast-radar-z";
const RADAR_LAYER_PREFIX = "jma-nowcast-radar-z";
const KIKIKURU_SOURCE_PREFIX = "jma-kikikuru";
const KIKIKURU_LAYER_PREFIX = "jma-kikikuru";
const KIKIKURU_ZOOM_LEVELS = [
  { id: "z4", z: 4, minzoom: 4, maxzoom: 5 },
  { id: "z6", z: 6, minzoom: 5, maxzoom: 7 },
  { id: "z8", z: 8, minzoom: 7, maxzoom: 10 },
  { id: "z10", z: 10, minzoom: 10, maxzoom: 22 }
];
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
const kikikuruTileUrlCache = new Map();

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
      dragRotate: true,
      pitchWithRotate: false,
      attributionControl: false,
      style: createBaseStyle()
    });
    map.touchZoomRotate.enableRotation();

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
    if (mode !== "warnings") {
      setKikikuruVisible(map, false);
    }
    if (mode !== "warnings") updateWarningMunicipalityPaint(map, mode);
  }

  function renderData(mode, data) {
    if (!map || !map.getSource(SAMPLE_SOURCE_ID)) {
      pendingRender = { mode, data };
      return;
    }

    const source = map.getSource(SAMPLE_SOURCE_ID);
    const collection = createSampleFeatureCollection(mode, data);
    source.setData(collection);
    const typhoonCollection = updateTyphoonLayers(mode, data);
    updateWarningAreaLookup(mode, data);
    updateRadarLayer(map, mode, data);
    updateKikikuruLayer(map, mode, data);
    updateWarningMunicipalityPaint(map, mode, data);
  }

  function setupSampleLayers() {
    map.addSource(SAMPLE_SOURCE_ID, {
      type: "geojson",
      data: createSampleFeatureCollection(activeMode)
    });
    map.addSource(TYPHOON_SOURCE_ID, {
      type: "geojson",
      data: createEmptyFeatureCollection()
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
      filter: ["all",
        ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]],
        ["!=", ["get", "lineStyle"], "dashed"]
      ],
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.9,
        "line-width": ["coalesce", ["get", "lineWidth"], 2]
      }
    });

    map.addLayer({
      id: "sample-line-dashed",
      type: "line",
      source: SAMPLE_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "lineStyle"], "dashed"]],
      paint: {
        "line-color": ["get", "color"],
        "line-opacity": 0.9,
        "line-width": ["coalesce", ["get", "lineWidth"], 2],
        "line-dasharray": [2, 2]
      }
    });

    map.addLayer({
      id: "sample-circle",
      type: "circle",
      source: SAMPLE_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "markerType"], "wind"]],
      layout: {
        "circle-sort-key": ["coalesce", ["get", "sortKey"], 0]
      },
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
        "symbol-sort-key": ["coalesce", ["get", "sortKey"], 0],
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

    map.addLayer({
      id: "typhoon-wind-area-fill",
      type: "fill",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "typhoonShape"], "windArea"]],
      paint: {
        "fill-color": ["get", "color"],
        "fill-opacity": ["coalesce", ["get", "fillOpacity"], 0.08],
        "fill-outline-color": ["get", "color"]
      }
    });

    map.addLayer({
      id: "typhoon-wind-area-line",
      type: "line",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "typhoonShape"], "windArea"]],
      paint: {
        "line-color": ["coalesce", ["get", "lineColor"], ["get", "color"]],
        "line-opacity": 0.98,
        "line-width": ["coalesce", ["get", "lineWidth"], 2]
      }
    });

    map.addLayer({
      id: "typhoon-forecast-area-fill",
      type: "fill",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "typhoonShape"], "forecastAreaFill"]],
      paint: {
        "fill-color": "#f8fbff",
        "fill-opacity": 0.018
      }
    });

    map.addLayer({
      id: "typhoon-warning-area-fill",
      type: "fill",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "typhoonShape"], "warningAreaFill"]],
      paint: {
        "fill-color": "#ff2800",
        "fill-opacity": 0
      }
    });

    map.addLayer({
      id: "typhoon-forecast-circle-fill",
      type: "fill",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "typhoonShape"], "forecastCircle"]],
      paint: {
        "fill-color": "#f8fbff",
        "fill-opacity": 0
      }
    });

    map.addLayer({
      id: "typhoon-forecast-area",
      type: "line",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "typhoonShape"], "forecastArea"]],
      paint: {
        "line-color": "#f8fbff",
        "line-opacity": 0.78,
        "line-width": 1.35
      }
    });

    map.addLayer({
      id: "typhoon-warning-area",
      type: "line",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "typhoonShape"], "warningArea"]],
      paint: {
        "line-color": "#ff2b12",
        "line-opacity": 0.9,
        "line-width": 1.45
      }
    });

    map.addLayer({
      id: "typhoon-forecast-circle",
      type: "line",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "Polygon"], ["==", ["get", "typhoonShape"], "forecastCircle"]],
      paint: {
        "line-color": "#f8fbff",
        "line-opacity": 0.8,
        "line-width": 1.35,
        "line-dasharray": [1.5, 1.6]
      }
    });

    map.addLayer({
      id: "layer-typhoon-past-track",
      type: "line",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "type"], "pastTrack"]],
      paint: {
        "line-color": "#ffffff",
        "line-opacity": 0.6,
        "line-width": 2
      }
    });

    map.addLayer({
      id: "typhoon-forecast-route",
      type: "line",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "typhoonShape"], "forecastRoute"]],
      paint: {
        "line-color": "#f8fbff",
        "line-opacity": 0.52,
        "line-width": ["coalesce", ["get", "lineWidth"], 1.1],
        "line-dasharray": [2, 2]
      }
    });

    map.addLayer({
      id: "typhoon-forecast-label",
      type: "symbol",
      source: TYPHOON_SOURCE_ID,
      minzoom: 3,
      filter: ["all", ["has", "label"], ["==", ["get", "typhoonShape"], "forecastLabel"]],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          3,
          10,
          7,
          12
        ],
        "text-anchor": "center",
        "text-allow-overlap": true,
        "text-ignore-placement": true
      },
      paint: {
        "text-color": "#9aa8ff",
        "text-halo-color": "rgba(248, 251, 255, 0.76)",
        "text-halo-width": 1.4,
        "text-halo-blur": 0.2
      }
    });

    map.addLayer({
      id: "typhoon-center-x",
      type: "line",
      source: TYPHOON_SOURCE_ID,
      filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "typhoonShape"], "centerX"]],
      paint: {
        "line-color": "#f8fbff",
        "line-opacity": 1,
        "line-width": 3
      }
    });

    map.addLayer({
      id: "typhoon-label",
      type: "symbol",
      source: TYPHOON_SOURCE_ID,
      minzoom: 4,
      filter: ["all", ["has", "label"], ["==", ["get", "typhoonShape"], "centerX"]],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-size": 13,
        "text-offset": [0, 1.35],
        "text-anchor": "top",
        "text-allow-overlap": true
      },
      paint: {
        "text-color": "#f8fbff",
        "text-halo-color": "rgba(5, 9, 20, 0.9)",
        "text-halo-width": 2
      }
    });

    [...SAMPLE_LAYERS, ...TYPHOON_LAYERS].forEach((layerId) => {
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
      window.dispatchEvent(new CustomEvent("weather-warning-area-select", {
        detail: {
          areaCode: area.areaCode,
          areaName: area.areaName
        }
      }));
    });
  }

  function updateWarningAreaLookup(mode, data = {}) {
    warningAreasByCode = mode === "warnings" && data?.activeWarningView !== "kikikuru" && Array.isArray(data?.activeAreas)
      ? new Map(data.activeAreas.map((area) => [String(area.areaCode), area]))
      : new Map();
  }

  function updateTyphoonLayers(mode, data) {
    const source = map?.getSource(TYPHOON_SOURCE_ID);
    if (!source?.setData) return null;

    const collection = mode === "typhoon"
      ? {
        type: "FeatureCollection",
        features: createTyphoonFeatures(data)
      }
      : createEmptyFeatureCollection();

    source.setData(collection);
    TYPHOON_LAYERS.forEach((layerId) => {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", mode === "typhoon" ? "visible" : "none");
    });
    return collection;
  }

  function resize() {
    map?.resize();
  }

  return { initialize, setMode, renderData, resize };
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
        data: JMA_ENDPOINTS.warningMunicipalities,
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

  const activeAreas = mode === "warnings" && data?.activeWarningView !== "kikikuru" && Array.isArray(data?.activeAreas)
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

function updateKikikuruLayer(map, mode, data = {}) {
  const isVisible = mode === "warnings" && data?.activeWarningView === "kikikuru";
  const tileUrls = data?.kikikuru?.tileUrls ?? {};
  const activeLayerIds = getActiveKikikuruLayerIds(data?.activeKikikuruLayer);

  if (!isVisible || Object.keys(tileUrls).length === 0) {
    setKikikuruVisible(map, false);
    return;
  }

  KIKIKURU_ELEMENTS.forEach((element) => {
    const tileUrl = tileUrls[element.id];
    if (!activeLayerIds.has(element.id)) {
      setKikikuruElementVisible(map, element.id, false);
      return;
    }
    if (!tileUrl) return;
    KIKIKURU_ZOOM_LEVELS.forEach((level) => {
      ensureKikikuruRasterLayer(map, element, level, getKikikuruTileUrl(tileUrl, level));
    });
  });

  setKikikuruVisible(map, true, activeLayerIds);
}

function ensureKikikuruRasterLayer(map, element, level, tileUrl) {
  const sourceId = getKikikuruSourceId(element.id, level.id);
  const layerId = getKikikuruLayerId(element.id, level.id);
  const cachedTileUrl = kikikuruTileUrlCache.get(sourceId);

  if (!map.getSource(sourceId)) {
    addKikikuruRasterSourceAndLayer(map, element, level, tileUrl);
    kikikuruTileUrlCache.set(sourceId, tileUrl);
    return;
  }

  if (!map.getLayer(layerId)) {
    addKikikuruRasterLayer(map, element, level);
  }

  if (!cachedTileUrl) {
    kikikuruTileUrlCache.set(sourceId, tileUrl);
    return;
  }

  if (cachedTileUrl && cachedTileUrl !== tileUrl && !map.isMoving()) {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
    map.removeSource(sourceId);
    addKikikuruRasterSourceAndLayer(map, element, level, tileUrl);
    kikikuruTileUrlCache.set(sourceId, tileUrl);
  }
}

function addKikikuruRasterSourceAndLayer(map, element, level, tileUrl) {
  const sourceId = getKikikuruSourceId(element.id, level.id);
  map.addSource(sourceId, {
    type: "raster",
    tiles: [tileUrl],
    tileSize: 256,
    minzoom: level.z,
    maxzoom: level.z,
    bounds: [118, 20, 150, 48],
    attribution: "気象庁"
  });
  addKikikuruRasterLayer(map, element, level);
}

function addKikikuruRasterLayer(map, element, level) {
  const layerId = getKikikuruLayerId(element.id, level.id);
  if (map.getLayer(layerId)) return;
  map.addLayer({
    id: layerId,
    type: "raster",
    source: getKikikuruSourceId(element.id, level.id),
    minzoom: level.minzoom,
    maxzoom: level.maxzoom,
    paint: {
      "raster-opacity": element.opacity ?? 0.8,
      "raster-fade-duration": 0,
      "raster-resampling": "nearest"
    }
  }, "jma-municipality-line");
}

function setKikikuruVisible(map, isVisible, activeLayerIds = null) {
  KIKIKURU_ELEMENTS.forEach((element) => {
    const shouldShow = isVisible && (!activeLayerIds || activeLayerIds.has(element.id));
    setKikikuruElementVisible(map, element.id, shouldShow);
  });
}

function setKikikuruElementVisible(map, elementId, isVisible) {
  KIKIKURU_ZOOM_LEVELS.forEach((level) => {
    const layerId = getKikikuruLayerId(elementId, level.id);
    if (map?.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", isVisible ? "visible" : "none");
    }
  });
}

function getActiveKikikuruLayerIds(activeLayer) {
  return new Set([activeLayer === "inund" ? "inund" : "land"]);
}

function getKikikuruSourceId(id, zoomId) {
  return `${KIKIKURU_SOURCE_PREFIX}-${id}-${zoomId}`;
}

function getKikikuruLayerId(id, zoomId) {
  return `${KIKIKURU_LAYER_PREFIX}-${id}-${zoomId}`;
}

function getKikikuruTileUrl(tileUrl, level) {
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
  if (mode === "typhoon") return createEmptyFeatureCollection();

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
    if (metric.id === "wind" && !Number.isFinite(point.windDirection)) return [];

    return [{
      type: "Feature",
      geometry: { type: "Point", coordinates: point.coordinates },
      properties: {
        color: getAmedasColor(metric.id, value),
        markerType: metric.id === "wind" ? "wind" : "circle",
        rotation: metric.id === "wind" ? getWindArrowRotation(point.windDirection) : 0,
        radius: getAmedasRadius(metric.id, value),
        sortKey: metric.id === "temperature" ? value : 0,
        label: `${point.name} ${formatAmedasValue(value)}${metric.unit}`,
        popup: buildAmedasPopup(point, metric, value, data?.latestTime)
      }
    }];
  });
}

function createWarningFeatures(data) {
  return [];
}

function createTyphoonFeatures(data) {
  if (!data?.hasTyphoon) return [];

  return (data.typhoons ?? []).flatMap((typhoon) => {
    const features = [];
    features.push(...createTyphoonRadiusFeatures(typhoon));

    const pastTrack = typhoon.pastTrack?.length ? typhoon.pastTrack : typhoon.track;
    if (pastTrack?.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: pastTrack
        },
        properties: {
          type: "pastTrack",
          typhoonShape: "pastTrack",
          popup: buildTyphoonPopup(typhoon, "過去の経路")
        }
      });
    }

    if (typhoon.forecastTrack?.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: typhoon.forecastTrack
        },
        properties: {
          color: "#f8fbff",
          typhoonShape: "forecastRoute",
          lineWidth: 2,
          popup: buildTyphoonPopup(typhoon, "予報経路")
        }
      });
    }

    features.push(...createTyphoonForecastAreaFeatures(typhoon));

    (typhoon.forecastCircles ?? []).forEach((circle) => {
      const feature = createTyphoonCircleFeature(circle.center, circle.radius, {
        color: "#f8fbff",
        typhoonShape: "forecastCircle",
        fillOpacity: 0.1,
        lineWidth: 1.4,
        popup: buildTyphoonPopup(typhoon, circle.label ? `予報円 ${circle.label}` : "予報円")
      });
      if (feature) features.push(feature);
      if (circle.center?.length === 2 && circle.label) {
        features.push(createTyphoonForecastLabelFeature(circle, typhoon));
      }
    });

    if (typhoon.stormWarningAreaShape) {
      features.push(...createTyphoonStormWarningShapeFeatures(typhoon));
    } else if (hasCircleSet(typhoon.stormWarningArea)) {
      features.push(...createTyphoonStormWarningFeatures(typhoon));
    } else if (typhoon.stormWarningArea?.length >= 3) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: closeLine(typhoon.stormWarningArea)
        },
        properties: {
          color: "#ff2b12",
          typhoonShape: "warningArea",
          popup: buildTyphoonPopup(typhoon, "暴風警戒域")
        }
      });
    }

    if (typhoon.center?.length === 2) {
      features.push(...createTyphoonCenterXFeatures(typhoon));
    }

    return features;
  });
}

function buildTyphoonPopup(typhoon, label) {
  const details = typhoon.details ?? {};
  return `
    <strong>${escapePopup(typhoon.name ?? "台風情報")}</strong><br>
    <span>${escapePopup(label)}</span><br>
    <span>中心気圧: ${escapePopup(details.pressure ?? "未取得")}</span><br>
    <span>最大風速: ${escapePopup(details.maxWind ?? "未取得")}</span><br>
    <span>最大瞬間風速: ${escapePopup(details.maxGust ?? "未取得")}</span><br>
    <span>移動: ${escapePopup(details.direction ?? "未取得")} ${escapePopup(details.speed ?? "")}</span><br>
    <span>更新: ${escapePopup(typhoon.updatedAt ?? "未取得")}</span>
  `;
}

function createTyphoonCircleFeature(center, radiusKm, properties) {
  if (!center || !Number.isFinite(radiusKm) || radiusKm <= 0) return null;
  const points = createMercatorCircleCoordinates(center, radiusKm, 128);

  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [points]
    },
    properties
  };
}

function createMercatorCircleCoordinates(center, radiusKm, steps = 128) {
  const { pixelCenter, pixelRadius } = projectCircleForTangents({ center, radius: radiusKm });
  const points = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push(unprojectMercatorPixel({
      x: pixelCenter.x + pixelRadius * Math.cos(angle),
      y: pixelCenter.y + pixelRadius * Math.sin(angle)
    }));
  }

  return points;
}

function createTyphoonCircleLineFeature(center, radiusKm, properties) {
  const polygon = createTyphoonCircleFeature(center, radiusKm, properties);
  if (!polygon) return null;
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: polygon.geometry.coordinates[0]
    },
    properties
  };
}

function createTyphoonStormWarningFeatures(typhoon) {
  const groups = buildStormWarningCircleGroups(typhoon);
  const features = groups.flatMap((circles) => createStormWarningCircleGroupFeatures(typhoon, circles));
  if (features.length) return features;

  const circles = buildStormWarningCircles(typhoon);
  return circles
    .map((circle) => createTyphoonCircleLineFeature(circle.center, circle.radius, {
      color: "#ff2b12",
      typhoonShape: "warningArea",
      popup: buildTyphoonPopup(typhoon, circle.label ? `暴風警戒域 ${circle.label}` : "暴風警戒域")
    }))
    .filter(Boolean);
}

function createStormWarningCircleGroupFeatures(typhoon, circles) {
  if (circles.length >= 2) {
    return createOuterTangentAreaFeatures(circles, {
      fillShape: "warningAreaFill",
      lineShape: "warningArea",
      color: "#ff2800",
      popup: buildTyphoonPopup(typhoon, "暴風警戒域"),
      useAdjacentTangents: true,
      startRingAtEndArc: true
    });
  }

  return circles
    .map((circle) => createTyphoonCircleLineFeature(circle.center, circle.radius, {
      color: "#ff2b12",
      typhoonShape: "warningArea",
      popup: buildTyphoonPopup(typhoon, circle.label ? `暴風警戒域 ${circle.label}` : "暴風警戒域")
    }))
    .filter(Boolean);
}

function buildStormWarningCircleGroups(typhoon) {
  if (Array.isArray(typhoon.stormWarningGroups)) {
    return typhoon.stormWarningGroups
      .map((group) => group.filter((circle) => circle?.center && Number.isFinite(circle.radius)))
      .filter((group) => group.length > 0);
  }

  const circles = buildStormWarningCircles(typhoon);
  return circles.length ? [circles] : [];
}

function buildStormWarningCircles(typhoon) {
  const circles = [];
  const stormRadius = readRadiusKm(typhoon, ["stormRadius", "wind25mRadius", "violentWindRadius"]);
  if (typhoon.center?.length === 2 && Number.isFinite(stormRadius)) {
    circles.push({ center: typhoon.center, radius: stormRadius, label: "暴風域" });
  }

  (typhoon.stormWarningArea ?? []).forEach((circle) => {
    if (!circle?.center || !Number.isFinite(circle.radius)) return;
    const sameAsCurrentCenter = typhoon.center?.length === 2
      && getPointDistanceSq(circle.center, typhoon.center) < 0.0001;
    if (!(sameAsCurrentCenter && Number.isFinite(stormRadius))) circles.push(circle);
  });

  return circles;
}

function createTyphoonStormWarningShapeFeatures(typhoon) {
  const ring = buildStormWarningAreaRing(typhoon.stormWarningAreaShape);
  if (!ring) return [];

  const properties = {
    color: "#ff2800",
    typhoonShape: "warningAreaFill",
    popup: buildTyphoonPopup(typhoon, "暴風警戒域")
  };

  return [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [ring]
      },
      properties
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: ring
      },
      properties: {
        ...properties,
        typhoonShape: "warningArea"
      }
    }
  ];
}

function buildStormWarningAreaRing(stormWarningArea) {
  const segments = [];

  (stormWarningArea?.arc ?? []).forEach((arc) => {
    const segment = makeStormWarningArcSegment(arc);
    if (segment?.length >= 2) segments.push(segment);
  });

  (stormWarningArea?.line ?? []).forEach((line) => {
    const segment = line.filter((point) => point?.length === 2);
    if (segment.length >= 2) segments.push(segment);
  });

  if (segments.length === 0) return null;
  const unused = segments.slice(1);
  const ring = segments[0].slice();

  while (unused.length > 0) {
    const tail = ring.at(-1);
    let bestIndex = 0;
    let bestReverse = false;
    let bestDistance = Infinity;

    unused.forEach((segment, index) => {
      const startDistance = getPointDistanceSq(tail, segment[0]);
      const endDistance = getPointDistanceSq(tail, segment.at(-1));
      if (startDistance < bestDistance) {
        bestIndex = index;
        bestReverse = false;
        bestDistance = startDistance;
      }
      if (endDistance < bestDistance) {
        bestIndex = index;
        bestReverse = true;
        bestDistance = endDistance;
      }
    });

    const next = unused.splice(bestIndex, 1)[0];
    const ordered = bestReverse ? next.slice().reverse() : next;
    ring.push(...ordered.slice(1));
  }

  return closeLine(ring);
}

function makeStormWarningArcSegment(arc) {
  const { center, radius } = arc ?? {};
  if (!center || !Number.isFinite(radius)) return null;
  let start = Number(arc.start);
  let end = Number(arc.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (end < start) end += 360;

  const span = Math.max(1, end - start);
  const steps = Math.max(8, Math.ceil(span / 5));
  const coordinates = [];
  for (let index = 0; index <= steps; index += 1) {
    const bearing = start + (span * index / steps);
    coordinates.push(destinationPoint(center, radius, bearing));
  }
  return coordinates;
}

function createTyphoonForecastAreaFeatures(typhoon) {
  if (!typhoon.center?.length || !typhoon.forecastCircles?.length) return [];

  const circles = [
    { center: typhoon.center, radius: 0 },
    ...typhoon.forecastCircles
      .filter((circle) => circle?.center?.length === 2 && Number.isFinite(circle.radius))
  ];
  if (circles.length < 2) return [];

  return createOuterTangentAreaFeatures(circles, {
    fillShape: "forecastAreaFill",
    lineShape: "forecastArea",
    color: "#f8fbff",
    popup: buildTyphoonPopup(typhoon, "予報領域"),
    skipEndArc: true
  });
}

function createOuterTangentAreaFeatures(circles, options) {
  const ring = options.useAdjacentTangents
    ? createOuterTangentMergedPolygonRing(circles, options)
    : createCircleHullRing(circles);
  if (!ring) return [];

  const properties = {
    color: options.color,
    popup: options.popup
  };

  const features = [
    {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [ring]
      },
      properties: {
        ...properties,
        typhoonShape: options.fillShape
      }
    }
  ];

  if (options.skipEndArc) {
    features.push(...createAdjacentOuterTangentLineFeatures(circles, options, properties));
    return features;
  }

  features.push(
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: ring
      },
      properties: {
        ...properties,
        typhoonShape: options.lineShape
      }
    }
  );
  return features;
}

function createCircleHullRing(circles) {
  const points = circles.flatMap((circle, circleIndex) =>
    createCircleHullSamplePoints(circle, circleIndex)
  );
  const hull = convexHull(points);
  if (hull.length < 3) return null;
  return closeLine(hull.map((point) => point.lngLat));
}

function createAdjacentOuterTangentLineFeatures(circles, options, properties) {
  const projectedCircles = createProjectedTangentCircles(circles);
  const features = [];

  for (let index = 0; index < projectedCircles.length - 1; index += 1) {
    const tangents = calcCircleTangents(projectedCircles[index], projectedCircles[index + 1]);
    tangents.forEach((coordinates) => {
      if (coordinates.length < 2) return;
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates
        },
        properties: {
          ...properties,
          typhoonShape: options.lineShape
        }
      });
    });
  }

  return features;
}

function createCircleHullSamplePoints(circle, circleIndex) {
  if (Array.isArray(circle.axes) && circle.axes.length >= 2) {
    return createDirectionalRadiusHullSamplePoints(circle, circleIndex);
  }

  const projected = projectCircleForTangents(circle);
  if (!Number.isFinite(projected.pixelRadius) || projected.pixelRadius <= 0) {
    return [{
      x: projected.pixelCenter.x,
      y: projected.pixelCenter.y,
      lngLat: circle.center,
      circleIndex
    }];
  }

  const steps = 144;
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    const point = {
      x: projected.pixelCenter.x + projected.pixelRadius * Math.cos(angle),
      y: projected.pixelCenter.y + projected.pixelRadius * Math.sin(angle)
    };
    return {
      ...point,
      lngLat: unprojectMercatorPixel(point),
      circleIndex
    };
  });
}

function createDirectionalRadiusHullSamplePoints(circle, circleIndex) {
  const steps = 144;
  return Array.from({ length: steps }, (_, index) => {
    const bearing = (index / steps) * 360;
    const radius = interpolateDirectionalRadius(circle.axes, bearing, circle.radius);
    const lngLat = destinationPoint(circle.center, radius, bearing);
    const point = projectMercatorPixel(lngLat);
    return {
      ...point,
      lngLat,
      circleIndex
    };
  });
}

function interpolateDirectionalRadius(axes, bearing, fallbackRadius) {
  const samples = axes
    .filter((axis) => Number.isFinite(axis.bearing) && Number.isFinite(axis.radius))
    .sort((a, b) => a.bearing - b.bearing);
  if (samples.length === 0) return fallbackRadius;
  if (samples.length === 1) return samples[0].radius;

  const normalizedBearing = ((bearing % 360) + 360) % 360;
  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    const next = samples[(index + 1) % samples.length];
    const start = current.bearing;
    const end = next.bearing > start ? next.bearing : next.bearing + 360;
    const target = normalizedBearing >= start ? normalizedBearing : normalizedBearing + 360;
    if (target >= start && target <= end) {
      const ratio = (target - start) / Math.max(end - start, 1);
      return current.radius + (next.radius - current.radius) * ratio;
    }
  }

  return fallbackRadius;
}

function convexHull(points) {
  const sorted = [...points]
    .sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x)
    .filter((point, index, array) => index === 0 || point.x !== array[index - 1].x || point.y !== array[index - 1].y);
  if (sorted.length <= 1) return sorted;

  const lower = [];
  sorted.forEach((point) => {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  });

  const upper = [];
  [...sorted].reverse().forEach((point) => {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  });

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(origin, a, b) {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

function hasSelfIntersection(ring) {
  const projected = ring.map((point) => projectMercatorPixel(point));
  for (let i = 0; i < projected.length - 1; i += 1) {
    for (let j = i + 2; j < projected.length - 1; j += 1) {
      if (i === 0 && j === projected.length - 2) continue;
      if (segmentsIntersect(projected[i], projected[i + 1], projected[j], projected[j + 1])) return true;
    }
  }
  return false;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function createOuterTangentMergedPolygonRing(circles, options = {}) {
  const parts = createOuterTangentParts(circles, options);
  if (!parts) return null;

  const endArc = options.skipEndArc
    ? [parts.sideA.at(-1), parts.sideB.at(-1)]
    : parts.endArc;
  const sideB = parts.sideB;
  const startArc = parts.startArc;
  const sideA = parts.sideA.slice(1, -1);
  const sideBReverse = sideB.slice(1, -1).reverse();
  let ringPoints = [
    ...startArc,
    ...sideA,
    ...endArc,
    ...sideBReverse
  ];
  if (options.startRingAtEndArc && !options.skipEndArc) {
    ringPoints = rotateOpenLine(ringPoints, startArc.length + sideA.length);
  }
  let ring = closeLine(ringPoints);
  if (hasSelfIntersection(ring)) {
    const sideA = parts.straightSideA;
    ringPoints = [
      ...parts.startArc.slice().reverse(),
      ...sideB.slice(1, -1),
      ...endArc.slice().reverse(),
      ...sideA.slice(1, -1).reverse()
    ];
    if (options.startRingAtEndArc && !options.skipEndArc) {
      ringPoints = rotateOpenLine(ringPoints, parts.startArc.length + sideB.slice(1, -1).length);
    }
    ring = closeLine(ringPoints);
  }
  return ring.length >= 4 ? ring : null;
}

function rotateOpenLine(points, startIndex) {
  if (!Array.isArray(points) || points.length < 2) return points;
  const index = Math.max(0, Math.min(points.length - 1, startIndex));
  return [
    ...points.slice(index),
    ...points.slice(0, index)
  ];
}

function createOpenOuterTangentLineFeatures(circles, options, properties) {
  const parts = createOuterTangentParts(circles, options);
  if (!parts) return [];

  return [parts.startArc, parts.straightSideA, parts.straightSideB]
    .filter((coordinates) => coordinates.length >= 2)
    .map((coordinates) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates
      },
      properties: {
        ...properties,
        typhoonShape: options.lineShape
      }
    }));
}

function createOuterTangentParts(circles) {
  if (circles.length < 2) return null;

  const projectedCircles = createProjectedTangentCircles(circles);
  const tangentPairs = [];
  const firstCircle = circles[0];
  const lastCircle = circles.at(-1);

  for (let index = 0; index < projectedCircles.length - 1; index += 1) {
    let tangents = sortTangentsByCenterLineSide(
      calcCircleTangents(projectedCircles[index], projectedCircles[index + 1]),
      projectedCircles[index],
      projectedCircles[index + 1]
    );
    if (tangentPairs.length > 0) {
      tangents = alignTangentPairWithPrevious(tangentPairs.at(-1), tangents);
    }
    if (tangents.length < 2) return null;
    tangentPairs.push(tangents);
  }

  const sideA = buildOuterTangentSide(tangentPairs, circles, 0);
  const sideB = buildOuterTangentSide(tangentPairs, circles, 1);
  const straightSideA = buildOuterTangentStraightSide(tangentPairs, 0);
  const straightSideB = buildOuterTangentStraightSide(tangentPairs, 1);
  const startArc = chooseOuterCircleArc(firstCircle, sideB[0], sideA[0], circles[1].center);
  const endArc = chooseOuterCircleArc(lastCircle, sideA.at(-1), sideB.at(-1), circles.at(-2).center);
  return { sideA, sideB, straightSideA, straightSideB, startArc, endArc };
}

function sortTangentsByCenterLineSide(tangents, circleA, circleB) {
  if (tangents.length < 2) return tangents;
  const a = circleA.pixelCenter;
  const b = circleB.pixelCenter;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const centerMid = {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };

  return [...tangents].sort((left, right) =>
    tangentSideScore(right, centerMid, dx, dy) - tangentSideScore(left, centerMid, dx, dy)
  );
}

function tangentSideScore(tangent, centerMid, dx, dy) {
  const p1 = projectMercatorPixel(tangent[0]);
  const p2 = projectMercatorPixel(tangent[1]);
  const tangentMid = {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2
  };
  return dx * (tangentMid.y - centerMid.y) - dy * (tangentMid.x - centerMid.x);
}

function alignTangentPairWithPrevious(previousPair, currentPair) {
  if (previousPair.length < 2 || currentPair.length < 2) return currentPair;

  const keepOrderDistance =
    getMercatorPixelDistanceSq(previousPair[0][1], currentPair[0][0])
    + getMercatorPixelDistanceSq(previousPair[1][1], currentPair[1][0]);
  const swappedOrderDistance =
    getMercatorPixelDistanceSq(previousPair[0][1], currentPair[1][0])
    + getMercatorPixelDistanceSq(previousPair[1][1], currentPair[0][0]);

  return swappedOrderDistance < keepOrderDistance
    ? [currentPair[1], currentPair[0]]
    : currentPair;
}

function buildOuterTangentSide(tangentPairs, circles, tangentIndex) {
  const points = [tangentPairs[0][tangentIndex][0], tangentPairs[0][tangentIndex][1]];

  for (let index = 1; index < tangentPairs.length; index += 1) {
    const previousPoint = tangentPairs[index - 1][tangentIndex][1];
    const nextPoint = tangentPairs[index][tangentIndex][0];
    const oppositePoint = tangentPairs[index][tangentIndex === 0 ? 1 : 0][0];
    const arc = chooseOuterCircleArc(circles[index], previousPoint, nextPoint, oppositePoint);
    points.push(...arc.slice(1), tangentPairs[index][tangentIndex][1]);
  }

  return points;
}

function buildOuterTangentStraightSide(tangentPairs, tangentIndex) {
  return [
    tangentPairs[0][tangentIndex][0],
    ...tangentPairs.map((tangents) => tangents[tangentIndex][1])
  ];
}

function chooseOuterCircleArc(circle, from, to, oppositeCenter) {
  const clockwise = createCircleArc(circle, from, to, true);
  const counterClockwise = createCircleArc(circle, from, to, false);
  return getArcDistanceFromCenter(clockwise, oppositeCenter) > getArcDistanceFromCenter(counterClockwise, oppositeCenter)
    ? clockwise
    : counterClockwise;
}

function createCircleArc(circle, from, to, clockwise) {
  const steps = 32;
  const { pixelCenter, pixelRadius } = projectCircleForTangents(circle);
  const fromPoint = projectMercatorPixel(from);
  const toPoint = projectMercatorPixel(to);
  const start = Math.atan2(fromPoint.y - pixelCenter.y, fromPoint.x - pixelCenter.x);
  let end = Math.atan2(toPoint.y - pixelCenter.y, toPoint.x - pixelCenter.x);

  if (clockwise) {
    while (end > start) end -= Math.PI * 2;
  } else {
    while (end < start) end += Math.PI * 2;
  }

  const points = [];
  for (let index = 0; index <= steps; index += 1) {
    const ratio = index / steps;
    const angle = start + (end - start) * ratio;
    points.push(unprojectMercatorPixel({
      x: pixelCenter.x + pixelRadius * Math.cos(angle),
      y: pixelCenter.y + pixelRadius * Math.sin(angle)
    }));
  }
  return points;
}

function getArcDistanceFromCenter(points, centerLngLat) {
  const target = projectMercatorPixel(centerLngLat);
  const total = points.reduce((sum, point) => {
    const projected = projectMercatorPixel(point);
    const dx = projected.x - target.x;
    const dy = projected.y - target.y;
    return sum + Math.sqrt(dx * dx + dy * dy);
  }, 0);
  return total / Math.max(points.length, 1);
}

function createTyphoonRadiusFeatures(typhoon) {
  const radiusFeatures = [];
  const strongRadius = readRadiusKm(typhoon, ["strongWindRadius", "wind15mRadius", "galeRadius"]);
  const stormRadius = readRadiusKm(typhoon, ["stormRadius", "wind25mRadius", "violentWindRadius"]);
  const strongCenter = typhoon.strongWindCenter?.length === 2 ? typhoon.strongWindCenter : typhoon.center;

  const strongFeature = createTyphoonCircleFeature(strongCenter, strongRadius, {
    color: "#ffeb1a",
    typhoonShape: "windArea",
    fillOpacity: 0.24,
    lineWidth: 1.25,
    popup: buildTyphoonPopup(typhoon, "強風域")
  });
  const stormFeature = createTyphoonCircleFeature(typhoon.center, stormRadius, {
    color: "#ff2800",
    lineColor: "#ff2b12",
    typhoonShape: "windArea",
    fillOpacity: 0.3,
    lineWidth: 1.35,
    popup: buildTyphoonPopup(typhoon, "暴風域")
  });

  if (strongFeature) radiusFeatures.push(strongFeature);
  if (stormFeature) radiusFeatures.push(stormFeature);
  return radiusFeatures;
}

function createTyphoonForecastLabelFeature(circle, typhoon) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: circle.center
    },
    properties: {
      label: circle.label,
      typhoonShape: "forecastLabel",
      popup: buildTyphoonPopup(typhoon, `予報円 ${circle.label}`)
    }
  };
}

function createTyphoonCenterXFeatures(typhoon) {
  const [lng, lat] = typhoon.center;
  const size = 0.13;
  const popup = buildTyphoonPopup(typhoon, "中心位置");
  const properties = {
    color: "#f8fbff",
    typhoonShape: "centerX",
    popup
  };

  return [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[lng - size, lat - size], [lng + size, lat + size]]
      },
      properties
    },
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [[lng - size, lat + size], [lng + size, lat - size]]
      },
      properties: {
        ...properties,
        label: typhoon.name
      }
    }
  ];
}

function closeLine(points) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return points;
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

function hasCircleSet(value) {
  return Array.isArray(value) && value.some((item) =>
    item?.center && Number.isFinite(item.radius)
  );
}

function calcCircleTangents(circleA, circleB) {
  const a = circleA.pixelCenter ?? projectCircleForTangents(circleA).pixelCenter;
  const b = circleB.pixelCenter ?? projectCircleForTangents(circleB).pixelCenter;
  const radiusA = circleA.pixelRadius ?? projectCircleForTangents(circleA).pixelRadius;
  const radiusB = circleB.pixelRadius ?? projectCircleForTangents(circleB).pixelRadius;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distanceSq = dx * dx + dy * dy;
  const radiusDiff = radiusA - radiusB;
  const tangentSq = distanceSq - radiusDiff * radiusDiff;
  if (distanceSq <= 0 || tangentSq <= 0) return [];

  const distance = Math.sqrt(distanceSq);
  const tangent = Math.sqrt(tangentSq);

  return [-1, 1].map((side) => {
    const normal = {
      x: (dx * radiusDiff - side * dy * tangent) / distanceSq,
      y: (dy * radiusDiff + side * dx * tangent) / distanceSq
    };
    const p1 = {
      x: a.x + normal.x * radiusA,
      y: a.y + normal.y * radiusA
    };
    const p2 = {
      x: b.x + normal.x * radiusB,
      y: b.y + normal.y * radiusB
    };
    return [
      unprojectMercatorPixel(p1),
      unprojectMercatorPixel(p2)
    ];
  });
}

function createProjectedTangentCircles(circles) {
  return circles.map((circle) => ({
    ...circle,
    ...projectCircleForTangents(circle)
  }));
}

function projectCircleForTangents(circle) {
  const pixelCenter = projectMercatorPixel(circle.center);
  const edge = destinationPoint(circle.center, Number(circle.radius) || 0, 90);
  const pixelEdge = projectMercatorPixel(edge);
  const dx = pixelEdge.x - pixelCenter.x;
  const dy = pixelEdge.y - pixelCenter.y;
  return {
    pixelCenter,
    pixelRadius: Math.sqrt(dx * dx + dy * dy)
  };
}

function projectMercatorPixel([lng, lat]) {
  const worldSize = 512 * 2 ** 8;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin(clampedLat * Math.PI / 180);
  return {
    x: (lng + 180) / 360 * worldSize,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * worldSize
  };
}

function unprojectMercatorPixel(point) {
  const worldSize = 512 * 2 ** 8;
  const lng = point.x / worldSize * 360 - 180;
  const y = 0.5 - point.y / worldSize;
  const lat = 90 - 360 * Math.atan(Math.exp(-y * 2 * Math.PI)) / Math.PI;
  return [lng, lat];
}

function destinationPoint([lng, lat], distanceKm, bearingDeg) {
  const earthRadiusKm = 6371.0088;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = bearingDeg * Math.PI / 180;
  const lat1 = lat * Math.PI / 180;
  const lng1 = lng * Math.PI / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance)
    + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [
    ((lng2 * 180 / Math.PI + 540) % 360) - 180,
    lat2 * 180 / Math.PI
  ];
}

function getPointDistanceSq(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function getMercatorPixelDistanceSq(a, b) {
  const pointA = projectMercatorPixel(a);
  const pointB = projectMercatorPixel(b);
  const dx = pointA.x - pointB.x;
  const dy = pointA.y - pointB.y;
  return dx * dx + dy * dy;
}

function readRadiusKm(typhoon, keys) {
  for (const key of keys) {
    const value = Number(typhoon?.[key]);
    if (Number.isFinite(value)) return value > 1000 ? value / 1000 : value;
  }
  return null;
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

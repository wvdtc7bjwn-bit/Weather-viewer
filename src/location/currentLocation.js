import { JMA_ENDPOINTS } from "../config.js";
import { getPrefectureNameByCode } from "../jma/warnings.js";

let municipalityLookupPromise = null;

export async function resolveCurrentLocationInfo(coordinates, warningData = {}) {
  const [lng, lat] = coordinates ?? [];
  const municipality = await findMunicipalityForPoint(lng, lat);
  if (!municipality) {
    return {
      status: "found",
      coordinates,
      areaCode: "",
      areaName: "",
      prefecture: "",
      center: null,
      warnings: [],
      message: "現在地の市区町村を特定できませんでした。"
    };
  }

  const activeArea = (warningData.activeAreas ?? [])
    .find((area) => String(area.areaCode) === String(municipality.code));

  return {
    status: "found",
    coordinates,
    areaCode: municipality.code,
    areaName: municipality.name,
    prefecture: activeArea?.prefecture ?? getPrefectureNameByCode(municipality.code),
    center: municipality.center,
    warnings: activeArea?.warnings ?? [],
    updatedAt: activeArea?.updatedAt ?? warningData.updatedAt ?? warningData.latestTime ?? "",
    message: activeArea?.warnings?.length
      ? "現在地に発表中の警報・注意報があります。"
      : "現在地に発表中の警報・注意報はありません。"
  };
}

export async function findMunicipalityForPoint(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const municipalities = await loadMunicipalityLookup();
  return municipalities.find((item) =>
    isPointInBounds(lng, lat, item.bounds) &&
    isPointInGeometry([lng, lat], item.geometry)
  ) ?? null;
}

export async function searchMunicipalities(query, limit = 12) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];
  const municipalities = await loadMunicipalityLookup();
  return municipalities
    .filter((item) => {
      const haystack = normalizeSearchText(`${item.prefecture} ${item.name} ${item.code}`);
      return haystack.includes(normalizedQuery);
    })
    .slice(0, limit)
    .map((item) => ({
      areaCode: item.code,
      areaName: item.name,
      prefecture: item.prefecture,
      coordinates: item.center
    }));
}

export async function loadMunicipalityLookup() {
  if (!municipalityLookupPromise) {
    municipalityLookupPromise = fetch(JMA_ENDPOINTS.warningMunicipalities)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((geoJson) => (geoJson.features ?? []).map((feature) => {
        const code = String(feature?.properties?.code ?? "");
        const bounds = computeBounds(feature.geometry);
        return {
          code,
          name: feature?.properties?.name ?? feature?.properties?.regionName ?? "",
          prefecture: getPrefectureNameByCode(code),
          geometry: feature.geometry,
          bounds,
          center: computeRepresentativeCenter(feature.geometry, bounds)
        };
      }).filter((item) => item.code && item.geometry));
  }
  return municipalityLookupPromise;
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isPointInBounds(lng, lat, bounds) {
  return bounds &&
    lng >= bounds.minLng &&
    lng <= bounds.maxLng &&
    lat >= bounds.minLat &&
    lat <= bounds.maxLat;
}

function isPointInGeometry(point, geometry) {
  if (geometry?.type === "Polygon") return isPointInPolygon(point, geometry.coordinates);
  if (geometry?.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => isPointInPolygon(point, polygon));
  }
  return false;
}

function isPointInPolygon(point, rings = []) {
  if (!rings.length || !isPointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => isPointInRing(point, hole));
}

function isPointInRing([lng, lat], ring = []) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (isPointOnSegment(lng, lat, xi, yi, xj, yj)) return true;
    const intersects = ((yi > lat) !== (yj > lat)) &&
      (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointOnSegment(px, py, x1, y1, x2, y2) {
  const cross = (py - y1) * (x2 - x1) - (px - x1) * (y2 - y1);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (px - x1) * (px - x2) + (py - y1) * (py - y2);
  return dot <= 1e-10;
}

function computeBounds(geometry) {
  const bounds = {
    minLng: Infinity,
    maxLng: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity
  };

  walkCoordinates(geometry?.coordinates, (coord) => {
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    bounds.minLng = Math.min(bounds.minLng, lng);
    bounds.maxLng = Math.max(bounds.maxLng, lng);
    bounds.minLat = Math.min(bounds.minLat, lat);
    bounds.maxLat = Math.max(bounds.maxLat, lat);
  });

  return Number.isFinite(bounds.minLng) ? bounds : null;
}

function computeRepresentativeCenter(geometry, bounds) {
  const points = [];
  walkCoordinates(geometry?.coordinates, (coord) => {
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) points.push([lng, lat]);
  });

  if (points.length) {
    const sums = points.reduce((acc, [lng, lat]) => {
      acc.lng += lng;
      acc.lat += lat;
      return acc;
    }, { lng: 0, lat: 0 });
    return [sums.lng / points.length, sums.lat / points.length];
  }

  if (bounds) {
    return [
      (bounds.minLng + bounds.maxLng) / 2,
      (bounds.minLat + bounds.maxLat) / 2
    ];
  }
  return null;
}

function walkCoordinates(coords, visitor) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    visitor(coords);
    return;
  }
  coords.forEach((child) => walkCoordinates(child, visitor));
}

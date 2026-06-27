const MY_AREAS_STORAGE_KEY = "weather-viewer.myAreas.v1";
const MY_AREAS_LIMIT = 8;

export function loadMyAreas() {
  try {
    const raw = window.localStorage.getItem(MY_AREAS_STORAGE_KEY);
    const items = JSON.parse(raw || "[]");
    return Array.isArray(items)
      ? normalizeMyAreas(items)
      : [];
  } catch {
    return [];
  }
}

export function saveMyAreas(areas) {
  const normalized = normalizeMyAreas(areas).slice(0, MY_AREAS_LIMIT);
  window.localStorage.setItem(MY_AREAS_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function addMyArea(areas, area) {
  const nextArea = normalizeMyArea(area);
  if (!nextArea) return normalizeMyAreas(areas);
  const rest = normalizeMyAreas(areas).filter((item) => item.areaCode !== nextArea.areaCode);
  return saveMyAreas([nextArea, ...rest].slice(0, MY_AREAS_LIMIT));
}

export function removeMyArea(areas, areaCode) {
  return saveMyAreas(normalizeMyAreas(areas).filter((item) => item.areaCode !== String(areaCode)));
}

export function getMyAreaLimit() {
  return MY_AREAS_LIMIT;
}

function normalizeMyAreas(areas) {
  const seen = new Set();
  return (areas ?? [])
    .map(normalizeMyArea)
    .filter(Boolean)
    .filter((area) => {
      if (seen.has(area.areaCode)) return false;
      seen.add(area.areaCode);
      return true;
    });
}

function normalizeMyArea(area) {
  const areaCode = String(area?.areaCode ?? area?.code ?? "").trim();
  const areaName = String(area?.areaName ?? area?.name ?? "").trim();
  if (!areaCode || !areaName) return null;
  return {
    areaCode,
    areaName,
    prefecture: String(area?.prefecture ?? "").trim(),
    coordinates: normalizeCoordinates(area?.coordinates),
    addedAt: area?.addedAt ?? new Date().toISOString()
  };
}

function normalizeCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lng = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
}

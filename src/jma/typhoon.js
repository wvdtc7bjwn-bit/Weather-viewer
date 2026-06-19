import { JMA_ENDPOINTS } from "../config.js";
import { fetchJson, parseJmaTime } from "./jmaClient.js";

export const NO_TYPHOON_MESSAGE = "現在、台風情報は発表されていません";

export async function fetchTyphoonList() {
  let raw = null;
  let unavailable = false;

  try {
    raw = await fetchTyphoonDetailData();
  } catch (error) {
    console.warn("[Weather Viewer] typhoon data unavailable", error);
    unavailable = true;
  }

  return buildTyphoonResponse(raw, unavailable);
}

async function fetchTyphoonDetailData() {
  return fetchTyphoonJsonData();
}

async function fetchTyphoonJsonData() {
  const targets = normalizeTargetTyphoons(await fetchJson(JMA_ENDPOINTS.typhoon));
  if (targets.length === 0) return [];

  const baseUrl = JMA_ENDPOINTS.typhoon.replace(/targetTc\.json(?:\?.*)?$/, "");
  const typhoons = await Promise.all(targets.map(async (target, index) => {
    const typhoonId = pickTyphoonJsonId(target, index);
    const [forecast, specifications] = await Promise.all([
      fetchJson(`${baseUrl}${encodeURIComponent(typhoonId)}/forecast.json`),
      fetchJson(`${baseUrl}${encodeURIComponent(typhoonId)}/specifications.json`)
    ]);

    return {
      ...target,
      id: typhoonId,
      tropicalCyclone: target.tropicalCyclone ?? typhoonId,
      forecast: Array.isArray(forecast) ? forecast : [],
      specifications: Array.isArray(specifications) ? specifications : []
    };
  }));

  return typhoons;
}

function normalizeTargetTyphoons(targetData) {
  if (Array.isArray(targetData)) return targetData;
  return targetData?.targetTc ?? targetData?.typhoons ?? targetData?.items ?? targetData?.data ?? [];
}

function pickTyphoonJsonId(target, index) {
  if (typeof target === "string" || typeof target === "number") return String(target);
  const id = target?.tropicalCyclone ?? target?.id ?? target?.tcNumber ?? target?.typhoonNumber;
  if (!id) throw new Error(`Missing typhoon id at targetTc[${index}]`);
  return String(id);
}

function buildTyphoonResponse(raw, unavailable) {
  const typhoons = normalizeTyphoons(raw);
  const hasTyphoon = typhoons.length > 0;
  const details = hasTyphoon ? typhoons[0].details : buildEmptyDetails(NO_TYPHOON_MESSAGE);

  return {
    raw,
    typhoons,
    details,
    hasTyphoon,
    unavailable,
    summary: buildSummary(typhoons.length, unavailable),
    latestTime: hasTyphoon ? typhoons[0].updatedAt : "発表なし",
    updatedAt: unavailable ? "未取得" : (hasTyphoon ? typhoons[0].updatedAt : "発表なし")
  };
}

function buildSummary(count, unavailable) {
  if (unavailable) return "台風データを取得できません";
  return count > 0 ? `台風情報 ${count} 件` : NO_TYPHOON_MESSAGE;
}

function normalizeTyphoons(raw) {
  const items = Array.isArray(raw)
    ? raw
    : raw?.targetTc ?? raw?.typhoons ?? raw?.items ?? raw?.data ?? [];

  return items
    .map((item, index) => normalizeTyphoon(item, index))
    .filter(Boolean);
}

function normalizeTyphoon(item, index) {
  if (!item || typeof item !== "object") return null;
  if (Array.isArray(item.forecast) || Array.isArray(item.specifications)) {
    return normalizeJmaTyphoon(item, index);
  }

  const center = pickPoint(item, [
    "center", "current", "analysis", "position", "coordinate", "coordinates", "location"
  ]);
  const track = pickLine(item, ["track", "course", "pastCourse", "pastTrack", "route"]);
  const forecastTrack = pickLine(item, ["forecastTrack", "forecastCourse", "forecast", "forecasts"]);
  const forecastCircles = pickForecastCircles(item);
  const stormWarningArea = pickWarningArea(item);
  const stormWarningAreaShape = pickWarningAreaShape(item);
  const name = pickTyphoonName(item, index);
  const updatedAt = formatTime(pickValue(item, [
    "updatedAt", "reportDatetime", "reportDateTime", "targetTime", "validtime", "basetime", "time", "dateTime"
  ]));

  return {
    id: String(pickValue(item, ["tropicalCyclone", "typhoonNumber", "id", "code"]) ?? `typhoon-${index + 1}`),
    name,
    center,
    track,
    forecastTrack,
    forecastCircles,
    stormWarningArea,
    stormWarningAreaShape,
    strongWindRadius: pickRadius(item, ["strongWindRadius", "wind15mRadius", "galeRadius", "radius15m", "強風域"]),
    stormRadius: pickRadius(item, ["stormRadius", "wind25mRadius", "violentWindRadius", "radius25m", "暴風域"]),
    details: {
      name,
      size: formatClassification(pickValue(item, ["size", "scale", "typhoonSize", "stormSize", "classificationSize", "大きさ"])),
      strength: formatClassification(pickValue(item, ["strength", "intensity", "typhoonStrength", "stormIntensity", "classificationIntensity", "強さ"])),
      pressure: formatWithUnit(pickValue(item, ["pressure", "centralPressure", "centerPressure", "pres", "中心気圧"]), "hPa"),
      maxWind: formatWithUnit(pickValue(item, ["maxWind", "maximumWind", "maxWindSpeed", "wind", "windSpeed", "最大風速"]), "m/s"),
      maxGust: formatWithUnit(pickValue(item, ["maxGust", "maximumGust", "maxInstantWind", "gust", "最大瞬間風速"]), "m/s"),
      direction: formatPlain(pickValue(item, ["direction", "moveDirection", "movingDirection", "dir", "移動方向"])),
      speed: formatWithUnit(pickValue(item, ["speed", "moveSpeed", "movingSpeed", "velocity", "移動速度"]), "km/h"),
      position: formatPosition(center, pickValue(item, ["centerPosition", "positionText", "locationName", "中心位置"]))
    },
    updatedAt
  };
}

function normalizeJmaTyphoon(item, index) {
  const forecast = Array.isArray(item.forecast) ? item.forecast : [];
  const specifications = Array.isArray(item.specifications) ? item.specifications : [];
  const title = forecast.find((entry) => entry?.part === "title")
    ?? specifications.find((entry) => entry?.part === "title")
    ?? item;
  const points = forecast.filter((entry) => entry?.advancedHours !== undefined && entry?.center);
  const current = points.find((entry) => Number(entry.advancedHours) === 0) ?? points[0] ?? item;
  const specNow = specifications.find((entry) => Number(entry?.advancedHours) === 0) ?? {};
  const center = normalizePoint(current.center) ?? pickPoint(item, ["center", "current", "position"]);
  if (!center) return null;

  const name = pickJmaTyphoonName(title, item, index);
  const forecastTrack = points.map((entry) => normalizePoint(entry.center)).filter(Boolean);
  const pastTrack = [
    ...(current.track?.preTyphoon ?? []),
    ...(current.track?.typhoon ?? [])
  ].map((entry) => parseJMACoord(entry)).filter(Boolean);
  console.log(`[Typhoon] pastTrack points=${pastTrack.length}`);
  const track = pastTrack.length > 0
    ? pastTrack
    : [
      ...(item.track?.preTyphoon ?? []),
      ...(item.track?.typhoon ?? [])
    ].map((entry) => parseJMACoord(entry)).filter(Boolean);
  const forecastCircles = points
    .filter((entry) => Number(entry.advancedHours) !== 0)
    .map((entry) => {
      const circleCenter = normalizePoint(entry.center);
      const radius = normalizeRadius(entry.probabilityCircle?.radius);
      const label = formatForecastTimeLabel(entry.validtime?.JST ?? entry.validtime?.UTC);
      if (!circleCenter || !Number.isFinite(radius)) return null;
      return { center: circleCenter, radius, label };
    })
    .filter(Boolean);
  const stormWarningSource = [...points].reverse().find((entry) => entry?.stormWarningArea?.arc?.length)
    ?? current
    ?? item;
  const stormWarningAreaShape = pickWarningAreaShape(stormWarningSource);
  const stormWarningArea = pickWarningArea(stormWarningSource);
  const galeCenter = normalizePoint(current.galeWarningArea?.center) ?? center;
  const strongWindRadius = normalizeRadius(current.galeWarningArea?.radius);
  const stormRadius = normalizeRadius(current.stormWarningArea?.arc?.[0]?.[1]);

  return {
    id: String(item.tropicalCyclone ?? item.id ?? title.typhoonNumber ?? `typhoon-${index + 1}`),
    name,
    center,
    track,
    pastTrack,
    forecastTrack,
    forecastCircles,
    stormWarningArea,
    stormWarningAreaShape,
    strongWindRadius,
    strongWindCenter: galeCenter,
    stormRadius,
    details: {
      name,
      size: formatClassification(specNow.scale ?? current.scale ?? null),
      strength: formatClassification(specNow.intensity ?? current.intensity ?? null),
      pressure: formatWithUnit(specNow.pressure ?? current.pressure ?? null, "hPa"),
      maxWind: formatWithUnit(specNow.maximumWind?.sustained?.["m/s"] ?? specNow.maximumWind?.sustained?.mps ?? null, "m/s"),
      maxGust: formatWithUnit(specNow.maximumWind?.gust?.["m/s"] ?? specNow.maximumWind?.gust?.mps ?? null, "m/s"),
      direction: formatPlain(specNow.course ?? current.course ?? null),
      speed: formatWithUnit(specNow.speed?.["km/h"] ?? current.speed?.["km/h"] ?? null, "km/h"),
      position: formatPosition(center, current.locationName ?? null)
    },
    updatedAt: formatTime(current.validtime?.JST ?? current.validtime?.UTC ?? title.validtime?.JST ?? title.validtime?.UTC ?? item.reportDatetime)
  };
}

function parseJMACoord(coord) {
  return normalizePoint(coord);
}

function pickJmaTyphoonName(title, item, index) {
  const rawNumber = String(title.typhoonNumber ?? item.typhoonNumber ?? "");
  const normalizedNumber = rawNumber.slice(-2).replace(/^0/, "");
  if (isTropicalDepression(item) || isTropicalDepression(title) || isNonNumericTyphoonNumber(rawNumber)) {
    return formatTropicalDepressionName(rawNumber);
  }
  const name = title.name?.jp ?? title.name?.en ?? item.name?.jp ?? item.name?.en ?? "";
  if (Number(normalizedNumber)) return `台風第${Number(normalizedNumber)}号${name ? ` (${name})` : ""}`;
  if (name) return name;
  return pickTyphoonName(item, index);
}

function buildEmptyDetails(value) {
  return {
    name: value,
    size: value,
    strength: value,
    pressure: value,
    maxWind: value,
    maxGust: value,
    direction: value,
    speed: value,
    position: value
  };
}

function pickTyphoonName(item, index) {
  const name = pickValue(item, ["name", "typhoonName", "stormName", "japaneseName", "displayName", "台風名", "名称"]);
  if (name) return String(name);

  const number = pickValue(item, ["typhoonNumber", "number", "tcNumber"]);
  if (isTropicalDepression(item) || isNonNumericTyphoonNumber(number)) return formatTropicalDepressionName(number);
  if (number) return `台風第${String(number).padStart(2, "0")}号`;

  const id = pickValue(item, ["tropicalCyclone", "id", "code"]);
  return id ? `台風 ${id}` : `台風 ${index + 1}`;
}

function isTropicalDepression(item) {
  const category = String(item?.category ?? item?.class ?? item?.type ?? "").toUpperCase();
  return category === "TD" || category.includes("TROPICAL DEPRESSION") || category.includes("熱帯低気圧");
}

function isNonNumericTyphoonNumber(value) {
  if (value === null || value === undefined || value === "") return false;
  return !/^\d+$/.test(String(value));
}

function formatTropicalDepressionName(number) {
  const suffix = number === null || number === undefined ? "" : String(number).trim();
  return suffix ? `熱帯低気圧${suffix}` : "熱帯低気圧";
}

function formatClassification(value) {
  if (value === null || value === undefined || value === "") return "未取得";
  if (typeof value === "object") {
    return formatClassification(value.jp ?? value.ja ?? value.label ?? value.name ?? value.en ?? null);
  }
  const text = String(value).trim();
  if (!text || text === "-") return "-";
  return text;
}

function pickPoint(item, keys) {
  for (const key of keys) {
    const point = normalizePoint(item[key]);
    if (point) return point;
  }
  return normalizePoint(item);
}

function normalizePoint(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    return toLngLat(Number(value[0]), Number(value[1]));
  }
  if (typeof value === "string") {
    const match = value.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
    if (!match) return null;
    const lat = Number.parseFloat(match[1]);
    const lng = Number.parseFloat(match[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
  }
  if (typeof value !== "object") return null;

  const lat = pickValue(value, ["lat", "latitude", "centerLat", "centerLatitude", "y", "緯度"]);
  const lng = pickValue(value, ["lon", "lng", "longitude", "centerLon", "centerLng", "centerLongitude", "x", "経度"]);
  if (lat !== null && lng !== null) {
    const numericLat = Number(lat);
    const numericLng = Number(lng);
    if (Number.isFinite(numericLat) && Number.isFinite(numericLng)) return [numericLng, numericLat];
  }

  if (Array.isArray(value.coordinates)) return normalizePoint(value.coordinates);
  if (Array.isArray(value.coordinate)) return normalizePoint(value.coordinate);
  return null;
}

function toLngLat(first, second) {
  if (Math.abs(first) <= 90 && Math.abs(second) > 90) return [second, first];
  return [first, second];
}

function pickLine(item, keys) {
  for (const key of keys) {
    const line = normalizeLine(item[key]);
    if (line.length >= 2) return line;
  }
  return [];
}

function pickForecastCircles(item) {
  const candidates = item?.forecastCircles ?? item?.forecastCircle ?? item?.forecastAreas ?? item?.forecast;
  if (!Array.isArray(candidates)) return [];

  return candidates
    .map((entry) => {
      const center = pickPoint(entry, ["center", "position", "coordinate", "coordinates"]);
      const radius = normalizeRadius(pickValue(entry, ["radius", "radiusKm", "forecastRadius", "予報円"]));
      const label = pickValue(entry, ["label", "time", "validTime", "validtime", "datetime"]);
      if (!center || !Number.isFinite(radius)) return null;
      return { center, radius, label: label ? String(label) : "" };
    })
    .filter(Boolean);
}

function pickWarningArea(item) {
  const raw = item?.stormWarningArea ?? item?.warningArea ?? item?.stormArea ?? item?.暴風警戒域;
  if (!Array.isArray(raw)) return [];

  const circles = raw
    .map((entry) => {
      if (Array.isArray(entry)) return null;
      const center = pickPoint(entry, ["center", "position", "coordinate", "coordinates"]);
      const radius = normalizeRadius(pickValue(entry, ["radius", "radiusKm", "stormRadius", "暴風域"]));
      const label = pickValue(entry, ["label", "time", "validTime", "validtime", "datetime"]);
      if (!center || !Number.isFinite(radius)) return null;
      return { center, radius, label: label ? String(label) : "" };
    })
    .filter(Boolean);

  if (circles.length > 0) return circles;
  return pickLine(item, ["stormWarningArea", "warningArea", "stormArea", "暴風警戒域"]);
}

function pickWarningAreaShape(item) {
  const raw = item?.stormWarningArea ?? item?.warningArea ?? item?.stormArea ?? item?.暴風警戒域;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const arc = (raw.arc ?? [])
    .map((entry) => {
      const center = normalizePoint(entry?.[0] ?? entry?.center);
      const radius = normalizeRadius(entry?.[1] ?? entry?.radius);
      const angles = entry?.[2] ?? entry?.angles;
      if (!center || !Number.isFinite(radius) || !Array.isArray(angles)) return null;
      const start = Number(angles[0]);
      const end = Number(angles[1]);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return { center, radius, start, end };
    })
    .filter(Boolean);

  const line = (raw.line ?? [])
    .map((entry) => {
      const points = Array.isArray(entry?.[0]) && Array.isArray(entry?.[1])
        ? [normalizePoint(entry[0]), normalizePoint(entry[1])]
        : normalizeLine(entry);
      return points.filter(Boolean);
    })
    .filter((points) => points.length >= 2);

  return arc.length || line.length ? { arc, line } : null;
}

function normalizeLine(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizePoint(entry))
      .filter(Boolean);
  }
  if (typeof value !== "object") return [];
  return normalizeLine(value.points ?? value.items ?? value.data ?? value.coordinates ?? value.coordinate);
}

function pickValue(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function pickRadius(item, keys) {
  for (const key of keys) {
    const value = pickValue(item, [key]);
    const radius = normalizeRadius(value);
    if (Number.isFinite(radius)) return radius;
  }
  return null;
}

function normalizeRadius(value) {
  if (value === null) return null;
  if (typeof value === "number") return value > 1000 ? value / 1000 : value;
  if (typeof value === "string") {
    const number = Number(value.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(number)) return null;
    return number > 1000 ? number / 1000 : number;
  }
  if (Array.isArray(value)) {
    const radii = value.map(normalizeRadius).filter(Number.isFinite);
    return radii.length > 0 ? Math.max(...radii) : null;
  }
  if (typeof value === "object") {
    const radius = pickValue(value, ["radius", "base", "value", "km", "distance", "最大"]);
    return normalizeRadius(radius);
  }
  return null;
}

function formatTime(value) {
  return parseJmaTime(value) ?? "取得済み";
}

function formatForecastTimeLabel(value) {
  if (!value) return "予報";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo"
  }).format(date).replace(" ", "");
}

function formatWithUnit(value, unit) {
  if (value === null) return "未取得";
  const text = String(value);
  return text.includes(unit) ? text : `${text} ${unit}`;
}

function formatPlain(value) {
  return value === null ? "未取得" : String(value);
}

function formatPosition(center, fallback) {
  if (fallback !== null && fallback !== undefined && fallback !== "") return String(fallback);
  if (center) return `北緯 ${center[1].toFixed(1)}° / 東経 ${center[0].toFixed(1)}°`;
  return "未取得";
}

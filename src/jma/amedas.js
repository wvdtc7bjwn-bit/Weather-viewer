import { JMA_ENDPOINTS, STATIC_DATA_CACHE_TTL_MS } from "../config.js";
import { fetchJson, fetchText, parseJmaTime } from "./jmaClient.js";

export async function fetchAmedasLatestTime() {
  const latestTimeText = await fetchText(JMA_ENDPOINTS.amedasTimeList);
  const latestTime = latestTimeText.trim();
  const mapTime = formatAmedasMapTime(latestTime);
  const [observations, stations] = await Promise.all([
    fetchJson(`${JMA_ENDPOINTS.amedasMapBase}/${mapTime}.json`),
    fetchJson(JMA_ENDPOINTS.amedasStationTable, { ttlMs: STATIC_DATA_CACHE_TTL_MS, cache: "force-cache" })
  ]);

  return {
    latestRawTime: latestTime,
    latestTime: parseJmaTime(latestTime) ?? latestTime,
    mapTime,
    points: buildAmedasPoints(observations, stations)
  };
}

function buildAmedasPoints(observations, stations) {
  return Object.entries(observations ?? {}).flatMap(([stationId, observation]) => {
    const station = stations?.[stationId];
    const coordinates = getStationCoordinates(station);
    if (!coordinates) return [];

    return [{
      id: stationId,
      name: station.kjName ?? station.enName ?? stationId,
      coordinates,
      values: {
        temperature: readObservedValue(observation.temp),
        precipitation: readObservedValue(observation.precipitation1h),
        wind: readObservedValue(observation.wind),
        snow: readObservedValue(observation.snow) ?? readObservedValue(observation.snow1h)
      },
      windDirection: readObservedValue(observation.windDirection)
    }];
  });
}

function readObservedValue(value) {
  if (!Array.isArray(value)) return null;
  const quality = value.length > 1 ? Number(value[1]) : 0;
  if (!Number.isFinite(quality) || quality !== 0) return null;
  const observed = Number(value[0]);
  return Number.isFinite(observed) ? observed : null;
}

function getStationCoordinates(station) {
  if (!station?.lat || !station?.lon) return null;
  const lat = convertDegreeMinute(station.lat);
  const lon = convertDegreeMinute(station.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lon, lat];
}

function convertDegreeMinute(value) {
  if (!Array.isArray(value) || value.length < 2) return NaN;
  return Number(value[0]) + Number(value[1]) / 60;
}

function formatAmedasMapTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace(/\D/g, "").slice(0, 12).padEnd(14, "0");
  const parts = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo"
  }).formatToParts(date);
  const getPart = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${getPart("year")}${getPart("month")}${getPart("day")}${getPart("hour")}${getPart("minute")}00`;
}

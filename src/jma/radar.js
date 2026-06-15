import { JMA_ENDPOINTS } from "../config.js";
import { fetchJson, parseJmaTime } from "./jmaClient.js";

export async function fetchRadarTimes() {
  const times = await fetchJson(JMA_ENDPOINTS.radarTimeList);
  const latest = Array.isArray(times) ? times.at(-1) : null;
  const rawTime = latest?.basetime ?? latest?.validtime ?? latest?.time ?? null;

  return {
    raw: times,
    latestTime: parseJmaTime(rawTime) ?? "取得済み",
    latestRawTime: rawTime
  };
}

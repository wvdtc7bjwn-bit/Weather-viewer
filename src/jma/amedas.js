import { JMA_ENDPOINTS } from "../config.js";
import { fetchText, parseJmaTime } from "./jmaClient.js";

export async function fetchAmedasLatestTime() {
  const latestTimeText = await fetchText(JMA_ENDPOINTS.amedasTimeList);
  const latestTime = latestTimeText.trim();

  return {
    latestRawTime: latestTime,
    latestTime: parseJmaTime(latestTime) ?? latestTime
  };
}

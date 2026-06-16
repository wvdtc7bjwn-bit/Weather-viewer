import { JMA_ENDPOINTS, KIKIKURU_ELEMENTS } from "../config.js";
import { fetchJson } from "./jmaClient.js";

export async function fetchKikikuruTiles() {
  const times = await fetchJson(JMA_ENDPOINTS.kikikuruTimeList);
  const targetsByElement = Object.fromEntries(
    KIKIKURU_ELEMENTS
      .map((element) => [element.id, pickLatestTargetTime(times, element.id)])
      .filter(([, target]) => Boolean(target))
  );
  const latestTarget = pickLatestTargetTime(Object.values(targetsByElement));
  if (!latestTarget || Object.keys(targetsByElement).length === 0) {
    return {
      raw: times,
      latestTime: "未取得",
      tileUrls: {}
    };
  }

  return {
    raw: times,
    basetime: latestTarget.basetime,
    validtime: latestTarget.validtime ?? latestTarget.basetime,
    member: latestTarget.member ?? "immed0",
    latestTime: formatJmaTime(latestTarget.validtime ?? latestTarget.basetime),
    tileUrls: Object.fromEntries(
      KIKIKURU_ELEMENTS
        .filter((element) => targetsByElement[element.id])
        .map((element) => [
          element.id,
          buildTileUrl(element.id, targetsByElement[element.id])
        ])
    )
  };
}

function pickLatestTargetTime(times, elementId = null) {
  if (!Array.isArray(times)) return null;
  return [...times]
    .filter((item) =>
      item?.basetime &&
      (item.validtime || item.basetime) &&
      (!elementId || supportsElement(item, elementId))
    )
    .sort((a, b) => String(a.validtime ?? a.basetime).localeCompare(String(b.validtime ?? b.basetime)))
    .at(-1) ?? null;
}

function buildTileUrl(elementId, target) {
  const basetime = target.basetime;
  const validtime = target.validtime ?? target.basetime;
  const member = target.member ?? "immed0";
  return `${JMA_ENDPOINTS.kikikuruTileBase}/${basetime}/${member}/${validtime}/surf/${elementId}/{z}/{x}/{y}.png`;
}

function supportsElement(target, elementId) {
  return !Array.isArray(target?.elements) || target.elements.includes(elementId);
}

function formatJmaTime(value) {
  if (!value) return "未取得";
  const date = new Date(jmaTimeToMs(value) + 9 * 60 * 60 * 1000);
  const pad = (item) => String(item).padStart(2, "0");
  return `${date.getUTCFullYear()}/${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function jmaTimeToMs(value) {
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14))
  );
}

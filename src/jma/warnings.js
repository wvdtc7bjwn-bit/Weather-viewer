import { JMA_ENDPOINTS, JMA_WARNING_OFFICE_CODES } from "../config.js";
import { fetchJson, parseJmaTime } from "./jmaClient.js";

const PREFECTURE_NAMES = {
  "01": "北海道", "02": "青森県", "03": "岩手県", "04": "宮城県", "05": "秋田県", "06": "山形県",
  "07": "福島県", "08": "茨城県", "09": "栃木県", "10": "群馬県", "11": "埼玉県", "12": "千葉県",
  "13": "東京都", "14": "神奈川県", "15": "新潟県", "16": "富山県", "17": "石川県", "18": "福井県",
  "19": "山梨県", "20": "長野県", "21": "岐阜県", "22": "静岡県", "23": "愛知県", "24": "三重県",
  "25": "滋賀県", "26": "京都府", "27": "大阪府", "28": "兵庫県", "29": "奈良県", "30": "和歌山県",
  "31": "鳥取県", "32": "島根県", "33": "岡山県", "34": "広島県", "35": "山口県", "36": "徳島県",
  "37": "香川県", "38": "愛媛県", "39": "高知県", "40": "福岡県", "41": "佐賀県", "42": "長崎県",
  "43": "熊本県", "44": "大分県", "45": "宮崎県", "46": "鹿児島県", "47": "沖縄県"
};

const WARNING_LABELS = {
  "02": ["暴風雪警報", "warning"],
  "03": ["大雨警報", "warning"],
  "04": ["洪水警報", "warning"],
  "05": ["暴風警報", "warning"],
  "06": ["大雪警報", "warning"],
  "07": ["波浪警報", "warning"],
  "08": ["高潮警報", "warning"],
  "09": ["土砂災害警報", "warning"],
  "10": ["大雨注意報", "advisory"],
  "12": ["大雪注意報", "advisory"],
  "13": ["風雪注意報", "advisory"],
  "14": ["雷注意報", "advisory"],
  "15": ["強風注意報", "advisory"],
  "16": ["波浪注意報", "advisory"],
  "17": ["融雪注意報", "advisory"],
  "18": ["洪水注意報", "advisory"],
  "19": ["高潮注意報", "advisory"],
  "20": ["濃霧注意報", "advisory"],
  "21": ["乾燥注意報", "advisory"],
  "22": ["なだれ注意報", "advisory"],
  "23": ["低温注意報", "advisory"],
  "24": ["霜注意報", "advisory"],
  "25": ["着氷注意報", "advisory"],
  "26": ["着雪注意報", "advisory"],
  "29": ["土砂災害注意報", "advisory"],
  "42": ["暴風雪危険警報", "danger"],
  "43": ["大雨危険警報", "danger"],
  "44": ["洪水危険警報", "danger"],
  "45": ["暴風危険警報", "danger"],
  "46": ["大雪危険警報", "danger"],
  "47": ["波浪危険警報", "danger"],
  "48": ["高潮危険警報", "danger"],
  "52": ["暴風雪危険警報", "danger"],
  "53": ["大雨危険警報", "danger"],
  "54": ["洪水危険警報", "danger"],
  "55": ["暴風危険警報", "danger"],
  "56": ["大雪危険警報", "danger"],
  "57": ["波浪危険警報", "danger"],
  "58": ["高潮危険警報", "danger"],
  "32": ["暴風雪特別警報", "emergency"],
  "33": ["大雨特別警報", "emergency"],
  "35": ["暴風特別警報", "emergency"],
  "36": ["大雪特別警報", "emergency"],
  "37": ["波浪特別警報", "emergency"],
  "38": ["高潮特別警報", "emergency"],
  "39": ["土砂災害特別警報", "emergency"],
  "49": ["土砂災害危険警報", "danger"]
};

export async function fetchWarningMap() {
  const [warningReports, areaConst, municipalityGeoJson] = await Promise.all([
    fetchWarningReports(),
    fetchJson(JMA_ENDPOINTS.areaConst),
    fetchJson(JMA_ENDPOINTS.warningMunicipalities)
  ]);
  const municipalityIndex = buildMunicipalityIndex(municipalityGeoJson);
  const areaMap = buildWarningAreaMap(warningReports, areaConst, municipalityIndex);
  const activeAreas = [...areaMap.values()];
  const groups = buildWarningGroups(activeAreas);
  const latestReportTime = getLatestReportTime(warningReports);

  return {
    raw: warningReports,
    groups,
    activeAreas,
    summary: `発表中 ${activeAreas.length} 市区町村`,
    latestTime: parseJmaTime(latestReportTime) ?? latestReportTime,
    updatedAt: parseJmaTime(latestReportTime) ?? "取得済み"
  };
}

async function fetchWarningReports() {
  const settledReports = await Promise.allSettled(
    JMA_WARNING_OFFICE_CODES.map((code) =>
      fetchJson(`${JMA_ENDPOINTS.warningsBase}/${code}.json`)
    )
  );

  return settledReports
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => Array.isArray(result.value) ? result.value : [result.value])
    .filter((report) => report?.areaTypes || report?.warning?.class20Items);
}

function buildWarningAreaMap(warningReports, areaConst, municipalityIndex) {
  const reports = Array.isArray(warningReports)
    ? [...warningReports].sort((a, b) => new Date(a.reportDatetime).getTime() - new Date(b.reportDatetime).getTime())
    : [];
  const municipalities = areaConst?.class20s ?? {};
  const areasByCode = new Map();

  reports.forEach((report) => {
    const areas = getMunicipalityAreas(report);
    areas.forEach((area) => {
      const areaCode = String(area.code ?? area.areaCode ?? "");
      if (!areaCode) return;
      expandToMunicipalityCodes(areaCode, municipalityIndex).forEach((resolvedArea) => {
        const resolvedCode = resolvedArea.code;
        const current = areasByCode.get(resolvedCode) ?? {
          areaCode: resolvedCode,
          areaName: municipalities[resolvedCode]?.name ?? resolvedArea.name ?? `エリア ${resolvedCode}`,
          prefectureCode: resolvedCode.slice(0, 2),
          prefecture: PREFECTURE_NAMES[resolvedCode.slice(0, 2)] ?? "その他",
          updatedAt: report.reportDatetime,
          warnings: []
        };

        current.warnings = applyWarningKinds(current.warnings, area.warnings ?? area.kinds);
        current.updatedAt = chooseLatestTime(current.updatedAt, report.reportDatetime);
        current.level = highestSeverityLevel(current.warnings);
        if (current.warnings.length > 0) {
          areasByCode.set(resolvedCode, current);
        } else {
          areasByCode.delete(resolvedCode);
        }
      });
    });
  });

  return areasByCode;
}

function buildMunicipalityIndex(geoJson) {
  const features = Array.isArray(geoJson?.features) ? geoJson.features : [];
  const byCode = new Map();
  const byParentCode = new Map();

  features.forEach((feature) => {
    const code = String(feature?.properties?.code ?? "");
    if (!code) return;

    const area = {
      code,
      name: feature.properties?.name ?? feature.properties?.regionName ?? ""
    };
    byCode.set(code, area);

    const parentCode = `${code.slice(0, 5)}00`;
    if (parentCode !== code) {
      if (!byParentCode.has(parentCode)) byParentCode.set(parentCode, []);
      byParentCode.get(parentCode).push(area);
    }
  });

  return { byCode, byParentCode };
}

function expandToMunicipalityCodes(areaCode, municipalityIndex) {
  const direct = municipalityIndex.byCode.get(areaCode);
  if (direct) return [direct];
  return municipalityIndex.byParentCode.get(areaCode) ?? [{ code: areaCode, name: "" }];
}

function buildWarningGroups(activeAreas) {
  const grouped = new Map();

  activeAreas.forEach((area) => {
    if (!grouped.has(area.prefecture)) grouped.set(area.prefecture, []);
    grouped.get(area.prefecture).push(area);
  });

  return [...grouped.entries()]
    .map(([prefecture, areas]) => ({
      prefecture,
      level: highestSeverityLevel(areas.flatMap((area) => area.warnings)),
      count: areas.length,
      areas: areas
        .sort((a, b) =>
          severityRank(b.warnings) - severityRank(a.warnings) ||
          String(a.areaCode).localeCompare(String(b.areaCode), "ja")
        )
    }))
    .sort((a, b) =>
      severityValue(b.level) - severityValue(a.level) ||
      prefectureOrder(a.prefecture) - prefectureOrder(b.prefecture)
    );
}

function getMunicipalityAreas(report) {
  if (Array.isArray(report.warning?.class20Items)) {
    return report.warning.class20Items.map((item) => ({
      code: item.areaCode,
      warnings: item.kinds ?? []
    }));
  }

  return report.areaTypes?.[1]?.areas ?? [];
}

function applyWarningKinds(currentWarnings, kinds = []) {
  const warningsByCode = new Map(currentWarnings.map((warning) => [warning.code, warning]));

  kinds.forEach((kind) => {
    const code = String(kind?.code ?? "");
    const status = String(kind?.status ?? "");

    if (!code) return;

    if (isInactiveWarning(kind)) {
      warningsByCode.delete(code);
      return;
    }

    const [label, level] = WARNING_LABELS[code] ?? [`警報コード ${code}`, "advisory"];
    warningsByCode.set(code, { code, label, level, status });
  });

  return sortWarnings([...warningsByCode.values()]);
}

function sortWarnings(warnings) {
  return warnings.sort((a, b) =>
    severityValue(b.level) - severityValue(a.level) ||
    Number(a.code) - Number(b.code)
  );
}

function isInactiveWarning(warning) {
  const status = String(warning?.status ?? "");
  return !warning?.code || status.includes("解除") || status.includes("なし");
}

function severityRank(warnings) {
  const ranks = { advisory: 1, warning: 2, danger: 3, emergency: 4 };
  return Math.max(0, ...warnings.map((warning) => ranks[warning.level] ?? 0));
}

function highestSeverityLevel(warnings) {
  return warnings.reduce((current, warning) =>
    severityValue(warning.level) > severityValue(current) ? warning.level : current
  , "advisory");
}

function severityValue(level) {
  const ranks = { advisory: 1, warning: 2, danger: 3, emergency: 4 };
  return ranks[level] ?? 0;
}

function getLatestReportTime(warningReports) {
  const reports = Array.isArray(warningReports) ? warningReports : [];
  return reports.reduce((latest, report) => chooseLatestTime(latest, report.reportDatetime), "");
}

function chooseLatestTime(current, next) {
  if (!current) return next ?? "";
  if (!next) return current;
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
}

function prefectureOrder(prefecture) {
  const entry = Object.entries(PREFECTURE_NAMES).find(([, name]) => name === prefecture);
  return entry ? Number(entry[0]) : 99;
}

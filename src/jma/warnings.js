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

const WARNING_LEVEL_NUMBERS = {
  advisory: 2,
  warning: 3,
  danger: 4,
  emergency: 5
};

const WARNING_LEVEL_TARGETS = ["河川氾濫", "洪水", "大雨", "土砂災害", "高潮"];

export function getPrefectureNameByCode(areaCode) {
  return PREFECTURE_NAMES[String(areaCode ?? "").slice(0, 2)] ?? "その他";
}

export async function fetchWarningMap() {
  const [warningReports, warningTimelineReports, municipalityGeoJson] = await Promise.all([
    fetchWarningReports(),
    fetchWarningTimelineReports(),
    fetchJson(JMA_ENDPOINTS.warningMunicipalities)
  ]);
  const municipalityIndex = buildMunicipalityIndex(municipalityGeoJson);
  const outlookByAreaCode = buildWarningOutlookMap(warningTimelineReports, municipalityIndex);
  const areaMap = buildWarningAreaMap(warningReports, municipalityIndex, outlookByAreaCode);
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
  const reportsByOffice = await Promise.all(
    JMA_WARNING_OFFICE_CODES.map(async (officeCode) => {
      try {
        const reports = await fetchJson(`${JMA_ENDPOINTS.warningsBase}/${officeCode}.json`);
        return Array.isArray(reports) ? reports : [];
      } catch (error) {
        console.warn(`[Weather Viewer] warning JSON unavailable: ${officeCode}`, error);
        return [];
      }
    })
  );
  return reportsByOffice.flat();
}

async function fetchWarningTimelineReports() {
  const reportsByOffice = await Promise.all(
    JMA_WARNING_OFFICE_CODES.map(async (officeCode) => {
      try {
        return await fetchJson(`${JMA_ENDPOINTS.warningTimelineBase}/${officeCode}.json`);
      } catch (error) {
        console.warn(`[Weather Viewer] warning timeline JSON unavailable: ${officeCode}`, error);
        return null;
      }
    })
  );
  return reportsByOffice.filter(Boolean);
}

function buildWarningAreaMap(warningReports, municipalityIndex, outlookByAreaCode = new Map()) {
  const reports = Array.isArray(warningReports)
    ? [...warningReports].sort((a, b) => new Date(a.reportDatetime).getTime() - new Date(b.reportDatetime).getTime())
    : [];
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
          areaName: resolvedArea.name ?? area.name ?? `エリア ${resolvedCode}`,
          prefectureCode: resolvedCode.slice(0, 2),
          prefecture: getPrefectureNameByCode(resolvedCode),
          updatedAt: report.reportDatetime,
          warnings: [],
          outlook: outlookByAreaCode.get(resolvedCode) ?? []
        };

        current.warnings = applyWarningKinds(current.warnings, area.warnings ?? area.kinds, report.reportDatetime);
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

function buildWarningOutlookMap(timelineReports, municipalityIndex) {
  const outlookByAreaCode = new Map();

  (timelineReports ?? []).forEach((report) => {
    (report.timeSeries ?? []).forEach((series) => {
      const timeDefines = series.timeDefines ?? [];
      ["class20Items", "class10Items"].forEach((bucketName) => {
        (series[bucketName] ?? []).forEach((item) => {
          const rows = buildWarningOutlookRows(item.kinds ?? [], timeDefines);
          if (rows.length === 0) return;

          expandToMunicipalityCodes(String(item.areaCode ?? ""), municipalityIndex).forEach((resolvedArea) => {
            const areaCode = resolvedArea.code;
            const currentRows = outlookByAreaCode.get(areaCode) ?? [];
            outlookByAreaCode.set(areaCode, mergeOutlookRows(currentRows, rows));
          });
        });
      });
    });
  });

  return outlookByAreaCode;
}

function buildWarningOutlookRows(kinds = [], timeDefines = []) {
  const rows = [];

  kinds.forEach((kind) => {
    (kind.significancyParts ?? []).forEach((part) => {
      const partType = String(part?.type ?? "");
      if (!partType.includes("危険度")) return;
      rows.push(...buildOutlookPartRows(part, timeDefines, "code", shouldShowWarningLevel(partType)));
    });
  });

  return rows.filter((row) => row.slots.some((slot) => slot.level >= 2));
}

function buildOutlookPartRows(part, timeDefines, valueType, showLevelLabel = false) {
  if (!Array.isArray(part?.locals)) return [];

  return part.locals.flatMap((local) => {
    const values = valueType === "code" ? local.codes : local.values;
    if (!Array.isArray(values)) return [];
    const slots = timeDefines.map((timeDefine, index) => buildOutlookSlot(timeDefine, values[index], valueType, showLevelLabel));
    if (!slots.some((slot) => slot.level >= 2 || slot.label)) return [];

    return [{
      type: normalizeOutlookType(part.type),
      localName: local.areaName ?? "",
      slots
    }];
  });
}

function buildOutlookSlot(timeDefine, value, valueType, showLevelLabel = false) {
  if (valueType !== "code") {
    const text = value?.value ?? value ?? "";
    return {
      time: timeDefine?.dateTime ?? "",
      duration: timeDefine?.duration ?? "",
      label: text ? String(text) : "",
      level: 0
    };
  }

  const code = String(value ?? "");
  const level = warningOutlookLevel(code);
  return {
    time: timeDefine?.dateTime ?? "",
    duration: timeDefine?.duration ?? "",
    code,
    label: showLevelLabel ? warningOutlookLabel(code) : "",
    level
  };
}

function normalizeOutlookType(type) {
  return String(type ?? "").replace("危険度", "");
}

function warningOutlookLevel(code) {
  if (code === "51" || code === "50") return 5;
  if (code === "41") return 4;
  if (code === "31" || code === "30") return 3;
  if (code === "22" || code === "21" || code === "20") return 2;
  return 0;
}

function warningOutlookLabel(code) {
  const level = warningOutlookLevel(code);
  return level > 0 ? `レベル${level}` : "";
}

function mergeOutlookRows(currentRows, nextRows) {
  const rowsByKey = new Map(currentRows.map((row) => [outlookRowKey(row), row]));
  nextRows.forEach((row) => {
    if (!rowsByKey.has(outlookRowKey(row))) rowsByKey.set(outlookRowKey(row), row);
  });
  return [...rowsByKey.values()].slice(0, 10);
}

function outlookRowKey(row) {
  return `${row.type}|${row.localName}|${row.slots.map((slot) => `${slot.time}:${slot.code ?? slot.label}`).join(",")}`;
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
  if (Array.isArray(report.items)) {
    return report.items.map((item) => ({
      code: item.code,
      name: item.name,
      warnings: item.warnings ?? []
    }));
  }

  if (Array.isArray(report.warning?.class20Items)) {
    return report.warning.class20Items.map((item) => ({
      code: item.areaCode,
      warnings: item.kinds ?? []
    }));
  }

  return report.areaTypes?.[1]?.areas ?? [];
}

function applyWarningKinds(currentWarnings, kinds = [], reportDatetime = "") {
  const warningsByCode = new Map(currentWarnings.map((warning) => [warning.code, warning]));

  kinds.forEach((kind) => {
    const code = String(kind?.code ?? "");
    const status = String(kind?.status ?? "");

    if (!code) return;

    if (isInactiveWarning(kind)) {
      warningsByCode.delete(code);
      return;
    }

    const [rawLabel, level] = WARNING_LABELS[code] ?? [`警報コード ${code}`, "advisory"];
    const levelNumber = shouldShowWarningLevel(rawLabel) ? WARNING_LEVEL_NUMBERS[level] ?? null : null;
    const label = levelNumber ? `レベル${levelNumber} ${rawLabel}` : rawLabel;
    const previous = warningsByCode.get(code);
    warningsByCode.set(code, {
      code,
      rawLabel,
      label,
      level,
      levelNumber,
      status,
      issuedAt: previous?.issuedAt ?? reportDatetime,
      updatedAt: reportDatetime
    });
  });

  return sortWarnings([...warningsByCode.values()]);
}

function shouldShowWarningLevel(label) {
  return WARNING_LEVEL_TARGETS.some((target) => String(label).includes(target));
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

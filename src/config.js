export const APP_NAME = "Weather Viewer";
export const APP_BASE_URL = import.meta.env.BASE_URL;
export const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const AUTO_REFRESH_RESUME_THROTTLE_MS = 60 * 1000;

function publicAsset(path) {
  return `${APP_BASE_URL}${path.replace(/^\/+/, "")}`;
}

export const DEFAULT_VIEW = {
  center: [37.6, 137.8],
  zoom: 5,
  minZoom: 3,
  maxZoom: 10
};

export const JMA_ENDPOINTS = {
  // NOTE: These are intentionally centralized so Codex can replace or extend them
  // after confirming current JMA data URLs and CORS behavior.
  radarTimeList: "https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json",
  radarTileBase: "https://www.jma.go.jp/bosai/jmatile/data/nowc",
  amedasTimeList: "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt",
  warningsBase: "https://www.jma.go.jp/bosai/warning/data/r8",
  warningTimelineBase: "https://www.jma.go.jp/bosai/warning_timeline/data",
  probabilityMap: "https://www.jma.go.jp/bosai/probability/data/probability/r8/map.json",
  noWaveTide: "https://www.jma.go.jp/bosai/warning/const/no_wave_tide.json",
  kikikuruTimeList: "https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json",
  kikikuruTileBase: "https://www.jma.go.jp/bosai/jmatile/data/risk",
  areaConst: "https://www.jma.go.jp/bosai/common/const/area.json",
  warningMunicipalities: publicAsset("data/jma-weather-warning-municipalities.geojson"),
  amedasStationTable: "https://www.jma.go.jp/bosai/amedas/const/amedastable.json",
  amedasMapBase: "https://www.jma.go.jp/bosai/amedas/data/map",
  typhoon: "https://www.jma.go.jp/bosai/typhoon/data/targetTc.json"
};

export const JMA_WARNING_OFFICE_CODES = [
  "011000", "012000", "013000", "014100", "014030", "015000", "016000", "017000",
  "020000", "030000", "040000", "050000", "060000", "070000", "080000", "090000",
  "100000", "110000", "120000", "130000", "140000", "150000", "160000", "170000",
  "180000", "190000", "200000", "210000", "220000", "230000", "240000", "250000",
  "260000", "270000", "280000", "290000", "300000", "310000", "320000", "330000",
  "340000", "350000", "360000", "370000", "380000", "390000", "400000", "410000",
  "420000", "430000", "440000", "450000", "460040", "460100", "471000", "472000", "473000",
  "474000"
];

export const TABS = [
  {
    id: "radar",
    label: "雨雲レーダー",
    title: "",
    cardLabel: "降水強度",
    primary: "Radar",
    description: "気象庁の降水ナウキャストを地図上に重ねています。"
  },
  {
    id: "amedas",
    label: "アメダス",
    title: "",
    cardLabel: "気温",
    primary: "AMeDAS",
    description: "気温・降水量・風速・積雪量をアメダス観測地点マーカーで表示します。"
  },
  {
    id: "warnings",
    label: "警報・注意報",
    title: "",
    cardLabel: "警戒レベル",
    primary: "Warnings",
    description: "注意報・警報・危険警報・特別警報を市区町村ポリゴンに色分け表示します。"
  },
  {
    id: "typhoon",
    label: "台風情報",
    title: "台風情報",
    cardLabel: "台風",
    primary: "Typhoon",
    description: "台風の現在位置、進路、予報円、暴風警戒域を表示します。"
  }
];

export const AMEDAS_METRICS = [
  { id: "temperature", label: "気温", primary: "Temp", unit: "℃", color: "#48c46b" },
  { id: "precipitation", label: "降水量", primary: "Rain", unit: "mm", color: "#56b7f2" },
  { id: "wind", label: "風速", primary: "Wind", unit: "m/s", color: "#f4d35e" },
  { id: "snow", label: "積雪量", primary: "Snow", unit: "cm", color: "#d8e6f7" }
];

export const AMEDAS_PRECIPITATION_LEVELS = [
  { min: 80, label: "80以上（猛烈な雨）", color: "#d4148e" },
  { min: 50, label: "50〜80（非常に激しい）", color: "#ff2b12" },
  { min: 30, label: "30〜50（激しい雨）", color: "#ff9900" },
  { min: 20, label: "20〜30（強い雨）", color: "#fff000" },
  { min: 10, label: "10〜20（やや強い）", color: "#0b22ff" },
  { min: 1, label: "1〜10", color: "#17a9f5" },
  { min: 0.1, label: "0.1〜1", color: "#a8d8ff" }
];

export const AMEDAS_TEMPERATURE_LEVELS = [
  { min: 40, label: "40以上（酷暑日）", color: "#d4148e" },
  { min: 35, label: "35〜40（猛暑日）", color: "#ff2b12" },
  { min: 30, label: "30〜35（真夏日）", color: "#ff4a12" },
  { min: 25, label: "25〜30（夏日）", color: "#ff9900" },
  { min: 20, label: "20〜25", color: "#fff000" },
  { min: 15, label: "15〜20", color: "#a8ff00" },
  { min: 10, label: "10〜15", color: "#00e86b" },
  { min: 5, label: "5〜10", color: "#16e7dc" },
  { min: 0, label: "0〜5", color: "#17a9f5" },
  { min: -5, label: "-5〜0", color: "#0b22ff" },
  { min: -Infinity, label: "-5未満", color: "#2510b8" }
];

export const AMEDAS_WIND_LEVELS = [
  { min: 30, label: "30m/s以上（猛烈な風）", color: "#d4148e" },
  { min: 25, label: "25〜30", color: "#ff2b12" },
  { min: 20, label: "20〜25（非常に強い）", color: "#ff9900" },
  { min: 15, label: "15〜20（強い風）", color: "#fff000" },
  { min: 10, label: "10〜15（やや強い）", color: "#00ff00" },
  { min: 5, label: "5〜10", color: "#16e7dc" },
  { min: 0, label: "5m/s未満", color: "#17a9f5" }
];

export const AMEDAS_SNOW_LEVELS = [
  { min: 200, label: "200cm以上", color: "#c9287a" },
  { min: 150, label: "150〜200cm", color: "#c7582e" },
  { min: 100, label: "100〜150cm", color: "#c58c36" },
  { min: 50, label: "50〜100cm", color: "#c2c957" },
  { min: 20, label: "20〜50cm", color: "#1834d6" },
  { min: 5, label: "5〜20cm", color: "#426fc8" },
  { min: 1, label: "1〜5cm", color: "#b7d5ea" }
];

export const KIKIKURU_ELEMENTS = [
  { id: "land", label: "土砂キキクル", opacity: 0.86 },
  { id: "inund", label: "浸水キキクル", opacity: 0.78 }
];

export const KIKIKURU_LAYER_OPTIONS = [
  { id: "land", label: "土砂キキクル" },
  { id: "inund", label: "浸水キキクル" }
];

export const KIKIKURU_LEVELS = [
  { label: "災害切迫", color: "#111111" },
  { label: "危険", color: "#a000ff" },
  { label: "警戒", color: "#ff2b12" },
  { label: "注意", color: "#fff000" },
  { label: "今後の情報等に留意", color: "#ffffff" }
];

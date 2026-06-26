const DEFAULT_REQUEST_TTL_MS = 60 * 1000;
const requestCache = new Map();
const inFlightRequests = new Map();

export async function fetchJson(url, options = {}) {
  return fetchCached(url, {
    ...options,
    accept: "application/json,text/plain,*/*",
    parse: (response) => response.json()
  });
}

export async function fetchText(url, options = {}) {
  return fetchCached(url, {
    ...options,
    accept: "text/plain,*/*",
    parse: (response) => response.text()
  });
}

async function fetchCached(url, options) {
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_REQUEST_TTL_MS;
  const cacheKey = `${options.accept}:${url}`;
  const now = Date.now();
  const cached = requestCache.get(cacheKey);
  if (ttlMs > 0 && cached && cached.expiresAt > now) return cached.value;

  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = fetch(url, {
    cache: options.cache ?? "default",
    headers: {
      "Accept": options.accept
    }
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`JMA request failed: ${response.status} ${response.statusText}`);
      }
      return options.parse(response);
    })
    .then((value) => {
      if (ttlMs > 0) {
        requestCache.set(cacheKey, {
          value,
          expiresAt: Date.now() + ttlMs
        });
      }
      return value;
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, request);
  return request;
}

export function parseJmaTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tokyo"
  }).format(date);
}

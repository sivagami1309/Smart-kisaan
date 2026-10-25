// 5-day weather from Open-Meteo (free, no key), fetched by the server so the phone never calls it directly.
// Ported from the earlier project's WeatherController, plus a one-hour cache.

export class WeatherError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createWeather({ fetchFn = fetch, now = Date.now, ttlMs = 3600e3 } = {}) {
  const cache = new Map();

  async function get(lat, lon) {
    if (!(lat >= 6 && lat <= 37 && lon >= 68 && lon <= 98)) throw new WeatherError(400, 'location must be inside India');
    // About 1 km precision is enough for a forecast and keeps the exact farm location private
    const la = Math.round(lat * 100) / 100, lo = Math.round(lon * 100) / 100;
    const key = `${la},${lo}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.data;

    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude', String(la));
    u.searchParams.set('longitude', String(lo));
    u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,weather_code');
    u.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code');
    u.searchParams.set('timezone', 'Asia/Kolkata');
    u.searchParams.set('forecast_days', '5');

    let body;
    try {
      const res = await fetchFn(u.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      body = await res.json();
    } catch {
      throw new WeatherError(503, 'weather service is unavailable right now');
    }
    if (!body?.current || !body?.daily) throw new WeatherError(503, 'weather service returned no data');

    const data = { source: 'Open-Meteo (open-meteo.com)', fetchedAt: new Date(now()).toISOString(), latitude: la, longitude: lo, current: body.current, daily: body.daily };
    cache.set(key, { at: now(), data });
    return data;
  }

  return { get };
}

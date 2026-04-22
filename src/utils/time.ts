export interface LocalizeOptions {
  viewerTZ?: string;
}

export interface LocalizedTime {
  utc: string;
  local: string;
  viewer?: string;
  time_zone_iana: string;
  time_zone: string;
}

function formatInTZ(utcISO: string, timeZone: string): string {
  const d = new Date(utcISO);
  if (isNaN(d.getTime())) return utcISO;
  return d.toLocaleString("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  });
}

export function localizeTime(
  utcISO: string | null | undefined,
  eventTZ: string | null | undefined,
  eventTZLabel: string | null | undefined,
  options: LocalizeOptions = {}
): LocalizedTime | null {
  if (!utcISO) return null;

  const tz = eventTZ || "UTC";
  const label = eventTZLabel || tz;
  const result: LocalizedTime = {
    utc: utcISO,
    local: formatInTZ(utcISO, tz),
    time_zone_iana: tz,
    time_zone: label,
  };

  if (options.viewerTZ && options.viewerTZ !== tz) {
    result.viewer = formatInTZ(utcISO, options.viewerTZ);
  }

  return result;
}

export interface EventLike {
  start_date?: unknown;
  end_date?: unknown;
  arrival_date?: unknown;
  time_zone_iana_name?: unknown;
  time_zone?: unknown;
}

export interface LocalizedEventTimes {
  start: LocalizedTime | null;
  end: LocalizedTime | null;
  arrival: LocalizedTime | null;
}

export function localizeEventTimes<T extends EventLike>(
  event: T,
  options: LocalizeOptions = {}
): T & LocalizedEventTimes {
  const tz = (event.time_zone_iana_name as string | null | undefined) ?? null;
  const label = (event.time_zone as string | null | undefined) ?? null;
  const start = typeof event.start_date === "string" ? event.start_date : null;
  const end = typeof event.end_date === "string" ? event.end_date : null;
  const arrival = typeof event.arrival_date === "string" ? event.arrival_date : null;

  return {
    ...event,
    start: localizeTime(start, tz, label, options),
    end: localizeTime(end, tz, label, options),
    arrival: localizeTime(arrival, tz, label, options),
  };
}

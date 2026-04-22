import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeEventTimes, type EventLike } from "../../utils/time.js";
import {
  success,
  error,
  requireString,
  requireExactlyOne,
  getViewerTZ,
  type ToolArgs,
} from "./common.js";

const EVENT_ALLOWLIST = [
  "id",
  "name",
  "is_game",
  "is_canceled",
  "is_tbd",
  "game_type",
  "start_date",
  "end_date",
  "arrival_date",
  "duration_in_minutes",
  "minutes_to_arrive_early",
  "location_id",
  "location_name",
  "additional_location_details",
  "opponent_id",
  "opponent_name",
  "is_home",
  "notes",
  "uniform",
  "tracks_availability",
  "repeating_type",
  "formatted_title",
  "points_for_team",
  "points_for_opponent",
  "formatted_results",
  "time_zone",
  "time_zone_iana_name",
] as const;

function pickEventFields(e: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of EVENT_ALLOWLIST) out[k] = e[k];
  return out;
}

const LOCATION_ALLOWLIST = [
  "id",
  "name",
  "address",
  "latitude",
  "longitude",
  "url",
  "notes",
  "phone",
] as const;

function pickLocationFields(l: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LOCATION_ALLOWLIST) out[k] = l[k];
  const lat = l.latitude;
  const lng = l.longitude;
  if (typeof lat === "number" && typeof lng === "number") {
    out.map_url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }
  return out;
}

export async function handleGetEvents(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    let events = await teamsnapClient.getTeamEvents(teamId);
    const startDate = args.start_date as string | undefined;
    const endDate = args.end_date as string | undefined;
    if (startDate) {
      const start = new Date(startDate);
      events = events.filter((e) => e.start_date && new Date(String(e.start_date)) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      events = events.filter((e) => e.start_date && new Date(String(e.start_date)) <= end);
    }
    const viewerTZ = getViewerTZ();

    const LIMIT = 50;
    const truncated = events.length > LIMIT;
    const sliced = truncated ? events.slice(0, LIMIT) : events;
    const enriched = sliced.map((e) => {
      const picked = pickEventFields(e);
      return localizeEventTimes(picked as EventLike, { viewerTZ });
    });
    return success({
      teamId,
      count: enriched.length,
      total: events.length,
      truncated,
      events: enriched,
    });
  } catch (err) {
    return error(`Failed to get events: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetEvent(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const event = await teamsnapClient.getEvent(eventId);
    const viewerTZ = getViewerTZ();
    const picked = pickEventFields(event);
    const localized = localizeEventTimes(picked as EventLike, { viewerTZ });
    let location: Record<string, unknown> | null = null;
    if (event.location_id) {
      const loc = await teamsnapClient.getCore().searchOne(ENDPOINTS.locationById(String(event.location_id))).catch(() => null);
      if (loc) location = pickLocationFields(loc);
    }
    return success({ ...localized, location });
  } catch (err) {
    return error(`Failed to get event: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetLocation(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["location_id", "event_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    let locationId = key === "location_id" ? value : null;
    if (key === "event_id") {
      const ev = await teamsnapClient.getEvent(value).catch(() => null);
      if (!ev?.location_id) return success({ empty: true, reason: "no_data" });
      locationId = String(ev.location_id);
    }
    const loc = await core.searchOne(ENDPOINTS.locationById(String(locationId))).catch(() => null);
    if (!loc) return success({ empty: true, reason: "not_found" });
    return success(pickLocationFields(loc));
  } catch (err) {
    return error(`Failed to get location: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

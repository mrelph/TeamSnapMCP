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
import { buildTemplate, checkIdempotency, storeIdempotency, requireConfirm } from "../../utils/writeSafety.js";

const EVENT_ALLOWLIST = [
  "id",
  "team_id",
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

function notificationFields(args: ToolArgs): Record<string, unknown> {
  if (args.notify_team !== undefined && typeof args.notify_team !== "boolean") {
    throw new Error("notify_team must be a boolean");
  }
  const fields: Record<string, unknown> = { notify_team: args.notify_team === true };
  if (args.notify_team === true) {
    const memberId = requireString(args, "notify_team_as_member_id");
    if (!/^\d+$/.test(memberId)) throw new Error("notify_team_as_member_id must be a numeric TeamSnap member ID");
    fields.notify_team_as_member_id = memberId;
  }
  return fields;
}

function notificationSummary(fields: Record<string, unknown>) {
  return {
    requested: fields.notify_team === true,
    sending_member_id: fields.notify_team_as_member_id ?? null,
    delivery: "not_verified",
  };
}

const NOTIFICATION_WARNING = "Requests native TeamSnap schedule notifications, not a separate announcement. Delivery depends on TeamSnap and recipient settings; it is not verified by this response.";

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

export async function handleCreateEvent(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const name = requireString(args, "name");
  const startDate = requireString(args, "start_date");
  const isGame = typeof args.is_game === "boolean" ? args.is_game : false;
  if (args.is_game !== undefined && typeof args.is_game !== "boolean") return error("is_game must be a boolean");
  const durationMinutes = typeof args.duration_in_minutes === "number" ? args.duration_in_minutes : undefined;
  const locationId = typeof args.location_id === "string" ? args.location_id : undefined;
  const opponentId = typeof args.opponent_id === "string" ? args.opponent_id : undefined;
  const notes = typeof args.notes === "string" ? args.notes : undefined;
  const uniform = typeof args.uniform === "string" ? args.uniform : undefined;
  const arrivalMinutesEarly = typeof args.arrival_minutes_early === "number" ? args.arrival_minutes_early : undefined;
  const idempotencyKey = typeof args.idempotency_key === "string" ? args.idempotency_key : undefined;
  const preview = args.preview !== false;

  const fields: Record<string, unknown> = {
    team_id: teamId,
    name,
    start_date: startDate,
    is_game: isGame,
    ...notificationFields(args),
  };
  if (args.is_tbd !== undefined) {
    if (typeof args.is_tbd !== "boolean") return error("is_tbd must be a boolean");
    fields.is_tbd = args.is_tbd;
  }
  if (durationMinutes !== undefined) fields.duration_in_minutes = durationMinutes;
  if (locationId !== undefined) fields.location_id = locationId;
  if (opponentId !== undefined) fields.opponent_id = opponentId;
  if (notes !== undefined) fields.notes = notes;
  if (uniform !== undefined) fields.uniform = uniform;
  if (arrivalMinutesEarly !== undefined) fields.minutes_to_arrive_early = arrivalMinutesEarly;

  const notifying = fields.notify_team === true;
  const check = requireConfirm(args);
  if (preview || (notifying && !check.ok)) {
    return success({
      status: preview ? "preview" : "blocked",
      preview: true,
      would_post: "events",
      template: buildTemplate(fields).template,
      notifications: notificationSummary(fields),
      warning: notifying ? NOTIFICATION_WARNING : undefined,
      blocked: !preview && notifying && !check.ok ? check.reason : undefined,
    });
  }

  const cacheKey = idempotencyKey ? `create_event:${teamId}:${idempotencyKey}` : undefined;
  const fingerprint = JSON.stringify(fields);
  const cached = checkIdempotency(cacheKey) as { fingerprint: string; result: unknown } | null;
  if (cached) {
    if (cached.fingerprint !== fingerprint) return error("idempotency_key was already used for different event fields; inspect the existing event before creating another.");
    return success({ status: "committed", idempotent_replay: true, result: cached.result });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const created = await core.write("POST", ENDPOINTS.eventsBase, fields);
    const picked = pickEventFields(created);
    const viewerTZ = getViewerTZ();
    const localized = localizeEventTimes(picked as EventLike, { viewerTZ });
    const result = { ...localized, status: "committed", notifications: notificationSummary(fields) };
    storeIdempotency(cacheKey, { fingerprint, result });
    return success(result);
  } catch (err) {
    return error(`Failed to create event: ${err instanceof Error ? err.message : "Unknown error"}. A write may have committed; inspect the schedule before retrying to avoid duplicate games or notifications.`);
  }
}

const EVENT_PATCH_ALLOWED = [
  "name",
  "start_date",
  "location_id",
  "duration_in_minutes",
  "notes",
  "uniform",
  "is_canceled",
  "opponent_id",
  "minutes_to_arrive_early",
  "is_game",
  "is_tbd",
] as const;

export async function handleUpdateEvent(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  const patchArg = args.patch;
  const preview = args.preview !== false;

  if (!patchArg || typeof patchArg !== "object" || Array.isArray(patchArg)) {
    return error("patch (object) is required — e.g. { name: 'New name', start_date: '2026-06-14T19:00:00Z' }");
  }
  const patch = patchArg as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return error("patch must contain at least one field");
  }
  const unknown = keys.filter((k) => !(EVENT_PATCH_ALLOWED as readonly string[]).includes(k));
  if (unknown.length > 0) {
    return error(`patch contains unsupported fields: ${unknown.join(", ")}. Allowed: ${EVENT_PATCH_ALLOWED.join(", ")}`);
  }
  for (const key of ["is_game", "is_tbd", "is_canceled"]) {
    if (patch[key] !== undefined && typeof patch[key] !== "boolean") return error(`${key} must be a boolean`);
  }

  const cancelling = patch.is_canceled === true;
  const fields = { ...patch, ...notificationFields(args) };
  const notifying = fields.notify_team === true;
  const check = requireConfirm(args);
  if (preview || ((cancelling || notifying) && !check.ok)) {
    return success({
      status: preview ? "preview" : "blocked",
      preview: true,
      would_patch: `events/${eventId}`,
      with: fields,
      notifications: notificationSummary(fields),
      warning: [cancelling ? "Marks the event canceled; does not delete it." : "", notifying ? NOTIFICATION_WARNING : ""].filter(Boolean).join(" ") || undefined,
      blocked: !preview && (cancelling || notifying) && !check.ok ? check.reason : undefined,
    });
  }

  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();

  try {
    const core = teamsnapClient.getCore();
    const updated = await core.write("PATCH", ENDPOINTS.eventById(eventId), fields);
    const picked = pickEventFields(updated);
    const viewerTZ = getViewerTZ();
    const localized = localizeEventTimes(picked as EventLike, { viewerTZ });
    return success({ ...localized, status: "committed", notifications: notificationSummary(fields) });
  } catch (err) {
    return error(`Failed to update event: ${err instanceof Error ? err.message : "Unknown error"}. A write may have committed; read the event before retrying notifications.`);
  }
}

export async function handleDeleteEvent(args: ToolArgs): Promise<CallToolResult> {
  const eventId = requireString(args, "event_id");
  const teamId = requireString(args, "team_id");
  if (!/^\d+$/.test(eventId) || !/^\d+$/.test(teamId)) return error("event_id and team_id must be numeric TeamSnap IDs");
  const fields = notificationFields(args);
  const preview = args.preview !== false;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    // Read fresh for previews and commits; never delete through a caller-provided URL.
    const event = await teamsnapClient.getEvent(eventId);
    if (String(event.id) !== eventId || String(event.team_id) !== teamId) {
      return error("Event/team mismatch: nothing deleted. Recheck the exact event_id and team_id.");
    }
    const params: Record<string, string | boolean> = {
      repeating_include: "none",
      notify_team: fields.notify_team === true,
    };
    if (typeof fields.notify_team_as_member_id === "string") params.notify_team_as_member_id = fields.notify_team_as_member_id;
    const target = localizeEventTimes(pickEventFields(event) as EventLike, { viewerTZ: getViewerTZ() });
    const check = requireConfirm(args);
    const details = {
      would_delete: `events/${eventId}`,
      target,
      scope: "single_event_only",
      parameters: params,
      notifications: notificationSummary(fields),
      warning: "Permanently removes this event and its associated availability responses. This is deletion, not cancellation. Replacement games have separate IDs and RSVPs." + (fields.notify_team === true ? ` ${NOTIFICATION_WARNING}` : " No team notification requested."),
    };
    if (preview || !check.ok) {
      return success({ status: preview ? "preview" : "blocked", preview: true, ...details, blocked: !preview && !check.ok ? check.reason : undefined });
    }
    await teamsnapClient.getCore().delete(ENDPOINTS.eventById(eventId), params);
    return success({ status: "committed", deleted: true, event_id: eventId, team_id: teamId, target, scope: "single_event_only", notifications: notificationSummary(fields) });
  } catch (err) {
    return error(`Failed to delete event: ${err instanceof Error ? err.message : "Unknown error"}. If a DELETE was attempted, its outcome may be uncertain; re-read the event before retrying. Do not assume notifications were delivered.`);
  }
}

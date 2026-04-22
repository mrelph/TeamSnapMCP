import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { localizeEventTimes, type EventLike } from "../../utils/time.js";
import { success, error, requireString, getViewerTZ, type ToolArgs } from "./common.js";

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
    const simplified = events.map((e) => {
      const localized = localizeEventTimes(e as EventLike, { viewerTZ });
      return {
        id: e.id,
        name: e.name,
        type: e.is_game ? "game" : "practice",
        start: localized.start,
        end: localized.end,
        location: e.location_name,
        opponent: e.opponent_name,
        isHome: e.is_home,
        isCanceled: e.is_canceled,
      };
    });
    return success({ teamId, count: simplified.length, events: simplified });
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
    return success(localizeEventTimes(event as EventLike, { viewerTZ }));
  } catch (err) {
    return error(`Failed to get event: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

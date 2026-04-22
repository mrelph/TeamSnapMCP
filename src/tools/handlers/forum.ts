import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { localizeTime } from "../../utils/time.js";
import { success, error, requireString, getViewerTZ, type ToolArgs } from "./common.js";

export async function handleGetForumTopics(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 20;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const [topics, members, team] = await Promise.all([
      core.searchMany(`${ENDPOINTS.forumTopics}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.members}?team_id=${teamId}`).catch(() => []),
      teamsnapClient.getTeam(teamId).catch(() => null),
    ]);
    const memberName = new Map<string, string>();
    for (const m of members) memberName.set(String(m.id), `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());
    const tz = (team?.time_zone_iana_name as string | null) ?? null;
    const tzLabel = (team?.time_zone as string | null) ?? null;
    const viewerTZ = getViewerTZ();
    const sorted = [...topics].sort((a, b) => {
      const aT = a.last_post_at ? new Date(String(a.last_post_at)).getTime() : 0;
      const bT = b.last_post_at ? new Date(String(b.last_post_at)).getTime() : 0;
      return bT - aT;
    });
    const items = sorted.slice(0, limit).map((t) => ({
      id: t.id,
      title: t.title ?? t.subject ?? null,
      author_id: t.member_id ?? null,
      author_name: t.member_id ? memberName.get(String(t.member_id)) ?? null : null,
      last_post_at: localizeTime((t.last_post_at as string | null) ?? null, tz, tzLabel, { viewerTZ }),
      post_count: t.post_count ?? null,
    }));
    return success({ team_id: teamId, count: items.length, topics: items });
  } catch (err) {
    return error(`Failed to get forum topics: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetForumPosts(args: ToolArgs): Promise<CallToolResult> {
  const topicId = requireString(args, "topic_id");
  const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : 50;
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const posts = await core.searchMany(`${ENDPOINTS.forumPosts}?forum_topic_id=${topicId}`).catch(() => []);
    const sorted = [...posts].sort((a, b) => {
      const aT = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
      const bT = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
      return aT - bT;
    });
    const viewerTZ = getViewerTZ();
    const items = sorted.slice(0, limit).map((p) => ({
      id: p.id,
      author_id: p.member_id ?? null,
      created_at: localizeTime((p.created_at as string | null) ?? null, null, null, { viewerTZ }),
      body: p.body ?? null,
    }));
    return success({ topic_id: topicId, count: items.length, posts: items });
  } catch (err) {
    return error(`Failed to get forum posts: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

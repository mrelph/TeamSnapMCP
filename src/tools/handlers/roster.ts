import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { teamsnapClient } from "../../api/client.js";
import { ENDPOINTS } from "../../api/endpoints.js";
import { success, error, requireString, requireExactlyOne, type ToolArgs } from "./common.js";

function firstPrimary<T extends Record<string, unknown>>(items: T[], preferKey = "is_primary"): T | undefined {
  return items.find((i) => i[preferKey] === true) ?? items[0];
}

export async function handleGetRoster(args: ToolArgs): Promise<CallToolResult> {
  const teamId = requireString(args, "team_id");
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  const core = teamsnapClient.getCore();
  try {
    const [members, emails, phones, photos] = await Promise.all([
      teamsnapClient.getTeamMembers(teamId),
      core.searchMany(`${ENDPOINTS.memberEmails}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.memberPhones}?team_id=${teamId}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.memberPhotos}?team_id=${teamId}`).catch(() => []),
    ]);

    const emailByMember = new Map<string, string>();
    for (const e of emails) {
      const mid = String(e.member_id);
      if (!emailByMember.has(mid) || e.is_primary === true) {
        if (typeof e.email === "string") emailByMember.set(mid, e.email);
      }
    }
    const phoneByMember = new Map<string, string>();
    for (const p of phones) {
      const mid = String(p.member_id);
      if (!phoneByMember.has(mid) || p.is_primary === true) {
        const num = (p.phone_number ?? p.phone_value) as unknown;
        if (typeof num === "string") phoneByMember.set(mid, num);
      }
    }
    const photoByMember = new Map<string, string>();
    for (const ph of photos) {
      const mid = String(ph.member_id);
      const url = (ph.url ?? ph.large_url ?? ph.medium_url) as unknown;
      if (!photoByMember.has(mid) && typeof url === "string") photoByMember.set(mid, url);
    }

    const enrich = (m: Record<string, unknown>) => {
      const mid = String(m.id);
      return {
        id: m.id,
        first_name: m.first_name,
        last_name: m.last_name,
        jersey_number: m.jersey_number,
        position: m.position,
        birthday: m.birthday ?? null,
        gender: m.gender ?? null,
        primary_email: emailByMember.get(mid) ?? null,
        primary_phone: phoneByMember.get(mid) ?? null,
        photo_url: photoByMember.get(mid) ?? null,
      };
    };

    const players = members.filter((m) => !m.is_non_player).map(enrich);
    const coaches = members
      .filter((m) => m.is_non_player)
      .map((m) => ({
        ...enrich(m),
        is_manager: m.is_manager ?? false,
        is_owner: m.is_owner ?? false,
      }));

    return success({
      teamId,
      playerCount: players.length,
      coachCount: coaches.length,
      players,
      coaches,
    });
  } catch (err) {
    return error(`Failed to get roster: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

export async function handleGetContacts(args: ToolArgs): Promise<CallToolResult> {
  const { key, value } = requireExactlyOne(args, ["member_id", "team_id"]);
  if (!teamsnapClient.isAuthenticated()) teamsnapClient.reloadCredentials();
  try {
    const core = teamsnapClient.getCore();
    const scopeParam = key === "team_id" ? `team_id=${value}` : `member_id=${value}`;
    const [contacts, emails, phones] = await Promise.all([
      core.searchMany(`${ENDPOINTS.contacts}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.contactEmails}?${scopeParam}`).catch(() => []),
      core.searchMany(`${ENDPOINTS.contactPhones}?${scopeParam}`).catch(() => []),
    ]);
    const emailsByContact = new Map<string, string[]>();
    for (const e of emails) {
      const cid = String(e.contact_id);
      if (!emailsByContact.has(cid)) emailsByContact.set(cid, []);
      if (typeof e.email === "string") emailsByContact.get(cid)!.push(e.email);
    }
    const phonesByContact = new Map<string, string[]>();
    for (const p of phones) {
      const cid = String(p.contact_id);
      if (!phonesByContact.has(cid)) phonesByContact.set(cid, []);
      const num = (p.phone_number ?? p.phone_value) as unknown;
      if (typeof num === "string") phonesByContact.get(cid)!.push(num);
    }
    const merged = contacts.map((c) => {
      const cid = String(c.id);
      return {
        id: c.id,
        member_id: c.member_id,
        first_name: c.first_name,
        last_name: c.last_name,
        label: c.label ?? null,
        is_emergency: c.is_emergency ?? false,
        emails: emailsByContact.get(cid) ?? [],
        phones: phonesByContact.get(cid) ?? [],
      };
    });
    return success({
      scope: key === "team_id" ? "team" : "member",
      scope_id: value,
      count: merged.length,
      contacts: merged,
    });
  } catch (err) {
    return error(`Failed to get contacts: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

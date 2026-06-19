import type { SessionResponse } from "@gw-link-omniai/shared";

export function getAdminSessionBanner(session: SessionResponse): string {
  if (session.authenticated && session.user) {
    return `Admin session active: ${session.user.displayName}`;
  }

  return "Admin login required";
}

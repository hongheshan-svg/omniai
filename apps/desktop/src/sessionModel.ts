import type { SessionResponse } from "@gw-link-omniai/shared";

export function getDesktopSessionCta(session: SessionResponse): string {
  if (session.authenticated && session.user) {
    return `Signed in as ${session.user.displayName}`;
  }

  return "Sign in";
}

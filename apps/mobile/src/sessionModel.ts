import type { SessionResponse } from "@gw-link-omniai/shared";

export function getMobileSessionCta(session: SessionResponse): string {
  if (session.authenticated && session.user) {
    return session.user.displayName;
  }

  return "Sign In";
}

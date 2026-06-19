import type { SessionResponse } from "@gw-link-omniai/shared";
import { getMobileSessionCta } from "./sessionModel";

const anonymousSession: SessionResponse = {
  authenticated: false,
  user: null,
  expiresAt: null
};

export function getMobileHomeActions(): string[] {
  return [
    getMobileSessionCta(anonymousSession),
    "Text Chat",
    "Image Generation",
    "Video Generation",
    "Creation History",
    "Task Notifications"
  ];
}

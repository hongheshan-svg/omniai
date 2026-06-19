import type { PlanCode } from "./models";

export type LoginChannel = "email" | "phone";

export interface LoginStartRequest {
  destination: string;
  channel?: LoginChannel;
}

export interface LoginStartResponse {
  challengeId: string;
  channel: LoginChannel;
  maskedDestination: string;
  expiresAt: string;
  devCode?: string;
}

export interface LoginVerifyRequest {
  challengeId: string;
  code: string;
}

export interface UserProfile {
  id: string;
  displayName: string;
  destination: string;
  channel: LoginChannel;
  plan: PlanCode;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  user: UserProfile;
  expiresAt: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user: UserProfile | null;
  expiresAt: string | null;
}

export function inferLoginChannel(destination: string): LoginChannel {
  return destination.includes("@") ? "email" : "phone";
}

export function maskLoginDestination(
  destination: string,
  channel: LoginChannel = inferLoginChannel(destination)
): string {
  if (channel === "email") {
    const [localPart, domain] = destination.split("@");
    const visible = localPart.at(0) ?? "*";
    return `${visible}***@${domain ?? ""}`;
  }

  const digits = destination.replace(/\D/g, "");
  const suffix = digits.slice(-4);
  const hiddenCount = Math.max(4, digits.length - suffix.length);
  return `${"*".repeat(hiddenCount)}${suffix}`;
}

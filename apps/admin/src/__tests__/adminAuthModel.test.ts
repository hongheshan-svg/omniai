import { describe, expect, it } from "vitest";
import type { ApiClient } from "@gw-link-omniai/shared";
import { createAdminAuthController } from "../adminAuthModel";

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    startLogin: async () => ({ challengeId: "chal_1", channel: "email", maskedDestination: "a***@x.com", expiresAt: "2026-07-04T00:10:00.000Z" }),
    verifyLogin: async () => ({
      token: "tok_1",
      user: {
        id: "user_1",
        displayName: "admin",
        destination: "admin@example.com",
        channel: "email",
        plan: "studio",
        createdAt: "2026-07-04T00:00:00.000Z"
      },
      expiresAt: "2026-07-04T01:00:00.000Z"
    }),
    ...overrides
  } as unknown as ApiClient;
}

describe("createAdminAuthController", () => {
  it("advances to codeSent after startLogin", async () => {
    const controller = createAdminAuthController(fakeClient());
    await controller.startLogin("admin@example.com");
    const state = controller.getState();
    expect(state.stage).toBe("codeSent");
    expect(state.challengeId).toBe("chal_1");
  });

  it("sets the token and signs in after a successful verify", async () => {
    const controller = createAdminAuthController(fakeClient());
    await controller.startLogin("admin@example.com");
    await controller.verify("123456");
    const state = controller.getState();
    expect(state.stage).toBe("signedIn");
    expect(state.token).toBe("tok_1");
  });

  it("sets an error when verify fails", async () => {
    const controller = createAdminAuthController(
      fakeClient({ verifyLogin: async () => { throw new Error("boom"); } })
    );
    await controller.startLogin("admin@example.com");
    await controller.verify("000000");
    const state = controller.getState();
    expect(state.stage).toBe("codeSent");
    expect(state.token).toBeNull();
    expect(state.error).toBe("登录失败，请重试");
  });
});

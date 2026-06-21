import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generationTasks } from "../schema";
import { createPgliteDatabase, type PgliteDatabase } from "../../testSupport/pglite";

describe("database schema", () => {
  let database: PgliteDatabase;

  beforeEach(async () => {
    database = await createPgliteDatabase();
  });

  afterEach(async () => {
    await database.close();
  });

  it("round-trips jsonb and timestamptz columns through migrations", async () => {
    const createdAt = new Date("2026-06-20T00:00:00.000Z");
    await database.db.insert(generationTasks).values({
      id: "generation_task_roundtrip",
      ownerUserId: null,
      mode: "image",
      status: "queued",
      prompt: "做一张海报",
      optimizedPrompt: "制作一张商业海报。",
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: { title: "图片生成任务", description: "任务已排队。" },
      createdAt,
      updatedAt: createdAt
    });

    const rows = await database.db
      .select()
      .from(generationTasks)
      .where(eq(generationTasks.id, "generation_task_roundtrip"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "generation_task_roundtrip",
      ownerUserId: null,
      preset: {
        modelId: "gw-image-creative",
        parameters: { aspectRatio: "4:3", quality: "high", count: 1 },
        creditEstimate: { credits: 2, unit: "credit" }
      },
      resultPreview: { title: "图片生成任务", description: "任务已排队。" }
    });
    expect(rows[0]!.createdAt.toISOString()).toBe("2026-06-20T00:00:00.000Z");
  });
});

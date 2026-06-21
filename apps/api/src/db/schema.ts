import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import type {
  CreationAssetContent,
  CreationAssetPreview,
  CreationAssetSource,
  GenerationTaskResult,
  GenerationTaskResultPreview,
  PresetSuggestion
} from "@gw-link-omniai/shared";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    destination: text("destination").notNull(),
    channel: text("channel").notNull(),
    plan: text("plan").notNull().default("free"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull()
  },
  (table) => ({
    subjectUnique: uniqueIndex("users_channel_destination_key").on(table.channel, table.destination)
  })
);

export const loginChallenges = pgTable(
  "login_challenges",
  {
    id: text("id").primaryKey(),
    destination: text("destination").notNull(),
    channel: text("channel").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0)
  },
  (table) => ({
    expiresAtIdx: index("login_challenges_expires_at_idx").on(table.expiresAt)
  })
);

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull()
  },
  (table) => ({
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
    expiresAtIdx: index("sessions_expires_at_idx").on(table.expiresAt)
  })
);

export const generationTasks = pgTable(
  "generation_tasks",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    prompt: text("prompt").notNull(),
    optimizedPrompt: text("optimized_prompt").notNull(),
    preset: jsonb("preset").$type<PresetSuggestion>().notNull(),
    resultPreview: jsonb("result_preview").$type<GenerationTaskResultPreview>().notNull(),
    result: jsonb("result").$type<GenerationTaskResult>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull()
  },
  (table) => ({
    ownerCreatedIdx: index("generation_tasks_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt
    )
  })
);

export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    mode: text("mode").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<CreationAssetContent>().notNull(),
    preview: jsonb("preview").$type<CreationAssetPreview>().notNull(),
    source: jsonb("source").$type<CreationAssetSource>().notNull(),
    prompt: text("prompt").notNull(),
    optimizedPrompt: text("optimized_prompt").notNull(),
    preset: jsonb("preset").$type<PresetSuggestion>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull()
  },
  (table) => ({
    ownerCreatedIdx: index("assets_owner_created_idx").on(table.ownerUserId, table.createdAt)
  })
);

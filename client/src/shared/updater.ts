import { z } from "zod";

const updateChannelSchema = z.enum(["beta", "stable"]);

export const clientUpdateStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("disabled"), currentVersion: z.string(), channel: updateChannelSchema, reason: z.string() }).strict(),
  z.object({ status: z.literal("idle"), currentVersion: z.string(), channel: updateChannelSchema }).strict(),
  z.object({ status: z.literal("checking"), currentVersion: z.string(), channel: updateChannelSchema }).strict(),
  z.object({ status: z.literal("up-to-date"), currentVersion: z.string(), channel: updateChannelSchema, checkedAt: z.string().datetime() }).strict(),
  z.object({ status: z.literal("available"), currentVersion: z.string(), channel: updateChannelSchema, version: z.string(), releaseUrl: z.string().url(), sizeBytes: z.number().int().positive() }).strict(),
  z.object({ status: z.literal("downloading"), currentVersion: z.string(), channel: updateChannelSchema, version: z.string(), percent: z.number().min(0).max(100) }).strict(),
  z.object({ status: z.literal("downloaded"), currentVersion: z.string(), channel: updateChannelSchema, version: z.string() }).strict(),
  z.object({ status: z.literal("error"), currentVersion: z.string(), channel: updateChannelSchema, message: z.string() }).strict(),
]);

export type ClientUpdateState = z.infer<typeof clientUpdateStateSchema>;

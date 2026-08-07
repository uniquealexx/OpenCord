import { z } from "zod";

export const screenShareSourceSchema = z.object({
  id: z.string().min(1).max(500),
  name: z.string().min(1).max(240),
  kind: z.enum(["screen", "window"]),
  thumbnail: z.string().max(2_000_000).regex(/^data:image\/png;base64,/u),
  appIcon: z.string().max(500_000).regex(/^data:image\/png;base64,/u).nullable(),
});

export const screenShareSourcesSchema = z.array(screenShareSourceSchema).max(200);
export const screenShareSelectionSchema = z.object({
  sourceId: z.string().min(1).max(500),
  includeAudio: z.boolean(),
});

export const screenShareDiagnosticSchema = z.string().max(2_000);

export type ScreenShareSource = z.infer<typeof screenShareSourceSchema>;
export type ScreenShareSelection = z.infer<typeof screenShareSelectionSchema>;

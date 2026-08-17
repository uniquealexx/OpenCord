import { z } from "zod";

export const screenShareSourceSchema = z.object({
  id: z.string().min(1).max(500),
  name: z.string().min(1).max(240),
  kind: z.enum(["screen", "window"]),
  width: z.number().int().min(1).max(16_384),
  height: z.number().int().min(1).max(16_384),
  thumbnail: z.string().max(2_000_000).regex(/^data:image\/png;base64,/u),
  appIcon: z.string().max(500_000).regex(/^data:image\/png;base64,/u).nullable(),
  previewUnavailable: z.boolean().optional(),
});

export const screenShareSourcesSchema = z.array(screenShareSourceSchema).max(200);
export const screenShareSelectionSchema = z.object({
  sourceId: z.string().min(1).max(500),
  includeAudio: z.boolean(),
});

export const screenShareDiagnosticSchema = z.string().max(2_000);

export type ScreenShareSource = z.infer<typeof screenShareSourceSchema>;
export type ScreenShareSelection = z.infer<typeof screenShareSelectionSchema>;

const blockedWindowTitles = [
  /overlay/iu,
  /^NVIDIA(?:\s+GeForce)?\s+(?:Share|Container)$/iu,
  /^(?:Xbox\s+)?Game Bar$/iu,
  /^(?:Discord|Steam) Overlay$/iu,
  /^Codex Computer Use Cursor Overlay$/iu,
  /^ChatGPT is using your computer(?:\.|$)/iu,
  /^(?:Program Manager|Task Switching|Task View|Windows Input Experience|Microsoft Text Input Application)$/iu,
];

export function isAllowedScreenShareSource(source: Pick<ScreenShareSource, "id" | "name">): boolean {
  if (source.id.startsWith("screen:")) return true;
  if (!source.id.startsWith("window:")) return false;
  const title = source.name.replace(/\s+/gu, " ").trim();
  return title.length > 0 && !blockedWindowTitles.some((pattern) => pattern.test(title));
}

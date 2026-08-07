import { attachmentSchema } from "@opencord/shared";
import { z } from "zod";

const serverAddressSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    context.addIssue({ code: "custom", message: "Invalid server address" });
  }
});

export const attachmentTransferContextSchema = z.object({
  serverAddress: serverAddressSchema,
  sessionToken: z.string().min(40).max(200),
  maxAttachmentBytes: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
});

export const attachmentDownloadRequestSchema = attachmentTransferContextSchema.omit({ maxAttachmentBytes: true }).extend({ attachment: attachmentSchema });
export const attachmentUploadResultSchema = attachmentSchema.nullable();
export const attachmentPreviewResultSchema = z.union([
  z.string().max(15_000_000).regex(/^data:(?:image\/(?:png|jpeg|gif|webp)|video\/(?:mp4|webm|ogg));base64,/u),
  z.string().max(2_048).url().refine((value) => new URL(value).protocol === "file:", "Expected a local video preview URL"),
]);

export type AttachmentTransferContext = z.infer<typeof attachmentTransferContextSchema>;
export type AttachmentDownloadRequest = z.infer<typeof attachmentDownloadRequestSchema>;

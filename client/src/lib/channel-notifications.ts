// Per-channel notification settings: pure helpers shared by the bell popover
// and the toast trigger. Notification state is client-local; nothing here
// touches the protocol or the server.
import { channelNotificationSettingsSchema, type ChannelNotificationSettings } from "@/shared/state";

export function getChannelNotificationSettings(
  preferences: { notificationOverrides?: Record<string, unknown> },
  channelId: string,
): ChannelNotificationSettings {
  return channelNotificationSettingsSchema.parse(preferences.notificationOverrides?.[channelId] ?? {});
}

/** Decides whether an incoming message raises an in-app toast. */
export function shouldNotify(input: {
  globalEnabled: boolean;
  settings: ChannelNotificationSettings;
  authorId: string;
  selfUserId: string;
  isMentioned: boolean;
  isEveryone: boolean;
}): boolean {
  if (!input.globalEnabled) return false;
  if (input.authorId === input.selfUserId) return false;
  if (input.settings.enabled) return true;
  if (input.isMentioned && input.settings.mentions) return true;
  if (input.isEveryone && input.settings.everyone) return true;
  return false;
}

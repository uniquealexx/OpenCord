// Per-channel notification settings: pure helpers shared by the bell popover
// and the toast trigger. Notification state is client-local; nothing here
// touches the protocol or the server.
import type { NotificationToast } from "@/components/notification-toasts";
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

/**
 * Builds a toast for an incoming message, or null when it must stay silent
 * (own message, global mute, channel settings, or the chat being read).
 */
export function buildToastForMessage(input: {
  messageId: string;
  channelId: string;
  channelName: string;
  authorId: string;
  authorName: string;
  excerpt: string;
  mentionedUserIds: string[];
  contentHasEveryone: boolean;
  selfUserId: string;
  activeChannelId: string | null;
  windowFocused: boolean;
  globalEnabled: boolean;
  settings: ChannelNotificationSettings;
}): NotificationToast | null {
  const isMentioned = input.mentionedUserIds.includes(input.selfUserId);
  if (!shouldNotify({ globalEnabled: input.globalEnabled, settings: input.settings, authorId: input.authorId, selfUserId: input.selfUserId, isMentioned, isEveryone: input.contentHasEveryone })) return null;
  if (input.channelId === input.activeChannelId && input.windowFocused) return null;
  return {
    id: input.messageId,
    channelId: input.channelId,
    channelName: input.channelName,
    authorName: input.authorName,
    kind: isMentioned ? "mention" : input.contentHasEveryone ? "everyone" : "message",
    excerpt: input.excerpt,
  };
}

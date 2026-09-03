// Резолв, рендер и автокомплит упоминаний @username[#1234].
//
// В тексте сообщения упоминание хранится как маркер <@userId> (см. shared/src/mentions.ts),
// поэтому переименования не ломают старые упоминания. Пользователь набирает читаемый
// @username или @username#1234; при отправке они преобразуются в маркеры, а список userId
// передаётся в поле mentions и проверяется сервером.

import { MENTION_TOKEN_PATTERN, buildMentionToken, parseMentionTokens } from "@opencord/shared";

export interface MentionCandidate {
  id: string;
  username: string;
  discriminator?: string;
  avatar?: string | null;
  banner?: string | null;
  color?: string;
  status?: "online" | "idle" | "dnd" | "offline";
  customStatus?: string;
  customStatusEmoji?: string;
  role?: string;
  bio?: string;
  fingerprint?: string;
  nameGlow?: string | null;
}

export type ContentSegment = { kind: "text"; text: string } | { kind: "mention"; userId: string };

const MENTION_AT_PATTERN = /(^|[\s"'“(«([{])@([a-z0-9_.-]{2,32})(?:#([0-9]{4}))?/giu;
const MENTION_BEFORE_CURSOR_PATTERN = /(^|[\s"'“(«([{])@([a-z0-9_.-]*)(?:#([0-9]*))?$/iu;

/** Токен @username[#1234] перед курсором в черновике, если он есть. */
export function mentionQueryAtCursor(draft: string, cursor: number): { query: string; discriminator: string; start: number; end: number } | null {
  const before = draft.slice(0, cursor);
  const match = MENTION_BEFORE_CURSOR_PATTERN.exec(before);
  if (!match) return null;
  const prefixLength = match[1]?.length ?? 0;
  return { query: (match[2] ?? "").toLowerCase(), discriminator: match[3] ?? "", start: cursor - match[0].length + prefixLength, end: cursor };
}

/** Кандидаты для автокомплита: префикс или подстрока username, необязательное сужение по тегу. */
export function matchMentionCandidates(members: MentionCandidate[], query: string, discriminator: string, limit = 8): MentionCandidate[] {
  const normalizedQuery = query.toLowerCase();
  return members
    .filter((member) => !discriminator || (member.discriminator ?? "") === discriminator)
    .filter((member) => {
      if (!normalizedQuery) return true;
      return member.username.toLowerCase().includes(normalizedQuery);
    })
    .sort((left, right) => {
      const leftUsername = left.username.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      const rightUsername = right.username.toLowerCase().startsWith(normalizedQuery) ? 0 : 1;
      return leftUsername - rightUsername || left.username.localeCompare(right.username);
    })
    .slice(0, limit);
}

/**
 * Преобразует @username[#1234] в маркеры <@userId> и собирает список упоминаний.
 * Правила: точное совпадение username (без учёта регистра) + опциональный дискриминатор;
 * если кандидатов несколько, выбирается первый в порядке списка участников сервера —
 * точный выбор даёт автокомплит, а проверить адресата можно по коду идентичности в превью.
 */
export function resolveDraftMentions(content: string, members: MentionCandidate[]): { content: string; mentions: string[] } {
  const mentions: string[] = [];
  const addMention = (userId: string): void => {
    if (!mentions.includes(userId)) mentions.push(userId);
  };
  // Уже существующие маркеры (вставленный текст или нераскрытая правка) считаем упоминаниями.
  for (const userId of parseMentionTokens(content)) addMention(userId);
  const resolved = content.replace(MENTION_AT_PATTERN, (raw, prefix: string, name: string, tag: string | undefined) => {
    const candidate = resolveMentionToken(name, tag, members);
    if (!candidate) return raw;
    addMention(candidate.id);
    return `${prefix}${buildMentionToken(candidate.id)}`;
  });
  return { content: resolved, mentions };
}

function resolveMentionToken(name: string, discriminator: string | undefined, members: MentionCandidate[]): MentionCandidate | null {
  const byUsername = members.filter((member) => member.username.toLowerCase() === name.toLowerCase());
  const pool = discriminator ? byUsername.filter((member) => (member.discriminator ?? "") === discriminator) : byUsername;
  return pool[0] ?? null;
}

/** Раскрывает маркеры <@userId> обратно в читаемый тег для редактирования сообщения. */
export function expandMentionsForEditing(content: string, members: MentionCandidate[]): string {
  return content.replace(MENTION_TOKEN_PATTERN, (raw, userId: string) => {
    const member = members.find((candidate) => candidate.id === userId);
    if (!member) return raw;
    return `@${member.username}`;
  });
}

/** Разбивает контент на текстовые сегменты и маркеры упоминаний для рендера. */
export function splitMessageContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  for (const match of content.matchAll(MENTION_TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ kind: "text", text: content.slice(lastIndex, index) });
    segments.push({ kind: "mention", userId: match[1]! });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) segments.push({ kind: "text", text: content.slice(lastIndex) });
  return segments;
}

// --- Слэш-команды ---------------------------------------------------------

export type SlashCommand =
  | { type: "none" }
  | { type: "roll" }
  | { type: "pm"; targetUserId: string | null; content: string }
  | { type: "apm"; targetUserId: string | null; content: string }
  | { type: "mute"; targetUserId: string | null; durationMinutes: number | null }
  | { type: "unmute"; targetUserId: string | null };

const SLASH_COMMAND_PATTERN = /^\/(pm|apm|mute|unmute)(?:\s+(.+))?$/iu;
const MUTE_DURATION_PATTERN = /^(\d{1,3})(m|h|d)$/iu;
export const MUTE_DURATION_MAX_MINUTES = 10_080 as const;

/** Длительность мута "30m", "2h", "1d" → минуты; null для бессрочного/невалидного. */
export function parseMuteDuration(text: string): number | null {
  const match = MUTE_DURATION_PATTERN.exec(text.trim());
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const minutes = unit === "m" ? value : unit === "h" ? value * 60 : value * 1_440;
  return minutes >= 1 && minutes <= MUTE_DURATION_MAX_MINUTES ? minutes : null;
}

/** Токен слэш-команды в начале черновика: query и границы токена, если курсор внутри него. */
export function commandQueryAtCursor(draft: string, cursor: number): { query: string; tokenStart: number; tokenEnd: number } | null {
  const trimmed = draft.trimStart();
  const match = /^\/[a-z]*$/iu.exec(trimmed);
  if (!match) return null;
  const tokenStart = draft.length - trimmed.length;
  const tokenEnd = tokenStart + match[0].length;
  if (cursor < tokenStart + 1 || cursor > tokenEnd) return null;
  return { query: match[0].slice(1).toLowerCase(), tokenStart, tokenEnd };
}

/** Разбирает черновик как слэш-команду; возвращает { type: "none" }, если это не команда. */
export function parseSlashCommand(draft: string, members: MentionCandidate[]): SlashCommand {
  const trimmed = draft.trim();
  if (trimmed === "/roll") return { type: "roll" };
  const match = SLASH_COMMAND_PATTERN.exec(trimmed);
  if (!match) return { type: "none" };
  const command = match[1]!.toLowerCase() as "pm" | "apm" | "mute" | "unmute";
  const rest = (match[2] ?? "").trimStart();
  if (command === "pm" || command === "apm") {
    const target = parseCommandTarget(rest, members);
    return { type: command, targetUserId: target.userId, content: resolveDraftMentions(target.rest, members).content };
  }
  const target = parseCommandTarget(rest, members);
  if (command === "mute") return { type: "mute", targetUserId: target.userId, durationMinutes: parseMuteDuration(target.rest) };
  return { type: "unmute", targetUserId: target.userId };
}

/** Выделяет первый токен @username[#1234] в начале текста команды и резолвит его в userId. */
export function parseCommandTarget(text: string, members: MentionCandidate[]): { userId: string | null; rest: string } {
  const trimmedStart = text.trimStart();
  const match = /^@([a-z0-9_.-]{2,32})(?:#([0-9]{4}))?/iu.exec(trimmedStart);
  if (!match) return { userId: null, rest: text.trim() };
  const resolved = resolveDraftMentions(match[0], members);
  return { userId: resolved.mentions[0] ?? null, rest: trimmedStart.slice(match[0].length).trim() };
}

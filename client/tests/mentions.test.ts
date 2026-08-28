import { describe, expect, it } from "vitest";
import { buildMentionToken } from "@opencord/shared";
import { commandQueryAtCursor, expandMentionsForEditing, matchMentionCandidates, mentionQueryAtCursor, parseCommandTarget, parseMuteDuration, parseSlashCommand, resolveDraftMentions, splitMessageContent, type MentionCandidate } from "@/lib/mentions";

const members: MentionCandidate[] = [
  { id: "user-lina", username: "lina", discriminator: "1234", status: "online" },
  { id: "user-mark", username: "mark", discriminator: "5678", status: "offline" },
  { id: "user-lina2", username: "lina", discriminator: "9999", status: "offline" },
  { id: "user-marina", username: "marina", discriminator: "4242", status: "online" },
];

describe("mentions", () => {
  it("finds the @token before the cursor", () => {
    expect(mentionQueryAtCursor("привет @li", 10)).toEqual({ query: "li", discriminator: "", start: 7, end: 10 });
    expect(mentionQueryAtCursor("привет @lina#12", 15)).toEqual({ query: "lina", discriminator: "12", start: 7, end: 15 });
    expect(mentionQueryAtCursor("привет мир", 10)).toBeNull();
    expect(mentionQueryAtCursor("почта@example", 13)).toBeNull();
    expect(mentionQueryAtCursor("@", 1)).toEqual({ query: "", discriminator: "", start: 0, end: 1 });
  });

  it("ranks autocomplete candidates by username prefix and filters by discriminator", () => {
    const byPrefix = matchMentionCandidates(members, "lina", "");
    expect(byPrefix.map((candidate) => candidate.id)).toEqual(["user-lina", "user-lina2"]);
    const byTag = matchMentionCandidates(members, "lina", "9999");
    expect(byTag.map((candidate) => candidate.id)).toEqual(["user-lina2"]);
    const bySubstring = matchMentionCandidates(members, "arin", "");
    expect(bySubstring.map((candidate) => candidate.id)).toEqual(["user-marina"]);
    const empty = matchMentionCandidates(members, "", "");
    expect(empty.length).toBeLessThanOrEqual(8);
  });

  it("resolves unique @username and @username#1234 tokens into markers", () => {
    expect(resolveDraftMentions("Привет @mark!", members)).toEqual({
      content: `Привет ${buildMentionToken("user-mark")}!`,
      mentions: ["user-mark"],
    });
    // Два пользователя с одинаковым username: без тега выбирается первый в порядке списка.
    expect(resolveDraftMentions("Привет @lina", members)).toEqual({
      content: `Привет ${buildMentionToken("user-lina")}`,
      mentions: ["user-lina"],
    });
    // Тег сужает до второго близнеца.
    expect(resolveDraftMentions("Привет @lina#9999", members)).toEqual({
      content: `Привет ${buildMentionToken("user-lina2")}`,
      mentions: ["user-lina2"],
    });
  });

  it("leaves unknown mentions as plain text and deduplicates mentions", () => {
    expect(resolveDraftMentions("Привет @nobody и @mark и @mark", members)).toEqual({
      content: `Привет @nobody и ${buildMentionToken("user-mark")} и ${buildMentionToken("user-mark")}`,
      mentions: ["user-mark"],
    });
  });

  it("keeps existing <@id> markers and their mentions", () => {
    const content = `Смотри ${buildMentionToken("user-marina")}`;
    expect(resolveDraftMentions(content, members)).toEqual({ content, mentions: ["user-marina"] });
  });

  it("expands markers back to readable tags for editing", () => {
    const content = `Смотри ${buildMentionToken("user-lina2")} и ${buildMentionToken("user-unknown")}`;
    expect(expandMentionsForEditing(content, members)).toBe(`Смотри @lina и ${buildMentionToken("user-unknown")}`);
  });

  it("splits content into text and mention segments", () => {
    const content = `Привет ${buildMentionToken("user-mark")}, как дела?`;
    expect(splitMessageContent(content)).toEqual([
      { kind: "text", text: "Привет " },
      { kind: "mention", userId: "user-mark" },
      { kind: "text", text: ", как дела?" },
    ]);
    expect(splitMessageContent("Без упоминаний")).toEqual([{ kind: "text", text: "Без упоминаний" }]);
  });

  it("recognizes /roll only as an exact command", () => {
    expect(parseSlashCommand("/roll", members)).toEqual({ type: "roll" });
    expect(parseSlashCommand("  /roll  ", members)).toEqual({ type: "roll" });
    expect(parseSlashCommand("/roll 5", members)).toEqual({ type: "none" });
  });

  it("parses /pm and /apm with a target and content", () => {
    expect(parseSlashCommand("/pm @mark Привет!", members)).toEqual({ type: "pm", targetUserId: "user-mark", content: "Привет!" });
    expect(parseSlashCommand("/apm @lina#9999 Секрет", members)).toEqual({ type: "apm", targetUserId: "user-lina2", content: "Секрет" });
    expect(parseSlashCommand("/pm @nobody Привет", members)).toEqual({ type: "pm", targetUserId: null, content: "Привет" });
    expect(parseSlashCommand("/pm @mark", members)).toEqual({ type: "pm", targetUserId: "user-mark", content: "" });
  });

  it("parses /mute and /unmute targets with an optional duration", () => {
    expect(parseSlashCommand("/mute @mark", members)).toEqual({ type: "mute", targetUserId: "user-mark", durationMinutes: null });
    expect(parseSlashCommand("/mute @mark 30m", members)).toEqual({ type: "mute", targetUserId: "user-mark", durationMinutes: 30 });
    expect(parseSlashCommand("/mute @mark 2h", members)).toEqual({ type: "mute", targetUserId: "user-mark", durationMinutes: 120 });
    expect(parseSlashCommand("/mute @mark 99x", members)).toEqual({ type: "mute", targetUserId: "user-mark", durationMinutes: null });
    expect(parseSlashCommand("/unmute @mark лишний текст", members)).toEqual({ type: "unmute", targetUserId: "user-mark" });
    expect(parseSlashCommand("/mute без тега", members)).toEqual({ type: "mute", targetUserId: null, durationMinutes: null });
    expect(parseSlashCommand("обычный текст", members)).toEqual({ type: "none" });
    expect(parseSlashCommand("", members)).toEqual({ type: "none" });
  });

  it("parses mute durations in minutes, hours and days", () => {
    expect(parseMuteDuration("45m")).toBe(45);
    expect(parseMuteDuration("2h")).toBe(120);
    expect(parseMuteDuration("1d")).toBe(1440);
    expect(parseMuteDuration("0m")).toBeNull();
    expect(parseMuteDuration("10081m")).toBeNull();
    expect(parseMuteDuration("abc")).toBeNull();
    expect(parseMuteDuration("")).toBeNull();
  });

  it("extracts the first @token as the command target", () => {
    expect(parseCommandTarget("@mark остальное", members)).toEqual({ userId: "user-mark", rest: "остальное" });
    expect(parseCommandTarget("нет тега", members)).toEqual({ userId: null, rest: "нет тега" });
  });

  it("finds a command token at the start of the draft", () => {
    expect(commandQueryAtCursor("/pm", 3)).toEqual({ query: "pm", tokenStart: 0, tokenEnd: 3 });
    expect(commandQueryAtCursor("/", 1)).toEqual({ query: "", tokenStart: 0, tokenEnd: 1 });
    expect(commandQueryAtCursor("  /ap", 5)).toEqual({ query: "ap", tokenStart: 2, tokenEnd: 5 });
    expect(commandQueryAtCursor("/pm @mark", 5)).toBeNull();
    expect(commandQueryAtCursor("привет /roll", 11)).toBeNull();
    expect(commandQueryAtCursor("/", 0)).toBeNull();
  });
});

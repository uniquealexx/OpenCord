"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { LinkPreviews } from "@/components/link-preview";
import { ProfilePreview } from "@/components/profile-preview";
import { useI18n } from "@/lib/i18n";
import { splitMessageContent } from "@/lib/mentions";
import { extractCodeBlocks, groupQuoteLines, parseInline, type InlineNode } from "@/lib/message-markdown";
import { nicknameStyle } from "@/lib/name-font";
import { cn } from "@/lib/utils";
import type { MockMember } from "@/shared/state";

const MENTION_PILL_CLASS = "inline-flex h-[18px] items-center rounded-[4px] bg-blue-500/18 px-1 align-middle text-[12px] leading-none text-blue-200/80" as const;
const EVERYONE_PILL_CLASS = "inline-flex h-[18px] items-center rounded-[4px] bg-blue-500/18 px-1 align-middle text-[12px] font-medium leading-none text-blue-200" as const;

type Block =
  | { kind: "paragraph"; source: string }
  | { kind: "quote"; children: Block[] }
  | { kind: "code"; language: string | null; code: string };

function buildTextBlocks(text: string): Block[] {
  return groupQuoteLines(text.split("\n")).flatMap((group): Block[] => {
    if (group.type === "paragraph") return [{ kind: "paragraph", source: group.text }];
    return [{ kind: "quote", children: buildTextBlocks(group.group.inner) }];
  });
}

function buildBlocks(content: string): Block[] {
  return extractCodeBlocks(content).flatMap((chunk): Block[] => {
    if (chunk.type === "codeBlock") return [{ kind: "code", language: chunk.language, code: chunk.code }];
    return buildTextBlocks(chunk.text);
  });
}

/**
 * Discord-подобный рендер текста сообщения: спойлеры, код, цитаты, жирный,
 * курсив, зачёркнутый + существующие упоминания. Пользовательский текст
 * выводится только текстовыми узлами React — без innerHTML, теги остаются
 * текстом (XSS-safe по построению).
 */
export function MessageContent({ content, members, mentions, linkPreviewsEnabled = true }: { content: string; members: MockMember[]; mentions?: string[]; linkPreviewsEnabled?: boolean }): React.ReactElement {
  const blocks = useMemo(() => buildBlocks(content), [content]);
  return (
    <div className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300 select-text cursor-text">
      {blocks.map((block, index) => (
        <MessageBlock key={index} block={block} members={members} mentions={mentions} />
      ))}
      <LinkPreviews content={content} enabled={linkPreviewsEnabled} />
    </div>
  );
}

function MessageBlock({ block, members, mentions }: { block: Block; members: MockMember[]; mentions?: string[] }): React.ReactElement {
  if (block.kind === "code") return <CodeBlockView language={block.language} code={block.code} />;
  if (block.kind === "quote") {
    return (
      <blockquote className="my-1 border-l-2 border-slate-500/60 pl-3 text-slate-300">
        {block.children.map((child, index) => (
          <MessageBlock key={index} block={child} members={members} mentions={mentions} />
        ))}
      </blockquote>
    );
  }
  return (
    <p className="min-w-0">
      <RichText source={block.source} members={members} mentions={mentions} />
    </p>
  );
}

function RichText({ source, members, mentions }: { source: string; members: MockMember[]; mentions?: string[] }): React.ReactElement {
  return (
    <>
      {splitMessageContent(source).map((segment, index) => {
        if (segment.kind === "text") return <InlineNodes key={index} nodes={parseInline(segment.text)} members={members} mentions={mentions} />;
        if (segment.kind === "everyone") {
          return (
            <span key={index} aria-label="@everyone" className={EVERYONE_PILL_CLASS}>
              <span>@everyone</span>
            </span>
          );
        }
        return <MemberPill key={index} userId={segment.userId} mentioned={Boolean(mentions?.includes(segment.userId))} members={members} />;
      })}
    </>
  );
}

function InlineNodes({ nodes, members, mentions }: { nodes: InlineNode[]; members: MockMember[]; mentions?: string[] }): React.ReactElement {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === "text") return <span key={index}>{node.text}</span>;
        if (node.type === "inlineCode") return <code key={index} className="rounded bg-white/[.07] px-1 py-px font-mono text-[12px] text-violet-100">{node.text}</code>;
        if (node.type === "bold") {
          return (
            <strong key={index}>
              <InlineNodes nodes={node.children} members={members} mentions={mentions} />
            </strong>
          );
        }
        if (node.type === "italic") {
          return (
            <em key={index}>
              <InlineNodes nodes={node.children} members={members} mentions={mentions} />
            </em>
          );
        }
        if (node.type === "strike") {
          return (
            <s key={index}>
              <InlineNodes nodes={node.children} members={members} mentions={mentions} />
            </s>
          );
        }
        return <SpoilerSpan key={index} node={node} members={members} mentions={mentions} />;
      })}
    </>
  );
}

function SpoilerSpan({ node, members, mentions }: { node: Extract<InlineNode, { type: "spoiler" }>; members: MockMember[]; mentions?: string[] }): React.ReactElement {
  const { t } = useI18n();
  const [revealed, setRevealed] = useState(false);
  return (
    <button
      type="button"
      aria-expanded={revealed}
      aria-label={revealed ? t.chat.spoilerShown : t.chat.spoilerHidden}
      onClick={() => setRevealed((value) => !value)}
      className={cn(
        "rounded px-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
        revealed ? "bg-white/[.07] text-slate-200" : "cursor-pointer bg-slate-600/60 text-transparent blur-[4px] select-none hover:bg-slate-600/80",
      )}
    >
      <InlineNodes nodes={node.children} members={members} mentions={mentions} />
    </button>
  );
}

function CodeBlockView({ language, code }: { language: string | null; code: string }): React.ReactElement {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);
  const copy = useCallback(async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const area = document.createElement("textarea");
        area.value = code;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
    } catch {
      return;
    }
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1_500);
  }, [code]);
  return (
    <div className="my-1 min-w-0 overflow-hidden rounded-lg border border-white/[.07] bg-black/30">
      <div className="flex items-center justify-between gap-2 border-b border-white/[.06] bg-white/[.03] px-3 py-1.5">
        <span className="min-w-0 truncate font-mono text-[11px] text-slate-400">{language ?? t.chat.codePlain}</span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={t.chat.codeCopy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-white/[.06] hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
        >
          {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
          {copied ? t.chat.codeCopied : t.chat.codeCopy}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-5 text-slate-200">
        <code>{code || " "}</code>
      </pre>
    </div>
  );
}

function MemberPill({ userId, mentioned, members }: { userId: string; mentioned: boolean; members: MockMember[] }): React.ReactElement {
  const { t } = useI18n();
  const member = members.find((candidate) => candidate.id === userId);
  if (!mentioned || !member) return <span className={MENTION_PILL_CLASS}>@{t.chat.unknownUser}</span>;
  return (
    <ProfilePreview
      side="right"
      wrapperClassName="inline-flex align-middle"
      triggerClassName="inline-flex h-[18px] items-center rounded-[4px] bg-blue-500/18 px-1 text-[12px] font-medium leading-none text-blue-200 transition hover:bg-blue-500/28 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60"
      profile={{
        username: member.username,
        discriminator: member.discriminator,
        fingerprint: member.fingerprint,
        avatar: member.avatar,
        banner: member.banner,
        accentColor: member.accentColor,
        nameGlow: member.nameGlow,
        nameFont: member.nameFont,
        color: member.avatarColor,
        status: member.status,
        customStatus: member.customStatus,
        customStatusEmoji: member.customStatusEmoji,
        role: member.role,
        bio: member.bio,
      }}
      label={t.chat.mentionAria(member.username)}
    >
      <span style={nicknameStyle(member.nameFont, member.nameGlow)}>@{member.username}</span>
    </ProfilePreview>
  );
}

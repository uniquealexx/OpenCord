"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Link2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { extractMessageUrls, fetchLinkPreviewTitle, getLinkDomain, isDirectImageUrl } from "@/lib/link-preview";
import { cn } from "@/lib/utils";

export function LinkPreviews({ content, enabled = true }: { content: string; enabled?: boolean }): React.ReactElement | null {
  const { t } = useI18n();
  const urls = useMemo(() => (enabled ? extractMessageUrls(content) : []), [content, enabled]);
  const [collapsed, setCollapsed] = useState(false);
  if (urls.length === 0) return null;
  return (
    <div className="mt-1.5 min-w-0 space-y-1.5">
      <button
        type="button"
        aria-expanded={!collapsed}
        aria-label={collapsed ? t.chat.linkPreviewShow : t.chat.linkPreviewHide}
        onClick={() => setCollapsed((value) => !value)}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-medium text-slate-500 transition hover:bg-white/[.06] hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
      >
        <ChevronDown className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")} />
        {collapsed ? t.chat.linkPreviewShow : t.chat.linkPreviewHide}
      </button>
      {!collapsed && urls.map((url) => <LinkCard key={url} url={url} />)}
    </div>
  );
}

function LinkCard({ url }: { url: string }): React.ReactElement | null {
  const { t } = useI18n();
  const domain = getLinkDomain(url);
  const image = isDirectImageUrl(url);
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (image) return;
    let cancelled = false;
    void fetchLinkPreviewTitle(url).then((fetched) => {
      if (!cancelled && fetched) setTitle(fetched);
    });
    return () => {
      cancelled = true;
    };
  }, [url, image]);
  if (!domain) return null;
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-white/[.07] bg-white/[.02]">
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- remote user-supplied URL: next/image optimizer cannot handle it in a static file:// export
        <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="max-h-64 w-full bg-black/20 object-cover" />
      )}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        aria-label={`${t.chat.linkPreviewOpen}: ${domain}`}
        className="flex min-w-0 items-center gap-2.5 px-3 py-2 transition hover:bg-white/[.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/60"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/[.05] text-slate-400">
          <Link2 className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-slate-200">{title ?? url}</span>
          <span className="block truncate text-[11px] text-slate-500">{domain}</span>
        </span>
      </a>
    </div>
  );
}

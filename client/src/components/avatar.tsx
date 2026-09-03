import { cn, initials } from "@/lib/utils";
import type { PublicMemberStatus } from "@opencord/shared";

export function Avatar({ name, image, color = "#4d6bfe", size = "md", status, className }: { name: string; image?: string | null; color?: string; size?: "sm" | "md" | "lg" | "xl"; status?: PublicMemberStatus; className?: string }): React.ReactElement {
  const sizes = { sm: "size-7 text-[10px]", md: "size-9 text-xs", lg: "size-12 text-sm", xl: "size-20 text-xl" };
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center overflow-visible rounded-full font-bold text-white", sizes[size], className)} style={{ backgroundColor: color }} aria-label={name}>
      {/* User-selected data URLs are local and intentionally bypass Next image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? <img src={image} alt="" className="absolute inset-0 size-full rounded-full object-cover" /> : initials(name)}
      {status && <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-canvas", status === "online" && "bg-emerald-400", status === "idle" && "bg-amber-400", status === "dnd" && "bg-red-400", status === "offline" && "bg-slate-600")} />}
    </span>
  );
}

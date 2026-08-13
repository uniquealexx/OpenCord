import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  return <textarea className={cn("min-h-24 w-full resize-none rounded-lg border border-white/10 bg-white/[.04] px-3.5 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/80 focus:bg-white/[.06] focus:ring-2 focus:ring-violet-500/20", className)} {...props} />;
}

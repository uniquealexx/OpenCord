import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return <input className={cn("h-11 w-full rounded-lg border border-white/10 bg-white/[.04] px-3.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-violet-400/80 focus:bg-white/[.06] focus:ring-2 focus:ring-violet-500/20", className)} {...props} />;
}

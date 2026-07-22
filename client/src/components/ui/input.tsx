import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return <input className={cn("h-11 w-full rounded-xl border border-white/8 bg-black/20 px-3.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-violet-400/70 focus:ring-2 focus:ring-violet-500/15", className)} {...props} />;
}

"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>): React.ReactElement {
  return (
    <SwitchPrimitive.Root className={cn("group inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent bg-white/15 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 data-[state=checked]:border-transparent data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:data-[state=checked]:bg-white/15", className)} {...props}>
            {/* Бегунок всегда белый: трек в светлой теме светлый, --color-white там инвертирован. */}
      <SwitchPrimitive.Thumb className="pointer-events-none block size-5 rounded-full bg-[#fff] shadow-[0_1px_2px_rgba(0,0,0,.4)] transition-transform translate-x-0.5 data-[state=checked]:translate-x-[22px] group-disabled:opacity-60" />
    </SwitchPrimitive.Root>
  );
}

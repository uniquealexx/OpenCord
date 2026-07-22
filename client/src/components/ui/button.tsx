import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all outline-none disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-violet-400/70",
  {
    variants: {
      variant: {
        default: "bg-violet-500 text-white shadow-[0_8px_24px_rgba(124,92,255,.22)] hover:bg-violet-400",
        secondary: "bg-white/7 text-slate-100 hover:bg-white/11",
        ghost: "text-slate-400 hover:bg-white/7 hover:text-white",
        danger: "bg-red-500/14 text-red-300 hover:bg-red-500/22",
      },
      size: { default: "h-10 px-4", sm: "h-8 rounded-lg px-3 text-xs", icon: "size-10 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps): React.ReactElement {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

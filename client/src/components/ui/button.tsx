import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors outline-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-violet-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
  {
    variants: {
      variant: {
        default: "bg-primary text-white shadow-[0_1px_3px_rgba(0,0,0,.4)] hover:bg-violet-400",
        secondary: "bg-white/[.06] text-slate-100 ring-1 ring-inset ring-white/10 hover:bg-white/10",
        ghost: "text-slate-400 hover:bg-white/[.06] hover:text-white",
        danger: "bg-red-500/12 text-red-300 ring-1 ring-inset ring-red-400/20 hover:bg-red-500/20",
      },
      size: { default: "h-10 px-4", sm: "h-8 rounded-md px-3 text-xs", icon: "size-10 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps): React.ReactElement {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn("rounded-[6px] border border-line bg-bg3 px-[7px] py-[3px] font-mono text-[12px] tabular-nums", className)}
      {...rest}
    />
  );
}

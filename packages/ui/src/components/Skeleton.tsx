import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface SkeletonProps extends HTMLAttributes<HTMLSpanElement> {
  inline?: boolean;
  width?: number | string;
  height?: number | string;
}

/** Pulsing --bg3 block. No spinner anywhere in the product. */
export function Skeleton({ inline, width, height, className, style, ...rest }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(inline ? "inline-block align-middle" : "block", "rounded-[6px] bg-bg3 animate-pulse motion-reduce:animate-none", className)}
      style={{ width, height: height ?? (inline ? "1em" : 16), ...style }}
      {...rest}
    />
  );
}

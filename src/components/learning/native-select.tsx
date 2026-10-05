import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A native <select> styled like `Input`. Native on purpose: it is the most reliable control on
 * phones and with assistive technology. The option rules keep the dropdown readable in dark mode.
 */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "border-input dark:bg-input/30 focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2 text-base outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm [&>option]:bg-popover [&>option]:text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

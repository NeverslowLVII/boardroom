import { cn } from "@/lib/utils";

/**
 * Fade overlay for truncated collapse previews.
 * `from` must match the opaque background of the parent container (e.g. "from-zinc-900").
 */
export function CollapseFade({
  from,
  className,
}: {
  from: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none relative h-8 bg-gradient-to-t to-transparent",
        from,
        className
      )}
    />
  );
}

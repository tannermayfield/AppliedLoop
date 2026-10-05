import { Skeleton } from "@/components/ui/skeleton";

/** Shown while Today loads: the header, then two card shapes. Respects reduced motion. */
export default function TodayLoading() {
  return (
    <div className="space-y-6" aria-busy="true" role="status" aria-label="Loading Today">
      <div className="space-y-2">
        <Skeleton className="h-9 w-72 max-w-full motion-reduce:animate-none" />
        <Skeleton className="h-5 w-80 max-w-full motion-reduce:animate-none" />
      </div>
      <Skeleton className="h-40 w-full rounded-2xl motion-reduce:animate-none" />
      <Skeleton className="h-40 w-full rounded-2xl motion-reduce:animate-none" />
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for the calendar: header, the month navigation, then the grid. */
export default function CalendarLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-8 w-56 rounded-md" />
          <Skeleton className="h-9.5 w-36 rounded-lg" />
        </div>
        <Skeleton className="h-96 rounded-xl sm:h-[36rem]" />
      </div>
    </div>
  );
}

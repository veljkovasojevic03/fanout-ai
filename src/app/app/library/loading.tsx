import { LibraryListSkeleton } from "@/components/library/library-list";
import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for the library: header, the filter row, then the list. */
export default function LibraryLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row">
          <Skeleton className="h-9.5 rounded-md lg:flex-1" />
          <Skeleton className="h-9.5 rounded-md lg:w-44" />
          <Skeleton className="h-9.5 rounded-md lg:w-48" />
        </div>
        <LibraryListSkeleton />
      </div>
    </div>
  );
}

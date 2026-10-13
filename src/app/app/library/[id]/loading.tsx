import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton shaped like the editor: toolbar, title and tags, refine bar, two panes. */
export default function ContentLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-64 max-w-[60%]" />
      </div>
      <Skeleton className="h-5 w-56" />
      <div className="grid gap-5 md:grid-cols-2">
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-16 rounded-md" />
      </div>
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-[28rem] rounded-md" />
        <Skeleton className="hidden h-[28rem] rounded-md lg:block" />
      </div>
    </div>
  );
}

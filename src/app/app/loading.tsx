import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton for pages inside the app shell, shaped like the dashboard. */
export default function AppLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-8 flex flex-col gap-3">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <Card key={card}>
            <CardContent className="flex flex-col gap-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-3 w-36" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-10 flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((card) => (
            <Skeleton key={card} className="h-32 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  );
}

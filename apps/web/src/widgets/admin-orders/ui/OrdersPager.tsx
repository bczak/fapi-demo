import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/shared/ui/button";

interface OrdersPagerProps {
  shown: number;
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
  /** False for a list too long to refresh by itself; `onRefresh` then starts over from the newest orders. */
  autoRefresh: boolean;
  onRefresh: () => void;
}

export function OrdersPager({
  shown,
  total,
  hasMore,
  isLoadingMore,
  loadMoreFailed,
  onLoadMore,
  autoRefresh,
  onRefresh,
}: OrdersPagerProps) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-muted-foreground text-sm">
        Showing {shown} of {total} orders
      </p>
      {!autoRefresh && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <p className="text-muted-foreground text-sm">
            Auto-refresh is paused for long lists. Refresh starts over from the newest orders.
          </p>
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw />
            Refresh
          </Button>
        </div>
      )}
      {loadMoreFailed && (
        <p className="text-destructive text-sm">Could not load more orders. Please try again.</p>
      )}
      {hasMore && (
        <Button variant="outline" disabled={isLoadingMore} onClick={onLoadMore}>
          {isLoadingMore && <LoaderCircle className="animate-spin" />}
          {isLoadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </div>
  );
}

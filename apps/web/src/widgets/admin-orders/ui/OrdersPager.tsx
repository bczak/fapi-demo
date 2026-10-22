import { LoaderCircle } from "lucide-react";
import { Button } from "@/shared/ui/button";

interface OrdersPagerProps {
  shown: number;
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreFailed: boolean;
  onLoadMore: () => void;
}

export function OrdersPager({
  shown,
  total,
  hasMore,
  isLoadingMore,
  loadMoreFailed,
  onLoadMore,
}: OrdersPagerProps) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-muted-foreground text-sm">
        Showing {shown} of {total} orders
      </p>
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

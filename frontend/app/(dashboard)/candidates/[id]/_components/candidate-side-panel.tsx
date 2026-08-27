"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CandidateDetail } from "./candidate-detail";

interface CandidateSidePanelProps {
  /** An application id, like every other candidate route. */
  candidateId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The candidate detail, in a slide-over instead of a page.
 *
 * It renders `CandidateDetail` — the same component the route does — rather
 * than its own copy. It used to be its own copy: about 1,300 lines
 * reimplementing the offer, interview, rejection and email panels, mounted
 * nowhere, and already drifted. Its "Send Email" button had no `onClick` at
 * all, so wiring the panel up as it stood would have shipped a form that did
 * nothing.
 *
 * Nothing is fetched while it is closed: `candidateId` is null until a row is
 * opened, and the component is not rendered at all until then.
 */
export function CandidateSidePanel({
  candidateId,
  open,
  onOpenChange,
}: CandidateSidePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 border-slate-200 p-0 dark:border-neutral-800 sm:max-w-none lg:w-[min(1100px,82vw)]"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Candidate</SheetTitle>
        </SheetHeader>
        {candidateId !== null && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <CandidateDetail
              candidateId={candidateId}
              onClose={() => onOpenChange(false)}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

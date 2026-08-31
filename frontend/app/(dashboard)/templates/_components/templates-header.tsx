"use client";

/**
 * Just the heading now.
 *
 * The button moved into the filters bar, where Create New Job and Add
 * Candidate live. It stays a component rather than being inlined because the
 * page composes it, and one fewer moving part in a change about consistency
 * is worth more than one fewer file.
 */
export function TemplatesHeader() {
  return (
    <div className="px-6 pt-4 pb-3 flex items-center justify-between">
      <h1 className="text-2xl font-medium text-slate-900 dark:text-neutral-100 leading-none">
        Templates
      </h1>
    </div>
  );
}

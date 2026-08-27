"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  useAttemptResults,
  useScoreWrittenAnswer,
} from "@/hooks/queries/use-assessments";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useIsManager } from "@/hooks/use-role";

export function AssessmentResultsSheetContent({
  attemptId,
}: {
  attemptId: number | null;
}) {
  const { data, isLoading, isError } = useAttemptResults(attemptId ?? 0, {
    enabled: attemptId !== null,
  });

  if (attemptId === null) return null;

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-20 bg-slate-50/50 dark:bg-neutral-950/30">
        <div className="size-6 border-2 border-slate-200 dark:border-neutral-700 border-t-[var(--theme-color)] rounded-full animate-spin mb-2" />
        <p className="text-sm font-medium text-slate-400 dark:text-neutral-500">
          Loading results…
        </p>
      </div>
    );
  }

  if (isError || !data?.data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-50/50 dark:bg-neutral-950/30">
        <p className="text-sm font-medium text-red-500">
          Failed to load assessment answers.
        </p>
      </div>
    );
  }

  const { attempt, questions } = data.data;

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-neutral-950/30 divide-y divide-slate-200 dark:divide-neutral-800">
      <div className="p-5 bg-white dark:bg-neutral-900 space-y-3">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-neutral-200">
            {attempt.assessmentTitle}
          </h4>
          {attempt.assessmentDescription && (
            <p className="text-xs text-slate-400 dark:text-neutral-500 mt-0.5">
              {attempt.assessmentDescription}
            </p>
          )}
        </div>
        <div className="pt-1">
          <span className="text-xs font-semibold text-slate-400 dark:text-neutral-500 uppercase tracking-wider">
            Candidate
          </span>
          <p className="text-sm font-bold text-slate-800 dark:text-neutral-200 mt-0.5">
            {attempt.candidateName}
          </p>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            {attempt.candidateEmail}
          </p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <h5 className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-wider mb-2">
          Questions &amp; Answers
        </h5>
        {questions.map((q, idx) => {
          return (
            <div
              key={q.id}
              className="bg-white dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 rounded-xl p-4 space-y-3"
            >
              <div className="space-y-0.5">
                <span className="text-xs font-semibold text-slate-400 dark:text-neutral-500 uppercase tracking-wider">
                  Question {idx + 1}
                </span>
                <h6 className="text-sm font-bold text-slate-800 dark:text-neutral-200 leading-snug">
                  {q.title}
                </h6>
                {q.description && (
                  <p className="text-xs text-slate-400 dark:text-neutral-500">
                    {q.description}
                  </p>
                )}
              </div>

              {q.questionType === "short_answer" ||
              q.questionType === "long_answer" ? (
                <div className="space-y-1 bg-slate-50 dark:bg-neutral-950 p-3 rounded-lg border border-slate-100 dark:border-neutral-800/60">
                  <span className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-wide">
                    Candidate Response
                  </span>
                  <p className="text-xs text-slate-700 dark:text-neutral-300 leading-relaxed whitespace-pre-line">
                    {q.answer?.answerText || (
                      <span className="text-slate-400 dark:text-neutral-500 italic">
                        No answer submitted
                      </span>
                    )}
                  </p>
                  {q.answer && (
                    <WrittenAnswerScore
                      attemptId={attemptId}
                      answerId={q.answer.id}
                      pointsEarned={q.answer.pointsEarned}
                      maxPoints={q.points}
                    />
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <span className="text-xs font-bold text-slate-400 dark:text-neutral-500 uppercase tracking-wide block mb-1">
                    Options
                  </span>
                  <div className="grid gap-2">
                    {q.options.map((opt) => {
                      const isSelected =
                        q.answer?.selectedOptionIds?.includes(opt.id) ?? false;
                      const isCorrect = opt.isCorrect;

                      let borderClass =
                        "border-slate-100 dark:border-neutral-800/60";
                      let bgClass = "bg-slate-50/50 dark:bg-neutral-950/20";
                      let badge = null;

                      if (isCorrect) {
                        borderClass =
                          "border-emerald-200 dark:border-emerald-800";
                        bgClass = "bg-emerald-50/30 dark:bg-emerald-950/10";
                      }

                      if (isSelected) {
                        if (isCorrect) {
                          badge = (
                            <span className="text-xs font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 px-2 py-0.5 rounded uppercase tracking-wide">
                              Correct Choice
                            </span>
                          );
                        } else {
                          borderClass = "border-rose-200 dark:border-rose-800";
                          bgClass = "bg-rose-50/20 dark:bg-rose-950/10";
                          badge = (
                            <span className="text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400 px-2 py-0.5 rounded uppercase tracking-wide">
                              Incorrect Choice
                            </span>
                          );
                        }
                      } else if (isCorrect) {
                        badge = (
                          <span className="text-xs font-bold bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-neutral-400 px-2 py-0.5 rounded uppercase tracking-wide">
                            Correct Answer
                          </span>
                        );
                      }

                      return (
                        <div
                          key={opt.id}
                          className={`flex items-center justify-between gap-3 border px-3 py-2 rounded-lg ${borderClass} ${bgClass}`}
                        >
                          <span className="text-xs font-medium text-slate-700 dark:text-neutral-300">
                            {opt.label}
                          </span>
                          {badge}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The mark a reviewer gives a written answer.
 *
 * Nothing can grade prose automatically, so these score 0 while still counting
 * toward the assessment's total — which meant a candidate who answered
 * perfectly still read as having failed that part, and the builder's promise
 * that written questions are "reviewed manually by the hiring team" had
 * nothing behind it.
 *
 * Read-only for anyone who is not a manager: a client contact sees the result
 * rather than deciding it.
 */
function WrittenAnswerScore({
  attemptId,
  answerId,
  pointsEarned,
  maxPoints,
}: {
  attemptId: number;
  answerId: number;
  pointsEarned: number | null;
  maxPoints: number;
}) {
  const isManager = useIsManager();
  const score = useScoreWrittenAnswer(attemptId);
  const [value, setValue] = useState(
    pointsEarned === null ? "" : String(pointsEarned),
  );

  if (!isManager) {
    return (
      <p className="pt-2 text-xs font-medium text-slate-500 dark:text-neutral-400">
        {pointsEarned === null
          ? "Not yet reviewed"
          : `Scored ${pointsEarned} of ${maxPoints}`}
      </p>
    );
  }

  const save = async () => {
    const points = Number(value);
    if (value.trim() === "" || Number.isNaN(points)) {
      return toast.warning("Enter a mark for this answer.");
    }
    if (points < 0 || points > maxPoints) {
      return toast.warning(`This question is worth ${maxPoints} points.`);
    }
    try {
      await score.mutateAsync({ answerId, pointsEarned: points });
      toast.success("Answer scored");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not score the answer");
    }
  };

  return (
    <div className="flex items-center gap-2 pt-2">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-neutral-500">
        Score
      </span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        aria-label="Points for this answer"
        className="h-8 w-20 border-slate-200 bg-white text-xs shadow-none dark:border-neutral-700 dark:bg-neutral-900"
      />
      <span className="text-xs text-slate-400 dark:text-neutral-500">
        of {maxPoints}
      </span>
      <Button
        type="button"
        onClick={() => void save()}
        disabled={score.isPending}
        className="h-8 rounded-md border-none bg-[var(--theme-color)] px-3 text-xs font-semibold text-white shadow-none hover:bg-[var(--theme-color-hover)]"
      >
        {score.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

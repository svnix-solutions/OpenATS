export type { QuestionType } from "@/types";
import type { QuestionType } from "@/types";

export interface Option {
  id: number;
  label: string;
  position: number;
}

export interface Question {
  id: number;
  title: string;
  description: string | null;
  questionType: QuestionType;
  position: number;
  points: number;
  options: Option[];
}

export interface AttemptData {
  id: number;
  status: "pending" | "started" | "completed";
  expiresAt: string;
  startedAt: string | null;
  completedAt: string | null;
  assessment: {
    id: number;
    title: string;
    description: string | null;
    timeLimit: number;
    questions: Question[];
  };
  candidate: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
  };
}

export type Answer = { answerText?: string; optionIds?: number[] };

export type Screen =
  | "loading"
  | "error"
  | "expired"
  | "already_completed"
  | "intro"
  | "quiz"
  | "submitted";

export interface ScoreResult {
  passed: boolean;
  scorePercentage: number;
}

/**
 * `assessment.timeLimit` is stored and entered in **minutes** — the dashboard
 * creates it with a default of 120 and renders it as `{timeLimit}m`.
 *
 * Both candidate-facing uses previously treated it as seconds: the intro
 * screen divided by 60, and the countdown seeded itself with it directly. A
 * 120-minute assessment therefore announced "2 minutes" and expired after 120
 * seconds. These two helpers exist so the unit is stated once.
 */
export function timeLimitMinutes(attempt: AttemptData): number {
  return attempt.assessment.timeLimit ?? 0;
}

export function timeLimitSeconds(attempt: AttemptData): number {
  return timeLimitMinutes(attempt) * 60;
}

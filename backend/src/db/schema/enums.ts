import { pgEnum } from "drizzle-orm/pg-core";

export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "internship",
  "freelance",
]);

export const salaryType = pgEnum("salary_type", ["range", "fixed"]);

export const payFrequency = pgEnum("pay_frequency", [
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "yearly",
]);

export const jobStatus = pgEnum("job_status", [
  "draft",
  "inactive",
  "published",
  "closed",
  "archived",
]);

export const stageType = pgEnum("stage_type", [
  "screening",
  "interview",
  "offer",
]);

export const offerMode = pgEnum("offer_mode", ["auto_draft", "auto_send"]);

export const offerStatus = pgEnum("offer_status", [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
]);

export const candidateActivityType = pgEnum("candidate_activity_type", [
  "offer_created",
  "offer_updated",
  "offer_sent",
  "offer_viewed",
  "offer_accepted",
  "offer_declined",
  "candidate_hired",
]);

export const rejectionEmailStatus = pgEnum("rejection_email_status", [
  "not_sent",
  "draft",
  "sent",
]);

export const interviewOutcome = pgEnum("interview_outcome", [
  "pending",
  "pass",
  "fail",
]);

export const candidateStatus = pgEnum("candidate_status", [
  "active",
  "rejected",
  "offered",
  "hired",
  "withdrawn",
]);

export const questionType = pgEnum("question_type", [
  "short_answer",
  "long_answer",
  "checkbox",
  "radio",
  "multiple_choice",
]);

export const templateType = pgEnum("template_type", ["email", "event"]);

export const assessmentStatus = pgEnum("assessment_status", [
  "pending",
  "started",
  "completed",
  "expired",
]);

export const cvAnalysisStatus = pgEnum("cv_analysis_status", [
  "pending",
  "done",
  "failed",
]);

export const meetingProvider = pgEnum("meeting_provider", ["google_meet"]);

// Channels a candidate can be messaged on, beyond email. Deliberately not
// folded into `meeting_provider`: a meeting provider is asked to create a
// meeting, a channel is asked to carry a conversation, and the two share no
// operations at all.
// How a bulk candidate import is getting on. `failed` is the run itself
// falling over, not rows being rejected — a file where every row is invalid
// still finishes `done`, with a report saying so.
export const importStatus = pgEnum("import_status", [
  "queued",
  "running",
  "done",
  "failed",
]);

export const messagingChannel = pgEnum("messaging_channel", [
  "whatsapp",
  "telegram",
]);

export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);

// `queued` and `failed` are distinct: a send that never left is something to
// retry, one the provider refused is something to show a person.
export const messageDelivery = pgEnum("message_delivery", [
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
]);

// Roles within an organization. The first four are agency staff; the last two
// are client contacts, confined to their own client company. `platform_admin`
// is deliberately absent: it is not a membership, it is the absence of one.
export const orgRole = pgEnum("org_role", [
  "super_admin",
  "hiring_manager",
  "interviewer",
  "client_admin",
  "client_reviewer",
]);

// Who a chat message is for. Agency staff discuss candidates candidly on the
// assumption the client is not reading; a client contact sees only what was
// deliberately shared with them.
export const messageVisibility = pgEnum("message_visibility", [
  "internal",
  "shared",
]);

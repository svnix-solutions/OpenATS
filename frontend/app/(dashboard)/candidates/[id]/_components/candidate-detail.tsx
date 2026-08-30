"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon, QuestionIcon } from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";

import {
  useCandidate,
  useDeleteCandidate,
  useMoveCandidateStage,
  useUpdateCandidateBasicDetails,
} from "@/hooks/queries/use-candidates";
import { usePipeline } from "@/hooks/queries/use-pipeline";
import { useCandidateAssessments } from "@/hooks/queries/use-assessments";
import {
  useRejectCandidate,
  useUnrejectCandidate,
} from "@/hooks/queries/use-candidates";
import { useDeleteInterview } from "@/hooks/queries/use-interviews";
import { useTemplates } from "@/hooks/queries/use-templates";
import { InterviewSchedulerDialog } from "@/app/(dashboard)/interviews/_components/interview-scheduler-dialog";

import {
  type SectionId,
  OFFER_STATUS_STYLES,
  sectionsFor,
  canSeeSection,
} from "./constants";
import { CandidateHeader } from "./candidate-header";
import { SectionTabs } from "./section-tabs";
import { useCurrentUser } from "@/hooks/queries/use-user";
import { CvSheet } from "./cv-sheet";
import { AssessmentSheet } from "./assessment-sheet";
import { JobFitSection } from "./sections/job-fit-section";
import { AnswersSection } from "./sections/answer-section";
import { HistorySection } from "./sections/history-section";
import { OfferSection } from "./sections/offer-section";
import { InterviewsSection } from "./sections/inerviews-section";
import { RejectionSection } from "./sections/rejection-section";
import { EmailSection } from "./sections/email-section";
import { MessagesSection } from "./sections/messages-section";
import { ScoresSection } from "./sections/scores-section";
import { EditCandidateDialog } from "./dialogs/edit-candidate-dialog";
import { CandidateDeleteDialog } from "../../_components/candidate-delete-dialog";
import { RejectCandidateDialog } from "./dialogs/reject-candidate-dialog";
import { useIsManager } from "@/hooks/use-role";
import { isClientRole } from "@/lib/roles";

export interface CandidateDetailProps {
  /** An application id — what every candidate route and this page take. */
  candidateId: number;
  /**
   * What "close" means. The page navigates back to where the viewer came
   * from; the side panel just shuts. Left undefined the page behaviour is
   * used, which is what a full-page route wants.
   */
  onClose?: () => void;
}

/**
 * The candidate detail view: header, tabs, sections and every dialog they
 * open.
 *
 * Extracted from the page so the side panel can render the same thing. It
 * used to have its own copy of all of it — offer editing, interviews,
 * rejection, an email form — about 1,300 lines that had already drifted: the
 * copy still carried a Send Email button with no handler at all, months after
 * the page's version was wired up. One implementation, two frames.
 */
export function CandidateDetail({
  candidateId,
  onClose: onCloseOverride,
}: CandidateDetailProps) {
  const router = useRouter();
  const isManager = useIsManager();
  const { data: meData } = useCurrentUser();
  const clientRole = meData?.data?.role;
  const isClient = isClientRole(clientRole);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get("from");

  const { data: candidateData, isLoading } = useCandidate(candidateId, {
    enabled: !isNaN(candidateId),
  });
  const candidate = candidateData?.data;

  const { data: pipelineData } = usePipeline(candidate?.jobId ?? 0);
  const { data: assessmentsData } = useCandidateAssessments(candidateId);

  const stageMap = useMemo(
    () =>
      Object.fromEntries(
        (pipelineData?.data ?? []).map((s) => [s.id, s.name]),
      ),
    [pipelineData],
  );

  const deleteMutation = useDeleteCandidate();
  const updateMutation = useUpdateCandidateBasicDetails();

  // Not a fixed "job-fit": that section is hidden from a client contact, so
  // they landed on a panel whose tab was not in the bar. The default is the
  // first section this viewer can actually open.
  const [activeSection, setActiveSection] = useState<SectionId | null>(null);

  // The section actually rendered. A client contact who has not chosen one
  // gets the first they may open, and a section they may not open never
  // renders even if it somehow became active — the tab bar hiding a tab is
  // not the same as the panel refusing to draw.
  const visibleSections = sectionsFor(isClient);
  const shownSection: SectionId =
    activeSection && canSeeSection(activeSection, isClient)
      ? activeSection
      : (visibleSections[0]?.id ?? "answers");
  const [deleteTarget, setDeleteTarget] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editResumeFile, setEditResumeFile] = useState<File | null>(null);

  const [selectedStageId, setSelectedStageId] = useState("");
  const [isCvExpanded, setIsCvExpanded] = useState(false);
  const [viewAttemptId, setViewAttemptId] = useState<number | null>(null);

  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const rejectMutation = useRejectCandidate();
  const unrejectMutation = useUnrejectCandidate();
  const { data: templatesData } = useTemplates();
  const allTemplates = templatesData?.data ?? [];
  const emailTemplates = allTemplates.filter((t) => t.type === "email");

  const [showSchedulerDialog, setShowSchedulerDialog] = useState(false);
  const deleteInterviewMutation = useDeleteInterview();
  const moveStageMutation = useMoveCandidateStage();

  const pipelineStages = useMemo(
    () =>
      [...(pipelineData?.data ?? [])].sort((a, b) => a.position - b.position),
    [pipelineData],
  );

  const currentStageId = candidate?.currentStageId
    ? String(candidate.currentStageId)
    : "";
  const effectiveSelectedStageId = selectedStageId || currentStageId;
  const hasStageChange =
    !!candidate &&
    !!effectiveSelectedStageId &&
    Number(effectiveSelectedStageId) !== candidate.currentStageId;

  const openEditDialog = () => {
    if (!candidate) return;
    setEditFirstName(candidate.firstName);
    setEditLastName(candidate.lastName);
    setEditEmail(candidate.email ?? "");
    setEditPhone(candidate.phone ?? "");
    setEditResumeFile(null);
    setEditOpen(true);
  };

  const confirmDelete = () => {
    if (!candidate) return;
    deleteMutation.mutate(candidate.id, {
      onSuccess: () => router.push("/candidates"),
    });
  };

  const confirmUpdate = () => {
    if (!candidate) return;
    const formData = new FormData();
    formData.append("firstName", editFirstName.trim());
    formData.append("lastName", editLastName.trim());
    formData.append("email", editEmail.trim());
    formData.append("phone", editPhone.trim());
    if (editResumeFile) formData.append("resume", editResumeFile);

    updateMutation.mutate(
      { id: candidate.id, formData },
      {
        onSuccess: () => {
          setEditOpen(false);
          setEditResumeFile(null);
        },
      },
    );
  };

  const saveStageChange = () => {
    if (!candidate || !effectiveSelectedStageId || !hasStageChange) return;
    moveStageMutation.mutate(
      { id: candidate.id, newStageId: Number(effectiveSelectedStageId) },
      { onSuccess: () => setSelectedStageId("") },
    );
  };

  const handleClose = () => {
    if (onCloseOverride) {
      onCloseOverride();
      return;
    }
    const back =
      fromParam === "interviews"
        ? "/interviews"
        : fromParam === "pipeline" && isManager
          ? `/jobs/${candidate?.jobId}/pipeline`
          : "/candidates";
    router.push(back);
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-50/50 dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 border-[3px] border-slate-200 dark:border-neutral-700 border-t-[var(--theme-color)] rounded-full animate-spin" />
          <p className="text-slate-400 dark:text-neutral-500 text-sm font-medium">
            Loading candidate…
          </p>
        </div>
      </div>
    );
  }

  if (!candidate) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50/50 dark:bg-neutral-950">
        <div className="size-14 rounded-full bg-slate-100 dark:bg-neutral-800 flex items-center justify-center">
          <HugeiconsIcon
            icon={QuestionIcon}
            className="size-6 text-slate-400 dark:text-neutral-500"
          />
        </div>
        <p className="text-slate-500 dark:text-neutral-400 font-semibold text-sm">
          Candidate not found
        </p>
        <Button
          variant="outline"
          onClick={() => router.push("/candidates")}
          className="h-7 px-2.5 rounded-md border-slate-200 dark:border-neutral-700 text-slate-600 dark:text-neutral-400 font-medium"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4 mr-2" />
          Back to Candidates
        </Button>
      </div>
    );
  }

  const offer = candidate.offer;
  const cvAnalysis = candidate.cvAnalysis;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-neutral-950">
      <CandidateHeader
        candidate={candidate}
        offer={offer}
        pipelineStages={pipelineStages}
        selectedStageId={selectedStageId}
        effectiveSelectedStageId={effectiveSelectedStageId}
        hasStageChange={hasStageChange}
        moveStageMutation={moveStageMutation}
        onStageChange={setSelectedStageId}
        onCancelStageChange={() => setSelectedStageId("")}
        onSaveStageChange={saveStageChange}
        onViewCv={() => setIsCvExpanded(true)}
        onClose={handleClose}
        onEdit={openEditDialog}
        onDelete={() => setDeleteTarget(true)}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 py-5 sm:px-6">
          <main className="min-w-0">
            <SectionTabs
              isClient={isClient}
              activeSection={shownSection}
              onSectionChange={setActiveSection}
              cvAnalysis={cvAnalysis}
              hasOffer={!!offer}
              offerDotColor={
                offer
                  ? (OFFER_STATUS_STYLES[offer.status]?.dot ?? "bg-slate-400")
                  : undefined
              }
            />

            <div className="rounded-md border border-slate-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
              {shownSection === "job-fit" && (
                <JobFitSection
                  resumeUrl={candidate.resumeUrl}
                  cvAnalysis={cvAnalysis}
                />
              )}
              {shownSection === "answers" && (
                <AnswersSection candidate={candidate} />
              )}
              {shownSection === "history" && (
                <HistorySection candidate={candidate} stageMap={stageMap} />
              )}
              {shownSection === "offer" && (
                <OfferSection
                  candidate={candidate}
                  candidateId={candidateId}
                  offer={offer}
                  pipelineStages={pipelineStages}
                  emailTemplates={emailTemplates}
                  jobId={candidate.jobId}
                />
              )}
              {shownSection === "interviews" && (
                <InterviewsSection
                  candidate={candidate}
                  stageMap={stageMap}
                  deleteInterviewMutation={deleteInterviewMutation}
                  onSchedule={() => setShowSchedulerDialog(true)}
                />
              )}
              {shownSection === "rejection" && (
                <RejectionSection
                  candidate={candidate}
                  candidateId={candidateId}
                  unrejectMutation={unrejectMutation}
                  onReject={() => setIsRejectDialogOpen(true)}
                />
              )}
              {shownSection === "email" && (
                <EmailSection candidate={candidate} />
              )}
              {shownSection === "messages" && (
                // The application id, which is what this page is addressed by.
                // The API translates it to the person the conversation hangs
                // off — someone who applied twice has one thread, not two.
                <MessagesSection applicationId={Number(candidate.id)} />
              )}
              {shownSection === "scores" && (
                <ScoresSection
                  assessmentsData={assessmentsData}
                  onViewAttempt={setViewAttemptId}
                />
              )}
            </div>
          </main>
        </div>
      </div>

      <CvSheet
        open={isCvExpanded}
        onOpenChange={setIsCvExpanded}
        candidate={candidate}
      />

      <EditCandidateDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        candidate={candidate}
        firstName={editFirstName}
        onFirstNameChange={setEditFirstName}
        lastName={editLastName}
        onLastNameChange={setEditLastName}
        email={editEmail}
        onEmailChange={setEditEmail}
        phone={editPhone}
        onPhoneChange={setEditPhone}
        resumeFile={editResumeFile}
        onResumeFileChange={setEditResumeFile}
        onSave={confirmUpdate}
        isPending={updateMutation.isPending}
      />

      <CandidateDeleteDialog
        candidate={candidate ?? null}
        isOpen={deleteTarget}
        onClose={() => setDeleteTarget(false)}
        onConfirm={confirmDelete}
        isPending={deleteMutation.isPending}
      />

      <RejectCandidateDialog
        open={isRejectDialogOpen}
        onOpenChange={setIsRejectDialogOpen}
        candidate={candidate}
        candidateId={candidateId}
        emailTemplates={emailTemplates}
        rejectMutation={rejectMutation}
      />

      <InterviewSchedulerDialog
        candidateId={candidateId}
        candidateName={`${candidate.firstName} ${candidate.lastName}`}
        open={showSchedulerDialog}
        onOpenChange={setShowSchedulerDialog}
        templates={allTemplates}
        pipelineStageId={candidate.currentStageId ?? 0}
        onSuccess={() => {
          queryClient.invalidateQueries({
            queryKey: ["candidates", candidateId],
          });
          queryClient.invalidateQueries({ queryKey: ["interviews"] });
        }}
      />

      <AssessmentSheet
        attemptId={viewAttemptId}
        onClose={() => setViewAttemptId(null)}
      />
    </div>
  );
}

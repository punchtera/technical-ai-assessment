-- CreateEnum
CREATE TYPE "SourceChannel" AS ENUM ('PORTAL', 'EMAIL', 'CUSTOMER_SUCCESS', 'SALES', 'SUPPORT');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING_REVIEW', 'GROUPED');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "TriageRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposedAction" AS ENUM ('LINK_EXISTING', 'CREATE_GROUP', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('LINK_TO_GROUP', 'CREATE_GROUP', 'REJECT_SUGGESTION', 'REVERSE_MEMBERSHIP');

-- AlterTable
ALTER TABLE "embedding_spaces" ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "feature_requests" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL,
    "redacted_title" VARCHAR(200) NOT NULL,
    "redacted_description" TEXT NOT NULL,
    "redaction_summary" JSONB NOT NULL,
    "source_channel" "SourceChannel" NOT NULL DEFAULT 'PORTAL',
    "idempotency_key" VARCHAR(100),
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "processing_attempts" INTEGER NOT NULL DEFAULT 0,
    "processing_started_at" TIMESTAMPTZ(3),
    "processing_error" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "need_groups" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "need_statement" TEXT NOT NULL,
    "created_by" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "need_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_memberships" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "active_request_id" UUID,
    "approved_by" VARCHAR(100) NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decision_id" UUID NOT NULL,
    "reversed_by" VARCHAR(100),
    "reversed_at" TIMESTAMPTZ(3),
    "reversal_reason" VARCHAR(500),
    "reversal_decision_id" UUID,

    CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_runs" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "TriageRunStatus" NOT NULL DEFAULT 'RUNNING',
    "provider" VARCHAR(64) NOT NULL,
    "is_test_provider" BOOLEAN NOT NULL,
    "pipeline_version" VARCHAR(64) NOT NULL,
    "prompt_version" VARCHAR(64) NOT NULL,
    "extraction_model" VARCHAR(100),
    "assessment_model" VARCHAR(100),
    "embedding_model" VARCHAR(100),
    "extraction" JSONB,
    "extraction_checks" JSONB,
    "retrieval" JSONB,
    "candidate_refs" JSONB,
    "member_refs" JSONB,
    "assessment" JSONB,
    "assessment_checks" JSONB,
    "proposed_action" "ProposedAction",
    "proposed_group_id" UUID,
    "confidence" VARCHAR(16),
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rationale" TEXT,
    "suggestion_status" "SuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "error_code" VARCHAR(64),
    "error_stage" VARCHAR(32),
    "provider_calls" INTEGER NOT NULL DEFAULT 0,
    "usage" JSONB,
    "latency_ms" INTEGER,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "triage_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_decisions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "triage_run_id" UUID,
    "action" "DecisionAction" NOT NULL,
    "group_id" UUID,
    "matched_proposal" BOOLEAN,
    "actor" VARCHAR(100) NOT NULL,
    "note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supports" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "supporter_ref" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "request_id" UUID,
    "group_id" UUID,
    "type" VARCHAR(64) NOT NULL,
    "actor" VARCHAR(100) NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_embeddings" (
    "request_id" UUID NOT NULL,
    "embedding_space_id" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_embeddings_pkey" PRIMARY KEY ("request_id","embedding_space_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "feature_requests_idempotency_key_key" ON "feature_requests"("idempotency_key");

-- CreateIndex
CREATE INDEX "feature_requests_review_status_created_at_idx" ON "feature_requests"("review_status", "created_at");

-- CreateIndex
CREATE INDEX "feature_requests_processing_status_created_at_idx" ON "feature_requests"("processing_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_active_request_id_key" ON "group_memberships"("active_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_decision_id_key" ON "group_memberships"("decision_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_memberships_reversal_decision_id_key" ON "group_memberships"("reversal_decision_id");

-- CreateIndex
CREATE INDEX "group_memberships_group_id_status_idx" ON "group_memberships"("group_id", "status");

-- CreateIndex
CREATE INDEX "group_memberships_request_id_idx" ON "group_memberships"("request_id");

-- CreateIndex
CREATE INDEX "triage_runs_request_id_started_at_idx" ON "triage_runs"("request_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "triage_runs_request_id_attempt_key" ON "triage_runs"("request_id", "attempt");

-- CreateIndex
CREATE INDEX "review_decisions_request_id_created_at_idx" ON "review_decisions"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "supports_request_id_supporter_ref_key" ON "supports"("request_id", "supporter_ref");

-- CreateIndex
CREATE INDEX "audit_events_request_id_created_at_idx" ON "audit_events"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_group_id_created_at_idx" ON "audit_events"("group_id", "created_at");

-- CreateIndex
CREATE INDEX "request_embeddings_embedding_space_id_idx" ON "request_embeddings"("embedding_space_id");

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "need_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "review_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_reversal_decision_id_fkey" FOREIGN KEY ("reversal_decision_id") REFERENCES "review_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_runs" ADD CONSTRAINT "triage_runs_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_runs" ADD CONSTRAINT "triage_runs_proposed_group_id_fkey" FOREIGN KEY ("proposed_group_id") REFERENCES "need_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_triage_run_id_fkey" FOREIGN KEY ("triage_run_id") REFERENCES "triage_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "need_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supports" ADD CONSTRAINT "supports_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "need_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_embeddings" ADD CONSTRAINT "request_embeddings_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "feature_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_embeddings" ADD CONSTRAINT "request_embeddings_embedding_space_id_fkey" FOREIGN KEY ("embedding_space_id") REFERENCES "embedding_spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Custom (hand-written): Prisma cannot express CHECK constraints.
-- An ACTIVE membership must carry its request id in active_request_id (which is
-- UNIQUE, so a request has at most one active group); a REVERSED one must not.
ALTER TABLE "group_memberships"
  ADD CONSTRAINT "group_memberships_active_key_consistent"
  CHECK (
    ("status" = 'ACTIVE' AND "active_request_id" = "request_id")
    OR ("status" = 'REVERSED' AND "active_request_id" IS NULL AND "reversed_at" IS NOT NULL)
  );

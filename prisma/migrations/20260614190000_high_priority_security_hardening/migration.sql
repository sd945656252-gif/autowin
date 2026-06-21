-- Add explicit ownership to workflow runs so execution history can be isolated
-- even when a run is created without a workflow reference.
ALTER TABLE "WorkflowRun" ADD COLUMN "ownerId" TEXT;

UPDATE "WorkflowRun" AS wr
SET "ownerId" = w."ownerId"
FROM "Workflow" AS w
WHERE wr."workflowId" = w."id"
  AND w."ownerId" IS NOT NULL;

ALTER TABLE "WorkflowRun"
ADD CONSTRAINT "WorkflowRun_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "WorkflowRun_ownerId_idx" ON "WorkflowRun"("ownerId");

-- Keep existing enabled global text providers usable for ordinary users, but make
-- that access an explicit policy bit going forward.
ALTER TABLE "CustomApiConfig" ADD COLUMN "userAccessEnabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "CustomApiConfig"
SET "userAccessEnabled" = true
WHERE "ownerId" IS NULL
  AND "capability" = 'TEXT_GENERATOR'
  AND "isEnabled" = true;

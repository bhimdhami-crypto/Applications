-- CreateEnum
CREATE TYPE "BenefitKind" AS ENUM ('MEAL', 'GYM');

-- CreateEnum
CREATE TYPE "VoucherOccasion" AS ENUM ('BIRTHDAY', 'LONG_SERVICE', 'FESTIVE', 'RECOGNITION', 'WEDDING', 'NEW_BABY', 'OTHER');

-- CreateTable
CREATE TABLE "benefit_plan" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "kind" "BenefitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "description" TEXT,
    "company_share" DECIMAL(18,4) NOT NULL,
    "employee_share" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_as_cash" BOOLEAN NOT NULL DEFAULT false,
    "work_locations" "WorkLocation"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benefit_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "benefit_enrolment" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "kind" "BenefitKind" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "dietary_needs" TEXT,
    "branch" TEXT,
    "emergency_contact" TEXT,
    "status" "RequestStatus" NOT NULL,
    "stages" "ApprovalStage"[],
    "stage" "ApprovalStage",
    "approver_id" TEXT,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "benefit_enrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gift_voucher" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "occasion" "VoucherOccasion" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "partner" TEXT,
    "reason" TEXT,
    "tax_month" INTEGER,
    "status" "RequestStatus" NOT NULL,
    "stages" "ApprovalStage"[],
    "stage" "ApprovalStage",
    "approver_id" TEXT,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "created_by_id" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gift_voucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "benefit_plan_legal_entity_id_kind_name_key" ON "benefit_plan"("legal_entity_id", "kind", "name");

-- CreateIndex
CREATE INDEX "benefit_enrolment_employment_id_status_idx" ON "benefit_enrolment"("employment_id", "status");

-- CreateIndex
CREATE INDEX "benefit_enrolment_legal_entity_id_status_stage_idx" ON "benefit_enrolment"("legal_entity_id", "status", "stage");

-- CreateIndex
CREATE INDEX "gift_voucher_employment_id_status_idx" ON "gift_voucher"("employment_id", "status");

-- CreateIndex
CREATE INDEX "gift_voucher_legal_entity_id_status_stage_idx" ON "gift_voucher"("legal_entity_id", "status", "stage");

-- CreateIndex
CREATE INDEX "gift_voucher_approver_id_status_idx" ON "gift_voucher"("approver_id", "status");

-- AddForeignKey
ALTER TABLE "benefit_enrolment" ADD CONSTRAINT "benefit_enrolment_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "benefit_enrolment" ADD CONSTRAINT "benefit_enrolment_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "benefit_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_voucher" ADD CONSTRAINT "gift_voucher_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gift_voucher" ADD CONSTRAINT "gift_voucher_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "employment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "benefit_plan" ADD CONSTRAINT "benefit_plan_shares_check" CHECK ("company_share" >= 0 AND "employee_share" >= 0);
ALTER TABLE "gift_voucher" ADD CONSTRAINT "gift_voucher_value_check" CHECK ("value" > 0);
ALTER TABLE "benefit_enrolment" ADD CONSTRAINT "benefit_enrolment_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- CreateEnum
CREATE TYPE "ApprovalStage" AS ENUM ('MANAGER', 'HR', 'PAYROLL', 'FINANCE', 'COUNTRY_HEAD');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'CLOSED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoanKind" AS ENUM ('ADVANCE', 'LOAN', 'IOU');

-- CreateEnum
CREATE TYPE "LoanProduct" AS ENUM ('PERSONAL', 'EDUCATION', 'EMERGENCY', 'HOUSING', 'VEHICLE');

-- CreateTable
CREATE TABLE "loan" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "kind" "LoanKind" NOT NULL,
    "product" "LoanProduct",
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "interest_rate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "instalment" DECIMAL(18,4) NOT NULL,
    "recoverable" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "first_month" INTEGER,
    "purpose" TEXT NOT NULL,
    "guarantor" TEXT,
    "cost_centre" TEXT,
    "needed_on" DATE,
    "settle_by" DATE,
    "spent" DECIMAL(18,4),
    "cash_returned" DECIMAL(18,4),
    "receipt_document_id" TEXT,
    "settlement_submitted_at" TIMESTAMP(3),
    "settled_by_id" TEXT,
    "settled_at" TIMESTAMP(3),
    "status" "RequestStatus" NOT NULL,
    "stages" "ApprovalStage"[],
    "stage" "ApprovalStage",
    "approver_id" TEXT,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "rules_version" TEXT NOT NULL,
    "created_by_id" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayment" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "payslip_id" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "principal" DECIMAL(18,4) NOT NULL,
    "interest" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_repayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_employment_id_status_idx" ON "loan"("employment_id", "status");

-- CreateIndex
CREATE INDEX "loan_legal_entity_id_status_stage_idx" ON "loan"("legal_entity_id", "status", "stage");

-- CreateIndex
CREATE INDEX "loan_approver_id_status_idx" ON "loan"("approver_id", "status");

-- CreateIndex
CREATE INDEX "loan_repayment_loan_id_idx" ON "loan_repayment"("loan_id");

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan" ADD CONSTRAINT "loan_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "employment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment" ADD CONSTRAINT "loan_repayment_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "loan" ADD CONSTRAINT "loan_amounts_check" CHECK ("amount" > 0 AND "instalment" >= 0 AND "recoverable" >= 0 AND "months" BETWEEN 1 AND 120);
ALTER TABLE "loan_repayment" ADD CONSTRAINT "loan_repayment_amount_check" CHECK ("amount" > 0 AND "principal" >= 0 AND "interest" >= 0);

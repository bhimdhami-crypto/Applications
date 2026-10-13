-- CreateEnum
CREATE TYPE "ApprovalStage" AS ENUM ('MANAGER', 'HR', 'PAYROLL', 'FINANCE', 'COUNTRY_HEAD');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'CLOSED', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LoanKind" AS ENUM ('ADVANCE', 'LOAN', 'IOU');

-- CreateEnum
CREATE TYPE "LoanProduct" AS ENUM ('PERSONAL', 'EDUCATION', 'EMERGENCY', 'HOUSING', 'VEHICLE');

-- CreateEnum
CREATE TYPE "BenefitKind" AS ENUM ('MEAL', 'GYM');

-- CreateEnum
CREATE TYPE "VoucherOccasion" AS ENUM ('BIRTHDAY', 'LONG_SERVICE', 'FESTIVE', 'RECOGNITION', 'WEDDING', 'NEW_BABY', 'OTHER');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'FINANCE';

-- CreateTable
CREATE TABLE "Loan" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "kind" "LoanKind" NOT NULL,
    "product" "LoanProduct",
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 1,
    "interestRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "instalment" DECIMAL(14,2) NOT NULL,
    "recoverable" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "firstMonth" INTEGER,
    "purpose" TEXT NOT NULL,
    "guarantor" TEXT,
    "costCentre" TEXT,
    "neededOn" DATE,
    "settleBy" DATE,
    "spent" DECIMAL(14,2),
    "cashReturned" DECIMAL(14,2),
    "receiptDocumentId" TEXT,
    "settlementSubmittedAt" TIMESTAMP(3),
    "settledById" TEXT,
    "settledAt" TIMESTAMP(3),
    "status" "RequestStatus" NOT NULL,
    "stages" "ApprovalStage"[],
    "stage" "ApprovalStage",
    "approverId" TEXT,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanRepayment" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "payslipId" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "principal" DECIMAL(14,2) NOT NULL,
    "interest" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRepayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "BenefitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "description" TEXT,
    "companyShare" DECIMAL(14,2) NOT NULL,
    "employeeShare" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidAsCash" BOOLEAN NOT NULL DEFAULT false,
    "workLocations" "WorkLocation"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenefitEnrolment" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "BenefitKind" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "dietaryNeeds" TEXT,
    "branch" TEXT,
    "emergencyContact" TEXT,
    "status" "RequestStatus" NOT NULL,
    "stages" "ApprovalStage"[],
    "stage" "ApprovalStage",
    "approverId" TEXT,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BenefitEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftVoucher" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "occasion" "VoucherOccasion" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "partner" TEXT,
    "reason" TEXT,
    "taxMonth" INTEGER,
    "status" "RequestStatus" NOT NULL,
    "stages" "ApprovalStage"[],
    "stage" "ApprovalStage",
    "approverId" TEXT,
    "decisions" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Loan_employeeId_status_idx" ON "Loan"("employeeId", "status");

-- CreateIndex
CREATE INDEX "Loan_status_stage_idx" ON "Loan"("status", "stage");

-- CreateIndex
CREATE INDEX "LoanRepayment_loanId_idx" ON "LoanRepayment"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "BenefitPlan_companyId_kind_name_key" ON "BenefitPlan"("companyId", "kind", "name");

-- CreateIndex
CREATE INDEX "BenefitEnrolment_employeeId_status_idx" ON "BenefitEnrolment"("employeeId", "status");

-- CreateIndex
CREATE INDEX "BenefitEnrolment_status_stage_idx" ON "BenefitEnrolment"("status", "stage");

-- CreateIndex
CREATE INDEX "GiftVoucher_employeeId_status_idx" ON "GiftVoucher"("employeeId", "status");

-- CreateIndex
CREATE INDEX "GiftVoucher_status_stage_idx" ON "GiftVoucher"("status", "stage");

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanRepayment" ADD CONSTRAINT "LoanRepayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitPlan" ADD CONSTRAINT "BenefitPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitEnrolment" ADD CONSTRAINT "BenefitEnrolment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BenefitEnrolment" ADD CONSTRAINT "BenefitEnrolment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BenefitPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftVoucher" ADD CONSTRAINT "GiftVoucher_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


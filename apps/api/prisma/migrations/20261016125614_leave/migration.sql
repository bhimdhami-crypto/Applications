-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'FLOATING', 'FAMILY_CARE', 'COMPASSIONATE', 'STUDY', 'MATERNITY', 'PATERNITY', 'UNPAID');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'DECLINED', 'CANCELLED');

-- CreateTable
CREATE TABLE "leave_request" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "handover_to" TEXT,
    "contact_while_away" TEXT,
    "document_id" TEXT,
    "status" "LeaveStatus" NOT NULL,
    "approver_id" TEXT,
    "manager_by_id" TEXT,
    "manager_at" TIMESTAMP(3),
    "manager_note" TEXT,
    "hr_by_id" TEXT,
    "hr_at" TIMESTAMP(3),
    "hr_note" TEXT,
    "rules_version" TEXT NOT NULL,
    "created_by_id" TEXT,
    "cancelled_by_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_adjustment" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "type" "LeaveType" NOT NULL,
    "year" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_adjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holiday" (
    "id" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leave_request_employment_id_start_date_idx" ON "leave_request"("employment_id", "start_date");

-- CreateIndex
CREATE INDEX "leave_request_approver_id_status_idx" ON "leave_request"("approver_id", "status");

-- CreateIndex
CREATE INDEX "leave_request_legal_entity_id_status_start_date_idx" ON "leave_request"("legal_entity_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "leave_adjustment_employment_id_year_idx" ON "leave_adjustment"("employment_id", "year");

-- CreateIndex
CREATE UNIQUE INDEX "public_holiday_country_code_date_key" ON "public_holiday"("country_code", "date");

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "employment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_adjustment" ADD CONSTRAINT "leave_adjustment_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "leave_request" ADD CONSTRAINT "leave_request_dates_check" CHECK ("end_date" >= "start_date" AND "days" > 0);

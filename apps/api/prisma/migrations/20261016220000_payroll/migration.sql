-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'FINALIZED');

-- CreateTable
CREATE TABLE "payroll_run" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "rules_version" TEXT NOT NULL,
    "rules_verified" BOOLEAN NOT NULL DEFAULT false,
    "headcount" INTEGER NOT NULL DEFAULT 0,
    "total_gross" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_employer_cost" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "calculated_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "submitted_by_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "finalized_by_id" TEXT,
    "finalized_at" TIMESTAMP(3),
    "return_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "gross" DECIMAL(18,4) NOT NULL,
    "deductions" DECIMAL(18,4) NOT NULL,
    "net" DECIMAL(18,4) NOT NULL,
    "employer_cost" DECIMAL(18,4) NOT NULL,
    "lines" JSONB NOT NULL,
    "employee" JSONB NOT NULL,
    "annual_leave_left" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_run_legal_entity_id_status_idx" ON "payroll_run"("legal_entity_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_legal_entity_id_year_month_key" ON "payroll_run"("legal_entity_id", "year", "month");

-- CreateIndex
CREATE INDEX "payslip_employment_id_idx" ON "payslip"("employment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslip_run_id_employment_id_key" ON "payslip"("run_id", "employment_id");

-- AddForeignKey
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip" ADD CONSTRAINT "payslip_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Data rules the API also enforces
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_period_check" CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 2100);
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_checker_check" CHECK ("approved_by_id" IS NULL OR "submitted_by_id" IS NULL OR "approved_by_id" <> "submitted_by_id");

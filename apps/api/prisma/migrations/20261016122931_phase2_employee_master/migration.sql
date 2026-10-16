-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'FIXED_TERM', 'INTERN');

-- CreateEnum
CREATE TYPE "WorkLocation" AS ENUM ('ON_SITE', 'HYBRID', 'FULLY_REMOTE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'CLEARED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "job_grade" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL,

    CONSTRAINT "job_grade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "person_number" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "local_name" TEXT,
    "preferred_name" TEXT,
    "gender" TEXT,
    "date_of_birth" DATE,
    "nationality" CHAR(2),
    "marital_status" TEXT,
    "dependants" INTEGER NOT NULL DEFAULT 0,
    "personal_email" TEXT,
    "mobile_phone" TEXT,
    "highest_qualification" TEXT,
    "institution" TEXT,
    "qualification_year" INTEGER,
    "photo_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_contact" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "is_emergency_contact" BOOLEAN NOT NULL DEFAULT true,
    "is_beneficiary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_identifier" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "value_encrypted" TEXT NOT NULL,
    "value_last4" TEXT NOT NULL,
    "expiry_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_identifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment" (
    "id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "employee_number" TEXT NOT NULL,
    "user_id" TEXT,
    "work_email" TEXT,
    "employment_type" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
    "work_location" "WorkLocation" NOT NULL DEFAULT 'ON_SITE',
    "hire_date" DATE NOT NULL,
    "probation_end_date" DATE,
    "end_date" DATE,
    "exit_reason" TEXT,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT NOT NULL,
    "job_title" TEXT NOT NULL,
    "grade_id" TEXT,
    "business_unit_id" TEXT,
    "department_id" TEXT,
    "branch_id" TEXT,
    "cost_centre_id" TEXT,
    "manager_id" TEXT,
    "fte" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensation" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "currency" CHAR(3) NOT NULL,
    "pay_frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "base_amount" DECIMAL(18,4) NOT NULL,
    "allowances" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "branch_code" TEXT,
    "account_name" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_number_last4" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_document" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "issued_date" DATE,
    "expiry_date" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "hr_only" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" TEXT,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_request" (
    "id" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload_encrypted" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_grade_group_id_code_key" ON "job_grade"("group_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "person_person_number_key" ON "person"("person_number");

-- CreateIndex
CREATE INDEX "person_group_id_last_name_idx" ON "person"("group_id", "last_name");

-- CreateIndex
CREATE INDEX "person_contact_person_id_idx" ON "person_contact"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "person_identifier_person_id_kind_country_code_key" ON "person_identifier"("person_id", "kind", "country_code");

-- CreateIndex
CREATE UNIQUE INDEX "employment_employee_number_key" ON "employment"("employee_number");

-- CreateIndex
CREATE UNIQUE INDEX "employment_user_id_key" ON "employment"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "employment_work_email_key" ON "employment"("work_email");

-- CreateIndex
CREATE INDEX "employment_legal_entity_id_status_idx" ON "employment"("legal_entity_id", "status");

-- CreateIndex
CREATE INDEX "employment_person_id_idx" ON "employment"("person_id");

-- CreateIndex
CREATE INDEX "assignment_employment_id_effective_from_idx" ON "assignment"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "assignment_legal_entity_id_department_id_idx" ON "assignment"("legal_entity_id", "department_id");

-- CreateIndex
CREATE INDEX "assignment_manager_id_idx" ON "assignment"("manager_id");

-- CreateIndex
CREATE INDEX "compensation_employment_id_effective_from_idx" ON "compensation"("employment_id", "effective_from");

-- CreateIndex
CREATE INDEX "compensation_legal_entity_id_idx" ON "compensation"("legal_entity_id");

-- CreateIndex
CREATE INDEX "bank_account_employment_id_idx" ON "bank_account"("employment_id");

-- CreateIndex
CREATE INDEX "employee_document_employment_id_idx" ON "employee_document"("employment_id");

-- CreateIndex
CREATE INDEX "employee_document_legal_entity_id_status_idx" ON "employee_document"("legal_entity_id", "status");

-- CreateIndex
CREATE INDEX "change_request_legal_entity_id_status_idx" ON "change_request"("legal_entity_id", "status");

-- CreateIndex
CREATE INDEX "change_request_employment_id_idx" ON "change_request"("employment_id");

-- AddForeignKey
ALTER TABLE "job_grade" ADD CONSTRAINT "job_grade_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "org_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person" ADD CONSTRAINT "person_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "org_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_contact" ADD CONSTRAINT "person_contact_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_identifier" ADD CONSTRAINT "person_identifier_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_grade_id_fkey" FOREIGN KEY ("grade_id") REFERENCES "job_grade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_cost_centre_id_fkey" FOREIGN KEY ("cost_centre_id") REFERENCES "cost_centre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_manager_id_fkey" FOREIGN KEY ("manager_id") REFERENCES "employment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation" ADD CONSTRAINT "compensation_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_document" ADD CONSTRAINT "employee_document_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Effective dating: at most one open row per employment, and every closed row ends after it starts
CREATE UNIQUE INDEX "assignment_one_open" ON "assignment" ("employment_id") WHERE "effective_to" IS NULL;
CREATE UNIQUE INDEX "compensation_one_open" ON "compensation" ("employment_id") WHERE "effective_to" IS NULL;
CREATE UNIQUE INDEX "assignment_unique_start" ON "assignment" ("employment_id", "effective_from");
CREATE UNIQUE INDEX "compensation_unique_start" ON "compensation" ("employment_id", "effective_from");
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
ALTER TABLE "compensation" ADD CONSTRAINT "compensation_dates_check" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
ALTER TABLE "compensation" ADD CONSTRAINT "compensation_amounts_check" CHECK ("base_amount" >= 0 AND "allowances" >= 0);
ALTER TABLE "employment" ADD CONSTRAINT "employment_dates_check" CHECK ("end_date" IS NULL OR "end_date" >= "hire_date");

-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('GROUP_ADMIN', 'HR_ADMIN', 'HR', 'PAYROLL_OPERATOR', 'PAYROLL_APPROVER', 'FINANCE', 'TREASURY', 'AUDITOR', 'EXECUTIVE', 'MANAGER', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('GROUP', 'COUNTRY', 'LEGAL_ENTITY');

-- CreateTable
CREATE TABLE "currency" (
    "code" CHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "language" (
    "code" TEXT NOT NULL,
    "english_name" TEXT NOT NULL,
    "native_name" TEXT NOT NULL,
    "dir" TEXT NOT NULL DEFAULT 'ltr',
    "status" TEXT NOT NULL DEFAULT 'catalogue',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "language_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "country" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "currency_code" CHAR(3) NOT NULL,
    "languages" TEXT[],
    "time_zone" TEXT NOT NULL,
    "weekend_days" INTEGER[],
    "region" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "country_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "org_group" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reporting_currency" CHAR(3) NOT NULL,
    "default_language" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_entity" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "functional_currency" CHAR(3) NOT NULL,
    "registration_number" TEXT,
    "tax_number" TEXT,
    "address" TEXT,
    "time_zone" TEXT NOT NULL,
    "weekend_days" INTEGER[],
    "default_language" TEXT NOT NULL,
    "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1,
    "is_shared_service_centre" BOOLEAN NOT NULL DEFAULT false,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_entity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_unit" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "time_zone" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "business_unit_id" TEXT,
    "branch_id" TEXT,
    "parent_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centre" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "department_id" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gl_code" TEXT,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_centre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_feature" (
    "legal_entity_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_feature_pkey" PRIMARY KEY ("legal_entity_id","module")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "password_hash" TEXT,
    "preferred_language" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "scope_type" "ScopeType" NOT NULL,
    "country_code" CHAR(2),
    "legal_entity_id" TEXT,
    "granted_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_challenge" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_invite" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "group_id" TEXT,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "legal_entity_id" TEXT,
    "detail" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "org_group_code_key" ON "org_group"("code");

-- CreateIndex
CREATE INDEX "legal_entity_country_code_idx" ON "legal_entity"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "legal_entity_group_id_code_key" ON "legal_entity"("group_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "business_unit_legal_entity_id_code_key" ON "business_unit"("legal_entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "branch_legal_entity_id_code_key" ON "branch"("legal_entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "department_legal_entity_id_code_key" ON "department"("legal_entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centre_legal_entity_id_code_key" ON "cost_centre"("legal_entity_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "app_user_group_id_idx" ON "app_user"("group_id");

-- CreateIndex
CREATE INDEX "role_assignment_user_id_idx" ON "role_assignment"("user_id");

-- CreateIndex
CREATE INDEX "role_assignment_legal_entity_id_idx" ON "role_assignment"("legal_entity_id");

-- CreateIndex
CREATE INDEX "role_assignment_country_code_idx" ON "role_assignment"("country_code");

-- CreateIndex
CREATE INDEX "login_challenge_user_id_created_at_idx" ON "login_challenge"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "session_user_id_idx" ON "session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_session_id_idx" ON "refresh_token"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_invite_token_hash_key" ON "user_invite"("token_hash");

-- CreateIndex
CREATE INDEX "audit_log_group_id_created_at_idx" ON "audit_log"("group_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_legal_entity_id_created_at_idx" ON "audit_log"("legal_entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_created_at_idx" ON "audit_log"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "country" ADD CONSTRAINT "country_currency_code_fkey" FOREIGN KEY ("currency_code") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "org_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "country"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_functional_currency_fkey" FOREIGN KEY ("functional_currency") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit" ADD CONSTRAINT "business_unit_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_business_unit_id_fkey" FOREIGN KEY ("business_unit_id") REFERENCES "business_unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centre" ADD CONSTRAINT "cost_centre_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centre" ADD CONSTRAINT "cost_centre_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_feature" ADD CONSTRAINT "entity_feature_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "org_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_challenge" ADD CONSTRAINT "login_challenge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_invite" ADD CONSTRAINT "user_invite_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The audit log is append-only: block updates and deletes at the database level.
CREATE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- Users and role holders must exist once per role and scope
CREATE UNIQUE INDEX "role_assignment_unique_scope" ON "role_assignment" ("user_id", "role", "scope_type", COALESCE("country_code", ''), COALESCE("legal_entity_id", ''));

-- Scope columns must match the scope type
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_scope_check" CHECK (
  ("scope_type" = 'GROUP' AND "country_code" IS NULL AND "legal_entity_id" IS NULL) OR
  ("scope_type" = 'COUNTRY' AND "country_code" IS NOT NULL AND "legal_entity_id" IS NULL) OR
  ("scope_type" = 'LEGAL_ENTITY' AND "legal_entity_id" IS NOT NULL AND "country_code" IS NULL)
);

-- CreateEnum
CREATE TYPE "LibraryKind" AS ENUM ('POLICY', 'FORM');

-- CreateTable
CREATE TABLE "library_item" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "kind" "LibraryKind" NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "summary" TEXT,
    "owner" TEXT,
    "version" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "must_read" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_acknowledgement" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "employment_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_acknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "library_item_group_id_code_key" ON "library_item"("group_id", "code");

-- CreateIndex
CREATE INDEX "policy_acknowledgement_employment_id_idx" ON "policy_acknowledgement"("employment_id");

-- CreateIndex
CREATE UNIQUE INDEX "policy_acknowledgement_item_id_version_employment_id_key" ON "policy_acknowledgement"("item_id", "version", "employment_id");

-- AddForeignKey
ALTER TABLE "policy_acknowledgement" ADD CONSTRAINT "policy_acknowledgement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "library_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acknowledgement" ADD CONSTRAINT "policy_acknowledgement_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;


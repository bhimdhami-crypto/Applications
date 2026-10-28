-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PERMANENT', 'FIXED_TERM', 'INTERN');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'CLEARED', 'EXPIRED', 'REJECTED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "city" TEXT,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "dependants" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "employmentType" "EmploymentType" NOT NULL DEFAULT 'PERMANENT',
ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "highestQualification" TEXT,
ADD COLUMN     "institution" TEXT,
ADD COLUMN     "maritalStatus" TEXT,
ADD COLUMN     "mobilePhone" TEXT,
ADD COLUMN     "nationalIdNumber" TEXT,
ADD COLUMN     "personalEmail" TEXT,
ADD COLUMN     "photoKey" TEXT,
ADD COLUMN     "qualificationYear" INTEGER,
ADD COLUMN     "socialSecurityNo" TEXT,
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "workEmail" TEXT;

-- CreateTable
CREATE TABLE "NextOfKin" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT true,
    "isBeneficiary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NextOfKin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "issuedDate" DATE,
    "expiryDate" DATE,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "hrOnly" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NextOfKin_employeeId_idx" ON "NextOfKin"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_employeeId_idx" ON "EmployeeDocument"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_workEmail_key" ON "Employee"("workEmail");

-- AddForeignKey
ALTER TABLE "NextOfKin" ADD CONSTRAINT "NextOfKin_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;


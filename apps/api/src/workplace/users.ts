import { Prisma } from '@prisma/client';
import { inForce } from '../people/people-access.service';

/** What chat and the community page show about a person: name, job and company, nothing private */
export const userCardSelect = () =>
  ({
    id: true,
    displayName: true,
    employment: {
      where: { status: 'ACTIVE' },
      take: 1,
      orderBy: { hireDate: 'desc' },
      select: {
        id: true,
        legalEntityId: true,
        person: { select: { firstName: true, lastName: true, preferredName: true } },
        legalEntity: { select: { code: true, countryCode: true } },
        assignments: { where: inForce(), take: 1, select: { jobTitle: true } },
      },
    },
  }) satisfies Prisma.UserSelect;

export type UserCardRow = Prisma.UserGetPayload<{ select: ReturnType<typeof userCardSelect> }>;

export function userCard(u: UserCardRow) {
  const e = u.employment[0];
  return {
    id: u.id,
    name: e ? `${e.person.preferredName ?? e.person.firstName} ${e.person.lastName}` : u.displayName,
    jobTitle: e?.assignments[0]?.jobTitle ?? 'Group office',
    country: e?.legalEntity.countryCode ?? null,
    company: e?.legalEntity.code ?? null,
  };
}

/** The author's company, for routing a report to HR of that company */
export const companyOf = (u: UserCardRow) => u.employment[0]?.legalEntityId ?? null;

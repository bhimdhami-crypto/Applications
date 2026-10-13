import { Prisma } from '@prisma/client';

/** What chat and the community page show about a person: name, job and company, nothing private */
export const USER_CARD = {
  id: true,
  email: true,
  employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true, company: { select: { name: true, countryCode: true } } } },
} satisfies Prisma.UserSelect;

export type UserCardRow = Prisma.UserGetPayload<{ select: typeof USER_CARD }>;

export function userCard(u: UserCardRow) {
  const e = u.employee;
  return {
    id: u.id,
    name: e ? `${e.firstName} ${e.lastName}` : u.email.split('@')[0],
    jobTitle: e?.jobTitle ?? 'Administrator',
    country: e?.company.countryCode ?? null,
  };
}

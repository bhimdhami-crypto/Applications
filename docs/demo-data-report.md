# Demo workforce: verification report

Generated from the database by `npm run db:report` after `npm run db:seed` on 16 October 2026, with seed 20261016 and 500 to 1,000 people per country (Bhim's limit).

Everyone is fictional. Names are drawn at random from common-name pools for each country, so any match with a real person is coincidence. Work emails use `<country>.mindspace.test`, personal emails `example.net`, identity numbers start with `SPECIMEN`, bank accounts with `TEST`, and pay is an illustrative demo figure, not market data. Running the seed again with the same settings produces the same people, jobs and pay.

Each person has an employment, a job history (about a third were promoted), pay history (a hire record, and for most an April 2026 annual review), one or two next of kin, encrypted identity numbers, a test bank account and a register of HR documents. About 12% have left, with a leaving date and reason. The Netherlands holding company (NL02) has no staff and no payroll on purpose.

**11,153 people in total.**

| Country | People (all time) | Active | Left |
|---|---:|---:|---:|
| Australia (AU) | 594 | 541 | 53 |
| China (CN) | 909 | 806 | 103 |
| Egypt (EG) | 612 | 547 | 65 |
| France (FR) | 708 | 645 | 63 |
| India (IN) | 714 | 644 | 70 |
| Japan (JP) | 986 | 895 | 91 |
| Kenya (KE) | 989 | 898 | 91 |
| South Korea (KR) | 528 | 477 | 51 |
| Mexico (MX) | 769 | 680 | 89 |
| Nigeria (NG) | 507 | 448 | 59 |
| Netherlands (NL) | 733 | 652 | 81 |
| New Zealand (NZ) | 916 | 840 | 76 |
| Tanzania (TZ) | 862 | 784 | 78 |
| Uganda (UG) | 621 | 569 | 52 |
| South Africa (ZA) | 705 | 636 | 69 |

| Company | Active | Active by department |
|---|---:|---|
| AU01 Mindspace Artificial Intelligence Australia Pty Ltd | 541 | CSU 62, DAI 51, ENG 114, FIN 38, HRM 22, ITS 41, LEG 18, MKT 28, OPS 57, PRD 50, SAL 60 |
| CN01 Mindspace Artificial Intelligence China Co., Ltd. | 806 | CSU 91, DAI 77, ENG 172, FIN 55, HRM 42, ITS 38, LEG 21, MKT 54, OPS 83, PRD 63, SAL 110 |
| EG01 Mindspace Artificial Intelligence Egypt S.A.E. | 547 | CSU 65, DAI 66, ENG 100, FIN 33, HRM 37, ITS 32, LEG 20, MKT 43, OPS 52, PRD 24, SAL 75 |
| FR01 Mindspace Artificial Intelligence France SAS | 645 | CSU 65, DAI 68, ENG 147, FIN 42, HRM 32, ITS 38, LEG 21, MKT 48, OPS 57, PRD 45, SAL 82 |
| IN01 Mindspace Artificial Intelligence India Pvt Ltd | 453 | CSU 55, DAI 43, ENG 96, FIN 29, HRM 18, ITS 30, LEG 13, MKT 26, OPS 50, PRD 40, SAL 53 |
| IN02 Mindspace Artificial Intelligence Global Delivery Centre India Pvt Ltd | 191 | FIN 65, HRM 53, ITS 33, OPS 40 |
| JP01 Mindspace Artificial Intelligence Japan K.K. | 895 | CSU 83, DAI 89, ENG 212, FIN 69, HRM 38, ITS 70, LEG 21, MKT 61, OPS 92, PRD 49, SAL 111 |
| KE01 Mindspace Artificial Intelligence Kenya Ltd | 764 | CSU 90, DAI 83, ENG 167, FIN 40, HRM 31, ITS 45, LEG 15, MKT 44, OPS 78, PRD 60, SAL 111 |
| KE02 Mindspace Artificial Intelligence Shared Services Africa Ltd | 134 | FIN 58, HRM 31, ITS 23, OPS 22 |
| KR01 Mindspace Artificial Intelligence Korea Ltd. | 477 | CSU 48, DAI 49, ENG 108, FIN 34, HRM 20, ITS 27, LEG 19, MKT 30, OPS 53, PRD 28, SAL 61 |
| MX01 Mindspace Artificial Intelligence Mexico S. de R.L. de C.V. | 680 | CSU 86, DAI 73, ENG 152, FIN 55, HRM 39, ITS 44, LEG 20, MKT 37, OPS 43, PRD 53, SAL 78 |
| NG01 Mindspace Artificial Intelligence Nigeria Ltd | 448 | CSU 66, DAI 49, ENG 93, FIN 30, HRM 16, ITS 20, LEG 16, MKT 22, OPS 43, PRD 32, SAL 61 |
| NL01 Mindspace Artificial Intelligence Netherlands B.V. | 652 | CSU 75, DAI 67, ENG 148, FIN 42, HRM 35, ITS 41, LEG 19, MKT 42, OPS 55, PRD 42, SAL 86 |
| NL02 Mindspace Artificial Intelligence Europe Holding B.V. | 0 | — |
| NZ01 Mindspace Artificial Intelligence New Zealand Limited | 840 | CSU 102, DAI 88, ENG 190, FIN 51, HRM 35, ITS 44, LEG 32, MKT 42, OPS 98, PRD 48, SAL 110 |
| TZ01 Mindspace Artificial Intelligence Tanzania Ltd | 784 | CSU 91, DAI 87, ENG 163, FIN 55, HRM 41, ITS 54, LEG 12, MKT 50, OPS 86, PRD 60, SAL 85 |
| UG01 Mindspace Artificial Intelligence Uganda Ltd | 569 | CSU 79, DAI 49, ENG 104, FIN 44, HRM 22, ITS 46, LEG 11, MKT 27, OPS 66, PRD 46, SAL 75 |
| ZA01 Mindspace Artificial Intelligence South Africa (Pty) Ltd | 636 | CSU 69, DAI 70, ENG 142, FIN 41, HRM 34, ITS 41, LEG 24, MKT 37, OPS 67, PRD 33, SAL 78 |

## Leave history

`prisma/leave-generator.ts` adds fictional leave for 2026 to staff hired before 2026 who have no portal account: past annual leave in different months, some sick and family care days, some leave in October 2026, and some booked or waiting for HR in November and December. The demo employee (Kevin Otieno) has a holiday in July, a sick day in March, and a year-end request waiting for his manager, Amina Mwangi. About 18,600 requests in total, all counted under rule pack `LEAVE-2026.1-draft`. Draft public holidays are stored for 2026 and 2027 for Kenya, Uganda, Tanzania, South Africa, Egypt, Nigeria, Mexico and New Zealand only.

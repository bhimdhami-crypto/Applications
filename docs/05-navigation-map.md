# Navigation map

The left navigation shows only what the signed-in user may use. The top bar carries global search, the company switcher (only companies in the user's scope, plus "All my companies" when they have more than one), the language menu, the light and dark theme switch and the user menu. Items marked *(phase N)* appear when that phase ships.

```mermaid
flowchart TB
  Home[Home dashboard]

  subgraph Me[Me]
    Profile[My profile (2) ✓]
    Payslips[My payslips (4)]
    Leave[My leave (3) ✓]
    Time[My time and attendance (3)]
    Expenses[My expenses (3)]
    Letters[Letters and documents (3)]
    Cases[HR help desk (3)]
    Assistant[AI assistant (6)]
  end

  subgraph Team[My team]
    TeamList[My team (2) ✓]
    Approvals[Leave approvals (3) ✓]
    TeamCal[Who is away (3) ✓]
    Holidays[Public holidays (3) ✓]
    Reviews[Reviews and goals (3)]
  end

  subgraph People[People]
    Directory[Staff directory (2) ✓]
    Hire[Hire someone (2) ✓]
    Headcount[Headcount (2) ✓]
    Changes[Change requests (2) ✓]
    Lifecycle[Hires, transfers, exits (3)]
    Recruit[Recruitment (3)]
    Talent[Performance, learning, succession (3)]
    ER[Employee relations, restricted (3)]
  end

  subgraph Payroll[Payroll]
    Runs[Payroll runs (4)]
    Sim[Simulations (4)]
    Exceptions[Exceptions (4)]
    Payments[Payment files (4)]
    Rules[Country rules (5)]
  end

  subgraph Finance[Finance]
    Journals[Payroll journals (4)]
    FX[Exchange rates (4)]
    Recharges[Intercompany recharges (4)]
  end

  subgraph Insight[Insight]
    Dash[Dashboards (6)]
    Reports[Reports (6)]
  end

  subgraph Admin[Administration]
    Org[Organisation (2) ✓]
    Users[Users and roles (2) ✓]
    Geo[Countries and currencies (2) ✓]
    Features[Company features (2) ✓]
    Workflows[Workflows (3)]
    Templates[Templates (3)]
    Integrations[Oracle and SAP (8)]
    Audit[Audit log (2) ✓]
    Health[System health (9)]
  end

  Home --> Me
  Home --> Team
  Home --> People
  Home --> Payroll
  Home --> Finance
  Home --> Insight
  Home --> Admin
```

## Who sees what

| Section | Employee | Manager | HR | Payroll | Finance | Auditor | Group admin |
|---|---|---|---|---|---|---|---|
| Me | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| My team | | ✓ | | | | | |
| People | | | ✓ | read | | read | ✓ |
| Payroll | | | | ✓ | read | read | ✓ |
| Finance | | | | | ✓ | read | ✓ |
| Insight | | team only | ✓ | ✓ | ✓ | ✓ | ✓ |
| Administration | | | org, users in scope | | | audit | ✓ |

Every cell is further limited to the countries and companies in the user's role assignments.

## Mobile app (phase 7)

Tabs: **Home** (announcements, next payday, balances), **Payslips**, **Leave**, **Time**, **Approvals** (managers only), **More** (expenses, documents, policies, help desk, assistant, settings, devices and sign-out).

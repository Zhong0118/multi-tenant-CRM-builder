# CRM role completion implementation plan

**Goal:** Resolve the two confirmed priority defects and implement the role gaps approved from roles-and-readiness.md.
**Spec:** docs/audits/2026-09-09/roles-and-readiness.md and user's explicit request to fix both issues and complete the listed capabilities.
**Architecture:** Retain tenant-scoped NestJS/Prisma services and Next.js/Ant Design. Add narrow audited operations; preserve current published permissions. No SMS/AI and no unrestricted platform impersonation.

## Rulings

- User approved the existing report's concrete design direction; proceed without repeating approval. Continue on the existing feature branch and preserve user's untracked files. Root owns final integration/contract generation and commits.
- Work in independently testable slices. Do not silently reduce the requested list. File ownership below prevents concurrent overwrites; migrations use separate numbered directories.
- Role changes/transfer must protect last admin and active recipient; offboarding hands over records and open follow-ups transactionally before disabling. First admin correction only DRAFT with no active admin, revokes the previous invitation.
- Personal saved filters can use existing per-member preference storage/local storage if no server synchronization is promised. Business associations support explicit links to another visible record. Attachments must use permission checked upload/download (no public file URLs).

## Tasks

- [x] 1. Root: reproduce default-ID failure in clean PostgreSQL, identify actual client/schema root cause, fix all affected default UUID creation paths; prove create→accept→activate with existing E2E, not fixture workarounds.
- [x] 2. Membership slice: conditional/locked invitation transitions and concurrency test; company admin role changes, admin handoff and offboarding record/open-task reassignment with audits and last-admin protection; matching member UI. Own memberships/invitations modules and web members features.
- [x] 3. Platform slice: first-admin phone correction; friendly audit labels; actual DB/Redis health probes; company audit read API/page with role guard. Own tenants/platform-operations and corresponding web pages; no membership/schema edits.
- [x] 4. Employee slice: saved filters, task reassignment UI/API to active authorized recipients, explicit record relations with both-side permission enforcement and UX. Own follow-ups/record relation modules; migration0014 for relations. Do not edit record-detail-drawer until coordinating integration with root.
- [x] 5. Root: permission-checked attachments stored outside public assets; bounded uploads/downloads, safe filenames, tenant isolation and record-level read/update check; migration0015. Root integrates detail drawer components and app.module/schema additions sequentially.
- [x] 6. Root: regenerate contracts, test role transitions and forbidden requests, scoped lint/typechecks, browser verify actual controls, update report and HANDOFF with evidence, commit/push the authorized feature branch. No merge/deploy.

For each task: reproduce failing behavior/test first, implement minimal service/UI, run scoped tests, review scope and permission boundaries. Root performs final combined regression and records exact failures/limits rather than claiming blanket readiness.

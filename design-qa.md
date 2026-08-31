# CRM 工作台设计 QA

## 对照基准

- Source visual truth: `/Users/zhongxu/.codex/generated_images/01a03ce8-3c33-7f63-b447-1def9ff77556/exec-8e18c43f-52d4-41a0-8745-1b8d74caceb4.png`
- Implementation screenshot: `/Users/zhongxu/Desktop/0-Inbox/multi-tenant-CRM-builder/.superpowers/brainstorm/99253-1788163752/audit/08-admin-dashboard-final.png`
- Lower-section screenshot: `/Users/zhongxu/Desktop/0-Inbox/multi-tenant-CRM-builder/.superpowers/brainstorm/99253-1788163752/audit/09-admin-dashboard-lower.png`
- Employee screenshot: `/Users/zhongxu/Desktop/0-Inbox/multi-tenant-CRM-builder/.superpowers/brainstorm/99253-1788163752/audit/11-employee-dashboard-final.png`
- Login screenshot: `/Users/zhongxu/Desktop/0-Inbox/multi-tenant-CRM-builder/.superpowers/brainstorm/99253-1788163752/audit/04-login-refreshed.png`
- Full-view comparison: `/Users/zhongxu/Desktop/0-Inbox/multi-tenant-CRM-builder/.superpowers/brainstorm/99253-1788163752/audit/10-dashboard-side-by-side.png`

## Normalization

- Intended desktop design: 1440 × 1024 CSS px.
- In-app browser capture viewport: 1280 × 720 CSS px, density 1 capture.
- Source image: 1487 × 1058 px.
- Implementation image: 1280 × 720 px.
- Comparison normalization: source resized proportionally to 1280px width, then north-cropped to 1280 × 720; implementation kept at native 1280 × 720.
- State: demo company administrator, dashboard ready, real seeded data loaded.

## Findings

- No remaining P0/P1/P2 finding.
- Typography: implementation uses the existing IBM Plex/Noto Sans SC/PingFang stack with 12–14px dense data labels and 24px page title. It is slightly less editorial than the generated reference but remains readable and consistent with the product.
- Spacing and layout: sidebar and main region use the full viewport. The trend chart is the dominant surface, the right rail is narrower, and the ranking table is full width. Independent sidebar/main scrolling remains intact.
- Colors and tokens: dark navy navigation, white analytical surfaces, blue chart bars, teal line/status accents, amber warnings, and red risks match the selected direction without adding gradients or heavy shadows.
- Image and asset quality: the dashboard uses charts and Ant Design icons only; no missing raster assets, placeholder artwork, custom SVG, or low-quality image substitution is present. Initial avatars use Ant Design Avatar because the product has no stored profile photos.
- Copy and content: implementation intentionally uses fewer KPI values and three real trend points because the API does not provide the mock's target, comparison, or sparkline data. No visual-only fake metric was introduced.
- Login: the two-column shell fills the viewport and form controls render at 46px minimum height. Register and password-reset forms inherit the same shared style without changing their business logic.

## Comparison History

### Iteration 1 — blocked

- Evidence: `05-admin-dashboard-refreshed.png` / `06-admin-dashboard-chart-check.png` browser captures.
- [P1] The trend chart canvas was present but blank, leaving the largest analytical region unusable.
- Cause: the existing `DualAxes` component still used the removed `geometryOptions` configuration shape while the installed 2.6.x implementation expects `children` marks.
- Fix: migrated the chart to two child marks (`interval` for amount and `line` for count) with separate axes and real overview data.

### Iteration 2 — passed

- Post-fix evidence: `08-admin-dashboard-final.png` and `10-dashboard-side-by-side.png`.
- The amount columns, count line, legend, axes, sales funnel, actions, and ranking table render correctly.
- The simplified implementation intentionally omits generated-reference sparklines, target attainment, department selector, and fake month comparisons because these values do not exist in the current API and the user requested less ornamentation.

## Browser Checks

- Login form rendered and accepted the demo administrator credentials.
- Administrator route opened at `/workspace/nebula-demo`.
- Primary action resolves to `/workspace/nebula-demo/objects/opportunities/new`.
- Active sidebar item is `管理工作台` for the administrator and `我的工作台` for the employee.
- Employee account `18800001003` opened the personal dashboard with own-data metrics and no team ranking.
- No browser console error was present after the final render.

## Follow-up Polish

- P3: add true KPI comparison/sparklines only after the API exposes a previous-period or target series.
- P3: add stored profile photos only when member avatars become a real product field.

final result: passed

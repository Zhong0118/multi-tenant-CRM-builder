# Landing feature

The public product page served at `/` (canonical `https://crm.baijiehub.com/`).

- `content.ts` holds the page copy and facts. Every claim describes the deployed release; check it against the product code before adding it.
- `demo/` is the interactive product demo: five scenarios in one shared product window, on one fictional company (`demo-data.ts`). It runs entirely in the browser: no network requests, no AI calls, nothing saved, no session needed. "重置演示" remounts every scenario.
- Styles are CSS modules scoped under `.page`; nothing here changes the signed-in application.

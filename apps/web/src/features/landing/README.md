# Landing feature

The public product page served at `/` (canonical `https://crm.baijiehub.com/`).
It is static apart from the navigation menu and the in-page product fragments
(`hero-workspace`, `table-designer`, `ai-demo`), which are client components
that run on fictional data only: they make no network requests and save
nothing.

Every factual claim lives in `content.ts` and describes the deployed release.
Check a claim against the product code before adding it. Work that exists only
in unmerged branches goes in `ROADMAP`, which the page labels 尚未上线.

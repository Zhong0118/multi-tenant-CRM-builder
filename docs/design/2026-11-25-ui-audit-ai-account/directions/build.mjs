// node build.mjs → writes a|b|c-{record,security}.html next to this file, plus
// a|b|c.html that stacks both screens (record on top, security below) for the
// side-by-side comparison page.
import fs from "node:fs";

const GAP = 16;
const part = (html, tag) => html.match(new RegExp(`<${tag}>([\\s\\S]*)</${tag}>`))[1];

for (const key of ["a", "b", "c"]) {
  const mod = `./${key}.mjs`;
  if (!fs.existsSync(new URL(mod, import.meta.url))) continue;
  const { files } = await import(mod);
  for (const [name, html] of Object.entries(files)) fs.writeFileSync(new URL(name, import.meta.url), html);

  const rec = files[`${key}-record.html`];
  const sec = files[`${key}-security.html`];
  // Both screens of one direction share the same stylesheet, so one <style> serves both frames.
  const head = rec.slice(0, rec.indexOf("<style>")).replace(/<title>[^<]*<\/title>/, `<title>${part(rec, "title").split(" · ")[0]}</title>`);
  const combined = `${head}<style>${part(rec, "style")}
body{height:${900 * 2 + GAP}px!important;overflow:hidden!important;background:#d4d4d8!important}
.frame{position:relative;width:1440px;height:900px;overflow:hidden;background:var(--bg,var(--canvas,var(--paper,#fff)))}
.frame + .frame{margin-top:${GAP}px}
</style>
</head>
<body>
<div class="frame">${part(rec, "body")}</div>
<div class="frame">${part(sec, "body")}</div>
</body>
</html>
`;
  fs.writeFileSync(new URL(`${key}.html`, import.meta.url), combined);
  console.log(mod, Object.keys(files).join(" "), `${key}.html`);
}

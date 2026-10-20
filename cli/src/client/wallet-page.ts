// The one page the bridge serves. No external scripts: it only talks to window.ethereum and to fcx on 127.0.0.1.
export function pageHtml(token: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>runfcx login</title><style>
body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#222;background:#fafafa}
@media (prefers-color-scheme:dark){body{color:#eee;background:#141414}}
#log p{margin:.4rem 0}.now{font-weight:600}button{font:inherit;padding:.6rem 1rem;border-radius:.5rem;border:1px solid #888;cursor:pointer}
</style></head><body>
<h1>runfcx login</h1>
<p>Your wallet will ask for two signatures. Each one is explained below before it appears. No gas, no transaction.</p>
<button id="go">Connect wallet</button><div id="log"></div>
<script>
const base = "/${token}";
const log = (t, now) => { const p = document.createElement("p"); p.textContent = t; if (now) p.className = "now"; document.getElementById("log").append(p); };
async function loop() {
  for (;;) {
    const r = await fetch(base + "/next");
    if (r.status === 204) continue;
    if (r.status === 410) { log("Done. You can close this tab.", true); return; }
    const q = await r.json();
    log(q.explain, true);
    let body;
    try { body = { id: q.id, result: await window.ethereum.request({ method: q.method, params: q.params }) }; }
    catch (e) { body = { id: q.id, error: { code: e.code, message: e.message } }; }
    await fetch(base + "/result", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }
}
document.getElementById("go").onclick = () => {
  if (!window.ethereum) { log("No browser wallet found. Install MetaMask or Rabby, or use: runfcx login", true); return; }
  document.getElementById("go").disabled = true; loop();
};
</script></body></html>`;
}

// Small progressive enhancements. Every page reads fine without this file.

// Copy buttons: <button data-copy="element-id">
document.querySelectorAll("[data-copy]").forEach((b) => {
  b.addEventListener("click", async () => {
    const text = document.getElementById(b.dataset.copy)?.textContent ?? "";
    try { await navigator.clipboard.writeText(text.trim()); b.textContent = "Copied"; }
    catch { b.textContent = "Select it"; }
    setTimeout(() => (b.textContent = "Copy"), 1800);
  });
});

// Checklist: <ol data-checklist="key"> with checkboxes; progress kept in this browser only.
document.querySelectorAll("[data-checklist]").forEach((list) => {
  const key = list.dataset.checklist, boxes = [...list.querySelectorAll("input[type=checkbox]")];
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { saved = {}; }
  const update = () => {
    const done = boxes.filter((b) => b.checked).length;
    const count = document.getElementById("done-count"), bar = document.getElementById("done-bar");
    if (count) count.textContent = String(done);
    if (bar) bar.style.width = `${Math.round((done / boxes.length) * 100)}%`;
  };
  boxes.forEach((b) => {
    b.checked = !!saved[b.value];
    b.addEventListener("change", () => {
      saved[b.value] = b.checked;
      try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* private mode: progress just isn't kept */ }
      update();
    });
  });
  update();
});

// Numbers from our runs: <span data-num="run1.hourly_usd" data-prefix="$" data-suffix="/h">
const nums = document.querySelectorAll("[data-num]");
if (nums.length) {
  fetch(new URL("data/runs.json", document.baseURI)).then((r) => r.json()).then((runs) => {
    nums.forEach((el) => {
      const v = el.dataset.num.split(".").reduce((o, k) => o?.[k], runs);
      if (v === undefined) return; // not measured yet: keep the placeholder
      el.textContent = `${el.dataset.prefix ?? ""}${v}${el.dataset.suffix ?? ""}`;
      el.classList.remove("tbd");
    });
  }).catch(() => {});
}

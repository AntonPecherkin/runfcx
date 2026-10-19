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

// Motion: everything below runs instantly when the reader prefers reduced motion.
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, still ? 0 : ms));

// Terminal replays: <pre data-term="name"> holds the real transcript; a Replay button types it out again.
document.querySelectorAll("pre[data-term]").forEach((pre) => {
  const full = pre.textContent, btn = document.createElement("button");
  btn.type = "button"; btn.className = "replay"; btn.textContent = "Replay";
  pre.after(btn);
  btn.addEventListener("click", async () => {
    btn.disabled = true; pre.textContent = "";
    for (const line of full.split("\n")) { pre.textContent += (pre.textContent ? "\n" : "") + line; await wait(line.startsWith("$") ? 600 : 220); }
    btn.disabled = false;
  });
});

// Life of a cast: <ol class="stops" data-play> lights up one stop at a time.
document.querySelectorAll("ol.stops[data-play]").forEach((ol) => {
  const btn = document.createElement("button");
  ol.classList.add("playable");
  btn.type = "button"; btn.className = "btn"; btn.textContent = "Play the cast";
  ol.after(btn);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    for (const li of ol.children) { li.classList.add("lit"); await wait(700); }
    await wait(1200); [...ol.children].forEach((li) => li.classList.remove("lit"));
    btn.disabled = false;
  });
});

// Tutorial: highlight the current chapter in the toc and in the architecture diagram.
const arch = document.getElementById("arch");
const chapters = document.querySelectorAll("[data-chapter]");
if (chapters.length && "IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const c = e.target.dataset.chapter;
    if (arch) arch.dataset.on = c;
    document.querySelectorAll("nav.toc a").forEach((a) => a.setAttribute("aria-current", String(a.hash === `#${e.target.id}`)));
  }), { rootMargin: "-40% 0px -55% 0px" });
  chapters.forEach((c) => io.observe(c));
}

// Wallet sign-in: <div data-signflow> steps through its list on a loop while visible.
document.querySelectorAll("[data-signflow]").forEach((box) => {
  const steps = [...box.querySelectorAll("li")];
  if (still || !("IntersectionObserver" in window)) return; // reduced motion: show every step at once
  let i = 0, timer = null;
  const show = () => { steps.forEach((s, j) => s.classList.toggle("on", j === i)); i = (i + 1) % steps.length; };
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !timer) { box.classList.add("playing"); show(); timer = setInterval(show, 1800); }
    if (!e.isIntersecting && timer) { clearInterval(timer); timer = null; }
  }).observe(box);
});

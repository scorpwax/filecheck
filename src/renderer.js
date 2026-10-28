const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const extOf = (n) => Core.splitExt(n).ext.toLowerCase();

const loading = { video: false, aaf: false };
const emptyFolder = () => ({ dir: null, files: [], ignored: 0, broken: [], multi: [], note: "" });
const state = {
    video: emptyFolder(),
    aaf: emptyFolder(),
    accepted: new Set(), // keys of "possible" matches the user confirmed
    manual: new Set(), // "videoKey|aafKey" pairs the user linked by hand
    result: null,
    plan: []
};

// ---- settings ----
const store = {
    get(k, d) {
        try {
            const v = localStorage.getItem("filecheck." + k);
            return v == null ? d : JSON.parse(v);
        } catch {
            return d;
        }
    },
    set(k, v) {
        try {
            localStorage.setItem("filecheck." + k, JSON.stringify(v));
        } catch {
            /* ignore */
        }
    }
};

// 'separated': each AAF sits in its own folder (with an "AAF Media" folder); 'embedded': loose .aaf files
let aafType = store.get("aafType", "separated");
const separated = () => aafType === "separated";

const fmtDur = (sec) => {
    const t = Math.round(sec);
    const h = Math.floor(t / 3600),
        m = Math.floor((t % 3600) / 60),
        s = String(t % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};
// kind: 'v' (video, blue) or 'a' (AAF, teal)
const durChip = (label, sec, kind) =>
    sec == null ? "" : `<span class="chip ${kind}" title="${sec.toFixed(2)} s">${label}${fmtDur(sec)}</span>`;
const hv = (t) => `<span class="hv">${t}</span>`;
const ha = (t) => `<span class="ha">${t}</span>`;
const kindChip = (kind) => `<span class="chip ${kind === "Video" ? "v" : "a"}">${kind}</span>`;

$("#junk").value = store.get("junk", Core.DEFAULT_JUNK).join("\n");
$("#splitCamel").checked = store.get("splitCamel", true);
$("#lengthTol").value = store.get("lengthTol", 1);
$("#startNum").value = store.get("startNum", 1);
$("#lengthCheck").checked = store.get("lengthCheck", true);
$("#watchToggle").checked = store.get("watch", true);
$("#prefix").value = store.get("prefix", "");
$("#suffix").value = store.get("suffix", "");
document.querySelector(`input[name=numbering][value=${store.get("numbering", "sequence")}]`).checked = true;
document.querySelector(`input[name=mode][value=${store.get("mode", "copy")}]`).checked = true;

// blank or invalid falls back to 1
const getStart = () => {
    const n = parseInt($("#startNum").value, 10);
    return Number.isFinite(n) && n >= 0 ? n : 1;
};
const getOptions = () => ({
    junk: $("#junk").value.split("\n"),
    splitCamel: $("#splitCamel").checked,
    numbering: document.querySelector("input[name=numbering]:checked").value,
    startNumber: getStart()
});
const getTol = () => {
    const v = parseFloat($("#lengthTol").value);
    return Number.isFinite(v) ? Math.max(0, v) : 1;
};
const getMode = () => document.querySelector("input[name=mode]:checked").value;

function saveSettings() {
    const o = getOptions();
    store.set("junk", o.junk);
    store.set("splitCamel", o.splitCamel);
    store.set("numbering", o.numbering);
    store.set("mode", getMode());
    store.set("prefix", $("#prefix").value);
    store.set("suffix", $("#suffix").value);
    store.set("lengthTol", getTol());
    store.set("startNum", getStart());
    store.set("lengthCheck", $("#lengthCheck").checked);
    store.set("watch", $("#watchToggle").checked);
}

// ---- folders ----
// keepMatches: rescans after delete/rename keep the "possible matches" the user already confirmed
async function loadFolder(kind, p, keepMatches = false) {
    // drop / pick: show a message right away. Quiet re-checks (watch, delete, rename) don't flash it.
    if (!keepMatches) {
        loading[kind] = true;
        renderZones();
    }
    try {
        if (kind === "aaf" && separated()) {
            const { dir, folders, looseAafs } = await api.scanSeparated(p);
            const files = folders.filter((f) => f.aafPath);
            state.aaf = {
                ...emptyFolder(),
                dir,
                files,
                broken: folders.filter((f) => !f.aafPath),
                multi: files.filter((f) => f.aafCount > 1),
                note:
                    !folders.length && looseAafs
                        ? `Found ${looseAafs} loose .aaf file${looseAafs === 1 ? "" : "s"} but no AAF folders. Switch to Embedded Files?`
                        : ""
            };
        } else {
            const { dir, files, dirCount } = await api.scan(p, kind);
            const exts = kind === "video" ? Core.VIDEO_EXTS : Core.AAF_EXTS;
            const kept = files.filter((f) => exts.includes(extOf(f.name)));
            state[kind] = {
                ...emptyFolder(),
                dir,
                files: kept,
                ignored: files.length - kept.length,
                note:
                    kind === "aaf" && !kept.length && dirCount
                        ? "No .aaf files here, but there are folders. Switch to Separated Files?"
                        : ""
            };
        }
        if (!keepMatches) { state.accepted.clear(); state.manual.clear(); }
        refresh();
        updateWatch();
    } catch (err) {
        if (!keepMatches) alert(`Couldn't read that folder:\n${err.message}`);
    } finally {
        if (loading[kind]) {
            loading[kind] = false;
            renderZones();
        }
    }
}

for (const zone of document.querySelectorAll(".zone")) {
    const kind = zone.dataset.kind;
    zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.classList.add("over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.classList.remove("over");
        const f = e.dataTransfer.files[0];
        if (f) loadFolder(kind, api.pathFor(f));
    });
    $(".choose", zone).addEventListener("click", async () => {
        const p = await api.pickFolder(kind === "video" ? "Choose the Video folder" : "Choose the AAF folder");
        if (p) loadFolder(kind, p);
    });
}
// dropping outside a zone should not navigate the window to the file
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

// ---- rendering ----
function renderZones() {
    for (const kind of ["video", "aaf"]) {
        const zone = $(kind === "video" ? "#zoneVideo" : "#zoneAaf");
        const s = state[kind];
        zone.classList.toggle("loaded", !!s.dir);
        const noun = kind === "video" ? "video file" : separated() ? "AAF folder" : "AAF file";
        const extra = s.ignored
            ? ` &middot; ${s.ignored} other ignored`
            : s.broken.length
              ? ` &middot; ${s.broken.length} with no .aaf`
              : "";
        zone.classList.toggle("busy", loading[kind]);
        if (loading[kind]) {
            $(".zone-hint", zone).innerHTML =
                `<span class="spinner"></span> Reading ${kind === "video" ? "video files" : separated() ? "AAF folders" : "AAF files"}\u2026`;
            continue;
        }
        $(".zone-hint", zone).innerHTML = s.dir
            ? `<span class="zone-count">${s.files.length} <small>${noun}${s.files.length === 1 ? "" : "s"}${extra}</small></span>${s.note ? `<div class="zone-note">${esc(s.note)}</div>` : ""}`
            : kind === "aaf" && separated()
              ? "Drop the folder that holds the AAF folders"
              : "Drop folder here";
        $(".zone-path", zone).textContent = s.dir || "";
        $(".zone-path", zone).title = s.dir || "";
    }
}

function table(headers, rows) {
    return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
function group(cls, title, count, body) {
    return `<div class="group ${cls}"><h2>${title} <span class="pill">${count}</span></h2>${body}</div>`;
}

function finalName(stem, ext) {
    const mode = getMode();
    const pre = mode === "copy" ? $("#prefix").value : "";
    const suf = mode === "copy" ? $("#suffix").value : "";
    return `${pre}${stem}${suf}${ext ? "." + ext : ""}`;
}

const delBox = (g, p) => `<input type="checkbox" data-del="${g}" value="${esc(p)}" aria-label="Select file">`;
const delAll = (g) => `<input type="checkbox" data-delall="${g}" aria-label="Select all">`;
const delBar = (g) =>
    `<div class="bulk"><button class="danger" data-trash="${g}" disabled>Delete selected&hellip;</button></div>`;

function refresh() {
    saveSettings();
    renderZones();
    $("#overwriteWarn").hidden = getMode() !== "overwrite";
    for (const b of document.querySelectorAll("#aafType button"))
        b.classList.toggle("active", b.dataset.type === aafType);
    const aafWord = separated() ? "AAF folder" : "AAF";
    const opts = getOptions();
    $("#startNum").disabled = opts.numbering !== "sequence"; // only used when re-sequencing
    const haveBoth = state.video.dir && state.aaf.dir;
    $("#stats").hidden = $("#banner").hidden = $("#footer").hidden = !haveBoth;
    if (!haveBoth) {
        $("#results").innerHTML = "";
        state.plan = [];
        return;
    }

    const r = Core.compare(state.video.files, state.aaf.files, opts);
    state.result = r;

    // links made by hand: both files must still be unmatched, otherwise the link is dropped
    const looseV = [...r.missingAAF, ...r.possible.map((p) => p.video)];
    const looseA = [...r.missingVideo, ...r.possible.map((p) => p.aaf)];
    const manual = [];
    for (const link of state.manual) {
        const [vk, ak] = link.split("|");
        const video = looseV.find((f) => f.key === vk), aaf = looseA.find((f) => f.key === ak);
        if (video && aaf && !manual.some((m) => m.video === video || m.aaf === aaf)) manual.push({ video, aaf, clean: video.clean, fuzzy: true, manual: true });
    }
    const linkedV = new Set(manual.map((m) => m.video)), linkedA = new Set(manual.map((m) => m.aaf));
    const possible = r.possible.filter((p) => !linkedV.has(p.video) && !linkedA.has(p.aaf));

    // accepted "possible" matches join the matched list
    const accepted = possible.filter((p) => state.accepted.has(p.video.key + "|" + p.aaf.key));
    const stillPossible = possible.filter((p) => !accepted.includes(p));
    for (const p of accepted) p.clean = p.video.clean;
    const toRename = Core.sequence([...r.pairs, ...accepted, ...manual], opts);
    state.plan = toRename;

    const missAAF = [...r.missingAAF.filter((f) => !linkedV.has(f)), ...stillPossible.map((p) => p.video)];
    const missVid = [...r.missingVideo.filter((f) => !linkedA.has(f)), ...stillPossible.map((p) => p.aaf)];
    const linkSelect = (attr, i, options) =>
        `<select class="link-sel" ${attr}="${i}"><option value="">Link to…</option>${options.map((f) => `<option value="${esc(f.key)}">${esc(f.name)}</option>`).join("")}</select>`;
    const dupCount = r.duplicates.video.length + r.duplicates.aaf.length;
    const emptyMedia = separated() ? state.aaf.files.filter((f) => f.mediaEmpty) : [];
    const tol = getTol();
    const lengthIssues = !$("#lengthCheck").checked
        ? []
        : toRename.filter(
              (p) =>
                  p.video.duration != null &&
                  p.aaf.duration != null &&
                  Math.abs(p.video.duration - p.aaf.duration) > tol
          );

    $("#stats").innerHTML = [
        ["video", r.counts.video, "Video files"],
        ["aaf", r.counts.aaf, separated() ? "AAF folders" : "AAF files"],
        ["good", toRename.length, "Matched"],
        [missAAF.length ? "bad" : "", missAAF.length, "Video, no AAF"],
        [missVid.length ? "bad" : "", missVid.length, `${aafWord}, no video`],
        ...(state.aaf.broken.length ? [["bad", state.aaf.broken.length, "Folder, no .aaf"]] : []),
        ...(emptyMedia.length ? [["bad", emptyMedia.length, "Empty AAF Media"]] : []),
        ...(stillPossible.length ? [["maybe", stillPossible.length, "Possible matches"]] : []),
        ...(lengthIssues.length ? [["maybe", lengthIssues.length, "Length differs"]] : [])
    ]
        .map(([c, n, l]) => `<div class="stat ${c}"><b>${n}</b><span>${l}</span></div>`)
        .join("");

    const broken = state.aaf.broken;
    const clashes = [
        ...r.numberClashes.video.map((c) => ({ ...c, kind: "Video" })),
        ...r.numberClashes.aaf.map((c) => ({ ...c, kind: aafWord }))
    ];
    const clashCount = clashes.length;
    const allGood =
        !missAAF.length &&
        !missVid.length &&
        !stillPossible.length &&
        !dupCount &&
        !broken.length &&
        !clashCount &&
        !emptyMedia.length &&
        r.counts.video > 0;
    const banner = $("#banner");
    banner.className = "banner " + (allGood ? "ok" : "bad");
    banner.textContent = allGood
        ? `All set: every video has an AAF and every AAF has a video (${toRename.length} pairs).${lengthIssues.length ? ` Heads-up: ${lengthIssues.length} length difference${lengthIssues.length === 1 ? "" : "s"}.` : ""}`
        : `Not ready: ${missAAF.length} video${missAAF.length === 1 ? "" : "s"} missing an AAF, ${missVid.length} ${aafWord}${missVid.length === 1 ? "" : "s"} missing a video${broken.length ? `, ${broken.length} folder${broken.length === 1 ? "" : "s"} with no .aaf inside` : ""}${emptyMedia.length ? `, ${emptyMedia.length} empty AAF Media folder${emptyMedia.length === 1 ? "" : "s"}` : ""}${dupCount ? `, ${dupCount} duplicate${dupCount === 1 ? "" : "s"}` : ""}${clashCount ? `, ${clashCount} repeated number${clashCount === 1 ? "" : "s"}` : ""}.`;
    if (r.counts.video === 0 || r.counts.aaf === 0) {
        banner.className = "banner bad";
        banner.textContent =
            r.counts.video === 0
                ? "No video files found in the Video folder."
                : separated()
                  ? "No AAF folders (with an .aaf inside) found in the AAF folder."
                  : "No AAF files found in the AAF folder.";
    }

    const html = [];
    if (missAAF.length) {
        html.push(
            group(
                "bad",
                "Video with no AAF",
                missAAF.length,
                table(
                    [hv("Video file"), "Link by hand"],
                    missAAF.map(
                        (f, i) =>
                            `<tr><td>${esc(f.name)}${f.duration != null ? `<div class="chips">${durChip("", f.duration, "v")}</div>` : ""}</td><td>${missVid.length ? linkSelect("data-link-v", i, missVid) : ""}</td></tr>`
                    )
                )
            )
        );
    }
    if (missVid.length) {
        html.push(
            group(
                "bad",
                `${aafWord} with no video`,
                missVid.length,
                table(
                    [ha(separated() ? "AAF folder" : "AAF file"), "Link by hand"],
                    missVid.map((f, i) => `<tr><td>${esc(f.name)}</td><td>${missAAF.length ? linkSelect("data-link-a", i, missAAF) : ""}</td></tr>`)
                )
            )
        );
    }
    if (broken.length) {
        html.push(
            group(
                "bad",
                "AAF folder with no .aaf inside (skipped)",
                broken.length,
                table(
                    [ha("AAF folder")],
                    broken.map((f) => `<tr><td>${esc(f.name)}</td></tr>`)
                )
            )
        );
    }
    if (emptyMedia.length) {
        html.push(
            group(
                "bad",
                "AAF Media folder is empty",
                emptyMedia.length,
                table(
                    [ha("AAF folder")],
                    emptyMedia.map((f) => `<tr><td>${esc(f.name)}</td></tr>`)
                )
            )
        );
    }
    if (state.aaf.multi.length) {
        html.push(
            group(
                "maybe",
                "AAF folder with more than one .aaf (first one is used)",
                state.aaf.multi.length,
                table(
                    [ha("AAF folder")],
                    state.aaf.multi.map((f) => `<tr><td>${esc(f.name)}</td></tr>`)
                )
            )
        );
    }
    if (stillPossible.length) {
        html.push(
            group(
                "maybe",
                "Possible matches (close names, or the same number)",
                stillPossible.length,
                `<div class="bulk"><button id="matchSelected" disabled>Match selected</button></div>` +
                    table(
                        [
                            '<input type="checkbox" id="pickAll" aria-label="Select all">',
                            hv("Video file"),
                            ha(separated() ? "AAF folder" : "AAF file"),
                            "Why"
                        ],
                        stillPossible.map((p, i) => {
                            const why = p.byNumber
                                ? `Same number (${String(p.video.num).padStart(2, "0")})`
                                : "Similar name";
                            return `<tr><td class="chk"><input type="checkbox" data-pick="${i}" data-key="${esc(p.video.key + "|" + p.aaf.key)}" aria-label="Select pair"></td><td>${esc(p.video.name)}</td><td>${esc(p.aaf.name)}</td><td><span class="chip">${why}</span></td></tr>`;
                        })
                    )
            )
        );
    }
    if (dupCount) {
        const rows = [
            ...r.duplicates.video.map((f) => ({ f, kind: "Video" })),
            ...r.duplicates.aaf.map((f) => ({ f, kind: aafWord }))
        ].map(
            ({ f, kind }) =>
                `<tr><td class="chk">${delBox("dup", f.path)}</td><td>${esc(f.name)}<div class="chips">${kindChip(kind)}</div></td><td class="orig">${esc(f.dupOf)}</td></tr>`
        );
        html.push(
            group(
                "bad",
                "Duplicates (copies of another file; skipped when renaming)",
                dupCount,
                delBar("dup") + table([delAll("dup"), "Duplicate", "Copy of (kept)"], rows)
            )
        );
    }
    if (clashCount) {
        const rows = clashes.flatMap((c) =>
            c.files.map(
                (f) =>
                    `<tr><td class="chk">${delBox("clash", f.path)}</td><td>${esc(f.name)}</td><td>${kindChip(c.kind)}</td><td class="orig">${String(c.num).padStart(2, "0")}</td></tr>`
            )
        );
        html.push(
            group(
                "maybe",
                "Same number used more than once (one may be an old or duplicate version)",
                clashCount,
                delBar("clash") + table([delAll("clash"), "File", "Type", "Number"], rows)
            )
        );
    }
    html.push(
        group(
            "good",
            "Matched",
            toRename.length,
            toRename.length
                ? `<table class="match"><thead><tr><th>New name</th><th>${hv("Video (original)")}</th><th>${ha(`${separated() ? "AAF folder" : "AAF"} (original)`)}</th></tr></thead><tbody>${toRename
                      .map((p) => {
                          const chips = `<span class="chip v">.${esc(p.video.ext)}</span><span class="chip a">${separated() ? "folder + .aaf inside" : `.${esc(p.aaf.ext)}`}</span>`;
                          const vChips = durChip("", p.video.duration, "v");
                          const aChips =
                              durChip("AAF ", p.aaf.duration, "a") +
                              (lengthIssues.includes(p)
                                  ? `<span class="chip warn">differs by ${Math.abs(p.video.duration - p.aaf.duration).toFixed(1)} s</span>`
                                  : "");
                          return `<tr><td><div class="new">${esc(finalName(p.stem, ""))}</div><div class="chips">${chips}${p.manual ? `<span class="chip">linked by hand</span><button class="ghost unlink" data-unlink="${esc(p.video.key + "|" + p.aaf.key)}">Unlink</button>` : ""}</div></td><td class="orig vcell">${esc(p.video.name)}${vChips ? `<div class="chips">${vChips}</div>` : ""}</td><td class="orig acell">${esc(p.aaf.name)}${aChips ? `<div class="chips">${aChips}</div>` : ""}</td></tr>`;
                      })
                      .join("")}</tbody></table>`
                : '<div class="empty">Nothing matched yet.</div>'
        )
    );
    const keepDel = new Set(
        [...$("#results").querySelectorAll("[data-del]:checked")].map((c) => c.dataset.del + "|" + c.value)
    );
    const keepPick = new Set([...$("#results").querySelectorAll("[data-pick]:checked")].map((c) => c.dataset.key));
    $("#results").innerHTML = html.join("");
    state.view = {
        missAAF,
        missVid,
        broken,
        emptyMedia,
        clashes,
        lengthIssues,
        aafWord,
        dups: [...r.duplicates.video, ...r.duplicates.aaf].map((f) => f.name),
        matched: toRename.length,
        videos: r.counts.video,
        aafs: r.counts.aaf
    };

    for (const btn of $("#results").querySelectorAll("[data-trash]")) {
        const g = btn.dataset.trash;
        const boxes = [...$("#results").querySelectorAll(`[data-del="${g}"]`)];
        const all = $("#results").querySelector(`[data-delall="${g}"]`);
        const sync = () => {
            const n = boxes.filter((c) => c.checked).length;
            btn.disabled = !n;
            btn.textContent = n ? `Delete selected (${n})\u2026` : "Delete selected\u2026";
            all.checked = n === boxes.length;
        };
        boxes.forEach((c) => c.addEventListener("change", sync));
        all.addEventListener("change", () => {
            boxes.forEach((c) => {
                c.checked = all.checked;
            });
            sync();
        });
        boxes.forEach((c) => {
            if (keepDel.has(g + "|" + c.value)) c.checked = true;
        });
        sync();
        btn.addEventListener("click", async () => {
            const paths = boxes.filter((c) => c.checked).map((c) => c.value);
            busy = true;
            const res = await api.trash({ paths });
            busy = false;
            if (res.cancelled) return;
            const bad = res.results.filter((x) => !x.ok);
            if (bad.length)
                alert(
                    `${bad.length} couldn't be deleted:\n` +
                        bad
                            .slice(0, 8)
                            .map((b) => `\u2022 ${b.path.split("/").pop()}: ${b.error}`)
                            .join("\n")
                );
            await Promise.all(["video", "aaf"].map((k) => state[k].dir && loadFolder(k, state[k].dir, true)));
        });
    }

    const picks = [...$("#results").querySelectorAll("[data-pick]")];
    const matchBtn = $("#matchSelected");
    if (matchBtn) {
        const sync = () => {
            const n = picks.filter((c) => c.checked).length;
            matchBtn.disabled = !n;
            matchBtn.textContent = n ? `Match selected (${n})` : "Match selected";
            $("#pickAll").checked = n === picks.length;
        };
        picks.forEach((c) => c.addEventListener("change", sync));
        picks.forEach((c) => {
            if (keepPick.has(c.dataset.key)) c.checked = true;
        });
        sync();
        $("#pickAll").addEventListener("change", (e) => {
            picks.forEach((c) => {
                c.checked = e.target.checked;
            });
            sync();
        });
        matchBtn.addEventListener("click", () => {
            for (const c of picks) {
                if (!c.checked) continue;
                const p = stillPossible[+c.dataset.pick];
                state.accepted.add(p.video.key + "|" + p.aaf.key);
            }
            refresh();
        });
    }

    $("#results").querySelectorAll("[data-link-v]").forEach((sel) =>
        sel.addEventListener("change", () => {
            if (!sel.value) return;
            state.manual.add(missAAF[+sel.dataset.linkV].key + "|" + sel.value);
            refresh();
        })
    );
    $("#results").querySelectorAll("[data-link-a]").forEach((sel) =>
        sel.addEventListener("change", () => {
            if (!sel.value) return;
            state.manual.add(sel.value + "|" + missVid[+sel.dataset.linkA].key);
            refresh();
        })
    );
    $("#results").querySelectorAll("[data-unlink]").forEach((btn) =>
        btn.addEventListener("click", () => {
            state.manual.delete(btn.dataset.unlink);
            refresh();
        })
    );

    $("#applyBtn").disabled = !toRename.length;
    $("#applyBtn").textContent =
        getMode() === "overwrite"
            ? `Rename ${toRename.length * 2} files in place`
            : `Save ${toRename.length * 2} renamed copies`;
    $("#footerMsg").textContent =
        getMode() === "overwrite"
            ? "Matched pairs only. Unmatched files are never touched."
            : 'Copies go in a "Renamed" folder next to each original. Matched pairs only.';
}

// ---- actions ----
function buildItems() {
    const items = [];
    for (const p of state.plan) {
        for (const f of [p.video, p.aaf]) {
            const item = { from: f.path, newName: finalName(p.stem, f.ext) };
            // AAF folder: the .aaf inside takes the same new name as the folder
            if (f.isDir) item.inner = { fromName: f.aafName, newName: finalName(p.stem, "aaf") };
            items.push(item);
        }
    }
    return items;
}

async function refreshUndo() {
    const info = await api.undoInfo();
    const b = $("#undoBtn");
    b.hidden = !info;
    if (info) b.textContent = `Undo last ${info.mode === "copy" ? "copy" : "rename"} (${info.count})`;
}

$("#applyBtn").addEventListener("click", async () => {
    const mode = getMode();
    const items = buildItems();
    if (
        mode === "overwrite" &&
        !confirm(
            `Rename ${items.length} original files in place?\n\nThis changes the names of the files on disk. You can undo the last rename from this app.`
        )
    )
        return;
    $("#applyBtn").disabled = true;
    busy = true;
    const res = await api.apply({ mode, items });
    busy = false;
    const bad = res.filter((r) => !r.ok);
    const ok = res.length - bad.length;
    let msg = `${mode === "copy" ? "Copied" : "Renamed"} ${ok} file${ok === 1 ? "" : "s"}.`;
    if (bad.length)
        msg +=
            `\n\n${bad.length} failed:\n` +
            bad
                .slice(0, 8)
                .map((b) => `• ${b.from.split("/").pop()}: ${b.error}`)
                .join("\n");
    alert(msg);
    if (mode === "overwrite") {
        // re-scan so the lists show the new names
        await Promise.all(["video", "aaf"].map((k) => state[k].dir && loadFolder(k, state[k].dir, true)));
    } else {
        $("#applyBtn").disabled = false;
    }
    refreshUndo();
});

$("#undoBtn").addEventListener("click", async () => {
    const info = await api.undoInfo();
    if (!info) return;
    const what =
        info.mode === "copy"
            ? `Move the ${info.count} copies from the last run to the Trash?`
            : `Restore the original names of ${info.count} files?`;
    if (!confirm(what)) return;
    const r = await api.undo();
    alert(r.failed ? `Undid ${r.ok}, ${r.failed} could not be undone.` : `Undid ${r.ok} file${r.ok === 1 ? "" : "s"}.`);
    await Promise.all(["video", "aaf"].map((k) => state[k].dir && loadFolder(k, state[k].dir, true)));
    refreshUndo();
});

$("#exportBtn").addEventListener("click", async () => {
    const r = state.result;
    if (!r) return;
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [["Status", "New name", "Video file", "AAF file", "Video length (s)", "AAF media length (s)"]];
    const sec = (x) => (x == null ? "" : x.toFixed(2));
    for (const p of state.plan)
        rows.push(["Matched", p.stem, p.video.name, p.aaf.name, sec(p.video.duration), sec(p.aaf.duration)]);
    const accepted = new Set(state.plan.map((p) => p.video.path));
    const planA = new Set(state.plan.map((p) => p.aaf.path));
    for (const p of r.possible)
        if (!accepted.has(p.video.path) && !planA.has(p.aaf.path)) rows.push(["Possible match", "", p.video.name, p.aaf.name]);
    const possV = new Set(r.possible.map((p) => p.video.path)),
        possA = new Set(r.possible.map((p) => p.aaf.path));
    for (const f of r.missingAAF) if (!possV.has(f.path) && !accepted.has(f.path)) rows.push(["Missing AAF", "", f.name, ""]);
    for (const f of r.missingVideo) if (!possA.has(f.path) && !planA.has(f.path)) rows.push(["Missing Video", "", "", f.name]);
    for (const c of [...r.numberClashes.video, ...r.numberClashes.aaf])
        for (const f of c.files)
            rows.push([
                "Repeated number " + String(c.num).padStart(2, "0"),
                "",
                f.isDir ? "" : f.name,
                f.isDir ? f.name : ""
            ]);
    for (const f of r.duplicates.video) rows.push(["Duplicate video", "", f.name, ""]);
    for (const f of r.duplicates.aaf) rows.push(["Duplicate AAF", "", "", f.name]);
    const d = new Date().toISOString().slice(0, 10);
    await api.saveReport({
        defaultName: `FileCheck_Report_${d}.csv`,
        content: rows.map((r) => r.map(q).join(",")).join("\n")
    });
});

$("#clearBtn").addEventListener("click", () => {
    state.video = emptyFolder();
    state.aaf = emptyFolder();
    state.accepted.clear();
    state.manual.clear();
    refresh();
    updateWatch();
});

for (const b of document.querySelectorAll("#aafType button")) {
    b.addEventListener("click", async () => {
        if (b.dataset.type === aafType) return;
        aafType = b.dataset.type;
        store.set("aafType", aafType);
        // the same AAF folder reads differently in the other mode, so re-scan it
        if (state.aaf.dir) await loadFolder("aaf", state.aaf.dir);
        else refresh();
    });
}

$("#resetJunk").addEventListener("click", () => {
    $("#junk").value = Core.DEFAULT_JUNK.join("\n");
    renderPresets("Default");
    state.accepted.clear();
    state.manual.clear();
    refresh();
});
for (const el of document.querySelectorAll("#options input, #options textarea")) {
    // only the word list and CamelCase split change how names are compared
    el.addEventListener("input", () => {
        if (el.id === "junk" || el.id === "splitCamel") { state.accepted.clear(); state.manual.clear(); }
        refresh();
    });
}

refresh();
refreshUndo();

// ---- word-list presets ----
const presets = () => store.get("presets", {});
function renderPresets(selected) {
    const names = Object.keys(presets()).sort();
    const sel = $("#presetSel");
    sel.innerHTML = ["Default", ...names].map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    sel.value = names.includes(selected) ? selected : "Default";
    store.set("presetSel", sel.value);
}
const loadPreset = (name) => {
    $("#junk").value = (name === "Default" ? Core.DEFAULT_JUNK : presets()[name] || Core.DEFAULT_JUNK).join("\n");
    state.accepted.clear();
    state.manual.clear();
    refresh();
};
renderPresets(store.get("presetSel", "Default"));
$("#presetSel").addEventListener("change", () => {
    store.set("presetSel", $("#presetSel").value);
    $("#presetMsg").textContent = "";
    loadPreset($("#presetSel").value);
});
$("#presetSave").addEventListener("click", () => {
    const sel = $("#presetSel").value;
    const name = $("#presetName").value.trim() || (sel !== "Default" ? sel : "");
    const msg = $("#presetMsg");
    if (!name) {
        msg.textContent = "Type a name to save this word list.";
        return;
    }
    if (name === "Default") {
        msg.textContent = '"Default" is built in. Pick another name.';
        return;
    }
    const all = presets();
    all[name] = $("#junk")
        .value.split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    store.set("presets", all);
    renderPresets(name);
    $("#presetName").value = "";
    msg.textContent = `Saved "${name}".`;
});
$("#presetDel").addEventListener("click", () => {
    const name = $("#presetSel").value;
    const msg = $("#presetMsg");
    if (name === "Default") {
        msg.textContent = "The default list can't be deleted.";
        return;
    }
    if (!confirm(`Delete the preset "${name}"?`)) return;
    const all = presets();
    delete all[name];
    store.set("presets", all);
    renderPresets("Default");
    msg.textContent = `Deleted "${name}".`;
    loadPreset("Default");
});

// ---- watch the folders and re-check on change ----
let watchKey = "",
    rescanning = false,
    busy = false;
function updateWatch() {
    const dirs = [];
    if ($("#watchToggle").checked) {
        if (state.video.dir) dirs.push({ dir: state.video.dir, recursive: false });
        if (state.aaf.dir) dirs.push({ dir: state.aaf.dir, recursive: separated() }); // AAF folders arrive as subfolders
    }
    const key = JSON.stringify(dirs);
    if (key !== watchKey) {
        watchKey = key;
        api.watch({ dirs });
    }
    $("#watchStatus").textContent = dirs.length ? `● Watching · checked ${new Date().toLocaleTimeString()}` : "";
}
async function rescanAll() {
    if (rescanning || busy) return;
    rescanning = true;
    try {
        await Promise.all(["video", "aaf"].map((k) => state[k].dir && loadFolder(k, state[k].dir, true)));
    } finally {
        rescanning = false;
    }
}
api.onFolderChanged(rescanAll);
$("#watchToggle").addEventListener("change", () => {
    saveSettings();
    updateWatch();
});

// ---- message to send back ----
function buildMessage() {
    const v = state.view;
    if (!v) return "";
    const out = [];
    const list = (title, items) => {
        if (items.length) out.push(`${title} (${items.length}):`, ...items.map((x) => `• ${x}`), "");
    };
    list(
        "Missing AAFs for these videos",
        v.missAAF.map((f) => f.name)
    );
    list(
        `Missing videos for these ${v.aafWord}s`,
        v.missVid.map((f) => f.name)
    );
    list(
        "AAF folders with no .aaf file inside",
        v.broken.map((f) => f.name)
    );
    list(
        "AAF folders with an empty AAF Media folder",
        v.emptyMedia.map((f) => f.name)
    );
    list("Duplicates", v.dups);
    list(
        "Repeated numbers",
        v.clashes.map((c) => `${String(c.num).padStart(2, "0")}: ${c.files.map((f) => f.name).join("  /  ")}`)
    );
    list(
        "Video and AAF lengths differ",
        v.lengthIssues.map((p) => `${p.stem} (${fmtDur(p.video.duration)} vs ${fmtDur(p.aaf.duration)})`)
    );
    if (!out.length)
        return `All set: ${v.matched} video${v.matched === 1 ? "" : "s"} matched with AAFs, nothing missing.`;
    // out.push(`${v.matched} of ${v.videos} videos matched with an AAF.`);
    return out.join("\n");
}
$("#copyMsgBtn").addEventListener("click", async () => {
    const text = buildMessage();
    if (!text) return;
    await api.copyText(text);
    const b = $("#copyMsgBtn");
    b.textContent = "Copied ✓";
    setTimeout(() => {
        b.textContent = "Copy message";
    }, 1600);
});
updateWatch();

// ---- version + update banner ----
let updateInfo = null;
function showUpdate(info) {
    updateInfo = info;
    $("#updateText").textContent = `FileCheck v${info.version} is available`;
    $("#updateBanner").hidden = false;
}
api.getVersion().then((v) => {
    $("#appVersion").textContent = `v${v}`;
});
api.onUpdateAvailable(showUpdate);
$("#updateDownload").addEventListener("click", () => updateInfo && api.openRelease(updateInfo.downloadUrl));
$("#updateDismiss").addEventListener("click", () => {
    $("#updateBanner").hidden = true;
});
$("#appVersion").addEventListener("click", async () => {
    const info = await api.checkForUpdates();
    if (info) showUpdate(info);
    else alert(`FileCheck ${$("#appVersion").textContent} is up to date.`);
});

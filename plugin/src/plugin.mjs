/**
 * Sandbox UI controller. DOM access is confined to the host-provided root.
 * The 2.0.1 manifest registers only nav.item: classification happens on the
 * standalone page, not inside individual asset pages. The reusable controller
 * still accepts an asset context for backward compatibility and unit tests.
 * All persisted writes use the permission-gated SDK storage API.
 */
import { taxonomyKey, assignmentKey, defaults, validTaxonomy, normalizeAssignment, filteredAssets, mapLimit, attributeCatalog, attributeValue, selectedFields, fieldLabel } from "./model.mjs";
/** Own one mounted UI, its async request generations, and its cleanup lifetime. */
function mountPanel(root, api, current, config = {}) {
  // Never save defaults until storage is read and validated. The dead/generation
  // guards prevent a late response from updating an unmounted or superseded UI.
  let t = defaults(), assets = [], assignments = {}, tab = "*", sub = "", query = "", busy = false, loaded = false, dead = false, generation = 0;
  const el = (tag, text, parent2 = root) => {
    const n = document.createElement(tag);
    if (text !== void 0) n.textContent = text;
    parent2.appendChild(n);
    return n;
  };
  el("p", "Create your own asset sublists and choose their display attributes.");
  const status = el("p");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const error = el("p");
  error.setAttribute("role", "alert");
  error.style.color = "#dc2626";
  const controls = [];
  const select = (label, parent2 = root) => {
    const l = el("label", label + " ", parent2), s = el("select", void 0, l);
    controls.push(s);
    return s;
  };
  const options = (s, items, value = "") => {
    s.replaceChildren();
    for (const [v, n] of items) {
      const o = el("option", n, s);
      o.value = v;
    }
    s.value = value;
  };
  const button = (text, fn, parent2 = root) => {
    const b = el("button", text, parent2);
    b.type = "button";
    b.onclick = fn;
    controls.push(b);
    return b;
  };
  const assetPicker = config.manager ? select("Asset to classify") : null;
  const category = select("Category"), subcategory = select("Subcategory");
  if (assetPicker) assetPicker.onchange = () => {
    config.selectAsset(assets.find((a) => String(a.id) === assetPicker.value) || null);
    void reload();
  };
  const setBusy = (v) => {
    busy = v;
    controls.forEach((n) => n.disabled = v || !loaded);
    browser.querySelectorAll("button,select,input").forEach((n) => n.disabled = v || !loaded);
    checklist.disabled = v || !loaded;
    editFields.disabled = v || !loaded;
    saveButton.disabled = v || !loaded || !current()?.id;
  };
  const message = (s) => {
    status.textContent = s;
  };
  const fail = (e) => {
    error.textContent = e.message || String(e);
  };
  const fill = () => {
    options(category, [["", "Uncategorised"], ...t.categories.map((c) => [c.id, c.name])], category.value);
    fillSub();
    options(parent, [["", "Top-level category"], ...t.categories.map((c) => [c.id, c.name])], parent.value);
  };
  const fillSub = () => options(subcategory, [["", "None"], ...(t.categories.find((c) => c.id === category.value)?.children || []).map((c) => [c.id, c.name])], subcategory.value);
  category.onchange = () => {
    subcategory.value = "";
    fillSub();
  };
  const saveButton = button("Save assignment", async () => {
    if (busy || !loaded) return;
    const id = current()?.id;
    if (!id) return;
    const a = normalizeAssignment({ category: category.value, subcategory: subcategory.value }, t);
    setBusy(true);
    error.textContent = "";
    try {
      if (!await api.storage.set(assignmentKey(id), a)) throw Error("Save failed; change was not confirmed.");
      assignments[id] = a;
      message("Assignment saved to plugin storage.");
      renderBrowser();
    } catch (e) {
      fail(e);
    } finally {
      if (!dead) setBusy(false);
    }
  });
  button("Refresh panel", () => reload());
  const details = el("details"), summary = el("summary", "Create category or subcategory", details);
  el("p", "Any workspace user with plugin access can create categories. Coordinate simultaneous edits; storage has no conflict detection.", details);
  const parent = select("Parent", details), nameLabel = el("label", "Name ", details), name = el("input", void 0, nameLabel);
  name.maxLength = 80;
  controls.push(name);
  const checklist = el("fieldset", void 0, details);
  let picked = [], fieldCatalog = [], scanned = false;
  el("p", "Choose the attributes shown for this new sublist. The sidebar creation page also reads declared attribute schemas. Nothing is preselected.", details);
  function paintFields() {
    checklist.replaceChildren();
    el("legend", "Available attributes", checklist);
    for (const f of fieldCatalog) {
      const l = el("label", void 0, checklist), input = el("input", void 0, l);
      input.type = "checkbox";
      input.value = f.id;
      input.checked = picked.includes(f.id);
      input.onchange = () => {
        picked = input.checked ? [...picked, f.id] : picked.filter((id) => id !== f.id);
      };
      el("span", f.label + " (" + f.id + ")", l);
      l.style.display = "block";
    }
  }
  async function scanFields() {
    if (busy || !loaded) return;
    setBusy(true);
    error.textContent = "";
    try {
      const all = await api.assets.list();
      if (dead) return;
      fieldCatalog = attributeCatalog([...all, ...current() ? [current()] : []]);
      scanned = true;
      paintFields();
      message("Attribute checklist refreshed from accessible assets.");
    } catch (e) {
      fail(e);
    } finally {
      if (!dead) setBusy(false);
    }
  }
  button("Scan asset attributes", () => scanFields(), details);
  details.ontoggle = () => {
    if (details.open && !scanned) void scanFields();
  };
  button("Create", async () => {
    if (busy || !loaded) return;
    if (!scanned) {
      fail(Error("Scan asset attributes before creating a sublist."));
      return;
    }
    const label = name.value.trim();
    if (!label || label.length > 80) {
      fail(Error("Enter a name of 1\u201380 characters."));
      return;
    }
    setBusy(true);
    error.textContent = "";
    try {
      const next = await api.storage.get(taxonomyKey) || defaults();
      if (!validTaxonomy(next)) throw Error("Invalid stored taxonomy; nothing overwritten.");
      const p = parent.value ? next.categories.find((c) => c.id === parent.value) : null;
      if (parent.value && !p) throw Error("Parent missing; refresh and retry.");
      const list = p ? p.children : next.categories;
      if (list.length >= 100) throw Error("Maximum 100 entries per level.");
      if (list.some((c) => c.name.toLowerCase() === label.toLowerCase())) throw Error("Name already exists at this level.");
      list.push({ id: crypto.randomUUID(), name: label, selectedAttributes: [...picked], ...p ? {} : { children: [] } });
      if (!await api.storage.set(taxonomyKey, next)) throw Error("Category creation failed.");
      t = next;
      name.value = "";
      picked = [];
      paintFields();
      fill();
      renderBrowser();
      message("Category created. Refresh other open panels.");
    } catch (e) {
      fail(e);
    } finally {
      if (!dead) setBusy(false);
    }
  }, details);
  const edit = el("details");
  el("summary", "Edit sublist attributes", edit);
  const editSelect = select("Sublist", edit), editFields = el("fieldset", void 0, edit);
  let editPicked = [];
  function editEntry() {
    return t.categories.flatMap((c) => [c, ...c.children]).find((c) => c.id === editSelect.value);
  }
  function paintEdit() {
    editFields.replaceChildren();
    el("legend", "Display attributes", editFields);
    for (const f of attributeCatalog(assets, [], editPicked)) {
      const l = el("label", void 0, editFields);
      l.style.display = "block";
      const c = el("input", void 0, l);
      c.type = "checkbox";
      c.checked = editPicked.includes(f.id);
      c.onchange = () => {
        editPicked = c.checked ? [...editPicked, f.id] : editPicked.filter((id) => id !== f.id);
      };
      el("span", f.label, l);
    }
  }
  editSelect.onchange = () => {
    editPicked = [...editEntry()?.selectedAttributes ?? []];
    paintEdit();
  };
  edit.ontoggle = async () => {
    if (!edit.open || busy || !loaded) return;
    setBusy(true);
    try {
      assets = await api.assets.list();
      if (dead) return;
      options(editSelect, t.categories.flatMap((c) => [[c.id, c.name], ...c.children.map((x) => [x.id, c.name + " / " + x.name])]), t.categories[0]?.id ?? "");
      editSelect.onchange();
    } catch (e) {
      fail(e);
    } finally {
      if (!dead) setBusy(false);
    }
  };
  button("Save selected attributes", async () => {
    if (busy || !loaded || !editEntry()) return;
    const id = editSelect.value, picked2 = [...editPicked];
    setBusy(true);
    try {
      const next = await api.storage.get(taxonomyKey);
      if (!validTaxonomy(next)) throw Error("Invalid stored taxonomy.");
      const entry = next.categories.flatMap((c) => [c, ...c.children]).find((c) => c.id === id);
      if (!entry) throw Error("Sublist no longer exists.");
      entry.selectedAttributes = picked2;
      if (!await api.storage.set(taxonomyKey, next)) throw Error("Save failed.");
      if (dead) return;
      t = next;
      fill();
      renderBrowser();
      message("Display attributes saved.");
    } catch (e) {
      fail(e);
    } finally {
      if (!dead) setBusy(false);
    }
  }, edit);
  const browser = el("div");
  browser.hidden = true;
  button("Open / refresh asset browser", async () => {
    if (busy || !loaded) return;
    const gen = ++generation;
    setBusy(true);
    error.textContent = "";
    try {
      const rows = await api.assets.list();
      const pairs = await mapLimit(rows, 8, async (a) => [a.id, normalizeAssignment(await api.storage.get(assignmentKey(a.id)), t)]);
      if (dead || gen !== generation) return;
      assets = rows;
      assignments = Object.fromEntries(pairs);
      browser.hidden = false;
      renderBrowser();
      message(rows.length ? "Browser refreshed." : "No accessible assets returned.");
    } catch (e) {
      if (!dead) fail(e);
    } finally {
      if (!dead && gen === generation) setBusy(false);
    }
  });
  /** Re-render from stored assignments; display filters never write storage. */
  function renderBrowser() {
    browser.replaceChildren();
    const tabs = el("div", void 0, browser);
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Asset categories");
    for (const [id, label] of [["*", "All"], ["", "Uncategorised"], ...t.categories.map((c) => [c.id, c.name])]) {
      const b = el("button", label, tabs);
      b.type = "button";
      b.disabled = busy;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(tab === id));
      b.onclick = () => {
        tab = id;
        sub = "";
        renderBrowser();
      };
    }
    const subLabel = el("label", "Filter subcategory ", browser), filter = el("select", void 0, subLabel);
    options(filter, [["", "All subcategories"], ...(t.categories.find((c) => c.id === tab)?.children || []).map((c) => [c.id, c.name])], sub);
    const searchLabel = el("label", "Search ", browser), search = el("input", void 0, searchLabel);
    search.value = query;
    const count = el("p", void 0, browser), panel = el("div", void 0, browser);
    panel.setAttribute("role", "tabpanel");
    panel.style.overflow = "auto";
    const table = el("table", void 0, panel);
    table.style.width = "100%";
    table.style.textAlign = "left";
    const head = el("tr", void 0, el("thead", void 0, table)), body = el("tbody", void 0, table);
    const labels = attributeCatalog(assets);
    function rows() {
      body.replaceChildren();
      head.replaceChildren();
      const fields = selectedFields(t.categories.find((c) => c.id === tab), sub);
      for (const label of ["Asset", ...fields.map((id) => labels.find((f) => f.id === id)?.label || fieldLabel(id))]) el("th", label, head).scope = "col";
      const matches = filteredAssets(assets, assignments, tab, sub, query);
      count.textContent = matches.length + " matching assets. Showing up to 200; narrow search for more.";
      for (const a of matches.slice(0, 200)) {
        const tr = el("tr", void 0, body);
        el("td", a.name || "Asset " + a.id, tr);
        for (const id of fields) el("td", attributeValue(a, id), tr);
      }
    }
    filter.onchange = () => {
      sub = filter.value;
      rows();
    };
    search.oninput = () => {
      query = search.value;
      rows();
    };
    rows();
  }
  function optionsPicker() {
    optionsList(assetPicker, [["", "Choose an asset"], ...assets.map((a) => [String(a.id), String(a.name || "Asset " + a.id)])], current()?.id ? String(current().id) : "");
  }
  const optionsList = (s, items, value) => {
    s.replaceChildren();
    for (const [v, n] of items) {
      const o = el("option", n, s);
      o.value = v;
    }
    s.value = value;
  };
  /** Load taxonomy first, then the selected assignment and picker.
   * Each refresh invalidates older responses; failures leave writes disabled. */
  async function reload() {
    const gen = ++generation;
    loaded = false;
    setBusy(true);
    error.textContent = "";
    message("Loading\u2026");
    try {
      if (!current()?.id && !config.manager) throw Error("Open a saved asset first.");
      if (!api?.assets?.list || !api?.storage?.get) throw Error("Requires Nosdesk 1.1.0 host API.");
      const stored = await api.storage.get(taxonomyKey);
      if (stored !== null && !validTaxonomy(stored)) throw Error("Invalid stored taxonomy; nothing overwritten.");
      const next = stored || defaults();
      const a = normalizeAssignment(current()?.id ? await api.storage.get(assignmentKey(current().id)) : null, next);
      const all = config.manager ? await api.assets.list() : [];
      if (dead || gen !== generation) return;
      t = next;
      if (config.manager) {
        assets = all;
        assetPicker && optionsPicker();
      }
      category.value = "";
      fill();
      category.value = a.category;
      fillSub();
      subcategory.value = a.subcategory;
      loaded = true;
      message("Ready. Refresh to see other users\u2019 changes.");
      browser.hidden = true;
    } catch (e) {
      if (!dead && gen === generation) fail(e);
    } finally {
      if (!dead && gen === generation) setBusy(false);
    }
  }
  for (const n of controls) {
    n.style.margin = "6px";
    n.style.padding = "6px";
    n.style.border = "1px solid #888";
    n.style.borderRadius = "4px";
    n.style.color = "inherit";
    n.style.background = "var(--nd-surface)";
  }
  reload();
  return { reload, destroy() {
    dead = true;
    generation++;
    root.replaceChildren();
  } };
}
var stdin_default = { mount(root, api, context) {
  let ctx = context, selected = null;
  const manager = context.component?.slot === "nav.item";
  const controller = mountPanel(root, api, () => ctx.asset || selected, { manager, selectAsset: (value) => selected = value });
  return { update(next) {
    const changed = ctx.asset?.id !== next.asset?.id;
    ctx = next;
    if (changed) void controller.reload();
  }, unmount() {
    controller.destroy();
  } };
} };
export {
  stdin_default as default,
  mountPanel
};

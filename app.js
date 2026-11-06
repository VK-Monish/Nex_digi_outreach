const stageColors = {
  Identified: "#8a7a52",
  Researched: "#9c8550",
  Contacted: "#b8952f",
  Replied: "#c9a43a",
  Interested: "#d4af37",
  "Meeting/Demo": "#e0bf52",
  "Evaluation/Pilot": "#ebcc66",
  Negotiation: "#f3d77a",
  Won: "#f8e6a0",
  "Lost / On Hold": "#e11d48"
};

const companies = [];

const avatarColors = [
  "linear-gradient(135deg,#f6e08f,#d4af37)",
  "linear-gradient(135deg,#e9c46a,#a8801f)",
  "linear-gradient(135deg,#f3d77a,#b8952f)",
  "linear-gradient(135deg,#fff1c1,#c9a43a)",
  "linear-gradient(135deg,#d4af37,#7a5a12)"
];
const stageNames = ["Identified", "Researched", "Contacted", "Replied", "Interested", "Meeting/Demo", "Evaluation/Pilot", "Negotiation", "Won", "Lost / On Hold"];
const quickActions = ["Mail Sent", "Reply Received", "Follow-up Sent", "Meeting Scheduled", "Demo Done", "Quotation Sent", "Not Interested"];
const timeZones = {
  Finland: "Europe/Helsinki", Germany: "Europe/Berlin", Netherlands: "Europe/Amsterdam",
  "South Korea": "Asia/Seoul", USA: "America/New_York", Japan: "Asia/Tokyo",
  UK: "Europe/London", UAE: "Asia/Dubai", Singapore: "Asia/Singapore", Israel: "Asia/Jerusalem"
};
let nextNoteId = 1;
function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}
function makeNote({ title, text, by, at }) {
  return { id: nextNoteId++, title, text, by, at: at || new Date().toISOString() };
}
function formatStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(date);
}
function toLocalInput(value) {
  const date = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
let activeCompanyId = null;

/* ---------- Supabase ----------
   Companies, timeline notes, and email templates are stored in Supabase.
   Run supabase/schema.sql once in the Supabase SQL editor, then connect in Settings. */
const SB_CONFIG_KEY = "nex-sb-config";
const sbState = { url: "", key: "", client: null, ready: false, saving: false, timer: null, lastJson: "" };

function loadSbConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(SB_CONFIG_KEY) || "{}");
    sbState.url = saved.url ? normalizeSbUrl(saved.url) : "";
    sbState.key = saved.key || "";
  } catch (err) {
    sbState.url = "";
    sbState.key = "";
  }
}
loadSbConfig();

function sbConfigured() {
  return Boolean(sbState.url && sbState.key && window.supabase);
}

function setDbStatus(message) {
  const el = document.getElementById("db-status");
  if (el) el.textContent = message;
}

function db() {
  if (!sbState.client) sbState.client = window.supabase.createClient(sbState.url, sbState.key);
  return sbState.client;
}

function snapshot() {
  return { companies, templates, nextCompanyId, nextTemplateId, nextNoteId };
}

function applyRows(companyRows, noteRows, templateRows) {
  const notesByCompany = {};
  noteRows.forEach((note) => {
    (notesByCompany[note.company_id] ||= []).push({
      id: note.id,
      title: note.title,
      text: note.note_text,
      by: note.author,
      at: note.at
    });
  });
  const nextCompanies = companyRows.map((row) => ({
    id: row.id,
    name: row.name,
    country: row.country,
    phone: row.phone || "",
    email: row.email || "",
    industry: row.industry || [],
    type: row.type,
    stage: row.stage,
    priority: row.priority,
    due: row.due || "—",
    notes: (notesByCompany[row.id] || []).sort((a, b) => new Date(b.at) - new Date(a.at))
  }));
  companies.splice(0, companies.length, ...nextCompanies);
  templates.splice(0, templates.length, ...templateRows.map((row) => ({
    id: row.id, name: row.name, subject: row.subject, body: row.body
  })));
  const maxCompany = companyRows.reduce((max, row) => Math.max(max, row.id), 0);
  const maxTemplate = templateRows.reduce((max, row) => Math.max(max, row.id), 0);
  const maxNote = noteRows.reduce((max, row) => Math.max(max, row.id), 0);
  nextCompanyId = Math.max(nextCompanyId, maxCompany + 1);
  nextTemplateId = Math.max(nextTemplateId, maxTemplate + 1);
  nextNoteId = Math.max(nextNoteId, maxNote + 1);
}

async function loadFromSupabase() {
  const companiesRes = await db().from("companies").select("*").order("id");
  if (companiesRes.error) throw new Error(companiesRes.error.message);
  const notesRes = await db().from("notes").select("*");
  if (notesRes.error) throw new Error(notesRes.error.message);
  const templatesRes = await db().from("templates").select("*").order("id");
  if (templatesRes.error) throw new Error(templatesRes.error.message);
  return {
    companies: companiesRes.data || [],
    notes: notesRes.data || [],
    templates: templatesRes.data || []
  };
}

async function saveToSupabase() {
  if (!sbState.ready || !sbConfigured() || sbState.saving) return;
  const json = JSON.stringify(snapshot());
  if (json === sbState.lastJson) return;
  sbState.saving = true;
  setDbStatus("Saving to Supabase…");
  try {
    const companyRows = companies.map((company) => ({
      id: company.id, name: company.name, country: company.country,
      phone: company.phone || "", email: company.email || "",
      industry: company.industry, type: company.type, stage: company.stage,
      priority: company.priority, due: company.due
    }));
    const noteRows = companies.flatMap((company) => company.notes.map((note) => ({
      id: note.id, company_id: company.id, title: note.title,
      note_text: note.text, author: note.by, at: note.at
    })));
    const templateRows = templates.map((template) => ({
      id: template.id, name: template.name, subject: template.subject, body: template.body
    }));

    if (companyRows.length) {
      const saved = await db().from("companies").upsert(companyRows);
      if (saved.error) throw new Error(saved.error.message);
    }
    const goneCompanies = await db().from("companies").delete().not("id", "in", `(${companyRows.map((row) => row.id).join(",") || "0"})`);
    if (goneCompanies.error) throw new Error(goneCompanies.error.message);

    if (noteRows.length) {
      const savedNotes = await db().from("notes").upsert(noteRows);
      if (savedNotes.error) throw new Error(savedNotes.error.message);
    }
    const goneNotes = await db().from("notes").delete().not("id", "in", `(${noteRows.map((row) => row.id).join(",") || "0"})`);
    if (goneNotes.error) throw new Error(goneNotes.error.message);

    if (templateRows.length) {
      const savedTemplates = await db().from("templates").upsert(templateRows);
      if (savedTemplates.error) throw new Error(savedTemplates.error.message);
    }
    const goneTemplates = await db().from("templates").delete().not("id", "in", `(${templateRows.map((row) => row.id).join(",") || "0"})`);
    if (goneTemplates.error) throw new Error(goneTemplates.error.message);

    sbState.lastJson = JSON.stringify(snapshot());
    setDbStatus(`Saved to Supabase at ${new Date().toLocaleTimeString()}.`);
  } catch (err) {
    setDbStatus(`Save failed: ${err.message}`);
  } finally {
    sbState.saving = false;
  }
}

function scheduleSave() {
  if (!sbState.ready) return;
  clearTimeout(sbState.timer);
  sbState.timer = setTimeout(saveToSupabase, 700);
}

function renderAll() {
  renderDashboard();
  renderCompanies();
  renderTemplates();
  if (activeCompanyId && !document.getElementById("company-detail").classList.contains("hidden")) {
    renderCompanyDetail();
  }
}

async function initData() {
  sbState.ready = false;
  sbState.client = null;
  if (!sbConfigured()) {
    setDbStatus(window.supabase
      ? "Not connected. Open Settings and add the Supabase URL and anon key."
      : "Supabase library did not load. Check your internet connection and refresh.");
    return;
  }
  setDbStatus("Loading from Supabase…");
  try {
    if (!localStorage.getItem("nex-cleared-companies-v1")) {
      const clearedNotes = await db().from("notes").delete().gte("id", 0);
      if (clearedNotes.error) throw new Error(clearedNotes.error.message);
      const clearedCompanies = await db().from("companies").delete().gte("id", 0);
      if (clearedCompanies.error) throw new Error(clearedCompanies.error.message);
      localStorage.setItem("nex-cleared-companies-v1", "1");
    }
    if (!localStorage.getItem("nex-cleared-templates-v1")) {
      const clearedTemplates = await db().from("templates").delete().gte("id", 0);
      if (clearedTemplates.error) throw new Error(clearedTemplates.error.message);
      localStorage.setItem("nex-cleared-templates-v1", "1");
    }
    const data = await loadFromSupabase();
    const empty = !data.companies.length && !data.templates.length;
    if (!empty) applyRows(data.companies, data.notes, data.templates);
    sbState.lastJson = empty ? "" : JSON.stringify(snapshot());
    sbState.ready = true;
    renderAll();
    if (empty) await saveToSupabase();
    else setDbStatus("Loaded from Supabase.");
  } catch (err) {
    if (/Failed to fetch/i.test(err.message)) {
      setDbStatus(`Could not reach Supabase at ${sbState.url}. The Project URL must look like https://xxxx.supabase.co (not the dashboard link). Check it, then press Connect and load.`);
    } else {
      setDbStatus(`Could not load: ${err.message}. Run supabase/schema.sql in the Supabase SQL editor if the tables are missing.`);
    }
  }
}

function renderDashboard() {
  const notes = companies.flatMap((company) => (company.notes || []).map((note) => ({ ...note, company: company.name })));
  const now = Date.now();
  const within90 = notes.filter((note) => note.title === "Mail Sent" && now - new Date(note.at).getTime() <= 90 * 86400000);
  const replies = notes.filter((note) => note.title === "Reply Received");
  const meetings = notes.filter((note) => note.title === "Meeting Scheduled");
  const pilots = companies.filter((company) => company.stage === "Evaluation/Pilot");
  document.getElementById("kpi-total").textContent = companies.length;
  document.getElementById("kpi-mails").textContent = within90.length;
  document.getElementById("kpi-replies").textContent = replies.length;
  document.getElementById("kpi-rate").textContent = within90.length ? `${Math.round((replies.length / within90.length) * 100)}%` : "0%";
  document.getElementById("kpi-meetings").textContent = meetings.length;
  document.getElementById("kpi-pilots").textContent = pilots.length;

  const counts = stageNames.map((stage) => companies.filter((company) => company.stage === stage).length);
  const maxCount = Math.max(1, ...counts);
  document.getElementById("pipeline").innerHTML = stageNames.map((stage, index) => {
    const count = counts[index];
    const pct = companies.length ? `${Math.round((count / companies.length) * 100)}%` : "0%";
    return `<li>
      <span>${stage}</span>
      <div class="track"><span style="width:${(count / maxCount) * 100}%;background:${stageColors[stage]};color:${stageColors[stage]}"></span></div>
      <span class="meta">${count} (${pct})</span>
    </li>`;
  }).join("");

  const byCountry = {};
  companies.forEach((company) => {
    const name = company.country || "Unknown";
    byCountry[name] = (byCountry[name] || 0) + 1;
  });
  const countryRows = Object.entries(byCountry).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  document.getElementById("countries").innerHTML = countryRows.map(([name, count]) =>
    `<li><span>${escapeHtml(name)}</span><span class="count-pill">${count}</span></li>`).join("")
    || `<li><span>No companies yet</span></li>`;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = companies.filter((company) => {
    const due = new Date(company.due);
    return company.due && company.due !== "—" && !Number.isNaN(due.getTime()) && due < today && company.stage !== "Won" && company.stage !== "Lost / On Hold";
  });
  document.getElementById("overdue-count").textContent = overdue.length;
  document.getElementById("overdue").innerHTML = overdue.map((company) => `
    <li class="overdue"><div><strong>${escapeHtml(company.name)}</strong><span>Due ${escapeHtml(company.due)}</span></div><span class="badge overdue">Overdue</span></li>`).join("");

  const staleCutoff = now - 14 * 86400000;
  const stale = companies.filter((company) => {
    const latest = (company.notes || []).reduce((max, note) => Math.max(max, new Date(note.at).getTime() || 0), 0);
    return latest < staleCutoff && company.stage !== "Won" && company.stage !== "Lost / On Hold";
  });
  document.getElementById("stale-count").textContent = stale.length;
  document.getElementById("stale").innerHTML = stale.map((company) => `
    <li class="stale"><div><strong>${escapeHtml(company.name)}</strong><span>Stale outreach lead</span></div><span class="badge ${stageClass(company.stage)}">${escapeHtml(company.stage)}</span></li>`).join("");

  const activity = notes
    .filter((note) => !Number.isNaN(new Date(note.at).getTime()))
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);
  document.getElementById("activity").innerHTML = activity.map((note) => {
    const initials = String(note.by || "?").split(/\s+/).map((part) => part.charAt(0)).join("").slice(0, 2).toUpperCase();
    return `<li>
      <span class="avatar">${escapeHtml(initials)}</span>
      <div><p><strong>${escapeHtml(note.by || "Team")}</strong></p><p>${escapeHtml(note.company)}: ${escapeHtml(note.text || note.title)}</p></div>
      <time>${escapeHtml(formatStamp(note.at))}</time>
    </li>`;
  }).join("");
}

const templates = [];
let nextTemplateId = 1;

function companyInitial(name) {
  return name.trim().charAt(0).toUpperCase();
}

function avatarStyle(name) {
  const index = name.charCodeAt(0) % avatarColors.length;
  return `background:${avatarColors[index]};color:#1a1406`;
}

function filteredCompanies() {
  const q = document.getElementById("company-filter").value.trim().toLowerCase();
  const stage = document.getElementById("stage-filter").value;
  const priority = document.getElementById("priority-filter").value;
  return companies.filter((c) => {
    const haystack = [c.name, c.country, c.phone, c.email, c.type, c.stage, ...c.industry].join(" ").toLowerCase();
    return (!q || haystack.includes(q)) && (!stage || c.stage === stage) && (!priority || c.priority === priority);
  });
}

companies.forEach((company, index) => { company.id = index + 1; });
let nextCompanyId = companies.length + 1;

function renderCompanies() {
  scheduleSave();
  const rows = filteredCompanies();
  document.getElementById("company-rows").innerHTML = rows.map((c) => `
    <tr class="company-row" data-id="${c.id}">
      <td>
        <div class="company-cell">
          <span class="company-avatar" style="${avatarStyle(c.name)}">${companyInitial(c.name)}</span>
          <div><strong>${escapeHtml(c.name)}</strong><small>Click to edit</small></div>
        </div>
      </td>
      <td>${escapeHtml(c.country)}</td>
      <td class="${c.phone ? "" : "due-muted"}">${escapeHtml(c.phone || "—")}</td>
      <td class="${c.email ? "" : "due-muted"}">${escapeHtml(c.email || "—")}</td>
      <td><div class="tags">${c.industry.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}</div></td>
      <td>${escapeHtml(c.type)}</td>
      <td><span class="badge ${stageClass(c.stage)}">${escapeHtml(c.stage)}</span></td>
      <td><span class="priority ${c.priority.toLowerCase()}">${escapeHtml(c.priority)}</span></td>
      <td class="${c.due === "—" ? "due-muted" : ""}">${escapeHtml(c.due)}</td>
      <td><button class="btn danger row-delete" type="button" data-delete-company="${c.id}">Delete</button></td>
    </tr>`).join("") || `<tr><td colspan="10">${companies.length ? "No companies match that filter." : "No companies yet. Add one or import an Excel file."}</td></tr>`;

  const stages = [...new Set(rows.map((c) => c.stage))];
  document.getElementById("company-kanban").innerHTML = stages.map((stage) => `
    <section class="kanban-col">
      <h3>${stage} · ${rows.filter((c) => c.stage === stage).length}</h3>
      ${rows.filter((c) => c.stage === stage).map((c) => `
        <article class="kanban-card" data-id="${c.id}">
          <strong>${escapeHtml(c.name)}</strong>
          <p>${escapeHtml(c.country)} · ${escapeHtml(c.type)}</p>
          ${c.email ? `<p>${escapeHtml(c.email)}</p>` : ""}
          <p><span class="priority ${c.priority.toLowerCase()}">${c.priority}</span> · ${c.due}</p>
        </article>`).join("")}
    </section>`).join("") || `<p>No companies match that filter.</p>`;
}

function stageClass(stage) {
  const map = {
    Identified: "identified",
    Researched: "researched",
    Contacted: "contacted",
    Replied: "replied",
    Interested: "interested",
    "Meeting/Demo": "meeting",
    "Evaluation/Pilot": "evaluation",
    Negotiation: "evaluation",
    Won: "interested",
    "Lost / On Hold": "lost"
  };
  return map[stage] || "identified";
}

function renderTemplates() {
  scheduleSave();
  document.getElementById("templates").innerHTML = templates.map((template) => `
    <article class="template-card" data-id="${template.id}">
      <button class="btn delete-template" data-delete="${template.id}" type="button">Delete</button>
      <h3>${template.name}</h3>
      <p class="subject"><strong>Subject:</strong> ${template.subject}</p>
      <pre>${template.body}</pre>
    </article>`).join("") || `<p class="empty-note">No templates yet.</p>`;
}

function deleteTemplate(id) {
  const index = templates.findIndex((template) => String(template.id) === String(id));
  if (index === -1) return;
  templates.splice(index, 1);
  renderTemplates();
  templateDialog.close();
}

renderTemplates();

const templateDialog = document.getElementById("template-dialog");
const templateForm = document.getElementById("template-form");

function openTemplateDialog(template) {
  templateForm.reset();
  document.getElementById("template-dialog-title").textContent = template ? "Edit Template" : "Add Template";
  document.getElementById("delete-template").classList.toggle("hidden", !template);
  if (template) {
    templateForm.elements.id.value = template.id;
    templateForm.elements.name.value = template.name;
    templateForm.elements.subject.value = template.subject;
    templateForm.elements.body.value = template.body;
  }
  templateDialog.showModal();
}

document.getElementById("add-template").addEventListener("click", () => openTemplateDialog(null));
document.getElementById("cancel-template").addEventListener("click", () => templateDialog.close());
document.getElementById("delete-template").addEventListener("click", () => {
  deleteTemplate(templateForm.elements.id.value);
});
document.getElementById("templates").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    event.stopPropagation();
    deleteTemplate(remove.dataset.delete);
    return;
  }
  const card = event.target.closest("[data-id]");
  if (!card) return;
  openTemplateDialog(templates.find((template) => String(template.id) === card.dataset.id));
});
templateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(templateForm);
  const record = {
    name: String(data.get("name")).trim(),
    subject: String(data.get("subject")).trim(),
    body: String(data.get("body")).trim()
  };
  if (!record.name || !record.subject || !record.body) return;
  const existing = templates.find((template) => String(template.id) === String(data.get("id")));
  if (existing) Object.assign(existing, record);
  else templates.unshift({ id: nextTemplateId++, ...record });
  renderTemplates();
  templateDialog.close();
});

const stageFilter = document.getElementById("stage-filter");
stageNames.forEach((stage) => {
  const option = document.createElement("option");
  option.value = stage;
  option.textContent = stage;
  stageFilter.appendChild(option);
});

renderDashboard();
renderCompanies();

["company-filter", "stage-filter", "priority-filter"].forEach((id) => {
  document.getElementById(id).addEventListener("input", renderCompanies);
  document.getElementById(id).addEventListener("change", renderCompanies);
});

document.getElementById("table-view").addEventListener("click", () => {
  document.getElementById("table-view").classList.add("active");
  document.getElementById("kanban-view").classList.remove("active");
  document.getElementById("company-table").classList.remove("hidden");
  document.getElementById("company-kanban").classList.add("hidden");
});

document.getElementById("kanban-view").addEventListener("click", () => {
  document.getElementById("kanban-view").classList.add("active");
  document.getElementById("table-view").classList.remove("active");
  document.getElementById("company-kanban").classList.remove("hidden");
  document.getElementById("company-table").classList.add("hidden");
});

const companyDialog = document.getElementById("company-dialog");
const companyForm = document.getElementById("company-form");

function openCompanyDialog(company) {
  companyForm.reset();
  document.getElementById("company-dialog-title").textContent = company ? "Edit Target Company" : "Add Target Company";
  if (company) {
    companyForm.elements.id.value = company.id;
    companyForm.elements.company.value = company.name;
    companyForm.elements.country.value = company.country;
    companyForm.elements.phone.value = company.phone || "";
    companyForm.elements.email.value = company.email || "";
    companyForm.elements.industry.value = company.industry.join(", ");
    companyForm.elements.type.value = company.type;
    companyForm.elements.stage.value = company.stage;
    companyForm.elements.priority.value = company.priority;
    companyForm.elements.due.value = company.due === "—" ? "" : company.due;
  }
  companyDialog.showModal();
}

document.getElementById("add-company").addEventListener("click", () => openCompanyDialog(null));

function localTime(country) {
  const zone = timeZones[country];
  if (!zone) return "Local time unavailable";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone, hourCycle: "h23" }).format(new Date());
}

function activeCompany() {
  return companies.find((company) => company.id === activeCompanyId);
}

function renderCompanyDetail() {
  scheduleSave();
  const company = activeCompany();
  if (!company) return;
  document.getElementById("detail-name").textContent = company.name;
  document.getElementById("detail-meta").textContent = `${company.country} • ${company.industry.join(", ")} • Local time ${localTime(company.country)} (${company.country})`;
  document.getElementById("detail-actions").innerHTML = quickActions.map((action) => `
    <button class="chip ${action === "Not Interested" ? "danger" : ""}" data-action="${action}" type="button">${action === "Not Interested" ? "× " : ""}${action}</button>`).join("");
  document.getElementById("tab-timeline").innerHTML = company.notes.map((note) => `
    <article class="timeline-item">
      <span class="timeline-dot"></span>
      <div><strong>${escapeHtml(note.title)}</strong><p>${escapeHtml(note.text)}</p><small>Logged by ${escapeHtml(note.by)}</small></div>
      <div class="timeline-meta">
        <time>${formatStamp(note.at)}</time>
        <button class="chip danger" data-delete-note="${note.id}" type="button">Delete</button>
      </div>
    </article>`).join("");
  document.getElementById("tab-contacts").innerHTML = `
    <dl class="contact-card">
      <dt>Contact Number</dt>
      <dd>${company.phone ? `<a href="tel:${escapeHtml(company.phone.replace(/[^\d+]/g, ""))}">${escapeHtml(company.phone)}</a>` : "Not added"}</dd>
      <dt>Mail ID</dt>
      <dd>${company.email ? `<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>` : "Not added"}</dd>
    </dl>
    <p class="empty-note">To change these, press Edit at the top of this page.</p>`;
  document.getElementById("stage-list").innerHTML = stageNames.map((stage) => `
    <li><button class="${stage === company.stage ? "active" : ""}" data-stage="${stage}" type="button"><span>${stage}</span>${stage === company.stage ? "<span>✓</span>" : ""}</button></li>`).join("");
}

function showCompanyDetail(company) {
  activeCompanyId = company.id;
  document.getElementById("company-list").classList.add("hidden");
  document.getElementById("company-detail").classList.remove("hidden");
  renderCompanyDetail();
}

function showCompanyList() {
  document.getElementById("company-detail").classList.add("hidden");
  document.getElementById("company-list").classList.remove("hidden");
  renderCompanies();
}

function deleteCompany(id) {
  const index = companies.findIndex((company) => String(company.id) === String(id));
  if (index === -1) return;
  const company = companies[index];
  if (!window.confirm(`Delete ${company.name}? This also removes its timeline.`)) return;
  companies.splice(index, 1);
  renderDashboard();
  if (String(activeCompanyId) === String(id)) showCompanyList();
  else renderCompanies();
}

document.getElementById("company-rows").addEventListener("click", (event) => {
  const remove = event.target.closest("[data-delete-company]");
  if (remove) {
    deleteCompany(remove.dataset.deleteCompany);
    return;
  }
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  showCompanyDetail(companies.find((company) => String(company.id) === row.dataset.id));
});

document.getElementById("company-kanban").addEventListener("click", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  showCompanyDetail(companies.find((company) => String(company.id) === card.dataset.id));
});

document.getElementById("back-to-companies").addEventListener("click", showCompanyList);
document.getElementById("edit-company").addEventListener("click", () => openCompanyDialog(activeCompany()));

document.getElementById("detail-actions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  const company = activeCompany();
  if (!button || !company) return;
  const action = button.dataset.action;
  const user = document.getElementById("user-label").textContent || "Team";
  if (action === "Not Interested") company.stage = "Lost / On Hold";
  company.notes.unshift(makeNote({ title: action, text: `${action} recorded for ${company.name}.`, by: user }));
  renderCompanyDetail();
});

document.getElementById("stage-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-stage]");
  const company = activeCompany();
  if (!button || !company) return;
  company.stage = button.dataset.stage;
  company.notes.unshift(makeNote({ title: "Stage Updated", text: `Pipeline stage set to ${company.stage}.`, by: document.getElementById("user-label").textContent || "Team" }));
  renderCompanyDetail();
});

document.getElementById("save-update").addEventListener("click", () => {
  const company = activeCompany();
  const text = document.getElementById("update-note").value.trim();
  if (!company || !text) return;
  const type = document.getElementById("update-type").value;
  company.notes.unshift(makeNote({ title: type === "Current Note" ? "Note Added" : type, text, by: document.getElementById("user-label").textContent || "Team" }));
  document.getElementById("update-note").value = "";
  renderCompanyDetail();
});

document.getElementById("tab-timeline").addEventListener("click", (event) => {
  const button = event.target.closest("[data-delete-note]");
  const company = activeCompany();
  if (!button || !company) return;
  company.notes = company.notes.filter((note) => String(note.id) !== button.dataset.deleteNote);
  renderCompanyDetail();
});

document.getElementById("detail-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (!tab) return;
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item === tab));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.add("hidden"));
  document.getElementById(`tab-${tab.dataset.tab}`).classList.remove("hidden");
});

const composeDialog = document.getElementById("compose-dialog");
const composeForm = document.getElementById("compose-form");
let composeFiles = [];

const SENDER_EMAIL = "nexdigi.business@gmail.com";

function resetCompose() {
  composeForm.reset();
  composeForm.elements.from.value = SENDER_EMAIL;
  composeFiles = [];
  renderComposeFiles();
  document.getElementById("template-picker").classList.add("hidden");
  document.getElementById("compose-status").textContent = "";
}

function renderComposeFiles() {
  document.getElementById("attachment-list").innerHTML = composeFiles.map((file, index) => `
    <li>
      <span>${escapeHtml(file.name)}</span>
      <small>${formatFileSize(file.size)}</small>
      <button type="button" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">×</button>
    </li>`).join("");
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const GMAIL_CLIENT_KEY = "nex-gmail-client";
let gmailToken = { value: "", expires: 0 };

function headerValue(value) {
  const text = String(value).replace(/[\r\n]+/g, " ").trim();
  return /^[\x20-\x7E]*$/.test(text) ? text : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(text)))}?=`;
}

function wrapBase64(value) {
  return value.replace(/.{1,76}/g, "$&\r\n").trim();
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x4000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function textToBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function buildEml({ from, to, cc, subject, message, files }) {
  const boundary = `nex-${Date.now().toString(16)}`;
  const headers = [
    `From: ${headerValue(from)}`,
    `To: ${headerValue(to)}`,
    cc ? `Cc: ${headerValue(cc)}` : "",
    `Subject: ${headerValue(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ].filter(Boolean);
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    message.replace(/\r?\n/g, "\r\n")
  ];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const safeName = file.name.replace(/[\r\n"]/g, "");
    parts.push(
      `--${boundary}`,
      `Content-Type: ${file.type || "application/octet-stream"}; name="${safeName}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeName}"`,
      "",
      wrapBase64(bytesToBase64(bytes))
    );
  }
  parts.push(`--${boundary}--`, "");
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

function requestGmailToken(clientId) {
  if (gmailToken.value && Date.now() < gmailToken.expires) return Promise.resolve(gmailToken.value);
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/gmail.send",
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
          return;
        }
        gmailToken = {
          value: response.access_token,
          expires: Date.now() + Math.max(30, (response.expires_in || 3600) - 60) * 1000
        };
        resolve(response.access_token);
      },
      error_callback: (err) => reject(new Error(err.message || "Google sign-in was closed."))
    });
    client.requestAccessToken();
  });
}

async function sendWithGmail(mail) {
  const clientId = localStorage.getItem(GMAIL_CLIENT_KEY) || "";
  if (!clientId) throw new Error("Add the Google Client ID in Settings, then press Send again.");
  if (location.protocol === "file:") throw new Error("Open this website from a web address such as http://127.0.0.1. Google cannot send mail from a file opened on the computer.");
  if (!window.google?.accounts?.oauth2) throw new Error("Google sign-in did not load. Check your internet connection and refresh.");
  const token = await requestGmailToken(clientId);
  const raw = textToBase64Url(await buildEml(mail));
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Gmail returned ${response.status}.`);
}

function showTemplates() {
  const picker = document.getElementById("template-picker");
  if (!picker.classList.contains("hidden")) {
    picker.classList.add("hidden");
    return;
  }
  picker.innerHTML = templates.length
    ? templates.map((template) => `
        <button type="button" data-template="${template.id}">
          ${escapeHtml(template.name)}
          <small>${escapeHtml(template.subject)}</small>
        </button>`).join("")
    : "<p>No templates yet. Add one on the Email Templates page.</p>";
  picker.classList.remove("hidden");
}

document.getElementById("compose-email").addEventListener("click", () => {
  const company = activeCompany();
  if (!company) return;
  resetCompose();
  composeForm.elements.to.value = company.email || "";
  composeDialog.showModal();
});
document.getElementById("cancel-compose").addEventListener("click", () => composeDialog.close());
document.getElementById("discard-compose").addEventListener("click", () => composeDialog.close());
document.getElementById("use-template").addEventListener("click", showTemplates);
document.getElementById("template-picker").addEventListener("click", (event) => {
  const button = event.target.closest("[data-template]");
  if (!button) return;
  const template = templates.find((item) => String(item.id) === button.dataset.template);
  if (!template) return;
  composeForm.elements.subject.value = template.subject;
  composeForm.elements.message.value = template.body;
  document.getElementById("template-picker").classList.add("hidden");
});
document.getElementById("add-attachment").addEventListener("click", () => {
  document.getElementById("mail-files").click();
});
document.getElementById("mail-files").addEventListener("change", (event) => {
  const status = document.getElementById("compose-status");
  const incoming = [...event.currentTarget.files];
  const tooBig = incoming.find((file) => file.size > 20 * 1024 * 1024);
  if (tooBig) {
    status.textContent = `${tooBig.name} is over 20 MB. Choose a smaller file.`;
  } else {
    status.textContent = "";
    incoming.forEach((file) => {
      const already = composeFiles.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified);
      if (!already) composeFiles.push(file);
    });
    renderComposeFiles();
  }
  event.currentTarget.value = "";
});
document.getElementById("attachment-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-file]");
  if (!button) return;
  composeFiles.splice(Number(button.dataset.removeFile), 1);
  renderComposeFiles();
});
composeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const company = activeCompany();
  if (!company) return;
  const data = new FormData(composeForm);
  const from = String(data.get("from") || "").trim();
  const to = String(data.get("to") || "").trim();
  const cc = String(data.get("cc") || "").trim();
  const subject = String(data.get("subject") || "").trim();
  const message = String(data.get("message") || "").trim();
  const status = document.getElementById("compose-status");
  const sendButton = composeForm.querySelector("[type=submit]");
  const attached = composeFiles.map((file) => file.name);
  sendButton.disabled = true;
  status.textContent = "Sending…";
  try {
    await sendWithGmail({ from, to, cc, subject, message, files: composeFiles });
    company.notes.unshift(makeNote({
      title: "Mail Sent",
      text: `From: ${from}\nTo: ${to}${cc ? `\nCc: ${cc}` : ""}\nSubject: ${subject}${attached.length ? `\nAttachments: ${attached.join(", ")}` : ""}\n\n${message}`,
      by: document.getElementById("user-label").textContent || "Team"
    }));
    composeDialog.close();
    renderCompanyDetail();
  } catch (err) {
    status.textContent = err.message;
  } finally {
    sendButton.disabled = false;
  }
});

document.getElementById("cancel-company").addEventListener("click", () => companyDialog.close());

companyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(companyForm);
  const name = String(data.get("company") || "").trim();
  const country = String(data.get("country") || "").trim();
  const industry = String(data.get("industry") || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (!name || !country || !industry.length) return;
  const record = {
    name,
    country,
    phone: String(data.get("phone") || "").trim(),
    email: String(data.get("email") || "").trim(),
    industry,
    type: data.get("type"),
    stage: data.get("stage"),
    priority: data.get("priority"),
    due: data.get("due") || "—"
  };
  const existing = companies.find((company) => String(company.id) === String(data.get("id")));
  if (existing) {
    Object.assign(existing, record);
    if (activeCompanyId === existing.id && !document.getElementById("company-detail").classList.contains("hidden")) renderCompanyDetail();
  } else companies.unshift({ id: nextCompanyId++, notes: [makeNote({ title: "Note Added", text: "Added to the Mini Radar outreach list.", by: "Team" })], ...record });
  renderCompanies();
  companyDialog.close();
});

const companyTypes = ["OEM", "ODM", "System Integrator", "Distributor", "Technology Partner", "End Customer"];
const importColumns = {
  name: ["company", "companyname", "name", "company name"],
  country: ["country"],
  phone: ["contactnumber", "contactno", "phone", "phonenumber", "mobile", "mobilenumber", "contact"],
  email: ["mailid", "email", "emailid", "mail", "emailaddress"],
  industry: ["industry", "industries"],
  type: ["type", "companytype", "prospecttype"],
  stage: ["stage", "pipelinestage"],
  priority: ["priority"],
  due: ["nextfollowup", "followup", "due", "duedate", "nextfollowupdate"]
};

function headerKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cellText(value) {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value ?? "").trim();
}

function pickOption(value, options, fallback) {
  const match = options.find((option) => headerKey(option) === headerKey(value));
  return match || fallback;
}

function readImportRow(row) {
  const byKey = {};
  Object.entries(row).forEach(([header, value]) => { byKey[headerKey(header)] = value; });
  const get = (field) => {
    const key = importColumns[field].map(headerKey).find((name) => name in byKey);
    return key ? cellText(byKey[key]) : "";
  };
  const due = get("due");
  return {
    name: get("name"),
    country: get("country"),
    phone: get("phone"),
    email: get("email"),
    industry: get("industry").split(/[,;|]/).map((item) => item.trim()).filter(Boolean),
    type: pickOption(get("type"), companyTypes, ""),
    stage: pickOption(get("stage"), stageNames, ""),
    priority: pickOption(get("priority"), ["High", "Medium", "Low"], ""),
    due: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : ""
  };
}

async function importCompanies(file) {
  const status = document.getElementById("import-status");
  if (!window.XLSX) {
    status.textContent = "The Excel reader did not load. Check your internet connection and refresh.";
    return;
  }
  status.textContent = `Reading ${file.name}…`;
  const workbook = window.XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: true });
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const user = document.getElementById("user-label").textContent || "Team";
  rows.forEach((row) => {
    const item = readImportRow(row);
    if (!item.name) {
      skipped += 1;
      return;
    }
    const existing = companies.find((company) => company.name.trim().toLowerCase() === item.name.toLowerCase());
    if (existing) {
      if (item.country) existing.country = item.country;
      if (item.phone) existing.phone = item.phone;
      if (item.email) existing.email = item.email;
      if (item.industry.length) existing.industry = item.industry;
      if (item.type) existing.type = item.type;
      if (item.stage) existing.stage = item.stage;
      if (item.priority) existing.priority = item.priority;
      if (item.due) existing.due = item.due;
      updated += 1;
    } else {
      companies.unshift({
        id: nextCompanyId++,
        name: item.name,
        country: item.country,
        phone: item.phone,
        email: item.email,
        industry: item.industry,
        type: item.type || "OEM",
        stage: item.stage || "Identified",
        priority: item.priority || "Medium",
        due: item.due || "—",
        notes: [makeNote({ title: "Note Added", text: `Imported from ${file.name}.`, by: user })]
      });
      added += 1;
    }
  });
  renderDashboard();
  renderCompanies();
  status.textContent = `Imported ${file.name}: ${added} added, ${updated} updated${skipped ? `, ${skipped} rows skipped because the company name was empty` : ""}.`;
}

document.getElementById("import-excel").addEventListener("click", () => {
  document.getElementById("import-file").click();
});
document.getElementById("import-file").addEventListener("change", async (event) => {
  const file = event.currentTarget.files[0];
  event.currentTarget.value = "";
  if (!file) return;
  try {
    await importCompanies(file);
  } catch (err) {
    document.getElementById("import-status").textContent = `Could not read ${file.name}: ${err.message}`;
  }
});

document.getElementById("export-csv").addEventListener("click", () => {
  const header = ["Company", "Country", "Contact Number", "Mail ID", "Industry", "Type", "Stage", "Priority", "Next Follow-up"];
  const lines = [header, ...filteredCompanies().map((c) => [
    c.name, c.country, c.phone || "", c.email || "", c.industry.join(" | "), c.type, c.stage, c.priority, c.due
  ])];
  const csv = lines.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "target-companies.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
    document.getElementById(`view-${btn.dataset.view}`).classList.remove("hidden");
    if (btn.dataset.view === "companies") showCompanyList();
  });
});

document.getElementById("global-search").addEventListener("input", (event) => {
  document.getElementById("company-filter").value = event.target.value;
  document.querySelector('[data-view="companies"]').click();
  renderCompanies();
});

const users = {
  monish: "Monish",
  padma: "Padma",
  vinu: "Vinu",
  akshay: "Akshay"
};
const sharedPassword = "nex";

function showUser(username) {
  const name = users[username];
  document.body.classList.remove("logged-out");
  document.getElementById("user-initials").textContent = name.slice(0, 2).toUpperCase();
  document.getElementById("user-label").textContent = name;
  document.getElementById("settings-name").value = name;
}

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const username = String(data.get("username") || "").trim().toLowerCase();
  const password = String(data.get("password") || "");
  const error = document.getElementById("login-error");
  if (users[username] && password === sharedPassword) {
    error.hidden = true;
    sessionStorage.setItem("nex-user", username);
    showUser(username);
    initData();
    return;
  }
  error.hidden = false;
});

document.getElementById("sign-out").addEventListener("click", () => {
  sessionStorage.removeItem("nex-user");
  document.body.classList.add("logged-out");
  document.getElementById("login-form").reset();
});

document.getElementById("sb-url").value = sbState.url;
document.getElementById("gmail-client").value = localStorage.getItem(GMAIL_CLIENT_KEY) || "";
document.getElementById("gmail-save").addEventListener("click", () => {
  const clientId = document.getElementById("gmail-client").value.trim();
  const status = document.getElementById("gmail-status");
  if (!clientId.endsWith(".apps.googleusercontent.com")) {
    status.textContent = "Paste the Client ID from Google Cloud. It ends with .apps.googleusercontent.com.";
    return;
  }
  localStorage.setItem(GMAIL_CLIENT_KEY, clientId);
  gmailToken = { value: "", expires: 0 };
  status.textContent = "Saved. Press Send on a company and allow Gmail once.";
});

function normalizeSbUrl(raw) {
  const text = String(raw || "").trim();
  // Accept the dashboard link too: .../dashboard/project/<ref>/... -> https://<ref>.supabase.co
  const dashboard = text.match(/dashboard\/project\/([a-z0-9]+)/i);
  if (dashboard) return `https://${dashboard[1].toLowerCase()}.supabase.co`;
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    return new URL(withProtocol).origin;
  } catch (err) {
    return withProtocol.replace(/\/+$/, "");
  }
}

document.getElementById("sb-connect").addEventListener("click", () => {
  sbState.url = normalizeSbUrl(document.getElementById("sb-url").value);
  document.getElementById("sb-url").value = sbState.url;
  const typedKey = document.getElementById("sb-key").value.trim();
  if (typedKey) sbState.key = typedKey;
  localStorage.setItem(SB_CONFIG_KEY, JSON.stringify({ url: sbState.url, key: sbState.key }));
  document.getElementById("sb-key").value = "";
  initData();
});

document.getElementById("sb-disconnect").addEventListener("click", () => {
  localStorage.removeItem(SB_CONFIG_KEY);
  sbState.url = "";
  sbState.key = "";
  sbState.client = null;
  sbState.ready = false;
  document.getElementById("sb-url").value = "";
  document.getElementById("sb-key").value = "";
  setDbStatus("Disconnected. Changes stay in this browser until Supabase is connected again.");
});

const savedUser = sessionStorage.getItem("nex-user");
if (users[savedUser]) {
  showUser(savedUser);
  initData();
}


const state = {
  token: "",
  biologist: null,
  view: "chat",
  protocols: [],
  selectedProtocolId: "",
  pollTimer: null,
  adminPatients: [],
  adminProtocols: []
};

const nodes = {
  loginCard: document.getElementById("loginCard"),
  app: document.getElementById("app"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  loginError: document.getElementById("loginError"),
  viewChatBtn: document.getElementById("viewChatBtn"),
  viewAdminBtn: document.getElementById("viewAdminBtn"),
  chatView: document.getElementById("chatView"),
  adminView: document.getElementById("adminView"),
  bioLabel: document.getElementById("bioLabel"),
  logoutBtn: document.getElementById("logoutBtn"),
  statusFilter: document.getElementById("statusFilter"),
  protocolList: document.getElementById("protocolList"),
  protocolTitle: document.getElementById("protocolTitle"),
  statusSelect: document.getElementById("statusSelect"),
  saveStatusBtn: document.getElementById("saveStatusBtn"),
  pdfLink: document.getElementById("pdfLink"),
  pdfPanel: document.getElementById("pdfPanel"),
  pdfEmbed: document.getElementById("pdfEmbed"),
  thread: document.getElementById("thread"),
  messageBody: document.getElementById("messageBody"),
  sendBtn: document.getElementById("sendBtn"),
  adminLabelBio: document.getElementById("adminLabelBio"),
  refreshAdminBtn: document.getElementById("refreshAdminBtn"),
  logoutBtnAdmin: document.getElementById("logoutBtnAdmin"),
  patientFormAdmin: document.getElementById("patientFormAdmin"),
  fullNameAdmin: document.getElementById("fullNameAdmin"),
  phoneAdmin: document.getElementById("phoneAdmin"),
  birthDateAdmin: document.getElementById("birthDateAdmin"),
  createPatientBtnAdmin: document.getElementById("createPatientBtnAdmin"),
  patientFeedbackAdmin: document.getElementById("patientFeedbackAdmin"),
  protocolFormAdmin: document.getElementById("protocolFormAdmin"),
  patientIdAdmin: document.getElementById("patientIdAdmin"),
  protocolTitleAdmin: document.getElementById("protocolTitleAdmin"),
  collectedAtAdmin: document.getElementById("collectedAtAdmin"),
  pdfUrlAdmin: document.getElementById("pdfUrlAdmin"),
  protocolStatusAdmin: document.getElementById("protocolStatusAdmin"),
  createProtocolBtnAdmin: document.getElementById("createProtocolBtnAdmin"),
  protocolFeedbackAdmin: document.getElementById("protocolFeedbackAdmin"),
  patientsTableAdmin: document.getElementById("patientsTableAdmin"),
  protocolsTableAdmin: document.getElementById("protocolsTableAdmin")
};

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusClass(status) {
  const clean = String(status || "").toLowerCase();
  if (clean === "answered") return "answered";
  if (clean === "closed") return "closed";
  return "open";
}

function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const frMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!frMatch) return null;
  const day = frMatch[1];
  const month = frMatch[2];
  const year = frMatch[3];
  return `${year}-${month}-${day}`;
}

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function setLoggedIn(on) {
  nodes.loginCard.style.display = on ? "none" : "block";
  nodes.app.style.display = on ? "grid" : "none";
}

function setView(nextView) {
  state.view = nextView;
  const onChat = nextView === "chat";
  nodes.chatView.style.display = onChat ? "grid" : "none";
  nodes.adminView.style.display = onChat ? "none" : "grid";
  nodes.viewChatBtn.classList.toggle("active", onChat);
  nodes.viewAdminBtn.classList.toggle("active", !onChat);
  window.location.hash = onChat ? "chat" : "admin";
}

function selectedProtocol() {
  return state.protocols.find((item) => item.id === state.selectedProtocolId) || null;
}

function renderProtocols() {
  if (!state.protocols.length) {
    nodes.protocolList.innerHTML = '<div class="empty">Aucun protocole trouve.</div>';
    return;
  }
  nodes.protocolList.innerHTML = state.protocols
    .map((item) => {
      const active = item.id === state.selectedProtocolId ? "active" : "";
      const status = statusClass(item.status);
      return `
        <article class="protocol ${active}" data-id="${item.id}">
          <div><strong>${item.title}</strong></div>
          <div class="muted">${item.patient_name || ""}</div>
          <div class="muted">Prelevement: ${item.collected_at || "-"}</div>
          <div class="status ${status}">${item.status || "open"}</div>
        </article>
      `;
    })
    .join("");
  nodes.protocolList.querySelectorAll(".protocol").forEach((el) => {
    el.onclick = () => {
      state.selectedProtocolId = el.dataset.id || "";
      renderProtocols();
      renderProtocolHeader();
      loadMessages();
    };
  });
}

function renderProtocolHeader() {
  const protocol = selectedProtocol();
  if (!protocol) {
    nodes.protocolTitle.textContent = "Selectionnez un protocole";
    nodes.pdfLink.style.display = "none";
    nodes.pdfPanel.style.display = "none";
    nodes.pdfEmbed.src = "about:blank";
    nodes.statusSelect.style.display = "none";
    nodes.saveStatusBtn.style.display = "none";
    return;
  }
  nodes.protocolTitle.textContent = `${protocol.title} - ${protocol.patient_name || ""}`;
  if (protocol.pdf_url) {
    nodes.pdfLink.href = protocol.pdf_url;
    nodes.pdfLink.style.display = "inline-flex";
    nodes.pdfEmbed.src = protocol.pdf_url;
    nodes.pdfPanel.style.display = "block";
  } else {
    nodes.pdfLink.style.display = "none";
    nodes.pdfPanel.style.display = "none";
    nodes.pdfEmbed.src = "about:blank";
  }
  nodes.statusSelect.value = protocol.status || "open";
  nodes.statusSelect.style.display = "inline-flex";
  nodes.saveStatusBtn.style.display = "inline-flex";
}

function renderThread(messages) {
  if (!messages.length) {
    nodes.thread.innerHTML = '<div class="empty">Aucun message.</div>';
    return;
  }
  nodes.thread.innerHTML = messages
    .map((message) => {
      const who = message.author_role === "biologist" ? "biologist" : "patient";
      return `
        <div class="bubble ${who}">
          <div class="meta">${message.author_name} • ${new Date(message.created_at).toLocaleString("fr-FR")}</div>
          <div>${message.body}</div>
        </div>
      `;
    })
    .join("");
  nodes.thread.scrollTop = nodes.thread.scrollHeight;
}

async function loadInbox() {
  const filter = nodes.statusFilter.value.trim();
  const query = filter ? `?status=${encodeURIComponent(filter)}` : "";
  const payload = await api(`/api/biologist/inbox${query}`);
  state.protocols = payload.protocols || [];
  if (!state.selectedProtocolId && state.protocols.length) {
    state.selectedProtocolId = state.protocols[0].id;
  }
  if (state.selectedProtocolId && !state.protocols.some((item) => item.id === state.selectedProtocolId)) {
    state.selectedProtocolId = state.protocols.length ? state.protocols[0].id : "";
  }
  renderProtocols();
  renderProtocolHeader();
}

async function loadMessages() {
  if (!state.selectedProtocolId) {
    renderThread([]);
    return;
  }
  const payload = await api(`/api/biologist/protocols/${state.selectedProtocolId}/messages`);
  renderThread(payload.messages || []);
}

async function saveStatus() {
  const protocol = selectedProtocol();
  if (!protocol) return;
  nodes.saveStatusBtn.disabled = true;
  try {
    await api(`/api/biologist/protocols/${protocol.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: nodes.statusSelect.value })
    });
    await loadInbox();
    await loadMessages();
    await loadAdminData();
  } catch (error) {
    alert(error.message);
  } finally {
    nodes.saveStatusBtn.disabled = false;
  }
}

async function submitMessage() {
  const protocol = selectedProtocol();
  const body = nodes.messageBody.value.trim();
  if (!protocol || !body) return;
  nodes.sendBtn.disabled = true;
  try {
    await api(`/api/biologist/protocols/${protocol.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ body })
    });
    nodes.messageBody.value = "";
    await loadInbox();
    await loadMessages();
    await loadAdminData();
  } catch (error) {
    alert(error.message);
  } finally {
    nodes.sendBtn.disabled = false;
  }
}

function renderAdminPatientSelect() {
  if (!state.adminPatients.length) {
    nodes.patientIdAdmin.innerHTML = '<option value="">Aucun patient</option>';
    return;
  }
  const previous = nodes.patientIdAdmin.value;
  nodes.patientIdAdmin.innerHTML = state.adminPatients
    .map((patient) => {
      const label = patient.phone
        ? `${patient.full_name} (${patient.phone})`
        : patient.full_name;
      return `<option value="${patient.id}">${escapeHtml(label)}</option>`;
    })
    .join("");
  if (previous && state.adminPatients.some((item) => item.id === previous)) {
    nodes.patientIdAdmin.value = previous;
  }
}

function renderAdminPatientsTable() {
  if (!state.adminPatients.length) {
    nodes.patientsTableAdmin.innerHTML = '<div class="empty">Aucun patient.</div>';
    return;
  }
  nodes.patientsTableAdmin.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Nom</th>
          <th>Telephone</th>
          <th>Naissance</th>
          <th>ID interne</th>
        </tr>
      </thead>
      <tbody>
        ${state.adminPatients
          .map(
            (patient) => `
              <tr>
                <td>${escapeHtml(patient.full_name)}</td>
                <td>${escapeHtml(patient.phone || "-")}</td>
                <td>${escapeHtml(patient.birth_date)}</td>
                <td>${escapeHtml(patient.dossier || "-")}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAdminProtocolsTable() {
  if (!state.adminProtocols.length) {
    nodes.protocolsTableAdmin.innerHTML = '<div class="empty">Aucun protocole.</div>';
    return;
  }
  nodes.protocolsTableAdmin.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Titre</th>
          <th>Patient</th>
          <th>Statut</th>
          <th>Date</th>
          <th>Messages</th>
          <th>PDF</th>
        </tr>
      </thead>
      <tbody>
        ${state.adminProtocols
          .map((protocol) => {
            const patientLabel = protocol.patient_phone
              ? `${protocol.patient_name || ""} (${protocol.patient_phone})`
              : protocol.patient_name || "";
            const safeTitle = escapeHtml(protocol.title);
            const safePatient = escapeHtml(patientLabel);
            const safeDate = escapeHtml(protocol.collected_at || "-");
            const safeStatus = escapeHtml(protocol.status || "open");
            const safeCount = escapeHtml(protocol.message_count);
            const statusBadge = `<span class="status ${statusClass(protocol.status)}">${safeStatus}</span>`;
            const pdfCell = protocol.pdf_url
              ? `<a href="${escapeHtml(protocol.pdf_url)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>`
              : "-";
            return `
              <tr>
                <td>${safeTitle}</td>
                <td>${safePatient}</td>
                <td>${statusBadge}</td>
                <td>${safeDate}</td>
                <td>${safeCount}</td>
                <td>${pdfCell}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderAdmin() {
  renderAdminPatientSelect();
  renderAdminPatientsTable();
  renderAdminProtocolsTable();
}

async function loadAdminData() {
  const [patientsRes, protocolsRes] = await Promise.all([
    api("/api/admin/patients"),
    api("/api/admin/protocols")
  ]);
  state.adminPatients = patientsRes.patients || [];
  state.adminProtocols = protocolsRes.protocols || [];
  renderAdmin();
}

function setFeedback(node, message, isError = false) {
  node.textContent = message;
  node.style.color = isError ? "#8e2f00" : "#2e5a39";
}

async function submitAdminPatient(event) {
  event.preventDefault();
  nodes.createPatientBtnAdmin.disabled = true;
  setFeedback(nodes.patientFeedbackAdmin, "");
  try {
    const cleanBirthDate = normalizeDateInput(nodes.birthDateAdmin.value);
    if (!cleanBirthDate) {
      throw new Error("Date de naissance invalide (YYYY-MM-DD ou DD/MM/YYYY)");
    }
    const payload = await api("/api/admin/patients", {
      method: "POST",
      body: JSON.stringify({
        full_name: nodes.fullNameAdmin.value.trim(),
        phone: nodes.phoneAdmin.value.trim(),
        birth_date: cleanBirthDate
      })
    });
    nodes.patientFormAdmin.reset();
    setFeedback(
      nodes.patientFeedbackAdmin,
      `Patient cree: ${payload.patient.phone || payload.patient.dossier}`
    );
    await loadAdminData();
  } catch (error) {
    setFeedback(nodes.patientFeedbackAdmin, error.message, true);
  } finally {
    nodes.createPatientBtnAdmin.disabled = false;
  }
}

async function submitAdminProtocol(event) {
  event.preventDefault();
  nodes.createProtocolBtnAdmin.disabled = true;
  setFeedback(nodes.protocolFeedbackAdmin, "");
  try {
    const cleanCollectedAt = normalizeDateInput(nodes.collectedAtAdmin.value);
    if (String(nodes.collectedAtAdmin.value || "").trim() && !cleanCollectedAt) {
      throw new Error("Date de prelevement invalide (YYYY-MM-DD ou DD/MM/YYYY)");
    }
    const payload = await api("/api/admin/protocols", {
      method: "POST",
      body: JSON.stringify({
        patient_id: nodes.patientIdAdmin.value,
        title: nodes.protocolTitleAdmin.value.trim(),
        collected_at: cleanCollectedAt,
        pdf_url: nodes.pdfUrlAdmin.value.trim(),
        status: nodes.protocolStatusAdmin.value
      })
    });
    nodes.protocolFormAdmin.reset();
    nodes.protocolStatusAdmin.value = "open";
    setFeedback(nodes.protocolFeedbackAdmin, `Protocole cree: ${payload.protocol.id}`);
    await loadAdminData();
    await loadInbox();
    await loadMessages();
  } catch (error) {
    setFeedback(nodes.protocolFeedbackAdmin, error.message, true);
  } finally {
    nodes.createProtocolBtnAdmin.disabled = false;
  }
}

function stopPolling() {
  if (!state.pollTimer) return;
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (state.view !== "chat") return;
    loadInbox()
      .then(loadMessages)
      .catch(() => {});
  }, 12000);
}

async function login() {
  nodes.loginError.textContent = "";
  nodes.loginBtn.disabled = true;
  try {
    const payload = await api("/api/biologist/login", {
      method: "POST",
      body: JSON.stringify({
        username: nodes.username.value.trim(),
        password: nodes.password.value
      })
    });
    state.token = payload.token;
    state.biologist = payload.biologist;
    nodes.bioLabel.textContent = `Inbox - ${payload.biologist.display_name}`;
    nodes.adminLabelBio.textContent = `Administration - ${payload.biologist.display_name}`;
    setLoggedIn(true);
    const initialView = window.location.hash.toLowerCase() === "#admin" ? "admin" : "chat";
    setView(initialView);
    await Promise.all([loadInbox().then(loadMessages), loadAdminData()]);
    startPolling();
  } catch (error) {
    nodes.loginError.textContent = error.message;
  } finally {
    nodes.loginBtn.disabled = false;
  }
}

function logout() {
  stopPolling();
  state.token = "";
  state.biologist = null;
  state.protocols = [];
  state.selectedProtocolId = "";
  state.adminPatients = [];
  state.adminProtocols = [];
  state.view = "chat";
  nodes.username.value = "";
  nodes.password.value = "";
  nodes.messageBody.value = "";
  nodes.patientFormAdmin.reset();
  nodes.protocolFormAdmin.reset();
  nodes.patientFeedbackAdmin.textContent = "";
  nodes.protocolFeedbackAdmin.textContent = "";
  nodes.patientsTableAdmin.innerHTML = "";
  nodes.protocolsTableAdmin.innerHTML = "";
  setLoggedIn(false);
  setView("chat");
}

nodes.loginBtn.onclick = login;
nodes.sendBtn.onclick = submitMessage;
nodes.saveStatusBtn.onclick = saveStatus;
nodes.logoutBtn.onclick = logout;
nodes.logoutBtnAdmin.onclick = logout;
nodes.statusFilter.onchange = () => {
  loadInbox().then(loadMessages).catch(() => {});
};
nodes.viewChatBtn.onclick = () => {
  setView("chat");
  loadInbox().then(loadMessages).catch(() => {});
};
nodes.viewAdminBtn.onclick = () => {
  setView("admin");
  loadAdminData().catch((error) => alert(error.message));
};
nodes.refreshAdminBtn.onclick = () => {
  loadAdminData().catch((error) => alert(error.message));
};
nodes.patientFormAdmin.onsubmit = submitAdminPatient;
nodes.protocolFormAdmin.onsubmit = submitAdminProtocol;

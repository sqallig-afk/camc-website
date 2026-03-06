const state = {
  token: "",
  patient: null,
  protocols: [],
  selectedProtocolId: "",
  pollTimer: null
};

const nodes = {
  loginCard: document.getElementById("loginCard"),
  app: document.getElementById("app"),
  phone: document.getElementById("phone"),
  birthDate: document.getElementById("birthDate"),
  loginBtn: document.getElementById("loginBtn"),
  loginError: document.getElementById("loginError"),
  patientLabel: document.getElementById("patientLabel"),
  logoutBtn: document.getElementById("logoutBtn"),
  protocolList: document.getElementById("protocolList"),
  protocolTitle: document.getElementById("protocolTitle"),
  pdfLink: document.getElementById("pdfLink"),
  pdfPanel: document.getElementById("pdfPanel"),
  pdfEmbed: document.getElementById("pdfEmbed"),
  thread: document.getElementById("thread"),
  messageBody: document.getElementById("messageBody"),
  sendBtn: document.getElementById("sendBtn")
};

function normalizePhoneInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const hasPlusPrefix = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return hasPlusPrefix ? `+${digits}` : digits;
}

function statusClass(status) {
  const clean = String(status || "").toLowerCase();
  if (clean === "answered") return "answered";
  if (clean === "closed") return "closed";
  return "open";
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
      renderSelectedProtocolHeader();
      loadMessages();
    };
  });
}

function renderSelectedProtocolHeader() {
  const protocol = state.protocols.find((item) => item.id === state.selectedProtocolId);
  if (!protocol) {
    nodes.protocolTitle.textContent = "Selectionnez un protocole";
    nodes.pdfLink.style.display = "none";
    nodes.pdfPanel.style.display = "none";
    nodes.pdfEmbed.src = "about:blank";
    return;
  }
  nodes.protocolTitle.textContent = protocol.title;
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
}

function renderThread(messages) {
  if (!messages.length) {
    nodes.thread.innerHTML = '<div class="empty">Aucun message pour le moment.</div>';
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

async function loadProtocols() {
  const payload = await api("/api/patient/protocols");
  state.protocols = payload.protocols || [];
  if (!state.selectedProtocolId && state.protocols.length) {
    state.selectedProtocolId = state.protocols[0].id;
  }
  renderProtocols();
  renderSelectedProtocolHeader();
}

async function loadMessages() {
  if (!state.selectedProtocolId) {
    renderThread([]);
    return;
  }
  const payload = await api(`/api/patient/protocols/${state.selectedProtocolId}/messages`);
  renderThread(payload.messages || []);
}

async function submitMessage() {
  const body = nodes.messageBody.value.trim();
  if (!body || !state.selectedProtocolId) return;
  nodes.sendBtn.disabled = true;
  try {
    await api(`/api/patient/protocols/${state.selectedProtocolId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body })
    });
    nodes.messageBody.value = "";
    await loadProtocols();
    await loadMessages();
  } catch (error) {
    alert(error.message);
  } finally {
    nodes.sendBtn.disabled = false;
  }
}

function setLoggedIn(on) {
  nodes.loginCard.style.display = on ? "none" : "block";
  nodes.app.style.display = on ? "grid" : "none";
}

function stopPolling() {
  if (!state.pollTimer) return;
  clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    loadProtocols()
      .then(loadMessages)
      .catch(() => {});
  }, 15000);
}

async function login() {
  nodes.loginError.textContent = "";
  nodes.loginBtn.disabled = true;
  try {
    const cleanPhone = normalizePhoneInput(nodes.phone.value);
    if (!cleanPhone) {
      throw new Error("Telephone invalide");
    }
    const payload = await api("/api/patient/login", {
      method: "POST",
      body: JSON.stringify({
        phone: cleanPhone,
        birth_date: nodes.birthDate.value
      })
    });
    state.token = payload.token;
    state.patient = payload.patient;
    nodes.patientLabel.textContent = payload.patient.phone
      ? `${payload.patient.full_name} (${payload.patient.phone})`
      : payload.patient.full_name;
    setLoggedIn(true);
    await loadProtocols();
    await loadMessages();
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
  state.patient = null;
  state.protocols = [];
  state.selectedProtocolId = "";
  nodes.phone.value = "";
  nodes.birthDate.value = "";
  nodes.messageBody.value = "";
  setLoggedIn(false);
}

nodes.loginBtn.onclick = login;
nodes.sendBtn.onclick = submitMessage;
nodes.logoutBtn.onclick = logout;

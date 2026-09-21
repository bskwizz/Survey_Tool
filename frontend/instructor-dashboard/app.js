// Live Classroom Survey - instructor dashboard (vanilla JS, no build step).

(function () {
  'use strict';

  const API_BASE = (window.CLASSROOM_SURVEY_CONFIG && window.CLASSROOM_SURVEY_CONFIG.BACKEND_BASE_URL) || '';
  const TOKEN_KEY = 'classroomSurvey.instructorToken';

  const els = {
    authStatus: document.getElementById('authStatus'),
    authPanel: document.getElementById('authPanel'),
    mainPanel: document.getElementById('mainPanel'),
    loginForm: document.getElementById('loginForm'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    showRegister: document.getElementById('showRegister'),
    registerForm: document.getElementById('registerForm'),
    registerEmail: document.getElementById('registerEmail'),
    registerPassword: document.getElementById('registerPassword'),
    authError: document.getElementById('authError'),

    presentationSelect: document.getElementById('presentationSelect'),
    newPresentationTitle: document.getElementById('newPresentationTitle'),
    createPresentationBtn: document.getElementById('createPresentationBtn'),

    slideRefInput: document.getElementById('slideRefInput'),
    questionTypeSelect: document.getElementById('questionTypeSelect'),
    promptInput: document.getElementById('promptInput'),
    optionsContainer: document.getElementById('optionsContainer'),
    createQuestionBtn: document.getElementById('createQuestionBtn'),

    questionList: document.getElementById('questionList'),
    questionDetail: document.getElementById('questionDetail'),
    detailContent: document.getElementById('detailContent'),
  };

  let socket = null;
  let presentations = [];
  let questions = [];
  let activeQuestionId = null;

  // ---------------- Auth ----------------

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  async function apiFetch(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  els.showRegister.addEventListener('click', () => {
    els.registerForm.classList.toggle('hidden');
  });

  els.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.authError.textContent = '';
    try {
      const { token } = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: els.loginEmail.value, password: els.loginPassword.value }),
      });
      setToken(token);
      await boot();
    } catch (err) {
      els.authError.textContent = err.message;
    }
  });

  els.registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.authError.textContent = '';
    try {
      const { token } = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: els.registerEmail.value, password: els.registerPassword.value }),
      });
      setToken(token);
      await boot();
    } catch (err) {
      els.authError.textContent = err.message;
    }
  });

  function renderAuthStatus() {
    if (getToken()) {
      els.authStatus.innerHTML = '<button id="signOutBtn" class="btn ghost">Sign out</button>';
      document.getElementById('signOutBtn').addEventListener('click', () => {
        clearToken();
        location.reload();
      });
    } else {
      els.authStatus.innerHTML = '';
    }
  }

  // ---------------- Presentations ----------------

  async function loadPresentations() {
    const { presentations: list } = await apiFetch('/api/presentations');
    presentations = list;
    els.presentationSelect.innerHTML = presentations
      .map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`)
      .join('');
  }

  els.createPresentationBtn.addEventListener('click', async () => {
    const title = els.newPresentationTitle.value.trim();
    if (!title) return;
    await apiFetch('/api/presentations', { method: 'POST', body: JSON.stringify({ title }) });
    els.newPresentationTitle.value = '';
    await loadPresentations();
  });

  // ---------------- Questions ----------------

  els.questionTypeSelect.addEventListener('change', renderOptionsInputs);
  renderOptionsInputsOnLoad();

  function renderOptionsInputsOnLoad() {
    renderOptionsInputs();
  }

  function renderOptionsInputs() {
    const allowMultipleLabel = document.getElementById('allowMultipleCreateLabel');
    if (allowMultipleLabel) allowMultipleLabel.classList.toggle('hidden', els.questionTypeSelect.value !== 'open_text');
    els.optionsContainer.innerHTML = '';
    if (els.questionTypeSelect.value !== 'multiple_choice') return;
    for (let i = 0; i < 4; i++) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Option ${i + 1}`;
      input.className = 'option-input';
      els.optionsContainer.appendChild(input);
    }
  }

  els.createQuestionBtn.addEventListener('click', async () => {
    const presentationId = els.presentationSelect.value;
    const slideRef = els.slideRefInput.value.trim() || 'slide-unspecified';
    const type = els.questionTypeSelect.value;
    const prompt = els.promptInput.value.trim();
    const options = Array.from(els.optionsContainer.querySelectorAll('.option-input'))
      .map((i) => i.value.trim())
      .filter(Boolean);

    if (!presentationId) return alert('Create or select a presentation first.');
    if (!prompt) return alert('Prompt is required.');

    const allowMultipleEl = document.getElementById('allowMultipleCreate');
    const allowMultiple = type === 'open_text' && !!(allowMultipleEl && allowMultipleEl.checked);

    try {
      await apiFetch('/api/questions', {
        method: 'POST',
        body: JSON.stringify({ presentationId, slideRef, type, prompt, options, allowMultiple }),
      });
      els.promptInput.value = '';
      await loadQuestions();
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadQuestions() {
    const presentationId = els.presentationSelect.value;
    if (!presentationId) return;
    const { questions: list } = await apiFetch(`/api/presentations/${presentationId}/questions`);
    questions = list;
    renderQuestionList();
  }

  els.presentationSelect.addEventListener('change', loadQuestions);

  function renderQuestionList() {
    els.questionList.innerHTML = questions
      .map(
        (q) => `
      <div class="question-row" data-id="${q.id}">
        <div>
          <strong>${escapeHtml(q.prompt)}</strong>
          <div class="qmeta">${q.type} · ${escapeHtml(q.slideRef)} · <span class="status-pill ${q.status}">${q.status}</span></div>
        </div>
        <div>
          <button class="btn ghost view-btn" data-id="${q.id}">View</button>
        </div>
      </div>`
      )
      .join('');

    Array.from(els.questionList.querySelectorAll('.view-btn')).forEach((btn) => {
      btn.addEventListener('click', () => openQuestionDetail(btn.dataset.id));
    });
  }

  // ---------------- Question detail (live aggregate + synthesis) ----------------

  async function openQuestionDetail(questionId) {
    activeQuestionId = questionId;
    els.questionDetail.classList.remove('hidden');
    if (socket) {
      socket.emit('join:question', questionId);
    }
    await refreshDetail();
  }

  async function refreshDetail() {
    if (!activeQuestionId) return;
    const [{ question }, aggResult, synthResult, respResult, qrResult] = await Promise.all([
      apiFetch(`/api/questions/${activeQuestionId}`),
      apiFetch(`/api/questions/${activeQuestionId}/aggregate`).catch(() => ({ aggregate: null })),
      apiFetch(`/api/questions/${activeQuestionId}/synthesis`).catch(() => ({ synthesis: null })),
      apiFetch(`/api/questions/${activeQuestionId}/responses`).catch(() => ({ responses: [] })),
      apiFetch(`/api/questions/${activeQuestionId}/qrcode`).catch(() => ({ qrDataUri: null, participantUrl: '' })),
    ]);
    renderDetail(question, aggResult.aggregate, synthResult.synthesis, respResult.responses, qrResult);
  }

  function renderDetail(question, aggregate, synthesis, responses, qr) {
    const isOpenText = question.type === 'open_text';
    els.detailContent.innerHTML = `
      <div class="inline-form">
        <button class="btn secondary" id="startBtn">Start collecting</button>
        <button class="btn ghost" id="stopBtn">Stop</button>
        <button class="btn danger" id="clearBtn">Clear responses</button>
        <label><input type="checkbox" id="showSynthesisToggle" ${question.showSynthesisOnSlide ? 'checked' : ''}/> Show synthesis on slide</label>
        ${isOpenText ? `<label><input type="checkbox" id="allowMultipleToggle" ${question.allowMultiple ? 'checked' : ''}/> Allow multiple answers per person</label>` : ''}
      </div>
      <div class="detail-grid">
        <div>
          <h4>QR / Join link</h4>
          ${qr.qrDataUri ? `<img src="${qr.qrDataUri}" width="140" height="140" alt="QR code" />` : ''}
          <p class="hint">${escapeHtml(qr.participantUrl || '')}</p>
          ${isOpenText ? '' : renderAggregateHtml(aggregate)}
        </div>
        <div class="synthesis-block">
          ${isOpenText ? renderSynthesisHtml(synthesis, aggregate) : ''}
        </div>
      </div>
      <h4>Raw responses (${responses.length})</h4>
      <div>${responses.map((r) => `<div class="raw-response">${escapeHtml(String(r.value))} <span class="hint">(${r.createdAt})</span></div>`).join('') || '<p class="hint">No responses yet.</p>'}</div>
    `;

    document.getElementById('startBtn').addEventListener('click', () => questionAction('start'));
    document.getElementById('stopBtn').addEventListener('click', () => questionAction('stop'));
    document.getElementById('clearBtn').addEventListener('click', () => questionAction('clear'));
    document.getElementById('showSynthesisToggle').addEventListener('change', async (e) => {
      await apiFetch(`/api/questions/${question.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ showSynthesisOnSlide: e.target.checked }),
      });
    });
    const allowMultipleToggle = document.getElementById('allowMultipleToggle');
    if (allowMultipleToggle) {
      allowMultipleToggle.addEventListener('change', async (e) => {
        await apiFetch(`/api/questions/${question.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ allowMultiple: e.target.checked }),
        });
      });
    }
  }

  function renderAggregateHtml(aggregate) {
    if (!aggregate) return '<p class="hint">No responses yet.</p>';
    if (aggregate.type === 'rating') {
      return `<p>Average: <strong>${aggregate.average}</strong> · Responses: ${aggregate.responseCount} · Consensus: ${aggregate.consensus}</p>` + distributionBars(aggregate.distribution);
    }
    if (aggregate.distribution) {
      return `<p>Responses: ${aggregate.responseCount} · Consensus: ${aggregate.consensus} (entropy ${aggregate.entropy})</p>` + distributionBars(aggregate.distribution);
    }
    return `<p>Responses: ${aggregate.responseCount || 0}</p>`;
  }

  function distributionBars(distribution) {
    if (!distribution) return '';
    return Object.entries(distribution)
      .map(
        ([key, stats]) => `
      <div class="bar-row">
        <div>${escapeHtml(key)}: ${stats.count} (${stats.percentage}%)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${stats.percentage}%"></div></div>
      </div>`
      )
      .join('');
  }

  function renderSynthesisHtml(synthesis) {
    if (!synthesis) return '<p class="hint">No synthesis yet - waiting for enough open-text responses to batch.</p>';
    const s = synthesis.summaryJson;
    const section = (title, items) =>
      items && items.length ? `<h4>${title}</h4><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '';
    return `
      <p class="hint">Synthesis v${synthesis.version} · based on ${s.responseCountIncluded} responses · ${s.generatedBy}</p>
      ${section('Themes', s.themes)}
      ${section('Agreements', s.agreements)}
      ${section('Disagreements', s.disagreements)}
      ${section('Misconceptions', s.misconceptions)}
      ${section('Outliers', s.outliers)}
      ${section('Emerging patterns', s.emergingPatterns)}
      ${section('Suggested discussion questions', s.suggestedDiscussionQuestions)}
    `;
  }

  async function questionAction(action) {
    if (!activeQuestionId) return;
    await apiFetch(`/api/questions/${activeQuestionId}/${action}`, { method: 'POST' });
    await refreshDetail();
    await loadQuestions();
  }

  // ---------------- Sockets ----------------

  function connectSocket() {
    socket = io(API_BASE || undefined, { transports: ['websocket', 'polling'] });
    socket.on('response:new', (payload) => {
      if (payload.questionId === activeQuestionId) refreshDetail();
    });
    socket.on('synthesis:updated', (payload) => {
      if (payload.questionId === activeQuestionId) refreshDetail();
    });
    socket.on('question:status', () => {
      loadQuestions();
    });
  }

  // ---------------- Boot ----------------

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function boot() {
    renderAuthStatus();
    if (!getToken()) {
      els.authPanel.classList.remove('hidden');
      els.mainPanel.classList.add('hidden');
      return;
    }
    els.authPanel.classList.add('hidden');
    els.mainPanel.classList.remove('hidden');
    try {
      await loadPresentations();
      if (presentations.length) await loadQuestions();
      connectSocket();
    } catch (err) {
      // Token likely expired/invalid.
      clearToken();
      location.reload();
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();

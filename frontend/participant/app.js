// Live Classroom Survey - participant app (vanilla JS, no build step).
//
// Flow: landing at /join/:shortCode?q=:questionId -> fetch the question ->
// render the right input for its type -> submit -> thank-you / live
// aggregate -> stay connected via Socket.IO so the instructor can push a
// brand new question into this same session without a re-scan.

(function () {
  'use strict';

  const API_BASE = (window.CLASSROOM_SURVEY_CONFIG && window.CLASSROOM_SURVEY_CONFIG.BACKEND_BASE_URL) || '';
  const TOKEN_KEY = 'classroomSurvey.participantToken';

  const els = {
    statusLine: document.getElementById('statusLine'),
    questionView: document.getElementById('questionView'),
    questionMeta: document.getElementById('questionMeta'),
    questionPrompt: document.getElementById('questionPrompt'),
    answerArea: document.getElementById('answerArea'),
    submitBtn: document.getElementById('submitBtn'),
    thankYouView: document.getElementById('thankYouView'),
    liveAggregate: document.getElementById('liveAggregate'),
    waitingView: document.getElementById('waitingView'),
    errorView: document.getElementById('errorView'),
    errorMessage: document.getElementById('errorMessage'),
  };

  let socket = null;
  let currentQuestion = null;
  let selectedValue = null;

  function showOnly(viewEl) {
    [els.questionView, els.thankYouView, els.waitingView, els.errorView].forEach((el) => {
      el.classList.toggle('hidden', el !== viewEl);
    });
  }

  function showError(message) {
    els.errorMessage.textContent = message;
    showOnly(els.errorView);
  }

  function getOrCreateStoredToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function storeToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  async function apiFetch(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getOrCreateStoredToken();
    if (token) headers['x-participant-token'] = token;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function ensureParticipantToken() {
    const { participantToken } = await apiFetch('/api/join', { method: 'POST' });
    storeToken(participantToken);
    return participantToken;
  }

  function parseLocation() {
    // Expected path: /join/<shortCode> ; query string: ?q=<questionId>
    const parts = window.location.pathname.split('/').filter(Boolean);
    const shortCode = parts[1] || null; // parts[0] === 'join'
    const params = new URLSearchParams(window.location.search);
    const questionId = params.get('q');
    return { shortCode, questionId };
  }

  function renderQuestion(question) {
    currentQuestion = question;
    selectedValue = null;
    els.submitBtn.disabled = true;
    els.questionMeta.textContent = question.type.replace('_', ' ').toUpperCase();
    els.questionPrompt.textContent = question.prompt;
    els.answerArea.innerHTML = '';

    if (question.type === 'multiple_choice') {
      question.options.forEach((opt) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'option-btn';
        btn.textContent = opt;
        btn.addEventListener('click', () => selectOption(btn, opt));
        els.answerArea.appendChild(btn);
      });
    } else if (question.type === 'rating') {
      const row = document.createElement('div');
      row.className = 'rating-row';
      for (let i = 1; i <= 5; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'option-btn';
        btn.textContent = String(i);
        btn.addEventListener('click', () => selectOption(btn, i));
        row.appendChild(btn);
      }
      els.answerArea.appendChild(row);
    } else if (question.type === 'open_text') {
      const textarea = document.createElement('textarea');
      textarea.className = 'open-text';
      textarea.placeholder = 'Type your answer…';
      textarea.maxLength = 2000;
      textarea.addEventListener('input', () => {
        selectedValue = textarea.value.trim();
        els.submitBtn.disabled = selectedValue.length === 0;
      });
      els.answerArea.appendChild(textarea);
    } else {
      // Unknown/future question type: fall back to a generic text input so
      // the app degrades gracefully instead of breaking.
      const textarea = document.createElement('textarea');
      textarea.className = 'open-text';
      textarea.placeholder = 'Type your answer…';
      textarea.addEventListener('input', () => {
        selectedValue = textarea.value.trim();
        els.submitBtn.disabled = selectedValue.length === 0;
      });
      els.answerArea.appendChild(textarea);
    }

    showOnly(els.questionView);
  }

  function selectOption(btn, value) {
    Array.from(els.answerArea.querySelectorAll('.option-btn')).forEach((b) =>
      b.classList.remove('selected')
    );
    btn.classList.add('selected');
    selectedValue = value;
    els.submitBtn.disabled = false;
  }

  async function submitResponse() {
    if (!currentQuestion || selectedValue === null || selectedValue === '') return;
    els.submitBtn.disabled = true;
    els.submitBtn.textContent = 'Submitting…';
    try {
      const { aggregate } = await apiFetch('/api/responses', {
        method: 'POST',
        body: JSON.stringify({ questionId: currentQuestion.id, value: selectedValue }),
      });
      renderThankYou(aggregate);
    } catch (err) {
      showError(err.message);
    } finally {
      els.submitBtn.textContent = 'Submit';
    }
  }

  function renderThankYou(aggregate) {
    showOnly(els.thankYouView);
    renderLiveAggregate(aggregate);
  }

  function renderLiveAggregate(aggregate) {
    if (!aggregate || !aggregate.distribution) {
      els.liveAggregate.innerHTML = '';
      return;
    }
    els.liveAggregate.innerHTML = '';
    Object.entries(aggregate.distribution).forEach(([key, stats]) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `
        <div>${key}: ${stats.count} (${stats.percentage}%)</div>
        <div class="bar-track"><div class="bar-fill" style="width:${stats.percentage}%"></div></div>
      `;
      els.liveAggregate.appendChild(row);
    });
  }

  function connectSocket(shortCode, questionId) {
    socket = io(API_BASE || undefined, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => {
      els.statusLine.textContent = 'Connected';
      if (shortCode) socket.emit('join:session', shortCode);
      if (questionId) socket.emit('join:question', questionId);
    });

    socket.on('disconnect', () => {
      els.statusLine.textContent = 'Reconnecting…';
    });

    socket.on('response:new', (payload) => {
      if (currentQuestion && payload.questionId === currentQuestion.id) {
        renderLiveAggregate(payload.aggregate);
      }
    });

    socket.on('question:status', (payload) => {
      if (currentQuestion && payload.questionId === currentQuestion.id && payload.status === 'closed') {
        els.statusLine.textContent = 'This question is now closed.';
      }
    });

    // Instructor pushed a brand-new live question to this session - reload
    // it without requiring the participant to rescan the QR code.
    socket.on('question:push', async (payload) => {
      if (!payload || !payload.questionId) return;
      socket.emit('join:question', payload.questionId);
      try {
        const { question } = await apiFetch(`/api/questions/${payload.questionId}`);
        renderQuestion(question);
      } catch (err) {
        showError(err.message);
      }
    });
  }

  async function init() {
    els.submitBtn.addEventListener('click', submitResponse);
    const { shortCode, questionId } = parseLocation();

    try {
      await ensureParticipantToken();
      connectSocket(shortCode, questionId);

      if (!questionId) {
        showOnly(els.waitingView);
        return;
      }

      const { question } = await apiFetch(`/api/questions/${questionId}`);
      if (question.status === 'collecting') {
        renderQuestion(question);
      } else {
        showOnly(els.waitingView);
      }
    } catch (err) {
      showError(err.message);
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

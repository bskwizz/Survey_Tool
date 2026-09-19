/**
 * Live Classroom Survey - PowerPoint Task Pane Add-in logic.
 * ============================================================================
 * IMPORTANT - Slide Show limitation (read this first):
 *
 * Office.js task panes - and therefore every API call in this file that
 * writes to the slide (PowerPoint.run, shape.textFrame.textRange.text = ...,
 * slide.shapes.addImage, etc.) - ONLY function while PowerPoint is in
 * Normal/Editing view. Once the presenter starts a full-screen Slide Show
 * (View > Slide Show / Present), the task pane is not rendered and none of
 * these calls can run, because the Slide Show surface is a separate,
 * non-extensible rendering surface without an add-in host.
 *
 * WORKAROUND: PowerPoint supports "Present" > "Browse" mode - specifically,
 * starting the presentation via "Set Up Slide Show" > "Browsed by an
 * individual (window)" instead of the full-screen "Presented by a speaker"
 * mode. In windowed/browsed mode, PowerPoint keeps its normal application
 * chrome (ribbon, task panes) visible alongside the slide content, so this
 * task pane keeps working - the instructor can click "Refresh slide now"
 * (below) while presenting to pull the latest aggregate/synthesis onto the
 * slide's placeholder shape. This is the officially documented workaround;
 * there is no supported way to run task pane JS during a true full-screen
 * Slide Show. Document this limitation for instructors during onboarding.
 * ============================================================================
 */

(function () {
  'use strict';

  // Replace with your deployed HTTPS backend URL before publishing.
  const API_BASE = 'https://localhost:3000';
  const TOKEN_KEY_SETTING = 'classroomSurvey.instructorToken';
  const SLIDE_QUESTION_MAP_SETTING = 'classroomSurvey.slideQuestionMap'; // { [slideId]: questionId }

  let currentSlideId = null;
  let currentQuestion = null;

  const els = {};

  Office.onReady((info) => {
    if (info.host !== Office.HostType.PowerPoint) {
      setStatus('This add-in only supports PowerPoint.');
      return;
    }
    cacheElements();
    wireEvents();
    setStatus('Ready.');
    checkAuthAndLoad();
  });

  function cacheElements() {
    [
      'statusLine', 'authSection', 'emailInput', 'passwordInput', 'signInBtn', 'authError',
      'mainSection', 'slideIdLine', 'noQuestionBlock', 'presentationSelect', 'typeSelect',
      'promptInput', 'optionsBlock', 'createBtn', 'existingQuestionBlock', 'existingPrompt',
      'existingStatus', 'startBtn', 'stopBtn', 'refreshBtn', 'synthesisToggle',
      'responseCountLine', 'actionStatus',
    ].forEach((id) => { els[id] = document.getElementById(id); });
  }

  function wireEvents() {
    els.signInBtn.addEventListener('click', handleSignIn);
    els.typeSelect.addEventListener('change', renderOptionInputs);
    els.createBtn.addEventListener('click', handleCreateQuestion);
    els.startBtn.addEventListener('click', () => handleQuestionAction('start'));
    els.stopBtn.addEventListener('click', () => handleQuestionAction('stop'));
    els.refreshBtn.addEventListener('click', handleRefreshSlide);
    els.synthesisToggle.addEventListener('change', handleToggleSynthesis);
    renderOptionInputs();
  }

  function setStatus(msg) { els.statusLine.textContent = msg; }
  function setActionStatus(msg) { els.actionStatus.textContent = msg; }

  // ---------------- Auth (stored in Office roaming settings) ----------------

  function getStoredToken() {
    return Office.context.document.settings.get(TOKEN_KEY_SETTING);
  }

  function storeToken(token) {
    Office.context.document.settings.set(TOKEN_KEY_SETTING, token);
    Office.context.document.settings.saveAsync();
  }

  async function apiFetch(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    const token = getStoredToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function handleSignIn() {
    els.authError.textContent = '';
    try {
      const { token } = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: els.emailInput.value, password: els.passwordInput.value }),
      });
      storeToken(token);
      await checkAuthAndLoad();
    } catch (err) {
      els.authError.textContent = err.message;
    }
  }

  async function checkAuthAndLoad() {
    if (!getStoredToken()) {
      els.authSection.classList.remove('hidden');
      els.mainSection.classList.add('hidden');
      return;
    }
    els.authSection.classList.add('hidden');
    els.mainSection.classList.remove('hidden');
    await loadPresentationsIntoSelect();
    await refreshForCurrentSlide();
  }

  async function loadPresentationsIntoSelect() {
    try {
      const { presentations } = await apiFetch('/api/presentations');
      els.presentationSelect.innerHTML = presentations
        .map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`)
        .join('');
    } catch (err) {
      setActionStatus(`Could not load presentations: ${err.message}`);
    }
  }

  // ---------------- Slide <-> question mapping ----------------

  function getSlideQuestionMap() {
    return Office.context.document.settings.get(SLIDE_QUESTION_MAP_SETTING) || {};
  }

  function setSlideQuestionId(slideId, questionId) {
    const map = getSlideQuestionMap();
    map[slideId] = questionId;
    Office.context.document.settings.set(SLIDE_QUESTION_MAP_SETTING, map);
    Office.context.document.settings.saveAsync();
  }

  async function getCurrentSlideId() {
    return PowerPoint.run(async (context) => {
      const slides = context.presentation.getSelectedSlides();
      slides.load('items');
      await context.sync();
      if (slides.items.length === 0) {
        throw new Error('Select a slide first.');
      }
      const slide = slides.items[0];
      slide.load('id');
      await context.sync();
      return slide.id;
    });
  }

  async function refreshForCurrentSlide() {
    try {
      currentSlideId = await getCurrentSlideId();
      els.slideIdLine.textContent = `Slide: ${currentSlideId}`;
      const map = getSlideQuestionMap();
      const questionId = map[currentSlideId];

      if (!questionId) {
        currentQuestion = null;
        els.noQuestionBlock.classList.remove('hidden');
        els.existingQuestionBlock.classList.add('hidden');
        return;
      }

      const { question } = await apiFetch(`/api/questions/${questionId}`);
      currentQuestion = question;
      els.noQuestionBlock.classList.add('hidden');
      els.existingQuestionBlock.classList.remove('hidden');
      els.existingPrompt.textContent = question.prompt;
      els.existingStatus.textContent = `Type: ${question.type} · Status: ${question.status}`;
      els.synthesisToggle.checked = !!question.showSynthesisOnSlide;
      await updateResponseCountLine();
    } catch (err) {
      setActionStatus(err.message);
    }
  }

  async function updateResponseCountLine() {
    if (!currentQuestion) return;
    try {
      const { aggregate } = await apiFetch(`/api/questions/${currentQuestion.id}/aggregate`);
      els.responseCountLine.textContent = `Responses: ${aggregate.responseCount}`;
    } catch (_err) {
      els.responseCountLine.textContent = '';
    }
  }

  // ---------------- Create question for current slide ----------------

  function renderOptionInputs() {
    els.optionsBlock.innerHTML = '';
    if (els.typeSelect.value !== 'multiple_choice') return;
    for (let i = 0; i < 4; i++) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = `Option ${i + 1}`;
      input.className = 'mc-option';
      els.optionsBlock.appendChild(input);
    }
  }

  async function handleCreateQuestion() {
    setActionStatus('Creating question…');
    try {
      const presentationId = els.presentationSelect.value;
      const type = els.typeSelect.value;
      const prompt = els.promptInput.value.trim();
      const options = Array.from(els.optionsBlock.querySelectorAll('.mc-option'))
        .map((i) => i.value.trim())
        .filter(Boolean);

      if (!presentationId) throw new Error('Select or create a presentation on the dashboard first.');
      if (!prompt) throw new Error('Prompt is required.');
      if (!currentSlideId) currentSlideId = await getCurrentSlideId();

      const { question, participantUrl } = await apiFetch('/api/questions', {
        method: 'POST',
        body: JSON.stringify({ presentationId, slideRef: currentSlideId, type, prompt, options }),
      });

      setSlideQuestionId(currentSlideId, question.id);
      await insertQrAndPlaceholderOnSlide(question.id, participantUrl);
      await refreshForCurrentSlide();
      setActionStatus('Question created and QR code inserted on the slide.');
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  /**
   * Inserts two shapes on the current slide:
   *   1. A Picture shape containing the QR code (fetched from the backend
   *      as a data URI so it can be embedded directly, avoiding any need
   *      for the add-in to handle raw binary image insertion plumbing).
   *   2. A text box placeholder that "Refresh slide now" will keep updated
   *      with the latest aggregate/synthesis text.
   * Both are tagged with a name (`ClassroomSurveyQR`, `ClassroomSurveyText`)
   * so future refreshes can find and update/replace them instead of
   * duplicating shapes on every refresh.
   */
  async function insertQrAndPlaceholderOnSlide(questionId, participantUrl) {
    const { qrDataUri } = await apiFetch(`/api/questions/${questionId}/qrcode`);
    const base64 = qrDataUri.split(',')[1]; // strip "data:image/png;base64,"

    await PowerPoint.run(async (context) => {
      const slides = context.presentation.getSelectedSlides();
      slides.load('items');
      await context.sync();
      const slide = slides.items[0];

      const existingShapes = slide.shapes;
      existingShapes.load('items/name');
      await context.sync();

      // Remove any previous QR/placeholder shapes from an earlier question
      // on this same slide before inserting fresh ones.
      for (const shape of existingShapes.items) {
        if (shape.name === 'ClassroomSurveyQR' || shape.name === 'ClassroomSurveyText') {
          shape.delete();
        }
      }
      await context.sync();

      const qrShape = slide.shapes.addImage(base64, {
        left: 20,
        top: 20,
        height: 160,
        width: 160,
      });
      qrShape.name = 'ClassroomSurveyQR';

      const textShape = slide.shapes.addTextBox(`Scan to answer! ${participantUrl}\nResponses: 0`, {
        left: 200,
        top: 20,
        height: 160,
        width: 380,
      });
      textShape.name = 'ClassroomSurveyText';
      textShape.textFrame.textRange.font.size = 14;

      await context.sync();
    });
  }

  // ---------------- Start/Stop/Refresh ----------------

  async function handleQuestionAction(action) {
    if (!currentQuestion) return;
    setActionStatus(`${action === 'start' ? 'Starting' : 'Stopping'} collection…`);
    try {
      await apiFetch(`/api/questions/${currentQuestion.id}/${action}`, { method: 'POST' });
      await refreshForCurrentSlide();
      setActionStatus('Done.');
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  async function handleToggleSynthesis(e) {
    if (!currentQuestion) return;
    try {
      await apiFetch(`/api/questions/${currentQuestion.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ showSynthesisOnSlide: e.target.checked }),
      });
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  /**
   * "Refresh slide now": re-fetches the latest aggregate (and synthesis, if
   * `showSynthesisOnSlide` is on) and rewrites the placeholder text box's
   * `textFrame.textRange.text`, and swaps the QR image (in case the short
   * URL was regenerated). This is the supported way to keep the slide's
   * on-canvas results current, including during "Browsed by an individual
   * (window)" presenting mode - see the file-level comment above.
   */
  async function handleRefreshSlide() {
    if (!currentQuestion) return;
    setActionStatus('Refreshing…');
    try {
      const [{ aggregate }, synthResult, qrResult] = await Promise.all([
        apiFetch(`/api/questions/${currentQuestion.id}/aggregate`),
        currentQuestion.showSynthesisOnSlide
          ? apiFetch(`/api/questions/${currentQuestion.id}/synthesis`)
          : Promise.resolve({ synthesis: null }),
        apiFetch(`/api/questions/${currentQuestion.id}/qrcode`),
      ]);

      const summaryText = buildSlideSummaryText(aggregate, synthResult.synthesis, qrResult.participantUrl);

      await PowerPoint.run(async (context) => {
        const slides = context.presentation.getSelectedSlides();
        slides.load('items');
        await context.sync();
        const slide = slides.items[0];
        const shapes = slide.shapes;
        shapes.load('items/name');
        await context.sync();

        const textShape = shapes.items.find((s) => s.name === 'ClassroomSurveyText');
        if (textShape) {
          textShape.textFrame.textRange.text = summaryText;
        }
        await context.sync();
      });

      await updateResponseCountLine();
      setActionStatus('Slide refreshed.');
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  function buildSlideSummaryText(aggregate, synthesis, participantUrl) {
    const lines = [`Scan to answer! ${participantUrl}`, `Responses: ${aggregate ? aggregate.responseCount : 0}`];
    if (aggregate && aggregate.distribution) {
      for (const [key, stats] of Object.entries(aggregate.distribution)) {
        lines.push(`${key}: ${stats.count} (${stats.percentage}%)`);
      }
    }
    if (synthesis && synthesis.summaryJson) {
      lines.push('', 'Top themes:');
      (synthesis.summaryJson.themes || []).slice(0, 3).forEach((t) => lines.push(`- ${t}`));
    }
    return lines.join('\n');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();

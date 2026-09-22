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

  // The task pane is served by the same host as the API, so derive the
  // base URL from our own origin. No per-deployment edit needed here; only
  // manifest.xml carries the deployed hostname.
  const API_BASE = window.location.origin;
  const AUTO_REFRESH_MS = 5000;
  let autoRefreshTimer = null;
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
      'autoRefreshToggle', 'clearBtn', 'removeBtn', 'responseCountLine', 'actionStatus',
      'allowMultipleCreate', 'allowMultipleCreateLabel', 'allowMultipleToggle', 'allowMultipleLabel',
      'signOutBtn',
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
    els.allowMultipleToggle.addEventListener('change', handleToggleAllowMultiple);
    els.signOutBtn.addEventListener('click', () => signOut(''));
    els.autoRefreshToggle.addEventListener('change', handleToggleAutoRefresh);
    els.clearBtn.addEventListener('click', () => confirmThen(els.clearBtn, 'Clear responses', handleClearResponses));
    els.removeBtn.addEventListener('click', () => confirmThen(els.removeBtn, 'Remove from slide', handleRemoveFromSlide));
    renderOptionInputs();
  }

  // ---------------- Two-click confirmation ----------------
  //
  // Native confirm() dialogs are unreliable inside Office task panes, so a
  // destructive button arms itself on the first click and only acts if
  // clicked again within a few seconds.

  const ARM_MS = 6000;
  function confirmThen(button, label, action) {
    if (button.dataset.armed === '1') {
      disarm(button, label);
      action();
      return;
    }
    button.dataset.armed = '1';
    button.classList.add('armed');
    button.textContent = 'Click again to confirm';
    setActionStatus(`${label}: click the button again within ${ARM_MS / 1000}s to confirm.`);
    button._disarmTimer = setTimeout(() => {
      disarm(button, label);
      setActionStatus('Cancelled.');
    }, ARM_MS);
  }

  function disarm(button, label) {
    clearTimeout(button._disarmTimer);
    button.dataset.armed = '0';
    button.classList.remove('armed');
    button.textContent = label;
  }

  // ---------------- Auto-refresh (keeps the slide live while presenting) ----------------
  //
  // Polls the backend and rewrites the slide's result text box every few
  // seconds while the task pane is open. Combined with "Browsed by an
  // individual (window)" presenting mode this gives effectively live
  // results on the slide without the instructor clicking anything.

  function handleToggleAutoRefresh(e) {
    if (e.target.checked) startAutoRefresh();
    else stopAutoRefresh();
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => {
      if (currentQuestion) handleRefreshSlide({ quiet: true });
    }, AUTO_REFRESH_MS);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
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
    if (res.status === 401 && token) {
      // The instructor token expired or was revoked: drop it and go back to
      // the sign-in form instead of leaving a half-working pane.
      signOut('Your session expired. Please sign in again.');
      throw new Error('Session expired');
    }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function signOut(message) {
    stopAutoRefresh();
    Office.context.document.settings.remove(TOKEN_KEY_SETTING);
    Office.context.document.settings.saveAsync();
    currentQuestion = null;
    els.authSection.classList.remove('hidden');
    els.mainSection.classList.add('hidden');
    els.authError.textContent = message || '';
    setStatus('Signed out.');
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

  function clearSlideQuestionId(slideId) {
    const map = getSlideQuestionMap();
    delete map[slideId];
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
        stopAutoRefresh();
        els.autoRefreshToggle.checked = false;
        els.noQuestionBlock.classList.remove('hidden');
        els.existingQuestionBlock.classList.add('hidden');
        return;
      }

      const { question } = await apiFetch(`/api/questions/${questionId}`);
      currentQuestion = question;
      els.noQuestionBlock.classList.add('hidden');
      els.existingQuestionBlock.classList.remove('hidden');
      els.existingPrompt.textContent = question.prompt;
      els.existingStatus.textContent = `Type: ${question.type} · Status: ${question.status}` +
        (question.allowMultiple ? ' · multiple answers allowed' : '');
      els.synthesisToggle.checked = !!question.showSynthesisOnSlide;
      els.allowMultipleLabel.classList.toggle('hidden', question.type !== 'open_text');
      els.allowMultipleToggle.checked = !!question.allowMultiple;
      // Live by default: as soon as a question is loaded for this slide,
      // keep the slide's results text box updating. The toggle stays
      // available to pause it.
      if (!autoRefreshTimer) {
        els.autoRefreshToggle.checked = true;
        startAutoRefresh();
      }
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
    // "Allow multiple answers" only makes sense for open text.
    els.allowMultipleCreateLabel.classList.toggle('hidden', els.typeSelect.value !== 'open_text');
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

      const allowMultiple = type === 'open_text' && els.allowMultipleCreate.checked;
      const { question, participantUrl } = await apiFetch('/api/questions', {
        method: 'POST',
        body: JSON.stringify({ presentationId, slideRef: currentSlideId, type, prompt, options, allowMultiple }),
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

    // Step 1: clear any earlier QR/placeholder shapes on this slide (only
    // shapes that are genuinely ours), add the results text box, and record
    // the IDs of every shape present so the new picture can be identified.
    let idsBefore = new Set();
    await PowerPoint.run(async (context) => {
      const { slide, shapes } = await loadSlideShapes(context);
      for (const shape of shapes.items) {
        if (isOurShape(shape)) shape.delete();
      }
      await context.sync();

      createResultsTextBox(slide, "WHAT WE'VE RECEIVED (0)\n\nNo answers yet.");
      createThemesTextBox(slide, 'WHAT IT MEANS\n\nWaiting for answers…');
      await context.sync();

      const after = slide.shapes;
      after.load('items/id');
      await context.sync();
      idsBefore = new Set(after.items.map((sh) => sh.id));
    });

    // Step 2: insert the QR picture. The PowerPoint-specific
    // `shapes.addPicture` is still preview-only, so in shipping builds we use
    // the Common API image coercion, which places the picture on the current
    // slide at the given position (points).
    const namedNatively = await insertPictureOnCurrentSlide(base64, { left: 20, top: 20, width: 160, height: 160 });
    if (namedNatively) return;

    // Step 3: the one shape that did not exist before is the picture. Name
    // it so "Refresh" and "Remove" can find it. Never use the selection for
    // this: on some hosts the insert leaves the previous selection (often
    // the slide title) in place.
    await PowerPoint.run(async (context) => {
      const slide = context.presentation.getSelectedSlides().getItemAt(0);
      const shapes = slide.shapes;
      shapes.load('items/id,items/type');
      await context.sync();
      const added = shapes.items.filter((sh) => !idsBefore.has(sh.id));
      const picture = added.find((sh) => sh.type === 'Image') || added[0];
      if (picture) {
        picture.name = QR_NAME;
        await context.sync();
      }
    });
  }

  const QR_NAME = 'ClassroomSurveyQR';
  const TEXT_NAME = 'ClassroomSurveyText';      // left column: raw answers ("what we've received")
  const THEMES_NAME = 'ClassroomSurveyThemes';  // right column: synthesis ("what it means")
  // Geometry in points. Sized to fit a 4:3 slide (720 wide); on 16:9 there is
  // spare room on the right. Refreshes only rewrite text, so an instructor
  // can drag or resize either box and the layout sticks.
  const LEFT_BOX = { left: 20, top: 195, width: 335, height: 325 };
  const RIGHT_BOX = { left: 370, top: 195, width: 335, height: 325 };
  const MAX_RAW_LINES = 12;
  const MAX_THEMES = 3;

  /** True only for a picture shape carrying our QR name. A title or text box with that name is a mistake. */
  function isOurQr(shape) { return shape.name === QR_NAME && shape.type === 'Image'; }
  function isOurText(shape) { return shape.name === TEXT_NAME && shape.type !== 'Image'; }
  function isOurThemes(shape) { return shape.name === THEMES_NAME && shape.type !== 'Image'; }
  function isOurShape(shape) { return isOurQr(shape) || isOurText(shape) || isOurThemes(shape); }

  /**
   * Loads the current slide's shapes (id, name, type), undoes any shape that
   * was wrongly given one of our names (an earlier build named whatever was
   * selected, which could be the slide title), and returns the slide, its
   * shapes and a note describing any repair made.
   */
  async function loadSlideShapes(context) {
    const slide = context.presentation.getSelectedSlides().getItemAt(0);
    const shapes = slide.shapes;
    shapes.load('items/id,items/name,items/type');
    await context.sync();
    const notes = [];
    for (const shape of shapes.items) {
      if (shape.name === QR_NAME && shape.type !== 'Image') {
        shape.name = 'Title';
        notes.push('restored a mis-named slide shape');
      }
    }
    if (notes.length) await context.sync();
    return { slide, shapes, notes };
  }

  function createColumn(slide, name, geometry, text) {
    const shape = slide.shapes.addTextBox(text, geometry);
    shape.name = name;
    shape.textFrame.textRange.font.size = 12;
    shape.textFrame.wordWrap = true;
    return shape;
  }
  function createResultsTextBox(slide, text) { return createColumn(slide, TEXT_NAME, LEFT_BOX, text); }
  function createThemesTextBox(slide, text) { return createColumn(slide, THEMES_NAME, RIGHT_BOX, text); }

  function truncate(str, max) {
    const t = String(str).replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  /**
   * Builds the two slide columns.
   *   left  = "What we've received": the raw answers (or the vote counts)
   *   right = "What it means": the synthesized themes (or the headline stat)
   */
  function buildSlideColumns({ question, aggregate, responses, synthesis, participantUrl }) {
    const count = aggregate ? aggregate.responseCount : 0;
    const left = [`WHAT WE'VE RECEIVED (${count})`, ''];
    const right = ['WHAT IT MEANS', ''];

    if (question.type === 'open_text') {
      const latest = (responses || [])
        .slice()
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, MAX_RAW_LINES);
      if (latest.length === 0) left.push('No answers yet.');
      latest.forEach((r) => left.push(`• ${truncate(r.value, 90)}`));
      if (count > latest.length) left.push(`… and ${count - latest.length} more`);

      const themes = synthesis && synthesis.summaryJson ? synthesis.summaryJson.themes || [] : [];
      if (!question.showSynthesisOnSlide) {
        // Instructor has synthesis turned off: leave the column quiet.
      } else if (themes.length === 0) right.push(count === 0 ? 'Waiting for answers…' : 'Synthesizing…');
      else themes.slice(0, MAX_THEMES).forEach((t) => right.push(`• ${t}`));
    } else {
      const dist = (aggregate && aggregate.distribution) || {};
      const rows = Object.entries(dist);
      if (rows.length === 0) left.push('No answers yet.');
      rows.forEach(([key, stats]) => left.push(`${key}: ${stats.count} (${stats.percentage}%)`));
      if (aggregate && typeof aggregate.average === 'number') left.push('', `Average: ${aggregate.average.toFixed(2)}`);

      if (count === 0) right.push('Waiting for answers…');
      else {
        const top = rows.slice().sort((a, b) => b[1].count - a[1].count)[0];
        if (top) right.push(`Most common: ${top[0]} (${top[1].percentage}%)`);
        // The aggregator stores consensus as a label (e.g. high / mixed / low).
        if (aggregate && typeof aggregate.consensus === 'string' && aggregate.consensus !== 'n/a') {
          right.push(`Consensus: ${aggregate.consensus}`);
        }
      }
    }
    return { left: left.join('\n'), right: right.join('\n') };
  }

  /** Inserts a base64 PNG on the current slide, preferring the native API when the host has it. */
  async function insertPictureOnCurrentSlide(base64, { left, top, width, height }) {
    let nativeSupported = false;
    try {
      await PowerPoint.run(async (context) => {
        const slide = context.presentation.getSelectedSlides().getItemAt(0);
        if (typeof slide.shapes.addPicture === 'function') {
          const pic = slide.shapes.addPicture(base64, { left, top, width, height });
          pic.name = QR_NAME;
          await context.sync();
          nativeSupported = true;
        }
      });
    } catch (_err) {
      nativeSupported = false; // fall through to the Common API path
    }
    if (nativeSupported) return true;

    await new Promise((resolve, reject) => {
      Office.context.document.setSelectedDataAsync(
        base64,
        {
          coercionType: Office.CoercionType.Image,
          imageLeft: left,
          imageTop: top,
          imageWidth: width,
          imageHeight: height,
        },
        (result) => {
          if (result.status === Office.AsyncResultStatus.Succeeded) resolve();
          else reject(new Error(result.error ? result.error.message : 'Image insert failed'));
        }
      );
    });
    return false;
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

  /** Wipes answers and synthesis for this question but keeps the question and QR. */
  async function handleClearResponses() {
    if (!currentQuestion) return;
    setActionStatus('Clearing responses…');
    try {
      await apiFetch(`/api/questions/${currentQuestion.id}/clear`, { method: 'POST' });
      await handleRefreshSlide({ quiet: true });
      setActionStatus('Responses cleared. The QR code still works.');
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  /**
   * Detaches the question from this slide: removes the QR and results shapes,
   * forgets the slide link stored in the document, and deletes the question
   * (with its responses) on the server. The create form comes back so a new
   * question can be made for the same slide.
   */
  async function handleRemoveFromSlide() {
    if (!currentQuestion) return;
    setActionStatus('Removing question from this slide…');
    stopAutoRefresh();
    const questionId = currentQuestion.id;
    try {
      await PowerPoint.run(async (context) => {
        const { shapes } = await loadSlideShapes(context);
        for (const shape of shapes.items) {
          if (isOurShape(shape)) shape.delete();
        }
        await context.sync();
      });

      if (!currentSlideId) currentSlideId = await getCurrentSlideId();
      clearSlideQuestionId(currentSlideId);
      currentQuestion = null;

      try {
        await apiFetch(`/api/questions/${questionId}`, { method: 'DELETE' });
      } catch (err) {
        // The slide is already clean; a server-side failure shouldn't block the instructor.
        console.warn('Question delete failed on server:', err.message);
      }

      await refreshForCurrentSlide();
      setActionStatus('Question removed. You can create a new one for this slide.');
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  async function handleToggleAllowMultiple(e) {
    if (!currentQuestion) return;
    try {
      const { question } = await apiFetch(`/api/questions/${currentQuestion.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ allowMultiple: e.target.checked }),
      });
      currentQuestion = question;
      setActionStatus(question.allowMultiple ? 'Participants can now submit several answers.' : 'One answer per person.');
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  async function handleToggleSynthesis(e) {
    if (!currentQuestion) return;
    try {
      const { question } = await apiFetch(`/api/questions/${currentQuestion.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ showSynthesisOnSlide: e.target.checked }),
      });
      currentQuestion = question; // refreshes read this flag; keep it current
      await handleRefreshSlide({ quiet: true });
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
  async function handleRefreshSlide({ quiet = false } = {}) {
    if (!currentQuestion) return;
    if (!quiet) setActionStatus('Refreshing…');
    try {
      const isOpenText = currentQuestion.type === 'open_text';
      const [{ aggregate }, synthResult, qrResult, responsesResult] = await Promise.all([
        apiFetch(`/api/questions/${currentQuestion.id}/aggregate`),
        currentQuestion.showSynthesisOnSlide
          ? apiFetch(`/api/questions/${currentQuestion.id}/synthesis`)
          : Promise.resolve({ synthesis: null }),
        apiFetch(`/api/questions/${currentQuestion.id}/qrcode`),
        isOpenText
          ? apiFetch(`/api/questions/${currentQuestion.id}/responses?limit=${MAX_RAW_LINES * 4}`)
          : Promise.resolve({ responses: [] }),
      ]);

      const columns = buildSlideColumns({
        question: currentQuestion,
        aggregate,
        responses: responsesResult.responses,
        synthesis: synthResult.synthesis,
        participantUrl: qrResult.participantUrl,
      });

      let note = '';
      await PowerPoint.run(async (context) => {
        const { slide, shapes, notes } = await loadSlideShapes(context);
        const leftShape = shapes.items.find(isOurText);
        const rightShape = shapes.items.find(isOurThemes);

        if (leftShape) {
          leftShape.textFrame.textRange.text = columns.left;
        } else {
          createResultsTextBox(slide, columns.left);
          notes.push('left column was missing and has been recreated');
        }

        if (rightShape) {
          rightShape.textFrame.textRange.text = columns.right;
        } else {
          // Either a slide from before the two-column layout, or the box was
          // deleted by hand. Create the right column and, if the left box is
          // the old single summary box, move it into the column layout.
          createThemesTextBox(slide, columns.right);
          if (leftShape) {
            leftShape.left = LEFT_BOX.left;
            leftShape.top = LEFT_BOX.top;
            leftShape.width = LEFT_BOX.width;
            leftShape.height = LEFT_BOX.height;
            leftShape.textFrame.textRange.font.size = 12;
          }
          notes.push('slide updated to the two-column layout');
        }
        await context.sync();
        note = notes.length ? ` (${notes.join('; ')})` : '';
      });

      await updateResponseCountLine();
      setActionStatus((quiet ? `Live: updated ${new Date().toLocaleTimeString()}` : 'Slide refreshed.') + note);
    } catch (err) {
      setActionStatus(`Error: ${err.message}`);
    }
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();

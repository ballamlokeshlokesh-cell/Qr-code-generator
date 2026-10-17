(() => {
  const state = { mode: 'url', photo: null, qrCodes: [] };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const urlInput = $('#url-input');
  const outputArea = $('#output-area');
  const errorMessage = $('#error-message');
  const previewCount = $('#preview-count');
  const photoSlots = $('#photo-slots');
  const photoStatus = $('#photo-upload-status');

  const settings = () => ({
    dots: $('#module-shape').value,
    cornersSquare: $('#corner-shape').value,
    foreground: $('#foreground-color').value,
    background: $('#background-color').value
  });

  const escapeHtml = (text) => String(text).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const setError = (message = '') => { errorMessage.textContent = message; };
  const setPhotoStatus = (message) => { if (photoStatus) photoStatus.textContent = message; };

  function normalizeUrl(value) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withProtocol);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
    } catch { return null; }
  }

  function updateColorLabels() {
    $('#foreground-value').textContent = $('#foreground-color').value.toUpperCase();
    $('#background-value').textContent = $('#background-color').value.toUpperCase();
  }

  function renderPhotoSlot() {
    photoSlots.innerHTML = state.photo ? `<div class="photo-slot has-image">
      <input id="photo-input" type="file" accept="image/*" />
      <label for="photo-input" aria-label="Replace selected image"><img class="photo-preview" src="${state.photo.preview}" alt="${escapeHtml(state.photo.name)} preview" /></label>
      <div class="photo-overlay"><span>${state.photo.uploading ? 'Uploading original…' : escapeHtml(state.photo.name)}</span><button type="button" id="remove-photo">Remove</button></div>
    </div>` : `<div class="photo-slot">
      <input id="photo-input" type="file" accept="image/*" />
      <label for="photo-input"><span class="slot-placeholder"><span class="slot-number">01</span><strong>Select one image</strong><small>Up to 100 MB · original stays intact</small></span></label>
    </div>`;

    $('#photo-input').addEventListener('change', handlePhotoUpload);
    $('#remove-photo')?.addEventListener('click', () => {
      if (state.photo?.preview?.startsWith('blob:')) URL.revokeObjectURL(state.photo.preview);
      state.photo = null;
      setError('');
      setPhotoStatus('Full-size original will be hosted for scan access.');
      renderPhotoSlot();
    });
  }

  async function handlePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (PNG, JPG, WEBP, GIF, AVIF, or HEIC).');
      return;
    }
    if (state.photo?.preview?.startsWith('blob:')) URL.revokeObjectURL(state.photo.preview);
    const preview = URL.createObjectURL(file);
    state.photo = { name: file.name, preview, publicUrl: null, uploading: true };
    setError('');
    setPhotoStatus('Uploading the original image…');
    renderPhotoSlot();

    try {
      const response = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.path) throw new Error(result.error || 'Upload failed');
      state.photo = { ...state.photo, publicUrl: new URL(result.path, window.location.origin).href, uploading: false };
      setPhotoStatus('Original image hosted. Scan the QR code to open it.');
      renderPhotoSlot();
    } catch (error) {
      URL.revokeObjectURL(preview);
      state.photo = null;
      renderPhotoSlot();
      setPhotoStatus('Full-size original will be hosted for scan access.');
      setError(error.message || 'The original image could not be uploaded. Try again.');
    }
  }

  function switchMode(mode) {
    state.mode = mode;
    $$('.mode-tab').forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('#url-panel').classList.toggle('is-hidden', mode !== 'url');
    $('#photos-panel').classList.toggle('is-hidden', mode !== 'photos');
    setError('');
  }

  function makeQr(container, data) {
    const style = settings();
    const qr = new QRCodeStyling({
      width: 720,
      height: 720,
      type: 'canvas',
      data,
      margin: 18,
      qrOptions: { errorCorrectionLevel: 'M' },
      dotsOptions: { color: style.foreground, type: style.dots },
      cornersSquareOptions: { color: style.foreground, type: style.cornersSquare },
      cornersDotOptions: { color: style.foreground, type: style.cornersSquare === 'dot' ? 'dot' : 'square' },
      backgroundOptions: { color: style.background }
    });
    qr.append(container);
    return qr;
  }

  function renderResults(item) {
    outputArea.innerHTML = `<div class="qr-results single"><article class="qr-card">
      <div class="qr-canvas" id="qr-canvas-0" aria-label="QR code preview"></div>
      <h3 title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
      <p title="${escapeHtml(item.subtitle)}">${escapeHtml(item.subtitle)}</p>
      <button type="button" class="download-button" id="download-button"><span class="download-icon">↓</span> Download PNG</button>
    </article></div>`;
    state.qrCodes = [{ qr: makeQr($('#qr-canvas-0'), item.data), name: item.filename }];
    $('#download-button').addEventListener('click', () => state.qrCodes[0].qr.download({ name: state.qrCodes[0].name, extension: 'png' }));
    previewCount.textContent = 'Preview / 01';
  }

  function generate() {
    setError('');
    if (typeof QRCodeStyling === 'undefined') {
      setError('The QR renderer is still loading. Please try again in a moment.');
      return;
    }
    let item;
    if (state.mode === 'url') {
      const destination = normalizeUrl(urlInput.value);
      if (!destination) {
        setError('Enter a valid URL or text destination to generate a code.');
        urlInput.focus();
        return;
      }
      item = { data: destination, filename: 'qr-forge-link', title: 'Link signal', subtitle: destination.replace(/^https?:\/\//, '') };
    } else {
      if (!state.photo) {
        setError('Select one image before generating its QR code.');
        return;
      }
      if (state.photo.uploading || !state.photo.publicUrl) {
        setError('Wait for the original image upload to finish, then generate the QR code.');
        return;
      }
      item = { data: state.photo.publicUrl, filename: 'qr-forge-image', title: 'Image signal', subtitle: 'Scan to open the full image' };
    }
    try {
      renderResults(item);
    } catch {
      outputArea.innerHTML = '';
      setError('The QR code could not be generated. Try again.');
    }
  }

  $$('.mode-tab').forEach((tab) => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));
  $$('.quick-chip').forEach((chip) => chip.addEventListener('click', () => {
    urlInput.value = chip.dataset.url;
    switchMode('url');
    generate();
  }));
  $('#clear-url').addEventListener('click', () => { urlInput.value = ''; urlInput.focus(); setError(''); });
  $('#generate-button').addEventListener('click', generate);
  $('#module-shape').addEventListener('change', () => { if (state.qrCodes.length) generate(); });
  $('#corner-shape').addEventListener('change', () => { if (state.qrCodes.length) generate(); });
  $('#foreground-color').addEventListener('input', () => { updateColorLabels(); if (state.qrCodes.length) generate(); });
  $('#background-color').addEventListener('input', () => { updateColorLabels(); if (state.qrCodes.length) generate(); });
  urlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') generate(); });

  renderPhotoSlot();
  updateColorLabels();
  setPhotoStatus('Full-size original will be hosted for scan access.');
  window.addEventListener('load', () => setTimeout(generate, 160));
})();

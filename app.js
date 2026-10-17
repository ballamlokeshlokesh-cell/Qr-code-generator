(() => {
  const state = {
    mode: 'url',
    photo: null,
    qrCodes: [],
    debounceTimer: null
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const urlInput = $('#url-input');
  const outputArea = $('#output-area');
  const errorMessage = $('#error-message');
  const previewCount = $('#preview-count');
  const photoSlots = $('#photo-slots');
  const photoStatus = $('#photo-upload-status');
  const themeToggle = $('#theme-toggle');
  const toast = $('#toast');
  const mobilePreviewBtn = $('#mobile-preview-btn');

  // Retrieve current styling options
  const settings = () => ({
    dots: $('#module-shape').value,
    cornersSquare: $('#corner-shape').value,
    foreground: $('#foreground-color').value,
    background: $('#background-color').value
  });

  const escapeHtml = (text) =>
    String(text).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));

  const setError = (message = '') => {
    if (errorMessage) errorMessage.textContent = message;
  };

  const setPhotoStatus = (message) => {
    if (photoStatus) photoStatus.textContent = message;
  };

  // Toast notification
  function showToast(message, duration = 2500) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  // Theme Management
  function initTheme() {
    const savedTheme = localStorage.getItem('qrforge-theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('qrforge-theme', next);
      });
    }
  }

  function normalizeUrl(value) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(withProtocol);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }

  function updateColorLabels() {
    const fg = $('#foreground-color').value;
    const bg = $('#background-color').value;

    const fgLabel = $('#foreground-value');
    const bgLabel = $('#background-value');
    if (fgLabel) fgLabel.textContent = fg.toUpperCase();
    if (bgLabel) bgLabel.textContent = bg.toUpperCase();

    const fgPill = $('#fg-preview-pill');
    const bgPill = $('#bg-preview-pill');
    if (fgPill) fgPill.style.backgroundColor = fg;
    if (bgPill) bgPill.style.backgroundColor = bg;
  }

  // Click on color wrapper opens color input
  $('#fg-control-wrap')?.addEventListener('click', (e) => {
    if (e.target !== $('#foreground-color')) {
      $('#foreground-color').click();
    }
  });

  $('#bg-control-wrap')?.addEventListener('click', (e) => {
    if (e.target !== $('#background-color')) {
      $('#background-color').click();
    }
  });

  function renderPhotoSlot() {
    if (!photoSlots) return;

    photoSlots.innerHTML = state.photo
      ? `<div class="photo-slot has-image">
          <input id="photo-input" type="file" accept="image/*" />
          <label for="photo-input" aria-label="Replace selected image">
            <img class="photo-preview" src="${state.photo.preview}" alt="${escapeHtml(state.photo.name)} preview" />
          </label>
          <div class="photo-overlay">
            <span>${state.photo.uploading ? 'Uploading original…' : escapeHtml(state.photo.name)}</span>
            <button type="button" id="remove-photo">Remove</button>
          </div>
        </div>`
      : `<div class="photo-slot" id="drop-zone">
          <input id="photo-input" type="file" accept="image/*" />
          <label for="photo-input">
            <span class="slot-placeholder">
              <span class="slot-number">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
              </span>
              <strong>Click or drag an image here</strong>
              <small>PNG, JPG, WEBP, GIF up to 100 MB · Full size retained</small>
            </span>
          </label>
        </div>`;

    $('#photo-input')?.addEventListener('change', handlePhotoUpload);

    $('#remove-photo')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.photo?.preview?.startsWith('blob:')) URL.revokeObjectURL(state.photo.preview);
      state.photo = null;
      setError('');
      setPhotoStatus('Full-size original will be hosted for scan access.');
      renderPhotoSlot();
    });

    // Drag and drop events
    const dropZone = $('#drop-zone');
    if (dropZone) {
      ['dragenter', 'dragover'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.add('drag-over');
        });
      });

      ['dragleave', 'drop'].forEach((eventName) => {
        dropZone.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          dropZone.classList.remove('drag-over');
        });
      });

      dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) processImageFile(file);
      });
    }
  }

  async function handlePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (file) processImageFile(file);
  }

  async function processImageFile(file) {
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
      state.photo = {
        ...state.photo,
        publicUrl: new URL(result.path, window.location.origin).href,
        uploading: false
      };
      setPhotoStatus('Original image hosted. Ready to generate QR code.');
      renderPhotoSlot();
      generate();
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
    generate();
  }

  function makeQr(container, data, type = 'canvas') {
    const style = settings();
    const qr = new QRCodeStyling({
      width: 720,
      height: 720,
      type,
      data,
      margin: 20,
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
    outputArea.innerHTML = `
      <div class="qr-results single">
        <article class="qr-card">
          <div class="qr-canvas" id="qr-canvas-0" aria-label="QR code preview"></div>
          <div class="qr-card-info">
            <h3 title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</h3>
            <p title="${escapeHtml(item.subtitle)}">${escapeHtml(item.subtitle)}</p>
          </div>
          <div class="qr-actions-grid">
            <button type="button" class="download-button" id="download-button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download PNG
            </button>
            <button type="button" class="download-svg-button" id="download-svg-button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
              Vector SVG
            </button>
          </div>
          <div class="action-row-secondary">
            <button type="button" class="copy-image-button" id="copy-image-button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy Image
            </button>
            <button type="button" class="copy-image-button" id="copy-link-button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
              Copy Link
            </button>
          </div>
        </article>
      </div>`;

    const canvasContainer = $('#qr-canvas-0');
    const qr = makeQr(canvasContainer, item.data, 'canvas');
    state.qrCodes = [{ qr, name: item.filename, data: item.data }];

    // PNG Download
    $('#download-button')?.addEventListener('click', () => {
      qr.download({ name: item.filename, extension: 'png' });
      showToast('PNG download started!');
    });

    // SVG Download
    $('#download-svg-button')?.addEventListener('click', () => {
      const svgQr = makeQr(document.createElement('div'), item.data, 'svg');
      svgQr.download({ name: item.filename, extension: 'svg' });
      showToast('Vector SVG download started!');
    });

    // Copy Image to Clipboard
    $('#copy-image-button')?.addEventListener('click', async () => {
      try {
        const canvas = canvasContainer.querySelector('canvas');
        if (canvas && navigator.clipboard && window.ClipboardItem) {
          canvas.toBlob(async (blob) => {
            if (!blob) throw new Error('Blob failed');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            showToast('QR code copied to clipboard!');
          });
        } else {
          await navigator.clipboard.writeText(item.data);
          showToast('Destination link copied to clipboard!');
        }
      } catch {
        showToast('Destination copied to clipboard!');
      }
    });

    // Copy Link to Clipboard
    $('#copy-link-button')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.data);
        showToast('Link copied to clipboard!');
      } catch {
        showToast('Could not copy link.');
      }
    });

    if (previewCount) previewCount.textContent = '720 × 720 px';
  }

  function generate() {
    setError('');
    if (typeof QRCodeStyling === 'undefined') {
      setError('The QR renderer is loading. Please try again in a moment.');
      return;
    }

    let item;
    if (state.mode === 'url') {
      const raw = urlInput.value.trim();
      if (!raw) {
        outputArea.innerHTML = `
          <div class="empty-preview">
            <div class="empty-signal">
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
            </div>
            <p>Type a destination<br /><strong>to see your QR code appear here.</strong></p>
          </div>`;
        return;
      }
      const destination = normalizeUrl(raw);
      if (!destination) {
        setError('Enter a valid URL or text destination.');
        return;
      }
      item = {
        data: destination,
        filename: 'qr-forge-code',
        title: 'Link Signal',
        subtitle: destination.replace(/^https?:\/\//, '')
      };
    } else {
      if (!state.photo) {
        outputArea.innerHTML = `
          <div class="empty-preview">
            <div class="empty-signal">
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
            </div>
            <p>Upload a photo<br /><strong>to generate your scan-ready image QR code.</strong></p>
          </div>`;
        return;
      }
      if (state.photo.uploading || !state.photo.publicUrl) {
        setError('Uploading image... Please wait a moment.');
        return;
      }
      item = {
        data: state.photo.publicUrl,
        filename: 'qr-forge-image',
        title: 'Image Signal',
        subtitle: 'Scan to open full-resolution image'
      };
    }

    try {
      renderResults(item);
    } catch (err) {
      setError('Could not generate QR code. Try again.');
    }
  }

  // Debounced generator for smooth typing feedback
  function scheduleGenerate(delay = 180) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(generate, delay);
  }

  // Event Listeners
  $$('.mode-tab').forEach((tab) => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));

  $$('.quick-chip').forEach((chip) => chip.addEventListener('click', () => {
    urlInput.value = chip.dataset.url;
    switchMode('url');
    generate();
  }));

  // Presets click
  $$('.preset-chip').forEach((chip) => chip.addEventListener('click', () => {
    const fg = chip.dataset.fg;
    const bg = chip.dataset.bg;
    if (fg && bg) {
      $('#foreground-color').value = fg;
      $('#background-color').value = bg;
      updateColorLabels();
      generate();
      showToast(`Applied ${chip.getAttribute('title') || 'theme'}`);
    }
  }));

  $('#clear-url')?.addEventListener('click', () => {
    urlInput.value = '';
    urlInput.focus();
    setError('');
    generate();
  });

  $('#generate-button')?.addEventListener('click', generate);

  $('#module-shape')?.addEventListener('change', generate);
  $('#corner-shape')?.addEventListener('change', generate);

  $('#foreground-color')?.addEventListener('input', () => {
    updateColorLabels();
    scheduleGenerate(50);
  });

  $('#background-color')?.addEventListener('input', () => {
    updateColorLabels();
    scheduleGenerate(50);
  });

  urlInput?.addEventListener('input', () => scheduleGenerate(200));
  urlInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') generate();
  });

  // Mobile Jump to preview button
  if (mobilePreviewBtn) {
    mobilePreviewBtn.addEventListener('click', () => {
      const previewPanel = $('#preview-panel');
      if (previewPanel) {
        previewPanel.scrollIntoView({ behavior: 'smooth' });
      }
    });

    // Show/hide floating preview button based on scroll
    window.addEventListener('scroll', () => {
      const scrollY = window.scrollY || window.pageYOffset;
      const previewRect = $('#preview-panel')?.getBoundingClientRect();
      const inView = previewRect && previewRect.top < window.innerHeight && previewRect.bottom > 0;
      if (scrollY > 300 && !inView) {
        mobilePreviewBtn.style.display = 'flex';
      } else {
        mobilePreviewBtn.style.display = 'none';
      }
    }, { passive: true });
  }

  // Initialize
  initTheme();
  renderPhotoSlot();
  updateColorLabels();
  setPhotoStatus('Full-size original will be hosted for scan access.');

  window.addEventListener('load', () => setTimeout(generate, 100));
})();

(() => {
  // Application State
  const state = {
    mode: 'url', // 'url' | 'photos' | 'link'
    photo: null, // { file, name, size, dimensions, preview, pageUrl, directUrl, uploading, progress, provider }
    linkImage: null, // { file, name, size, dimensions, preview, pageUrl, directUrl, uploading, progress, provider }
    qrCodes: [],
    debounceTimer: null,
    imgbbApiKey: localStorage.getItem('qrforge_imgbb_key') || ''
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  // DOM Elements
  const urlInput = $('#url-input');
  const outputArea = $('#output-area');
  const errorMessage = $('#error-message');
  const previewCount = $('#preview-count');
  const previewKicker = $('#preview-kicker');
  const previewTitle = $('#preview-title');
  const photoSlots = $('#photo-slots');
  const photoStatus = $('#photo-upload-status');
  const linkSlots = $('#link-slots');
  const linkStatus = $('#link-upload-status');
  const themeToggle = $('#theme-toggle');
  const settingsToggle = $('#settings-toggle');
  const settingsModal = $('#settings-modal');
  const toast = $('#toast');
  const mobilePreviewBtn = $('#mobile-preview-btn');
  const engineStatus = $('#engine-status');

  // Styling Settings
  const settings = () => ({
    dots: $('#module-shape')?.value || 'rounded',
    cornersSquare: $('#corner-shape')?.value || 'extra-rounded',
    foreground: $('#foreground-color')?.value || '#14231d',
    background: $('#background-color')?.value || '#ffffff'
  });

  // Utilities
  const escapeHtml = (text) =>
    String(text || '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));

  const formatBytes = (bytes, decimals = 1) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const setError = (message = '') => {
    if (errorMessage) errorMessage.textContent = message;
  };

  const setPhotoStatus = (message) => {
    if (photoStatus) photoStatus.textContent = message;
  };

  const setLinkStatus = (message) => {
    if (linkStatus) linkStatus.textContent = message;
  };

  function showToast(message, duration = 2500) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  async function copyText(text, btnElement = null) {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }
      showToast('Copied to clipboard!');
      if (btnElement) {
        const originalHtml = btnElement.innerHTML;
        btnElement.classList.add('copied');
        btnElement.innerHTML = `<span>✓ Copied!</span>`;
        setTimeout(() => {
          btnElement.classList.remove('copied');
          btnElement.innerHTML = originalHtml;
        }, 1800);
      }
    } catch {
      showToast('Could not copy to clipboard.');
    }
  }

  // Get image dimensions asynchronously
  function getImageDimensions(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(objectUrl);
      };
      img.onerror = () => {
        resolve({ width: 0, height: 0 });
        URL.revokeObjectURL(objectUrl);
      };
      img.src = objectUrl;
    });
  }

  // Offline Image Payload Generator (Lightweight compressed image fallback)
  // Ensures QR codes are NEVER blocked or stuck if cloud networks are unreachable
  function createOfflineImagePayload(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 120;
            let w = img.naturalWidth || 120;
            let h = img.naturalHeight || 120;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            canvas.width = Math.max(1, w);
            canvas.height = Math.max(1, h);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
            resolve({
              pageUrl: dataUrl,
              directUrl: dataUrl,
              provider: 'Offline Embedded QR'
            });
          } catch {
            resolve({
              pageUrl: e.target.result,
              directUrl: e.target.result,
              provider: 'Offline Embedded QR'
            });
          }
        };
        img.onerror = () => {
          resolve({
            pageUrl: e.target.result,
            directUrl: e.target.result,
            provider: 'Offline Embedded QR'
          });
        };
        img.src = e.target.result;
      };
      reader.onerror = () => {
        resolve({
          pageUrl: 'https://qrforge.studio',
          directUrl: 'https://qrforge.studio',
          provider: 'Offline'
        });
      };
      reader.readAsDataURL(file);
    });
  }

  // Provider 1: Gofile.io (Fast, globally available, CORS *, unblocked by Indian ISPs)
  async function uploadToGofile(file, onProgress) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000); // 7s timeout

    try {
      const sRes = await fetch('https://api.gofile.io/servers', { signal: controller.signal });
      const sData = await sRes.json();
      const server = sData?.data?.servers?.[0]?.name;
      if (!server) throw new Error('No Gofile server available');

      if (onProgress) onProgress(45);

      const formData = new FormData();
      formData.append('file', file);

      const upRes = await fetch(`https://${server}.gofile.io/contents/uploadfile`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      const upData = await upRes.json();
      clearTimeout(timer);

      if (upData?.status === 'ok' && upData?.data?.downloadPage) {
        if (onProgress) onProgress(100);
        return {
          pageUrl: upData.data.downloadPage,
          directUrl: upData.data.downloadPage,
          provider: 'Gofile Cloud'
        };
      }
      throw new Error(upData?.status || 'Gofile upload failed');
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // Provider 2: tmpfiles.org
  function uploadToTmpFiles(file, onProgress) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://tmpfiles.org/api/v1/upload');
      xhr.timeout = 7000; // 7s timeout

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.min(95, Math.round((e.loaded / e.total) * 100)));
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status === 200 && data?.status === 'success' && data?.data?.url) {
            const pageUrl = data.data.url;
            const directUrl = data.data.url.replace('https://tmpfiles.org/', 'https://tmpfiles.org/dl/');
            resolve({ pageUrl, directUrl, provider: 'tmpfiles Cloud' });
            return;
          }
          reject(new Error(data?.message || 'tmpfiles error'));
        } catch (e) {
          reject(new Error('Invalid tmpfiles response'));
        }
      };

      xhr.onerror = () => reject(new Error('tmpfiles network error'));
      xhr.ontimeout = () => reject(new Error('tmpfiles timeout'));
      xhr.send(formData);
    });
  }

  // Provider 3: Custom ImgBB API Key
  function uploadToImgBB(file, onProgress) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('image', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.imgbb.com/1/upload?key=${encodeURIComponent(state.imgbbApiKey)}`);
      xhr.timeout = 8000;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status === 200 && data?.data?.url) {
            resolve({
              pageUrl: data.data.url_viewer || data.data.url,
              directUrl: data.data.url,
              provider: 'ImgBB Cloud'
            });
            return;
          }
          reject(new Error(data?.error?.message || 'ImgBB upload failed'));
        } catch (err) {
          reject(err);
        }
      };

      xhr.onerror = () => reject(new Error('ImgBB network error'));
      xhr.ontimeout = () => reject(new Error('ImgBB timeout'));
      xhr.send(formData);
    });
  }

  // Provider 4: Local Node.js server fallback
  async function uploadToLocalServer(file, onProgress) {
    if (onProgress) onProgress(60);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
        signal: controller.signal
      });
      clearTimeout(timer);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.path) throw new Error(result.error || 'Local upload failed');
      if (onProgress) onProgress(100);
      const fullUrl = new URL(result.path, window.location.origin).href;
      return { pageUrl: fullUrl, directUrl: fullUrl, provider: 'Local Server' };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // Multi-tier, fail-safe image uploader: NEVER STALLS, NEVER CRASHES
  async function uploadImageFile(file, onProgress) {
    // 1. If user configured personal ImgBB key
    if (state.imgbbApiKey) {
      try {
        if (onProgress) onProgress(20);
        return await uploadToImgBB(file, onProgress);
      } catch (e) {
        console.warn('Custom ImgBB failed, trying public cloud...', e);
      }
    }

    // 2. Gofile.io (Fast, globally unblocked, CORS *)
    try {
      if (onProgress) onProgress(35);
      return await uploadToGofile(file, onProgress);
    } catch (e) {
      console.warn('Gofile upload failed, trying tmpfiles...', e);
    }

    // 3. tmpfiles.org
    try {
      if (onProgress) onProgress(65);
      return await uploadToTmpFiles(file, onProgress);
    } catch (e) {
      console.warn('tmpfiles upload failed, trying local server...', e);
    }

    // 4. Local Node.js /api/images
    try {
      if (onProgress) onProgress(85);
      return await uploadToLocalServer(file, onProgress);
    } catch (e) {
      console.warn('Local server unavailable, generating offline payload...', e);
    }

    // 5. Bulletproof Offline Fallback (Guarantees QR code is ALWAYS created!)
    if (onProgress) onProgress(100);
    return await createOfflineImagePayload(file);
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

  // Settings Modal Management
  function initSettings() {
    const keyInput = $('#imgbb-key-input');
    const saveBtn = $('#save-settings-btn');
    const resetBtn = $('#reset-settings-btn');
    const closeBtn = $('#close-settings');

    const updateEngineBadge = () => {
      if (engineStatus) {
        engineStatus.textContent = state.imgbbApiKey ? 'ImgBB Cloud Active' : 'Cloud Engine Active';
      }
    };

    if (keyInput) keyInput.value = state.imgbbApiKey;
    updateEngineBadge();

    settingsToggle?.addEventListener('click', () => {
      if (keyInput) keyInput.value = state.imgbbApiKey;
      settingsModal?.classList.add('is-open');
    });

    closeBtn?.addEventListener('click', () => {
      settingsModal?.classList.remove('is-open');
    });

    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.classList.remove('is-open');
      }
    });

    saveBtn?.addEventListener('click', () => {
      const key = (keyInput?.value || '').trim();
      state.imgbbApiKey = key;
      if (key) {
        localStorage.setItem('qrforge_imgbb_key', key);
        showToast('ImgBB API key saved!');
      } else {
        localStorage.removeItem('qrforge_imgbb_key');
        showToast('Using Default Instant Cloud.');
      }
      updateEngineBadge();
      settingsModal?.classList.remove('is-open');
    });

    resetBtn?.addEventListener('click', () => {
      state.imgbbApiKey = '';
      localStorage.removeItem('qrforge_imgbb_key');
      if (keyInput) keyInput.value = '';
      updateEngineBadge();
      showToast('Reset to Default Instant Cloud.');
      settingsModal?.classList.remove('is-open');
    });
  }

  function normalizeUrl(value) {
    const trimmed = (value || '').trim();
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
    const fg = $('#foreground-color')?.value || '#14231d';
    const bg = $('#background-color')?.value || '#ffffff';

    const fgLabel = $('#foreground-value');
    const bgLabel = $('#background-value');
    if (fgLabel) fgLabel.textContent = fg.toUpperCase();
    if (bgLabel) bgLabel.textContent = bg.toUpperCase();

    const fgPill = $('#fg-preview-pill');
    const bgPill = $('#bg-preview-pill');
    if (fgPill) fgPill.style.backgroundColor = fg;
    if (bgPill) bgPill.style.backgroundColor = bg;
  }

  // Click on color wrapper opens color picker
  $('#fg-control-wrap')?.addEventListener('click', (e) => {
    if (e.target !== $('#foreground-color')) $('#foreground-color')?.click();
  });

  $('#bg-control-wrap')?.addEventListener('click', (e) => {
    if (e.target !== $('#background-color')) $('#background-color')?.click();
  });

  // =========================================================================
  // TAB 2: PHOTO TO QR MODE (ZERO-STALL ENGINE)
  // =========================================================================
  function renderPhotoSlot() {
    if (!photoSlots) return;

    photoSlots.innerHTML = state.photo
      ? `<div class="photo-slot has-image">
          <input id="photo-input" type="file" accept="image/*" />
          <label for="photo-input" aria-label="Replace selected image">
            <img class="photo-preview" src="${state.photo.preview}" alt="${escapeHtml(state.photo.name)} preview" />
          </label>
          <div class="photo-overlay">
            <span>${state.photo.uploading ? 'Hosting on cloud…' : escapeHtml(state.photo.name)}</span>
            <button type="button" id="remove-photo">Remove</button>
          </div>
        </div>`
      : `<div class="photo-slot" id="photo-drop-zone">
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
              <small>PNG, JPG, WEBP, GIF · Full resolution hosted for scanning</small>
            </span>
          </label>
        </div>`;

    $('#photo-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) processPhotoQrFile(file);
    });

    $('#remove-photo')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.photo?.preview?.startsWith('blob:')) URL.revokeObjectURL(state.photo.preview);
      state.photo = null;
      setError('');
      setPhotoStatus('Full-size image will be hosted for instant scan access.');
      $('#photo-progress-wrap')?.classList.add('is-hidden');
      $('#photo-hosted-box')?.classList.add('is-hidden');
      renderPhotoSlot();
      generate();
    });

    // Drag and drop events for Photo Slot
    const dropZone = $('#photo-drop-zone');
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
        if (file) processPhotoQrFile(file);
      });
    }
  }

  async function processPhotoQrFile(file) {
    if (!file.type.startsWith('image/')) {
      setError('Please choose a valid image file (PNG, JPG, WEBP, GIF, SVG).');
      return;
    }

    if (state.photo?.preview?.startsWith('blob:')) URL.revokeObjectURL(state.photo.preview);
    const preview = URL.createObjectURL(file);
    const dims = await getImageDimensions(file);

    state.photo = {
      file,
      name: file.name,
      size: formatBytes(file.size),
      dimensions: dims.width ? `${dims.width} × ${dims.height}` : 'Custom',
      preview,
      pageUrl: null,
      directUrl: null,
      uploading: true,
      progress: 15
    };

    setError('');
    setPhotoStatus('Hosting image on cloud CDN…');
    renderPhotoSlot();

    // Show live pulsing generator state in preview panel immediately!
    outputArea.innerHTML = `
      <div class="empty-preview">
        <div class="empty-signal pulse">
          <span></span><span></span><span></span>
          <span></span><span></span><span></span>
          <span></span><span></span><span></span>
        </div>
        <p><strong>Hosting image &amp; creating QR code…</strong><br /><span id="preview-upload-msg">Connecting to cloud network…</span></p>
      </div>`;

    const generateBtnLabel = $('#generate-btn-label');
    if (generateBtnLabel) generateBtnLabel.textContent = 'Hosting image…';

    const progressWrap = $('#photo-progress-wrap');
    const progressFill = $('#photo-progress-fill');
    const progressPct = $('#photo-progress-pct');
    const progressStatus = $('#photo-progress-status');

    if (progressWrap) progressWrap.classList.remove('is-hidden');
    if (progressFill) progressFill.style.width = '20%';
    if (progressPct) progressPct.textContent = '20%';

    try {
      const uploadRes = await uploadImageFile(file, (percent) => {
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressPct) progressPct.textContent = `${percent}%`;
        if (progressStatus) progressStatus.textContent = `Hosting image… ${percent}%`;
        const previewMsg = $('#preview-upload-msg');
        if (previewMsg) previewMsg.textContent = `Uploading… ${percent}%`;
      });

      state.photo.pageUrl = uploadRes.pageUrl;
      state.photo.directUrl = uploadRes.directUrl;
      state.photo.uploading = false;
      state.photo.provider = uploadRes.provider;

      if (progressFill) progressFill.style.width = '100%';
      if (progressPct) progressPct.textContent = '100%';
      if (progressStatus) progressStatus.textContent = `Hosted via ${uploadRes.provider}!`;

      setTimeout(() => {
        progressWrap?.classList.add('is-hidden');
      }, 1000);

      setPhotoStatus(`✓ Image ready (${uploadRes.provider}). QR code generated!`);
      if (generateBtnLabel) generateBtnLabel.textContent = 'Generate QR code';

      // Show destination box
      const hostedBox = $('#photo-hosted-box');
      const hostedUrlInput = $('#photo-hosted-url');
      if (hostedBox && hostedUrlInput) {
        hostedBox.classList.remove('is-hidden');
        hostedUrlInput.value = state.photo.pageUrl;
      }

      renderPhotoSlot();
      generate();
      showToast('QR code created successfully!');
    } catch (error) {
      console.warn('Cloud upload encountered issue, generating offline image payload:', error);
      const fallback = await createOfflineImagePayload(file);
      state.photo.pageUrl = fallback.pageUrl;
      state.photo.directUrl = fallback.directUrl;
      state.photo.uploading = false;
      state.photo.provider = fallback.provider;

      setPhotoStatus('✓ Offline QR code generated (Scan opens image preview).');
      if (generateBtnLabel) generateBtnLabel.textContent = 'Generate QR code';
      progressWrap?.classList.add('is-hidden');

      renderPhotoSlot();
      generate();
      showToast('QR code created!');
    }
  }

  $('#photo-copy-hosted-btn')?.addEventListener('click', (e) => {
    const url = $('#photo-hosted-url')?.value;
    if (url) copyText(url, e.currentTarget);
  });

  // =========================================================================
  // TAB 3: IMAGE TO LINK GENERATOR
  // =========================================================================
  function renderLinkSlot() {
    if (!linkSlots) return;

    linkSlots.innerHTML = state.linkImage
      ? `<div class="photo-slot has-image">
          <input id="link-file-input" type="file" accept="image/*" />
          <label for="link-file-input" aria-label="Replace image">
            <img class="photo-preview" src="${state.linkImage.preview}" alt="${escapeHtml(state.linkImage.name)} preview" />
          </label>
          <div class="photo-overlay">
            <span>${state.linkImage.uploading ? 'Hosting on cloud…' : escapeHtml(state.linkImage.name)}</span>
            <button type="button" id="remove-link-image">Remove</button>
          </div>
        </div>`
      : `<div class="photo-slot" id="link-drop-zone">
          <input id="link-file-input" type="file" accept="image/*" />
          <label for="link-file-input">
            <span class="slot-placeholder">
              <span class="slot-number">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </span>
              <strong>Click or drag any image here</strong>
              <small>Generates instant shareable links, Markdown, HTML embed &amp; direct URLs</small>
            </span>
          </label>
        </div>`;

    $('#link-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) processImageToLink(file);
    });

    $('#remove-link-image')?.addEventListener('click', (e) => {
      e.stopPropagation();
      clearLinkState();
    });

    // Drag and drop for Link Slot
    const dropZone = $('#link-drop-zone');
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
        if (file) processImageToLink(file);
      });
    }
  }

  function clearLinkState() {
    if (state.linkImage?.preview?.startsWith('blob:')) URL.revokeObjectURL(state.linkImage.preview);
    state.linkImage = null;
    setError('');
    setLinkStatus('Drop or select an image to generate public web links.');
    $('#link-progress-wrap')?.classList.add('is-hidden');
    $('#link-results')?.classList.add('is-hidden');
    renderLinkSlot();
    generate();
  }

  async function processImageToLink(file) {
    if (!file.type.startsWith('image/')) {
      setError('Please choose a valid image file (PNG, JPG, WEBP, GIF, SVG).');
      return;
    }

    if (state.linkImage?.preview?.startsWith('blob:')) URL.revokeObjectURL(state.linkImage.preview);
    const preview = URL.createObjectURL(file);
    const dims = await getImageDimensions(file);

    state.linkImage = {
      file,
      name: file.name,
      size: formatBytes(file.size),
      dimensions: dims.width ? `${dims.width} × ${dims.height}` : 'Custom',
      mimeType: file.type.split('/')[1]?.toUpperCase() || 'IMAGE',
      preview,
      pageUrl: null,
      directUrl: null,
      uploading: true,
      progress: 15
    };

    setError('');
    setLinkStatus('Hosting image on cloud CDN…');
    $('#link-results')?.classList.add('is-hidden');
    renderLinkSlot();

    const progressWrap = $('#link-progress-wrap');
    const progressFill = $('#link-progress-fill');
    const progressPct = $('#link-progress-pct');
    const progressStatus = $('#link-progress-status');

    if (progressWrap) progressWrap.classList.remove('is-hidden');
    if (progressFill) progressFill.style.width = '20%';
    if (progressPct) progressPct.textContent = '20%';

    try {
      const uploadRes = await uploadImageFile(file, (percent) => {
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressPct) progressPct.textContent = `${percent}%`;
        if (progressStatus) progressStatus.textContent = `Hosting image… ${percent}%`;
      });

      state.linkImage.pageUrl = uploadRes.pageUrl;
      state.linkImage.directUrl = uploadRes.directUrl;
      state.linkImage.uploading = false;
      state.linkImage.provider = uploadRes.provider;

      if (progressFill) progressFill.style.width = '100%';
      if (progressPct) progressPct.textContent = '100%';
      if (progressStatus) progressStatus.textContent = `Hosted via ${uploadRes.provider}!`;

      setTimeout(() => {
        progressWrap?.classList.add('is-hidden');
      }, 1000);

      setLinkStatus(`✓ Links generated via ${uploadRes.provider}! Click any button to copy.`);

      // Populate results fields
      const resultsWrap = $('#link-results');
      if (resultsWrap) {
        resultsWrap.classList.remove('is-hidden');

        $('#asset-meta-name').textContent = state.linkImage.name;
        $('#asset-meta-size').textContent = state.linkImage.size;
        $('#asset-meta-dims').textContent = state.linkImage.dimensions;
        $('#asset-meta-type').textContent = state.linkImage.mimeType;

        const pUrl = state.linkImage.pageUrl;
        const dUrl = state.linkImage.directUrl || pUrl;

        $('#out-page-url').value = pUrl;
        $('#out-direct-url').value = dUrl;
        $('#out-markdown').value = `![${state.linkImage.name}](${dUrl})`;
        $('#out-html').value = `<img src="${dUrl}" alt="${escapeHtml(state.linkImage.name)}" />`;
        $('#out-bbcode').value = `[img]${dUrl}[/img]`;

        const openBtn = $('#out-page-open');
        if (openBtn) openBtn.href = pUrl;
      }

      renderLinkSlot();
      generate();
      showToast('Links generated successfully!');
    } catch (error) {
      console.warn('Link upload issue, using offline payload:', error);
      const fallback = await createOfflineImagePayload(file);
      state.linkImage.pageUrl = fallback.pageUrl;
      state.linkImage.directUrl = fallback.directUrl;
      state.linkImage.uploading = false;
      state.linkImage.provider = fallback.provider;

      setLinkStatus('✓ Offline link generated. Ready to copy.');
      progressWrap?.classList.add('is-hidden');

      const resultsWrap = $('#link-results');
      if (resultsWrap) {
        resultsWrap.classList.remove('is-hidden');
        $('#out-page-url').value = fallback.pageUrl;
        $('#out-direct-url').value = fallback.directUrl;
        $('#out-markdown').value = `![${state.linkImage.name}](${fallback.directUrl})`;
        $('#out-html').value = `<img src="${fallback.directUrl}" alt="${escapeHtml(state.linkImage.name)}" />`;
        $('#out-bbcode').value = `[img]${fallback.directUrl}[/img]`;
      }

      renderLinkSlot();
      generate();
      showToast('Links generated!');
    }
  }

  // Copy button listeners for Link generator inputs
  $$('#link-results .btn-copy').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const targetId = btn.dataset.target;
      const input = $(`#${targetId}`);
      if (input) copyText(input.value, e.currentTarget);
    });
  });

  // "Make QR Code for this Image" button in link generator
  $('#link-make-qr-btn')?.addEventListener('click', () => {
    if (!state.linkImage?.pageUrl) return;
    state.photo = {
      ...state.linkImage,
      uploading: false
    };
    switchMode('photos');
    showToast('Switched to QR Code mode!');
  });

  $('#link-clear-btn')?.addEventListener('click', clearLinkState);

  // =========================================================================
  // MODE SWITCHING (URL, PHOTOS, LINK)
  // =========================================================================
  function switchMode(mode) {
    state.mode = mode;

    $$('.mode-tab').forEach((tab) => {
      const active = tab.dataset.mode === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    $('#url-panel').classList.toggle('is-hidden', mode !== 'url');
    $('#photos-panel').classList.toggle('is-hidden', mode !== 'photos');
    $('#link-panel').classList.toggle('is-hidden', mode !== 'link');

    // Update section kickers and titles
    const step1Kicker = $('#step-1-kicker');
    const step1Title = $('#step-1-title');
    const generateBtnLabel = $('#generate-btn-label');
    const stylingHeading = $('#styling-heading');
    const stylingPresets = $('#styling-presets');
    const stylingGrid = $('#styling-grid');
    const stylingReliability = $('#styling-reliability');
    const stepDivider = $('#step-divider');
    const generateBtn = $('#generate-button');

    if (mode === 'link') {
      if (step1Kicker) step1Kicker.textContent = 'IMAGE HOST & LINK GENERATOR';
      if (step1Title) step1Title.textContent = 'Upload Image · Get Public Links';
      if (previewKicker) previewKicker.textContent = 'LIVE ASSET CARD';
      if (previewTitle) previewTitle.textContent = 'Hosted Asset';

      stylingHeading?.classList.add('is-hidden');
      stylingPresets?.classList.add('is-hidden');
      stylingGrid?.classList.add('is-hidden');
      stylingReliability?.classList.add('is-hidden');
      stepDivider?.classList.add('is-hidden');
      generateBtn?.classList.add('is-hidden');
    } else {
      if (step1Kicker) step1Kicker.textContent = 'STEP 01 · DESTINATION';
      if (step1Title) step1Title.textContent = mode === 'url' ? 'What should this code open?' : 'Select image to encode';
      if (previewKicker) previewKicker.textContent = 'STEP 03 · EXPORT';
      if (previewTitle) previewTitle.textContent = 'Live Preview';
      if (generateBtnLabel) generateBtnLabel.textContent = 'Generate QR code';

      stylingHeading?.classList.remove('is-hidden');
      stylingPresets?.classList.remove('is-hidden');
      stylingGrid?.classList.remove('is-hidden');
      stylingReliability?.classList.remove('is-hidden');
      stepDivider?.classList.remove('is-hidden');
      generateBtn?.classList.remove('is-hidden');
    }

    setError('');
    generate();
  }

  // =========================================================================
  // MOBILE-SAFE EXPORT & DOWNLOAD ENGINE
  // =========================================================================
  // Extracts canvas to PNG Blob synchronously without async popups that mobile browsers block
  function getCanvasPngBlob(canvas) {
    return new Promise((resolve, reject) => {
      try {
        if (!canvas) {
          reject(new Error('Canvas not found'));
          return;
        }
        const dataUrl = canvas.toDataURL('image/png');
        const byteString = atob(dataUrl.split(',')[1]);
        const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        const blob = new Blob([ab], { type: mimeString });
        resolve({ blob, dataUrl });
      } catch (err) {
        reject(err);
      }
    });
  }

  // Synchronously mirrors the canvas into a high-res <img> element
  // This enables native mobile long-press / touch-and-hold "Save to Photos" on iOS & Android
  function mirrorCanvasToImage(container, qrInstance) {
    if (!container) return;
    const doMirror = () => {
      const canvas = container.querySelector('canvas');
      if (!canvas) return;
      try {
        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl || dataUrl === 'data:,' || dataUrl.length < 500) {
          setTimeout(doMirror, 80);
          return;
        }
        let img = container.querySelector('img.qr-mirror-img');
        if (!img) {
          img = document.createElement('img');
          img.className = 'qr-mirror-img';
          img.alt = 'Scan-ready QR Code';
          img.style.width = '100%';
          img.style.height = 'auto';
          img.style.display = 'block';
          img.style.userSelect = 'auto';
          img.style.webkitTouchCallout = 'default';
          container.appendChild(img);
        }
        img.src = dataUrl;
        canvas.style.display = 'none';
      } catch (err) {
        console.warn('Canvas mirroring notice:', err);
      }
    };

    if (qrInstance && qrInstance._canvasDrawingPromise) {
      qrInstance._canvasDrawingPromise.then(doMirror).catch(doMirror);
    } else {
      setTimeout(doMirror, 100);
    }
  }

  // Trigger mobile-safe anchor download attached to document.body
  function triggerDownloadFromBlob(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(blobUrl);
    }, 3000);
  }

  // Primary Download PNG function
  async function downloadQrPng(container, filename = 'qr-forge-code') {
    const canvas = container?.querySelector('canvas') || outputArea?.querySelector('canvas');
    const mirrorImg = container?.querySelector('img.qr-mirror-img') || outputArea?.querySelector('img.qr-mirror-img');
    const safeName = (filename || 'qr-code').replace(/[^a-zA-Z0-9_-]/g, '_') + '.png';

    try {
      let blob = null;
      if (canvas) {
        try {
          const res = await getCanvasPngBlob(canvas);
          blob = res.blob;
        } catch (e) {
          console.warn('Canvas blob failed, trying mirror image:', e);
        }
      }

      if (!blob && mirrorImg && mirrorImg.src && mirrorImg.src.startsWith('data:image')) {
        const res = await fetch(mirrorImg.src);
        blob = await res.blob();
      }

      if (blob) {
        triggerDownloadFromBlob(blob, safeName);
        showToast('✓ Saved to mobile storage / downloads!');
        return;
      }

      showToast('Please generate a QR code first.');
    } catch (err) {
      console.warn('Blob download error:', err);
      if (mirrorImg?.src?.startsWith('data:image')) {
        const a = document.createElement('a');
        a.href = mirrorImg.src;
        a.download = safeName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
        showToast('✓ QR code downloaded!');
      } else {
        showToast('Download error. Touch and hold the QR code to save to Photos.');
      }
    }
  }

  // Native Mobile Web Share API: Saves directly to Camera Roll (iOS Photos) or Android Share
  async function shareQrImage(container, filename = 'qr-forge-code', title = 'QR Code') {
    const canvas = container?.querySelector('canvas') || outputArea?.querySelector('canvas');
    const mirrorImg = container?.querySelector('img.qr-mirror-img') || outputArea?.querySelector('img.qr-mirror-img');
    const safeName = (filename || 'qr-code').replace(/[^a-zA-Z0-9_-]/g, '_') + '.png';

    try {
      let blob = null;
      if (canvas) {
        try {
          const res = await getCanvasPngBlob(canvas);
          blob = res.blob;
        } catch (e) {}
      }

      if (!blob && mirrorImg?.src?.startsWith('data:image')) {
        const res = await fetch(mirrorImg.src);
        blob = await res.blob();
      }

      if (blob) {
        const file = new File([blob], safeName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: title || 'QR Code',
            text: 'My generated QR code'
          });
          showToast('✓ Saved / Shared successfully!');
          return;
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('Native share failed, falling back to download:', err);
    }

    // Fallback: regular safe file download
    downloadQrPng(container, filename);
  }

  // Vector SVG Download
  function downloadQrSvg(data, filename = 'qr-forge-code') {
    try {
      const tempDiv = document.createElement('div');
      const style = settings();
      const svgQr = new QRCodeStyling({
        width: 720,
        height: 720,
        type: 'svg',
        data: data,
        margin: 20,
        qrOptions: { errorCorrectionLevel: 'M' },
        dotsOptions: { color: style.foreground, type: style.dots },
        cornersSquareOptions: { color: style.foreground, type: style.cornersSquare },
        cornersDotOptions: { color: style.foreground, type: style.cornersSquare === 'dot' ? 'dot' : 'square' },
        backgroundOptions: { color: style.background }
      });
      svgQr.append(tempDiv);

      setTimeout(() => {
        try {
          const svgEl = tempDiv.querySelector('svg');
          const safeName = (filename || 'qr-code').replace(/[^a-zA-Z0-9_-]/g, '_') + '.svg';
          if (svgEl) {
            const svgData = new XMLSerializer().serializeToString(svgEl);
            const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
            triggerDownloadFromBlob(svgBlob, safeName);
            showToast('✓ Vector SVG downloaded!');
          } else {
            svgQr.download({ name: safeName.replace(/\.svg$/, ''), extension: 'svg' });
            showToast('✓ Vector SVG download started!');
          }
        } catch (e) {
          svgQr.download({ name: filename, extension: 'svg' });
        }
      }, 60);
    } catch (err) {
      console.warn('SVG download error:', err);
      showToast('Could not export SVG.');
    }
  }

  // =========================================================================
  // QR CODE GENERATION & PREVIEW RENDERING (NEVER STUCK)
  // =========================================================================
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

  function renderQrResults(item) {
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
              <span>Download PNG</span>
            </button>
            <button type="button" class="share-mobile-button" id="share-mobile-button" title="Save directly to camera roll or share to apps">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                <polyline points="16 6 12 2 8 6"></polyline>
                <line x1="12" y1="2" x2="12" y2="15"></line>
              </svg>
              <span>Save to Photos / Share</span>
            </button>
          </div>
          <div class="action-row-secondary">
            <button type="button" class="download-svg-button" id="download-svg-button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
              <span>Vector SVG</span>
            </button>
            <button type="button" class="copy-image-button" id="copy-image-button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              <span>Copy Image</span>
            </button>
          </div>
          <div class="mobile-save-hint">
            <span>📱</span>
            <span><strong>Mobile tip:</strong> Tap "Save to Photos" or touch &amp; hold image to save to Camera Roll</span>
          </div>
        </article>
      </div>`;

    const canvasContainer = $('#qr-canvas-0');
    const qr = makeQr(canvasContainer, item.data, 'canvas');
    state.qrCodes = [{ qr, name: item.filename, data: item.data }];

    // As soon as canvas finishes, mirror into high-res touch-saveable <img>
    mirrorCanvasToImage(canvasContainer, qr);

    // PNG Download - Attached DOM anchor with binary Blob
    $('#download-button')?.addEventListener('click', () => {
      downloadQrPng(canvasContainer, item.filename);
    });

    // Save to Photos / Native Web Share API
    $('#share-mobile-button')?.addEventListener('click', () => {
      shareQrImage(canvasContainer, item.filename, item.title);
    });

    // Vector SVG Download
    $('#download-svg-button')?.addEventListener('click', () => {
      downloadQrSvg(item.data, item.filename);
    });

    // Copy Image to Clipboard
    $('#copy-image-button')?.addEventListener('click', async () => {
      try {
        const canvas = canvasContainer.querySelector('canvas');
        if (canvas && navigator.clipboard && window.ClipboardItem) {
          const { blob } = await getCanvasPngBlob(canvas);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          showToast('✓ QR code copied to clipboard!');
        } else {
          await copyText(item.data);
        }
      } catch {
        await copyText(item.data);
      }
    });

    if (previewCount) previewCount.textContent = '720 × 720 px';
  }

  function renderAssetCard(asset) {
    outputArea.innerHTML = `
      <div class="asset-preview-card">
        <div class="asset-preview-canvas">
          <img src="${asset.preview}" alt="${escapeHtml(asset.name)}" />
        </div>
        <div class="asset-card-details">
          <h4>${escapeHtml(asset.name)}</h4>
          <p>${escapeHtml(asset.dimensions)} · ${escapeHtml(asset.size)}</p>
        </div>
        <div class="asset-preview-btn-row">
          <button type="button" class="btn-copy" id="asset-card-copy-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy Link</span>
          </button>
          <a href="${asset.pageUrl}" target="_blank" rel="noopener noreferrer" class="action-pill-btn secondary" style="min-width:0;height:38px;">
            <span>Open Link ↗</span>
          </a>
        </div>
        <div id="asset-qr-inline-wrap" style="margin-top: 6px; padding-top: 10px; border-top: 1px solid var(--line);">
          <button type="button" class="action-pill-btn" id="toggle-asset-qr" style="width:100%;height:36px;font-size:10px;">
            <span>▦ Generate QR Code for this Link</span>
          </button>
          <div id="inline-qr-container" class="is-hidden" style="margin-top:12px; display:flex; flex-direction:column; align-items:center; gap:8px;">
            <div id="inline-qr-canvas" style="width:160px; height:160px; background:#fff; border-radius:8px; padding:6px; box-shadow:0 2px 8px rgba(0,0,0,0.08);"></div>
            <button type="button" class="btn-copy" id="download-inline-qr" style="height:32px; font-size:10px; padding:0 12px;">Download QR</button>
          </div>
        </div>
      </div>`;

    $('#asset-card-copy-btn')?.addEventListener('click', (e) => {
      copyText(asset.pageUrl, e.currentTarget);
    });

    const toggleQrBtn = $('#toggle-asset-qr');
    const inlineContainer = $('#inline-qr-container');
    const inlineCanvas = $('#inline-qr-canvas');
    let inlineQrInstance = null;

    toggleQrBtn?.addEventListener('click', () => {
      if (inlineContainer?.classList.contains('is-hidden')) {
        inlineContainer.classList.remove('is-hidden');
        inlineCanvas.innerHTML = '';
        inlineQrInstance = new QRCodeStyling({
          width: 160,
          height: 160,
          type: 'canvas',
          data: asset.pageUrl,
          margin: 6,
          dotsOptions: { color: '#14231d', type: 'rounded' },
          cornersSquareOptions: { color: '#14231d', type: 'extra-rounded' },
          backgroundOptions: { color: '#ffffff' }
        });
        inlineQrInstance.append(inlineCanvas);
        mirrorCanvasToImage(inlineCanvas, inlineQrInstance);
        toggleQrBtn.innerHTML = `<span>Hide QR Code</span>`;
      } else {
        inlineContainer?.classList.add('is-hidden');
        toggleQrBtn.innerHTML = `<span>▦ Generate QR Code for this Link</span>`;
      }
    });

    $('#download-inline-qr')?.addEventListener('click', () => {
      if (inlineCanvas) {
        downloadQrPng(inlineCanvas, 'qr-forge-link');
      }
    });

    if (previewCount) previewCount.textContent = asset.dimensions;
  }

  function generate() {
    setError('');
    if (typeof QRCodeStyling === 'undefined') {
      setError('The QR engine is loading. Please try again in a moment.');
      return;
    }

    if (state.mode === 'url') {
      const raw = urlInput?.value.trim();
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
      renderQrResults({
        data: destination,
        filename: 'qr-forge-code',
        title: 'Link Signal',
        subtitle: destination.replace(/^https?:\/\//, '')
      });
    } else if (state.mode === 'photos') {
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
      if (state.photo.uploading && !state.photo.pageUrl) {
        outputArea.innerHTML = `
          <div class="empty-preview">
            <div class="empty-signal pulse">
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
            </div>
            <p><strong>Hosting image &amp; creating QR code…</strong><br /><span>Almost ready</span></p>
          </div>`;
        return;
      }
      renderQrResults({
        data: state.photo.pageUrl,
        filename: 'qr-forge-image',
        title: state.photo.name,
        subtitle: state.photo.pageUrl.startsWith('data:')
          ? 'Scan opens image preview'
          : 'Scan opens full-resolution hosted image'
      });
    } else if (state.mode === 'link') {
      if (!state.linkImage) {
        outputArea.innerHTML = `
          <div class="empty-preview">
            <div class="empty-signal">
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
            </div>
            <p>Select an image<br /><strong>to view its hosted preview &amp; links here.</strong></p>
          </div>`;
        return;
      }
      if (state.linkImage.uploading && !state.linkImage.pageUrl) {
        outputArea.innerHTML = `
          <div class="empty-preview">
            <div class="empty-signal pulse">
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
              <span></span><span></span><span></span>
            </div>
            <p><strong>Hosting image &amp; generating links…</strong><br /><span>Almost ready</span></p>
          </div>`;
        return;
      }
      renderAssetCard(state.linkImage);
    }
  }

  // Debounced generator for smooth typing feedback
  function scheduleGenerate(delay = 180) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(generate, delay);
  }

  // =========================================================================
  // INITIALIZATION & EVENT LISTENERS
  // =========================================================================
  $$('.mode-tab').forEach((tab) => tab.addEventListener('click', () => switchMode(tab.dataset.mode)));

  $$('.quick-chip').forEach((chip) => chip.addEventListener('click', () => {
    if (urlInput) urlInput.value = chip.dataset.url;
    switchMode('url');
    generate();
  }));

  // Presets click
  $$('.preset-chip').forEach((chip) => chip.addEventListener('click', () => {
    const fg = chip.dataset.fg;
    const bg = chip.dataset.bg;
    if (fg && bg) {
      const fgInput = $('#foreground-color');
      const bgInput = $('#background-color');
      if (fgInput) fgInput.value = fg;
      if (bgInput) bgInput.value = bg;
      updateColorLabels();
      generate();
      showToast(`Applied ${chip.getAttribute('title') || 'theme'}`);
    }
  }));

  $('#clear-url')?.addEventListener('click', () => {
    if (urlInput) {
      urlInput.value = '';
      urlInput.focus();
    }
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
  initSettings();
  renderPhotoSlot();
  renderLinkSlot();
  updateColorLabels();

  window.addEventListener('load', () => setTimeout(generate, 100));
})();

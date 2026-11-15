/**
 * SCREEN MIRROR MODULE
 * - Generates 6-character mixed alphanumeric code (uppercase, lowercase, numbers)
 * - Captures phone screen stream & establishes WebRTC / Frame relay to PC
 * - Screenshot capture (Chụp ảnh màn hình) -> Downloads PNG
 * - Video recording (Quay video màn hình) -> Downloads WebM/MP4
 */

const MirrorApp = {
  currentRole: null, // 'phone' or 'pc'
  activeCode: '',
  phoneStream: null,
  peerConnection: null,
  broadcastChannel: null,
  signalPollInterval: null,
  frameRelayInterval: null,
  frameRelayReceiverInterval: null,
  mediaRecorder: null,
  recordingDrawInterval: null,
  recordedChunks: [],
  isRecording: false,
  recSeconds: 0,
  recTimerInterval: null,
  isLandscape: false,
  installPrompt: null,
  selectedInstallTarget: null,

  init() {
    this.setupBroadcastChannel();
    this.bindEvents();
    this.bindInstallEvents();
    this.registerServiceWorker();
    this.fetchServerInfo();
  },

  bindInstallEvents() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.installPrompt = event;
    });

    window.addEventListener('appinstalled', () => {
      this.installPrompt = null;
      this.closeInstallGuide();
      this.showToast('Đã cài đặt Screen Mirror Pro.');
    });

    const installButton = document.getElementById('btnInstallApp');
    const closeButton = document.getElementById('btnCloseInstallGuide');
    const nativeInstallButton = document.getElementById('btnTriggerNativeInstall');
    const backButton = document.getElementById('btnBackInstallTarget');
    const guide = document.getElementById('installGuideModal');

    if (installButton) installButton.addEventListener('click', () => this.openInstallGuide());
    document.querySelectorAll('[data-install-target]').forEach((button) => {
      button.addEventListener('click', () => this.selectInstallTarget(button.dataset.installTarget));
    });
    if (nativeInstallButton) nativeInstallButton.addEventListener('click', () => this.requestInstall());
    if (backButton) backButton.addEventListener('click', () => this.resetInstallTarget());
    if (closeButton) closeButton.addEventListener('click', () => this.closeInstallGuide());
    if (guide) {
      guide.addEventListener('click', (event) => {
        if (event.target === guide) this.closeInstallGuide();
      });
    }
  },

  openInstallGuide() {
    this.resetInstallTarget();
    const guide = document.getElementById('installGuideModal');
    if (guide) guide.classList.add('active');
  },

  selectInstallTarget(target) {
    if (target !== 'phone' && target !== 'pc') return;
    this.selectedInstallTarget = target;

    const picker = document.getElementById('installTargetPicker');
    const phoneGuide = document.getElementById('installGuidePhone');
    const pcGuide = document.getElementById('installGuidePC');
    const backButton = document.getElementById('btnBackInstallTarget');
    const installButton = document.getElementById('btnTriggerNativeInstall');

    if (picker) picker.hidden = true;
    if (phoneGuide) phoneGuide.hidden = target !== 'phone';
    if (pcGuide) pcGuide.hidden = target !== 'pc';
    if (backButton) backButton.hidden = false;
    if (installButton) installButton.hidden = false;
  },

  resetInstallTarget() {
    this.selectedInstallTarget = null;
    const picker = document.getElementById('installTargetPicker');
    const phoneGuide = document.getElementById('installGuidePhone');
    const pcGuide = document.getElementById('installGuidePC');
    const backButton = document.getElementById('btnBackInstallTarget');
    const installButton = document.getElementById('btnTriggerNativeInstall');

    if (picker) picker.hidden = false;
    if (phoneGuide) phoneGuide.hidden = true;
    if (pcGuide) pcGuide.hidden = true;
    if (backButton) backButton.hidden = true;
    if (installButton) installButton.hidden = true;
  },

  async requestInstall() {
    const isInstalled = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (isInstalled) {
      this.showToast('Ứng dụng đã được cài đặt trên thiết bị này.');
      return;
    }

    if (!this.installPrompt) {
      const guide = document.getElementById('installGuideModal');
      if (guide) guide.classList.add('active');
      return;
    }

    try {
      const prompt = this.installPrompt;
      this.installPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') {
        this.showToast('Đang cài đặt Screen Mirror Pro...');
      } else {
        this.showToast('Bạn đã hủy cài đặt.');
      }
    } catch (error) {
      console.error('Không thể mở hộp thoại cài đặt PWA:', error);
      this.showToast('Không mở được cài đặt tự động. Xem hướng dẫn cài đặt trên màn hình.');
      const guide = document.getElementById('installGuideModal');
      if (guide) guide.classList.add('active');
    }
  },

  closeInstallGuide() {
    this.resetInstallTarget();
    const guide = document.getElementById('installGuideModal');
    if (guide) guide.classList.remove('active');
  },

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext || location.protocol === 'file:') return;

    try {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
      }
      await navigator.serviceWorker.register('./sw.js');
    } catch (error) {
      console.error('Không thể đăng ký service worker:', error);
      this.showToast('Không thể bật chế độ cài đặt ứng dụng. Vui lòng tải lại trang.');
    }
  },

  async fetchServerInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const data = await res.json();
        const hintEl = document.getElementById('networkIpHint');
        if (hintEl && data.phoneUrl) {
          hintEl.innerHTML = `
            📱 <strong>Mở ứng dụng trên điện thoại:</strong> 
            <a href="${data.phoneUrl}" target="_blank" style="color: #00d2ff; font-weight: bold; text-decoration: underline;">${data.phoneUrl}</a>
            <br>Chia sẻ màn hình cần HTTPS; link IP nội bộ HTTP có thể không được trình duyệt hỗ trợ.
          `;
        }
      }
    } catch (e) {}
  },

  setupBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel('screen_mirror_channel');
      this.broadcastChannel.onmessage = (e) => {
        const { type, code, payload } = e.data;
        if (this.currentRole === 'pc' && code === this.activeCode) {
          if (type === 'PHONE_STREAM_READY') {
            this.connectWebRTC_PC();
          } else if (type === 'SIGNAL_TO_PC') {
            this.handleSignalingPayload(payload);
          } else if (type === 'FRAME_UPDATE') {
            this.updateCanvasFrame(payload);
          }
        } else if (this.currentRole === 'phone' && code === this.activeCode) {
          if (type === 'PC_CONNECTED') {
            this.setPhoneStatus('live', 'Đã kết nối với Máy tính PC!');
          } else if (type === 'SIGNAL_TO_PHONE') {
            this.handleSignalingPayload(payload);
          }
        }
      };
    } catch (e) {
      console.warn('BroadcastChannel not supported:', e);
    }
  },

  bindEvents() {
    // Mode Selection Buttons (2 chỗ ghi: TB ĐT và TB PC)
    const btnSelectPhone = document.getElementById('btnSelectPhone');
    const btnSelectPC = document.getElementById('btnSelectPC');
    const btnBackFromPhone = document.getElementById('btnBackFromPhone');
    const btnBackFromPC = document.getElementById('btnBackFromPC');

    if (btnSelectPhone) btnSelectPhone.addEventListener('click', () => this.enterPhoneMode());
    if (btnSelectPC) btnSelectPC.addEventListener('click', () => this.enterPCMode());
    if (btnBackFromPhone) btnBackFromPhone.addEventListener('click', () => this.backToSelector());
    if (btnBackFromPC) btnBackFromPC.addEventListener('click', () => this.backToSelector());

    // Phone Mode Controls
    const btnRefreshCode = document.getElementById('btnRefreshCode');
    const btnStartPhoneStream = document.getElementById('btnStartPhoneStream');
    const btnCopyCode = document.getElementById('btnCopyCode');

    if (btnRefreshCode) btnRefreshCode.addEventListener('click', () => this.generateAndRegisterNewCode());
    if (btnStartPhoneStream) btnStartPhoneStream.addEventListener('click', () => this.togglePhoneStream());
    if (btnCopyCode) {
      btnCopyCode.addEventListener('click', () => {
        navigator.clipboard.writeText(this.activeCode).then(() => {
          this.showToast('Đã sao chép mã kết nối: ' + this.activeCode);
        });
      });
    }

    // PC Mode Controls
    const btnConnectPC = document.getElementById('btnConnectPC');
    const inputConnectCode = document.getElementById('inputConnectCode');
    const btnSnapshot = document.getElementById('btnSnapshot');
    const btnToggleRecord = document.getElementById('btnToggleRecord');
    const btnRotate = document.getElementById('btnRotate');
    const btnFullscreen = document.getElementById('btnFullscreen');
    const btnDisconnectPC = document.getElementById('btnDisconnectPC');

    if (btnConnectPC && inputConnectCode) {
      btnConnectPC.addEventListener('click', () => this.connectFromPC());
      inputConnectCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.connectFromPC();
      });
    }

    if (btnSnapshot) btnSnapshot.addEventListener('click', () => this.captureScreenshot());
    if (btnToggleRecord) btnToggleRecord.addEventListener('click', () => this.toggleVideoRecording());
    if (btnRotate) btnRotate.addEventListener('click', () => this.toggleOrientation());
    if (btnFullscreen) btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    if (btnDisconnectPC) btnDisconnectPC.addEventListener('click', () => this.disconnectPC());
    document.addEventListener('fullscreenchange', () => this.updateFullscreenButton());
  },

  switchView(viewId) {
    document.querySelectorAll('.screen-view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById(viewId);
    if (target) target.classList.add('active');
  },

  backToSelector() {
    this.stopPhoneStream();
    this.disconnectPC();
    this.currentRole = null;
    this.switchView('viewDeviceSelector');
  },

  // ================= 1. PHONE MODE (THIẾT BỊ ĐIỆN THOẠI) =================
  enterPhoneMode() {
    this.currentRole = 'phone';
    this.switchView('viewPhoneMode');
    this.generateAndRegisterNewCode();
  },

  /**
   * Generates a 6-character random alphanumeric code with mixed uppercase, lowercase, numbers
   * (e.g. "aB7xK9", "mP4zQ1")
   */
  generate6DigitCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },

  async generateAndRegisterNewCode() {
    this.activeCode = this.generate6DigitCode();
    const codeEl = document.getElementById('displayPhoneCode');
    if (codeEl) codeEl.innerText = this.activeCode;

    this.setPhoneStatus('waiting', 'Đang chờ máy tính nhập mã kết nối...');

    // Register code with backend
    try {
      await fetch('/api/mirror/register-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: this.activeCode,
          username: (window.Auth && Auth.currentUser) ? Auth.currentUser.username : 'phone_user'
        })
      });
    } catch (e) {}

    // Start signaling poll
    this.startSignalPolling('phone');
  },

  setPhoneStatus(state, text) {
    const dot = document.getElementById('phoneStatusDot');
    const textEl = document.getElementById('phoneStatusText');
    if (dot) {
      dot.className = state === 'live' ? 'status-dot-pulse live' : 'status-dot-pulse';
    }
    if (textEl) textEl.innerText = text;
  },

  async togglePhoneStream() {
    if (this.phoneStream) {
      this.stopPhoneStream();
    } else {
      await this.startPhoneStream();
    }
  },

  async startPhoneStream() {
    const btn = document.getElementById('btnStartPhoneStream');
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      const message = !window.isSecureContext
        ? 'Chia sẻ màn hình từ trình duyệt cần mở ứng dụng qua HTTPS.'
        : 'Trình duyệt này không hỗ trợ chia sẻ toàn màn hình từ trang web. Trên Android Chrome, hãy dùng ứng dụng Android Screen Mirror Sender.';
      this.setPhoneStatus('waiting', message);
      alert(message);
      return;
    }

    try {
      this.phoneStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 } },
        audio: false
      });

      // Preview on phone
      const phonePreview = document.getElementById('phoneLocalPreview');
      if (phonePreview) {
        phonePreview.srcObject = this.phoneStream;
        phonePreview.style.display = 'block';
      }

      btn.classList.add('btn-stop-stream');
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg> Dừng Chiếu Màn Hình`;

      this.setPhoneStatus('live', 'Đang phát sóng trực tiếp! Hãy kết nối từ PC.');

      // Notify PC via broadcast
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({ type: 'PHONE_STREAM_READY', code: this.activeCode });
      }

      // Handle user stopping screen share via browser bar
      this.phoneStream.getVideoTracks()[0].onended = () => {
        this.stopPhoneStream();
      };

      // Start continuous high-speed frame relay fallback
      this.startFrameRelaySender();

    } catch (err) {
      console.warn('Cannot capture screen:', err);
      alert('Không thể bắt đầu chiếu màn hình: ' + err.message);
    }
  },

  stopPhoneStream() {
    if (this.phoneStream) {
      this.phoneStream.getTracks().forEach(t => t.stop());
      this.phoneStream = null;
    }
    clearInterval(this.frameRelayInterval);
    const btn = document.getElementById('btnStartPhoneStream');
    if (btn) {
      btn.classList.remove('btn-stop-stream');
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg> Bắt đầu Chiếu màn hình`;
    }
    const phonePreview = document.getElementById('phoneLocalPreview');
    if (phonePreview) phonePreview.style.display = 'none';

    this.setPhoneStatus('waiting', 'Đã dừng chiếu màn hình.');
  },

  startFrameRelaySender() {
    clearInterval(this.frameRelayInterval);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const video = document.getElementById('phoneLocalPreview');

    this.frameRelayInterval = setInterval(() => {
      if (!this.phoneStream || !video || video.videoWidth === 0) return;
      const scale = Math.min(1, 720 / video.videoWidth, 1280 / video.videoHeight);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const frameData = canvas.toDataURL('image/jpeg', 0.65);

      // 1. Post to broadcast
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({ type: 'FRAME_UPDATE', code: this.activeCode, payload: frameData });
      }

      // 2. Post to server fallback
      fetch('/api/mirror/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: this.activeCode, frame: frameData })
      }).catch(() => {});
    }, 70);
  },

  // ================= 2. PC MODE (THIẾT BỊ MÁY TÍNH) =================
  enterPCMode() {
    this.currentRole = 'pc';
    this.switchView('viewPCMode');
    document.getElementById('pcConnectCard').style.display = 'block';
    document.getElementById('mirrorPlayerStage').classList.remove('active');
    const input = document.getElementById('inputConnectCode');
    if (input) {
      input.value = '';
      input.focus();
    }
  },

  async connectFromPC() {
    const input = document.getElementById('inputConnectCode');
    const code = input.value.trim();

    if (!code || code.length !== 6) {
      alert('Vui lòng nhập đúng mã kết nối gồm 6 ký tự hiển thị trên điện thoại!');
      return;
    }

    this.activeCode = code;

    // Check code with backend
    try {
      const res = await fetch(`/api/mirror/check-code?code=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!data.success && !this.broadcastChannel) {
        alert(data.message || 'Mã không tồn tại hoặc điện thoại chưa sẵn sàng!');
        return;
      }
    } catch (e) {
      console.warn('Offline connection check');
    }

    // Switch to player view
    document.getElementById('pcConnectCard').style.display = 'none';
    document.getElementById('mirrorPlayerStage').classList.add('active');
    document.getElementById('pcHeaderCodeBadge').innerText = `Mã: ${this.activeCode}`;
    const placeholder = document.getElementById('mirrorStreamPlaceholder');
    if (placeholder) placeholder.hidden = false;
    const image = document.getElementById('remoteScreenImg');
    if (image) {
      image.removeAttribute('src');
      image.style.display = 'none';
    }
    const video = document.getElementById('remoteScreenVideo');
    if (video) video.style.display = 'block';

    // Notify phone
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage({ type: 'PC_CONNECTED', code: this.activeCode });
    }

    this.startSignalPolling('pc');
    this.startFrameRelayReceiver();
    this.showToast('Đang kết nối tới màn hình điện thoại...');
  },

  startFrameRelayReceiver() {
    const imgEl = document.getElementById('remoteScreenImg');
    const vidEl = document.getElementById('remoteScreenVideo');

    // Poll fallback frame from server if P2P stream not rendering
    clearInterval(this.frameRelayReceiverInterval);
    this.frameRelayReceiverInterval = setInterval(async () => {
      if (this.currentRole !== 'pc' || !this.activeCode) return;
      if (vidEl.srcObject) return; // WebRTC active

      try {
        const res = await fetch(`/api/mirror/frame?code=${encodeURIComponent(this.activeCode)}`);
        const data = await res.json();
        if (data.frame && imgEl) {
          imgEl.src = data.frame;
          imgEl.style.display = 'block';
          vidEl.style.display = 'none';
          const placeholder = document.getElementById('mirrorStreamPlaceholder');
          if (placeholder) placeholder.hidden = true;
        }
      } catch (e) {}
    }, 100);
  },

  updateCanvasFrame(frameBase64) {
    const imgEl = document.getElementById('remoteScreenImg');
    const vidEl = document.getElementById('remoteScreenVideo');
    if (imgEl && (!vidEl.srcObject || vidEl.paused)) {
      imgEl.src = frameBase64;
      imgEl.style.display = 'block';
      vidEl.style.display = 'none';
      const placeholder = document.getElementById('mirrorStreamPlaceholder');
      if (placeholder) placeholder.hidden = true;
    }
  },

  // ================= 3. CHỤP ẢNH MÀN HÌNH (SCREENSHOT) =================
  captureScreenshot() {
    const vid = document.getElementById('remoteScreenVideo');
    const img = document.getElementById('remoteScreenImg');
    const flash = document.getElementById('cameraFlashOverlay');

    // Trigger flash animation
    if (flash) {
      flash.classList.add('flashing');
      setTimeout(() => flash.classList.remove('flashing'), 120);
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (vid && vid.srcObject && vid.videoWidth > 0) {
      canvas.width = vid.videoWidth;
      canvas.height = vid.videoHeight;
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    } else if (img && img.naturalWidth > 0) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } else {
      alert('Chưa nhận được hình ảnh màn hình điện thoại để chụp!');
      return;
    }

    // Auto download image
    const dataUrl = canvas.toDataURL('image/png');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `Chup_Man_Hinh_DT_${this.activeCode}_${timestamp}.png`;

    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    this.showToast(`📸 Đã chụp ảnh màn hình và lưu về máy: ${filename}`);
  },

  // ================= 4. QUAY VIDEO MÀN HÌNH (RECORDING) =================
  toggleVideoRecording() {
    if (this.isRecording) {
      this.stopVideoRecording();
    } else {
      this.startVideoRecording();
    }
  },

  startVideoRecording() {
    const vid = document.getElementById('remoteScreenVideo');
    const img = document.getElementById('remoteScreenImg');
    let streamToRecord = null;
    let drawContext = null;

    if (typeof MediaRecorder === 'undefined') {
      alert('Trình duyệt này không hỗ trợ quay video. Hãy dùng Chrome, Edge hoặc Firefox phiên bản mới.');
      return;
    }

    if (vid && vid.srcObject && vid.videoWidth > 0) {
      streamToRecord = vid.srcObject;
    } else if (img && img.style.display !== 'none' && img.naturalWidth > 0) {
      // Capture stream from canvas if in frame mode
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      drawContext = canvas.getContext('2d');
      if (!drawContext || typeof canvas.captureStream !== 'function') {
        alert('Trình duyệt này không hỗ trợ quay video màn hình.');
        return;
      }
      drawContext.drawImage(img, 0, 0, canvas.width, canvas.height);
      streamToRecord = canvas.captureStream(30);
      this.recordingDrawInterval = setInterval(() => {
        if (!this.isRecording) {
          clearInterval(this.recordingDrawInterval);
          this.recordingDrawInterval = null;
          return;
        }
        if (img.complete && img.naturalWidth > 0) {
          drawContext.drawImage(img, 0, 0, canvas.width, canvas.height);
        }
      }, 33);
    }

    if (!streamToRecord) {
      alert('Chưa có nguồn video màn hình điện thoại để quay!');
      return;
    }

    try {
      this.recordedChunks = [];
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
        .find(type => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type));
      this.mediaRecorder = new MediaRecorder(streamToRecord, mimeType ? { mimeType } : undefined);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.saveRecordedVideoFile();
      };

      this.mediaRecorder.start(500); // chunk every 500ms
      this.isRecording = true;

      // Update UI
      const btn = document.getElementById('btnToggleRecord');
      btn.classList.add('recording');
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
        <span>Dừng Quay</span>
        <span id="recTimerBadge" class="rec-timer-badge">00:00</span>
      `;

      this.startRecTimer();
      this.showToast('🔴 Bắt đầu quay video màn hình điện thoại...');

    } catch (err) {
      this.isRecording = false;
      clearInterval(this.recordingDrawInterval);
      this.recordingDrawInterval = null;
      clearInterval(this.recTimerInterval);
      console.error('Cannot record screen video:', err);
      alert('Không thể bắt đầu quay video: ' + err.message);
    }
  },

  startRecTimer() {
    this.recSeconds = 0;
    clearInterval(this.recTimerInterval);
    const badge = document.getElementById('recTimerBadge');
    this.recTimerInterval = setInterval(() => {
      this.recSeconds++;
      const mins = String(Math.floor(this.recSeconds / 60)).padStart(2, '0');
      const secs = String(this.recSeconds % 60).padStart(2, '0');
      const el = document.getElementById('recTimerBadge');
      if (el) el.innerText = `${mins}:${secs}`;
    }, 1000);
  },

  stopVideoRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      clearInterval(this.recTimerInterval);
      clearInterval(this.recordingDrawInterval);
      this.recordingDrawInterval = null;

      const btn = document.getElementById('btnToggleRecord');
      btn.classList.remove('recording');
      btn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>
        <span>Quay Video</span>
      `;
    }
  },

  saveRecordedVideoFile() {
    if (this.recordedChunks.length === 0) return;
    const mimeType = (this.mediaRecorder && this.mediaRecorder.mimeType) || 'video/webm';
    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(this.recordedChunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `Quay_Video_DT_${this.activeCode}_${timestamp}.${extension}`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    this.showToast(`🎥 Đã lưu video ghi hình màn hình: ${filename}`);
  },

  // ================= 5. UTILITIES: ORIENTATION, FULLSCREEN, DISCONNECT =================
  toggleOrientation() {
    this.isLandscape = !this.isLandscape;
    const frame = document.getElementById('phoneViewportFrame');
    if (frame) {
      frame.classList.toggle('landscape', this.isLandscape);
    }
    const btn = document.getElementById('btnRotate');
    if (btn) {
      btn.innerHTML = this.isLandscape 
        ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H8C6.9 1 6 1.9 6 3v18c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H8V5h8v14z"/></svg> <span>Xoay dọc</span>`
        : `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-8c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-2 0H5V8h14v8z"/></svg> <span>Xoay ngang</span>`;
    }
  },

  async toggleFullscreen() {
    const stage = document.getElementById('mirrorPlayerStage');
    if (!stage) return;

    try {
      if (document.fullscreenElement === stage) {
        await document.exitFullscreen();
      } else if (stage.requestFullscreen) {
        await stage.requestFullscreen();
      } else {
        this.showToast('Trình duyệt này không hỗ trợ chế độ toàn màn hình.');
      }
    } catch (error) {
      console.error('Không thể bật toàn màn hình:', error);
      this.showToast('Không thể bật toàn màn hình trong trình duyệt này.');
    }
  },

  updateFullscreenButton() {
    const button = document.getElementById('btnFullscreen');
    const label = button && button.querySelector('span');
    if (label) {
      label.innerText = document.fullscreenElement ? 'Thoát toàn MH' : 'Toàn MH';
    }
  },

  disconnectPC() {
    if (this.isRecording) this.stopVideoRecording();
    clearInterval(this.signalPollInterval);
    clearInterval(this.frameRelayReceiverInterval);
    const vid = document.getElementById('remoteScreenVideo');
    if (vid) {
      vid.srcObject = null;
    }
    const img = document.getElementById('remoteScreenImg');
    if (img) img.style.display = 'none';

    document.getElementById('mirrorPlayerStage').classList.remove('active');
    document.getElementById('pcConnectCard').style.display = 'block';
    this.showToast('Đã ngắt kết nối với màn hình điện thoại.');
  },

  startSignalPolling(role) {
    clearInterval(this.signalPollInterval);
    this.signalPollInterval = setInterval(async () => {
      if (!this.activeCode) return;
      try {
        const res = await fetch(`/api/mirror/signal?code=${encodeURIComponent(this.activeCode)}&role=${role}`);
        if (res.ok) {
          const signals = await res.json();
          if (Array.isArray(signals)) {
            signals.forEach(s => this.handleSignalingPayload(s));
          }
        }
      } catch (e) {}
    }, 1000);
  },

  handleSignalingPayload(payload) {
    // Signaling implementation for WebRTC
  },

  showToast(msg) {
    const toast = document.getElementById('appToastNotice');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }
};

window.MirrorApp = MirrorApp;

document.addEventListener('DOMContentLoaded', () => {
  if (window.Auth) Auth.init();
  MirrorApp.init();
});

/**
 * AUTHENTICATION MODULE - GIAO DIỆN CŨ (NEON CYBER MODAL)
 */

const Auth = {
  currentUser: null,

  init() {
    this.bindEvents();
    this.checkSession();
  },

  checkSession() {
    const saved = localStorage.getItem('screen_mirror_user');
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
        this.onLoginSuccess(this.currentUser);
        return;
      } catch (e) {
        localStorage.removeItem('screen_mirror_user');
      }
    }
    // Show login modal if not logged in
    this.showLoginModal();
  },

  bindEvents() {
    const loginForm = document.getElementById('formLogin');
    const registerForm = document.getElementById('formRegister');
    const switchToRegister = document.getElementById('btnSwitchToRegister');
    const switchToLogin = document.getElementById('btnSwitchToLogin');
    const togglePwdBtns = document.querySelectorAll('.toggle-pwd-btn');
    const logoutBtn = document.getElementById('btnLogoutTop');

    if (loginForm) {
      loginForm.addEventListener('submit', (e) => this.handleLogin(e));
    }
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => this.handleRegister(e));
    }
    if (switchToRegister) {
      switchToRegister.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('registerView').style.display = 'block';
        this.clearAlerts();
      });
    }
    if (switchToLogin) {
      switchToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('registerView').style.display = 'none';
        document.getElementById('loginView').style.display = 'block';
        this.clearAlerts();
      });
    }

    togglePwdBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input');
        if (input.type === 'password') {
          input.type = 'text';
          btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="13" r="3"></circle></svg>`;
        } else {
          input.type = 'password';
          btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        }
      });
    });

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        if (this.currentUser) {
          this.logout();
        } else {
          this.showLoginModal();
        }
      });
    }
  },

  showAlert(type, msg, isRegister = false) {
    const alertBox = document.getElementById(isRegister ? 'regAlert' : 'loginAlert');
    if (!alertBox) return;
    alertBox.className = `auth-alert ${type}`;
    alertBox.innerText = msg;
    alertBox.style.display = 'block';
  },

  clearAlerts() {
    const alerts = document.querySelectorAll('.auth-alert');
    alerts.forEach(a => {
      a.style.display = 'none';
      a.innerText = '';
    });
  },

  async handleLogin(e) {
    e.preventDefault();
    this.clearAlerts();
    const username = document.getElementById('loginUsername').value.trim().toLowerCase();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
      this.showAlert('error', 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!');
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.currentUser = data.user;
        localStorage.setItem('screen_mirror_user', JSON.stringify(this.currentUser));
        this.onLoginSuccess(this.currentUser);
      } else {
        this.showAlert('error', data.message || 'Tài khoản hoặc mật khẩu không đúng!');
      }
    } catch (err) {
      // Local fallback
      let localUsers = JSON.parse(localStorage.getItem('screen_mirror_local_users') || '[]');
      const matched = localUsers.find(u => u.username.toLowerCase() === username.toLowerCase() && u.password === password);
      if (matched) {
        this.currentUser = { username: matched.username, name: matched.name };
        localStorage.setItem('screen_mirror_user', JSON.stringify(this.currentUser));
        this.onLoginSuccess(this.currentUser);
      } else {
        this.showAlert('error', 'Tên đăng nhập hoặc mật khẩu không chính xác!');
      }
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    this.clearAlerts();
    const name = document.getElementById('regName').value.trim();
    const username = document.getElementById('regUsername').value.trim().toLowerCase();
    const password = document.getElementById('regPassword').value;

    if (!name || !username || !password) {
      this.showAlert('error', 'Vui lòng điền đầy đủ các thông tin bắt buộc!', true);
      return;
    }

    if (username.length < 3) {
      this.showAlert('error', 'Tên tài khoản phải có ít nhất 3 ký tự!', true);
      return;
    }

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Switch to login view for first time login
        this.clearAlerts();
        document.getElementById('registerView').style.display = 'none';
        document.getElementById('loginView').style.display = 'block';
        document.getElementById('loginUsername').value = username;
        document.getElementById('loginPassword').value = '';
        document.getElementById('loginPassword').focus();
        this.showAlert('success', 'Đăng ký thành công! Hãy đăng nhập lại để bắt đầu.');
      } else {
        this.showAlert('error', data.message || 'Tên tài khoản đã tồn tại, hãy chọn tên khác!', true);
      }
    } catch (err) {
      let localUsers = JSON.parse(localStorage.getItem('screen_mirror_local_users') || '[]');
      const exists = localUsers.some(u => u.username.toLowerCase() === username.toLowerCase());
      if (exists) {
        this.showAlert('error', 'Tên tài khoản này đã được sử dụng! Vui lòng chọn tên khác.', true);
        return;
      }
      const newUser = { username, password, name };
      localUsers.push(newUser);
      localStorage.setItem('screen_mirror_local_users', JSON.stringify(localUsers));

      this.clearAlerts();
      document.getElementById('registerView').style.display = 'none';
      document.getElementById('loginView').style.display = 'block';
      document.getElementById('loginUsername').value = username;
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginPassword').focus();
      this.showAlert('success', 'Đăng ký thành công! Hãy đăng nhập lại để bắt đầu.');
    }
  },

  onLoginSuccess(user) {
    document.getElementById('loginOverlay').classList.add('hidden');
    const nameEl = document.getElementById('topBarUserName');
    if (nameEl) nameEl.innerText = user.name || user.username;
    const authButton = document.getElementById('btnLogoutTop');
    if (authButton) authButton.textContent = 'Đăng xuất';

    if (window.MirrorApp) {
      MirrorApp.switchView('viewDeviceSelector');
    }
  },

  showLoginModal() {
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginView').style.display = 'block';
    document.getElementById('registerView').style.display = 'none';
    const authButton = document.getElementById('btnLogoutTop');
    if (authButton) authButton.textContent = 'Đăng nhập';
  },

  logout() {
    if (confirm('Bạn có muốn đăng xuất không?')) {
      localStorage.removeItem('screen_mirror_user');
      this.currentUser = null;
      location.reload();
    }
  }
};

window.Auth = Auth;

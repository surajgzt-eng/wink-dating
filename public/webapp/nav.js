// Bottom nav
function injectBottomNav(activePage) {
  const tg = window.Telegram?.WebApp;
  const apiURL = location.origin;

  const nav = document.createElement('div');
  nav.className = 'bottom-nav';
  nav.innerHTML = `
    <a href="index.html?s=find" class="${activePage==='find'?'active':''}">
      <span class="nav-icon">💕</span><span class="nav-label">Find</span>
    </a>
    <a href="chats.html" class="${activePage==='chats'?'active':''}">
      <span class="nav-icon">💬</span><span class="nav-label">Chats</span>
    </a>
    <a href="profile.html" class="${activePage==='profile'?'active':''}">
      <span class="nav-icon">👤</span><span class="nav-label">Profile</span>
    </a>
  `;
  document.body.appendChild(nav);
}

function showToast(msg, isError) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('error', 'ok', 'show');
  if (isError) toast.classList.add('error'); else toast.classList.add('ok');
  void toast.offsetWidth;
  toast.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => toast.classList.remove('show'), 3500);
}

function getAuthHeaders() {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData) return {};
  return { 'Authorization': 'tma ' + tg.initData };
}

async function api(endpoint, options = {}) {
  const res = await fetch(location.origin + endpoint, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(), ...options.headers }
  });
  return res.json();
}

(function() {
  try {
    const pref = localStorage.getItem('wink_theme');
    if (pref === 'light') document.body.classList.add('light-theme');
  } catch (e) {}
})();
// Telegram WebApp Authentication Helper
(function() {
  const tg = window.Telegram?.WebApp;

  function getTgInitData() {
    return tg?.initData || '';
  }

  function getAuthHeaders(extra = {}) {
    const initData = getTgInitData();
    if (!initData) return {};
    return {
      ...extra,
      'Authorization': 'tma ' + initData
    };
  }

  function waitForInitData(timeout = 5000) {
    return new Promise((resolve, reject) => {
      const tg = window.Telegram?.WebApp;
      if (tg?.initData) { resolve(tg.initData); return; }
      let elapsed = 0;
      const interval = setInterval(() => {
        elapsed += 100;
        if (tg?.initData) { clearInterval(interval); resolve(tg.initData); }
        else if (elapsed >= timeout) { clearInterval(interval); reject(new Error('initData timeout')); }
      }, 100);
    });
  }

  window.__tgAuth = {
    getTgInitData,
    getAuthHeaders,
    waitForInitData
  };
})();
const { app, BrowserWindow, shell, ipcMain, session, Tray, nativeImage, Notification } = require('electron');
const path = require('path');

let tray = null;
let trayWindow = null;

const SSO_PARTITION = 'persist:jira-sso';

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 750,
    minWidth: 700,
    minHeight: 550,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

ipcMain.handle('get-login-item', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('set-login-item', (_event, enable) => {
  app.setLoginItemSettings({ openAtLogin: enable });
});

// Proxy all Jira API calls through the main process so the SSO session's
// cookies are sent automatically — fetch() in the renderer can't set Cookie headers.
ipcMain.handle('jira-fetch', async (_event, { url, path: apiPath }) => {
  const ssoSession = session.fromPartition(SSO_PARTITION);
  try {
    const res = await ssoSession.fetch(url + apiPath, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: err.message };
  }
});

// Opens a sandboxed login window, completes the Okta SSO flow.
// Resolves once session cookies are detected — no need to return them
// since they live in the SSO session and jira-fetch uses them directly.
ipcMain.handle('start-sso-login', async (_event, jiraUrl) => {
  return new Promise((resolve, reject) => {
    const loginWin = new BrowserWindow({
      width: 820,
      height: 700,
      title: 'Sign in to Jira',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: SSO_PARTITION,
      },
    });

    loginWin.webContents.session.setCertificateVerifyProc((_req, callback) => callback(0));
    loginWin.loadURL(jiraUrl);

    const jiraHost = new URL(jiraUrl).hostname;
    let resolved = false;

    async function tryResolve() {
      if (resolved) return;
      const cookies = await loginWin.webContents.session.cookies.get({ domain: jiraHost });
      const hasSession = cookies.some(c =>
        c.name.includes('session') || c.name.includes('token') || c.name === 'JSESSIONID'
      );
      if (!hasSession) return;
      resolved = true;
      resolve(true);
      loginWin.destroy();
    }

    loginWin.webContents.session.cookies.on('changed', (_e, cookie, _cause, removed) => {
      if (removed) return;
      if (cookie.domain.includes(jiraHost.replace(/^[^.]+/, ''))) tryResolve();
    });

    loginWin.webContents.on('did-navigate', (_e, url) => {
      try { if (new URL(url).hostname === jiraHost) tryResolve(); } catch { /* ignore */ }
    });

    // If user manually closes the window, succeed if any cookies are present
    loginWin.on('close', async () => {
      if (resolved) return;
      const cookies = await loginWin.webContents.session.cookies.get({ domain: jiraHost });
      if (cookies.length) { resolved = true; resolve(true); }
      else reject(new Error('Login cancelled'));
    });
  });
});

function createTrayWindow() {
  trayWindow = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });
  trayWindow.loadFile(path.join(__dirname, 'src', 'tray-popup.html'));
  trayWindow.on('blur', () => trayWindow.hide());
}

function createTray() {
  const iconPath = path.join(__dirname, 'icon.png');
  const img = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  img.setTemplateImage(true);
  tray = new Tray(img);
  tray.setToolTip('Jira Scanner');

  tray.on('click', (_event, bounds) => {
    if (trayWindow.isVisible()) {
      trayWindow.hide();
      return;
    }
    // Position the popup just below the tray icon
    const { x, y } = bounds;
    const { width, height } = trayWindow.getBounds();
    trayWindow.setPosition(
      Math.round(x - width / 2 + bounds.width / 2),
      Math.round(y + bounds.height + 4)
    );
    trayWindow.show();
    trayWindow.webContents.send('fetch-comments');
  });
}

ipcMain.on('notify', (_event, { title, body }) => {
  if (Notification.isSupported()) new Notification({ title, body }).show();
});

ipcMain.handle('open-main-window', () => {
  const wins = BrowserWindow.getAllWindows().filter(w => w !== trayWindow);
  if (wins.length) {
    wins[0].show();
    wins[0].focus();
  } else {
    createWindow();
  }
  trayWindow.hide();
});

app.whenReady().then(() => {
  // Bypass SSL cert verification for corporate proxy/SSL inspection on all sessions
  session.defaultSession.setCertificateVerifyProc((_req, callback) => callback(0));
  session.fromPartition(SSO_PARTITION).setCertificateVerifyProc((_req, callback) => callback(0));

  createWindow();
  createTrayWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter(w => w !== trayWindow).length === 0) createWindow();
  });
});

app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && (url.startsWith('http:') || url.startsWith('https:'))) {
      const allWindows = BrowserWindow.getAllWindows();
      const isLoginWin = allWindows.some(w => {
        try { return w.title === 'Sign in to Jira' && w.webContents.id === contents.id; } catch { return false; }
      });
      if (!isLoginWin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

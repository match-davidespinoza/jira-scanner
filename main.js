const { app, BrowserWindow, shell, ipcMain, Tray, nativeImage, Notification, nativeTheme, screen } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let tray = null;
let trayWindow = null;
let backdropWindow = null;
let trayPopupShownAt = 0;

const ACLI_BIN = '/opt/homebrew/bin/acli';

function runAcli(args) {
  return new Promise((resolve, reject) => {
    execFile(ACLI_BIN, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout);
    });
  });
}

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

ipcMain.handle('acli-get-config', () => {
  try {
    const configPath = path.join(os.homedir(), '.config', 'acli', 'jira_config.yaml');
    const content = fs.readFileSync(configPath, 'utf8');
    const site = (content.match(/- site: (.+)/) || [])[1]?.trim();
    const accountId = (content.match(/account_id: (.+)/) || [])[1]?.trim();
    const displayName = (content.match(/display_name: (.+)/) || [])[1]?.trim();
    return { ok: !!(site && accountId), site: site || '', accountId: accountId || '', displayName: displayName || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('acli-check-auth', async () => {
  try {
    await runAcli(['jira', 'workitem', 'search', '--jql', 'assignee = currentUser()', '--limit', '1', '--json']);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('acli-search', async (_event, { jql, fields, limit }) => {
  try {
    const args = ['jira', 'workitem', 'search', '--jql', jql, '--json'];
    if (fields) args.push('--fields', fields);
    if (limit) args.push('--limit', String(limit));
    const body = await runAcli(args);
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('acli-view', async (_event, { key, fields }) => {
  try {
    const args = ['jira', 'workitem', 'view', key, '--json'];
    if (fields) args.push('--fields', fields);
    const body = await runAcli(args);
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

function hideTrayPopup() {
  trayWindow.hide();
  backdropWindow.hide();
}

function createTrayWindow() {
  trayWindow = new BrowserWindow({
    width: 380,
    height: 520,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
    },
  });
  trayWindow.setAlwaysOnTop(true, 'pop-up-menu');
  trayWindow.loadFile(path.join(__dirname, 'src', 'tray-popup.html'));
  trayWindow.on('blur', () => hideTrayPopup());

  backdropWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  backdropWindow.setAlwaysOnTop(true, 'pop-up-menu');
  backdropWindow.loadFile(path.join(__dirname, 'src', 'backdrop.html'));
  backdropWindow.on('blur', () => {
    if (Date.now() - trayPopupShownAt < 500) return;
    hideTrayPopup();
  });
}

function getTrayIcon() {
  const file = nativeTheme.shouldUseDarkColors ? 'tray-icon.png' : 'tray-icon-light.png';
  const img = nativeImage.createFromPath(path.join(__dirname, file)).resize({ width: 16, height: 16 });
  img.setTemplateImage(false);
  return img;
}

function createTray() {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Jira Scanner');

  nativeTheme.on('updated', () => tray.setImage(getTrayIcon()));

  tray.on('click', (_event, bounds) => {
    if (trayWindow.isVisible()) {
      hideTrayPopup();
      return;
    }

    const { x, y } = bounds;
    const { width } = trayWindow.getBounds();
    trayWindow.setPosition(
      Math.round(x - width / 2 + bounds.width / 2),
      Math.round(y + bounds.height + 4)
    );

    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    backdropWindow.setBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    backdropWindow.show();
    backdropWindow.focus();

    trayPopupShownAt = Date.now();
    trayWindow.show();
    trayWindow.webContents.send('fetch-comments');
  });
}

ipcMain.on('backdrop-clicked', () => hideTrayPopup());

ipcMain.on('seen-updated', (_event, commentId, isSeen) => {
  BrowserWindow.getAllWindows().forEach(w => {
    if (w !== trayWindow) w.webContents.send('seen-updated', commentId, isSeen);
  });
});

ipcMain.on('notify', (_event, { title, body }) => {
  if (Notification.isSupported()) new Notification({
    title,
    body,
    icon: path.join(__dirname, 'icon.png'),
  }).show();
});

ipcMain.handle('open-main-window', () => {
  const wins = BrowserWindow.getAllWindows().filter(w => w !== trayWindow && w !== backdropWindow);
  if (wins.length) {
    wins[0].show();
    wins[0].focus();
  } else {
    createWindow();
  }
  hideTrayPopup();
});

app.on('will-resign-active', () => {
  if (Date.now() - trayPopupShownAt < 500) return;
  if (trayWindow && trayWindow.isVisible()) hideTrayPopup();
});

app.whenReady().then(() => {
  createWindow();
  createTrayWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter(w => w !== trayWindow && w !== backdropWindow).length === 0) createWindow();
  });
});

app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && (url.startsWith('http:') || url.startsWith('https:'))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

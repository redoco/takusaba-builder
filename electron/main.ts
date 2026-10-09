import { app, BrowserWindow, Menu, dialog, shell, safeStorage } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import fs from 'fs';
import { setUpdateState, updateEvents } from '../src/updates';

// These must be set BEFORE src/paths.ts is evaluated (it reads env at import
// time), so the server module is loaded lazily via dynamic import below.
app.setName('卓鯖ビルダー');
// Keep userData on an ASCII path for consistent tooling/AV behaviour
app.setPath('userData', path.join(app.getPath('appData'), 'TakusabaBuilder'));
process.env.SRB_APP_ROOT = process.env.SRB_APP_ROOT || (app.isPackaged
    ? app.getPath('userData') // %APPDATA%/TakusabaBuilder (win) / ~/Library/Application Support/TakusabaBuilder (mac)
    : path.join(__dirname, '..')); // dev `electron .`: repository root
process.env.SRB_WEB_DIST = path.join(app.getAppPath(), 'web/dist');
// Lets the bundled server distinguish packaged vs dev before it initializes state
process.env.SRB_PACKAGED = String(app.isPackaged);

if (process.platform === 'darwin') {
    // Minimal menu — Edit roles are needed for copy/paste in the token field
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }]
        },
        {
            label: 'Edit',
            submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
        },
        {
            label: 'Window',
            submenu: [{ role: 'minimize' }, { role: 'close' }]
        }
    ]));
} else {
    Menu.setApplicationMenu(null);
}

// Native-dialog strings, keyed by the language stored in data/config.json.
const DIALOG_STRINGS: Record<string, { unsavedTitle: string; unsavedMsg: string; close: string; cancel: string; startFail: string }> = {
    ja: {
        unsavedTitle: '未保存の変更',
        unsavedMsg: '保存していない変更があります。閉じると失われます。',
        close: '閉じる', cancel: 'キャンセル',
        startFail: '起動に失敗しました'
    },
    en: {
        unsavedTitle: 'Unsaved changes',
        unsavedMsg: 'You have unsaved changes. They will be lost if you close.',
        close: 'Close', cancel: 'Cancel',
        startFail: 'Failed to start'
    },
    ko: {
        unsavedTitle: '저장되지 않은 변경 사항',
        unsavedMsg: '저장하지 않은 변경 사항이 있습니다. 닫으면 사라집니다.',
        close: '닫기', cancel: '취소',
        startFail: '시작에 실패했습니다'
    },
    'zh-Hans': {
        unsavedTitle: '未保存的更改',
        unsavedMsg: '有未保存的更改，关闭后将丢失。',
        close: '关闭', cancel: '取消',
        startFail: '启动失败'
    },
    'zh-Hant': {
        unsavedTitle: '未儲存的變更',
        unsavedMsg: '有未儲存的變更，關閉後將會遺失。',
        close: '關閉', cancel: '取消',
        startFail: '啟動失敗'
    }
};

const dialogStrings = () => {
    try {
        const cfg = JSON.parse(
            fs.readFileSync(path.join(process.env.SRB_APP_ROOT!, 'data', 'config.json'), 'utf-8')
        );
        return DIALOG_STRINGS[cfg.language] ?? DIALOG_STRINGS.en;
    } catch {
        return DIALOG_STRINGS.en;
    }
};

let closeServer: (() => void) | null = null;

const openExternalSafe = (url: string) => {
    try {
        const u = new URL(url);
        if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url);
    } catch { /* ignore */ }
};

// --- Auto-update -------------------------------------------------------------
// Windows: electron-updater via GitHub Releases (latest.yml). macOS: unsigned
// builds can't use electron-updater, so we poll the GitHub API and send the
// user to the releases page instead (state.manual = true).

const semverGt = (a: string, b: string): boolean => {
    const pa = a.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = b.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d > 0;
    }
    return false;
};

const checkMacUpdate = async () => {
    setUpdateState({ status: 'checking' });
    try {
        const res = await fetch('https://api.github.com/repos/redoco/takusaba-builder/releases/latest', {
            headers: { 'User-Agent': 'takusaba-builder', 'Accept': 'application/vnd.github+json' }
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);
        const rel: any = await res.json();
        const latest = String(rel.tag_name ?? '').replace(/^v/, '');
        if (latest && semverGt(latest, app.getVersion())) {
            setUpdateState({ status: 'available', latestVersion: latest, manual: true });
        } else {
            setUpdateState({ status: 'not-available', latestVersion: latest || undefined });
        }
    } catch (e) {
        setUpdateState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
};

const setupUpdates = () => {
    setUpdateState({ currentVersion: app.getVersion() });

    if (!app.isPackaged) {
        setUpdateState({ status: 'unsupported' });
        return;
    }

    // Microsoft Store (AppX) builds are updated by the Store, not electron-updater
    if (process.windowsStore) {
        setUpdateState({ status: 'unsupported' });
        return;
    }

    if (process.platform === 'win32') {
        // E2E/dev hook: point the updater at a local generic feed
        const feed = process.env.SRB_UPDATE_FEED_URL;
        if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowPrerelease = false;
        let installAfterDownload = false;
        autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking' }));
        autoUpdater.on('update-available', i => setUpdateState({ status: 'available', latestVersion: i.version, manual: false }));
        autoUpdater.on('update-not-available', i => setUpdateState({ status: 'not-available', latestVersion: (i as any)?.version }));
        autoUpdater.on('download-progress', p => setUpdateState({ status: 'downloading', progress: Math.round(p.percent) }));
        autoUpdater.on('update-downloaded', i => {
            setUpdateState({ status: 'downloaded', latestVersion: i.version });
            if (installAfterDownload) autoUpdater.quitAndInstall(true, true);
        });
        const onUpdaterError = (e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            // A release without update metadata (e.g. uploaded manually) means no update is installable
            if (msg.includes('Cannot find latest.yml')) {
                setUpdateState({ status: 'not-available' });
            } else {
                setUpdateState({ status: 'error', error: msg });
            }
        };
        autoUpdater.on('error', onUpdaterError);
        updateEvents.on('check', () => {
            autoUpdater.checkForUpdates().catch(onUpdaterError);
        });
        updateEvents.on('download', () => {
            autoUpdater.downloadUpdate().catch(onUpdaterError);
        });
        updateEvents.on('install', () => autoUpdater.quitAndInstall(true, true));
        updateEvents.on('apply', () => {
            installAfterDownload = true;
            autoUpdater.downloadUpdate().catch(onUpdaterError);
        });
    } else if (process.platform === 'darwin') {
        updateEvents.on('check', () => { checkMacUpdate(); });
    } else {
        setUpdateState({ status: 'unsupported' });
        return;
    }

    // First check shortly after the window is shown, then every 6 hours
    setTimeout(() => updateEvents.emit('check'), 5000);
    setInterval(() => updateEvents.emit('check'), 6 * 60 * 60 * 1000);
};


const createWindow = async () => {
    const { setSecretCodec } = await import('../src/config');
    const useEncryption = app.isPackaged || process.env.SRB_ENCRYPT_TOKEN === '1';
    if (useEncryption && safeStorage.isEncryptionAvailable()) {
        setSecretCodec({
            encrypt: s => safeStorage.encryptString(s).toString('base64'),
            decrypt: b => safeStorage.decryptString(Buffer.from(b, 'base64'))
        });
    }
    const { startServer } = await import('../src/server');
    const { port, close } = await startServer(0);
    closeServer = close;

    const win = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 1000,
        minHeight: 680,
        backgroundColor: '#060907',
        title: '卓鯖ビルダー',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false
        }
    });

    win.once('ready-to-show', () => win.show());

    // External links open in the system browser, never in-app
    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternalSafe(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith('http://127.0.0.1:')) {
            e.preventDefault();
            openExternalSafe(url);
        }
    });

    // The web app asks beforeunload when there are unsaved edits — translate
    // that into a native confirm dialog.
    win.webContents.on('will-prevent-unload', e => {
        const d = dialogStrings();
        const r = dialog.showMessageBoxSync(win, {
            type: 'warning',
            buttons: [d.close, d.cancel],
            defaultId: 1,
            cancelId: 1,
            title: d.unsavedTitle,
            message: d.unsavedMsg
        });
        if (r === 0) e.preventDefault();
    });

    if (!app.isPackaged) {
        win.webContents.on('before-input-event', (_e, input) => {
            if (input.control && input.shift && input.key.toLowerCase() === 'i' && input.type === 'keyDown') {
                win.webContents.toggleDevTools();
            }
        });
    }

    win.loadURL(`http://127.0.0.1:${port}`);

    win.once('ready-to-show', () => setupUpdates());
};

app.whenReady().then(async () => {
    try {
        await createWindow();
    } catch (e) {
        dialog.showErrorBox(dialogStrings().startFail, e instanceof Error ? e.message : String(e));
        app.quit();
    }
});

// Closing the window quits the app on every platform (per product requirement)
app.on('window-all-closed', () => app.quit());

app.on('before-quit', () => {
    closeServer?.();
});

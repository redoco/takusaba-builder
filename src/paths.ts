import path from 'path';

export const IS_ELECTRON = !!process.versions.electron;
// Parent of the data directory. Electron main sets SRB_APP_ROOT to userData.
export const APP_ROOT = process.env.SRB_APP_ROOT || path.join(__dirname, '..');
export const DATA_DIR = path.join(APP_ROOT, 'data');
export const ASSETS_DIR = path.join(DATA_DIR, 'assets');
export const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const ROLES_FILE = path.join(DATA_DIR, 'created-roles.json');
export const WEB_DIST = process.env.SRB_WEB_DIST || path.join(__dirname, '../web/dist');

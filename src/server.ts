import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as data from './data';
import * as operations from './discord/operations2';
import { fetchMembers } from './discord/client2';
import setupRouter from './setup';
import { isConfigured } from './config';
import { ensureSeedPresets } from './seed';
import { getUpdateState, setUpdateState, updateEvents } from './updates';
import { DATA_DIR, ASSETS_DIR, WEB_DIST } from './paths';

// Dev mode has no Electron main process to stamp the version — read it from package.json
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    setUpdateState({
        currentVersion: pkg.version ?? '',
        status: process.env.SRB_PACKAGED === 'true' ? 'idle' : 'unsupported'
    });
} catch { /* leave empty */ }

dotenv.config();

const app = express();

// Ensure data directories exist
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

// Multer setup
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, ASSETS_DIR);
    },
    filename: (req, file, cb) => {
        // preserve extension (sanitized to a safe charset)
        const raw = path.extname(file.originalname).toLowerCase();
        const ext = /^\.[a-z0-9]{1,10}$/.test(raw) ? raw : '';
        const id = randomUUID();
        cb(null, `${id}${ext}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const hostnameOf = (hostHeader: string) => { try { return new URL(`http://${hostHeader}`).hostname; } catch { return ''; } };
const isLocalHost = (h: string) => LOCAL_HOSTS.has(h);
app.use((req, res, next) => {
    if (!isLocalHost(hostnameOf(req.headers.host ?? ''))) return res.status(403).json({ error: 'FORBIDDEN_HOST' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.headers.origin;
        if (origin) {
            let ok = false;
            try { const u = new URL(origin); ok = u.protocol === 'http:' && isLocalHost(u.hostname); } catch { /* invalid */ }
            if (!ok) return res.status(403).json({ error: 'FORBIDDEN_ORIGIN' });
        }
    }
    next();
});

const SPA_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://cdn.discordapp.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path === '/' || req.path.endsWith('.html')) {
        res.setHeader('Content-Security-Policy', SPA_CSP);
    }
    next();
});

app.use(express.json());

// Serve static files from web/dist
app.use(express.static(WEB_DIST));

// Serve assets
app.use('/assets', express.static(ASSETS_DIR, {
    dotfiles: 'deny',
    setHeaders: res => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', 'sandbox');
    }
}));

// API Routes

// Setup
app.use('/api/setup', setupRouter);

// Guard: Discord-dependent APIs require configuration
app.use(['/api/guild', '/api/run', '/api/debug'], (req, res, next) => {
    if (!isConfigured()) {
        return res.status(409).json({ error: 'NOT_CONFIGURED' });
    }
    next();
});

// Shared error responder for Discord-dependent routes.
// A Discord 401 (DiscordAPIError) means the stored token is dead — surface a
// readable Japanese hint instead of the raw upstream message.
const sendError = (res: express.Response, e: any) => {
    if (e?.code === 50013 || e?.rawError?.code === 50013) {
        return res.status(500).json({
            error: `Botの権限が不足しています（Discord 50013）。Botのロールに「チャンネルの管理」「ロールの管理」があるか、サーバー設定で確認してください。 ${e.message}`
        });
    }
    if (e?.code === 60003 || e?.rawError?.code === 60003) {
        return res.status(500).json({
            error: `サーバー設定で「モデレーション操作に2段階認証を要求」が有効なため、Bot を作成したアカウントに2段階認証（2FA）を設定する必要があります。 ${e.message}`
        });
    }
    if (e?.status === 401) {
        return res.status(401).json({
            error: 'Discord に接続できません。Bot トークンが無効か、Developer Portal でリセットされた可能性があります。左下の「セットアップ」からやり直してください。',
            code: 'DISCORD_UNAUTHORIZED'
        });
    }
    res.status(500).json({ error: e.message });
};

// Presets
app.get('/api/presets', (req, res) => {
    try {
        const presets = data.getPresets();
        res.json(presets);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

const isSnowflake = (v: unknown): v is string => typeof v === 'string' && /^\d{17,20}$/.test(v);
const SUPPORTED_LANGUAGES = ['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'];

app.post('/api/presets', (req, res) => {
    try {
        // Can be a single preset or array. User requirement says "save (all or one)".
        // If array, replace all. If object, add/update one.
        // Let's support both or just stick to one. "save globally" is easiest for UI state.
        // But `data.ts` has `savePreset` (one).
        // Let's assume UI sends one preset to save/update.
        const preset = req.body;
        const valid =
            preset !== null &&
            typeof preset === 'object' &&
            !Array.isArray(preset) &&
            (preset.presetId === undefined || (typeof preset.presetId === 'string' && /^[\w-]{1,64}$/.test(preset.presetId))) &&
            (preset.presetName === undefined || (typeof preset.presetName === 'string' && preset.presetName.length <= 30)) &&
            (preset.channels === undefined || Array.isArray(preset.channels)) &&
            (preset.posts === undefined || Array.isArray(preset.posts)) &&
            (preset.roleCharacters === undefined || (
                Array.isArray(preset.roleCharacters) && preset.roleCharacters.length <= 50 &&
                preset.roleCharacters.every((c: any) =>
                    c !== null && typeof c === 'object' &&
                    typeof c.name === 'string' && c.name.length <= 80 &&
                    (c.channelKey === undefined || typeof c.channelKey === 'string'))
            ));
        if (!valid) return res.status(400).json({ error: 'INVALID_PRESET' });
        if (!preset.presetId) preset.presetId = randomUUID();
        if (!preset.channels) preset.channels = [];
        if (!preset.posts) preset.posts = [];
        data.savePreset(preset);
        res.json({ success: true, preset });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/presets/:id', (req, res) => {
    try {
        if (!/^[\w-]{1,64}$/.test(req.params.id)) return res.status(400).json({ error: 'INVALID_PRESET_ID' });
        data.deletePreset(req.params.id);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Seeds the sample preset for the chosen language — only when there are no
// presets yet (first run). Existing users get { ok, skipped } and nothing
// is written.
app.post('/api/presets/seed', (req, res) => {
    try {
        const language = req.body?.language;
        const result = ensureSeedPresets(
            typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language) ? language : 'ja'
        );
        res.json(result === 'written' ? { ok: true } : { ok: true, skipped: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Assets
app.post('/api/assets/upload', (req, res) => {
    upload.single('file')(req, res, (err: any) => {
        if (err) {
            if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'FILE_TOO_LARGE' });
            }
            return res.status(400).json({ error: 'UPLOAD_FAILED' });
        }
        try {
            if (!req.file) throw new Error('No file uploaded');
            res.json({
                assetId: req.file.filename, // Use filename as ID to keep extension
                path: `/assets/${req.file.filename}`
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });
});

// Run Operations
app.post('/api/run/create', async (req, res) => {
    try {
        const { presetId, categoryName, memberIds, hiddenAccess, roles } = req.body ?? {};
        if (
            typeof presetId !== 'string' ||
            typeof categoryName !== 'string' || categoryName.length < 1 || categoryName.length > 100 ||
            !Array.isArray(memberIds) || memberIds.length > 500 || !memberIds.every(isSnowflake)
        ) {
            return res.status(400).json({ error: 'INVALID_FIELDS' });
        }
        const hiddenAccessValid =
            hiddenAccess === undefined ||
            (hiddenAccess !== null && typeof hiddenAccess === 'object' && !Array.isArray(hiddenAccess) &&
                Object.keys(hiddenAccess).length <= 50 &&
                Object.entries(hiddenAccess).every(([k, v]) =>
                    typeof k === 'string' && k.length >= 1 && k.length <= 64 &&
                    Array.isArray(v) && v.length <= 500 && v.every(isSnowflake) &&
                    v.every((id: string) => memberIds.includes(id))
                ));
        if (!hiddenAccessValid) {
            return res.status(400).json({ error: 'INVALID_FIELDS' });
        }

        // roles: { items: [{ kind, name, memberIds, channelKey? }], anchorRoleId }
        const ROLE_KINDS = ['gm', 'pl', 'watch', 'character'];
        const hiddenKeys = new Set(
            (data.getPresets().find(p => p.presetId === presetId)?.channels ?? []).filter(c => c.isHidden).map(c => c.key)
        );
        const rolesValid =
            roles === undefined || roles === null ||
            (typeof roles === 'object' &&
                Array.isArray(roles.items) && roles.items.length <= 50 &&
                (roles.anchorRoleId === undefined || roles.anchorRoleId === null || isSnowflake(roles.anchorRoleId)) &&
                roles.items.every((it: any) =>
                    it !== null && typeof it === 'object' &&
                    ROLE_KINDS.includes(it.kind) &&
                    typeof it.name === 'string' && it.name.trim().length >= 1 && it.name.length <= 100 &&
                    Array.isArray(it.memberIds) && it.memberIds.every((id: unknown) => isSnowflake(id) && memberIds.includes(id)) &&
                    (it.channelKey === undefined || (it.kind === 'character' && typeof it.channelKey === 'string' && hiddenKeys.has(it.channelKey)))
                ) &&
                ['gm', 'pl', 'watch'].every(k => roles.items.filter((it: any) => it.kind === k).length <= 1));
        if (!rolesValid) {
            return res.status(400).json({ error: 'INVALID_FIELDS' });
        }
        const roleOptions = roles
            ? {
                items: roles.items.map((it: any) => ({
                    kind: it.kind,
                    name: it.name.trim(),
                    memberIds: it.memberIds,
                    ...(it.channelKey ? { channelKey: it.channelKey } : {})
                })),
                anchorRoleId: roles.anchorRoleId ?? null
            }
            : null;

        const result = await operations.runCreate(presetId, categoryName, memberIds, hiddenAccess ?? {}, roleOptions);
        res.json(result);
    } catch (e: any) {
        console.error("Create run failed:", e);
        sendError(res, e);
    }
});

app.post('/api/run/delete', async (req, res) => {
    try {
        const { categoryIds, deleteRoles } = req.body ?? {};
        if (
            !Array.isArray(categoryIds) || categoryIds.length < 1 ||
            categoryIds.length > 100 || !categoryIds.every(isSnowflake)
        ) {
            return res.status(400).json({ error: 'INVALID_CATEGORY_IDS' });
        }

        const result = await operations.runDelete(categoryIds, deleteRoles === true);
        res.json(result);
    } catch (e: any) {
        console.error("Delete run failed:", e);
        sendError(res, e);
    }
});

app.get('/api/debug/members-raw', async (req, res) => {
    try {
        const raw = await fetchMembers(10) as any[];
        const debug = raw.map((m: any) => ({
            username: m.user.username,
            bot: m.user.bot,
            system: m.user.system,
            flags: m.user.public_flags,
            id: m.user.id
        }));
        res.json({ total: raw.length, members: debug });
    } catch (e: any) {
        sendError(res, e);
    }
});

app.get('/api/guild/members', async (req, res) => {
    try {
        const { limit, after } = req.query;
        let limitNum: number | undefined;
        if (limit !== undefined) {
            limitNum = Number(limit);
            if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum < 1 || limitNum > 1000) {
                return res.status(400).json({ error: 'INVALID_LIMIT' });
            }
        }
        if (after !== undefined && !isSnowflake(after)) {
            return res.status(400).json({ error: 'INVALID_AFTER' });
        }
        const members = await operations.getGuildMembers(limitNum, after as string | undefined);
        res.json(members);
    } catch (e: any) {
        console.error("Fetch members failed:", e);
        sendError(res, e);
    }
});

app.get('/api/guild/roles', async (req, res) => {
    try {
        res.json(await operations.getGuildRoles());
    } catch (e: any) {
        console.error("Fetch roles failed:", e);
        sendError(res, e);
    }
});

app.get('/api/guild/categories', async (req, res) => {
    try {
        const categories = await operations.getGuildCategories();
        res.json(categories);
    } catch (e: any) {
        console.error("Fetch categories failed:", e);
        sendError(res, e);
    }
});

// Open the data directory in the OS file manager
app.post('/api/system/open-data-dir', (req, res) => {
    try {
        const cmd = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        spawn(cmd, [DATA_DIR], { detached: true, stdio: 'ignore' }).unref();
        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Update status / control — the Electron main process subscribes to updateEvents
app.get('/api/system/update-status', (req, res) => {
    res.json(getUpdateState());
});
app.post('/api/system/update/check', (req, res) => {
    updateEvents.emit('check');
    res.json({ ok: true });
});
app.post('/api/system/update/download', (req, res) => {
    updateEvents.emit('download');
    res.json({ ok: true });
});
app.post('/api/system/update/install', (req, res) => {
    updateEvents.emit('install');
    res.json({ ok: true });
});
app.post('/api/system/update/apply', (req, res) => {
    updateEvents.emit('apply');
    res.json({ ok: true });
});


// Unknown API routes return 404 JSON instead of the SPA fallback
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Fallback to index.html for SPA
app.get(/.*/, (req, res) => {
    res.setHeader('Content-Security-Policy', SPA_CSP);
    res.sendFile(path.join(WEB_DIST, 'index.html'));
});

// Starts the Express app. preferredPort 0 lets the OS pick a free port;
// otherwise EADDRINUSE retries port+1 up to 10 times.
export const startServer = (preferredPort: number): Promise<{ port: number; close: () => void }> => {
    return new Promise((resolve, reject) => {
        const attempt = (port: number, tries: number) => {
            const server = app.listen(port, '127.0.0.1');
            server.once('error', (e: any) => {
                if (e.code === 'EADDRINUSE' && preferredPort !== 0 && tries < 10) {
                    attempt(port + 1, tries + 1);
                } else {
                    reject(e);
                }
            });
            server.once('listening', () => {
                const address = server.address();
                const port = typeof address === 'object' && address ? address.port : preferredPort;
                resolve({ port, close: () => server.close() });
            });
        };
        attempt(preferredPort, 0);
    });
};

if (require.main === module) {
    startServer(Number(process.env.PORT) || 3000).then(({ port }) => {
        console.log(`Server is running on http://localhost:${port}`);
        console.log(`Data directory: ${DATA_DIR}`);
        console.log(`Configured: ${isConfigured()}`);
    });
}

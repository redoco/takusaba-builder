import {
    createCategory,
    createChannel,
    postMessage,
    postFile,
    deleteChannel,
    fetchMembers,
    fetchChannels,
    getGuildId,
    getBotUser,
    fetchRoles,
    createRole,
    addMemberRole,
    deleteRole,
    getBotMember,
    setRolePositions
} from './client2';
import { getPresets, getAssetPath, getCreatedRoles, setCreatedRoles } from '../data';
import {
    VIEW_CHANNEL,
    SEND_MESSAGES,
    ATTACH_FILES,
    READ_MESSAGE_HISTORY,
    SPEAK
} from './permissions';
import fs from 'fs';

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

export const getGuildMembers = async (limit = 1000, after?: string) => {
    try {
        const fetchAll = limit === undefined || limit >= PAGE_SIZE;

        const mapMember = (m: any) => ({
            id: m.user.id,
            username: m.user.username,
            discriminator: m.user.discriminator,
            global_name: m.user.global_name,
            avatar: m.user.avatar
        });

        if (!fetchAll) {
            const members = await fetchMembers(limit, after) as any[];
            return members.filter((m: any) => !m.user.bot).map(mapMember);
        }

        const all: any[] = [];
        let cursor = after;
        for (let page = 0; page < MAX_PAGES; page++) {
            const members = await fetchMembers(PAGE_SIZE, cursor) as any[];
            all.push(...members);
            if (members.length < PAGE_SIZE) break;
            cursor = members[members.length - 1].user.id;
        }
        return all.filter((m: any) => !m.user.bot).map(mapMember);
    } catch (e) {
        console.error("Error fetching members:", e);
        throw e;
    }
};

export const getGuildCategories = async () => {
    try {
        const channels = await fetchChannels();
        const childrenOf = (catId: string) => channels.filter((c: any) => c.parent_id === catId);
        return channels
            .filter((c: any) => c.type === 4) // 4 = GUILD_CATEGORY
            .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
            .map((c: any) => {
                const children = childrenOf(c.id);
                return {
                    id: c.id,
                    name: c.name,
                    position: c.position ?? 0,
                    childCount: children.length,
                    roleCount: getCreatedRoles(c.id).length,
                    managed: children.some((ch: any) =>
                        typeof ch.topic === 'string' && ch.topic.includes('managed_by=local_preset_tool'))
                };
            });
    } catch (e) {
        console.error("Error fetching categories:", e);
        throw e;
    }
};

// ---- ロール（マダミナリンク方式） ----
// 名前はクライアント側で「{絵文字}GM」「{絵文字}⑴アダム」のように組み立てて渡す。
export type RoleKind = 'gm' | 'pl' | 'watch' | 'character';

export interface RoleSpec {
    kind: RoleKind;
    name: string;
    /** このロールを付与する参加者（memberIds の部分集合） */
    memberIds: string[];
    /** character のみ：このキャラクターのロールが見られる秘匿チャンネル */
    channelKey?: string;
}

export interface RoleOptions {
    /** 上から順に並べたいロール */
    items: RoleSpec[];
    /** このロールのすぐ下に作る。null なら一番下（@everyone の直上） */
    anchorRoleId: string | null;
}

const describeError = (e: any) => {
    let msg = e?.message ?? String(e);
    if (e?.rawError) msg += ` (Discord: ${JSON.stringify(e.rawError)})`;
    return msg;
};
const isMissingPerms = (e: any) => e?.code === 50013 || e?.rawError?.code === 50013;

const sortRolesTopDown = (roles: any[]) =>
    [...roles].sort((a, b) => (b.position - a.position) || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

/** サーバーのロール一覧（上から順）と、Bot が動かせる上限位置 */
export const getGuildRoles = async () => {
    const guildId = getGuildId();
    const botUser: any = await getBotUser();
    const [roles, botMember] = await Promise.all([fetchRoles(), getBotMember(botUser.id)]);
    const byId = new Map(roles.map((r: any) => [r.id, r]));
    const botTop = Math.max(0, ...((botMember.roles ?? []) as string[]).map(id => byId.get(id)?.position ?? 0));
    const botRoleIds = new Set<string>(botMember.roles ?? []);
    return {
        botTopPosition: botTop,
        roles: sortRolesTopDown(roles.filter((r: any) => r.id !== guildId)).map((r: any) => ({
            id: r.id,
            name: r.name,
            color: r.color ?? 0,
            position: r.position,
            managed: !!r.managed,
            isBot: botRoleIds.has(r.id),
            // Bot の一番上のロール自身、またはそれより下のロールの「下」に作れる
            selectable: r.position <= botTop
        }))
    };
};

/** newIds（上から順）を anchor のすぐ下（anchor が null なら一番下）に並べ替える */
const placeRoles = async (newIds: string[], anchorRoleId: string | null) => {
    const guildId = getGuildId();
    const all = (await fetchRoles()).filter((r: any) => r.id !== guildId);
    const newSet = new Set(newIds);
    const order = sortRolesTopDown(all).filter((r: any) => !newSet.has(r.id));
    let idx = order.length;
    if (anchorRoleId) {
        const i = order.findIndex((r: any) => r.id === anchorRoleId);
        if (i < 0) throw new Error('指定したロールがサーバーに見つかりません');
        idx = i + 1;
    }
    const finalIds = [...order.slice(0, idx).map((r: any) => r.id), ...newIds, ...order.slice(idx).map((r: any) => r.id)];
    const current = new Map(all.map((r: any) => [r.id, r.position]));
    const n = finalIds.length;
    // 指定位置より上のロールは動かさない（Bot より上のロールは触れないため）
    const payload = finalIds
        .map((id, i) => ({ id, position: n - i, i }))
        .filter(p => p.i >= idx && current.get(p.id) !== p.position)
        .map(({ id, position }) => ({ id, position }));
    if (payload.length > 0) await setRolePositions(payload);
};

type Overwrite = { id: string, type: 0 | 1, allow?: string, deny?: string };

// 同じ ID の権限設定が重複すると Discord が拒否するので、ビットを OR でまとめる
const mergeOverwrites = (list: Overwrite[]): Overwrite[] => {
    const map = new Map<string, { id: string, type: 0 | 1, allow: bigint, deny: bigint }>();
    for (const o of list) {
        const cur = map.get(o.id) ?? { id: o.id, type: o.type, allow: 0n, deny: 0n };
        cur.allow |= BigInt(o.allow ?? '0');
        cur.deny |= BigInt(o.deny ?? '0');
        map.set(o.id, cur);
    }
    return [...map.values()].map(o => ({
        id: o.id,
        type: o.type,
        allow: o.allow.toString(),
        deny: (o.deny & ~o.allow).toString()
    }));
};

export const runCreate = async (
    presetId: string,
    categoryName: string,
    memberIds: string[],
    hiddenAccess: Record<string, string[]> = {},
    roleOptions: RoleOptions | null = null
) => {
    const roleItems = roleOptions?.items ?? [];
    console.log(`[runCreate] Starting for preset=${presetId}, category=${categoryName}, members=${memberIds.length}, hiddenAccessKeys=${Object.keys(hiddenAccess).length}, roles=${roleItems.length}`);
    const presets = getPresets();
    const preset = presets.find(p => p.presetId === presetId);
    if (!preset) throw new Error(`Preset ${presetId} not found`);

    const guildId = getGuildId();
    if (!guildId) throw new Error("Guild ID not configured");

    const result = {
        category: { id: '', name: categoryName },
        channels: [] as any[],
        roles: [] as { id?: string, name: string, kind: RoleKind, success: boolean, members: number, error?: string }[],
        errors: [] as string[]
    };

    const createdRoleIds: string[] = [];

    try {
        const botUser: any = await getBotUser();

        const GM_BITS = VIEW_CHANNEL | SEND_MESSAGES | ATTACH_FILES | READ_MESSAGE_HISTORY;
        const PL_BITS = VIEW_CHANNEL | SEND_MESSAGES;
        const WATCH_BITS = VIEW_CHANNEL | READ_MESSAGE_HISTORY;

        const everyoneDeny: Overwrite = { id: guildId, type: 0, deny: VIEW_CHANNEL.toString() };
        const botAllow: Overwrite = {
            id: botUser.id,
            type: 1,
            // Discord rejects overwrites granting permissions the bot lacks (50013);
            // MANAGE_ROLES in a channel overwrite additionally requires Administrator.
            allow: GM_BITS.toString()
        };
        const allow = (id: string, type: 0 | 1, bits: bigint): Overwrite => ({ id, type, allow: bits.toString() });
        // 観戦：テキストは読むだけ、ボイスは聞くだけ
        const watchOw = (id: string, type: 0 | 1, voice: boolean, speakDeny: boolean): Overwrite => ({
            id, type,
            allow: WATCH_BITS.toString(),
            deny: (voice ? (speakDeny ? SPEAK : 0n) : SEND_MESSAGES).toString()
        });

        // ---- ロール作成・並べ替え・付与 ----
        const created: { spec: RoleSpec, id: string, assigned: Set<string> }[] = [];
        if (roleItems.length > 0) {
            for (const spec of roleItems) {
                try {
                    const role: any = await createRole(spec.name);
                    createdRoleIds.push(role.id);
                    created.push({ spec, id: role.id, assigned: new Set() });
                } catch (e: any) {
                    let msg = describeError(e);
                    if (isMissingPerms(e)) msg = `Botに「ロールの管理」権限がありません（Discord 50013）。 ${msg}`;
                    result.roles.push({ name: spec.name, kind: spec.kind, success: false, members: 0, error: msg });
                    result.errors.push(`ロール「${spec.name}」を作成できませんでした: ${msg}`);
                }
            }

            if (created.length > 0) {
                try {
                    await placeRoles(created.map(c => c.id), roleOptions?.anchorRoleId ?? null);
                } catch (e: any) {
                    let msg = describeError(e);
                    if (isMissingPerms(e)) msg = `指定した位置が Bot のロールより上のため移動できません。 ${msg}`;
                    result.errors.push(`ロールを指定の位置に並べられませんでした（一番下に作成されています）: ${msg}`);
                }
            }

            for (const c of created) {
                for (const uid of c.spec.memberIds) {
                    try {
                        await addMemberRole(uid, c.id);
                        c.assigned.add(uid);
                    } catch (e: any) {
                        result.errors.push(`ロール「${c.spec.name}」をメンバー ${uid} に付与できませんでした: ${describeError(e)}`);
                    }
                }
                result.roles.push({ id: c.id, name: c.spec.name, kind: c.spec.kind, success: true, members: c.assigned.size });
            }
            // 作成順ではなく指定の並び順で返す
            result.roles.sort((a, b) =>
                roleItems.findIndex(s => s.name === a.name && s.kind === a.kind) -
                roleItems.findIndex(s => s.name === b.name && s.kind === b.kind));
        }

        const roleOf = (kind: RoleKind) => created.find(c => c.spec.kind === kind) ?? null;
        const gm = roleOf('gm');
        const pl = roleOf('pl');
        const watch = roleOf('watch');

        // 参加者ごとの立場（ロール未使用なら全員 PL 扱い＝従来どおり）
        const tierOf = new Map<string, RoleKind>();
        for (const uid of memberIds) tierOf.set(uid, 'pl');
        for (const spec of roleItems) {
            if (spec.kind === 'gm' || spec.kind === 'watch') for (const uid of spec.memberIds) tierOf.set(uid, spec.kind);
        }
        // ロールで権限が届かない人（ロール作成・付与に失敗した人、ロールを使わない場合）は個人単位で設定する
        const needsFallback = (uid: string) => {
            const tier = tierOf.get(uid)!;
            const r = tier === 'gm' ? gm : tier === 'watch' ? watch : pl;
            return !r || !r.assigned.has(uid);
        };
        const fallback = (tier: RoleKind) => memberIds.filter(uid => tierOf.get(uid) === tier && needsFallback(uid));

        const buildOverwrites = (opts: { hiddenKey?: string, voice: boolean, speakDeny: boolean }): Overwrite[] => {
            const list: Overwrite[] = [everyoneDeny, botAllow];
            if (gm) list.push(allow(gm.id, 0, GM_BITS));
            list.push(...fallback('gm').map(uid => allow(uid, 1, PL_BITS)));
            if (opts.hiddenKey !== undefined) {
                // 秘匿チャンネル：GM ＋ 閲覧者に選んだ人 ＋ 紐づけたキャラクターロール
                const key = opts.hiddenKey;
                const coveredByGm = (uid: string) => !!gm && gm.assigned.has(uid);
                list.push(...(hiddenAccess[key] ?? []).filter(uid => !coveredByGm(uid)).map(uid => allow(uid, 1, PL_BITS)));
                for (const c of created) {
                    if (c.spec.kind === 'character' && c.spec.channelKey === key) list.push(allow(c.id, 0, PL_BITS));
                }
            } else {
                if (pl) list.push(allow(pl.id, 0, PL_BITS));
                list.push(...fallback('pl').map(uid => allow(uid, 1, PL_BITS)));
                if (watch) list.push(watchOw(watch.id, 0, opts.voice, opts.speakDeny));
                list.push(...fallback('watch').map(uid => watchOw(uid, 1, opts.voice, opts.speakDeny)));
            }
            return mergeOverwrites(list);
        };

        const cat: any = await createCategory(categoryName, buildOverwrites({ voice: false, speakDeny: false }));
        result.category.id = cat.id;
        if (createdRoleIds.length > 0) {
            try {
                setCreatedRoles(cat.id, createdRoleIds);
            } catch (e: any) {
                console.error('Failed to record created roles', e);
            }
        }

        const hasWatchers = !!watch || fallback('watch').length > 0;

        for (const ch of preset.channels) {
            try {
                const nowProp = new Date().toISOString();
                const topic = `managed_by=local_preset_tool; preset=${presetId}; created=${nowProp}`;
                const isVoice = ch.type === 'voice';
                const hiddenKey = ch.isHidden ? ch.key : undefined;

                const channelType = isVoice ? 2 : 0;
                let channel: any;
                try {
                    channel = await createChannel(ch.name, cat.id, buildOverwrites({ hiddenKey, voice: isVoice, speakDeny: true }), topic, channelType);
                } catch (e: any) {
                    // Bot 自身に「発言」権限がないと SPEAK の拒否を設定できない → 外して再試行
                    if (isVoice && hasWatchers && !ch.isHidden && isMissingPerms(e)) {
                        channel = await createChannel(ch.name, cat.id, buildOverwrites({ hiddenKey, voice: true, speakDeny: false }), topic, channelType);
                        result.errors.push(`ボイスチャンネル「${ch.name}」：Botに「発言」権限がないため、観戦の発言禁止を設定できませんでした`);
                    } else {
                        throw e;
                    }
                }

                result.channels.push({ id: channel.id, name: channel.name, success: true });

                if (!isVoice) {
                    const postDef = preset.posts.find(p => p.targetChannelKey === ch.key);
                    if (postDef) {
                        for (const item of postDef.items) {
                            try {
                                if (item.type === 'text') {
                                    if (item.content) await postMessage(channel.id, item.content);
                                } else if (item.type === 'file' && item.assetId) {
                                    const assetPath = getAssetPath(item.assetId);
                                    if (assetPath && fs.existsSync(assetPath)) {
                                        const data = fs.readFileSync(assetPath);
                                        await postFile(channel.id, item.caption || '', [{
                                            name: item.filename || item.assetId,
                                            data
                                        }]);
                                    }
                                }
                            } catch (e: any) {
                                result.errors.push(`Failed to post to ${channel.name}: ${e.message}`);
                            }
                        }
                    }
                }

            } catch (e: any) {
                const errorMsg = describeError(e);
                result.channels.push({ name: ch.name, success: false, error: errorMsg });
                result.errors.push(`Failed to create channel ${ch.name}: ${errorMsg}`);
            }
        }

    } catch (e: any) {
        let errorMsg = describeError(e);
        if (isMissingPerms(e)) {
            errorMsg = `Botの権限が不足しています（Discord 50013）。Botのロールに「チャンネルの管理」「ロールの管理」があるか、サーバー設定で確認してください。 ${errorMsg}`;
        }
        if (e.code === 60003 || e.rawError?.code === 60003) {
            errorMsg = `サーバー設定で「モデレーション操作に2段階認証を要求」が有効なため、Bot を作成したアカウントに2段階認証（2FA）を設定する必要があります。 ${errorMsg}`;
        }
        result.errors.push(`Execution failed: ${errorMsg}`);
        // カテゴリ自体が作れなかった場合、作ったロールが孤立しないよう片付ける
        if (!result.category.id) {
            for (const rid of createdRoleIds) {
                try { await deleteRole(rid); } catch { /* ignore */ }
            }
            result.roles = result.roles.map(r => ({ ...r, success: false, error: r.error ?? 'カテゴリ作成に失敗したため削除しました' }));
        }
    }

    return result;
};

export const runDelete = async (categoryIds: string[], deleteRoles = false) => {
    const results = [];

    // Delete children first, then the category itself
    let allChannels: any[] = [];
    let allRoles: any[] = [];
    try {
        if (getGuildId()) {
            allChannels = await fetchChannels();
            if (deleteRoles) allRoles = await fetchRoles();
        }
    } catch (e) {
        console.error("Failed to fetch channels for deletion logic", e);
        throw e;
    }

    for (const catId of categoryIds) {
        const result = { categoryId: catId, success: false, error: '', rolesDeleted: 0, roleErrors: [] as string[] };
        try {
            // Find children
            const children = allChannels.filter((c: any) => c.parent_id === catId);

            // この PC でカテゴリと一緒に作ったロール（data/created-roles.json に記録）
            const roleIds = new Set<string>();
            if (deleteRoles) {
                const existing = new Set(allRoles.map((r: any) => r.id));
                for (const rid of getCreatedRoles(catId)) if (existing.has(rid)) roleIds.add(rid);
            }

            // Delete children
            for (const child of children) {
                try {
                    await deleteChannel(child.id);
                } catch (e: any) {
                    console.error(`Failed to delete child ${child.id}:`, e);
                }
            }

            // Delete category
            await deleteChannel(catId);
            result.success = true;

            for (const rid of roleIds) {
                try {
                    await deleteRole(rid);
                    result.rolesDeleted++;
                } catch (e: any) {
                    const name = allRoles.find((r: any) => r.id === rid)?.name ?? rid;
                    let msg = describeError(e);
                    if (isMissingPerms(e)) msg = `Botのロールより上にあるため削除できません。 ${msg}`;
                    result.roleErrors.push(`${name}: ${msg}`);
                }
            }
            try { setCreatedRoles(catId, []); } catch { /* ignore */ }

        } catch (e: any) {
            let errorMsg = e.message;
            if (e.code === 50013 || e.rawError?.code === 50013 || e.code === 50001 || e.rawError?.code === 50001) {
                errorMsg = `Bot がこのカテゴリを閲覧・管理できません（このツール以外で作成された非公開カテゴリの可能性）。 ${errorMsg}`;
            }
            if (e.code === 60003 || e.rawError?.code === 60003) {
                errorMsg = `サーバー設定で「モデレーション操作に2段階認証を要求」が有効なため、Bot を作成したアカウントに2段階認証（2FA）を設定する必要があります。 ${errorMsg}`;
            }
            result.error = errorMsg;
        }
        results.push(result);
    }
    return results;
};

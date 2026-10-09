import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { Play, Search, Bug, Check, ArrowRight, Hash, Volume2, Lock, ExternalLink, Shield } from 'lucide-react';
import type { Preset } from '../types';
import * as api from '../api';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Field from '../ui/Field';
import PresetPicker from './PresetPicker';
import RolePlanner from './RolePlanner';
import { charNumber, clampRoleName, type CharacterDraft, type Tier } from './roleNames';
import Card from '../ui/Card';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import Avatar from '../ui/Avatar';
import Callout from '../ui/Callout';
import { useToast } from '../ui/toastContext';
import { useI18n, apiErrMsg } from '../i18n';
import styles from './Runner.module.css';

// 絵文字・作る位置・ON/OFF はこの PC に覚えておく（卓ごとに変えたいもの以外）
const ROLE_PREFS_KEY = 'takusaba.rolePrefs';
type RolePrefs = { enabled: boolean, emoji: string, anchorRoleId: string };
const loadRolePrefs = (): RolePrefs => {
    try {
        const v = JSON.parse(localStorage.getItem(ROLE_PREFS_KEY) ?? 'null');
        if (v && typeof v === 'object') {
            return {
                enabled: v.enabled === true,
                emoji: typeof v.emoji === 'string' ? v.emoji : '🍎',
                anchorRoleId: typeof v.anchorRoleId === 'string' ? v.anchorRoleId : ''
            };
        }
    } catch { /* ignore */ }
    return { enabled: false, emoji: '🍎', anchorRoleId: '' };
};
const saveRolePrefs = (p: RolePrefs) => {
    try { localStorage.setItem(ROLE_PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
};

const charactersFromPreset = (preset: Preset | undefined): CharacterDraft[] =>
    (preset?.roleCharacters ?? []).map(c => ({
        id: crypto.randomUUID(),
        name: c.name,
        channelKey: c.channelKey && preset?.channels.some(ch => ch.key === c.channelKey && ch.isHidden) ? c.channelKey : '',
        memberId: ''
    }));

export default function Runner({ guildId }: { guildId: string }) {
    const toast = useToast();
    const { t } = useI18n();
    const errMsg = (e: unknown) => apiErrMsg(t, e);
    const [presets, setPresets] = useState<Preset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string>('');
    const [categoryName, setCategoryName] = useState('');
    const [members, setMembers] = useState<api.Member[]>([]);
    const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
    const [hiddenAccess, setHiddenAccess] = useState<Record<string, Set<string>>>({});
    const [filterText, setFilterText] = useState('');
    const [debugLog, setDebugLog] = useState<string | null>(null);

    // Roles
    const initialPrefs = useMemo(loadRolePrefs, []);
    const [rolesEnabled, setRolesEnabled] = useState(initialPrefs.enabled);
    const [roleEmoji, setRoleEmoji] = useState(initialPrefs.emoji);
    const [anchorRoleId, setAnchorRoleId] = useState(initialPrefs.anchorRoleId);
    const [tiers, setTiers] = useState<Record<string, Tier>>({});
    const [characters, setCharacters] = useState<CharacterDraft[]>([]);
    const [guildRoles, setGuildRoles] = useState<api.GuildRoles | null>(null);
    const [rolesLoading, setRolesLoading] = useState(false);
    const [savingChars, setSavingChars] = useState(false);
    const [roleTouched, setRoleTouched] = useState(false);

    useEffect(() => {
        saveRolePrefs({ enabled: rolesEnabled, emoji: roleEmoji, anchorRoleId });
    }, [rolesEnabled, roleEmoji, anchorRoleId]);

    // UI State
    const [loading, setLoading] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [result, setResult] = useState<api.RunCreateResult | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadRoles = async () => {
        setRolesLoading(true);
        try {
            setGuildRoles(await api.getRoles());
        } catch (e) {
            toast(errMsg(e), 'error');
        } finally {
            setRolesLoading(false);
        }
    };

    useEffect(() => {
        if (rolesEnabled && !guildRoles && !rolesLoading) loadRoles();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rolesEnabled]);

    // 覚えていた「作る位置」のロールが消えていたら一番下に戻す
    useEffect(() => {
        if (guildRoles && anchorRoleId && !guildRoles.roles.some(r => r.id === anchorRoleId && r.selectable)) {
            setAnchorRoleId('');
        }
    }, [guildRoles, anchorRoleId]);

    const loadData = async () => {
        setLoading(true);
        // Independent: a members failure must not hide the preset list
        const [presetsRes, membersRes] = await Promise.allSettled([
            api.getPresets(),
            api.getMembers(1000) // Fetch up to 1000 members
        ]);
        if (presetsRes.status === 'fulfilled') setPresets(presetsRes.value);
        else toast(errMsg(presetsRes.reason), 'error');
        if (membersRes.status === 'fulfilled') setMembers(membersRes.value);
        else toast(errMsg(membersRes.reason), 'error');
        setLoading(false);
    };

    const handleRun = async () => {
        if (!selectedPresetId || !categoryName) return;
        setLoading(true);
        setResult(null);
        const access: Record<string, string[]> = {};
        for (const ch of hiddenChannels) {
            const ids = Array.from(hiddenAccess[ch.key] ?? []).filter(id => selectedMembers.has(id));
            if (ids.length > 0) access[ch.key] = ids;
        }
        try {
            const roles = roleItems ? { items: roleItems, anchorRoleId: anchorRoleId || null } : null;
            const res = await api.runCreate(selectedPresetId, categoryName, Array.from(selectedMembers), access, roles);
            setResult(res);
            setShowConfirm(false);
            if (roles) loadRoles();
        } catch (e) {
            toast(errMsg(e), 'error');
        } finally {
            setLoading(false);
        }
    };

    const toggleMember = (id: string) => {
        const newSet = new Set(selectedMembers);
        if (newSet.has(id)) {
            newSet.delete(id);
            const access: Record<string, Set<string>> = {};
            for (const [k, s] of Object.entries(hiddenAccess)) {
                const ns = new Set(s);
                ns.delete(id);
                access[k] = ns;
            }
            setHiddenAccess(access);
            setCharacters(characters.map(c => (c.memberId === id ? { ...c, memberId: '' } : c)));
        } else {
            newSet.add(id);
        }
        setSelectedMembers(newSet);
    };

    const toggleHiddenAccess = (channelKey: string, memberId: string) => {
        const cur = new Set(hiddenAccess[channelKey] ?? []);
        if (cur.has(memberId)) cur.delete(memberId);
        else cur.add(memberId);
        setHiddenAccess({ ...hiddenAccess, [channelKey]: cur });
    };

    const setHiddenAccessAll = (channelKey: string, on: boolean) => {
        setHiddenAccess({ ...hiddenAccess, [channelKey]: on ? new Set(selectedMembers) : new Set() });
    };

    // Validation
    const isPresetValid = !!selectedPresetId;
    const isCategoryValid = !!categoryName.trim();
    const isRolesValid = !rolesEnabled || !!roleEmoji.trim();
    const isValid = isPresetValid && isCategoryValid && isRolesValid;

    // Touched state to show errors only after interaction or attempt
    const [touched, setTouched] = useState({ preset: false, category: false });

    const handleConfirmClick = () => {
        setTouched({ preset: true, category: true });
        setRoleTouched(true);
        if (isValid) setShowConfirm(true);
    };

    const selectedPreset = presets.find(p => p.presetId === selectedPresetId);
    const hiddenChannels = selectedPreset?.channels.filter(c => c.isHidden) ?? [];
    const selectedMemberList = members.filter(m => selectedMembers.has(m.id));
    const memberName = (m: api.Member) => m.global_name || m.username;

    const filteredMembers = useMemo(() => members.filter(m =>
        m.username.toLowerCase().includes(filterText.toLowerCase()) ||
        (m.global_name && m.global_name.toLowerCase().includes(filterText.toLowerCase()))
    ), [members, filterText]);

    const avatarUrl = (m: api.Member) =>
        m.avatar ? `https://cdn.discordapp.com/avatars/${m.id}/${m.avatar}.png` : null;

    // ---- ロール名の組み立て：{絵文字}GM / {絵文字}PL / {絵文字}観戦 / {絵文字}⑴アダム ----
    const emoji = roleEmoji.trim();
    const namedChars = characters.filter(c => c.name.trim());
    const tierOf = (id: string): Tier => tiers[id] ?? 'pl';
    const roleItems: api.RoleItem[] | null = rolesEnabled && emoji ? [
        { kind: 'gm', name: clampRoleName(`${emoji}GM`), memberIds: selectedMemberList.filter(m => tierOf(m.id) === 'gm').map(m => m.id) },
        { kind: 'pl', name: clampRoleName(`${emoji}PL`), memberIds: selectedMemberList.filter(m => tierOf(m.id) === 'pl').map(m => m.id) },
        { kind: 'watch', name: clampRoleName(`${emoji}${t('run.roles.watchName')}`), memberIds: selectedMemberList.filter(m => tierOf(m.id) === 'watch').map(m => m.id) },
        ...namedChars.map((c, i): api.RoleItem => ({
            kind: 'character',
            name: clampRoleName(`${emoji}${charNumber(i)}${c.name.trim()}`),
            memberIds: c.memberId && selectedMembers.has(c.memberId) ? [c.memberId] : [],
            ...(c.channelKey && hiddenChannels.some(h => h.key === c.channelKey) ? { channelKey: c.channelKey } : {})
        }))
    ] : null;

    const emojiInUse = useMemo(() => {
        if (!rolesEnabled || !emoji || !guildRoles) return null;
        const hit = guildRoles.roles.find(r => r.name === `${emoji}GM` || r.name === `${emoji}PL`);
        return hit?.name ?? null;
    }, [rolesEnabled, emoji, guildRoles]);

    const anchorName = anchorRoleId ? guildRoles?.roles.find(r => r.id === anchorRoleId)?.name : null;

    const saveCharactersToPreset = async () => {
        if (!selectedPreset) return;
        setSavingChars(true);
        try {
            const updated: Preset = {
                ...selectedPreset,
                roleCharacters: namedChars.map(c => ({
                    name: c.name.trim(),
                    ...(c.channelKey ? { channelKey: c.channelKey } : {})
                }))
            };
            const res = await api.savePreset(updated);
            setPresets(presets.map(p => (p.presetId === updated.presetId ? res.preset : p)));
            toast(t('run.roles.charSaved'), 'success');
        } catch (e) {
            toast(errMsg(e), 'error');
        } finally {
            setSavingChars(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.inner}>
                <Card header={<><Play size={16} /> {t('run.title')}</>}>
                    <div className={styles.grid2}>
                        <Field
                            label={t('run.preset')}
                            required
                            error={touched.preset && !isPresetValid ? t('run.presetErr') : undefined}
                        >
                            <PresetPicker
                                presets={presets}
                                value={selectedPresetId}
                                onChange={id => {
                                    setSelectedPresetId(id);
                                    setHiddenAccess({});
                                    setCharacters(charactersFromPreset(presets.find(p => p.presetId === id)));
                                }}
                                onBlur={() => setTouched(prev => ({ ...prev, preset: true }))}
                                invalid={touched.preset && !isPresetValid}
                            />
                        </Field>

                        <Field
                            label={t('run.category')}
                            required
                            error={touched.category && !isCategoryValid ? t('run.categoryErr') : undefined}
                        >
                            <Input
                                value={categoryName}
                                onChange={e => setCategoryName(e.target.value)}
                                onBlur={() => setTouched({ ...touched, category: true })}
                                placeholder={t('run.categoryPh')}
                                invalid={touched.category && !isCategoryValid}
                            />
                        </Field>
                    </div>

                    {selectedPreset && (
                        <div className={styles.presetSummary}>
                            <div className={styles.summaryLabel}>{t('run.summary')}</div>
                            <div className={styles.chipRow}>
                                {selectedPreset.channels.map(ch => {
                                    const postCount = selectedPreset.posts.find(p => p.targetChannelKey === ch.key)?.items.length ?? 0;
                                    return (
                                        <span key={ch.key} className={styles.chip}>
                                            {ch.type === 'voice' ? <Volume2 size={13} /> : <Hash size={13} />}
                                            {ch.name}
                                            {ch.isHidden && <Lock size={11} />}
                                            {postCount > 0 && <span className={styles.chipPosts}>{t('run.posts', { n: postCount })}</span>}
                                        </span>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </Card>

                <Card
                    header={
                        <>
                            {t('run.members')}
                            <Badge tone="accent">{t('run.membersBadge', { n: selectedMembers.size })}</Badge>
                        </>
                    }
                    actions={
                        <IconButton
                            title={t('run.logTitle')}
                            onClick={async () => {
                                try {
                                    const data = await api.getDebugMembersRaw();
                                    setDebugLog(JSON.stringify(data, null, 2));
                                } catch (e) {
                                    setDebugLog('Error: ' + errMsg(e));
                                }
                            }}
                        >
                            <Bug size={16} />
                        </IconButton>
                    }
                >
                    <div className={styles.searchWrap}>
                        <span className={styles.searchIcon}><Search size={16} /></span>
                        <Input
                            className={styles.searchInput}
                            placeholder={t('run.searchPh')}
                            value={filterText}
                            onChange={e => setFilterText(e.target.value)}
                        />
                    </div>

                    <div className={`${styles.memberGrid} stagger`}>
                        {filteredMembers.map((m, i) => (
                            <div
                                key={m.id}
                                className={`${styles.memberCell} ${selectedMembers.has(m.id) ? styles.selected : ''}`}
                                style={{ '--i': i } as CSSProperties}
                                role="checkbox"
                                aria-checked={selectedMembers.has(m.id)}
                                onClick={() => toggleMember(m.id)}
                            >
                                <Avatar src={avatarUrl(m)} name={m.global_name || m.username} size={34} />
                                <div className={styles.memberInfo}>
                                    <div className={styles.memberName}>{m.global_name || m.username}</div>
                                    <div className={styles.memberUser}>@{m.username}</div>
                                </div>
                                {selectedMembers.has(m.id) && (
                                    <span className={styles.checkDot}><Check size={11} /></span>
                                )}
                            </div>
                        ))}
                    </div>

                    {selectedMembers.size === 0 && (
                        <div className={styles.warnRow}>
                            <Callout tone="warning">
                                {t('run.noMembersWarn')}
                            </Callout>
                        </div>
                    )}

                    {debugLog && (
                        <div className={styles.debugLog}>
                            <div className={styles.debugHead}>
                                <span>Debug Log</span>
                                <Button variant="ghost" size="sm" onClick={() => setDebugLog(null)}>{t('common.close')}</Button>
                            </div>
                            <pre className={styles.debugPre}>{debugLog}</pre>
                        </div>
                    )}
                </Card>

                {hiddenChannels.length > 0 && (
                    <Card header={<><Lock size={16} /> {t('run.hidden.title')}</>}>
                        <div className={styles.hiddenDesc}>{t('run.hidden.desc')}</div>
                        {selectedMembers.size === 0 ? (
                            <Callout tone="info">{t('run.hidden.noMembers')}</Callout>
                        ) : (
                            <div className={styles.hiddenList}>
                                {hiddenChannels.map(ch => {
                                    const allowed = hiddenAccess[ch.key] ?? new Set<string>();
                                    return (
                                        <div key={ch.key} className={styles.hiddenRow}>
                                            <div className={styles.hiddenHead}>
                                                <span className={styles.hiddenName}>
                                                    <Lock size={13} /> {ch.name}
                                                </span>
                                                <span className={styles.hiddenCount}>
                                                    {t('run.hidden.count', { n: allowed.size, m: selectedMembers.size })}
                                                    {allowed.size === 0 && (
                                                        <span className={styles.hiddenNobody}> — {t('run.hidden.nobody')}</span>
                                                    )}
                                                </span>
                                                <span className={styles.hiddenActions}>
                                                    <Button variant="ghost" size="sm" onClick={() => setHiddenAccessAll(ch.key, true)}>
                                                        {t('run.hidden.all')}
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => setHiddenAccessAll(ch.key, false)}>
                                                        {t('run.hidden.none')}
                                                    </Button>
                                                </span>
                                            </div>
                                            <div className={styles.hiddenChips}>
                                                {selectedMemberList.map(m => {
                                                    const on = allowed.has(m.id);
                                                    return (
                                                        <span
                                                            key={m.id}
                                                            role="checkbox"
                                                            aria-checked={on}
                                                            className={`${styles.hChip} ${on ? styles.hChipOn : ''}`}
                                                            onClick={() => toggleHiddenAccess(ch.key, m.id)}
                                                        >
                                                            <Avatar src={avatarUrl(m)} name={memberName(m)} size={20} />
                                                            <span className={styles.hChipName}>{memberName(m)}</span>
                                                            {on && <Check size={12} />}
                                                        </span>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                )}

                <RolePlanner
                    enabled={rolesEnabled}
                    onToggle={setRolesEnabled}
                    emoji={roleEmoji}
                    onEmoji={setRoleEmoji}
                    members={selectedMemberList}
                    tiers={tiers}
                    onTier={(id, tier) => setTiers({ ...tiers, [id]: tier })}
                    characters={characters}
                    onCharacters={setCharacters}
                    onSaveCharacters={selectedPreset ? saveCharactersToPreset : undefined}
                    savingCharacters={savingChars}
                    hiddenChannels={hiddenChannels}
                    guildRoles={guildRoles}
                    rolesLoading={rolesLoading}
                    onReloadRoles={loadRoles}
                    anchorRoleId={anchorRoleId}
                    onAnchor={setAnchorRoleId}
                    preview={(roleItems ?? []).map(r => ({ name: r.name, locked: !!r.channelKey }))}
                    emojiInUse={emojiInUse}
                    showErrors={roleTouched}
                />

                <div className={styles.runRow}>
                    <Button size="lg" icon={<ArrowRight size={18} />} onClick={handleConfirmClick} loading={loading}>
                        {t('run.check')}
                    </Button>
                </div>
            </div>

            {/* Confirm Modal */}
            {showConfirm && selectedPreset && (
                <Modal
                    title={t('run.confirm.title')}
                    description={t('run.confirm.desc')}
                    width={560}
                    onClose={() => setShowConfirm(false)}
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => setShowConfirm(false)}>{t('common.cancel')}</Button>
                            <Button onClick={handleRun} loading={loading}>{t('run.confirm.go')}</Button>
                        </>
                    }
                >
                    <div className={styles.defList}>
                        <div className={styles.defRow}>
                            <span className={styles.defLabel}>{t('run.confirm.name')}</span>
                            <span className={styles.defValue}>{categoryName}</span>
                        </div>
                        <div className={styles.defRow}>
                            <span className={styles.defLabel}>{t('run.confirm.preset')}</span>
                            <span className={styles.defValue}>{selectedPreset.presetName}</span>
                        </div>
                        <div className={styles.defRow}>
                            <span className={styles.defLabel}>{t('run.confirm.channels')}</span>
                            <span className={styles.defValue}>{t('run.confirm.channelsVal', { n: selectedPreset.channels.length })}</span>
                        </div>
                        <div className={styles.defRow}>
                            <span className={styles.defLabel}>{t('run.confirm.members')}</span>
                            <span className={styles.defValue}>{t('run.confirm.membersVal', { n: selectedMembers.size })}</span>
                        </div>
                        {roleItems && (
                            <>
                                <div className={styles.defRow}>
                                    <span className={styles.defLabel}><Shield size={12} /> {t('run.confirm.roles')}</span>
                                    <span className={styles.defValue}>
                                        {roleItems.map(r => {
                                            const who = selectedMemberList.filter(m => r.memberIds.includes(m.id)).map(memberName);
                                            return <div key={r.name}>{r.name}{who.length > 0 ? `（${who.join(', ')}）` : ''}</div>;
                                        })}
                                    </span>
                                </div>
                                <div className={styles.defRow}>
                                    <span className={styles.defLabel}>{t('run.confirm.rolePos')}</span>
                                    <span className={styles.defValue}>
                                        {anchorName ? t('run.roles.positionBelow', { name: anchorName }) : t('run.roles.positionBottom')}
                                    </span>
                                </div>
                            </>
                        )}
                        {hiddenChannels.map(ch => {
                            const allowed = hiddenAccess[ch.key] ?? new Set<string>();
                            const names = [
                                ...(roleItems ?? []).filter(r => r.channelKey === ch.key).map(r => r.name),
                                ...selectedMemberList.filter(m => allowed.has(m.id)).map(memberName)
                            ];
                            return (
                                <div key={ch.key} className={styles.defRow}>
                                    <span className={styles.defLabel}><Lock size={12} /> {ch.name}</span>
                                    <span className={`${styles.defValue} ${names.length === 0 ? styles.defMuted : ''}`}>
                                        {names.length > 0 ? names.join(', ') : t('run.hidden.nobody')}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </Modal>
            )}

            {/* Result Modal */}
            {result && (
                <Modal
                    title={t('run.result.title')}
                    description={t('run.result.desc')}
                    width={660}
                >
                    <div className={styles.resultCatId}>
                        <a
                            className={styles.openLink}
                            href={`https://discord.com/channels/${guildId}/${result.category.id}`}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <ExternalLink size={14} /> {t('run.result.open')}
                        </a>
                        <code className={styles.catId}>{result.category.id}</code>
                    </div>

                    {result.errors.length > 0 && (
                        <>
                            <div className={styles.sectionLabel}>{t('run.result.errors')}</div>
                            <Callout tone="danger">
                                <Textarea
                                    readOnly
                                    value={result.errors.join('\n')}
                                    rows={6}
                                />
                            </Callout>
                        </>
                    )}

                    {result.roles && result.roles.length > 0 && (
                        <>
                            <div className={styles.sectionLabel}>{t('run.result.roles')}</div>
                            <div className={styles.tableWrap}>
                                <table className={styles.table}>
                                    <thead>
                                        <tr>
                                            <th>{t('run.th.role')}</th>
                                            <th>{t('run.th.roleMembers')}</th>
                                            <th>{t('common.status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.roles.map((r, i) => (
                                            <tr key={i}>
                                                <td>{r.name}</td>
                                                <td>{t('run.result.roleMembers', { n: r.members })}</td>
                                                <td>
                                                    {r.success
                                                        ? <Badge tone="success">{t('common.success')}</Badge>
                                                        : <Badge tone="danger">{t('common.failure')}</Badge>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    <div className={styles.sectionLabel}>{t('run.result.channels')}</div>
                    <div className={styles.tableWrap}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{t('run.th.name')}</th>
                                    <th>{t('common.status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.channels.map((c, i) => (
                                    <tr key={i}>
                                        <td>{c.name}</td>
                                        <td>
                                            {c.success
                                                ? <Badge tone="success">{t('common.success')}</Badge>
                                                : <Badge tone="danger">{t('common.failure')}</Badge>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className={styles.resultFooter}>
                        <Button onClick={() => setResult(null)}>{t('common.close')}</Button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

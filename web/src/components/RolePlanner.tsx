import { Shield, Plus, X, RefreshCw, Save, Lock, AlertTriangle } from 'lucide-react';
import type { PresetChannel } from '../types';
import type * as api from '../api';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Card from '../ui/Card';
import Avatar from '../ui/Avatar';
import Callout from '../ui/Callout';
import { useI18n } from '../i18n';
import { EMOJI_CHOICES, charNumber, matchChannelForCharacter, type CharacterDraft, type Tier } from './roleNames';
import styles from './RolePlanner.module.css';

type Props = {
    enabled: boolean;
    onToggle: (on: boolean) => void;
    emoji: string;
    onEmoji: (e: string) => void;
    members: api.Member[];          // 選択中の参加者
    tiers: Record<string, Tier>;
    onTier: (memberId: string, tier: Tier) => void;
    characters: CharacterDraft[];
    onCharacters: (c: CharacterDraft[]) => void;
    onSaveCharacters?: () => void;
    savingCharacters?: boolean;
    hiddenChannels: PresetChannel[];
    guildRoles: api.GuildRoles | null;
    rolesLoading: boolean;
    onReloadRoles: () => void;
    anchorRoleId: string;
    onAnchor: (id: string) => void;
    preview: { name: string, locked?: boolean }[];
    emojiInUse: string | null;
    showErrors: boolean;
};

const TIERS: Tier[] = ['gm', 'pl', 'watch'];

export default function RolePlanner(p: Props) {
    const { t } = useI18n();
    const memberName = (m: api.Member) => m.global_name || m.username;
    const avatarUrl = (m: api.Member) =>
        m.avatar ? `https://cdn.discordapp.com/avatars/${m.id}/${m.avatar}.png` : null;
    const tierLabel = (tier: Tier) => t(tier === 'gm' ? 'run.roles.gm' : tier === 'pl' ? 'run.roles.pl' : 'run.roles.watch');

    const updateChar = (id: string, patch: Partial<CharacterDraft>) =>
        p.onCharacters(p.characters.map(c => (c.id === id ? { ...c, ...patch } : c)));
    // 名前を変えたとき、名前がリンクしている秘匿チャンネルを自動で選ぶ。
    // 自分で別のチャンネルを選んでいた場合はそのままにする。
    const renameChar = (c: CharacterDraft, name: string) => {
        const before = matchChannelForCharacter(c.name, p.hiddenChannels);
        const auto = c.channelKey === '' || c.channelKey === before;
        updateChar(c.id, auto ? { name, channelKey: matchChannelForCharacter(name, p.hiddenChannels) } : { name });
    };
    const addChar = () =>
        p.onCharacters([...p.characters, { id: crypto.randomUUID(), name: '', channelKey: '', memberId: '' }]);
    const removeChar = (id: string) => p.onCharacters(p.characters.filter(c => c.id !== id));

    // 空欄の行には番号を振らない（実際に作られる番号と表示を揃える）
    let n = 0;
    const numbers = p.characters.map(c => (c.name.trim() ? charNumber(n++) : '—'));

    const isPreset = EMOJI_CHOICES.includes(p.emoji);
    const emojiMissing = p.showErrors && !p.emoji.trim();

    return (
        <Card
            header={<><Shield size={16} /> {t('run.roles.title')}</>}
            actions={
                <button
                    type="button"
                    role="switch"
                    aria-checked={p.enabled}
                    className={`${styles.toggle} ${p.enabled ? styles.on : ''}`}
                    onClick={() => p.onToggle(!p.enabled)}
                >
                    <span className={styles.switchDot} />
                    {t('run.roles.toggle')}
                </button>
            }
        >
            <div className={styles.desc}>{t('run.roles.desc')}</div>

            {p.enabled && (
                <div className={styles.sections}>
                    {/* 絵文字 */}
                    <section className={styles.section}>
                        <div className={styles.label}>{t('run.roles.emoji')}<span className={styles.req}>*</span></div>
                        <div className={styles.emojiRow}>
                            <div className={styles.emojiGrid} role="radiogroup" aria-label={t('run.roles.emoji')}>
                                {EMOJI_CHOICES.map(e => (
                                    <button
                                        key={e}
                                        type="button"
                                        role="radio"
                                        aria-checked={p.emoji === e}
                                        className={`${styles.emojiBtn} ${p.emoji === e ? styles.emojiOn : ''}`}
                                        onClick={() => p.onEmoji(e)}
                                    >
                                        {e}
                                    </button>
                                ))}
                            </div>
                            <Input
                                className={styles.emojiCustom}
                                value={isPreset ? '' : p.emoji}
                                onChange={e => p.onEmoji(e.target.value.trim())}
                                placeholder={t('run.roles.emojiCustomPh')}
                                maxLength={16}
                                invalid={emojiMissing}
                                aria-label={t('run.roles.emojiCustomPh')}
                            />
                        </div>
                        {emojiMissing
                            ? <div className={styles.error}>{t('run.roles.emojiErr')}</div>
                            : <div className={styles.hint}>{t('run.roles.emojiHint')}</div>}
                        {p.emojiInUse && (
                            <div className={styles.warn}>
                                <AlertTriangle size={13} /> {t('run.roles.emojiInUse', { name: p.emojiInUse })}
                            </div>
                        )}
                    </section>

                    {/* 参加者の立場 */}
                    <section className={styles.section}>
                        <div className={styles.label}>{t('run.roles.tiers')}</div>
                        <div className={styles.hint}>{t('run.roles.tiersHint')}</div>
                        {p.members.length === 0 ? (
                            <Callout tone="info">{t('run.roles.tiersNoMembers')}</Callout>
                        ) : (
                            <div className={styles.tierList}>
                                {p.members.map(m => {
                                    const cur = p.tiers[m.id] ?? 'pl';
                                    return (
                                        <div key={m.id} className={styles.tierRow}>
                                            <span className={styles.tierWho}>
                                                <Avatar src={avatarUrl(m)} name={memberName(m)} size={22} />
                                                <span className={styles.tierName}>{memberName(m)}</span>
                                            </span>
                                            <span className={styles.seg} role="radiogroup" aria-label={memberName(m)}>
                                                {TIERS.map(tier => (
                                                    <button
                                                        key={tier}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={cur === tier}
                                                        className={`${styles.segBtn} ${cur === tier ? styles[`seg_${tier}`] : ''}`}
                                                        onClick={() => p.onTier(m.id, tier)}
                                                    >
                                                        {tierLabel(tier)}
                                                    </button>
                                                ))}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* キャラクター */}
                    <section className={styles.section}>
                        <div className={styles.labelRow}>
                            <div className={styles.label}>{t('run.roles.chars')}</div>
                            {p.onSaveCharacters && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<Save size={14} />}
                                    loading={p.savingCharacters}
                                    onClick={p.onSaveCharacters}
                                >
                                    {t('run.roles.charSave')}
                                </Button>
                            )}
                        </div>
                        <div className={styles.hint}>{t('run.roles.charsHint')}</div>
                        {p.characters.length > 0 && (
                            <div className={styles.charList}>
                                <div className={`${styles.charRow} ${styles.charHead}`}>
                                    <span />
                                    <span>{t('run.roles.charNamePh')}</span>
                                    {p.hiddenChannels.length > 0 && <span>{t('run.roles.charChannel')}</span>}
                                    <span>{t('run.roles.charMember')}</span>
                                    <span />
                                </div>
                                {p.characters.map((c, i) => (
                                    <div key={c.id} className={`${styles.charRow} ${p.hiddenChannels.length === 0 ? styles.noChannel : ''}`}>
                                        <span className={styles.charNo}>{numbers[i]}</span>
                                        <Input
                                            value={c.name}
                                            onChange={e => renameChar(c, e.target.value)}
                                            placeholder={t('run.roles.charNamePh')}
                                            maxLength={80}
                                            aria-label={t('run.roles.charNamePh')}
                                        />
                                        {p.hiddenChannels.length > 0 && (
                                            <Select
                                                value={c.channelKey}
                                                onChange={e => updateChar(c.id, { channelKey: e.target.value })}
                                                aria-label={t('run.roles.charChannel')}
                                            >
                                                <option value="">{t('run.roles.charChannelNone')}</option>
                                                {p.hiddenChannels.map(ch => (
                                                    <option key={ch.key} value={ch.key}>🔒 {ch.name}</option>
                                                ))}
                                            </Select>
                                        )}
                                        <Select
                                            value={p.members.some(m => m.id === c.memberId) ? c.memberId : ''}
                                            onChange={e => updateChar(c.id, { memberId: e.target.value })}
                                            aria-label={t('run.roles.charMember')}
                                        >
                                            <option value="">{t('run.roles.charMemberNone')}</option>
                                            {p.members.map(m => (
                                                <option key={m.id} value={m.id}>{memberName(m)}</option>
                                            ))}
                                        </Select>
                                        <IconButton title={t('run.roles.charRemove')} onClick={() => removeChar(c.id)}>
                                            <X size={15} />
                                        </IconButton>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div>
                            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addChar}>
                                {t('run.roles.charAdd')}
                            </Button>
                        </div>
                    </section>

                    {/* 作る位置 */}
                    <section className={styles.section}>
                        <div className={styles.labelRow}>
                            <div className={styles.label}>{t('run.roles.position')}</div>
                            <IconButton title={t('run.roles.reload')} onClick={p.onReloadRoles}>
                                <RefreshCw size={14} className={p.rolesLoading ? styles.spin : ''} />
                            </IconButton>
                        </div>
                        <Select value={p.anchorRoleId} onChange={e => p.onAnchor(e.target.value)} aria-label={t('run.roles.position')}>
                            <option value="">{t('run.roles.positionBottom')}</option>
                            {(p.guildRoles?.roles ?? []).map(r => (
                                <option key={r.id} value={r.id} disabled={!r.selectable}>
                                    {t('run.roles.positionBelow', { name: r.name })}
                                    {r.isBot ? ` ${t('run.roles.positionBot')}` : ''}
                                    {!r.selectable ? ` ${t('run.roles.positionLocked')}` : ''}
                                </option>
                            ))}
                        </Select>
                        <div className={styles.hint}>{t('run.roles.positionHint')}</div>
                    </section>

                    {/* プレビュー */}
                    <section className={styles.section}>
                        <div className={styles.label}>{t('run.roles.preview')}</div>
                        <div className={styles.previewList}>
                            {p.preview.map((r, i) => (
                                <span key={i} className={styles.previewChip}>
                                    {r.name}
                                    {r.locked && <Lock size={11} />}
                                </span>
                            ))}
                        </div>
                    </section>
                </div>
            )}
        </Card>
    );
}

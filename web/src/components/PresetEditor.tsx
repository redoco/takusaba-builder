import { useRef, useState, useEffect, type CSSProperties } from 'react';
import {
    Plus, Copy, Trash2, GripVertical, Hash, Volume2, Lock, Unlock,
    X, Type, ImagePlus, Save, LayoutList, MousePointerClick
} from 'lucide-react';
import type { Preset, PresetPostItem, AccessLevel } from '../types';
import { channelAccess, ACCESS_LEVELS } from './channelAccess';
import * as api from '../api';
import * as editor from './presetEditorState';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import Input from '../ui/Input';
import Textarea from '../ui/Textarea';
import Select from '../ui/Select';
import Field from '../ui/Field';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import Modal from '../ui/Modal';
import { useToast } from '../ui/toastContext';
import { useUnsaved } from '../ui/unsavedContext';
import { useI18n, apiErrMsg } from '../i18n';
import styles from './PresetEditor.module.css';

function AssetThumb({ assetId, onOpen }: { assetId: string; onOpen: (src: string) => void }) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    const src = `/assets/${assetId}`;
    return (
        <img
            src={src}
            className={styles.thumb}
            alt=""
            onError={() => setFailed(true)}
            onClick={e => { e.stopPropagation(); onOpen(src); }}
        />
    );
}

export default function PresetEditor() {
    const toast = useToast();
    const { t } = useI18n();
    const errMsg = (e: unknown) => apiErrMsg(t, e);
    const { setDirty } = useUnsaved();
    const [presets, setPresets] = useState<Preset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
    const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
    const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
    const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null);
    const [loading, setLoading] = useState(false);
    const [confirmDeletePreset, setConfirmDeletePreset] = useState<string | null>(null);
    const [confirmDeleteChannel, setConfirmDeleteChannel] = useState<number | null>(null);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

    const isDirty = editingPreset !== null && JSON.stringify(editingPreset) !== savedSnapshot;

    useEffect(() => {
        setDirty(isDirty);
        return () => setDirty(false);
    }, [isDirty, setDirty]);

    useEffect(() => {
        loadPresets();
    }, []);

    const loadPresets = async () => {
        setLoading(true);
        try {
            const data = await api.getPresets();
            setPresets(data);
        } catch (e) {
            toast(errMsg(e), 'error');
        } finally {
            setLoading(false);
        }
    };

    // Runs action immediately, or defers it behind the discard-confirm dialog when dirty.
    const guardDirty = (action: () => void) => {
        if (isDirty) setPendingDiscard(() => action);
        else action();
    };

    const openPreset = (preset: Preset) => {
        // Deep copy to disconnect from list state while editing
        const copy: Preset = JSON.parse(JSON.stringify(preset));
        setEditingPreset(copy);
        setSavedSnapshot(JSON.stringify(copy));
        setSelectedPresetId(preset.presetId);
    };

    const handleCreate = () => guardDirty(() => {
        const newPreset: Preset = {
            presetId: crypto.randomUUID(),
            presetName: t('preset.untitled'),
            channels: [],
            posts: []
        };
        setEditingPreset(newPreset);
        setSavedSnapshot(null);
        setSelectedPresetId(newPreset.presetId);
    });

    const handleSelect = (id: string) => guardDirty(() => {
        const preset = presets.find(p => p.presetId === id);
        if (preset) openPreset(preset);
    });

    const handleSave = async () => {
        if (!editingPreset) return;
        if (editingPreset.channels.length === 0) {
            toast(t('preset.needChannel'), 'error');
            return;
        }
        const saved = editingPreset;
        setLoading(true);
        try {
            await api.savePreset(saved);
            await loadPresets();
            setSavedSnapshot(JSON.stringify(saved));
            toast(t('preset.saved'), 'success');
        } catch (e) {
            toast(errMsg(e), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleDuplicate = (sourcePreset: Preset, e: React.MouseEvent) => {
        e.stopPropagation();
        guardDirty(async () => {
            const duplicatedPreset = editor.duplicatePreset(sourcePreset, t('preset.copySuffix'));
            setLoading(true);
            try {
                await api.savePreset(duplicatedPreset);
                await loadPresets();
                setSelectedPresetId(duplicatedPreset.presetId);
                setEditingPreset(duplicatedPreset);
                setSavedSnapshot(JSON.stringify(duplicatedPreset));
            } catch (err) {
                toast(errMsg(err), 'error');
            } finally {
                setLoading(false);
            }
        });
    };

    const requestDeletePreset = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        guardDirty(() => setConfirmDeletePreset(id));
    };

    const handleDeleteById = async (id: string) => {
        setConfirmDeletePreset(null);
        setLoading(true);
        try {
            await api.deletePreset(id);
            if (selectedPresetId === id) {
                setEditingPreset(null);
                setSavedSnapshot(null);
                setSelectedPresetId(null);
            }
            await loadPresets();
        } catch (err) {
            toast(errMsg(err), 'error');
        } finally {
            setLoading(false);
        }
    };

    // Drag and Drop Logic for Channels
    const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

    const moveChannel = (fromIdx: number, toIdx: number) => {
        setEditingPreset(p => p && editor.moveChannel(p, fromIdx, toIdx));
    };

    // Drag and Drop Logic for Posts
    const [draggedPostItem, setDraggedPostItem] = useState<{ channelKey: string, idx: number } | null>(null);

    const movePostItem = (channelKey: string, fromIdx: number, toIdx: number) => {
        setEditingPreset(p => p && editor.movePostItem(p, channelKey, fromIdx, toIdx));
    };

    // Post Items Utility
    const addPostItem = (channelKey: string, type: 'text' | 'file') => {
        setEditingPreset(p => p && editor.addPostItem(p, channelKey, type));
    };

    const updatePostItem = (channelKey: string, index: number, updates: Partial<PresetPostItem>) => {
        setEditingPreset(p => p && editor.updatePostItem(p, channelKey, index, updates));
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, channelKey: string, index: number) => {
        if (!e.target.files || !e.target.files[0]) return;
        const file = e.target.files[0];
        try {
            const uploadedAsset = await api.uploadAsset(file);
            updatePostItem(channelKey, index, {
                assetId: uploadedAsset.assetId,
                filename: file.name
            });
        } catch (err) {
            toast(t('preset.uploadFail', { msg: errMsg(err) }), 'error');
        }
    };

    const removePostItem = (channelKey: string, index: number) => {
        setEditingPreset(p => p && editor.removePostItem(p, channelKey, index));
    };

    const deleteChannel = (idx: number) => {
        setEditingPreset(p => p && editor.removeChannel(p, idx));
        setConfirmDeleteChannel(null);
    };

    return (
        <div className={styles.layout}>
            {/* Sidebar: Preset List */}
            <div className={styles.listPane}>
                <Button icon={<Plus size={16} />} onClick={handleCreate}>{t('preset.new')}</Button>
                <div className={styles.listHeading}>{t('preset.list')}</div>
                {presets.length === 0 && !editingPreset ? (
                    <EmptyState
                        icon={<LayoutList size={28} />}
                        title={t('preset.empty.title')}
                        description={t('preset.empty.desc')}
                    />
                ) : (
                    <div className={`${styles.list} stagger`}>
                        {editingPreset && !presets.some(p => p.presetId === editingPreset.presetId) && (
                            <div className={`${styles.presetRow} ${styles.selected}`}>
                                <span className={styles.presetName}>{editingPreset.presetName}</span>
                                <Badge tone="warning">{t('unsaved.listBadge')}</Badge>
                            </div>
                        )}
                        {presets.map((p, i) => (
                            <div
                                key={p.presetId}
                                className={`${styles.presetRow} ${selectedPresetId === p.presetId ? styles.selected : ''}`}
                                style={{ '--i': i } as CSSProperties}
                                onClick={() => handleSelect(p.presetId)}
                            >
                                <span className={styles.presetName}>{p.presetName}</span>
                                <div className={styles.rowActions}>
                                    <IconButton size="sm" title={t('preset.duplicate')} onClick={(e) => handleDuplicate(p, e)}>
                                        <Copy size={13} />
                                    </IconButton>
                                    <IconButton size="sm" tone="danger" title={t('preset.delete')} onClick={(e) => requestDeletePreset(p.presetId, e)}>
                                        <Trash2 size={13} />
                                    </IconButton>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Main: Editor */}
            <div className={styles.editorPane}>
                {editingPreset ? (
                    <>
                        <div className={styles.editorScroll}>
                            <div className={styles.editorInner}>
                                <Field label={t('preset.name')}>
                                    <Input
                                        className={styles.nameInput}
                                        value={editingPreset.presetName}
                                        maxLength={30}
                                        onChange={e => setEditingPreset({ ...editingPreset, presetName: e.target.value })}
                                        placeholder={t('preset.namePh')}
                                    />
                                </Field>

                                {/* Channels Section */}
                                <Card
                                    className={styles.channelsCard}
                                    header={t('preset.channels')}
                                    actions={
                                        <>
                                            <Button variant="secondary" size="sm" icon={<Hash size={16} />} onClick={() => setEditingPreset(p => p && editor.addChannel(p, 'text', t('preset.newText')))}>{t('preset.addText')}</Button>
                                            <Button variant="secondary" size="sm" icon={<Volume2 size={16} />} onClick={() => setEditingPreset(p => p && editor.addChannel(p, 'voice', t('preset.newVoice')))}>{t('preset.addVoice')}</Button>
                                        </>
                                    }
                                >
                                    <div className={styles.cardHint}>
                                        {t('preset.channels.hint')}
                                    </div>
                                    {editingPreset.channels.length === 0 ? (
                                        <div className={styles.emptyChannels}>{t('preset.channels.empty')}</div>
                                    ) : (
                                        <div className={styles.channelList}>
                                            {editingPreset.channels.map((ch, idx) => (
                                                <div
                                                    key={ch.key}
                                                    className={`${styles.channelRow} ${draggedIdx === idx ? styles.dragging : ''}`}
                                                    draggable
                                                    onDragStart={() => setDraggedIdx(idx)}
                                                    onDragEnd={() => setDraggedIdx(null)}
                                                    onDragOver={e => {
                                                        e.preventDefault();
                                                        if (draggedIdx !== null && draggedIdx !== idx) {
                                                            moveChannel(draggedIdx, idx);
                                                            setDraggedIdx(idx);
                                                        }
                                                    }}
                                                >
                                                    <span className={styles.grip}><GripVertical size={16} /></span>
                                                    <div className={styles.typeSelect}>
                                                        <Select
                                                            value={ch.type || 'text'}
                                                            onChange={e => setEditingPreset(p => p && editor.updateChannel(p, idx, { type: e.target.value as 'text' | 'voice' }))}
                                                        >
                                                            <option value="text">{t('preset.addText')}</option>
                                                            <option value="voice">{t('preset.addVoice')}</option>
                                                        </Select>
                                                    </div>
                                                    <Input
                                                        value={ch.name}
                                                        onChange={e => setEditingPreset(p => p && editor.updateChannel(p, idx, { name: e.target.value }))}
                                                    />
                                                    <button
                                                        className={`${styles.hiddenToggle} ${ch.isHidden ? styles.hidden : ''}`}
                                                        onClick={() => setEditingPreset(p => p && editor.updateChannel(p, idx, { isHidden: !ch.isHidden }))}
                                                        title={ch.isHidden ? t('preset.hiddenTitleOn') : t('preset.hiddenTitleOff')}
                                                    >
                                                        {ch.isHidden ? <Lock size={13} /> : <Unlock size={13} />}
                                                        {ch.isHidden ? t('preset.hidden') : t('preset.public')}
                                                    </button>
                                                    {ch.type === 'voice' && <span className={styles.noPost}>{t('preset.noPost')}</span>}
                                                    <IconButton tone="danger" title={t('preset.delete')} onClick={() => setConfirmDeleteChannel(idx)}>
                                                        <Trash2 size={16} />
                                                    </IconButton>
                                                    {(() => {
                                                        const acc = channelAccess(ch);
                                                        const voice = ch.type === 'voice';
                                                        const label = (lv: AccessLevel) => t(`preset.access.${voice ? 'voice' : 'text'}.${lv}` as 'preset.access.text.write');
                                                        const setLevel = (who: 'pl' | 'watch', lv: AccessLevel) =>
                                                            setEditingPreset(p => p && editor.updateChannel(p, idx, { access: { ...acc, [who]: lv } }));
                                                        return (
                                                            <div className={styles.accessLine}>
                                                                <span className={styles.accessItem}>
                                                                    <span className={styles.accessWho}>GM</span>
                                                                    <span className={styles.accessFixed}>{label('write')}</span>
                                                                </span>
                                                                {(['pl', 'watch'] as const).map(who => (
                                                                    <span key={who} className={styles.accessItem}>
                                                                        <span className={styles.accessWho}>{t(who === 'pl' ? 'preset.access.pl' : 'preset.access.watch')}</span>
                                                                        <Select
                                                                            className={`${styles.accessSelect} ${styles[`lv_${acc[who]}`]}`}
                                                                            value={acc[who]}
                                                                            onChange={e => setLevel(who, e.target.value as AccessLevel)}
                                                                            aria-label={t(who === 'pl' ? 'preset.access.pl' : 'preset.access.watch')}
                                                                        >
                                                                            {ACCESS_LEVELS.map(lv => <option key={lv} value={lv}>{label(lv)}</option>)}
                                                                        </Select>
                                                                    </span>
                                                                ))}
                                                                <span className={styles.accessNote}>
                                                                    {ch.isHidden ? t('preset.access.charHidden') : t('preset.access.charSame')}
                                                                </span>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </Card>

                                {/* Posts Section */}
                                {editingPreset.channels.filter(ch => ch.type !== 'voice').map(ch => {
                                    const postDef = editingPreset.posts.find(p => p.targetChannelKey === ch.key);
                                    const items = postDef ? postDef.items : [];

                                    return (
                                        <Card
                                            key={ch.key}
                                            header={<><Hash size={16} /> {t('preset.postTo', { name: ch.name })}</>}
                                        >
                                            <div className={styles.cardHint}>
                                                {t('preset.post.hint')}
                                            </div>
                                            <div className={styles.postList}>
                                                {items.map((item, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`${styles.postItem} ${draggedPostItem?.channelKey === ch.key && draggedPostItem.idx === idx ? styles.dragging : ''}`}
                                                        draggable
                                                        onDragStart={() => setDraggedPostItem({ channelKey: ch.key, idx })}
                                                        onDragEnd={() => setDraggedPostItem(null)}
                                                        onDragOver={e => {
                                                            e.preventDefault();
                                                            if (
                                                                draggedPostItem &&
                                                                draggedPostItem.channelKey === ch.key &&
                                                                draggedPostItem.idx !== idx
                                                            ) {
                                                                movePostItem(ch.key, draggedPostItem.idx, idx);
                                                                setDraggedPostItem({ channelKey: ch.key, idx });
                                                            }
                                                        }}
                                                    >
                                                        <span className={styles.grip}><GripVertical size={16} /></span>
                                                        <div className={styles.postBody}>
                                                            {item.type === 'text' ? (
                                                                <>
                                                                    <div className={styles.postLabel}>{t('preset.post.text')}</div>
                                                                    <Textarea
                                                                        rows={3}
                                                                        value={item.content || ''}
                                                                        onChange={e => updatePostItem(ch.key, idx, { content: e.target.value })}
                                                                        placeholder={t('preset.post.textPh')}
                                                                    />
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <div className={styles.postLabel}>{t('preset.post.file')}</div>
                                                                    <div className={styles.fileRow}>
                                                                        {item.assetId && <AssetThumb assetId={item.assetId} onOpen={setPreviewSrc} />}
                                                                        <input
                                                                            type="file"
                                                                            hidden
                                                                            ref={el => { fileInputs.current[`${ch.key}-${idx}`] = el; }}
                                                                            onChange={e => handleFileUpload(e, ch.key, idx)}
                                                                        />
                                                                        <Button
                                                                            variant="secondary"
                                                                            size="sm"
                                                                            icon={<ImagePlus size={16} />}
                                                                            onClick={() => fileInputs.current[`${ch.key}-${idx}`]?.click()}
                                                                        >
                                                                            {t('preset.post.pick')}
                                                                        </Button>
                                                                        {item.filename && <Badge tone="success">{item.filename}</Badge>}
                                                                    </div>
                                                                    <div className={styles.postLabel}>{t('preset.post.caption')}</div>
                                                                    <Input
                                                                        value={item.caption || ''}
                                                                        onChange={e => updatePostItem(ch.key, idx, { caption: e.target.value })}
                                                                        placeholder={t('preset.post.captionPh')}
                                                                    />
                                                                </>
                                                            )}
                                                        </div>
                                                        <IconButton size="sm" tone="danger" title={t('preset.delete')} onClick={() => removePostItem(ch.key, idx)}>
                                                            <X size={16} />
                                                        </IconButton>
                                                    </div>
                                                ))}

                                                <div className={styles.postAddRow}>
                                                    <Button variant="ghost" size="sm" icon={<Type size={16} />} onClick={() => addPostItem(ch.key, 'text')}>{t('preset.post.addText')}</Button>
                                                    <Button variant="ghost" size="sm" icon={<ImagePlus size={16} />} onClick={() => addPostItem(ch.key, 'file')}>{t('preset.post.addImage')}</Button>
                                                </div>
                                            </div>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Fixed Action Bar at bottom */}
                        <div className={styles.footerBar}>
                            {isDirty && <Badge tone="warning">{t('unsaved.badge')}</Badge>}
                            <Button size="lg" icon={<Save size={18} />} loading={loading} onClick={handleSave}>
                                {t('common.save')}
                            </Button>
                        </div>
                    </>
                ) : (
                    <EmptyState
                        icon={<MousePointerClick size={28} />}
                        title={t('preset.pick.title')}
                        description={t('preset.pick.desc')}
                    />
                )}
            </div>

            {pendingDiscard && (
                <ConfirmDialog
                    title={t('unsaved.title')}
                    message={t('unsaved.message')}
                    confirmLabel={t('unsaved.confirm')}
                    tone="danger"
                    onConfirm={() => { const action = pendingDiscard; setPendingDiscard(null); action(); }}
                    onCancel={() => setPendingDiscard(null)}
                />
            )}

            {confirmDeletePreset && (
                <ConfirmDialog
                    title={t('preset.delPreset.title')}
                    message={t('preset.delPreset.msg')}
                    confirmLabel={t('preset.delete.go')}
                    tone="danger"
                    loading={loading}
                    onConfirm={() => handleDeleteById(confirmDeletePreset)}
                    onCancel={() => setConfirmDeletePreset(null)}
                />
            )}

            {confirmDeleteChannel !== null && (
                <ConfirmDialog
                    title={t('preset.delChannel.title')}
                    message={t('preset.delChannel.msg')}
                    confirmLabel={t('preset.delete.go')}
                    tone="danger"
                    onConfirm={() => deleteChannel(confirmDeleteChannel)}
                    onCancel={() => setConfirmDeleteChannel(null)}
                />
            )}

            {previewSrc && (
                <Modal title="" width="fit-content" onClose={() => setPreviewSrc(null)}>
                    <img src={previewSrc} className={styles.previewImg} alt="" />
                </Modal>
            )}
        </div>
    );
}

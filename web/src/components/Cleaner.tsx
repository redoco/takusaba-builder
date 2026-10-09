import { useState, useEffect } from 'react';
import { RefreshCw, Trash2, Check, FolderX } from 'lucide-react';
import * as api from '../api';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Modal from '../ui/Modal';
import Badge from '../ui/Badge';
import Callout from '../ui/Callout';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/toastContext';
import { useI18n, apiErrMsg } from '../i18n';
import styles from './Cleaner.module.css';

export default function Cleaner() {
    const toast = useToast();
    const { t } = useI18n();
    const errMsg = (e: unknown) => apiErrMsg(t, e);
    const [categories, setCategories] = useState<api.Category[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [managedOnly, setManagedOnly] = useState(true);
    const [deleteRoles, setDeleteRoles] = useState(true);

    // UI State
    const [loading, setLoading] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [result, setResult] = useState<api.RunDeleteResult | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await api.getCategories();
            setCategories(data);
        } catch (e) {
            toast(errMsg(e), 'error');
        } finally {
            setLoading(false);
        }
    };

    const visible = managedOnly ? categories.filter(c => c.managed) : categories;

    const toggleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const allSelected = visible.length > 0 && visible.every(c => selectedIds.has(c.id));

    const selectedCategories = categories.filter(c => selectedIds.has(c.id));

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;
        setLoading(true);
        setResult(null);
        try {
            const res = await api.runDelete(Array.from(selectedIds), deleteRoles);
            setResult(res);
            setShowConfirm(false);
            // Refresh list
            await loadData();
            // Clear selection of deleted items
            const deleted = new Set(res.filter(r => r.success).map(r => r.categoryId));
            const newSet = new Set(selectedIds);
            deleted.forEach(id => newSet.delete(id));
            setSelectedIds(newSet);
        } catch (e) {
            toast(errMsg(e), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.inner}>
                <div className={styles.headRow}>
                    <h2>{t('clean.title')}</h2>
                    <div className={styles.headActions}>
                        <button
                            role="switch"
                            aria-checked={managedOnly}
                            className={`${styles.managedToggle} ${managedOnly ? styles.on : ''}`}
                            onClick={() => setManagedOnly(v => !v)}
                        >
                            <span className={styles.switchDot} />
                            {t('clean.managedOnly')}
                        </button>
                        <Button variant="secondary" icon={<RefreshCw size={16} />} loading={loading} onClick={loadData}>
                            {t('clean.refresh')}
                        </Button>
                        <Button
                            variant="danger"
                            icon={<Trash2 size={16} />}
                            disabled={selectedIds.size === 0}
                            loading={loading}
                            onClick={() => setShowConfirm(true)}
                        >
                            {t('clean.delete', { n: selectedIds.size })}
                        </Button>
                    </div>
                </div>

                <Callout tone="warning">
                    {t('clean.warn')}
                </Callout>

                <Card flush className={styles.tableCard}>
                    {visible.length === 0 ? (
                        <EmptyState
                            icon={<FolderX size={28} />}
                            title={t('clean.empty.title')}
                            description={managedOnly ? t('clean.empty.desc') : undefined}
                        />
                    ) : (
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th className={styles.checkCol}>
                                        <button
                                            className={`${styles.checkbox} ${allSelected ? styles.checked : ''}`}
                                            onClick={() => {
                                                if (allSelected) setSelectedIds(new Set());
                                                else setSelectedIds(new Set(visible.map(c => c.id)));
                                            }}
                                            aria-label={t('common.selectAll')}
                                        >
                                            <Check size={12} />
                                        </button>
                                    </th>
                                    <th>{t('clean.th.name')}</th>
                                    <th>ID</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map(c => (
                                    <tr
                                        key={c.id}
                                        className={`${styles.row} ${selectedIds.has(c.id) ? styles.selected : ''}`}
                                        onClick={() => toggleSelect(c.id)}
                                    >
                                        <td>
                                            <button
                                                className={`${styles.checkbox} ${selectedIds.has(c.id) ? styles.checked : ''}`}
                                                onClick={e => { e.stopPropagation(); toggleSelect(c.id); }}
                                                aria-label={c.name}
                                            >
                                                <Check size={12} />
                                            </button>
                                        </td>
                                        <td>
                                            <div className={styles.nameCell}>
                                                <span className={`${styles.catName} ${c.managed ? '' : styles.foreign}`}>{c.name}</span>
                                                <Badge tone="neutral">{t('clean.badgeCh', { n: c.childCount })}</Badge>
                                                {c.managed && <Badge tone="accent">{t('clean.badgeMine')}</Badge>}
                                                {(c.roleCount ?? 0) > 0 && <Badge tone="neutral">{t('clean.badgeRoles', { n: c.roleCount ?? 0 })}</Badge>}
                                            </div>
                                        </td>
                                        <td><code className={styles.catId}>{c.id}</code></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </Card>
            </div>

            {/* Confirm Modal */}
            {showConfirm && (
                <Modal
                    title={t('clean.confirm.title')}
                    width={500}
                    onClose={() => setShowConfirm(false)}
                    footer={
                        <>
                            <Button variant="secondary" onClick={() => setShowConfirm(false)}>{t('common.cancel')}</Button>
                            <Button variant="danger" onClick={handleDelete} loading={loading}>
                                {t('clean.confirm.go')}
                            </Button>
                        </>
                    }
                >
                    <div className={styles.confirmBox}>
                        <div className={styles.confirmCount}>
                            {t('clean.confirm.count', { n: selectedIds.size })}
                        </div>
                        <ul className={styles.confirmList}>
                            {selectedCategories.slice(0, 8).map(c => (
                                <li key={c.id}>{c.name}</li>
                            ))}
                            {selectedCategories.length > 8 && (
                                <li>{t('clean.confirm.more', { n: selectedCategories.length - 8 })}</li>
                            )}
                        </ul>
                        <div className={styles.confirmWarn}>
                            {t('clean.confirm.warn')}
                        </div>
                        {selectedCategories.some(c => (c.roleCount ?? 0) > 0) && (
                            <button
                                type="button"
                                role="switch"
                                aria-checked={deleteRoles}
                                className={`${styles.managedToggle} ${deleteRoles ? styles.on : ''}`}
                                onClick={() => setDeleteRoles(v => !v)}
                                title={t('clean.deleteRolesHint')}
                            >
                                <span className={styles.switchDot} />
                                {t('clean.deleteRoles')}
                                {' '}({selectedCategories.reduce((a, c) => a + (c.roleCount ?? 0), 0)})
                            </button>
                        )}
                    </div>
                </Modal>
            )}

            {/* Result Modal */}
            {result && (
                <Modal
                    title={t('clean.result.title')}
                    description={t('clean.result.desc')}
                    width={600}
                >
                    <div className={styles.resultTable}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{t('clean.th.catId')}</th>
                                    <th className={styles.right}>{t('common.status')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.map(r => (
                                    <tr key={r.categoryId}>
                                        <td><code className={styles.catId}>{r.categoryId}</code></td>
                                        <td className={styles.right}>
                                            {r.success ? (
                                                <>
                                                    <Badge tone="success">{t('common.success')}</Badge>
                                                    {(r.rolesDeleted ?? 0) > 0 && (
                                                        <span className={styles.resultNote}>{t('clean.result.rolesDeleted', { n: r.rolesDeleted ?? 0 })}</span>
                                                    )}
                                                    {(r.roleErrors?.length ?? 0) > 0 && (
                                                        <span className={styles.resultError}>{t('clean.result.roleErrors')}{r.roleErrors!.join(' / ')}</span>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    <Badge tone="danger">{t('common.failure')}</Badge>
                                                    <span className={styles.resultError}>{r.error}</span>
                                                </>
                                            )}
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

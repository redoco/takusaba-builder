import fs from 'fs';
import path from 'path';
import { Preset, Asset } from './types';
import { PRESETS_FILE, ASSETS_DIR, ROLES_FILE } from './paths';

export const getPresets = (): Preset[] => {
    if (!fs.existsSync(PRESETS_FILE)) {
        return [];
    }
    const data = fs.readFileSync(PRESETS_FILE, 'utf-8');
    return JSON.parse(data || '[]');
};

export const savePreset = (preset: Preset): void => {
    const presets = getPresets();
    const index = presets.findIndex((p) => p.presetId === preset.presetId);
    if (index !== -1) {
        presets[index] = preset;
    } else {
        presets.push(preset);
    }
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2));
};

export const deletePreset = (presetId: string): void => {
    const presets = getPresets();
    const newPresets = presets.filter((p) => p.presetId !== presetId);
    fs.writeFileSync(PRESETS_FILE, JSON.stringify(newPresets, null, 2));
};

export const getAssetPath = (assetId: string): string | null => {
    // In a real app we might store metadata separately, but here we assume filename is assetId or we scan dir
    // The requirement says "presets.json doesn't store absolute path, only assetId".
    // We need to resolve assetId to filename.
    // Simplest way: assetId IS the filename (uuid + extension)
    // Or we scan the directory for files starting with assetId.

    if (typeof assetId !== 'string' || !/^[\w.-]{1,120}$/.test(assetId) || assetId.startsWith('.')) return null;
    if (!fs.existsSync(ASSETS_DIR)) return null;
    const files = fs.readdirSync(ASSETS_DIR);
    const file = files.find(f => f.startsWith(assetId));
    if (!file) return null;
    const resolved = path.resolve(ASSETS_DIR, file);
    if (!resolved.startsWith(path.resolve(ASSETS_DIR) + path.sep)) return null;
    return resolved;
};

// Roles created together with a category: { [categoryId]: roleId[] }.
// Used by the cleanup tab to delete a table's roles along with its category.
type RoleRecord = Record<string, string[]>;

const readRoleRecord = (): RoleRecord => {
    try {
        if (!fs.existsSync(ROLES_FILE)) return {};
        const parsed = JSON.parse(fs.readFileSync(ROLES_FILE, 'utf-8') || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
};

export const getCreatedRoles = (categoryId: string): string[] => readRoleRecord()[categoryId] ?? [];

export const setCreatedRoles = (categoryId: string, roleIds: string[]): void => {
    const rec = readRoleRecord();
    if (roleIds.length > 0) rec[categoryId] = roleIds;
    else delete rec[categoryId];
    fs.mkdirSync(path.dirname(ROLES_FILE), { recursive: true });
    fs.writeFileSync(ROLES_FILE, JSON.stringify(rec, null, 2));
};

import { EventEmitter } from 'events';

export type UpdateStatus =
    | 'idle'
    | 'unsupported'
    | 'checking'
    | 'not-available'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'error';

export type UpdateState = {
    status: UpdateStatus;
    currentVersion: string;
    latestVersion?: string;
    progress?: number;
    error?: string;
    // true when the platform can't self-update and the user must download manually (macOS unsigned builds)
    manual?: boolean;
    releaseUrl: string;
};

const RELEASE_URL = 'https://github.com/redoco/takusaba-builder/releases/latest';

let state: UpdateState = {
    status: 'idle',
    currentVersion: '',
    releaseUrl: RELEASE_URL
};

export const updateEvents = new EventEmitter(); // emits 'check' | 'download' | 'install'

export const getUpdateState = (): UpdateState => ({ ...state });

export const setUpdateState = (partial: Partial<UpdateState>): UpdateState => {
    state = { ...state, ...partial };
    return getUpdateState();
};

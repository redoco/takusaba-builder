export interface PresetChannel {
    key: string;
    name: string;
    type?: 'text' | 'voice';
    isHidden?: boolean;
}

export interface PresetPostItem {
    type: 'text' | 'file';
    content?: string; // for text
    assetId?: string; // for file
    filename?: string; // optional user-friendly name
    caption?: string; // optional caption for file
}

export interface PresetPost {
    targetChannelKey: string;
    items: PresetPostItem[];
}

export interface PresetRoleCharacter {
    name: string;
    /** このキャラクターのロールが見られる秘匿チャンネル（PresetChannel.key） */
    channelKey?: string;
}

export interface Preset {
    presetId: string;
    presetName: string;
    channels: PresetChannel[];
    posts: PresetPost[];
    /** 卓を立てるときに作るキャラクターロール（⑴アダム ⑵ソフィー …） */
    roleCharacters?: PresetRoleCharacter[];
}

export interface Asset {
    assetId: string;
    filename: string;
    originalName: string;
    path: string;
    mimeType: string;
    size: number;
    uploadedAt: string;
}

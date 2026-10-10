/** write = 見える・書き込める（ボイスは話せる）／ read = 見るだけ（ボイスは聞くだけ）／ none = 見えない */
export type AccessLevel = 'write' | 'read' | 'none';

export interface PresetChannel {
    key: string;
    name: string;
    type?: 'text' | 'voice';
    isHidden?: boolean;
    /**
     * PL・観戦がこのチャンネルでできること（GM はいつでも書き込める）。
     * 未設定ならチャンネル名から推測した既定値（channelAccess.ts の defaultAccess）。
     * キャラクターロールは、秘匿チャンネルでは紐づけたものだけ書き込め、それ以外のチャンネルでは PL と同じ。
     */
    access?: { pl?: AccessLevel, watch?: AccessLevel };
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

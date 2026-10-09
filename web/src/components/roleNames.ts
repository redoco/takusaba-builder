export type Tier = 'gm' | 'pl' | 'watch';

export type CharacterDraft = {
    id: string;
    name: string;
    /** 秘匿チャンネルの key（'' = なし） */
    channelKey: string;
    /** 担当する参加者の ID（'' = あとで決める） */
    memberId: string;
};

export const EMOJI_CHOICES = [
    '🍎', '🍊', '🍋', '🍇', '🍓', '🍒', '🍑', '🫐',
    '🌸', '🌹', '🌻', '🍀', '🍁', '🌙', '⭐', '🔥',
    '💧', '⚡', '❄️', '🌈', '🎭', '🎲', '🃏', '🔮',
    '🗝️', '🕯️', '📜', '🗡️', '👑', '💎', '🎻', '🍷',
    '🐈', '🐕', '🐇', '🦊', '🐻', '🦉', '🐍', '🦋'
];

// ⑴〜⒇（U+2474〜U+2487）、21 人目以降は (21) のように
export const charNumber = (i: number): string =>
    i < 20 ? String.fromCodePoint(0x2474 + i) : `(${i + 1})`;

// Discord のロール名は 100 文字まで
export const clampRoleName = (s: string): string => {
    let out = '';
    for (const ch of s) {
        if ((out + ch).length > 100) break;
        out += ch;
    }
    return out;
};

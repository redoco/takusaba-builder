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

// 名前の比較用：全角半角・大文字小文字をそろえ、絵文字・番号・記号・空白を取り除く
// 例：「🌷⑴アダム」「⑴アダムの部屋」「アダム」→ 'アダム' / 'アダムの部屋' / 'アダム'
const normalizeForMatch = (s: string): string =>
    s.normalize('NFKC').toLowerCase().replace(/[^\p{L}]/gu, '');

/**
 * キャラクター名から、名前がリンクしている秘匿チャンネルを探す。
 * 1. 記号や番号を除いて名前がまったく同じチャンネル
 * 2. チャンネル名にキャラクター名が含まれるチャンネル（複数あれば一番名前の短いもの）
 * 見つからなければ ''。
 */
export const matchChannelForCharacter = (
    charName: string,
    channels: { key: string, name: string }[]
): string => {
    const target = normalizeForMatch(charName);
    if (!target) return '';
    const exact = channels.find(ch => normalizeForMatch(ch.name) === target);
    if (exact) return exact.key;
    const partial = channels
        .filter(ch => normalizeForMatch(ch.name).includes(target))
        .sort((a, b) => normalizeForMatch(a.name).length - normalizeForMatch(b.name).length);
    return partial[0]?.key ?? '';
};

// Discord のロール名は 100 文字まで
export const clampRoleName = (s: string): string => {
    let out = '';
    for (const ch of s) {
        if ((out + ch).length > 100) break;
        out += ch;
    }
    return out;
};

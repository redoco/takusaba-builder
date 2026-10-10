// チャンネルごとに「PL」「観戦」がどこまでできるか。GM はいつでも書き込める。
// web/src/components/channelAccess.ts と同じ内容（サーバーとアプリ画面の両方で使う）。
import type { PresetChannel, AccessLevel } from './types';

export const ACCESS_LEVELS: AccessLevel[] = ['write', 'read', 'none'];

/**
 * 設定されていないときの既定値。チャンネル名から推測する。
 * - 秘匿（キャラクターの個別チャンネルなど）：PL 見えない／観戦 見るだけ
 * - 「連絡」：全員書き込める
 * - 「共通」：PL・観戦とも見るだけ
 * - 「解説」：PL 見えない／観戦 見るだけ
 * - 「観戦」：PL 見えない／観戦 書き込める
 * - それ以外：PL 書き込める／観戦 見るだけ
 */
export const defaultAccess = (ch: Pick<PresetChannel, 'name' | 'isHidden'>): { pl: AccessLevel, watch: AccessLevel } => {
    const name = ch.name ?? '';
    if (ch.isHidden) return { pl: 'none', watch: 'read' };
    if (name.includes('連絡')) return { pl: 'write', watch: 'write' };
    if (name.includes('解説')) return { pl: 'none', watch: 'read' };
    if (name.includes('観戦')) return { pl: 'none', watch: 'write' };
    if (name.includes('共通')) return { pl: 'read', watch: 'read' };
    return { pl: 'write', watch: 'read' };
};

export const channelAccess = (ch: PresetChannel): { pl: AccessLevel, watch: AccessLevel } => {
    const d = defaultAccess(ch);
    const ok = (v: unknown): v is AccessLevel => ACCESS_LEVELS.includes(v as AccessLevel);
    return {
        pl: ok(ch.access?.pl) ? ch.access!.pl! : d.pl,
        watch: ok(ch.access?.watch) ? ch.access!.watch! : d.watch
    };
};

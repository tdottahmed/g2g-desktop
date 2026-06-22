/**
 * Per-game configuration for g2g.com automation.
 *
 * GAME_BRANDS       — the exact brand name to search on g2g.com when selecting a game.
 *                     Verify these against the g2g.com "Select brand" dropdown if a game
 *                     fails to be found.
 *
 * GAME_FIELD_SPECS  — ordered list of game_data fields for each game.
 *                     Order must match the order fields appear on the g2g.com form.
 *                     type: 'dropdown' → uses the g2g select-with-filter widget
 *                     type: 'text'     → uses a plain Quasar text/number input
 *
 *                     NOTE: Field labels are for logging only; fields are located by
 *                     their position in the form section (not by label text).
 */

export const GAME_BRANDS = {
    clash_of_clans:     'Clash of Clans (Global)',
    brawl_stars:        'BS',
    clash_royale:       'Clash Royale (Global)',
    hay_day:            'Hay Day (Global)',
    mobile_legends:     'Mobile Legends',
    call_of_duty_mobile: 'Call of Duty Mobile',
};

export const GAME_FIELD_SPECS = {
    clash_of_clans: [
        { key: 'th_level',       label: 'Town Hall Level', type: 'dropdown' },
        { key: 'king_level',     label: 'King Level',      type: 'dropdown' },
        { key: 'queen_level',    label: 'Queen Level',     type: 'dropdown' },
        { key: 'warden_level',   label: 'Warden Level',   type: 'dropdown' },
        { key: 'champion_level', label: 'Champion Level', type: 'dropdown' },
    ],
    brawl_stars: [
        { key: 'platform', label: 'Platform', type: 'dropdown' },
        { key: 'trophies', label: 'Trophies', type: 'text' },
        { key: 'brawlers', label: 'Brawlers', type: 'text' },
        { key: 'skins',    label: 'Skins',    type: 'text' },
    ],
    clash_royale: [
        { key: 'king_level',     label: 'King Level',      type: 'dropdown' },
        { key: 'arena',          label: 'Arena',           type: 'dropdown' },
        { key: 'level_16_cards', label: 'Level 16 Cards', type: 'text' },
        { key: 'level_15_cards', label: 'Level 15 Cards', type: 'text' },
        { key: 'level_14_cards', label: 'Level 14 Cards', type: 'text' },
    ],
    hay_day: [
        { key: 'platform', label: 'Platform', type: 'dropdown' },
    ],
    mobile_legends: [
        { key: 'platform', label: 'Platform', type: 'dropdown' },
        { key: 'rank',     label: 'Rank',     type: 'dropdown' },
        { key: 'heroes',   label: 'Heroes',   type: 'text' },
        { key: 'skins',    label: 'Skins',    type: 'text' },
    ],
    call_of_duty_mobile: [
        { key: 'platform', label: 'Platform', type: 'dropdown' },
        { key: 'rank',     label: 'Rank',     type: 'dropdown' },
    ],
};

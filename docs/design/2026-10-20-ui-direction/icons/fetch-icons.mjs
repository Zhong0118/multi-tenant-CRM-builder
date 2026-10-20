// Fetches the exact icons the mock-ups use from Iconify and caches them next to this file.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const SETS = {
  ph: { // A: Phosphor Regular
    home: 'house', todo: 'calendar-check', ai: 'sparkle', leads: 'target', customers: 'buildings', deals: 'handshake',
    activities: 'chat-centered-text', contracts: 'file-text', payments: 'receipt', members: 'users-three', audit: 'clipboard-text',
    settings: 'gear-six', search: 'magnifying-glass', plus: 'plus', chevDown: 'caret-down', chevUp: 'caret-up', chevRight: 'caret-right',
    filter: 'funnel-simple', sort: 'arrows-down-up', columns: 'sliders-horizontal', import: 'upload-simple', export: 'download-simple',
    more: 'dots-three', close: 'x', check: 'check', edit: 'pencil-simple', trash: 'trash', clock: 'clock', phone: 'phone', tag: 'tag',
    user: 'user', up: 'arrow-up', down: 'arrow-down', grip: 'dots-six-vertical', command: 'command', sidebar: 'sidebar-simple',
    calendar: 'calendar-blank', textSingle: 'text-t', textMulti: 'text-align-left', number: 'hash', select: 'caret-circle-down',
    warn: 'warning', info: 'info', circleCheck: 'check-circle', circle: 'circle', arrowRight: 'arrow-right', rocket: 'rocket-launch',
    eye: 'eye', link: 'link-simple', flow: 'flow-arrow', history: 'clock-counter-clockwise', building: 'building-office',
    money: 'currency-cny', lock: 'lock-simple', table: 'table', list: 'rows', logout: 'sign-out', bell: 'bell', pool: 'tray', swap: 'arrows-left-right',
  },
  tabler: { // B: Tabler (1.5px stroke)
    home: 'home', todo: 'calendar-check', ai: 'sparkles', leads: 'target', customers: 'building', deals: 'briefcase',
    activities: 'message-2', contracts: 'file-text', payments: 'receipt', members: 'users', audit: 'clipboard-check',
    settings: 'settings', search: 'search', plus: 'plus', chevDown: 'chevron-down', chevUp: 'chevron-up', chevRight: 'chevron-right',
    filter: 'filter', sort: 'arrows-sort', columns: 'layout-columns', import: 'upload', export: 'download',
    more: 'dots', close: 'x', check: 'check', edit: 'pencil', trash: 'trash', clock: 'clock', phone: 'phone', tag: 'tag',
    user: 'user', up: 'arrow-up', down: 'arrow-down', grip: 'grip-vertical', command: 'command', sidebar: 'layout-sidebar',
    calendar: 'calendar', textSingle: 'typography', textMulti: 'align-left', number: 'hash', select: 'selector',
    warn: 'alert-triangle', info: 'info-circle', circleCheck: 'circle-check', circle: 'circle', arrowRight: 'arrow-right', rocket: 'rocket',
    eye: 'eye', link: 'link', flow: 'route', history: 'history', building: 'building-skyscraper', money: 'currency-yuan',
    lock: 'lock', table: 'table', list: 'list', logout: 'logout', bell: 'bell', pool: 'inbox', swap: 'arrows-left-right',
    circleHalf: 'circle-half-2', circleDot: 'circle-dot', circleDash: 'circle-dashed',
  },
  lucide: { // C: Lucide (what shadcn/ui ships)
    home: 'house', todo: 'calendar-check', ai: 'sparkles', leads: 'target', customers: 'building-2', deals: 'handshake',
    activities: 'message-square-text', contracts: 'file-text', payments: 'receipt', members: 'users', audit: 'clipboard-list',
    settings: 'settings', search: 'search', plus: 'plus', chevDown: 'chevron-down', chevUp: 'chevron-up', chevRight: 'chevron-right',
    filter: 'list-filter', sort: 'arrow-up-down', columns: 'sliders-horizontal', import: 'upload', export: 'download',
    more: 'ellipsis', close: 'x', check: 'check', edit: 'pencil', trash: 'trash-2', clock: 'clock', phone: 'phone', tag: 'tag',
    user: 'user', up: 'arrow-up', down: 'arrow-down', grip: 'grip-vertical', command: 'command', sidebar: 'panel-left',
    calendar: 'calendar', textSingle: 'type', textMulti: 'align-left', number: 'hash', select: 'chevrons-up-down',
    warn: 'triangle-alert', info: 'info', circleCheck: 'circle-check', circle: 'circle', arrowRight: 'arrow-right', rocket: 'rocket',
    eye: 'eye', link: 'link', flow: 'workflow', history: 'history', building: 'building', money: 'circle-dollar-sign',
    lock: 'lock', table: 'table', list: 'list', logout: 'log-out', bell: 'bell', pool: 'inbox', swap: 'arrow-left-right',
    circlePlus: 'circle-plus', circleDash: 'circle-dashed', chevUpDown: 'chevrons-up-down', gripH: 'grip',
  },
};
for (const [set, map] of Object.entries(SETS)) {
  const names = [...new Set(Object.values(map))].join(',');
  // Node's fetch is reset by this network's proxy; curl goes through.
  const json = JSON.parse(execFileSync('curl', ['-fsSL', '-m', '60', `https://api.iconify.design/${set}.json?icons=${names}`], { encoding: 'utf8' }));
  const missing = Object.entries(map).filter(([, n]) => !json.icons?.[n] && !json.aliases?.[n]);
  fs.writeFileSync(new URL(`./${set}.json`, import.meta.url), JSON.stringify({ map, ...json }, null, 1));
  console.log(set, 'icons:', Object.keys(json.icons ?? {}).length, 'aliases:', Object.keys(json.aliases ?? {}).length, 'missing:', missing.map((m) => m.join('→')).join(', ') || 'none');
}

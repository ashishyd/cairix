/**
 * Keyboard shortcuts worth knowing, per operating system. Only the set for the
 * system Cairix is running on is shown: a Mac user never sees Ctrl+C as "copy".
 * Keys are written as plain tokens and turned into symbols (⌘ ⇧ ⌥) for display.
 */

export type KeymapPlatform = 'mac' | 'windows' | 'linux'

export interface KeymapItem {
  /** One combination, e.g. ['Cmd', 'Shift', '4']. */
  keys: string[]
  does: string
}

export interface KeymapGroup {
  id: string
  title: string
  note?: string
  items: KeymapItem[]
}

export const PLATFORM_LABEL: Record<KeymapPlatform, string> = { mac: 'macOS', windows: 'Windows', linux: 'Linux' }

/** `navigator.platform` / `process.platform` to one of ours. Unknown systems get the Linux set (closest to a generic Unix). */
export function platformOf(name: string): KeymapPlatform {
  const n = name.toLowerCase()
  if (n.startsWith('mac') || n === 'darwin') return 'mac'
  if (n.startsWith('win')) return 'windows'
  return 'linux'
}

const MAC_SYMBOL: Record<string, string> = {
  Cmd: '⌘', Shift: '⇧', Option: '⌥', Ctrl: '⌃', Tab: '⇥', Esc: '⎋', Enter: '↩', Delete: '⌫', Left: '←', Right: '→', Up: '↑', Down: '↓', Fn: 'fn'
}
const TEXT_KEY: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓' }

/** Display form of each key in a combination. */
export function keyLabels(keys: string[], platform: KeymapPlatform): string[] {
  return keys.map((k) => (platform === 'mac' ? (MAC_SYMBOL[k] ?? k) : (TEXT_KEY[k] ?? k)))
}

const k = (does: string, ...keys: string[]): KeymapItem => ({ keys, does })

const MAC: KeymapGroup[] = [
  {
    id: 'system', title: 'Everyday macOS', items: [
      k('Open Spotlight (find apps, files, do maths)', 'Cmd', 'Space'),
      k('Switch between apps', 'Cmd', 'Tab'),
      k('Switch between windows of the same app', 'Cmd', '`'),
      k('Close the window', 'Cmd', 'W'),
      k('Quit the app', 'Cmd', 'Q'),
      k('Minimise the window', 'Cmd', 'M'),
      k('Hide the app', 'Cmd', 'H'),
      k('Open the app’s settings', 'Cmd', ','),
      k('Force Quit an app that is stuck', 'Cmd', 'Option', 'Esc'),
      k('Lock the screen', 'Ctrl', 'Cmd', 'Q'),
      k('Emoji and symbols', 'Ctrl', 'Cmd', 'Space'),
      k('Mission Control (all windows)', 'Ctrl', 'Up'),
      k('Move between desktops', 'Ctrl', 'Left'),
      k('Screenshot of the whole screen', 'Cmd', 'Shift', '3'),
      k('Screenshot of a selection', 'Cmd', 'Shift', '4'),
      k('Screenshot toolbar (and screen recording)', 'Cmd', 'Shift', '5'),
      k('Screenshot straight to the clipboard', 'Ctrl', 'Cmd', 'Shift', '4')
    ]
  },
  {
    id: 'text', title: 'Editing text anywhere', items: [
      k('Copy', 'Cmd', 'C'), k('Cut', 'Cmd', 'X'), k('Paste', 'Cmd', 'V'),
      k('Paste without formatting', 'Cmd', 'Shift', 'Option', 'V'),
      k('Undo', 'Cmd', 'Z'), k('Redo', 'Cmd', 'Shift', 'Z'),
      k('Select all', 'Cmd', 'A'), k('Find', 'Cmd', 'F'), k('Find next', 'Cmd', 'G'),
      k('Jump to the start of the line', 'Cmd', 'Left'),
      k('Jump to the end of the line', 'Cmd', 'Right'),
      k('Jump to the top / bottom of the document', 'Cmd', 'Up'),
      k('Move one word left', 'Option', 'Left'),
      k('Move one word right', 'Option', 'Right'),
      k('Delete the previous word', 'Option', 'Delete'),
      k('Delete to the start of the line', 'Cmd', 'Delete'),
      k('Delete to the end of the line', 'Ctrl', 'K')
    ]
  },
  {
    id: 'finder', title: 'Finder', items: [
      k('Go to a folder by path', 'Cmd', 'Shift', 'G'),
      k('New folder', 'Cmd', 'Shift', 'N'),
      k('Quick Look the selected file', 'Space'),
      k('Get Info', 'Cmd', 'I'),
      k('Rename the selected file', 'Enter'),
      k('Duplicate', 'Cmd', 'D'),
      k('Copy the file’s path', 'Cmd', 'Option', 'C'),
      k('Show or hide hidden files', 'Cmd', 'Shift', '.'),
      k('Move to Trash', 'Cmd', 'Delete'),
      k('Empty the Trash', 'Cmd', 'Shift', 'Delete'),
      k('Open the parent folder', 'Cmd', 'Up'),
      k('Open the selected item', 'Cmd', 'Down'),
      k('Go to your home folder', 'Cmd', 'Shift', 'H'),
      k('Go to Applications', 'Cmd', 'Shift', 'A'),
      k('Go to Downloads', 'Cmd', 'Option', 'L')
    ]
  },
  {
    id: 'browser', title: 'Browser (Safari, Chrome, Arc)', items: [
      k('Focus the address bar', 'Cmd', 'L'),
      k('New tab', 'Cmd', 'T'), k('Close the tab', 'Cmd', 'W'),
      k('Reopen the last closed tab', 'Cmd', 'Shift', 'T'),
      k('Jump to tab 1 to 8', 'Cmd', '1'),
      k('Next tab', 'Ctrl', 'Tab'),
      k('Reload', 'Cmd', 'R'),
      k('Reload ignoring the cache', 'Cmd', 'Shift', 'R'),
      k('Back', 'Cmd', '['), k('Forward', 'Cmd', ']'),
      k('Developer tools', 'Cmd', 'Option', 'I'),
      k('Inspect an element (Chrome)', 'Cmd', 'Shift', 'C'),
      k('Developer console (Chrome)', 'Cmd', 'Option', 'J')
    ]
  },
  {
    id: 'terminal', title: 'Terminal and shell (zsh, bash)', note: 'In Terminal.app turn on Profiles → Keyboard → “Use Option as Meta key” for Option+arrow word jumps.', items: [
      k('Stop the running command', 'Ctrl', 'C'),
      k('End input / log out of the shell', 'Ctrl', 'D'),
      k('Suspend the running command (resume with fg)', 'Ctrl', 'Z'),
      k('Clear the screen', 'Ctrl', 'L'),
      k('Search your command history', 'Ctrl', 'R'),
      k('Previous / next command', 'Ctrl', 'P'),
      k('Jump to the start of the line', 'Ctrl', 'A'),
      k('Jump to the end of the line', 'Ctrl', 'E'),
      k('Delete everything before the cursor', 'Ctrl', 'U'),
      k('Delete everything after the cursor', 'Ctrl', 'K'),
      k('Delete the previous word', 'Ctrl', 'W'),
      k('Paste what you last deleted', 'Ctrl', 'Y'),
      k('Complete the command or path', 'Tab'),
      k('New tab (Terminal, iTerm2)', 'Cmd', 'T'),
      k('Clear scrollback (Terminal, iTerm2)', 'Cmd', 'K'),
      k('Split the pane vertically (iTerm2)', 'Cmd', 'D'),
      k('Split the pane horizontally (iTerm2)', 'Cmd', 'Shift', 'D')
    ]
  },
  {
    id: 'editor', title: 'VS Code and Cursor', items: [
      k('Command palette', 'Cmd', 'Shift', 'P'),
      k('Open a file by name', 'Cmd', 'P'),
      k('Search across all files', 'Cmd', 'Shift', 'F'),
      k('Show or hide the sidebar', 'Cmd', 'B'),
      k('Show or hide the terminal', 'Ctrl', '`'),
      k('Select the next match of the selection', 'Cmd', 'D'),
      k('Select every match', 'Cmd', 'Shift', 'L'),
      k('Add a cursor above / below', 'Cmd', 'Option', 'Up'),
      k('Move the line up / down', 'Option', 'Up'),
      k('Copy the line down', 'Shift', 'Option', 'Down'),
      k('Delete the line', 'Cmd', 'Shift', 'K'),
      k('Comment or uncomment', 'Cmd', '/'),
      k('Go to symbol in file', 'Cmd', 'Shift', 'O'),
      k('Go to line', 'Ctrl', 'G'),
      k('Go to definition', 'F12'),
      k('Find all references', 'Shift', 'F12'),
      k('Rename a symbol everywhere', 'F2'),
      k('Quick fix', 'Cmd', '.'),
      k('Split the editor', 'Cmd', '\\'),
      k('Cursor: edit selected code with AI', 'Cmd', 'K'),
      k('Cursor: open the AI chat', 'Cmd', 'L')
    ]
  }
]

const WINDOWS: KeymapGroup[] = [
  {
    id: 'system', title: 'Everyday Windows', items: [
      k('Search apps and files', 'Win', 'S'), k('Switch between apps', 'Alt', 'Tab'), k('Task view (all windows and desktops)', 'Win', 'Tab'),
      k('Close the window', 'Alt', 'F4'), k('Lock the screen', 'Win', 'L'), k('Show the desktop', 'Win', 'D'), k('Open Settings', 'Win', 'I'),
      k('Task Manager', 'Ctrl', 'Shift', 'Esc'), k('Emoji and symbols', 'Win', '.'), k('Clipboard history', 'Win', 'V'),
      k('Screenshot of a selection', 'Win', 'Shift', 'S'), k('Snap a window to the left / right', 'Win', 'Left'), k('Move between virtual desktops', 'Ctrl', 'Win', 'Left'), k('Open File Explorer', 'Win', 'E')
    ]
  },
  {
    id: 'text', title: 'Editing text anywhere', items: [
      k('Copy', 'Ctrl', 'C'), k('Cut', 'Ctrl', 'X'), k('Paste', 'Ctrl', 'V'), k('Paste without formatting', 'Ctrl', 'Shift', 'V'), k('Undo', 'Ctrl', 'Z'), k('Redo', 'Ctrl', 'Y'),
      k('Select all', 'Ctrl', 'A'), k('Find', 'Ctrl', 'F'), k('Jump one word left', 'Ctrl', 'Left'), k('Jump one word right', 'Ctrl', 'Right'),
      k('Start of the line', 'Home'), k('End of the line', 'End'), k('Start / end of the document', 'Ctrl', 'Home'), k('Delete the previous word', 'Ctrl', 'Backspace')
    ]
  },
  {
    id: 'explorer', title: 'File Explorer', items: [
      k('Rename', 'F2'), k('Properties', 'Alt', 'Enter'), k('Show or hide the preview pane', 'Alt', 'P'), k('New folder', 'Ctrl', 'Shift', 'N'), k('Address bar', 'Ctrl', 'L'),
      k('Delete permanently', 'Shift', 'Delete'), k('Up one folder', 'Alt', 'Up'), k('Copy the path', 'Ctrl', 'Shift', 'C')
    ]
  },
  {
    id: 'browser', title: 'Browser (Edge, Chrome)', items: [
      k('Focus the address bar', 'Ctrl', 'L'), k('New tab', 'Ctrl', 'T'), k('Close the tab', 'Ctrl', 'W'), k('Reopen the last closed tab', 'Ctrl', 'Shift', 'T'),
      k('Reload ignoring the cache', 'Ctrl', 'Shift', 'R'), k('Developer tools', 'F12'), k('Inspect an element', 'Ctrl', 'Shift', 'C'), k('Next tab', 'Ctrl', 'Tab')
    ]
  },
  {
    id: 'terminal', title: 'Terminal (Windows Terminal, PowerShell, WSL)', items: [
      k('Stop the running command', 'Ctrl', 'C'), k('Copy in the terminal', 'Ctrl', 'Shift', 'C'), k('Paste in the terminal', 'Ctrl', 'Shift', 'V'),
      k('New tab', 'Ctrl', 'Shift', 'T'), k('Split the pane', 'Alt', 'Shift', 'D'), k('Command history search (PowerShell)', 'Ctrl', 'R'),
      k('Clear the screen', 'Ctrl', 'L'), k('Complete', 'Tab'), k('Delete the previous word', 'Ctrl', 'W')
    ]
  },
  {
    id: 'editor', title: 'VS Code and Cursor', items: [
      k('Command palette', 'Ctrl', 'Shift', 'P'), k('Open a file by name', 'Ctrl', 'P'), k('Search across all files', 'Ctrl', 'Shift', 'F'), k('Show or hide the sidebar', 'Ctrl', 'B'),
      k('Show or hide the terminal', 'Ctrl', '`'), k('Select the next match', 'Ctrl', 'D'), k('Select every match', 'Ctrl', 'Shift', 'L'), k('Move the line up / down', 'Alt', 'Up'),
      k('Copy the line down', 'Shift', 'Alt', 'Down'), k('Delete the line', 'Ctrl', 'Shift', 'K'), k('Comment or uncomment', 'Ctrl', '/'), k('Go to definition', 'F12'), k('Rename a symbol everywhere', 'F2'),
      k('Quick fix', 'Ctrl', '.'), k('Cursor: edit selected code with AI', 'Ctrl', 'K'), k('Cursor: open the AI chat', 'Ctrl', 'L')
    ]
  }
]

const LINUX: KeymapGroup[] = [
  {
    id: 'system', title: 'Everyday Linux (GNOME / KDE)', items: [
      k('Open the app launcher / search', 'Super'), k('Switch between apps', 'Alt', 'Tab'), k('Switch between windows of one app', 'Super', '`'), k('Close the window', 'Alt', 'F4'),
      k('Lock the screen', 'Super', 'L'), k('Show the desktop', 'Super', 'D'), k('Move between workspaces', 'Ctrl', 'Alt', 'Left'), k('Screenshot', 'Print'), k('Run a command', 'Alt', 'F2')
    ]
  },
  {
    id: 'text', title: 'Editing text anywhere', items: [
      k('Copy', 'Ctrl', 'C'), k('Cut', 'Ctrl', 'X'), k('Paste', 'Ctrl', 'V'), k('Undo', 'Ctrl', 'Z'), k('Redo', 'Ctrl', 'Shift', 'Z'), k('Select all', 'Ctrl', 'A'), k('Find', 'Ctrl', 'F'),
      k('Jump one word left', 'Ctrl', 'Left'), k('Jump one word right', 'Ctrl', 'Right'), k('Start of the line', 'Home'), k('End of the line', 'End'), k('Delete the previous word', 'Ctrl', 'Backspace')
    ]
  },
  {
    id: 'files', title: 'File manager', items: [
      k('Rename', 'F2'), k('Show hidden files', 'Ctrl', 'H'), k('Address bar', 'Ctrl', 'L'), k('New folder', 'Ctrl', 'Shift', 'N'), k('Up one folder', 'Alt', 'Up'), k('Properties', 'Alt', 'Enter')
    ]
  },
  {
    id: 'browser', title: 'Browser', items: [
      k('Focus the address bar', 'Ctrl', 'L'), k('New tab', 'Ctrl', 'T'), k('Close the tab', 'Ctrl', 'W'), k('Reopen the last closed tab', 'Ctrl', 'Shift', 'T'),
      k('Reload ignoring the cache', 'Ctrl', 'Shift', 'R'), k('Developer tools', 'F12'), k('Next tab', 'Ctrl', 'Tab')
    ]
  },
  {
    id: 'terminal', title: 'Terminal and shell (bash, zsh)', note: 'Most Linux terminals use Ctrl+Shift+C / V for copy and paste, because Ctrl+C stops a command.', items: [
      k('Stop the running command', 'Ctrl', 'C'), k('Copy in the terminal', 'Ctrl', 'Shift', 'C'), k('Paste in the terminal', 'Ctrl', 'Shift', 'V'),
      k('End input / log out of the shell', 'Ctrl', 'D'), k('Suspend the running command', 'Ctrl', 'Z'), k('Clear the screen', 'Ctrl', 'L'), k('Search your command history', 'Ctrl', 'R'),
      k('Start of the line', 'Ctrl', 'A'), k('End of the line', 'Ctrl', 'E'), k('Delete before the cursor', 'Ctrl', 'U'), k('Delete after the cursor', 'Ctrl', 'K'), k('Delete the previous word', 'Ctrl', 'W'),
      k('Jump one word left', 'Alt', 'B'), k('Jump one word right', 'Alt', 'F'), k('Complete the command or path', 'Tab'), k('New tab', 'Ctrl', 'Shift', 'T')
    ]
  },
  {
    id: 'editor', title: 'VS Code and Cursor', items: [
      k('Command palette', 'Ctrl', 'Shift', 'P'), k('Open a file by name', 'Ctrl', 'P'), k('Search across all files', 'Ctrl', 'Shift', 'F'), k('Show or hide the sidebar', 'Ctrl', 'B'),
      k('Show or hide the terminal', 'Ctrl', '`'), k('Select the next match', 'Ctrl', 'D'), k('Select every match', 'Ctrl', 'Shift', 'L'), k('Move the line up / down', 'Alt', 'Up'),
      k('Delete the line', 'Ctrl', 'Shift', 'K'), k('Comment or uncomment', 'Ctrl', '/'), k('Go to definition', 'F12'), k('Rename a symbol everywhere', 'F2'), k('Cursor: edit selected code with AI', 'Ctrl', 'K')
    ]
  }
]

export const KEYMAPS: Record<KeymapPlatform, KeymapGroup[]> = { mac: MAC, windows: WINDOWS, linux: LINUX }

/** Groups for one system, optionally filtered. A group stays if its title or any of its shortcuts match every word. */
export function searchKeymap(platform: KeymapPlatform, query: string): KeymapGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return KEYMAPS[platform]
  const out: KeymapGroup[] = []
  for (const g of KEYMAPS[platform]) {
    const items = g.items.filter((i) => {
      const hay = `${g.title} ${i.does} ${i.keys.join(' ')} ${keyLabels(i.keys, platform).join(' ')}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    if (items.length > 0) out.push({ ...g, items })
  }
  return out
}


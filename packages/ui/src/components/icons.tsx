import {
  Brush,
  ChartColumn,
  Circle,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Download,
  FileInput,
  FlaskConical,
  FolderOpen,
  FolderPlus,
  GalleryThumbnails,
  ImageIcon,
  LayoutDashboard,
  type LucideIcon,
  Minus,
  MoveUpRight,
  Paintbrush,
  Printer,
  Redo2,
  RotateCcw,
  Ruler,
  Save,
  Scissors,
  Settings2,
  Square,
  SquareFunction,
  Table,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

// Command icons by their lucide name (kebab case, as in `Command.icon`). Imported one by one so
// the bundle only carries these; add a line here for a new icon.
const ICONS: Record<string, LucideIcon> = {
  brush: Brush,
  'chart-column': ChartColumn,
  circle: Circle,
  'clipboard-copy': ClipboardCopy,
  'clipboard-paste': ClipboardPaste,
  copy: Copy,
  download: Download,
  'file-input': FileInput,
  'flask-conical': FlaskConical,
  'folder-open': FolderOpen,
  'folder-plus': FolderPlus,
  'gallery-thumbnails': GalleryThumbnails,
  image: ImageIcon,
  'layout-dashboard': LayoutDashboard,
  minus: Minus,
  'move-up-right': MoveUpRight,
  paintbrush: Paintbrush,
  printer: Printer,
  'redo-2': Redo2,
  'rotate-ccw': RotateCcw,
  ruler: Ruler,
  save: Save,
  scissors: Scissors,
  'settings-2': Settings2,
  square: Square,
  'square-function': SquareFunction,
  table: Table,
  type: Type,
  'undo-2': Undo2,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
}

/** A command icon by name; an unknown name draws a plain square rather than failing. */
export function Icon({ name, size = 16 }: { name: string | undefined; size?: number }) {
  const C = (name && ICONS[name]) || Square
  return <C size={size} strokeWidth={1.75} aria-hidden="true" focusable="false" />
}

/** Whether an icon name is known (for tests and a development warning). */
export const hasIcon = (name: string) => Object.hasOwn(ICONS, name)

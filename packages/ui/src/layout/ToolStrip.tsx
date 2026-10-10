import { Icon } from '../components/icons.tsx'
import { CommandTip, Tooltip } from '../components/Tooltip.tsx'
import { DRAW_TOOLS, type DrawTool } from './tools.ts'

/**
 * The layout view's drawing tools, Image… and Table… (roadmap 32), on its toolbar; each with the
 * app's tooltip (roadmap 43: its name and what it does, also on keyboard focus).
 */
export function ToolStrip({
  tool,
  onTool,
  onImage,
  onTable,
}: {
  tool: DrawTool | null
  onTool: (t: DrawTool | null) => void
  onImage: () => void
  onTable: () => void
}) {
  return (
    <span className="tool-strip" role="toolbar" aria-label="Drawing tools">
      {DRAW_TOOLS.map((t) => (
        <Tooltip key={t.tool} content={<CommandTip name={t.label} hint={t.hint} />}>
          <button
            type="button"
            className={`icon-button${tool === t.tool ? ' on' : ''}`}
            aria-pressed={tool === t.tool}
            aria-label={t.label}
            onClick={() => onTool(tool === t.tool ? null : t.tool)}
          >
            <Icon name={t.icon} />
          </button>
        </Tooltip>
      ))}
      <Tooltip content={<CommandTip name="Image…" hint="Place an image (PNG or JPEG)" />}>
        <button type="button" className="icon-button" aria-label="Image…" onClick={onImage}>
          <Icon name="image" />
        </button>
      </Tooltip>
      <Tooltip content={<CommandTip name="Table…" hint="Show a live table of data or results" />}>
        <button type="button" className="icon-button" aria-label="Table…" onClick={onTable}>
          <Icon name="table" />
        </button>
      </Tooltip>
    </span>
  )
}

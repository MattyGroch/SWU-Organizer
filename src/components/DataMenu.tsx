import React from 'react'

type Props = {
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onExport: () => void
  onReset: () => void
}

export function DataMenu({ onImportFile, onExport, onReset }: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const importRef = React.useRef<HTMLInputElement>(null)

  return (
    <div className="toolbar-block">
      <div className="toolbar-label">Data</div>
      <div className="toolbar-group" style={{ position: 'relative', overflow: 'visible' }}>
        <button
          type="button"
          className="tbtn"
          onClick={() => setMenuOpen(v => !v)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Import, export, or reset inventory data"
          aria-label="Data menu"
        >
          <span className="icon" aria-hidden="true">database</span>
        </button>
        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: '#1a1c25',
              border: '1px solid #333',
              borderRadius: 6,
              padding: 6,
              zIndex: 20,
              minWidth: 200,
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="tbtn"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setMenuOpen(false)
                importRef.current?.click()
              }}
              title="Import inventory data (JSON / CSV / XLSX)"
            >
              <span className="icon" aria-hidden="true">upload</span>
              <span>Import…</span>
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,.csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              style={{ display: 'none' }}
              onChange={onImportFile}
            />
            <button
              type="button"
              role="menuitem"
              className="tbtn"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setMenuOpen(false)
                onExport()
              }}
              title="Export inventory to JSON"
            >
              <span className="icon" aria-hidden="true">save</span>
              <span>Export</span>
            </button>
            <div style={{ height: 1, background: '#333', margin: '6px 2px' }} />
            <button
              type="button"
              role="menuitem"
              className="tbtn tbtn-danger"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setMenuOpen(false)
                onReset()
              }}
              title="Reset inventory"
            >
              <span className="icon" aria-hidden="true">delete</span>
              <span>Reset…</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

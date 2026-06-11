import Papa from 'papaparse'
import type { MetadataRow } from '../types'

const METADATA_COLUMNS = ['metadata', 'meta', 'json', 'Meta']

function tryParseJson(s: string): Record<string, unknown> | null {
  const t = s.trim()
  if (!t) return null
  try {
    const v = JSON.parse(t) as unknown
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function parseMetadataCsv(file: File): Promise<MetadataRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows: MetadataRow[] = []
        const data = results.data
        const headers = results.meta.fields ?? []

        const metaCol = headers.find((h) =>
          METADATA_COLUMNS.includes(h.trim().toLowerCase()),
        )

        data.forEach((row, i) => {
          let metadata: Record<string, unknown> = {}
          if (metaCol && row[metaCol] !== undefined) {
            const parsed = tryParseJson(String(row[metaCol]))
            if (parsed) metadata = parsed
            else metadata = { _parseError: 'Invalid JSON in metadata column', _raw: row[metaCol] }
          } else {
            // Treat whole row as flat metadata (non-empty cells)
            for (const [k, v] of Object.entries(row)) {
              if (v === undefined || String(v).trim() === '') continue
              const p = tryParseJson(String(v))
              if (p) {
                metadata = { ...metadata, ...p }
              } else {
                metadata[k] = v
              }
            }
          }

          rows.push({
            rowIndex: i + 1,
            metadata,
            rawCells: { ...row },
          })
        })

        resolve(rows)
      },
      error: (err) => reject(err),
    })
  })
}

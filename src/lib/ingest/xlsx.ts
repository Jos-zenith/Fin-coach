import { dateFromJS } from '../dates'
import type { Rows } from './statement'

/** Reads the first sheet of an .xlsx file into plain string cells. Loaded lazily so the base bundle stays small. */
export async function rowsFromXLSX(file: File): Promise<Rows> {
  const { readSheet } = await import('read-excel-file/browser')
  const data = await readSheet(file)
  return data.map((row) =>
    row.map((cell) => {
      if (cell == null) return ''
      if (cell instanceof Date) return dateFromJS(cell) ?? ''
      return String(cell).trim()
    }),
  )
}

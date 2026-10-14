/** CSV and spreadsheet text use logical records, including quoted line breaks. */
export function parseDelimitedText(input: string) {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  let delimiter = ','
  let quoted = false
  let recordStarted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++
      else quoted = !quoted
    } else if (!quoted && char === '\t') delimiter = '\t'
    else if (!quoted && char === '\n' && recordStarted) break
    if (char.trim()) recordStarted = true
  }

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let closedQuote = false
  quoted = false
  recordStarted = false
  const invalid = (error: string) => ({ delimiter, rows: [] as string[][], error })
  const endCell = () => { row.push(cell); cell = ''; closedQuote = false }
  const endRecord = () => {
    endCell()
    if (recordStarted || row.length > 1 || row[0].trim()) rows.push(row)
    row = []
    recordStarted = false
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index++ }
        else { quoted = false; closedQuote = true }
      } else cell += char
    } else if (char === delimiter) {
      endCell()
      recordStarted = true
    } else if (char === '\n') endRecord()
    else if (closedQuote) {
      if (char !== ' ' && char !== '\t') return invalid('Unexpected text after a closing quote. Check the pasted data.')
    } else if (char === '"') {
      if (cell.trim()) return invalid('A quote must start a field. Use doubled quotes inside a quoted field.')
      cell = ''
      quoted = true
      recordStarted = true
    } else {
      cell += char
      if (char.trim()) recordStarted = true
    }
  }
  if (quoted) return invalid('Unclosed quote in pasted data. Close the quoted field before loading it.')
  if (recordStarted || row.length || cell.trim()) endRecord()
  return { delimiter, rows, error: null }
}

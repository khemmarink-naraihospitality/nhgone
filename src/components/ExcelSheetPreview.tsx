"use client";

import * as XLSX from "xlsx";

// Renders a generated .xlsx as a spreadsheet grid (column letters, row
// numbers, gridlines, merged cells) rather than re-rendering the same data
// from its JSON API. Previewing the real file is what makes the preview
// trustworthy - it shows the workbook-only header rows (RR4's row 1/2
// disclaimer + title + Buddhist date) that the JSON report doesn't carry,
// so what's on screen is what the government office actually receives.
export interface SheetGrid {
  colLetters: string[];
  colWidths: number[];
  cells: string[][];
  mergeMap: Map<string, { rowSpan: number; colSpan: number }>;
  mergeCovered: Set<string>;
}

export function parseSheetForPreview(buf: ArrayBuffer): SheetGrid {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const range = XLSX.utils.decode_range(sheet["!ref"] || "A1");

  const colLetters: string[] = [];
  const colWidths: number[] = [];
  const sheetCols = (sheet["!cols"] || []) as Array<{ wch?: number; width?: number } | undefined>;
  for (let c = range.s.c; c <= range.e.c; c++) {
    colLetters.push(XLSX.utils.encode_col(c));
    // openpyxl's width unit is roughly one character; ~7.2px each renders
    // close to how the same sheet looks in Excel/Sheets.
    const wch = sheetCols[c]?.wch ?? sheetCols[c]?.width;
    colWidths.push(wch ? Math.max(60, Math.round(wch * 7.2)) : 110);
  }

  const cells: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      row.push(cell ? String(cell.w ?? cell.v ?? "") : "");
    }
    cells.push(row);
  }

  // A merged block is one <td> with row/colSpan at its top-left corner; every
  // other cell it covers has to be skipped entirely or the row grows too wide.
  const mergeMap = new Map<string, { rowSpan: number; colSpan: number }>();
  const mergeCovered = new Set<string>();
  for (const m of sheet["!merges"] || []) {
    const r0 = m.s.r - range.s.r;
    const c0 = m.s.c - range.s.c;
    mergeMap.set(`${r0}:${c0}`, { rowSpan: m.e.r - m.s.r + 1, colSpan: m.e.c - m.s.c + 1 });
    for (let r = m.s.r; r <= m.e.r; r++) {
      for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        mergeCovered.add(`${r - range.s.r}:${c - range.s.c}`);
      }
    }
  }

  return { colLetters, colWidths, cells, mergeMap, mergeCovered };
}

export default function ExcelSheetPreview({ grid }: { grid: SheetGrid }) {
  const cornerCls = "sticky top-0 left-0 z-30 bg-[#f1f3f4] border border-[#d0d0d0]";
  const colHeadCls = "sticky top-0 z-20 bg-[#f1f3f4] border border-[#d0d0d0] text-[10px] font-bold text-[#444] py-1";
  const rowHeadCls = "sticky left-0 z-10 bg-[#f1f3f4] border border-[#d0d0d0] text-[10px] font-bold text-[#444] text-center";

  return (
    <div className="overflow-auto h-full bg-white">
      <table className="border-collapse" style={{ tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th className={`${cornerCls} w-10 min-w-[2.5rem]`} />
            {grid.colLetters.map((letter, i) => (
              <th key={letter} className={colHeadCls} style={{ width: grid.colWidths[i], minWidth: grid.colWidths[i] }}>
                {letter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.cells.map((row, r) => (
            <tr key={r}>
              <th className={`${rowHeadCls} w-10 min-w-[2.5rem]`}>{r + 1}</th>
              {row.map((val, c) => {
                const key = `${r}:${c}`;
                if (grid.mergeCovered.has(key)) return null;
                const span = grid.mergeMap.get(key);
                return (
                  <td
                    key={c}
                    rowSpan={span?.rowSpan}
                    colSpan={span?.colSpan}
                    className="border border-[#e0e0e0] px-1.5 py-1 text-[11px] text-[#1a1a1a] align-top whitespace-pre-wrap break-words"
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

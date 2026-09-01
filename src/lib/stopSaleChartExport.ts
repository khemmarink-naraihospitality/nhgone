// Builds the "Stop Sale Chart" workbook - the same document properties have
// historically kept by hand in a per-property Excel file (one sheet per
// month, categories down the side, days across, colour-coded X/o marks).
// The data comes straight from the Occupancy By Type Calendar's own
// already-computed cell states (see revenue/page.tsx's `dayState`), never
// re-derived here, so an export can never disagree with what's on screen.
//
// Uses exceljs rather than the `xlsx` package already in this repo:
// `xlsx`'s free/community build can only WRITE plain values (column widths,
// merges, number formats) - cell fills, fonts and borders are read-only on
// that side. exceljs supports full styled writes and is what actually
// produces the coloured cells this chart needs.
import ExcelJS from "exceljs";

export type StopSaleState = "none" | "new-stop" | "existing-stop" | "reopen";

export interface StopSaleDayCell {
  day: number;
  /** false for a day that doesn't exist in this month (e.g. 30 Feb) - rendered as a solid black column, matching the source spreadsheet. */
  exists: boolean;
  state: StopSaleState;
}

export interface StopSaleCategoryLine {
  /** short_name || name - the row label, e.g. "COM" or "Comfy". */
  label: string;
  cells: StopSaleDayCell[];
}

export interface StopSaleMonthSection {
  key: string;
  /** e.g. "AUGUST 2026" */
  label: string;
  daysInMonth: number;
  categories: StopSaleCategoryLine[];
}

export interface StopSaleChartData {
  propertyName: string;
  /** Already formatted, e.g. "25/08/2026". */
  reportAsOf: string;
  months: StopSaleMonthSection[];
}

const DAY_COLS = 31;

// ARGB hex - exceljs wants 8 hex chars, alpha first.
const COLOR = {
  headerBg: "FF1F3864",
  headerText: "FFFFFFFF",
  reportAsOfLabel: "FFC00000",
  reportAsOfBg: "FFFFFF00",
  monthBandBg: "FFD9E2F3",
  dateRowBg: "FFDCE6F1",
  newStopBg: "FFFFFF00",
  newStopText: "FFC00000",
  reopenBg: "FF22D3EE",
  reopenText: "FF063B4A",
  extraBedLabel: "FFC00000",
  blackCell: "FF000000",
  gridLine: "FF808080",
} as const;

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLOR.gridLine } },
  bottom: { style: "thin", color: { argb: COLOR.gridLine } },
  left: { style: "thin", color: { argb: COLOR.gridLine } },
  right: { style: "thin", color: { argb: COLOR.gridLine } },
};

function fill(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** Cell for a single day of a category row, or the blank/manual Extra Bed row. */
function styleDayCell(cell: ExcelJS.Cell, day: StopSaleDayCell) {
  cell.border = thinBorder;
  cell.alignment = { horizontal: "center", vertical: "middle" };
  if (!day.exists) {
    cell.fill = fill(COLOR.blackCell);
    return;
  }
  if (day.state === "existing-stop") {
    cell.value = "X";
    cell.font = { bold: true, color: { argb: "FF000000" } };
  } else if (day.state === "new-stop") {
    cell.value = "X";
    cell.fill = fill(COLOR.newStopBg);
    cell.font = { bold: true, color: { argb: COLOR.newStopText } };
  } else if (day.state === "reopen") {
    cell.value = "o";
    cell.fill = fill(COLOR.reopenBg);
    cell.font = { bold: true, color: { argb: COLOR.reopenText } };
  }
}

export function buildStopSaleWorkbook(data: StopSaleChartData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NHGOne";
  wb.created = new Date();
  const ws = wb.addWorksheet("Stop Sale Chart", {
    views: [{ state: "frozen", ySplit: 0, xSplit: 1 }],
  });

  ws.getColumn(1).width = 20;
  for (let c = 2; c <= DAY_COLS + 1; c++) ws.getColumn(c).width = 3.6;

  let row = 1;

  // "STOP SALE CHART : <Property>"
  ws.mergeCells(row, 1, row, DAY_COLS + 1);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = `STOP SALE CHART :   ${data.propertyName}`;
  titleCell.fill = fill(COLOR.headerBg);
  titleCell.font = { bold: true, size: 12, color: { argb: COLOR.headerText } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(row).height = 22;
  row++;

  // "Report as of : <date>" - label plain/red, date value yellow-filled.
  const asOfLabel = ws.getCell(row, 1);
  asOfLabel.value = "Report as of :";
  asOfLabel.font = { bold: true, color: { argb: COLOR.reportAsOfLabel } };
  const asOfValue = ws.getCell(row, 2);
  asOfValue.value = data.reportAsOf;
  asOfValue.fill = fill(COLOR.reportAsOfBg);
  asOfValue.font = { bold: true, color: { argb: "FF000000" } };
  asOfValue.alignment = { horizontal: "left" };
  row += 2;

  for (const month of data.months) {
    // Month title band, merged across the label column + all 31 day columns.
    ws.mergeCells(row, 1, row, DAY_COLS + 1);
    const monthCell = ws.getCell(row, 1);
    monthCell.value = month.label;
    monthCell.fill = fill(COLOR.monthBandBg);
    monthCell.font = { bold: true, size: 11 };
    monthCell.alignment = { horizontal: "center", vertical: "middle" };
    monthCell.border = thinBorder;
    row++;

    // Date row: label + day numbers 1..31, blacked out past daysInMonth.
    const dateLabel = ws.getCell(row, 1);
    dateLabel.value = "Date";
    dateLabel.fill = fill(COLOR.dateRowBg);
    dateLabel.font = { bold: true };
    dateLabel.border = thinBorder;
    for (let d = 1; d <= DAY_COLS; d++) {
      const c = ws.getCell(row, d + 1);
      c.border = thinBorder;
      c.alignment = { horizontal: "center" };
      if (d <= month.daysInMonth) {
        c.value = d;
        c.fill = fill(COLOR.dateRowBg);
        c.font = { bold: true };
      } else {
        c.fill = fill(COLOR.blackCell);
      }
    }
    row++;

    // One row per (filtered) category.
    for (const cat of month.categories) {
      const labelCell = ws.getCell(row, 1);
      labelCell.value = cat.label;
      labelCell.font = { bold: true };
      labelCell.border = thinBorder;
      for (let d = 1; d <= DAY_COLS; d++) {
        const dayCell = cat.cells[d - 1] ?? { day: d, exists: false, state: "none" as const };
        styleDayCell(ws.getCell(row, d + 1), dayCell);
      }
      row++;
    }

    // Extra Bed - not a MEWS room category, so NHGOne has no stop-sale data
    // for it at all (confirmed against Marasca's real 10 categories, none
    // named Extra Bed). Every month gets the same blank, borderd row rather
    // than the source file's inconsistent mix of a labelled row some months
    // and a coloured Date-row band other months - one consistent shape is
    // easier to fill in by hand than two different conventions.
    const extraLabel = ws.getCell(row, 1);
    extraLabel.value = "EXTRA BED";
    extraLabel.font = { bold: true, color: { argb: COLOR.extraBedLabel } };
    extraLabel.border = thinBorder;
    for (let d = 1; d <= DAY_COLS; d++) {
      const c = ws.getCell(row, d + 1);
      c.border = thinBorder;
      if (d > month.daysInMonth) c.fill = fill(COLOR.blackCell);
    }
    row++;

    row++; // spacer between months
  }

  // Remark / legend block.
  const remarkHeader = ws.getCell(row, 1);
  remarkHeader.value = "Remark";
  remarkHeader.font = { bold: true, underline: true };
  row++;

  const legend: { bg?: string; textArgb: string; symbol: string; label: string }[] = [
    { bg: COLOR.newStopBg, textArgb: COLOR.newStopText, symbol: "X", label: "New Stop Sales" },
    { textArgb: "FF000000", symbol: "X", label: "Existing Stop Sales" },
    { bg: COLOR.reopenBg, textArgb: COLOR.reopenText, symbol: "o", label: "Re-open" },
    { textArgb: COLOR.extraBedLabel, symbol: "", label: "Extra Bed Stop Sale — not tracked in MEWS; fill in by hand" },
  ];
  for (const item of legend) {
    const swatch = ws.getCell(row, 1);
    swatch.value = item.symbol;
    swatch.alignment = { horizontal: "center" };
    swatch.border = thinBorder;
    if (item.bg) swatch.fill = fill(item.bg);
    swatch.font = { bold: true, color: { argb: item.textArgb } };
    const labelCell = ws.getCell(row, 2);
    labelCell.value = item.label;
    ws.mergeCells(row, 2, row, 8);
    row++;
  }

  return wb;
}

export async function downloadStopSaleXlsx(data: StopSaleChartData): Promise<void> {
  const wb = buildStopSaleWorkbook(data);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `StopSaleChart_${data.propertyName.replace(/\s+/g, "")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The label column plus 31 day columns - shared with the print view so the
// two layouts can't drift apart on column count.
export const STOP_SALE_DAY_COLUMNS = DAY_COLS;

import type { OshFormItem, OshHeader } from "./defaults";

/**
 * Fills an OSH report template's {{Variables}} with one report's values -
 * the prototype's generateReportHTML, used by three callers that must never
 * disagree: the Report page's "View Custom PDF", Setting > Report Templates'
 * live preview, and the HTML file emailed on submit (rendered here, in the
 * browser, and sent to the backend as-is - see api/app/routers/osh.py).
 *
 * Two corrections to the prototype, both deliberate:
 *
 * - Its status/sub-status replacement had lost its `${...}` in the copy it
 *   was shipped in (`<span style="color:{item.status || '-'}</span>` - an
 *   unclosed attribute and no colour), so every status rendered as broken
 *   markup. Restored to what the surrounding code plainly meant: the value,
 *   in its status colour, bold.
 * - Every value is HTML-escaped. The prototype inserted them raw, and this
 *   output goes through dangerouslySetInnerHTML and into an email - an action
 *   plan containing "<" would have broken the page, and one containing a tag
 *   would have run it.
 *
 * Replacement is literal (split/join), not a RegExp built from the item code,
 * so a code containing a regex metacharacter can't break it.
 */

export interface OshRenderable {
  header: OshHeader;
  items: OshFormItem[];
  score: number | string;
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const replaceAll = (text: string, token: string, value: string) => text.split(token).join(value);

export const statusColor = (status: string): string => {
  if (status === "Compliant") return "#059669";
  if (status === "Non-compliant") return "#dc2626";
  if (status === "Observation") return "#d97706";
  return "#333";
};

export const subStatusColor = (subStatus: string): string => {
  if (subStatus === "Done") return "#059669";
  if (subStatus === "Hold" || subStatus === "Not Started") return "#dc2626";
  if (subStatus === "Working on it") return "#d97706";
  return "#333";
};

export function renderReportHTML(template: string, report: OshRenderable): string {
  let html = template || "";
  html = replaceAll(html, "{{PropertyName}}", escapeHtml(report.header.propertyName));
  html = replaceAll(html, "{{Date}}", escapeHtml(report.header.date));
  html = replaceAll(html, "{{Year}}", escapeHtml(report.header.year));
  html = replaceAll(html, "{{Period}}", escapeHtml(report.header.period));
  html = replaceAll(html, "{{Operator}}", escapeHtml(report.header.operatorName));
  html = replaceAll(html, "{{Score}}", escapeHtml(report.score || "0"));

  for (const item of report.items) {
    html = replaceAll(
      html,
      `{{${item.code}_Status}}`,
      `<span style="color:${statusColor(item.status)}; font-weight:bold;">${escapeHtml(item.status || "-")}</span>`,
    );
    html = replaceAll(
      html,
      `{{${item.code}_SubStatus}}`,
      `<span style="color:${subStatusColor(item.subStatus)}; font-weight:bold;">${escapeHtml(item.subStatus || "-")}</span>`,
    );
    html = replaceAll(html, `{{${item.code}_Plan}}`, escapeHtml(item.actionPlan || "-"));
    html = replaceAll(
      html,
      `{{${item.code}_Photo}}`,
      item.photo
        ? `<img src="${escapeHtml(item.photo)}" style="width: 100%; max-width: 100px; height: auto; border-radius: 4px; border: 1px solid #ccc; margin: 0 auto; display: block;" />`
        : "-",
    );
  }
  return html;
}

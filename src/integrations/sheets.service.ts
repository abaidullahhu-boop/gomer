import { Injectable, Logger } from '@nestjs/common';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/** A cell as we write it. Nulls become blanks rather than the string "null". */
export type CellValue = string | number | null;

/** A table ready for the sheet: one header row plus the data beneath it. */
export interface ExportTable {
  headers: string[];
  rows: CellValue[][];
}

/** Where a table is written. A missing spreadsheet is created from the title. */
export interface SheetDestination {
  /** Existing spreadsheet to append to; omit to create a new one. */
  spreadsheetId?: string | null;
  /** Title for the spreadsheet when one has to be created. */
  spreadsheetTitle?: string | null;
  /** The tab written to; created if the spreadsheet doesn't have it. */
  sheetTitle: string;
}

export interface SheetWriteResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  sheetTitle: string;
  rowsAppended: number;
  /** True when this write also laid down the header row (first write to the tab). */
  headerWritten: boolean;
  /** True when this write created the spreadsheet. */
  spreadsheetCreated: boolean;
}

/** The spreadsheet metadata fields we read back. */
interface SpreadsheetMeta {
  spreadsheetId: string;
  spreadsheetUrl?: string;
  sheets?: Array<{ properties?: { title?: string } }>;
}

/**
 * A thin client for the Google Sheets API v4, used by the export automation to
 * write Gomer's own reporting data into a spreadsheet. Stateless in the same way
 * as {@link MetaAdsService} and {@link StripeService}: the caller passes the
 * OAuth access token resolved from the workspace's Pipedream-connected Google
 * Sheets account.
 *
 * This exists rather than driving Pipedream's Google Sheets MCP tools because an
 * export must be deterministic and runnable with no model in the loop — a
 * scheduled export fires at 2am with nobody to correct a misapplied tool call.
 */
@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  /**
   * Write a table to its destination: create the spreadsheet if needed, create
   * the tab if needed, lay down headers on a fresh tab, then append the rows.
   * A table with no rows still resolves its destination and writes headers, so a
   * scheduled export with nothing new to say leaves a usable sheet behind.
   */
  async writeTable(
    accessToken: string,
    destination: SheetDestination,
    table: ExportTable,
  ): Promise<SheetWriteResult> {
    let spreadsheetId = destination.spreadsheetId ?? null;
    let spreadsheetUrl: string | null = null;
    let spreadsheetCreated = false;

    if (!spreadsheetId) {
      const created = await this.createSpreadsheet(
        accessToken,
        destination.spreadsheetTitle?.trim() || 'Gomer export',
        destination.sheetTitle,
      );
      spreadsheetId = created.spreadsheetId;
      spreadsheetUrl = created.spreadsheetUrl;
      spreadsheetCreated = true;
    }

    const meta = await this.getSpreadsheet(accessToken, spreadsheetId);
    spreadsheetUrl = meta.spreadsheetUrl ?? spreadsheetUrl ?? this.urlFor(spreadsheetId);

    const existingTitles = (meta.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title));
    if (!existingTitles.includes(destination.sheetTitle)) {
      await this.addSheet(accessToken, spreadsheetId, destination.sheetTitle);
    }

    // Headers go in only once per tab, so appending to an established sheet
    // doesn't interleave header rows through the data.
    const headerWritten = !(await this.hasContent(
      accessToken,
      spreadsheetId,
      destination.sheetTitle,
    ));
    const values = headerWritten ? [table.headers, ...table.rows] : table.rows;
    if (values.length) {
      await this.append(accessToken, spreadsheetId, destination.sheetTitle, values);
    }

    return {
      spreadsheetId,
      spreadsheetUrl,
      sheetTitle: destination.sheetTitle,
      rowsAppended: table.rows.length,
      headerWritten,
      spreadsheetCreated,
    };
  }

  /** Create a spreadsheet whose first tab carries the requested title. */
  async createSpreadsheet(
    accessToken: string,
    title: string,
    sheetTitle: string,
  ): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
    const body = await this.request<SpreadsheetMeta>('', accessToken, {
      method: 'POST',
      body: {
        properties: { title },
        sheets: [{ properties: { title: sheetTitle } }],
      },
    });
    return {
      spreadsheetId: body.spreadsheetId,
      spreadsheetUrl: body.spreadsheetUrl ?? this.urlFor(body.spreadsheetId),
    };
  }

  /** Spreadsheet metadata: its URL and the titles of its tabs. */
  private getSpreadsheet(accessToken: string, spreadsheetId: string): Promise<SpreadsheetMeta> {
    return this.request<SpreadsheetMeta>(
      `/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,sheets.properties.title`,
      accessToken,
    );
  }

  /** Add a tab to an existing spreadsheet. */
  private async addSheet(
    accessToken: string,
    spreadsheetId: string,
    sheetTitle: string,
  ): Promise<void> {
    await this.request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, accessToken, {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
    });
  }

  /** Whether a tab already has anything in its first row. */
  private async hasContent(
    accessToken: string,
    spreadsheetId: string,
    sheetTitle: string,
  ): Promise<boolean> {
    const range = encodeURIComponent(`${this.quoteTitle(sheetTitle)}!A1:A1`);
    const body = await this.request<{ values?: unknown[][] }>(
      `/${encodeURIComponent(spreadsheetId)}/values/${range}`,
      accessToken,
    );
    return Boolean(body.values?.length);
  }

  /** Append rows below whatever the tab already holds. */
  private async append(
    accessToken: string,
    spreadsheetId: string,
    sheetTitle: string,
    values: CellValue[][],
  ): Promise<void> {
    const range = encodeURIComponent(`${this.quoteTitle(sheetTitle)}!A1`);
    await this.request(
      `/${encodeURIComponent(spreadsheetId)}/values/${range}:append` +
        '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      accessToken,
      {
        method: 'POST',
        body: { values: values.map((row) => row.map((cell) => cell ?? '')) },
      },
    );
  }

  /** A1 notation quotes a tab title with `'`, escaping any it contains. */
  private quoteTitle(title: string): string {
    return `'${title.replace(/'/g, "''")}'`;
  }

  private urlFor(spreadsheetId: string): string {
    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  }

  /**
   * Issue a request against the Sheets API, translating Google's error envelope
   * into a thrown Error the caller can surface. Scope problems land here as
   * 403s, which is the common failure when the connected Google account granted
   * read-only access.
   */
  private async request<T>(
    path: string,
    accessToken: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    const res = await fetch(`${SHEETS_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; status?: string };
    } & Record<string, unknown>;
    if (!res.ok || body.error) {
      const message = body.error?.message ?? `Google Sheets API error (HTTP ${res.status})`;
      this.logger.warn(
        `Sheets ${options.method ?? 'GET'} ${path.split('?')[0]} failed: ${message}`,
      );
      throw new Error(message);
    }
    return body as T;
  }
}

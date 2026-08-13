import { Injectable, Logger } from '@nestjs/common';
import { PipedreamService } from './pipedream.service';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * The connected Google Sheets account a call is made on behalf of. Every request
 * goes through the Pipedream Connect proxy, which attaches that account's
 * credentials and refreshes them — so no Google token is ever held here.
 */
export interface SheetsCredential {
  externalUserId: string;
  accountId: string;
}

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
 * {@link SheetsCredential} resolved from the workspace's connected account.
 *
 * Every request goes through the Pipedream Connect proxy. Pipedream is the
 * integration layer of record, so it owns the Google credential and its refresh
 * — there is deliberately no direct-to-Google path holding a token of our own.
 *
 * The calls are made here rather than through Pipedream's Google Sheets MCP
 * tools because an export must be deterministic and runnable with no model in
 * the loop — a scheduled export fires at 2am with nobody to correct a misapplied
 * tool call. The proxy gives us Pipedream's credential handling without handing
 * the sequence of calls to a model.
 */
@Injectable()
export class SheetsService {
  private readonly logger = new Logger(SheetsService.name);

  constructor(private readonly pipedream: PipedreamService) {}

  /**
   * Write a table to its destination: create the spreadsheet if needed, create
   * the tab if needed, lay down headers on a fresh tab, then append the rows.
   * A table with no rows still resolves its destination and writes headers, so a
   * scheduled export with nothing new to say leaves a usable sheet behind.
   */
  async writeTable(
    credential: SheetsCredential,
    destination: SheetDestination,
    table: ExportTable,
  ): Promise<SheetWriteResult> {
    let spreadsheetId = destination.spreadsheetId ?? null;
    let spreadsheetUrl: string | null = null;
    let spreadsheetCreated = false;

    if (!spreadsheetId) {
      const created = await this.createSpreadsheet(
        credential,
        destination.spreadsheetTitle?.trim() || 'Gomer export',
        destination.sheetTitle,
      );
      spreadsheetId = created.spreadsheetId;
      spreadsheetUrl = created.spreadsheetUrl;
      spreadsheetCreated = true;
    }

    const meta = await this.getSpreadsheet(credential, spreadsheetId);
    spreadsheetUrl = meta.spreadsheetUrl ?? spreadsheetUrl ?? this.urlFor(spreadsheetId);

    const existingTitles = (meta.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title));
    if (!existingTitles.includes(destination.sheetTitle)) {
      await this.addSheet(credential, spreadsheetId, destination.sheetTitle);
    }

    // Headers go in only once per tab, so appending to an established sheet
    // doesn't interleave header rows through the data.
    const headerWritten = !(await this.hasContent(
      credential,
      spreadsheetId,
      destination.sheetTitle,
    ));
    const values = headerWritten ? [table.headers, ...table.rows] : table.rows;
    if (values.length) {
      await this.append(credential, spreadsheetId, destination.sheetTitle, values);
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
    credential: SheetsCredential,
    title: string,
    sheetTitle: string,
  ): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
    const body = await this.request<SpreadsheetMeta>('', credential, {
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
  private getSpreadsheet(
    credential: SheetsCredential,
    spreadsheetId: string,
  ): Promise<SpreadsheetMeta> {
    return this.request<SpreadsheetMeta>(
      `/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,sheets.properties.title`,
      credential,
    );
  }

  /** Add a tab to an existing spreadsheet. */
  private async addSheet(
    credential: SheetsCredential,
    spreadsheetId: string,
    sheetTitle: string,
  ): Promise<void> {
    await this.request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, credential, {
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: sheetTitle } } }] },
    });
  }

  /** Whether a tab already has anything in its first row. */
  private async hasContent(
    credential: SheetsCredential,
    spreadsheetId: string,
    sheetTitle: string,
  ): Promise<boolean> {
    const range = encodeURIComponent(`${this.quoteTitle(sheetTitle)}!A1:A1`);
    const body = await this.request<{ values?: unknown[][] }>(
      `/${encodeURIComponent(spreadsheetId)}/values/${range}`,
      credential,
    );
    return Boolean(body.values?.length);
  }

  /** Append rows below whatever the tab already holds. */
  private async append(
    credential: SheetsCredential,
    spreadsheetId: string,
    sheetTitle: string,
    values: CellValue[][],
  ): Promise<void> {
    const range = encodeURIComponent(`${this.quoteTitle(sheetTitle)}!A1`);
    await this.request(
      `/${encodeURIComponent(spreadsheetId)}/values/${range}:append` +
        '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
      credential,
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
   * Issue a request against the Sheets API through the Pipedream Connect proxy,
   * which attaches the connected account's credentials. Pipedream raises a
   * non-2xx from Google as a thrown error carrying Google's own message; a
   * proxied 200 can still wrap an error envelope, so both are normalised into
   * one thrown Error. Scope problems arrive as 403s — the common failure when
   * the connected Google account granted read-only access.
   */
  private async request<T>(
    path: string,
    credential: SheetsCredential,
    options: { method?: 'GET' | 'POST'; body?: Record<string, unknown> } = {},
  ): Promise<T> {
    const method = options.method ?? 'GET';
    try {
      const response = await this.pipedream.proxyRequest<
        { error?: { message?: string } } & Record<string, unknown>
      >(credential, { url: `${SHEETS_BASE}${path}`, method, body: options.body });
      if (response?.error) {
        throw new Error(response.error.message ?? 'Google Sheets API error');
      }
      return response as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Sheets ${method} ${path.split('?')[0]} failed: ${message}`);
      throw error instanceof Error ? error : new Error(message);
    }
  }
}

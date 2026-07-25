/*
 * importer.js — 既存アプリのデータ移行 (CSV / JSON) を担う
 *
 * CSV や JSON を読み込み、列の型を自動判定して SQLite テーブルを
 * 自動生成 (または既存テーブルへ追記) する。日本語の列名・BOM・
 * ダブルクオート内改行にも対応する。
 */

const Importer = (() => {
  "use strict";

  /* ---------------------------------------------------------------- */
  /* CSV パース                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * CSV 文字列を 2 次元配列にパースする。
   * RFC 4180 準拠 (クオート内のカンマ・改行・エスケープ "" に対応)。
   * 区切り文字はカンマ / タブを自動判定する。
   */
  function parseCSV(text) {
    // BOM 除去
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const delimiter = detectDelimiter(text);
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          field += c;
          i++;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
          i++;
        } else if (c === delimiter) {
          row.push(field);
          field = "";
          i++;
        } else if (c === "\r") {
          i++; // CRLF の CR を無視
        } else if (c === "\n") {
          row.push(field);
          rows.push(row);
          field = "";
          row = [];
          i++;
        } else {
          field += c;
          i++;
        }
      }
    }
    // 末尾の残り
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    // 完全な空行を除去
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  }

  function detectDelimiter(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const commas = (firstLine.match(/,/g) || []).length;
    const tabs = (firstLine.match(/\t/g) || []).length;
    return tabs > commas ? "\t" : ",";
  }

  /**
   * CSV テキストを {headers, rows(オブジェクト配列)} に変換する。
   */
  function csvToRecords(text) {
    const matrix = parseCSV(text);
    if (!matrix.length) return { headers: [], rows: [] };
    const headers = matrix[0].map((h, idx) => h.trim() || `col_${idx + 1}`);
    const rows = matrix.slice(1).map((cells) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cells[idx] !== undefined ? cells[idx] : "";
      });
      return obj;
    });
    return { headers, rows };
  }

  /**
   * JSON テキストを {headers, rows} に変換する。
   * 受け付ける形式: オブジェクト配列、または {データ名: [...]} のラップ。
   */
  function jsonToRecords(text) {
    let data = JSON.parse(text);
    if (!Array.isArray(data)) {
      // オブジェクトの場合、最初の配列プロパティを採用する
      const arrKey = Object.keys(data).find((k) => Array.isArray(data[k]));
      if (arrKey) data = data[arrKey];
      else data = [data]; // 単一オブジェクト
    }
    // 全行のキーの和集合をヘッダとする (行ごとにキーが欠けても対応)
    const headerSet = [];
    const seen = new Set();
    data.forEach((obj) => {
      if (obj && typeof obj === "object") {
        Object.keys(obj).forEach((k) => {
          if (!seen.has(k)) {
            seen.add(k);
            headerSet.push(k);
          }
        });
      }
    });
    const rows = data.map((obj) => {
      const flat = {};
      headerSet.forEach((h) => {
        let v = obj ? obj[h] : undefined;
        // ネストしたオブジェクト / 配列は JSON 文字列として格納
        if (v !== null && typeof v === "object") v = JSON.stringify(v);
        flat[h] = v === undefined ? null : v;
      });
      return flat;
    });
    return { headers: headerSet, rows };
  }

  /* ---------------------------------------------------------------- */
  /* 型推論                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * サンプル値の並びから SQLite の型 (INTEGER / REAL / TEXT) を推論する。
   */
  function inferType(values) {
    let sawValue = false;
    let allInt = true;
    let allNum = true;
    for (const raw of values) {
      if (raw === null || raw === undefined || String(raw).trim() === "")
        continue;
      sawValue = true;
      const s = String(raw).trim();
      if (!/^[+-]?\d+$/.test(s)) allInt = false;
      // 数値 (小数・指数含む)。先頭ゼロの連番 (例: 電話番号 0120) は
      // TEXT として扱いたいので、先頭 0 かつ 2 桁以上は数値扱いしない。
      const isNum = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s);
      const leadingZero = /^0\d+/.test(s);
      if (!isNum || leadingZero) allNum = false;
    }
    if (!sawValue) return "TEXT";
    if (allInt && allNum) return "INTEGER";
    if (allNum) return "REAL";
    return "TEXT";
  }

  /**
   * データ全体の各列について型を推論する。
   */
  function inferSchema(headers, rows) {
    return headers.map((h) => ({
      name: h,
      column: sanitizeColumn(h),
      type: inferType(rows.map((r) => r[h])),
    }));
  }

  /* ---------------------------------------------------------------- */
  /* 名前のサニタイズ                                                  */
  /* ---------------------------------------------------------------- */

  /** テーブル名を安全な識別子に整える (日本語はそのまま許容)。 */
  function sanitizeTable(name) {
    let s = String(name || "").trim();
    s = s.replace(/[^\w　-鿿＀-￯ー]/g, "_");
    if (!s) s = "table_1";
    if (/^\d/.test(s)) s = "t_" + s;
    return s;
  }

  /** 列名を安全な識別子に整える。 */
  function sanitizeColumn(name) {
    let s = String(name || "").trim();
    s = s.replace(/[^\w　-鿿＀-￯ー]/g, "_");
    if (!s) s = "col";
    if (/^\d/.test(s)) s = "c_" + s;
    return s;
  }

  function quoteIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
  }

  /* ---------------------------------------------------------------- */
  /* テーブル生成 & 取込                                               */
  /* ---------------------------------------------------------------- */

  /**
   * データを SQLite テーブルへ取り込む。
   *
   * @param {Object} opts
   * @param {string} opts.table     取込先テーブル名
   * @param {Array}  opts.schema    inferSchema() の結果 (列定義)
   * @param {Array}  opts.rows      取込む行 (オブジェクト配列)
   * @param {"create"|"replace"|"append"} opts.mode  取込モード
   * @param {boolean} opts.addId    先頭に自動採番 id を付与するか
   * @returns {{table: string, inserted: number}}
   */
  function importRecords(opts) {
    const table = sanitizeTable(opts.table);
    const schema = opts.schema;
    const rows = opts.rows;
    const mode = opts.mode || "create";
    const addId = opts.addId !== false;

    const exists = Database.listTables().includes(table);

    if (mode === "replace" && exists) {
      Database.run(`DROP TABLE ${quoteIdent(table)}`);
    }

    if (mode !== "append" || !exists) {
      const cols = [];
      if (addId) cols.push(`"id" INTEGER PRIMARY KEY AUTOINCREMENT`);
      schema.forEach((c) => {
        cols.push(`${quoteIdent(c.column)} ${c.type}`);
      });
      // 移行元の追跡用メタ列
      cols.push(`"_取込日時" TEXT`);
      Database.run(
        `CREATE TABLE ${quoteIdent(table)} (\n  ${cols.join(",\n  ")}\n)`
      );
    }

    // バルク INSERT (トランザクションで高速化)
    const colNames = schema.map((c) => c.column);
    const placeholders = colNames.map(() => "?").concat("?").join(", ");
    const insertSQL =
      `INSERT INTO ${quoteIdent(table)} ` +
      `(${colNames.map(quoteIdent).join(", ")}, "_取込日時") ` +
      `VALUES (${placeholders})`;

    const now = new Date().toISOString();
    let inserted = 0;

    Database.run("BEGIN TRANSACTION");
    try {
      for (const row of rows) {
        const params = schema.map((c) => normalizeValue(row[c.name], c.type));
        params.push(now);
        Database.run(insertSQL, params);
        inserted++;
      }
      Database.run("COMMIT");
    } catch (e) {
      Database.run("ROLLBACK");
      throw e;
    }

    return { table, inserted };
  }

  /** 推論した型に合わせて値を正規化する。 */
  function normalizeValue(v, type) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === "") return null;
    if (type === "INTEGER") {
      const n = parseInt(s, 10);
      return Number.isNaN(n) ? s : n;
    }
    if (type === "REAL") {
      const n = parseFloat(s);
      return Number.isNaN(n) ? s : n;
    }
    return v;
  }

  return {
    parseCSV,
    csvToRecords,
    jsonToRecords,
    inferType,
    inferSchema,
    sanitizeTable,
    sanitizeColumn,
    importRecords,
  };
})();

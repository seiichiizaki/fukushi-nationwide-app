/*
 * db.js — SQLite (sql.js / WASM) データベースラッパー
 *
 * 完全オフライン動作を前提とし、WASM バイナリはローカル同梱ファイル
 * (vendor/sql-wasm.wasm) を読み込む。インターネット接続は一切不要。
 *
 * 永続化は 2 系統:
 *   1) IndexedDB への自動保存 — ブラウザを閉じてもデータが残る
 *   2) .sqlite ファイルのエクスポート / インポート — バックアップ・端末間移送用
 */

const Database = (() => {
  "use strict";

  const IDB_NAME = "fukushi-db";
  const IDB_STORE = "sqlite";
  const IDB_KEY = "main";

  let SQL = null; // sql.js モジュール
  let db = null; // 現在の Database インスタンス
  let dirty = false; // 未保存の変更があるか
  const listeners = new Set(); // 変更通知リスナ

  /* ---------------------------------------------------------------- */
  /* 初期化                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * sql.js を初期化する。WASM はローカル同梱ファイルから読み込む。
   */
  async function initSqlJs() {
    if (SQL) return SQL;
    const config = {
      // locateFile: HTTP 配信時に WASM をローカル vendor から解決する。
      // (CDN には一切依存しない)
      locateFile: (file) => "vendor/" + file,
    };
    // file:// でダブルクリック起動した場合、ブラウザは fetch/XHR を
    // ブロックするため WASM を取得できない。そこで base64 埋め込み
    // (vendor/sql-wasm-data.js) があれば、それをデコードして
    // wasmBinary として直接渡す。これにより fetch 不要で起動できる。
    if (window.SQL_WASM_BASE64) {
      config.wasmBinary = base64ToBytes(window.SQL_WASM_BASE64);
    }
    // initSqlJs はグローバル (vendor/sql-wasm.js が定義)
    SQL = await window.initSqlJs(config);
    return SQL;
  }

  /** base64 文字列を Uint8Array に変換する。 */
  function base64ToBytes(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  /**
   * データベースを起動する。IndexedDB に保存済みデータがあれば復元し、
   * なければ空の新規データベースを作成する。
   */
  async function boot() {
    await initSqlJs();
    const saved = await idbLoad();
    if (saved) {
      db = new SQL.Database(new Uint8Array(saved));
    } else {
      db = new SQL.Database();
    }
    dirty = false;
    return db;
  }

  /* ---------------------------------------------------------------- */
  /* クエリ実行                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * SELECT 系クエリを実行し、結果を配列で返す。
   * @returns {Array<{columns: string[], values: any[][]}>}
   */
  function exec(sql, params) {
    ensureOpen();
    if (params && params.length) {
      const stmt = db.prepare(sql);
      const rows = [];
      stmt.bind(params);
      let columns = null;
      while (stmt.step()) {
        if (!columns) columns = stmt.getColumnNames();
        rows.push(stmt.get());
      }
      stmt.free();
      return columns ? [{ columns, values: rows }] : [];
    }
    return db.exec(sql);
  }

  /**
   * INSERT / UPDATE / DELETE / DDL を実行する。変更フラグを立てる。
   */
  function run(sql, params) {
    ensureOpen();
    db.run(sql, params || []);
    markDirty();
  }

  /**
   * SELECT を実行し、行をオブジェクト配列 [{col: val, ...}] で返す。
   */
  function query(sql, params) {
    const res = exec(sql, params);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => {
      const obj = {};
      columns.forEach((c, i) => (obj[c] = row[i]));
      return obj;
    });
  }

  /**
   * 単一の値を返す SELECT のショートカット。
   */
  function scalar(sql, params) {
    const res = exec(sql, params);
    if (!res.length || !res[0].values.length) return null;
    return res[0].values[0][0];
  }

  /* ---------------------------------------------------------------- */
  /* スキーマ情報                                                      */
  /* ---------------------------------------------------------------- */

  /** ユーザー定義テーブル名の一覧を返す。 */
  function listTables() {
    return query(
      "SELECT name FROM sqlite_master WHERE type='table' " +
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).map((r) => r.name);
  }

  /** 指定テーブルのカラム定義を返す。 */
  function tableInfo(table) {
    return query(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
  }

  /** 指定テーブルの行数を返す。 */
  function countRows(table) {
    return scalar(`SELECT COUNT(*) FROM "${table.replace(/"/g, '""')}"`);
  }

  /* ---------------------------------------------------------------- */
  /* 永続化 — IndexedDB 自動保存                                       */
  /* ---------------------------------------------------------------- */

  /** 現在のデータベースを Uint8Array にシリアライズする。 */
  function serialize() {
    ensureOpen();
    return db.export();
  }

  /** IndexedDB へ保存する。 */
  async function persist() {
    const bytes = serialize();
    await idbSave(bytes);
    dirty = false;
    notify();
    return bytes.length;
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSave(bytes) {
    const conn = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(bytes, IDB_KEY);
      tx.oncomplete = () => {
        conn.close();
        resolve();
      };
      tx.onerror = () => {
        conn.close();
        reject(tx.error);
      };
    });
  }

  async function idbLoad() {
    const conn = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => {
        conn.close();
        resolve(req.result || null);
      };
      req.onerror = () => {
        conn.close();
        reject(req.error);
      };
    });
  }

  async function idbClear() {
    const conn = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => {
        conn.close();
        resolve();
      };
      tx.onerror = () => {
        conn.close();
        reject(tx.error);
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* 永続化 — .sqlite ファイル入出力                                   */
  /* ---------------------------------------------------------------- */

  /** 現在のデータベースを .sqlite ファイルとしてダウンロードさせる。 */
  function downloadFile(filename) {
    const bytes = serialize();
    const blob = new Blob([bytes], { type: "application/x-sqlite3" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || defaultFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function defaultFilename() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const ts =
      `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `_${p(d.getHours())}${p(d.getMinutes())}`;
    return `fukushi_db_${ts}.sqlite`;
  }

  /** アップロードされた .sqlite ファイル (ArrayBuffer) を読み込み置き換える。 */
  async function loadFromBuffer(arrayBuffer) {
    await initSqlJs();
    if (db) db.close();
    db = new SQL.Database(new Uint8Array(arrayBuffer));
    markDirty();
    await persist();
  }

  /* ---------------------------------------------------------------- */
  /* データベース全消去                                                */
  /* ---------------------------------------------------------------- */

  async function reset() {
    await initSqlJs();
    if (db) db.close();
    db = new SQL.Database();
    await idbClear();
    dirty = false;
    notify();
  }

  /* ---------------------------------------------------------------- */
  /* 変更通知                                                          */
  /* ---------------------------------------------------------------- */

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }

  function markDirty() {
    dirty = true;
    notify();
  }

  function isDirty() {
    return dirty;
  }

  /* ---------------------------------------------------------------- */
  /* ヘルパ                                                            */
  /* ---------------------------------------------------------------- */

  function ensureOpen() {
    if (!db) throw new Error("データベースが初期化されていません。");
  }

  return {
    boot,
    exec,
    run,
    query,
    scalar,
    listTables,
    tableInfo,
    countRows,
    serialize,
    persist,
    downloadFile,
    loadFromBuffer,
    reset,
    onChange,
    isDirty,
  };
})();

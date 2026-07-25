/*
 * ui.js — 画面制御
 *
 * タブ: データ移行 / テーブル閲覧 / SQL コンソール / スキーマ
 * すべてオフラインで動作する。
 */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // 現在のインポート候補データ
  let staged = null; // { headers, rows, schema, sourceName, format }

  /* ================================================================ */
  /* 起動                                                              */
  /* ================================================================ */

  async function main() {
    setStatus("データベースを起動しています…");
    try {
      await Database.boot();
    } catch (e) {
      setStatus("起動に失敗しました: " + e.message, true);
      console.error(e);
      return;
    }
    Database.onChange(refreshHeader);
    setupTabs();
    setupToolbar();
    setupImport();
    setupSql();
    refreshHeader();
    refreshBrowseTables();
    refreshSchema();
    setStatus("準備完了 — オフラインで動作しています。");
  }

  /* ================================================================ */
  /* 共通                                                              */
  /* ================================================================ */

  function setStatus(msg, isError) {
    const el = $("#status");
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }

  function refreshHeader() {
    const tables = Database.listTables();
    const total = tables.reduce((sum, t) => {
      try {
        return sum + (Database.countRows(t) || 0);
      } catch {
        return sum;
      }
    }, 0);
    $("#stat-tables").textContent = tables.length;
    $("#stat-rows").textContent = total.toLocaleString("ja-JP");
    $("#dirty-flag").hidden = !Database.isDirty();
  }

  function escapeHtml(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function nullable(v) {
    if (v === null || v === undefined)
      return '<span class="null">NULL</span>';
    return escapeHtml(v);
  }

  /* ================================================================ */
  /* タブ                                                              */
  /* ================================================================ */

  function setupTabs() {
    $$(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".tab-btn").forEach((b) => b.classList.remove("active"));
        $$(".tab-panel").forEach((p) => (p.hidden = true));
        btn.classList.add("active");
        $("#" + btn.dataset.tab).hidden = false;
        if (btn.dataset.tab === "tab-browse") refreshBrowseTables();
        if (btn.dataset.tab === "tab-schema") refreshSchema();
      });
    });
  }

  /* ================================================================ */
  /* ツールバー (保存 / 書出 / 読込 / スキーマ / 消去)                 */
  /* ================================================================ */

  function setupToolbar() {
    $("#btn-save").addEventListener("click", async () => {
      try {
        const bytes = await Database.persist();
        setStatus(`保存しました (${(bytes / 1024).toFixed(1)} KB)。`);
      } catch (e) {
        setStatus("保存に失敗: " + e.message, true);
      }
    });

    $("#btn-export").addEventListener("click", () => {
      Database.downloadFile();
      setStatus("SQLite ファイルを書き出しました。");
    });

    $("#file-open").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const buf = await file.arrayBuffer();
      try {
        await Database.loadFromBuffer(buf);
        setStatus(`「${file.name}」を読み込みました。`);
        refreshHeader();
        refreshBrowseTables();
        refreshSchema();
      } catch (err) {
        setStatus("読み込みに失敗: " + err.message, true);
      }
      e.target.value = "";
    });

    $("#btn-schema").addEventListener("click", async () => {
      if (
        !confirm(
          "福祉アプリの基本スキーマ (都道府県/事業所/利用者/職員/サービス記録) を作成し、\n" +
            "都道府県・サービス種別マスタを投入します。よろしいですか？"
        )
      )
        return;
      try {
        Schema.createBaseSchema();
        await Database.persist();
        setStatus("基本スキーマを作成しました。");
        refreshHeader();
        refreshBrowseTables();
        refreshSchema();
      } catch (e) {
        setStatus("スキーマ作成に失敗: " + e.message, true);
      }
    });

    $("#btn-reset").addEventListener("click", async () => {
      if (
        !confirm(
          "すべてのデータを消去して空のデータベースに戻します。\n" +
            "この操作は取り消せません。続行しますか？"
        )
      )
        return;
      await Database.reset();
      setStatus("データベースを初期化しました。");
      refreshHeader();
      refreshBrowseTables();
      refreshSchema();
    });
  }

  /* ================================================================ */
  /* データ移行 (Import)                                               */
  /* ================================================================ */

  function setupImport() {
    const drop = $("#drop-zone");
    const fileInput = $("#import-file");

    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    });
    drop.addEventListener("dragleave", () =>
      drop.classList.remove("dragover")
    );
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", (e) => {
      if (e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = "";
    });

    $("#btn-import-run").addEventListener("click", runImport);
    $("#btn-import-cancel").addEventListener("click", clearStaged);
  }

  async function handleFile(file) {
    const text = await file.text();
    const isJson =
      /\.json$/i.test(file.name) || /^\s*[[{]/.test(text.slice(0, 64));
    try {
      const rec = isJson
        ? Importer.jsonToRecords(text)
        : Importer.csvToRecords(text);
      if (!rec.rows.length) {
        setStatus("データ行が見つかりませんでした。", true);
        return;
      }
      const schema = Importer.inferSchema(rec.headers, rec.rows);
      const base = file.name.replace(/\.[^.]+$/, "");
      staged = {
        headers: rec.headers,
        rows: rec.rows,
        schema,
        sourceName: file.name,
        table: Importer.sanitizeTable(base),
        format: isJson ? "JSON" : "CSV",
      };
      renderStaged();
      setStatus(
        `「${file.name}」を解析しました (${rec.rows.length} 行 / ${rec.headers.length} 列)。`
      );
    } catch (e) {
      setStatus("解析に失敗: " + e.message, true);
      console.error(e);
    }
  }

  function renderStaged() {
    if (!staged) return;
    $("#import-empty").hidden = true;
    $("#import-config").hidden = false;

    $("#import-source").textContent = `${staged.sourceName} (${staged.format})`;
    $("#import-table-name").value = staged.table;

    // 既存テーブルをモード選択の説明に反映
    const existing = Database.listTables();
    const nameField = $("#import-table-name");
    const modeHint = $("#mode-hint");
    const updateHint = () => {
      const exists = existing.includes(
        Importer.sanitizeTable(nameField.value)
      );
      modeHint.textContent = exists
        ? "※ 同名テーブルが既に存在します。"
        : "※ 新規テーブルとして作成されます。";
    };
    nameField.oninput = updateHint;
    updateHint();

    // 列定義エディタ (型を変更可能)
    const tbody = $("#col-editor tbody");
    tbody.innerHTML = "";
    staged.schema.forEach((col, idx) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${escapeHtml(col.name)}</td>
        <td><input class="col-name" data-idx="${idx}" value="${escapeHtml(
        col.column
      )}"></td>
        <td>
          <select class="col-type" data-idx="${idx}">
            <option value="TEXT">TEXT (文字)</option>
            <option value="INTEGER">INTEGER (整数)</option>
            <option value="REAL">REAL (小数)</option>
          </select>
        </td>`;
      tbody.appendChild(tr);
      tr.querySelector(".col-type").value = col.type;
    });

    // プレビュー (先頭 20 行)
    renderPreview();
  }

  function renderPreview() {
    const wrap = $("#import-preview");
    const rows = staged.rows.slice(0, 20);
    let html = "<table><thead><tr>";
    staged.headers.forEach((h) => (html += `<th>${escapeHtml(h)}</th>`));
    html += "</tr></thead><tbody>";
    rows.forEach((r) => {
      html += "<tr>";
      staged.headers.forEach((h) => (html += `<td>${nullable(r[h])}</td>`));
      html += "</tr>";
    });
    html += "</tbody></table>";
    if (staged.rows.length > 20)
      html += `<p class="hint">…他 ${
        staged.rows.length - 20
      } 行</p>`;
    wrap.innerHTML = html;
  }

  async function runImport() {
    if (!staged) return;
    // 列定義エディタから最新の設定を回収
    $$("#col-editor .col-name").forEach((inp) => {
      staged.schema[+inp.dataset.idx].column =
        Importer.sanitizeColumn(inp.value);
    });
    $$("#col-editor .col-type").forEach((sel) => {
      staged.schema[+sel.dataset.idx].type = sel.value;
    });

    const table = $("#import-table-name").value.trim();
    const mode = $('input[name="import-mode"]:checked').value;
    const addId = $("#import-add-id").checked;

    if (!table) {
      setStatus("テーブル名を入力してください。", true);
      return;
    }

    try {
      const res = Importer.importRecords({
        table,
        schema: staged.schema,
        rows: staged.rows,
        mode,
        addId,
      });
      await Database.persist();
      setStatus(
        `取込完了: テーブル「${res.table}」に ${res.inserted.toLocaleString(
          "ja-JP"
        )} 行を登録しました。`
      );
      clearStaged();
      refreshHeader();
      refreshBrowseTables();
      refreshSchema();
    } catch (e) {
      setStatus("取込に失敗: " + e.message, true);
      console.error(e);
    }
  }

  function clearStaged() {
    staged = null;
    $("#import-empty").hidden = false;
    $("#import-config").hidden = true;
    $("#import-preview").innerHTML = "";
  }

  /* ================================================================ */
  /* テーブル閲覧 (Browse)                                             */
  /* ================================================================ */

  const PAGE_SIZE = 50;
  let browseState = { table: null, page: 0, keyword: "" };

  function refreshBrowseTables() {
    const sel = $("#browse-table");
    const tables = Database.listTables();
    const current = sel.value;
    sel.innerHTML = tables
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join("");
    if (!tables.length) {
      $("#browse-body").innerHTML =
        '<p class="hint">テーブルがありません。「データ移行」タブから取り込むか、「基本スキーマ作成」を実行してください。</p>';
      $("#browse-pager").hidden = true;
      return;
    }
    if (tables.includes(current)) sel.value = current;
    browseState.table = sel.value;
    browseState.page = 0;
    renderBrowse();
  }

  function setupBrowse() {
    $("#browse-table").addEventListener("change", (e) => {
      browseState.table = e.target.value;
      browseState.page = 0;
      browseState.keyword = "";
      $("#browse-search").value = "";
      renderBrowse();
    });
    $("#browse-search").addEventListener("input", (e) => {
      browseState.keyword = e.target.value.trim();
      browseState.page = 0;
      renderBrowse();
    });
    $("#browse-prev").addEventListener("click", () => {
      if (browseState.page > 0) {
        browseState.page--;
        renderBrowse();
      }
    });
    $("#browse-next").addEventListener("click", () => {
      browseState.page++;
      renderBrowse();
    });
  }

  function renderBrowse() {
    const table = browseState.table;
    if (!table) return;
    const q = table.replace(/"/g, '""');
    const cols = Database.tableInfo(table).map((c) => c.name);

    let where = "";
    let params = [];
    if (browseState.keyword) {
      const conds = cols.map((c) => `CAST("${c.replace(/"/g, '""')}" AS TEXT) LIKE ?`);
      where = " WHERE " + conds.join(" OR ");
      params = cols.map(() => `%${browseState.keyword}%`);
    }

    const total = Database.scalar(
      `SELECT COUNT(*) FROM "${q}"${where}`,
      params
    );
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (browseState.page >= pages) browseState.page = pages - 1;
    const offset = browseState.page * PAGE_SIZE;

    const rows = Database.query(
      `SELECT * FROM "${q}"${where} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
      params
    );

    let html = '<div class="grid-scroll"><table><thead><tr>';
    cols.forEach((c) => (html += `<th>${escapeHtml(c)}</th>`));
    html += "</tr></thead><tbody>";
    if (!rows.length) {
      html += `<tr><td colspan="${cols.length}" class="hint">該当データなし</td></tr>`;
    } else {
      rows.forEach((r) => {
        html += "<tr>";
        cols.forEach((c) => (html += `<td>${nullable(r[c])}</td>`));
        html += "</tr>";
      });
    }
    html += "</tbody></table></div>";
    $("#browse-body").innerHTML = html;

    $("#browse-pager").hidden = false;
    $("#browse-count").textContent = `${total.toLocaleString(
      "ja-JP"
    )} 件`;
    $("#browse-page-label").textContent = `${browseState.page + 1} / ${pages}`;
    $("#browse-prev").disabled = browseState.page <= 0;
    $("#browse-next").disabled = browseState.page >= pages - 1;
  }

  /* ================================================================ */
  /* SQL コンソール                                                    */
  /* ================================================================ */

  function setupSql() {
    setupBrowse();
    $("#btn-sql-run").addEventListener("click", runSql);
    $("#sql-input").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runSql();
    });
  }

  async function runSql() {
    const sql = $("#sql-input").value.trim();
    if (!sql) return;
    const out = $("#sql-result");
    try {
      const isSelect = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(sql);
      if (isSelect) {
        const res = Database.exec(sql);
        if (!res.length) {
          out.innerHTML = '<p class="hint">(結果 0 件)</p>';
        } else {
          out.innerHTML = renderResultTables(res);
        }
        setStatus("クエリを実行しました。");
      } else {
        Database.run(sql);
        await Database.persist();
        out.innerHTML = '<p class="ok">実行しました (変更を保存済み)。</p>';
        setStatus("SQL を実行し保存しました。");
        refreshHeader();
        refreshBrowseTables();
        refreshSchema();
      }
    } catch (e) {
      out.innerHTML = `<p class="error">エラー: ${escapeHtml(e.message)}</p>`;
      setStatus("SQL エラー", true);
    }
  }

  function renderResultTables(res) {
    return res
      .map((r) => {
        let html = '<div class="grid-scroll"><table><thead><tr>';
        r.columns.forEach((c) => (html += `<th>${escapeHtml(c)}</th>`));
        html += "</tr></thead><tbody>";
        r.values.forEach((row) => {
          html += "<tr>";
          row.forEach((v) => (html += `<td>${nullable(v)}</td>`));
          html += "</tr>";
        });
        html += "</tbody></table></div>";
        html += `<p class="hint">${r.values.length.toLocaleString(
          "ja-JP"
        )} 件</p>`;
        return html;
      })
      .join("");
  }

  /* ================================================================ */
  /* スキーマ表示                                                      */
  /* ================================================================ */

  function refreshSchema() {
    const tables = Database.listTables();
    const wrap = $("#schema-body");
    if (!tables.length) {
      wrap.innerHTML =
        '<p class="hint">テーブルがありません。</p>';
      return;
    }
    wrap.innerHTML = tables
      .map((t) => {
        const info = Database.tableInfo(t);
        const count = Database.countRows(t);
        let rows = info
          .map(
            (c) => `
          <tr>
            <td class="mono">${escapeHtml(c.name)}</td>
            <td>${escapeHtml(c.type || "")}</td>
            <td>${c.pk ? "PK" : ""}</td>
            <td>${c.notnull ? "NOT NULL" : ""}</td>
          </tr>`
          )
          .join("");
        return `
        <details open>
          <summary><strong>${escapeHtml(t)}</strong>
            <span class="badge">${count.toLocaleString("ja-JP")} 行</span></summary>
          <table class="schema-table">
            <thead><tr><th>列名</th><th>型</th><th>キー</th><th>制約</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </details>`;
      })
      .join("");
  }

  document.addEventListener("DOMContentLoaded", main);
})();

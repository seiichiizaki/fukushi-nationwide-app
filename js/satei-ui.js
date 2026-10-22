/*
 * satei-ui.js — 「査定・返戻」タブの画面制御
 *
 * 厚労省・支払基金等の公表値 (js/satei.js) を投入し、
 * 全国水準の KPI / 推移 / 支払基金 vs 国保連 / 都道府県別 / 出典を表示する。
 * 自院 (自事業所) の請求・査定実績を入力して全国水準と比較できる。
 */

const SateiUI = (() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  let onDbChanged = null; // ui.js から渡される再描画コールバック

  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtNum(v, digits) {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return Number(v).toLocaleString("ja-JP", {
      maximumFractionDigits: digits === undefined ? 3 : digits,
    });
  }

  function fmtValue(v, unit) {
    if (unit === "件") return fmtNum(v, 0);
    if (unit === "点") return fmtNum(v, 1);
    return fmtNum(v, 3);
  }

  /* ================================================================ */
  /* 初期化                                                            */
  /* ================================================================ */

  function setup(opts) {
    onDbChanged = (opts && opts.onDbChanged) || (() => {});
    $("#btn-satei-seed").addEventListener("click", seedData);
    $("#satei-filter-org").addEventListener("change", renderStats);
    $("#satei-filter-metric").addEventListener("change", renderStats);
    $("#satei-filter-kubun").addEventListener("change", renderStats);
    $("#btn-satei-calc").addEventListener("click", renderCalc);
    $$("#satei-calc input").forEach((inp) =>
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") renderCalc();
      })
    );
  }

  async function seedData() {
    try {
      const c = Satei.seed();
      await Database.persist();
      setStatus(
        `公表データを投入しました (出典 ${c.sources} 件 / 統計 ${c.stats} 行追加 / 都道府県 ${c.prefs} 行追加)。`
      );
      onDbChanged();
      refresh();
    } catch (e) {
      setStatus("投入に失敗: " + e.message, true);
      console.error(e);
    }
  }

  function setStatus(msg, isError) {
    const el = $("#status");
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }

  /* ================================================================ */
  /* 再描画                                                            */
  /* ================================================================ */

  function refresh() {
    const loaded = Satei.isLoaded();
    $("#satei-empty").hidden = loaded;
    $("#satei-body").hidden = !loaded;
    if (!loaded) return;
    renderKpi();
    renderTrend();
    renderCompare();
    populateFilters();
    renderStats();
    renderPrefs();
    renderSources();
    renderCalc();
  }

  /* ---------------- KPI ---------------- */
  function renderKpi() {
    const b = Satei.benchmarks();
    const cards = [
      {
        label: "支払基金 査定率 (件数)",
        value: fmtNum(b.kikinRateCnt, 2) + " %",
        sub: "令和2年3月審査分 / 医科歯科計 (厚労省保険局)",
      },
      {
        label: "支払基金 査定率 (点数)",
        value: fmtNum(b.kikinRatePt, 3) + " %",
        sub: "令和2年3月審査分 / 医科歯科計 (厚労省保険局)",
      },
      {
        label: "国保連 査定率 (件数)",
        value: fmtNum(b.kokuhoRateCnt, 2) + " %",
        sub: "令和2年3月審査分 / 医科歯科計 (厚労省保険局)",
      },
      {
        label: "国保連 査定率 (点数)",
        value: fmtNum(b.kokuhoRatePt, 3) + " %",
        sub: "令和2年3月審査分 / 医科歯科計 (厚労省保険局)",
      },
      {
        label: "支払基金 直近月 査定率 (件数)",
        value: fmtNum(b.latestRateCnt, 2) + " %",
        sub: "令和6年2月審査分 / 医科歯科計 (支払基金公表値から算出)",
      },
      {
        label: "支払基金 直近月 1万点当たり査定点数",
        value: fmtNum(b.latestPer10k, 1) + " 点",
        sub: `= 査定率 (点数) ${fmtNum(b.latestRatePt, 3)} % (令和6年2月審査分)`,
      },
      {
        label: "支払基金 年度 査定率 (点数)",
        value: fmtNum(b.fy2021RatePt, 3) + " %",
        sub: "2021年度 (R3.5〜R4.4審査分) 特別審査含む",
      },
      {
        label: "支部間格差 (原審査)",
        value: fmtNum(b.gap, 1) + " 倍",
        sub: "支部別 査定点数割合 最高÷最低 (H27.5〜H28.4審査分)",
      },
    ];
    $("#satei-kpi").innerHTML = cards
      .map(
        (c) => `
        <div class="kpi">
          <div class="kpi-label">${esc(c.label)}</div>
          <div class="kpi-value">${esc(c.value)}</div>
          <div class="kpi-sub">${esc(c.sub)}</div>
        </div>`
      )
      .join("");
  }

  /* ---------------- 推移 (CSS バー) ---------------- */
  function renderTrend() {
    const b = Satei.benchmarks();
    const rows = b.trend || [];
    const wrap = $("#satei-trend");
    if (!rows.length) {
      wrap.innerHTML = '<p class="hint">推移データがありません。</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => r.値));
    wrap.innerHTML =
      '<div class="bars">' +
      rows
        .map((r) => {
          const h = Math.round((r.値 / max) * 100);
          const label = r.対象期間.replace("審査分", "");
          return `
          <div class="bar-col" title="${esc(r.対象期間)}: ${fmtNum(r.値, 1)} 点">
            <div class="bar-val">${fmtNum(r.値, 1)}</div>
            <div class="bar" style="height:${h}%"></div>
            <div class="bar-label">${esc(label)}</div>
          </div>`;
        })
        .join("") +
      "</div>";
  }

  /* ---------------- 支払基金 vs 国保連 ---------------- */
  function renderCompare() {
    const rows = Database.query(`
      SELECT k.対象期間, k.診療種別, k.審査区分, k.指標, k.単位,
             k.値 AS 支払基金, n.値 AS 国保連
        FROM 査定返戻_統計 k
        JOIN 査定返戻_統計 n
          ON n.審査機関='国保連' AND k.審査機関='支払基金'
         AND n.対象期間=k.対象期間 AND n.診療種別=k.診療種別
         AND n.審査区分=k.審査区分 AND n.指標=k.指標
       ORDER BY k.id`);
    const wrap = $("#satei-compare");
    if (!rows.length) {
      wrap.innerHTML = '<p class="hint">比較可能なデータがありません。</p>';
      return;
    }
    let html =
      '<div class="grid-scroll"><table><thead><tr><th>対象期間</th><th>診療種別</th><th>審査区分</th><th>指標</th><th class="num">支払基金</th><th class="num">国保連</th><th>単位</th></tr></thead><tbody>';
    rows.forEach((r) => {
      html += `<tr><td>${esc(r.対象期間)}</td><td>${esc(r.診療種別)}</td><td>${esc(
        r.審査区分
      )}</td><td>${esc(r.指標)}</td><td class="num">${fmtValue(
        r.支払基金,
        r.単位
      )}</td><td class="num">${fmtValue(r.国保連, r.単位)}</td><td>${esc(
        r.単位
      )}</td></tr>`;
    });
    html += "</tbody></table></div>";
    wrap.innerHTML = html;
  }

  /* ---------------- 統計一覧 (フィルタ付き) ---------------- */
  function populateFilters() {
    const fill = (sel, col) => {
      const cur = sel.value;
      const vals = Database.query(
        `SELECT DISTINCT ${col} AS v FROM 査定返戻_統計 ORDER BY v`
      ).map((r) => r.v);
      sel.innerHTML =
        '<option value="">(すべて)</option>' +
        vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
      if (vals.includes(cur)) sel.value = cur;
    };
    fill($("#satei-filter-org"), "審査機関");
    fill($("#satei-filter-metric"), "指標");
    fill($("#satei-filter-kubun"), "審査区分");
  }

  function renderStats() {
    if (!Satei.isLoaded()) return;
    const conds = [];
    const params = [];
    const org = $("#satei-filter-org").value;
    const metric = $("#satei-filter-metric").value;
    const kubun = $("#satei-filter-kubun").value;
    if (org) {
      conds.push("s.審査機関=?");
      params.push(org);
    }
    if (metric) {
      conds.push("s.指標=?");
      params.push(metric);
    }
    if (kubun) {
      conds.push("s.審査区分=?");
      params.push(kubun);
    }
    const where = conds.length ? " WHERE " + conds.join(" AND ") : "";
    const rows = Database.query(
      `SELECT s.*, o.発行元, o.資料名
         FROM 査定返戻_統計 s LEFT JOIN 査定返戻_出典 o ON o.出典ID = s.出典ID
         ${where} ORDER BY s.id`,
      params
    );
    const wrap = $("#satei-stats");
    let html =
      '<div class="grid-scroll"><table><thead><tr>' +
      "<th>審査機関</th><th>対象期間</th><th>診療種別</th><th>審査区分</th><th>指標</th>" +
      '<th class="num">値</th><th>単位</th><th class="num">前年比</th><th>出典</th><th>備考</th>' +
      "</tr></thead><tbody>";
    if (!rows.length) {
      html += '<tr><td colspan="10" class="hint">該当データなし</td></tr>';
    }
    rows.forEach((r) => {
      html += `<tr>
        <td>${esc(r.審査機関)}</td><td>${esc(r.対象期間)}</td><td>${esc(
        r.診療種別
      )}</td><td>${esc(r.審査区分)}</td><td>${esc(r.指標)}</td>
        <td class="num">${fmtValue(r.値, r.単位)}</td><td>${esc(r.単位)}</td>
        <td class="num">${
          r.前年比 === null || r.前年比 === undefined
            ? ""
            : (r.前年比 > 0 ? "+" : "") + fmtNum(r.前年比, 1) + "%"
        }</td>
        <td title="${esc(r.資料名 || "")}">${esc(r.発行元 || r.出典ID || "")}</td>
        <td class="note">${esc(r.備考)}</td></tr>`;
    });
    html += "</tbody></table></div>";
    html += `<p class="hint">${rows.length.toLocaleString("ja-JP")} 件</p>`;
    wrap.innerHTML = html;
  }

  /* ---------------- 都道府県別 ---------------- */
  function renderPrefs() {
    const rows = Database.query(
      `SELECT p.*, o.発行元 FROM 査定返戻_都道府県 p
         LEFT JOIN 査定返戻_出典 o ON o.出典ID = p.出典ID
        ORDER BY p.対象期間, p.指標, p.値 DESC`
    );
    const wrap = $("#satei-prefs");
    if (!rows.length) {
      wrap.innerHTML =
        '<p class="hint">都道府県別データがありません。支払基金「審査状況」の支部別ファイルを「データ移行」タブから <code>査定返戻_都道府県</code> へ追記してください。</p>';
      return;
    }
    let html =
      '<div class="grid-scroll"><table><thead><tr><th>都道府県</th><th>審査機関</th><th>対象期間</th><th>診療種別</th><th>審査区分</th><th>指標</th><th class="num">値</th><th>単位</th><th>出典</th><th>備考</th></tr></thead><tbody>';
    rows.forEach((r) => {
      html += `<tr><td>${esc(r.都道府県名)}</td><td>${esc(r.審査機関)}</td><td>${esc(
        r.対象期間
      )}</td><td>${esc(r.診療種別)}</td><td>${esc(r.審査区分)}</td><td>${esc(
        r.指標
      )}</td><td class="num">${fmtValue(r.値, r.単位)}</td><td>${esc(
        r.単位
      )}</td><td>${esc(r.発行元 || r.出典ID || "")}</td><td class="note">${esc(
        r.備考
      )}</td></tr>`;
    });
    html += "</tbody></table></div>";
    wrap.innerHTML = html;
  }

  /* ---------------- 出典 ---------------- */
  function renderSources() {
    const rows = Database.query(
      "SELECT o.*, (SELECT COUNT(*) FROM 査定返戻_統計 s WHERE s.出典ID=o.出典ID) AS 件数 FROM 査定返戻_出典 o ORDER BY 公表年月 DESC"
    );
    const wrap = $("#satei-sources");
    let html =
      '<div class="grid-scroll"><table><thead><tr><th>出典ID</th><th>資料名</th><th>発行元</th><th>公表年月</th><th class="num">投入行数</th><th>URL</th><th>備考</th></tr></thead><tbody>';
    rows.forEach((r) => {
      html += `<tr><td class="mono">${esc(r.出典ID)}</td><td>${esc(r.資料名)}</td><td>${esc(
        r.発行元
      )}</td><td>${esc(r.公表年月)}</td><td class="num">${r.件数}</td>
        <td>${
          r.URL
            ? `<a href="${esc(r.URL)}" target="_blank" rel="noopener">リンク</a>`
            : ""
        }</td><td class="note">${esc(r.備考)}</td></tr>`;
    });
    html += "</tbody></table></div>";
    wrap.innerHTML = html;
  }

  /* ---------------- 自院比較 ---------------- */
  function renderCalc() {
    if (!Satei.isLoaded()) return;
    const num = (id) => {
      const v = parseFloat(String($(id).value).replace(/,/g, ""));
      return Number.isFinite(v) ? v : null;
    };
    const reqCnt = num("#calc-req-cnt");
    const satCnt = num("#calc-sat-cnt");
    const reqPt = num("#calc-req-pt");
    const satPt = num("#calc-sat-pt");
    const recvCnt = num("#calc-recv-cnt");
    const retCnt = num("#calc-ret-cnt");
    const b = Satei.benchmarks();
    const out = $("#satei-calc-result");

    const rateCnt = reqCnt && satCnt !== null ? (satCnt / reqCnt) * 100 : null;
    const ratePt = reqPt && satPt !== null ? (satPt / reqPt) * 100 : null;
    const per10k = ratePt === null ? null : ratePt * 100;
    const retRate = recvCnt && retCnt !== null ? (retCnt / recvCnt) * 100 : null;

    if (rateCnt === null && ratePt === null && retRate === null) {
      out.innerHTML =
        '<p class="hint">自院の請求件数・査定件数 (または点数) を入力すると、全国水準との比較を表示します。</p>';
      return;
    }

    const judge = (own, bench) => {
      if (own === null || bench === null || bench === undefined) return "";
      const ratio = own / bench;
      if (ratio >= 1.5) return '<span class="tag bad">全国水準より高い (要点検)</span>';
      if (ratio >= 1.1) return '<span class="tag warn">やや高い</span>';
      if (ratio <= 0.5) return '<span class="tag ok">低い</span>';
      return '<span class="tag ok">全国水準並み</span>';
    };

    const lines = [];
    if (rateCnt !== null) {
      lines.push({
        label: "査定率 (件数)",
        own: fmtNum(rateCnt, 2) + " %",
        bench: `支払基金 ${fmtNum(b.kikinRateCnt, 2)} % / 国保連 ${fmtNum(
          b.kokuhoRateCnt,
          2
        )} % / 直近月 ${fmtNum(b.latestRateCnt, 2)} %`,
        judge: judge(rateCnt, b.latestRateCnt || b.kikinRateCnt),
      });
    }
    if (ratePt !== null) {
      lines.push({
        label: "査定率 (点数)",
        own: fmtNum(ratePt, 3) + " %",
        bench: `支払基金 ${fmtNum(b.kikinRatePt, 3)} % / 国保連 ${fmtNum(
          b.kokuhoRatePt,
          3
        )} % / 直近月 ${fmtNum(b.latestRatePt, 3)} %`,
        judge: judge(ratePt, b.latestRatePt || b.kikinRatePt),
      });
      lines.push({
        label: "1万点当たり査定点数",
        own: fmtNum(per10k, 1) + " 点",
        bench: `支払基金 11月審査分 R1 26.0 / R5 26.7 点、直近月 ${fmtNum(
          b.latestPer10k,
          1
        )} 点`,
        judge: judge(per10k, b.latestPer10k),
      });
      if (satPt !== null) {
        lines.push({
          label: "査定による減収 (概算)",
          own: fmtNum(satPt * 10, 0) + " 円",
          bench: "査定点数 × 10 円",
          judge: "",
        });
      }
    }
    if (retRate !== null) {
      lines.push({
        label: "返戻率",
        own: fmtNum(retRate, 2) + " %",
        bench: "全国の医科返戻率は未公表。参考: DPC (令和6年2月審査分) 0.9万件 ÷ 46.0万件 ≒ 1.96 %",
        judge: judge(retRate, 1.96),
      });
    }

    out.innerHTML =
      '<div class="grid-scroll"><table><thead><tr><th>指標</th><th class="num">自院</th><th>全国水準 (公表値)</th><th>評価</th></tr></thead><tbody>' +
      lines
        .map(
          (l) =>
            `<tr><td>${esc(l.label)}</td><td class="num"><strong>${esc(
              l.own
            )}</strong></td><td>${esc(l.bench)}</td><td>${l.judge}</td></tr>`
        )
        .join("") +
      "</tbody></table></div>" +
      '<p class="hint">※ 評価は直近の全国水準に対する倍率 (1.1 倍以上=やや高い、1.5 倍以上=要点検) の目安です。診療科構成や入院・外来比率で水準は異なります。</p>';
  }

  return { setup, refresh };
})();

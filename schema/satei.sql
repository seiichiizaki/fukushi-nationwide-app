-- =====================================================================
--  査定・返戻 公表データ スキーマ (SQLite)
-- ---------------------------------------------------------------------
--  厚生労働省保険局 / 社会保険診療報酬支払基金 / 国民健康保険中央会 /
--  内閣府 (規制改革推進会議) 等が公表しているレセプト審査 (査定・返戻)
--  の統計値を、出典付きで保持する。
--
--  ※ 実際の DDL とデータは js/satei.js に埋め込まれており、アプリの
--    「査定・返戻」タブ → 「公表データを投入」で作成・投入される。
--    このファイルは参照用 (DB Browser 等で単体利用も可)。
-- =====================================================================

-- 公表資料マスタ
CREATE TABLE IF NOT EXISTS 査定返戻_出典 (
    出典ID   TEXT PRIMARY KEY,     -- 例: 'MHLW-2020-10'
    資料名   TEXT NOT NULL,
    発行元   TEXT NOT NULL,        -- 厚生労働省 保険局 / 支払基金 / 国保中央会 ...
    公表年月 TEXT,
    URL      TEXT,
    備考     TEXT
);

-- 指標定義 (分子・分母)
CREATE TABLE IF NOT EXISTS 査定返戻_指標定義 (
    指標     TEXT PRIMARY KEY,     -- 査定率_件数 / 査定率_点数 / 1万点当たり査定点数 ...
    定義     TEXT NOT NULL,
    単位     TEXT
);

-- 全国・審査機関別の統計値 (1 行 = 1 指標値)
CREATE TABLE IF NOT EXISTS 査定返戻_統計 (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    審査機関  TEXT NOT NULL,       -- 支払基金 / 国保連
    対象期間  TEXT NOT NULL,       -- 令和2年3月審査分 / 2021年度(R3.5〜R4.4審査分) ...
    期間種別  TEXT NOT NULL,       -- 月次 / 年度 / 期間平均
    診療種別  TEXT NOT NULL,       -- 医科 / 歯科 / 調剤 / 医科歯科計 / DPC
    審査区分  TEXT NOT NULL,       -- 原審査 / 再審査 / 返戻
    指標      TEXT NOT NULL,
    値        REAL NOT NULL,
    単位      TEXT NOT NULL,       -- 件 / 点 / % / 倍
    前年比    REAL,                -- % (公表されている場合のみ)
    出典ID    TEXT,
    備考      TEXT,
    FOREIGN KEY (出典ID) REFERENCES 査定返戻_出典(出典ID)
);

-- 都道府県 (支払基金支部 / 国保連) 別
CREATE TABLE IF NOT EXISTS 査定返戻_都道府県 (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    都道府県コード TEXT,            -- JIS コード (都道府県マスタと結合可)
    都道府県名    TEXT NOT NULL,
    審査機関      TEXT NOT NULL,
    対象期間      TEXT NOT NULL,
    診療種別      TEXT NOT NULL,
    審査区分      TEXT NOT NULL,
    指標          TEXT NOT NULL,
    値            REAL NOT NULL,
    単位          TEXT NOT NULL,
    出典ID        TEXT,
    備考          TEXT,
    FOREIGN KEY (出典ID) REFERENCES 査定返戻_出典(出典ID)
);

-- 査定事由・返戻事由 マスタ (医科レセプト / 介護保険 / 障害福祉)
CREATE TABLE IF NOT EXISTS 査定返戻_事由マスタ (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    制度      TEXT NOT NULL,       -- 医科レセプト / 介護保険 / 障害福祉
    区分      TEXT NOT NULL,       -- 査定事由記号 / 返戻事由記号 / 返戻事由コード系統 / 返戻事由コード
    コード    TEXT NOT NULL,       -- A〜K, L5006, 12P0, EG03 ...
    名称      TEXT NOT NULL,
    分類      TEXT,                -- 医学的判断 / 算定要件 / 事務的誤り / 資格 / 記載不備 / 台帳突合 / 給付管理 / 重複 / 審査委員会 / 点検
    対応の目安 TEXT,
    審査機関  TEXT,                -- 支払基金 / 国保連 / 共通
    出典ID    TEXT,
    備考      TEXT,
    FOREIGN KEY (出典ID) REFERENCES 査定返戻_出典(出典ID)
);

-- 自院 (自事業所) の査定・返戻記録 (事由別集計用)
CREATE TABLE IF NOT EXISTS 査定返戻_自院記録 (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    年月      TEXT NOT NULL,       -- 審査年月 YYYY-MM
    制度      TEXT NOT NULL,
    区分      TEXT NOT NULL,       -- 査定 / 返戻
    審査機関  TEXT,
    事由コード TEXT,               -- 査定返戻_事由マスタ.コード
    事由      TEXT,                -- 自由記載
    件数      INTEGER NOT NULL DEFAULT 0,
    点数_単位数 REAL,              -- 医科: 点数 / 介護・障害: 単位数
    備考      TEXT,
    登録日時  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_査定統計_機関期間 ON 査定返戻_統計(審査機関, 対象期間);
CREATE INDEX IF NOT EXISTS idx_事由_制度区分     ON 査定返戻_事由マスタ(制度, 区分);
CREATE INDEX IF NOT EXISTS idx_自院記録_年月     ON 査定返戻_自院記録(年月, 区分);
CREATE INDEX IF NOT EXISTS idx_査定統計_指標     ON 査定返戻_統計(指標);
CREATE INDEX IF NOT EXISTS idx_査定都道府県_期間 ON 査定返戻_都道府県(対象期間, 指標);

-- 便利ビュー: 自院記録の事由別集計
CREATE VIEW IF NOT EXISTS v_自院_事由別集計 AS
SELECT r.制度, r.区分, r.事由コード,
       COALESCE(MAX(m.名称), MAX(r.事由)) AS 事由,
       SUM(r.件数) AS 件数, SUM(COALESCE(r.点数_単位数, 0)) AS 点数_単位数
  FROM 査定返戻_自院記録 r
  LEFT JOIN 査定返戻_事由マスタ m ON m.制度 = r.制度 AND m.コード = r.事由コード
 GROUP BY r.制度, r.区分, r.事由コード
 ORDER BY 件数 DESC;

-- ---------------------------------------------------------------------
-- 便利ビュー: 支払基金 vs 国保連 (同一期間・同一指標の横並び)
-- ---------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_査定_機関比較 AS
SELECT k.対象期間, k.診療種別, k.審査区分, k.指標, k.単位,
       k.値 AS 支払基金, n.値 AS 国保連
  FROM 査定返戻_統計 k
  JOIN 査定返戻_統計 n
    ON n.審査機関 = '国保連' AND k.審査機関 = '支払基金'
   AND n.対象期間 = k.対象期間 AND n.診療種別 = k.診療種別
   AND n.審査区分 = k.審査区分 AND n.指標 = k.指標;

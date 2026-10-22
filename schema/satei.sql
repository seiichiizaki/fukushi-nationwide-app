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

CREATE INDEX IF NOT EXISTS idx_査定統計_機関期間 ON 査定返戻_統計(審査機関, 対象期間);
CREATE INDEX IF NOT EXISTS idx_査定統計_指標     ON 査定返戻_統計(指標);
CREATE INDEX IF NOT EXISTS idx_査定都道府県_期間 ON 査定返戻_都道府県(対象期間, 指標);

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

-- =====================================================================
--  福祉・全国対応アプリ 基本スキーマ (SQLite)
-- ---------------------------------------------------------------------
--  既存アプリからのデータ移行の「受け皿」となる標準テーブル群。
--  全国展開を想定し、都道府県マスタで事業所を地域横断的に管理する。
--
--  ※ このファイルはアプリの「基本スキーマを作成」ボタンから読み込まれる。
--    移行データの形に合わせて自由に拡張・改変してよい。
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 都道府県マスタ (全国 47 都道府県)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS 都道府県 (
    都道府県コード TEXT PRIMARY KEY,   -- JIS 都道府県コード (例: '13')
    都道府県名     TEXT NOT NULL,
    地方区分       TEXT                 -- 北海道/東北/関東/中部/近畿/中国/四国/九州
);

-- ---------------------------------------------------------------------
-- サービス種別マスタ (介護・障害福祉・児童福祉 等)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS サービス種別 (
    種別コード TEXT PRIMARY KEY,
    種別名     TEXT NOT NULL,
    区分       TEXT,                    -- 介護保険/障害福祉/児童/その他
    備考       TEXT
);

-- ---------------------------------------------------------------------
-- 事業所 (全国の拠点)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS 事業所 (
    事業所ID     INTEGER PRIMARY KEY AUTOINCREMENT,
    事業所番号   TEXT UNIQUE,           -- 自治体発行の事業所番号
    事業所名     TEXT NOT NULL,
    都道府県コード TEXT,
    市区町村     TEXT,
    住所         TEXT,
    電話番号     TEXT,
    種別コード   TEXT,
    有効フラグ   INTEGER NOT NULL DEFAULT 1,
    登録日       TEXT DEFAULT (date('now','localtime')),
    FOREIGN KEY (都道府県コード) REFERENCES 都道府県(都道府県コード),
    FOREIGN KEY (種別コード)     REFERENCES サービス種別(種別コード)
);

-- ---------------------------------------------------------------------
-- 職員
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS 職員 (
    職員ID     INTEGER PRIMARY KEY AUTOINCREMENT,
    事業所ID   INTEGER,
    氏名       TEXT NOT NULL,
    フリガナ   TEXT,
    職種       TEXT,
    メール     TEXT,
    在籍フラグ INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (事業所ID) REFERENCES 事業所(事業所ID)
);

-- ---------------------------------------------------------------------
-- 利用者
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS 利用者 (
    利用者ID     INTEGER PRIMARY KEY AUTOINCREMENT,
    事業所ID     INTEGER,
    被保険者番号 TEXT,
    氏名         TEXT NOT NULL,
    フリガナ     TEXT,
    生年月日     TEXT,
    性別         TEXT,                  -- 男/女/その他
    要介護度     TEXT,
    住所         TEXT,
    電話番号     TEXT,
    利用開始日   TEXT,
    利用終了日   TEXT,
    FOREIGN KEY (事業所ID) REFERENCES 事業所(事業所ID)
);

-- ---------------------------------------------------------------------
-- サービス記録 (日々の実績)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS サービス記録 (
    記録ID     INTEGER PRIMARY KEY AUTOINCREMENT,
    利用者ID   INTEGER,
    職員ID     INTEGER,
    種別コード TEXT,
    提供日     TEXT NOT NULL,
    開始時刻   TEXT,
    終了時刻   TEXT,
    内容       TEXT,
    特記事項   TEXT,
    FOREIGN KEY (利用者ID)   REFERENCES 利用者(利用者ID),
    FOREIGN KEY (職員ID)     REFERENCES 職員(職員ID),
    FOREIGN KEY (種別コード) REFERENCES サービス種別(種別コード)
);

-- ---------------------------------------------------------------------
-- 検索用インデックス
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_事業所_都道府県 ON 事業所(都道府県コード);
CREATE INDEX IF NOT EXISTS idx_利用者_事業所   ON 利用者(事業所ID);
CREATE INDEX IF NOT EXISTS idx_記録_利用者     ON サービス記録(利用者ID);
CREATE INDEX IF NOT EXISTS idx_記録_提供日     ON サービス記録(提供日);

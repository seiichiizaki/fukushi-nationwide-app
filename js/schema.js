/*
 * schema.js — 福祉・全国対応アプリの基本スキーマと初期マスタ
 *
 * file:// でも fetch 不要で読めるよう、DDL とマスタデータを
 * JS 内に埋め込む (schema/schema.sql と同内容)。
 */

const Schema = (() => {
  "use strict";

  // schema/schema.sql と対応する基本 DDL
  const BASE_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS 都道府県 (
    都道府県コード TEXT PRIMARY KEY,
    都道府県名     TEXT NOT NULL,
    地方区分       TEXT
);

CREATE TABLE IF NOT EXISTS サービス種別 (
    種別コード TEXT PRIMARY KEY,
    種別名     TEXT NOT NULL,
    区分       TEXT,
    備考       TEXT
);

CREATE TABLE IF NOT EXISTS 事業所 (
    事業所ID     INTEGER PRIMARY KEY AUTOINCREMENT,
    事業所番号   TEXT UNIQUE,
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

CREATE TABLE IF NOT EXISTS 利用者 (
    利用者ID     INTEGER PRIMARY KEY AUTOINCREMENT,
    事業所ID     INTEGER,
    被保険者番号 TEXT,
    氏名         TEXT NOT NULL,
    フリガナ     TEXT,
    生年月日     TEXT,
    性別         TEXT,
    要介護度     TEXT,
    住所         TEXT,
    電話番号     TEXT,
    利用開始日   TEXT,
    利用終了日   TEXT,
    FOREIGN KEY (事業所ID) REFERENCES 事業所(事業所ID)
);

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

CREATE INDEX IF NOT EXISTS idx_事業所_都道府県 ON 事業所(都道府県コード);
CREATE INDEX IF NOT EXISTS idx_利用者_事業所   ON 利用者(事業所ID);
CREATE INDEX IF NOT EXISTS idx_記録_利用者     ON サービス記録(利用者ID);
CREATE INDEX IF NOT EXISTS idx_記録_提供日     ON サービス記録(提供日);
`;

  // 全国 47 都道府県マスタ [コード, 名称, 地方区分]
  const PREFECTURES = [
    ["01", "北海道", "北海道"],
    ["02", "青森県", "東北"],
    ["03", "岩手県", "東北"],
    ["04", "宮城県", "東北"],
    ["05", "秋田県", "東北"],
    ["06", "山形県", "東北"],
    ["07", "福島県", "東北"],
    ["08", "茨城県", "関東"],
    ["09", "栃木県", "関東"],
    ["10", "群馬県", "関東"],
    ["11", "埼玉県", "関東"],
    ["12", "千葉県", "関東"],
    ["13", "東京都", "関東"],
    ["14", "神奈川県", "関東"],
    ["15", "新潟県", "中部"],
    ["16", "富山県", "中部"],
    ["17", "石川県", "中部"],
    ["18", "福井県", "中部"],
    ["19", "山梨県", "中部"],
    ["20", "長野県", "中部"],
    ["21", "岐阜県", "中部"],
    ["22", "静岡県", "中部"],
    ["23", "愛知県", "中部"],
    ["24", "三重県", "近畿"],
    ["25", "滋賀県", "近畿"],
    ["26", "京都府", "近畿"],
    ["27", "大阪府", "近畿"],
    ["28", "兵庫県", "近畿"],
    ["29", "奈良県", "近畿"],
    ["30", "和歌山県", "近畿"],
    ["31", "鳥取県", "中国"],
    ["32", "島根県", "中国"],
    ["33", "岡山県", "中国"],
    ["34", "広島県", "中国"],
    ["35", "山口県", "中国"],
    ["36", "徳島県", "四国"],
    ["37", "香川県", "四国"],
    ["38", "愛媛県", "四国"],
    ["39", "高知県", "四国"],
    ["40", "福岡県", "九州"],
    ["41", "佐賀県", "九州"],
    ["42", "長崎県", "九州"],
    ["43", "熊本県", "九州"],
    ["44", "大分県", "九州"],
    ["45", "宮崎県", "九州"],
    ["46", "鹿児島県", "九州"],
    ["47", "沖縄県", "九州"],
  ];

  // サービス種別マスタの初期値 [コード, 名称, 区分, 備考]
  const SERVICE_TYPES = [
    ["11", "訪問介護", "介護保険", "ホームヘルプ"],
    ["15", "通所介護", "介護保険", "デイサービス"],
    ["16", "通所リハビリテーション", "介護保険", "デイケア"],
    ["21", "短期入所生活介護", "介護保険", "ショートステイ"],
    ["31", "居宅介護", "障害福祉", ""],
    ["32", "重度訪問介護", "障害福祉", ""],
    ["46", "生活介護", "障害福祉", ""],
    ["61", "就労継続支援A型", "障害福祉", ""],
    ["62", "就労継続支援B型", "障害福祉", ""],
    ["71", "放課後等デイサービス", "児童", ""],
    ["72", "児童発達支援", "児童", ""],
  ];

  /**
   * 基本スキーマを作成し、都道府県・サービス種別マスタを投入する。
   */
  function createBaseSchema() {
    // DDL をステートメント単位で実行
    BASE_DDL.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length)
      .forEach((stmt) => Database.run(stmt + ";"));

    seedMaster();
  }

  /** マスタデータを投入する (既存分は上書きしない)。 */
  function seedMaster() {
    Database.run("BEGIN TRANSACTION");
    try {
      PREFECTURES.forEach(([code, name, region]) => {
        Database.run(
          "INSERT OR IGNORE INTO 都道府県 (都道府県コード, 都道府県名, 地方区分) VALUES (?, ?, ?)",
          [code, name, region]
        );
      });
      SERVICE_TYPES.forEach(([code, name, kubun, note]) => {
        Database.run(
          "INSERT OR IGNORE INTO サービス種別 (種別コード, 種別名, 区分, 備考) VALUES (?, ?, ?, ?)",
          [code, name, kubun, note]
        );
      });
      Database.run("COMMIT");
    } catch (e) {
      Database.run("ROLLBACK");
      throw e;
    }
  }

  return { BASE_DDL, PREFECTURES, SERVICE_TYPES, createBaseSchema, seedMaster };
})();

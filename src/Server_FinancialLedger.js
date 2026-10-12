// ==========================================
// FILE: Server_FinancialLedger.js
// NHIỆM VỤ: Central Immutable Financial Ledger Engine (Phiên bản 2.0)
// Chuẩn Kế toán Sổ Cái 16 Cột:
// A: LedgerID | B: WalletID | C: WalletName | D: Date (YYYY-MM-DD) | E: Amount | F: Direction | G: EffectType | H: SourceModule | I: SourceID | J: EventType | K: IdempotencyKey | L: Status | M: Note | N: CreatedAt | O: ReversalOf | P: CheckpointRef
// ==========================================

var SHEET_WALLET_LEDGER = "WalletLedger";
var SHEET_WALLET_CHECKPOINTS = "WalletCheckpoints";

var LEDGER_HEADERS_16 = [
  "LedgerID",
  "WalletID",
  "WalletName",
  "Date",
  "Amount",
  "Direction",
  "EffectType",
  "SourceModule",
  "SourceID",
  "EventType",
  "IdempotencyKey",
  "Status",
  "Note",
  "CreatedAt",
  "ReversalOf",
  "CheckpointRef"
];

// Alias để tương thích ngược
var LEDGER_HEADERS_15 = LEDGER_HEADERS_16;

/**
 * Đảm bảo tồn tại Sheet WalletLedger với đúng 16 headers chuẩn
 */
function getOrCreateLedgerSheet(ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return null;
    let sheet = ss.getSheetByName(SHEET_WALLET_LEDGER);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_WALLET_LEDGER);
      sheet.getRange(1, 1, 1, LEDGER_HEADERS_16.length).setValues([LEDGER_HEADERS_16]);
      sheet.getRange(1, 1, 1, LEDGER_HEADERS_16.length).setFontWeight("bold").setBackground("#e2e8f0");
    } else {
      // Đảm bảo đủ 16 cột
      const lastCol = Math.max(sheet.getLastColumn(), 1);
      if (lastCol < LEDGER_HEADERS_16.length) {
        sheet.getRange(1, 1, 1, LEDGER_HEADERS_16.length).setValues([LEDGER_HEADERS_16]);
      }
    }
    return sheet;
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi getOrCreateLedgerSheet: " + err);
    return null;
  }
}

/**
 * Helper parse số tiền an toàn
 */
function parseBizMoney(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;
  const cleanStr = str.replace(/[^0-9-]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

if (typeof parseMoneyNumber === 'undefined') {
  var parseMoneyNumber = parseBizMoney;
}

/**
 * Chuẩn hóa và ánh xạ tên ví / thẻ / đối tác về tên chuẩn chính thức trong Sheet Wallets
 * Xử lý hoàn hảo các biến thể: "Bic C" -> "C- Bic Chi", "Bic KA" -> "C- Bic KA", "Amazon" -> "C- Amazon", v.v.
 */
function resolveWalletCanonicalName(rawName, ssTarget) {
  if (!rawName) return "";
  const clean = String(rawName).trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();

  const aliasMap = {
    // Bic
    "c- bic ka": "C- Bic KA",
    "bic ka": "C- Bic KA",
    "bicka": "C- Bic KA",
    "bicamera ka": "C- Bic KA",
    "c_bic ka": "C- Bic KA",
    "c-bic ka": "C- Bic KA",

    "c- bic chi": "C- Bic Chi",
    "bic chi": "C- Bic Chi",
    "bic c": "C- Bic Chi",
    "bicc": "C- Bic Chi",
    "bicchi": "C- Bic Chi",
    "bicamera chi": "C- Bic Chi",
    "bicamera c": "C- Bic Chi",
    "c_bic chi": "C- Bic Chi",
    "c- bic c": "C- Bic Chi",
    "c-bic chi": "C- Bic Chi",
    "c-bic c": "C- Bic Chi",

    // Rakuten Card
    "c- raku ka": "C- Raku KA",
    "raku ka": "C- Raku KA",
    "rakuka": "C- Raku KA",
    "rakuten ka": "C- Raku KA",
    "c_raku ka": "C- Raku KA",
    "c- rakuten ka": "C- Raku KA",

    "c- raku chi": "C- Raku Chi",
    "raku chi": "C- Raku Chi",
    "raku c": "C- Raku Chi",
    "rakuc": "C- Raku Chi",
    "rakuchi": "C- Raku Chi",
    "rakuten chi": "C- Raku Chi",
    "rakuten c": "C- Raku Chi",
    "c_raku chi": "C- Raku Chi",
    "c- raku c": "C- Raku Chi",
    "c- rakuten chi": "C- Raku Chi",

    // Amazon Card
    "c- amazon": "C- Amazon",
    "amazon": "C- Amazon",
    "amazon chi": "C- Amazon",
    "amz": "C- Amazon",
    "amz chi": "C- Amazon",
    "c_amazon": "C- Amazon",
    "c- amz": "C- Amazon",

    // Yodobashi Card
    "c- yodo ka": "C- Yodo KA",
    "yodo ka": "C- Yodo KA",
    "yodoka": "C- Yodo KA",
    "yodobashi ka": "C- Yodo KA",
    "c_yodo ka": "C- Yodo KA",

    "c- yodo chi": "C- Yodo Chi",
    "yodo chi": "C- Yodo Chi",
    "yodo c": "C- Yodo Chi",
    "yodoc": "C- Yodo Chi",
    "yodochi": "C- Yodo Chi",
    "yodobashi chi": "C- Yodo Chi",
    "yodobashi c": "C- Yodo Chi",
    "c_yodo chi": "C- Yodo Chi",
    "c- yodo c": "C- Yodo Chi",

    // Edion Card
    "c- edion": "C- Edion",
    "edion": "C- Edion",
    "c_edion": "C- Edion",
    "c-edion": "C- Edion",

    // Aeon Card
    "c-aeon": "C-Aeon",
    "c- aeon": "C-Aeon",
    "aeon": "C-Aeon",
    "c_aeon": "C-Aeon",

    // Saison Card
    "c-saison": "C-Saison",
    "c- saison": "C-Saison",
    "saison": "C-Saison",
    "c_saison": "C-Saison",

    // Banks & Cash
    "resona": "Resona",
    "rakub ka": "RakuB KA",
    "rakubka": "RakuB KA",
    "rakuten bank ka": "RakuB KA",
    "rakub chi": "RakuB Chi",
    "rakub c": "RakuB Chi",
    "rakubc": "RakuB Chi",
    "rakubchi": "RakuB Chi",
    "rakuten bank chi": "RakuB Chi",
    "ufj ka": "Ufj KA",
    "ufjka": "Ufj KA",
    "ufj chi": "Ufj Chi",
    "ufj c": "Ufj Chi",
    "ufjc": "Ufj Chi",
    "ufjchi": "Ufj Chi",
    "tiền mặt": "Tiền mặt",
    "tien mat": "Tiền mặt",
    "tienmat": "Tiền mặt",
    "cash": "Tiền mặt",
    "revochi": "RevoChi",
    "revo chi": "RevoChi",
    "revo c": "RevoChi",
    "revoc": "RevoChi",
    "revolut chi": "RevoChi",
    "revolut c": "RevoChi",
    "point": "Point",
    "points": "Point",
    "techcom": "Techcom",
    "tcb": "Techcom",
    "techcombank": "Techcom"
  };

  if (aliasMap[lower]) {
    return aliasMap[lower];
  }

  // Dynamic matching fallback
  try {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (ss) {
      const wSheet = (typeof getSheetByNames === 'function') ? getSheetByNames("Wallets", "Ví", ss) : (ss.getSheetByName("Wallets") || ss.getSheetByName("Ví"));
      if (wSheet && wSheet.getLastRow() >= 2) {
        const wData = wSheet.getRange(2, 2, wSheet.getLastRow() - 1, 1).getValues();
        const normRaw = lower.replace(/^(?:c[\s\-_:]*|thẻ\s+|ví\s+)/i, '').replace(/\s+/g, '').replace(/chi$/, 'c');
        for (let i = 0; i < wData.length; i++) {
          const wName = String(wData[i][0] || "").trim();
          if (!wName) continue;
          const wNameLower = wName.toLowerCase();
          if (wNameLower === lower) return wName;

          const normW = wNameLower.replace(/^(?:c[\s\-_:]*|thẻ\s+|ví\s+)/i, '').replace(/\s+/g, '').replace(/chi$/, 'c');
          if (normW === normRaw) return wName;
        }
      }
    }
  } catch(e) {}

  return clean;
}

/**
 * Trích xuất bản đồ tra cứu ID và Tên chuẩn của Ví/Thẻ từ Sheet Wallets
 */
function getWalletLookupMaps(ssTarget) {
  const maps = {
    nameToId: {},           // canonicalNameLower / aliasLower -> id
    idToName: {},           // idLower -> canonicalName
    idToCanonicalId: {},    // idLower -> exactId
    nameToCanonicalName: {} // aliasLower -> canonicalName
  };

  try {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return maps;

    const wSheet = (typeof getSheetByNames === 'function') ? getSheetByNames("Wallets", "Ví", ss) : (ss.getSheetByName("Wallets") || ss.getSheetByName("Ví"));
    if (wSheet && wSheet.getLastRow() >= 2) {
      const lastCol = Math.max(wSheet.getLastColumn(), 3);
      const data = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, lastCol).getValues();
      for (let i = 0; i < data.length; i++) {
        const id = String(data[i][0] || "").trim();
        const rawName = String(data[i][1] || "").trim();
        if (!rawName && !id) continue;

        const cName = resolveWalletCanonicalName(rawName) || rawName;

        if (id) {
          const idLower = id.toLowerCase();
          maps.idToCanonicalId[idLower] = id;
          if (cName) maps.idToName[idLower] = cName;
        }
        if (cName) {
          const cNameLower = cName.toLowerCase();
          maps.nameToCanonicalName[cNameLower] = cName;
          if (id) maps.nameToId[cNameLower] = id;
        }
        if (rawName && rawName.toLowerCase() !== (cName ? cName.toLowerCase() : '')) {
          const rawLower = rawName.toLowerCase();
          maps.nameToCanonicalName[rawLower] = cName || rawName;
          if (id) maps.nameToId[rawLower] = id;
        }
      }
    }
  } catch(e) {}

  return maps;
}

/**
 * Phân giải cặp { walletId, walletName } chuẩn xác:
 * - walletId: Luôn là ID từ Cột A Sheet Wallets (ví dụ: W_01, W_UFJ_KA, CC_BIC_KA)
 * - walletName: Luôn là Tên chuẩn chính thức (ví dụ: Ufj KA, Resona, C- Bic Chi)
 */
function resolveWalletAndId(rawWalletId, rawWalletName, walletMaps, ssTarget) {
  let maps = walletMaps;
  if (!maps || !maps.nameToId) {
    maps = getWalletLookupMaps(ssTarget);
  }

  let wId = String(rawWalletId || "").trim();
  let wName = String(rawWalletName || "").trim();

  // 1. Nếu chưa có wName nhưng có wId
  if (!wName && wId) {
    const idLower = wId.toLowerCase();
    if (maps.idToName && maps.idToName[idLower]) {
      wName = maps.idToName[idLower];
      wId = maps.idToCanonicalId[idLower] || wId;
    } else {
      // wId có thể thực chất là tên ví (VD: truyền "Resona" vào trường walletId)
      const cName = resolveWalletCanonicalName(wId);
      wName = cName || wId;
      if (maps.nameToId && maps.nameToId[wName.toLowerCase()]) {
        wId = maps.nameToId[wName.toLowerCase()];
      }
    }
  }

  // 2. Chuẩn hóa tên ví theo Canonical Name
  if (wName) {
    const cName = resolveWalletCanonicalName(wName);
    if (cName) wName = cName;
    const nameLower = wName.toLowerCase();
    if (maps.nameToId && maps.nameToId[nameLower]) {
      wId = maps.nameToId[nameLower];
    }
  }

  // 3. Nếu wId được truyền vào nhưng là tên ví hoặc alias
  if (wId && maps.idToCanonicalId && !maps.idToCanonicalId[wId.toLowerCase()]) {
    const idAsName = resolveWalletCanonicalName(wId);
    if (maps.nameToId && maps.nameToId[idAsName.toLowerCase()]) {
      wId = maps.nameToId[idAsName.toLowerCase()];
      if (!wName) wName = idAsName;
    }
  }

  // 4. Nếu wId là ID hợp lệ, chuẩn hóa lại exact casing
  if (wId && maps.idToCanonicalId && maps.idToCanonicalId[wId.toLowerCase()]) {
    wId = maps.idToCanonicalId[wId.toLowerCase()];
  }

  // 5. Fallback cho đối tác công nợ không nằm trong Sheet Wallets (VD: Khách Nợ, Đối tác)
  if (!wId && wName) wId = wName;
  if (!wName && wId) wName = wId;

  return { walletId: wId, walletName: wName };
}

/**
 * Kiểm tra xem một nguồn tiền / ví / thẻ có tồn tại hợp lệ trong Sheet Wallets hay không
 * @param {String} walletNameOrId Tên ví, ID ví, hoặc alias
 * @param {Spreadsheet} ssTarget Spreadsheet instance
 * @returns {Boolean} true nếu tồn tại hợp lệ trong Wallets, false nếu không
 */
function validateWalletExists(walletNameOrId, ssTarget) {
  if (!walletNameOrId) return false;
  const rawStr = String(walletNameOrId).trim();
  if (!rawStr) return false;

  try {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    if (!ss) return true;

    const wSheet = (typeof getSheetByNames === 'function') ? getSheetByNames("Wallets", "Ví", ss) : (ss.getSheetByName("Wallets") || ss.getSheetByName("Ví"));
    if (!wSheet || wSheet.getLastRow() < 2) {
      return false;
    }

    const maps = getWalletLookupMaps(ss);
    const lower = rawStr.toLowerCase();

    // 1. Khớp trực tiếp ID hoặc Tên chuẩn trong Wallets
    if (maps.idToCanonicalId && maps.idToCanonicalId[lower]) return true;
    if (maps.idToName && maps.idToName[lower]) return true;
    if (maps.nameToId && maps.nameToId[lower]) return true;
    if (maps.nameToCanonicalName && maps.nameToCanonicalName[lower]) return true;

    // 2. Thử chuẩn hóa Canonical Name và kiểm tra lại
    const canonicalName = resolveWalletCanonicalName(rawStr, ss);
    if (canonicalName) {
      const cLower = canonicalName.toLowerCase();
      if (maps.nameToId && maps.nameToId[cLower]) return true;
      if (maps.nameToCanonicalName && maps.nameToCanonicalName[cLower]) return true;
    }

    // 3. Quét kiểm tra mềm (loại bỏ tiền tố 'thẻ ', 'ví ', 'c-', v.v.)
    const cleanRaw = lower.replace(/^(?:c[\s\-_:]*|thẻ\s+|ví\s+)/i, '').replace(/\s+/g, '');
    for (const k in maps.nameToId) {
      const cleanK = k.replace(/^(?:c[\s\-_:]*|thẻ\s+|ví\s+)/i, '').replace(/\s+/g, '');
      if (cleanK && cleanK === cleanRaw) return true;
    }

    return false;
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi validateWalletExists: " + err);
    return false;
  }
}

if (typeof global !== 'undefined') {
  global.validateWalletExists = validateWalletExists;
}

/**
 * Trích xuất tên thẻ và ví nguồn thanh toán từ nội dung tất toán
 * Hỗ trợ mọi cấu trúc câu: "Tất toán thẻ: Bic C từ Ufj Chi", "Tất toán thẻ Bic KA từ Ufj KA", "Tất toán Bic KA", v.v.
 */
function parseSettlementDetails(noiDung, defaultSourceWallet) {
  if (!noiDung) return { cardName: "", sourceWallet: defaultSourceWallet || "" };
  let str = String(noiDung).trim();
  str = str.replace(/^tất\s+toán\s*(thẻ)?\s*:?\s*/i, '').trim();

  let rawCard = "";
  let rawSource = defaultSourceWallet || "";

  if (/\s+từ\s+/i.test(str)) {
    const parts = str.split(/\s+từ\s+/i);
    rawCard = parts[0] ? parts[0].trim() : "";
    if (parts.length > 1 && parts[1]) rawSource = parts[1].trim();
  } else if (/\s*->\s*/.test(str)) {
    const parts = str.split(/\s*->\s*/);
    rawCard = parts[0] ? parts[0].trim() : "";
    if (parts.length > 1 && parts[1]) rawSource = parts[1].trim();
  } else {
    rawCard = str;
  }

  const cardName = resolveWalletCanonicalName(rawCard);
  const sourceWallet = resolveWalletCanonicalName(rawSource);

  return { cardName, sourceWallet, rawCard, rawSource };
}

/**
 * Format ngày chuẩn ISO YYYY-MM-DD cho WalletLedger
 */
function formatLedgerDate(val) {
  if (!val) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const str = String(val).trim();
  if (!str) return "";

  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.split(' ')[0].split('-');
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
    const parts = str.split(' ')[0].split('/');
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = "20" + y;
    return `${y}-${m}-${d}`;
  }

  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
  } catch(e) {}

  return str;
}

/**
 * Helper so sánh an toàn thời gian giao dịch so với mốc Checkpoint
 */
function isDateOnOrAfterCheckpoint(txDateVal, cpDateObj) {
  if (!cpDateObj) return true;
  if (!txDateVal) return false;

  let txDateObj = (txDateVal instanceof Date) ? txDateVal : null;
  if (!txDateObj) {
    const str = String(txDateVal).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
      const parts = str.split(' ')[0].split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      txDateObj = new Date(y, m - 1, d);
    } else if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
      const parts = str.split(' ')[0].split('/');
      const d = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      let y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
      txDateObj = new Date(y, m - 1, d);
    } else {
      try { txDateObj = new Date(str); } catch(e) {}
    }
  }

  if (!txDateObj || isNaN(txDateObj.getTime())) return false;

  const txDayVal = txDateObj.getFullYear() * 10000 + (txDateObj.getMonth() + 1) * 100 + txDateObj.getDate();
  const cpDayVal = cpDateObj.getFullYear() * 10000 + (cpDateObj.getMonth() + 1) * 100 + cpDateObj.getDate();

  return txDayVal >= cpDayVal;
}

/**
 * Validate một danh sách events trước khi ghi
 */
function validateFinancialEvents(eventList) {
  if (!Array.isArray(eventList) || eventList.length === 0) {
    return { valid: false, message: "Danh sách event trống." };
  }

  const validDirections = ["IN", "OUT", "INCREASE", "DECREASE"];
  const validEffectTypes = ["CASH", "CARD_DEBT", "PARTNER_RECEIVABLE", "PARTNER_PAYABLE", "PARTNER_DEBT"];

  for (let i = 0; i < eventList.length; i++) {
    const ev = eventList[i];
    if (!ev.walletName && !ev.walletId && !ev.account) {
      return { valid: false, message: `Event [${i}] thiếu WalletID / WalletName.` };
    }
    const amt = parseBizMoney(ev.amount);
    if (isNaN(amt) || amt <= 0) {
      return { valid: false, message: `Event [${i}] có số tiền không hợp lệ: ${ev.amount}` };
    }
    if (!validDirections.includes(String(ev.direction).trim().toUpperCase())) {
      return { valid: false, message: `Event [${i}] có Direction không hợp lệ: ${ev.direction}` };
    }
    const eff = String(ev.effectType || ev.type || "").trim().toUpperCase();
    if (!validEffectTypes.includes(eff)) {
      return { valid: false, message: `Event [${i}] thiếu hoặc sai EffectType (CASH, CARD_DEBT, PARTNER_RECEIVABLE, PARTNER_PAYABLE).` };
    }
  }

  return { valid: true };
}

/**
 * 1. GHI HÀNG LOẠT BÚT TOÁN TÀI CHÍNH (ATOMIC POST WITH LOCKSERVICE & 8-PART IDEMPOTENCY)
 * @param {Array<Object>} eventList Danh sách events cần ghi
 * @param {Spreadsheet} ssTarget Spreadsheet instance (optional)
 * @returns {Object} { success: Boolean, postedCount: Number, duplicateCount: Number, message: String }
 */
function postFinancialEvents(eventList, ssTarget) {
  const validation = validateFinancialEvents(eventList);
  if (!validation.valid) {
    return { success: false, message: "❌ Lỗi validation event: " + validation.message };
  }

  let lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
    }
  } catch(e) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Warning ScriptLock: " + e);
  }

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateLedgerSheet(ss);
    if (!sheet) {
      return { success: false, message: "❌ Không thể khởi tạo Sheet WalletLedger." };
    }

    const lastRow = sheet.getLastRow();
    const existingIdemMap = new Map(); // IdempotencyKey -> Status

    if (lastRow >= 2) {
      const lastCol = Math.max(sheet.getLastColumn(), 16);
      const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
      for (let i = 0; i < data.length; i++) {
        const rowIdem = String(data[i][10] || "").trim(); // Col K: IdempotencyKey (index 10)
        const rowStatus = String(data[i][11] || "").trim().toUpperCase(); // Col L: Status (index 11)
        if (rowIdem) {
          existingIdemMap.set(rowIdem, rowStatus);
        }
      }
    }

    const rowsToAppend = [];
    const nowIso = new Date().toISOString();
    let duplicateCount = 0;
    const walletMaps = getWalletLookupMaps(ss);

    for (let i = 0; i < eventList.length; i++) {
      const ev = eventList[i];
      const resolved = resolveWalletAndId(ev.walletId, ev.walletName || ev.account, walletMaps, ss);
      const wId = resolved.walletId;
      const wName = resolved.walletName;
      const dir = String(ev.direction).trim().toUpperCase();
      
      let effectType = String(ev.effectType || ev.type || "CASH").trim().toUpperCase();
      if (effectType === "PARTNER_DEBT") effectType = "PARTNER_RECEIVABLE";

      const srcModule = String(ev.sourceModule || ev.module || ev.refSource || "System").trim();
      const srcId = String(ev.sourceId || ev.id || ev.refId || "GEN").trim();
      const paymentId = String(ev.paymentId || "FULL").trim();
      const eventType = String(ev.eventType || ev.loai || "EVENT").trim().toUpperCase();
      const rev = (ev.rev !== undefined) ? String(ev.rev) : "0";

      // Khóa chống trùng 8 thành phần chuẩn xác
      const idemKey = ev.idempotencyKey ? String(ev.idempotencyKey).trim() : `${srcModule}_${srcId}_${paymentId}_${wId || wName}_${eventType}_${effectType}_${dir}_${rev}`;

      // Chống ghi trùng chỉ đối với các dòng POSTED
      if (existingIdemMap.get(idemKey) === "POSTED") {
        duplicateCount++;
        continue;
      }

      const ledgerId = ev.ledgerId || ((typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("LED-") : ("LED-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900)));
      const dateStr = formatLedgerDate(ev.date || ev.transactionDate || new Date());
      const amt = parseBizMoney(ev.amount);
      const noteStr = String(ev.note || ev.ghiChu || ev.noiDung || "").trim();
      const statusStr = String(ev.status || "POSTED").trim().toUpperCase();
      const reversalOf = String(ev.reversalOf || "").trim();
      const checkpointRef = String(ev.checkpointRef || "").trim();

      rowsToAppend.push([
        ledgerId,                       // 0: A - LedgerID
        wId,                            // 1: B - WalletID
        wName,                          // 2: C - WalletName
        dateStr,                        // 3: D - Date (YYYY-MM-DD)
        amt,                            // 4: E - Amount
        dir,                            // 5: F - Direction (IN, OUT, INCREASE, DECREASE)
        effectType,                     // 6: G - EffectType (CASH, CARD_DEBT, PARTNER_RECEIVABLE, PARTNER_PAYABLE)
        srcModule,                      // 7: H - SourceModule (Family, Purchase, Sales, Debt, Transfer, TripSplit, System)
        srcId,                          // 8: I - SourceID
        eventType,                      // 9: J - EventType
        idemKey,                        // 10: K - IdempotencyKey
        statusStr,                      // 11: L - Status (POSTED, REVERSED)
        noteStr,                        // 12: M - Note
        nowIso,                         // 13: N - CreatedAt
        reversalOf,                     // 14: O - ReversalOf
        checkpointRef                   // 15: P - CheckpointRef
      ]);

      existingIdemMap.set(idemKey, statusStr);
    }

    if (rowsToAppend.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rowsToAppend.length, 16).setValues(rowsToAppend);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return {
      success: true,
      postedCount: rowsToAppend.length,
      duplicateCount: duplicateCount,
      message: `✅ Đã ghi ${rowsToAppend.length} bút toán vào Sổ Cái (${duplicateCount} bỏ qua do trùng lặp).`
    };

  } catch(err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi postFinancialEvents: " + err);
    return { success: false, message: "❌ Lỗi postFinancialEvents: " + err.toString() };
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}

/**
 * 2. ĐẢO / XÓA BÚT TOÁN (REVERSE / DELETE FINANCIAL EVENTS)
 * - Nếu chưa chốt sổ (CheckpointRef == ""): XÓA TRỰC TIẾP dòng bút toán khỏi WalletLedger để Sổ Cái luôn gọn gàng 1:1.
 * - Nếu đã chốt sổ (CheckpointRef != ""): Chặn thao tác, báo lỗi yêu cầu tạo bút toán điều chỉnh (ADJUSTMENT).
 */
function reverseFinancialEvents(sourceId, reason, ssTarget) {
  if (!sourceId) return { success: false, message: "❌ Thiếu SourceID để đảo ngược." };

  let lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
    }
  } catch(e) {}

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateLedgerSheet(ss);
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, reversedCount: 0, message: "Sheet WalletLedger trống." };
    }

    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(sheet.getLastColumn(), 16);
    const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const data = range.getValues();
    const matchingRowIndices = [];

    for (let i = 0; i < data.length; i++) {
      const rowSrcId = String(data[i][8] || "").trim(); // Col I: SourceID

      if (rowSrcId === String(sourceId).trim()) {
        // 1. Kiểm tra nếu giao dịch đã bị khóa bởi CheckpointRef -> Chặn xóa trực tiếp
        const rowCpRef = String(data[i][15] || "").trim();
        if (rowCpRef) {
          return {
            success: false,
            message: `❌ Bút toán [${data[i][0]}] đã được chốt sổ trong kỳ [${rowCpRef}], không thể xóa/sửa trực tiếp. Vui lòng tạo bút toán điều chỉnh (ADJUSTMENT)!`
          };
        }
        matchingRowIndices.push(i);
      }
    }

    if (matchingRowIndices.length === 0) {
      return { success: true, reversedCount: 0, deletedCount: 0, message: "Không tìm thấy bút toán nào của SourceID: " + sourceId };
    }

    // Xóa trực tiếp các dòng từ dưới lên trên để không làm lệch chỉ số dòng
    matchingRowIndices.sort((a, b) => b - a);
    for (let idx of matchingRowIndices) {
      sheet.deleteRow(idx + 2); // 1-based row in sheet
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return {
      success: true,
      reversedCount: matchingRowIndices.length,
      deletedCount: matchingRowIndices.length,
      message: `✅ Đã xóa trực tiếp ${matchingRowIndices.length} bút toán Sổ Cái cho SourceID: ${sourceId}`
    };

  } catch(err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi reverseFinancialEvents: " + err);
    return { success: false, message: "❌ Lỗi reverseFinancialEvents: " + err.toString() };
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}

/**
 * 3. SỬA GIAO DỊCH TRỰC TIẾP / IN-PLACE REPLACEMENT (NẾU CHƯA CHECKPOINT)
 * - Nếu chưa chốt sổ (CheckpointRef == ""): GHI ĐÈ TRỰC TIẾP vào các dòng hiện có của SourceID, không sinh thêm dòng REV-.
 * - Nếu đã chốt sổ (CheckpointRef != ""): Chặn thao tác, yêu cầu tạo bút toán điều chỉnh.
 */
function replaceFinancialEvents(sourceId, newEvents, reason, ssTarget) {
  if (!sourceId) return { success: false, message: "❌ Thiếu SourceID." };

  let lock = null;
  try {
    if (typeof LockService !== 'undefined' && LockService.getScriptLock) {
      lock = LockService.getScriptLock();
      lock.waitLock(15000);
    }
  } catch(e) {}

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateLedgerSheet(ss);
    if (!sheet) return { success: false, message: "❌ Không thể mở Sheet WalletLedger." };

    const lastRow = sheet.getLastRow();
    const matchingRowIndices = [];
    let data = [];

    if (lastRow >= 2) {
      const lastCol = Math.max(sheet.getLastColumn(), 16);
      data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      for (let i = 0; i < data.length; i++) {
        const rowSrcId = String(data[i][8] || "").trim(); // Col I: SourceID
        if (rowSrcId === String(sourceId).trim()) {
          const rowCpRef = String(data[i][15] || "").trim(); // Col P: CheckpointRef
          if (rowCpRef) {
            return {
              success: false,
              message: `❌ Bút toán [${data[i][0]}] đã được chốt sổ trong kỳ [${rowCpRef}], không thể sửa trực tiếp. Vui lòng tạo bút toán điều chỉnh (ADJUSTMENT)!`
            };
          }
          matchingRowIndices.push(i);
        }
      }
    }

    // Nếu không có bút toán mới -> xóa các dòng cũ
    if (!Array.isArray(newEvents) || newEvents.length === 0) {
      if (matchingRowIndices.length > 0) {
        matchingRowIndices.sort((a, b) => b - a);
        for (let idx of matchingRowIndices) {
          sheet.deleteRow(idx + 2);
        }
      }
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      return { success: true, message: "✅ Đã xóa toàn bộ bút toán Sổ Cái của SourceID: " + sourceId };
    }

    // Validate danh sách events mới
    const validation = validateFinancialEvents(newEvents);
    if (!validation.valid) {
      return { success: false, message: "❌ Lỗi validation event mới: " + validation.message };
    }

    const walletMaps = getWalletLookupMaps(ss);
    const nowIso = new Date().toISOString();
    const formattedRows = [];

    for (let k = 0; k < newEvents.length; k++) {
      const ev = newEvents[k];
      const resolved = resolveWalletAndId(ev.walletId, ev.walletName || ev.account, walletMaps, ss);
      const wId = resolved.walletId;
      const wName = resolved.walletName;
      const dir = String(ev.direction).trim().toUpperCase();

      let effectType = String(ev.effectType || ev.type || "CASH").trim().toUpperCase();
      if (effectType === "PARTNER_DEBT") effectType = "PARTNER_RECEIVABLE";

      const srcModule = String(ev.sourceModule || ev.module || ev.refSource || "Family").trim();
      const srcId = String(sourceId).trim();
      const paymentId = String(ev.paymentId || "FULL").trim();
      const eventType = String(ev.eventType || ev.loai || "EVENT").trim().toUpperCase();
      const rev = (ev.rev !== undefined) ? String(ev.rev) : "0";

      const idemKey = ev.idempotencyKey ? String(ev.idempotencyKey).trim() : `${srcModule}_${srcId}_${paymentId}_${wId || wName}_${eventType}_${effectType}_${dir}_${rev}`;

      let ledgerId = ev.ledgerId;
      let createdAt = nowIso;
      if (k < matchingRowIndices.length) {
        const origRowIdx = matchingRowIndices[k];
        if (!ledgerId) ledgerId = String(data[origRowIdx][0] || "").trim();
        if (data[origRowIdx][13]) createdAt = String(data[origRowIdx][13]);
      }
      if (!ledgerId) {
        ledgerId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("LED-") : ("LED-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900));
      }

      const dateStr = formatLedgerDate(ev.date || ev.transactionDate || new Date());
      const amt = parseBizMoney(ev.amount);
      const noteStr = String(ev.note || ev.ghiChu || ev.noiDung || "").trim();
      const statusStr = String(ev.status || "POSTED").trim().toUpperCase();

      formattedRows.push([
        ledgerId,                       // 0: LedgerID
        wId,                            // 1: WalletID
        wName,                          // 2: WalletName
        dateStr,                        // 3: Date (YYYY-MM-DD)
        amt,                            // 4: Amount
        dir,                            // 5: Direction
        effectType,                     // 6: EffectType
        srcModule,                      // 7: SourceModule
        srcId,                          // 8: SourceID
        eventType,                      // 9: EventType
        idemKey,                        // 10: IdempotencyKey
        statusStr,                      // 11: Status
        noteStr,                        // 12: Note
        createdAt,                      // 13: CreatedAt
        "",                             // 14: ReversalOf
        ""                              // 15: CheckpointRef
      ]);
    }

    if (matchingRowIndices.length === 0) {
      // Không có dòng cũ nào -> append toàn bộ
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, formattedRows.length, 16).setValues(formattedRows);
    } else {
      // Ghi đè vào các dòng khớp hiện có
      const overwriteCount = Math.min(matchingRowIndices.length, formattedRows.length);
      for (let k = 0; k < overwriteCount; k++) {
        const rowIdx = matchingRowIndices[k];
        const sheetRowNum = rowIdx + 2;
        sheet.getRange(sheetRowNum, 1, 1, 16).setValues([formattedRows[k]]);
      }

      // Nếu số dòng mới ít hơn số dòng cũ -> xóa các dòng thừa (từ dưới lên)
      if (formattedRows.length < matchingRowIndices.length) {
        const excessIndices = matchingRowIndices.slice(formattedRows.length);
        excessIndices.sort((a, b) => b - a);
        for (let idx of excessIndices) {
          sheet.deleteRow(idx + 2);
        }
      }
      // Nếu số dòng mới nhiều hơn số dòng cũ -> append các dòng còn lại
      else if (formattedRows.length > matchingRowIndices.length) {
        const extraRows = formattedRows.slice(matchingRowIndices.length);
        const startRow = sheet.getLastRow() + 1;
        sheet.getRange(startRow, 1, extraRows.length, 16).setValues(extraRows);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return {
      success: true,
      replacedCount: formattedRows.length,
      message: `✅ Đã ghi đè trực tiếp ${formattedRows.length} bút toán Sổ Cái cho SourceID: ${sourceId}`
    };

  } catch(err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi replaceFinancialEvents: " + err);
    return { success: false, message: "❌ Lỗi replaceFinancialEvents: " + err.toString() };
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch(e) {}
    }
  }
}

/**
 * 4. ĐÁNH DẤU MỐC CHECKPOINT TRÊN CÁC DÒNG SỔ CÁI (AUDIT & CHECKPOINT FLAGGING)
 * Khi chốt sổ ví/thẻ, toàn bộ dòng chưa chốt (CheckpointRef == "") sẽ được điền mã checkpointId
 */
function markCheckpointInLedger(walletId, walletName, checkpointId, ssTarget) {
  if (!checkpointId) return { success: false, message: "Thiếu CheckpointID." };

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateLedgerSheet(ss);
    if (!sheet || sheet.getLastRow() < 2) return { success: true, markedCount: 0 };

    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(sheet.getLastColumn(), 16);
    const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const data = range.getValues();
    let markedCount = 0;

    const targetWId = String(walletId || "").trim().toLowerCase();
    const targetWName = String(walletName || "").trim().toLowerCase();

    for (let i = 0; i < data.length; i++) {
      const rowWId = String(data[i][1] || "").trim().toLowerCase();
      const rowWName = String(data[i][2] || "").trim().toLowerCase();
      const rowCpRef = String(data[i][15] || "").trim();

      const matchWallet = (!targetWId && !targetWName) ||
                          (targetWId && rowWId === targetWId) ||
                          (targetWName && rowWName === targetWName);

      if (matchWallet && !rowCpRef) {
        data[i][15] = checkpointId; // Col P: CheckpointRef (index 15)
        markedCount++;
      }
    }

    if (markedCount > 0) {
      range.setValues(data);
    }

    return {
      success: true,
      markedCount: markedCount,
      message: `✅ Đã đánh dấu CheckpointRef [${checkpointId}] cho ${markedCount} bút toán.`
    };
  } catch(err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi markCheckpointInLedger: " + err);
    return { success: false, message: "❌ Lỗi markCheckpointInLedger: " + err.toString() };
  }
}

/**
 * 5. TÍNH SỐ DƯ TIỀN MẶT / VÍ DEBIT (CASH) TỪ CHECKPOINT + WALLET LEDGER
 */
function getWalletBalancesFromLedger(month, year, ssTarget) {
  const balances = {}; // walletKey -> { inc: 0, dec: 0, delta: 0, currentBalance: 0 }
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { balances, checkpointMap: {} };

    // 1. Tải Checkpoints mới nhất từ WalletCheckpoints
    const checkpointMap = {}; // walletKey -> { balance: Number, dateStr: String, dateObj: Date, checkpointId: String }
    const cpSheet = ss.getSheetByName(SHEET_WALLET_CHECKPOINTS);
    if (cpSheet && cpSheet.getLastRow() >= 2) {
      const cpData = cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, Math.max(cpSheet.getLastColumn(), 8)).getValues();
      cpData.forEach(r => {
        const cpId = String(r[0] || "").trim();
        const wId = String(r[1] || "").trim().toLowerCase();
        const wName = String(r[2] || "").trim().toLowerCase();
        const cpDateRaw = r[3];
        const cpBal = parseBizMoney(r[4]);
        const status = String(r[7] || "ACTIVE").trim().toUpperCase();

        if (status === "ACTIVE") {
          let dObj = (typeof parseServerDate === 'function') ? parseServerDate(cpDateRaw) : new Date(cpDateRaw);
          const cpInfo = { balance: cpBal, dateStr: String(cpDateRaw), dateObj: dObj, checkpointId: cpId };
          if (wName) checkpointMap[wName] = cpInfo;
          if (wId) checkpointMap[wId] = cpInfo;
        }
      });
    }

    // Khởi tạo balances cho mọi ví có trong Checkpoints
    Object.keys(checkpointMap).forEach(k => {
      if (!balances[k]) {
        balances[k] = { inc: 0, dec: 0, delta: 0, name: k, currentBalance: checkpointMap[k].balance };
      }
    });

    // 2. Đọc Ledger 16 Cột
    const lSheet = ss.getSheetByName(SHEET_WALLET_LEDGER);
    if (!lSheet || lSheet.getLastRow() < 2) {
      return { balances, checkpointMap };
    }

    const lData = lSheet.getRange(2, 1, lSheet.getLastRow() - 1, Math.max(lSheet.getLastColumn(), 16)).getValues();

    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const isAllYear = (!year || year === "ALL" || String(year).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = isAllYear ? null : parseInt(year, 10);

    for (let i = 0; i < lData.length; i++) {
      const status = String(lData[i][11] || "").trim().toUpperCase(); // Col L: Status
      if (status !== "POSTED") continue;

      const effectType = String(lData[i][6] || "").trim().toUpperCase(); // Col G: EffectType
      if (effectType !== "CASH") continue;

      const cpRef = String(lData[i][15] || "").trim(); // Col P: CheckpointRef

      const wName = String(lData[i][2] || lData[i][1] || "").trim();
      if (!wName) continue;
      const accKey = wName.toLowerCase();

      const dStr = lData[i][3]; // Col D: Date (YYYY-MM-DD)
      const dObj = (typeof parseServerDate === 'function') ? parseServerDate(dStr) : new Date(dStr);
      const m = dObj ? (dObj.getMonth() + 1) : null;
      const y = dObj ? dObj.getFullYear() : null;

      const matchMonth = isAllMonth || !m || m === targetMonth;
      const matchYear = isAllYear || !y || y === targetYear;

      if (!matchMonth || !matchYear) continue;

      // CÁCH 2: Nếu đã có CheckpointRef -> Dòng này đã nằm trong mốc chốt trước đó -> Bỏ qua
      if (cpRef) continue;

      const dir = String(lData[i][5] || "").trim().toUpperCase(); // Col F: Direction
      const amt = parseBizMoney(lData[i][4]); // Col E: Amount

      if (!balances[accKey]) {
        balances[accKey] = { inc: 0, dec: 0, delta: 0, name: wName };
      }

      if (dir === "IN") {
        balances[accKey].inc += amt;
      } else if (dir === "OUT") {
        balances[accKey].dec += amt;
      }
    }

    // Tính delta và final balance
    Object.keys(balances).forEach(k => {
      balances[k].delta = balances[k].inc - balances[k].dec;
      const cp = checkpointMap[k];
      const baseBal = cp ? cp.balance : 0;
      balances[k].currentBalance = baseBal + balances[k].delta;
    });

    return { balances, checkpointMap };

  } catch(err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi getWalletBalancesFromLedger: " + err);
    return { balances: {}, checkpointMap: {} };
  }
}

/**
 * 6. TÍNH DƯ NỢ THẺ TÍN DỤNG (CARD_DEBT) TỪ WALLET LEDGER
 */
function getCardDebtFromLedger(month, year, ssTarget) {
  const cardDebts = {}; // cardKey -> { increase: 0, decrease: 0, currentDebt: 0, name: cardName }
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return cardDebts;

    const lSheet = ss.getSheetByName(SHEET_WALLET_LEDGER);
    if (!lSheet || lSheet.getLastRow() < 2) return cardDebts;

    const lData = lSheet.getRange(2, 1, lSheet.getLastRow() - 1, Math.max(lSheet.getLastColumn(), 16)).getValues();

    for (let i = 0; i < lData.length; i++) {
      const status = String(lData[i][11] || "").trim().toUpperCase(); // Col L: Status
      if (status !== "POSTED") continue;

      const effectType = String(lData[i][6] || "").trim().toUpperCase(); // Col G: EffectType
      if (effectType !== "CARD_DEBT") continue;

      const cpRef = String(lData[i][15] || "").trim();
      if (cpRef) continue; // Bỏ qua nếu đã chốt

      const cardName = String(lData[i][2] || lData[i][1] || "").trim();
      if (!cardName) continue;
      const cardKey = cardName.toLowerCase();

      const dir = String(lData[i][5] || "").trim().toUpperCase(); // Col F: Direction
      const amt = parseBizMoney(lData[i][4]);

      if (!cardDebts[cardKey]) {
        cardDebts[cardKey] = { increase: 0, decrease: 0, currentDebt: 0, name: cardName };
      }

      if (dir === "INCREASE") {
        cardDebts[cardKey].increase += amt;
      } else if (dir === "DECREASE") {
        cardDebts[cardKey].decrease += amt;
      }
    }

    Object.keys(cardDebts).forEach(k => {
      cardDebts[k].currentDebt = cardDebts[k].increase - cardDebts[k].decrease;
    });

    return cardDebts;
  } catch(err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi getCardDebtFromLedger: " + err);
    return {};
  }
}

/**
 * 7. TÍNH CÔNG NỢ ĐỐI TÁC (PHẢI THU / PHẢI TRẢ) TỪ WALLET LEDGER
 */
function getPartnerDebtFromLedger(ssTarget) {
  const result = {
    receivables: {}, // partnerKey -> { name, total: Number }
    payables: {},    // partnerKey -> { name, total: Number }
    totalReceivable: 0,
    totalPayable: 0
  };

  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return result;

    const lSheet = ss.getSheetByName(SHEET_WALLET_LEDGER);
    if (!lSheet || lSheet.getLastRow() < 2) return result;

    const lData = lSheet.getRange(2, 1, lSheet.getLastRow() - 1, Math.max(lSheet.getLastColumn(), 16)).getValues();

    for (let i = 0; i < lData.length; i++) {
      const status = String(lData[i][11] || "").trim().toUpperCase();
      if (status !== "POSTED") continue;

      const effectType = String(lData[i][6] || "").trim().toUpperCase();
      const pName = String(lData[i][2] || lData[i][1] || "").trim();
      if (!pName) continue;
      const pKey = pName.toLowerCase();

      const dir = String(lData[i][5] || "").trim().toUpperCase();
      const amt = parseBizMoney(lData[i][4]);

      if (effectType === "PARTNER_RECEIVABLE" || effectType === "PARTNER_DEBT") {
        if (!result.receivables[pKey]) result.receivables[pKey] = { name: pName, increase: 0, decrease: 0, total: 0 };
        if (dir === "INCREASE") result.receivables[pKey].increase += amt;
        else if (dir === "DECREASE") result.receivables[pKey].decrease += amt;
      } else if (effectType === "PARTNER_PAYABLE") {
        if (!result.payables[pKey]) result.payables[pKey] = { name: pName, increase: 0, decrease: 0, total: 0 };
        if (dir === "INCREASE") result.payables[pKey].increase += amt;
        else if (dir === "DECREASE") result.payables[pKey].decrease += amt;
      }
    }

    // Tổng hợp nợ từng đối tác (không tự cấn trừ ngầm)
    Object.keys(result.receivables).forEach(k => {
      const net = Math.max(0, result.receivables[k].increase - result.receivables[k].decrease);
      result.receivables[k].total = net;
      result.totalReceivable += net;
    });

    Object.keys(result.payables).forEach(k => {
      const net = Math.max(0, result.payables[k].increase - result.payables[k].decrease);
      result.payables[k].total = net;
      result.totalPayable += net;
    });

    return result;
  } catch(err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi getPartnerDebtFromLedger: " + err);
    return result;
  }
}

/**
 * 8. MIGRATION & RECONCILIATION ENGINE (DRY-RUN & COMMIT)
 * Quét toàn bộ lịch sử từ Family, Purchase, Sales, Debt -> sinh events 16 cột -> đối chiếu số dư -> nạp vào WalletLedger
 * @param {Object} options { dryRun: Boolean, cutoverDate: String (YYYY-MM-DD) }
 * @param {Spreadsheet} ssTarget
 */
function syncLedgerFromHistory(options, ssTarget) {
  const isDryRun = options && options.dryRun !== false;
  const cutoverDate = options && options.cutoverDate ? String(options.cutoverDate).trim() : null;
  const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { success: false, message: "Không tìm thấy Spreadsheet." };

  const walletMaps = getWalletLookupMaps(ss);
  const events = [];

  // 1. Quét Sheet Family (Thu Chi, Chuyển tiền, Tất toán)
  const fSheet = (typeof getSheetByNames === 'function') ? getSheetByNames("Family", "ThuChi", ss) : (ss.getSheetByName("Family") || ss.getSheetByName("ThuChi"));
  if (fSheet && fSheet.getLastRow() >= 2) {
    const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, Math.max(fSheet.getLastColumn(), 10)).getValues();
    fData.forEach(row => {
      const id = String(row[0] || "").trim();
      const dateStr = formatLedgerDate(row[1]);
      const loai = String(row[2] || "").trim().toLowerCase();
      const hu = String(row[3] || "").trim().toLowerCase();
      const noiDung = String(row[4] || "").trim();
      const amt = parseBizMoney(row[5]);
      const rawWallet = String(row[6] || "").trim();
      const resolved = resolveWalletAndId("", rawWallet, walletMaps, ss);
      const walletName = resolved.walletName;
      const walletId = resolved.walletId;

      if (!walletName || amt <= 0) return;

      const isTransfer = hu.includes("ck nội bộ") || noiDung.includes("Chuyển tiền:");
      const isSettlement = hu.includes("tất toán thẻ") || noiDung.toLowerCase().includes("tất toán thẻ") || noiDung.toLowerCase().includes("tất toán");
      const isGroupAdvance = noiDung.includes("[Ứng hộ nhóm]") || hu.includes("ứng hộ nhóm");

      if (isTransfer) {
        // Chuyển tiền 2 vế
        const parts = noiDung.split("->");
        const rawDest = parts.length > 1 ? parts[1].trim() : "";
        const destResolved = resolveWalletAndId("", rawDest, walletMaps, ss);
        const destWallet = destResolved.walletName;
        const destWalletId = destResolved.walletId;

        events.push({
          walletId: walletId,
          walletName: walletName,
          date: dateStr,
          amount: amt,
          direction: "OUT",
          effectType: "CASH",
          sourceModule: "Transfer",
          sourceId: id,
          eventType: "TRANSFER_OUT",
          note: noiDung
        });
        if (destWallet) {
          events.push({
            walletId: destWalletId,
            walletName: destWallet,
            date: dateStr,
            amount: amt,
            direction: "IN",
            effectType: "CASH",
            sourceModule: "Transfer",
            sourceId: id,
            eventType: "TRANSFER_IN",
            note: noiDung
          });
        }
      } else if (isSettlement) {
        // Tất toán thẻ 2 vế: Giảm tiền ở ví Debit (OUT CASH) và Giảm nợ ở thẻ Credit (DECREASE CARD_DEBT)
        const settleInfo = parseSettlementDetails(noiDung, walletName);
        const srcResolved = resolveWalletAndId("", settleInfo.sourceWallet || walletName, walletMaps, ss);
        const cardResolved = resolveWalletAndId("", settleInfo.cardName, walletMaps, ss);

        events.push({
          walletId: srcResolved.walletId,
          walletName: srcResolved.walletName,
          date: dateStr,
          amount: amt,
          direction: "OUT",
          effectType: "CASH",
          sourceModule: "Transfer",
          sourceId: id,
          eventType: "CARD_PAYMENT",
          note: noiDung
        });
        if (cardResolved.walletName) {
          events.push({
            walletId: cardResolved.walletId,
            walletName: cardResolved.walletName,
            date: dateStr,
            amount: amt,
            direction: "DECREASE",
            effectType: "CARD_DEBT",
            sourceModule: "Transfer",
            sourceId: id,
            eventType: "CARD_PAYMENT",
            note: noiDung
          });
        }
      } else if (isGroupAdvance) {
        events.push({
          walletId: walletId,
          walletName: walletName,
          date: dateStr,
          amount: amt,
          direction: "OUT",
          effectType: "CASH",
          sourceModule: "TripSplit",
          sourceId: id,
          eventType: "GROUP_ADVANCE_CASH_OUT",
          note: noiDung
        });
      } else if (loai === "thu" || loai === "thu nhập" || loai.includes("tất toán thu") || loai.includes("thu nợ") || loai.includes("thu hồi")) {
        events.push({
          walletId: walletId,
          walletName: walletName,
          date: dateStr,
          amount: amt,
          direction: "IN",
          effectType: "CASH",
          sourceModule: "Family",
          sourceId: id,
          eventType: "FAMILY_INCOME",
          note: noiDung
        });
      } else {
        events.push({
          walletId: walletId,
          walletName: walletName,
          date: dateStr,
          amount: amt,
          direction: "OUT",
          effectType: "CASH",
          sourceModule: "Family",
          sourceId: id,
          eventType: "FAMILY_EXPENSE",
          note: noiDung
        });
      }
    });
  }

  // 2. Quét Sheet Purchase (Mua Hàng)
  const pSheet = ss.getSheetByName("Purchase");
  if (pSheet && pSheet.getLastRow() >= 2) {
    const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 13)).getValues();
    pData.forEach(row => {
      const id = String(row[0] || "").trim();
      const statusWh = String(row[3] || "").trim().toLowerCase();
      const statusValP = String(row[9] || "").trim().toUpperCase();
      const isCancelled = statusWh.includes("hủy") || statusWh.includes("cancel");
      const isCardDone = !isCancelled && (statusValP === "HOAN_TAT" || statusValP.includes("HOÀN TẤT") || statusValP.includes("ĐÃ TRỪ") || statusValP.includes("ĐÃ SAO KÊ"));
      const isCardRefunded = statusValP === "DA_HOAN" || statusWh === "đã hoàn tiền";

      const rawWallet = String(row[8] || "").trim();
      const resolved = resolveWalletAndId("", rawWallet, walletMaps, ss);
      const walletName = resolved.walletName;
      const walletId = resolved.walletId;
      const qty = parseBizMoney(row[5]) || 1;
      const price = parseBizMoney(row[6]);
      const total = parseBizMoney(row[7]) || (qty * price);
      const note = String(row[10] || "").trim();
      const tenSP = String(row[4] || "").trim();
      const ngaySaoKeStr = formatLedgerDate(row[12] || row[1]);

      if (!walletName || total <= 0) return;

      const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(walletName, ss) : (/^c[-_\s]/i.test(walletName) || walletName.toLowerCase().includes("thẻ") || walletName.toLowerCase().includes("credit"));

      if (isCancelled) {
        if (isCardRefunded) {
          if (isCredit) {
            events.push({
              walletId: walletId,
              walletName: walletName,
              date: ngaySaoKeStr,
              amount: total,
              direction: "DECREASE",
              effectType: "CARD_DEBT",
              sourceModule: "Purchase",
              sourceId: id + "_REFUND",
              eventType: "PURCHASE_CARD_REFUND",
              note: `Hoàn tiền đơn hủy: ${tenSP}`
            });
          } else {
            events.push({
              walletId: walletId,
              walletName: walletName,
              date: ngaySaoKeStr,
              amount: total,
              direction: "IN",
              effectType: "CASH",
              sourceModule: "Purchase",
              sourceId: id + "_REFUND",
              eventType: "PURCHASE_REFUND_IN",
              note: `Hoàn tiền đơn hủy: ${tenSP}`
            });
          }
        }
        return; // Đơn hủy chưa trừ tiền -> không sinh dòng nợ
      }

      if (isCredit) {
        if (isCardDone) {
          events.push({
            walletId: walletId,
            walletName: walletName,
            date: ngaySaoKeStr,
            amount: total,
            direction: "INCREASE",
            effectType: "CARD_DEBT",
            sourceModule: "Purchase",
            sourceId: id,
            eventType: "PURCHASE_CARD_DEBT",
            note: `Mua hàng quẹt thẻ: ${tenSP} (x${qty})`
          });
        }
      } else {
        // Mua tiền mặt / Debit
        events.push({
          walletId: walletId,
          walletName: walletName,
          date: formatLedgerDate(row[1]),
          amount: total,
          direction: "OUT",
          effectType: "CASH",
          sourceModule: "Purchase",
          sourceId: id,
          eventType: "PURCHASE_CASH_OUT",
          note: `Mua hàng: ${tenSP} (x${qty})`
        });
      }
    });
  }

  // 3. Quét Sheet Sales (Bán Hàng)
  const sSheet = ss.getSheetByName("Sales");
  if (sSheet && sSheet.getLastRow() >= 2) {
    const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, Math.max(sSheet.getLastColumn(), 10)).getValues();
    sData.forEach(row => {
      const id = String(row[0] || "").trim();
      const dateStr = formatLedgerDate(row[1]);
      const tenSP = String(row[2] || "").trim();
      const totalAmt = parseBizMoney(row[6]);
      const rawNhan = String(row[8] || "").trim();
      const statusThanhToan = String(row[9] || "").trim().toUpperCase();
      const isKhachNo = statusThanhToan === "CHO_THU" || rawNhan.toLowerCase() === "khách nợ";
      const resolved = isKhachNo ? { walletId: "Khách Nợ", walletName: "Khách Nợ" } : resolveWalletAndId("", rawNhan, walletMaps, ss);
      const nhanTienVao = resolved.walletName;
      const walletId = resolved.walletId;

      if (totalAmt <= 0) return;

      if (isKhachNo) {
        // Ghi nhận nợ phải thu đối tác
        events.push({
          walletId: "Khách Nợ",
          walletName: nhanTienVao || "Khách Nợ",
          date: dateStr,
          amount: totalAmt,
          direction: "INCREASE",
          effectType: "PARTNER_RECEIVABLE",
          sourceModule: "Sales",
          sourceId: id,
          eventType: "SALES_DEBT_RECORD",
          note: `Bán hàng ghi nợ: ${tenSP}`
        });
      } else if (nhanTienVao) {
        // Bán hàng thu tiền ngay vào ví
        events.push({
          walletId: walletId,
          walletName: nhanTienVao,
          date: dateStr,
          amount: totalAmt,
          direction: "IN",
          effectType: "CASH",
          sourceModule: "Sales",
          sourceId: id,
          eventType: "SALES_CASH_IN",
          note: `Bán hàng thu tiền: ${tenSP}`
        });
      }
    });
  }

  // 4. Quét Sheet Debt (Công Nợ)
  const dSheet = (typeof getSheetByNames === 'function') ? getSheetByNames("Debt", "CongNo", ss) : (ss.getSheetByName("Debt") || ss.getSheetByName("CongNo"));
  if (dSheet && dSheet.getLastRow() >= 2) {
    const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, Math.max(dSheet.getLastColumn(), 11)).getValues();
    dData.forEach(row => {
      const id = String(row[0] || "").trim();
      const dateStr = formatLedgerDate(row[1]);
      const loai = String(row[3] || "").trim().toUpperCase();
      const amt = parseBizMoney(row[5]);
      const rawVi = String(row[6] || "").trim();
      const resolved = resolveWalletAndId("", rawVi, walletMaps, ss);
      const walletName = resolved.walletName;
      const walletId = resolved.walletId;
      const partnerName = String(row[2] || "").trim() || "Đối tác";
      const note = String(row[8] || "").trim();

      // Kiểm tra nếu là nợ kế thừa từ Tab 7 (chứa GroupID / TripID)
      const isInheritedTrip = note.includes("TRIP_") || note.includes("GRP_") || id.startsWith("TRIP_");

      if (amt <= 0) return;

      if (loai === "CHO_VAY" || loai === "THU") {
        if (!isInheritedTrip && walletName) {
          events.push({
            walletId: walletId,
            walletName: walletName,
            date: dateStr,
            amount: amt,
            direction: "OUT",
            effectType: "CASH",
            sourceModule: "Debt",
            sourceId: id,
            eventType: "LEND_MONEY",
            note: `Cho vay: ${partnerName}`
          });
        }
      } else if (loai === "VAY" || loai === "TRA") {
        if (!isInheritedTrip && walletName) {
          events.push({
            walletId: walletId,
            walletName: walletName,
            date: dateStr,
            amount: amt,
            direction: "IN",
            effectType: "CASH",
            sourceModule: "Debt",
            sourceId: id,
            eventType: "BORROW_MONEY",
            note: `Đi vay: ${partnerName}`
          });
        }
      }
    });
  }

  // Nếu có cutoverDate (ví dụ "2026-10-01"): Lọc chỉ lấy các giao dịch từ ngày đó trở đi
  let filteredEvents = events;
  if (cutoverDate) {
    filteredEvents = events.filter(ev => {
      const dStr = formatLedgerDate(ev.date);
      return dStr >= cutoverDate;
    });
  }

  // 5. Tính toán đối chiếu số dư (Reconciliation)
  const simulatedBalances = {}; // wNameLower -> { name, cashDelta: 0, cardDebt: 0, receivables: 0, payables: 0 }
  filteredEvents.forEach(ev => {
    const k = ev.walletName.toLowerCase();
    if (!simulatedBalances[k]) {
      simulatedBalances[k] = { name: ev.walletName, cashDelta: 0, cardDebt: 0, receivables: 0, payables: 0 };
    }
    const amt = ev.amount;
    if (ev.effectType === "CASH") {
      if (ev.direction === "IN") simulatedBalances[k].cashDelta += amt;
      else if (ev.direction === "OUT") simulatedBalances[k].cashDelta -= amt;
    } else if (ev.effectType === "CARD_DEBT") {
      if (ev.direction === "INCREASE") simulatedBalances[k].cardDebt += amt;
      else if (ev.direction === "DECREASE") simulatedBalances[k].cardDebt -= amt;
    } else if (ev.effectType === "PARTNER_RECEIVABLE") {
      if (ev.direction === "INCREASE") simulatedBalances[k].receivables += amt;
      else if (ev.direction === "DECREASE") simulatedBalances[k].receivables -= amt;
    } else if (ev.effectType === "PARTNER_PAYABLE") {
      if (ev.direction === "INCREASE") simulatedBalances[k].payables += amt;
      else if (ev.direction === "DECREASE") simulatedBalances[k].payables -= amt;
    }
  });

  // 6. Đọc sheet Wallets để so sánh và tạo Opening Balances nếu Cutover
  const reconciliationReport = [];
  const openingEvents = [];
  const wSheet = (typeof getSheetByNames === 'function') ? getSheetByNames("Wallets", "Ví", ss) : (ss.getSheetByName("Wallets") || ss.getSheetByName("Ví"));
  if (wSheet && wSheet.getLastRow() >= 2) {
    const wData = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, Math.max(wSheet.getLastColumn(), 10)).getValues();
    wData.forEach(r => {
      const wId = String(r[0] || "").trim();
      const rawWName = String(r[1] || "").trim();
      const wName = resolveWalletCanonicalName(rawWName);
      const type = String(r[2] || "DEBIT").trim().toUpperCase();
      const initBal = parseBizMoney(r[6]);
      const curBal = parseBizMoney(r[7] || r[9]);
      const k = wName.toLowerCase();

      const sim = simulatedBalances[k] || { cashDelta: 0, cardDebt: 0, receivables: 0, payables: 0 };
      
      let baseOpening = initBal;
      if (cutoverDate) {
        if (type === "CREDIT") {
          // Xử lý nợ đầu kỳ:
          // Nếu ví có tất toán (sim.cardDebt < 0) và curBal trên sheet vẫn mang số dư cũ trước tất toán:
          if (curBal > 0 && sim.cardDebt < 0 && Math.abs(curBal + sim.cardDebt) < 0.01) {
            baseOpening = curBal;
          } else if (curBal === 0 && sim.cardDebt < 0) {
            baseOpening = Math.abs(sim.cardDebt);
          } else {
            baseOpening = curBal - sim.cardDebt;
          }
        } else {
          baseOpening = curBal - sim.cashDelta;
        }

        // Tạo bút toán OPENING_BALANCE có cờ CheckpointRef
        const cpTag = `CP_OPENING_${cutoverDate.replace(/-/g, '')}`;
        if (type === "CREDIT") {
          if (baseOpening !== 0) {
            openingEvents.push({
              walletId: wId,
              walletName: wName,
              date: cutoverDate,
              amount: Math.abs(baseOpening),
              direction: baseOpening > 0 ? "INCREASE" : "DECREASE",
              effectType: "CARD_DEBT",
              sourceModule: "System",
              sourceId: `INIT_${wId}`,
              eventType: "OPENING_BALANCE",
              checkpointRef: cpTag,
              note: `Số dư nợ đầu kỳ tính từ ${cutoverDate}`
            });
          }
        } else {
          if (baseOpening !== 0) {
            openingEvents.push({
              walletId: wId,
              walletName: wName,
              date: cutoverDate,
              amount: Math.abs(baseOpening),
              direction: baseOpening >= 0 ? "IN" : "OUT",
              effectType: "CASH",
              sourceModule: "System",
              sourceId: `INIT_${wId}`,
              eventType: "OPENING_BALANCE",
              checkpointRef: cpTag,
              note: `Số dư tiền đầu kỳ tính từ ${cutoverDate}`
            });
          }
        }
      }

      const expectedBal = (type === "CREDIT") ? (baseOpening + sim.cardDebt) : (baseOpening + sim.cashDelta);
      const effectiveCurBal = (type === "CREDIT" && curBal > 0 && Math.abs(curBal + sim.cardDebt) < 0.01) ? 0 : curBal;
      const diff = expectedBal - effectiveCurBal;

      reconciliationReport.push({
        walletId: wId,
        walletName: wName,
        type: type,
        initialBalance: baseOpening,
        currentBalanceOnSheet: effectiveCurBal,
        reconstructedBalance: expectedBal,
        difference: diff,
        isMatched: (Math.abs(diff) < 0.01)
      });
    });
  }

  // Toàn bộ events cần ghi = Opening Balance (đã chốt) + Các events trong kỳ Cutover (chưa chốt)
  const finalEventsToCommit = [...openingEvents, ...filteredEvents];

  // 7. Nếu dryRun = true: Trả về report đối chiếu
  if (isDryRun) {
    return {
      success: true,
      dryRun: true,
      cutoverDate: cutoverDate,
      totalEvents: finalEventsToCommit.length,
      octoberEventsCount: filteredEvents.length,
      report: reconciliationReport,
      message: `🔍 [DRY-RUN THÁNG 10] Đã mô phỏng ${finalEventsToCommit.length} bút toán (Mốc đầu kỳ + ${filteredEvents.length} phát sinh từ ${cutoverDate || 'đầu'}).`
    };
  }

  // 8. Nếu dryRun = false: Ghi dữ liệu sạch vào WalletLedger
  const ledgerSheet = getOrCreateLedgerSheet(ss);
  if (ledgerSheet) {
    // Xóa dữ liệu cũ từ dòng 2
    if (ledgerSheet.getLastRow() >= 2) {
      ledgerSheet.getRange(2, 1, ledgerSheet.getLastRow() - 1, Math.max(ledgerSheet.getLastColumn(), 16)).clearContent();
    }
    // Ghi toàn bộ events sạch
    postFinancialEvents(finalEventsToCommit, ss);
  }

  return {
    success: true,
    dryRun: false,
    cutoverDate: cutoverDate,
    postedCount: finalEventsToCommit.length,
    report: reconciliationReport,
    message: `✅ [MIGRATION THÀNH CÔNG] Đã ghi ${finalEventsToCommit.length} bút toán sạch vào Sổ Cái WalletLedger (bắt đầu từ ${cutoverDate || 'đầu'})!`
  };
}

var SHEET_AUDIT_LOGS = "AuditLogs";
var AUDIT_LOGS_HEADERS = [
  "AuditID",
  "Timestamp",
  "WalletID",
  "WalletName",
  "SheetBalance",
  "LedgerBalance",
  "Discrepancy",
  "Status",
  "Note"
];

function getOrCreateAuditLogsSheet(ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return null;
    let sheet = ss.getSheetByName(SHEET_AUDIT_LOGS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_AUDIT_LOGS);
      sheet.getRange(1, 1, 1, AUDIT_LOGS_HEADERS.length).setValues([AUDIT_LOGS_HEADERS]);
      sheet.getRange(1, 1, 1, AUDIT_LOGS_HEADERS.length).setFontWeight("bold").setBackground("#fee2e2");
    }
    return sheet;
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi getOrCreateAuditLogsSheet: " + err);
    return null;
  }
}

/**
 * Nightly Ledger Audit: Snapshot comparison between Wallets and WalletLedger
 * Discrepancy logged as PENDING_REVIEW in AuditLogs sheet (NEVER blindly overwrite)
 */
function runNightlyLedgerAudit(ssTarget) {
  const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { success: false, message: "Không tìm thấy Spreadsheet." };

  const nowIso = new Date().toISOString();
  const issues = [];

  try {
    // 1. Lấy danh sách ví từ sheet Wallets
    let wallets = [];
    if (typeof getWalletsFromSheet === 'function') {
      const wRes = getWalletsFromSheet("ALL", "ALL", ss);
      wallets = (wRes && wRes.wallets) ? wRes.wallets : [];
    } else {
      const wSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví");
      if (wSheet && wSheet.getLastRow() >= 2) {
        const rows = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, Math.max(wSheet.getLastColumn(), 8)).getValues();
        wallets = rows.map(r => ({
          id: String(r[0] || '').trim(),
          name: String(r[1] || '').trim(),
          type: String(r[2] || '').trim().toUpperCase(),
          initial_balance: parseBizMoney(r[6]),
          current_balance: parseBizMoney(r[7])
        }));
      }
    }

    // 2. Lấy số dư và nợ thẻ từ Sổ Cái WalletLedger
    const ledgerCashRes = getWalletBalancesFromLedger("ALL", "ALL", ss);
    const ledgerCashBalances = ledgerCashRes.balances || {};
    const ledgerCardDebts = getCardDebtFromLedger("ALL", "ALL", ss) || {};

    const rowsToAppend = [];

    wallets.forEach(w => {
      const wId = w.id || "";
      const wName = w.name || "";
      const isCredit = (w.type === "CREDIT" || String(w.type).includes("TÍN DỤNG"));
      const nameKey = wName.toLowerCase();
      const idKey = wId.toLowerCase();

      let sheetVal = 0;
      let ledgerVal = 0;

      if (isCredit) {
        sheetVal = parseBizMoney(w.current_balance !== undefined ? w.current_balance : w.card_debt);
        const cardObj = ledgerCardDebts[nameKey] || ledgerCardDebts[idKey];
        ledgerVal = cardObj ? parseBizMoney(cardObj.currentDebt) : 0;
      } else {
        sheetVal = parseBizMoney(w.current_balance);
        const cashObj = ledgerCashBalances[nameKey] || ledgerCashBalances[idKey];
        ledgerVal = cashObj ? parseBizMoney(cashObj.currentBalance) : parseBizMoney(w.initial_balance);
      }

      // Với JPY và VND (tiền nguyên), epsilon = 0
      const diff = sheetVal - ledgerVal;
      if (Math.abs(diff) > 0.001) {
        const auditId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("AUD-") : ("AUD-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(100 + Math.random() * 900));
        const note = `[Lệch ${isCredit ? 'Dư nợ thẻ' : 'Số dư ví'}] Sheet: ${sheetVal} vs Sổ Cái: ${ledgerVal} (Chênh lệch: ${diff})`;

        const issue = {
          auditId: auditId,
          timestamp: nowIso,
          walletId: wId,
          walletName: wName,
          type: w.type,
          sheetBalance: sheetVal,
          ledgerBalance: ledgerVal,
          discrepancy: diff,
          status: "PENDING_REVIEW",
          note: note
        };

        issues.push(issue);

        rowsToAppend.push([
          auditId,
          nowIso,
          wId,
          wName,
          sheetVal,
          ledgerVal,
          diff,
          "PENDING_REVIEW",
          note
        ]);
      }
    });

    if (rowsToAppend.length > 0) {
      const auditSheet = getOrCreateAuditLogsSheet(ss);
      if (auditSheet) {
        const startRow = auditSheet.getLastRow() + 1;
        auditSheet.getRange(startRow, 1, rowsToAppend.length, AUDIT_LOGS_HEADERS.length).setValues(rowsToAppend);
      }
    }

    return {
      success: true,
      timestamp: nowIso,
      totalWallets: wallets.length,
      discrepanciesCount: issues.length,
      issues: issues,
      message: issues.length === 0 
        ? `✅ [KIỂM TOÁN HOÀN TẤT] Tất cả ${wallets.length} ví/thẻ đều khớp 100% giữa Sheet và Sổ Cái.`
        : `⚠️ [CẢNH BÁO KIỂM TOÁN] Phát hiện ${issues.length}/${wallets.length} ví bị lệch số dư. Đã ghi nhận PENDING_REVIEW vào Sheet AuditLogs.`
    };
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi runNightlyLedgerAudit: " + err);
    return { success: false, message: "❌ Lỗi runNightlyLedgerAudit: " + err.toString() };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SHEET_WALLET_LEDGER,
    SHEET_WALLET_CHECKPOINTS,
    SHEET_AUDIT_LOGS,
    LEDGER_HEADERS_16,
    LEDGER_HEADERS_15,
    AUDIT_LOGS_HEADERS,
    getOrCreateLedgerSheet,
    getOrCreateAuditLogsSheet,
    formatLedgerDate,
    isDateOnOrAfterCheckpoint,
    validateFinancialEvents,
    postFinancialEvents,
    reverseFinancialEvents,
    replaceFinancialEvents,
    markCheckpointInLedger,
    getWalletBalancesFromLedger,
    getCardDebtFromLedger,
    getPartnerDebtFromLedger,
    syncLedgerFromHistory,
    runNightlyLedgerAudit,
    resolveWalletCanonicalName,
    parseSettlementDetails,
    getWalletLookupMaps,
    resolveWalletAndId,
    validateWalletExists
  };
}

// ==========================================
// FILE: Server_Tab1.js
// NHIỆM VỤ: Backend Logic cho Tab 1 (Ví & Thẻ)
// Truy vấn đa bảng: Family, Debt, Purchase, Sales
// ==========================================

const SHEET_WALLETS = "Wallets";

/**
 * Lấy Helper Sheet an toàn với fallback tên tiếng Việt / Anh
 */
function getSheetByNameSafely(name, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') 
      ? resolveSpreadsheet(ssTarget) 
      : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    return ss && typeof ss.getSheetByName === 'function' ? ss.getSheetByName(name) : null;
  } catch (e) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi truy cập sheet " + name + ": " + e);
    return null;
  }
}

function getSheetByNames(name1, name2, ssTarget) {
  let sheet = getSheetByNameSafely(name1, ssTarget);
  if (!sheet && name2) {
    sheet = getSheetByNameSafely(name2, ssTarget);
  }
  return sheet;
}

function parseMoneyNumber(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;
  const cleanStr = str.replace(/[^0-9-]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Làm sạch nội dung chi tiết giao dịch (bỏ tiền tố Hũ / Thu nhập / CK Nội bộ)
 */
function cleanTransactionDetailNote(rawNote, hu, isChi) {
  let text = String(rawNote || "").trim();
  text = text.replace(/^📦\s*/, '');

  // Bóc tiền tố [Thu Chi] hoặc Thu Chi [...]
  text = text.replace(/^\[\s*Thu\s*Chi\s*\]\s*[-–—:]*\s*/gi, '');
  text = text.replace(/^Thu\s*Chi\s*\[[^\]]+\]\s*[-–—:]*\s*/gi, '');

  // Bóc tiền tố trong ngoặc vuông của 6 hũ chi + 3 hũ khác + hệ thống
  text = text
    .replace(/^(\[\s*[-–—]*\s*(?:Thu\s*nhập|CK\s*Nội\s*Bộ|Công\s*nợ|Tất\s*toán\s*thẻ|Hoàn\s*tiền|Đơn\s*mua|Đơn\s*bán|Thiết\s*yếu|Giải\s*trí|Tiết\s*kiệm|Giáo\s*dục|Cho\s*đi|Đầu\s*tư|Hưởng\s*thụ|Tự\s*do\s*tài\s*chính|Thiện\s*tâm|Phát\s*triển|Khác|Hũ\s*[^\]]+)\s*\]\s*[-–—:]*\s*)+/gi, '')
    .replace(/^[-–—]*\s*(?:Thu\s*nhập|CK\s*Nội\s*Bộ|Công\s*nợ|Tất\s*toán\s*thẻ|Hoàn\s*tiền|Đơn\s*mua|Đơn\s*bán|Thiết\s*yếu|Giải\s*trí|Tiết\s*kiệm|Giáo\s*dục|Cho\s*đi|Đầu\s*tư|Hưởng\s*thụ|Tự\s*do\s*tài\s*chính|Thiện\s*tâm|Phát\s*triển)\s*[:\s-]+/gi, '')
    .replace(/\s*\(\+?[0-9,.]+\s*¥\)$/i, '')
    .trim();

  if (hu) {
    let cleanHu = String(hu).replace(/^Thu\s*Chi\s*\[/i, '').replace(/\]$/, '').replace(/^[-–—]+/,'').trim();
    if (cleanHu) {
      const escapedHu = cleanHu.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const huRegex = new RegExp(`^(\\[\\s*${escapedHu}\\s*\\]\\s*[-–—:]*|${escapedHu}\\s*[-–—:]+)\\s*`, 'i');
      text = text.replace(huRegex, '').trim();
    }
  }

  if (!text) {
    text = isChi ? "Chi Tiêu" : "Thu Nhập";
  }
  return text;
}

/**
 * Chuẩn hóa tên Module / Hũ hiển thị trên báo cáo sổ phụ (bóc bỏ tiền tố Thu Chi [...])
 */
function formatCleanModule(moduleOrHu, isPos) {
  let mod = String(moduleOrHu || '').trim();
  mod = mod.replace(/^Thu\s*Chi\s*\[\s*/i, '').replace(/\s*\]$/, '').trim();
  mod = mod.replace(/^[-–—]+\s*/, '').trim();

  const lower = mod.toLowerCase();
  if (!mod || lower === 'thu chi' || lower.includes('thu nhập')) {
    return isPos ? "Thu Nhập" : "Chi Tiêu";
  }
  if (lower.includes('ck nội bộ') || lower.includes('ck noi bo')) {
    return "CK Nội Bộ";
  }
  if (lower.includes('công nợ') || lower.includes('cong no')) {
    return "Công Nợ";
  }
  if (lower.includes('tất toán thẻ') || lower.includes('tat toan the')) {
    return "Tất Toán Thẻ";
  }
  if (lower.includes('hoàn tiền') || lower.includes('hoan tien')) {
    return "Hoàn Tiền";
  }
  if (lower.includes('đơn mua') || lower.includes('don mua')) {
    return "Đơn Mua";
  }
  if (lower.includes('đơn bán') || lower.includes('don ban')) {
    return "Đơn Bán";
  }
  // 6 hũ chi tiêu chuẩn
  if (lower.includes('thiết yếu') || lower.includes('thiet yeu')) return "Thiết yếu";
  if (lower.includes('giải trí') || lower.includes('giai tri') || lower.includes('hưởng thụ')) return "Giải trí";
  if (lower.includes('tiết kiệm') || lower.includes('tiet kiem')) return "Tiết kiệm";
  if (lower.includes('giáo dục') || lower.includes('giao duc') || lower.includes('phát triển')) return "Giáo dục";
  if (lower.includes('đầu tư') || lower.includes('dau tu') || lower.includes('tự do tài chính')) return "Đầu tư";
  if (lower.includes('cho đi') || lower.includes('cho di') || lower.includes('thiện tâm')) return "Cho đi";

  return mod || (isPos ? "Thu Nhập" : "Chi Tiêu");
}

/**
 * 1. KÉO DANH SÁCH VÍ & THẺ TỪ GOOGLE SHEET "Wallets"
 */
function parseServerDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const str = String(val).trim();
  if (!str || str === 'undefined' || str === 'null' || str === 'Invalid Date') return null;

  // 8 chữ số YYYYMMDD (ví dụ: 20261027)
  const ymd8Match = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd8Match) {
    const y = parseInt(ymd8Match[1], 10);
    const m = parseInt(ymd8Match[2], 10);
    const d = parseInt(ymd8Match[3], 10);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(y, m - 1, d);
    }
  }

  // yyyy年MM月dd日 or MM月dd日 (Định dạng tiếng Nhật)
  if (str.includes('年') && str.includes('月')) {
    const jpMatch = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})/);
    if (jpMatch) {
      return new Date(parseInt(jpMatch[1], 10), parseInt(jpMatch[2], 10) - 1, parseInt(jpMatch[3], 10));
    }
  }
  if (!str.includes('年') && str.includes('月') && str.includes('日')) {
    const jpMatch2 = str.match(/(\d{1,2})月(\d{1,2})/);
    if (jpMatch2) {
      const y = new Date().getFullYear();
      return new Date(y, parseInt(jpMatch2[1], 10) - 1, parseInt(jpMatch2[2], 10));
    }
  }
  // yyyy.MM.dd
  if (/^\d{4}\.\d{1,2}\.\d{1,2}/.test(str)) {
    const parts = str.split(' ')[0].split('.');
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }

  // dd/MM/yyyy or dd-MM-yyyy or d/M/yyyy
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(str)) {
    const spaceParts = str.split(' ');
    const sep = spaceParts[0].includes('/') ? '/' : '-';
    const parts = spaceParts[0].split(sep);
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    let y = parseInt(parts[2], 10);
    if (y < 100) y += 2000;
    if (spaceParts[1] && spaceParts[1].includes(':')) {
      const tp = spaceParts[1].split(':');
      return new Date(y, m - 1, d, parseInt(tp[0], 10) || 0, parseInt(tp[1], 10) || 0, parseInt(tp[2], 10) || 0);
    }
    return new Date(y, m - 1, d);
  }

  // dd/MM or d/M (không có năm -> lấy năm hiện tại)
  if (/^\d{1,2}[\/\-]\d{1,2}$/.test(str)) {
    const sep = str.includes('/') ? '/' : '-';
    const parts = str.split(sep);
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const y = new Date().getFullYear();
    return new Date(y, m - 1, d);
  }

  // yyyy-MM-dd or yyyy/MM/dd
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(str)) {
    const spaceParts = str.includes('T') ? str.split('T') : str.split(' ');
    const sep = spaceParts[0].includes('-') ? '-' : '/';
    const parts = spaceParts[0].split(sep);
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (spaceParts[1] && spaceParts[1].includes(':')) {
      const tp = spaceParts[1].replace('Z', '').split(':');
      return new Date(y, m - 1, d, parseInt(tp[0], 10) || 0, parseInt(tp[1], 10) || 0, parseInt(tp[2], 10) || 0);
    }
    return new Date(y, m - 1, d);
  }

  try {
    const cleanedStr = str.replace(/\s*\([^)]*\)$/, '');
    const d = new Date(cleanedStr);
    return isNaN(d.getTime()) ? null : d;
  } catch(e) {
    return null;
  }
}

function formatServerDateToDDMMYYYY(val) {
  if (!val) return "";
  const d = (val instanceof Date) ? val : parseServerDate(val);
  if (!d || isNaN(d.getTime())) {
    const s = String(val).trim();
    return s.replace(/\s*\([^)]*\)$/, '');
  }
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/**
 * Helper so sánh an toàn thời gian giao dịch so với mốc Checkpoint (so sánh theo ngày dd/MM/yyyy)
 * Đảm bảo các giao dịch trên cùng ngày với Checkpoint KHÔNG bị bỏ sót!
 */
function isTransactionAfterCheckpoint(txDateVal, cpDateObj, cpDateStr) {
  if (!cpDateObj) return true; // Không có checkpoint -> mọi giao dịch đều hợp lệ
  if (!txDateVal) return false;

  const txDateObj = (txDateVal instanceof Date) ? txDateVal : parseServerDate(txDateVal);
  if (!txDateObj) return false;

  // So sánh theo ngày lịch (Calendar Day YYYYMMDD):
  const txY = txDateObj.getFullYear();
  const txM = txDateObj.getMonth();
  const txD = txDateObj.getDate();

  const cpY = cpDateObj.getFullYear();
  const cpM = cpDateObj.getMonth();
  const cpD = cpDateObj.getDate();

  const txDayVal = txY * 10000 + (txM + 1) * 100 + txD;
  const cpDayVal = cpY * 10000 + (cpM + 1) * 100 + cpD;

  // Giao dịch từ ngày chốt sổ trở đi (>=) được tính vào biến động sau mốc
  return txDayVal >= cpDayVal;
}

var SHEET_WALLET_CHECKPOINTS = "WalletCheckpoints";
var SHEET_WALLET_LEDGER = "WalletLedger";

function getOrCreateSheetHelper(sheetName, defaultHeaders, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') 
      ? resolveSpreadsheet(ssTarget) 
      : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return null;
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    return sheet;
  } catch (err) {
    Logger.log("Lỗi getOrCreateSheetHelper " + sheetName + ": " + err);
    return null;
  }
}

function extractBaseOrderIdServer(rawId) {
  if (!rawId) return '';
  const str = String(rawId).trim();
  const match = str.match(/^([A-Za-z0-9]+[-_].+?)[-_]([1-9]\d{0,2})$/);
  if (match && match[1]) {
    return match[1];
  }
  return str;
}

function getWalletsFromSheet(month, year, ssTarget, fromSheetOnly) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, wallets: [] };
    const sheet = getSheetByNames("Wallets", "Ví", ss) || getSheetByNameSafely("ViThe", ss);
    if (!sheet || sheet.getLastRow() < 2) {
      return {
        success: true,
        wallets: []
      };
    }

    const isAllMonth = (!month || month === "All" || String(month).toUpperCase() === "ALL");
    const isAllYear = (!year || year === "All" || String(year).toUpperCase() === "ALL");
    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = isAllYear ? null : parseInt(year, 10);

    const lastCol = Math.max((typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 23) || 23, 23);
    const lastRow = sheet.getLastRow();
    const range = sheet.getRange(1, 1, lastRow, lastCol);
    const allData = range.getValues();
    const headerRow = allData[0] || [];
    const dataRows = allData.slice(1);

    // Auto-migrate: Quét và tự động mã hóa dữ liệu thẻ nếu phát hiện còn thẻ plain-text trong sheet Wallets (chỉ chạy khi ghi đè hoặc từ menu quản trị, không chạy trong luồng đọc getAppData)
    if (false) {
      try {
        let needsAutoMigrate = false;
        const checkCols = [14, 15, 16, 18, 19, 20]; // Cols O, P, Q, S, T, U (15, 16, 17, 19, 20, 21)
        for (let r = 0; r < dataRows.length; r++) {
          const rowData = dataRows[r];
          const isCard = String(rowData[colMap.type] || '').trim().toUpperCase() === 'CREDIT';
          if (!isCard) continue; // Chỉ kiểm tra thẻ tín dụng, không kiểm tra ví tiền mặt hay tài khoản ngân hàng
          for (let c = 0; c < checkCols.length; c++) {
            const cIdx = checkCols[c];
            if (cIdx < rowData.length) {
              const val = String(rowData[cIdx] || "").trim();
              if (val && !val.startsWith("ENC:v1:")) {
                needsAutoMigrate = true;
                break;
              }
            }
          }
          if (needsAutoMigrate) break;
        }
        if (needsAutoMigrate && typeof migrateEncryptExistingCards === 'function') {
          migrateEncryptExistingCards(ss);
        }
      } catch (migErr) {
        if (typeof Logger !== 'undefined') Logger.log("Auto-migrate card check error: " + migErr);
      }
    }

    // Map column headers dynamically
    let colMap = {
      id: 0, name: 1, type: 2, credit_limit: 3, closing_date: 4, due_date: 5,
      initial_balance: 6, total_increase: 7, total_decrease: 8, preorder: 9,
      current_balance: 10, settle_source: 11, checkpoint_date: 12,
      checkpoint_balance: 10, checkpoint_id: -1, balance_status: -1
    };

    // Check if new 13-column layout (with Preorder column at Col J, index 9)
    const is13ColLayout = headerRow.length >= 10 && (
      String(headerRow[9] || '').toUpperCase().includes('PREORDER') ||
      String(headerRow[9] || '').toUpperCase().includes('PRE-ORDER') ||
      String(headerRow[9] || '').toUpperCase().includes('ORDER')
    );

    // Check if legacy 11-12 column layout (where Col 7=Initial, Col 8=THU, Col 9=CHI, Col 10=CurrentBalance, Col 11=Ví nguồn, Col 12=Checkpoint Date)
    const isLegacy11or12 = !is13ColLayout && headerRow.length >= 8 && (
      String(headerRow[7] || '').toUpperCase().includes('THU') ||
      String(headerRow[7] || '').toUpperCase().includes('TĂNG') ||
      String(headerRow[8] || '').toUpperCase().includes('CHI') ||
      String(headerRow[8] || '').toUpperCase().includes('GIẢM')
    );

    if (is13ColLayout) {
      colMap = {
        id: 0, name: 1, type: 2, credit_limit: 3, closing_date: 4, due_date: 5,
        initial_balance: 6, total_increase: 7, total_decrease: 8, preorder: 9,
        current_balance: 10, settle_source: 11, checkpoint_date: 12,
        checkpoint_balance: 10, checkpoint_id: -1, balance_status: -1
      };
    } else if (isLegacy11or12) {
      colMap = {
        id: 0, name: 1, type: 2, credit_limit: 3, closing_date: 4, due_date: 5,
        initial_balance: 6, total_increase: 7, total_decrease: 8, preorder: -1,
        current_balance: 9, settle_source: 10, checkpoint_date: 11,
        checkpoint_balance: 9, checkpoint_id: -1, balance_status: -1
      };
    } else {
      // Auto-detect based on header names if present
      headerRow.forEach((h, idx) => {
        const title = String(h || '').trim().toLowerCase();
        if (!title) return;
        if (title === 'id' || title === 'mã ví' || title === 'walletid') colMap.id = idx;
        else if (title.includes('tên') || title === 'walletname') colMap.name = idx;
        else if (title.includes('loại') || title === 'type') colMap.type = idx;
        else if (title.includes('hạn mức') || title === 'creditlimit') colMap.credit_limit = idx;
        else if (title.includes('sao kê') || (title.includes('chốt') && !title.includes('sổ'))) colMap.closing_date = idx;
        else if (title.includes('đáo hạn') || title.includes('trả') || title === 'duedate') colMap.due_date = idx;
        else if (title.includes('ban đầu') || title === 'initialbalance') colMap.initial_balance = idx;
        else if (title.includes('hiện tại') || title === 'currentbalance') colMap.current_balance = idx;
        else if (title === 'thu' || title.includes('phát sinh tăng') || title === 'tăng') colMap.total_increase = idx;
        else if (title === 'chi' || title.includes('phát sinh giảm') || title === 'giảm') colMap.total_decrease = idx;
        else if (title.includes('preorder') || title.includes('pre-order') || title === 'đơn order') colMap.preorder = idx;
        else if (title === 'checkpointid') colMap.checkpoint_id = idx;
        else if ((title.includes('checkpoint') && (title.includes('date') || title.includes('ngày'))) || title.includes('ngày chốt sổ')) colMap.checkpoint_date = idx;
        else if ((title.includes('checkpoint') && (title.includes('balance') || title.includes('số dư'))) || title.includes('số dư chốt')) colMap.checkpoint_balance = idx;
        else if (title.includes('trạng thái') || title.includes('status') || title === 'balancestatus') colMap.balance_status = idx;
        else if (title.includes('nguồn') || title === 'settlesource') colMap.settle_source = idx;
      });
    }

    function normalizeWKey(str) {
      if (!str) return '';
      return String(str)
        .trim()
        .toLowerCase()
        .replace(/^(?:c[\s\-_:]*|thẻ\s+|ví\s+)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Build fast lookup for wallets from Wallets sheet
    const walletKeyByAny = {};
    const walletIsCreditMap = {};
    dataRows.forEach(function(r) {
      const id = String(r[colMap.id] || "").trim().toLowerCase();
      const wName = String(r[colMap.name] || "").trim();
      const wKey = wName.toLowerCase();
      const normName = normalizeWKey(wName);
      const isCred = String(r[colMap.type] || "DEBIT").trim().toUpperCase() === "CREDIT";
      if (wKey) {
        walletKeyByAny[wKey] = wKey;
        walletIsCreditMap[wKey] = isCred;
        if (id) walletKeyByAny[id] = wKey;
        if (normName) walletKeyByAny[normName] = wKey;
      }
    });

    function resolveCanonicalWKey(rawId, rawName) {
      const nLower = String(rawName || "").trim().toLowerCase();
      if (nLower && walletKeyByAny[nLower]) return walletKeyByAny[nLower];
      const idLower = String(rawId || "").trim().toLowerCase();
      if (idLower && walletKeyByAny[idLower]) return walletKeyByAny[idLower];
      const normN = normalizeWKey(nLower);
      if (normN && walletKeyByAny[normN]) return walletKeyByAny[normN];
      if (typeof resolveWalletCanonicalName === 'function' && rawName) {
        const canon = String(resolveWalletCanonicalName(rawName) || "").trim().toLowerCase();
        if (canon && walletKeyByAny[canon]) return walletKeyByAny[canon];
        const normCanon = normalizeWKey(canon);
        if (normCanon && walletKeyByAny[normCanon]) return walletKeyByAny[normCanon];
      }
      return nLower || idLower;
    }

    // Build checkpoint map: Ưu tiên nạp từ Sheet WalletCheckpoints
    const walletCheckpointMap = {}; // key -> { date, dateStr, balance, id }
    const cpSheet = ss.getSheetByName(SHEET_WALLET_CHECKPOINTS);
    if (cpSheet && cpSheet.getLastRow() >= 2) {
      const cpData = cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, 8).getValues();
      for (let i = 0; i < cpData.length; i++) {
        const cpWId = String(cpData[i][1] || "").trim();
        const cpWName = String(cpData[i][2] || "").trim().toLowerCase();
        const cpRawDate = cpData[i][3];
        const cpDate = parseServerDate(cpRawDate);
        const cpDateStr = formatServerDateToDDMMYYYY(cpDate || cpRawDate);
        const cpBal = parseMoneyNumber(cpData[i][4]);
        const cpCreatedAtRaw = cpData[i][5];
        const cpCreatedAt = cpCreatedAtRaw ? new Date(cpCreatedAtRaw).getTime() : 0;
        const status = String(cpData[i][7] || "ACTIVE").trim().toUpperCase();
        if (status === "ACTIVE") {
          if (cpDate) {
            const cpObj = { date: cpDate, dateStr: cpDateStr, balance: cpBal, id: String(cpData[i][0] || ''), createdAtTs: cpCreatedAt };
            if (cpWName) walletCheckpointMap[cpWName] = cpObj;
            if (cpWId) walletCheckpointMap[cpWId.toLowerCase()] = cpObj;
            const canonCpKey = resolveCanonicalWKey(cpWId, cpWName);
            if (canonCpKey) walletCheckpointMap[canonCpKey] = cpObj;
          }
        }
      }
    }

    // Build latest reconcile map: Quét đợt đối soát gần nhất từ Sheet BankReconciliations
    const walletLatestRecMap = {}; // key -> { dateStr, batchId, ts }
    try {
      const recSheet = ss.getSheetByName(SHEET_BANK_RECONCILIATIONS) || ss.getSheetByName("BankReconciliations");
      if (recSheet && recSheet.getLastRow() >= 2) {
        const recLastRow = recSheet.getLastRow();
        const recData = recSheet.getRange(2, 1, recLastRow - 1, 3).getValues();
        for (let i = 0; i < recData.length; i++) {
          const rWName = String(recData[i][1] || "").trim().toLowerCase();
          const rDateRaw = recData[i][2];
          const rBatchId = String(recData[i][0] || "").trim();
          if (rWName && rDateRaw) {
            const rD = parseServerDate(rDateRaw);
            const rDStr = formatServerDateToDDMMYYYY(rD || rDateRaw);
            const rTs = rD ? rD.getTime() : 0;
            if (!walletLatestRecMap[rWName] || (rTs > walletLatestRecMap[rWName].ts)) {
              walletLatestRecMap[rWName] = { dateStr: rDStr, batchId: rBatchId, ts: rTs };
            }
          }
        }
      }
    } catch (eRec) {}

    // Fallback: Nếu ví chưa có trong WalletCheckpoints, kiểm tra cột trên sheet Wallets
    dataRows.forEach(function(r) {
      const wId = String(r[colMap.id] || "").trim().toLowerCase();
      const wName = String(r[colMap.name] || "").trim().toLowerCase();
      const cpRaw = (colMap.checkpoint_date >= 0 && r[colMap.checkpoint_date]) ? r[colMap.checkpoint_date] : "";
      const cpD = parseServerDate(cpRaw);
      const cpStr = formatServerDateToDDMMYYYY(cpD || cpRaw);
      let cpBal = 0;
      if (is13ColLayout || isLegacy11or12) {
        const rowInc = parseMoneyNumber(r[colMap.total_increase]);
        const rowDec = parseMoneyNumber(r[colMap.total_decrease]);
        const rowCur = parseMoneyNumber(r[colMap.current_balance]);
        const rowInit = parseMoneyNumber(r[colMap.initial_balance]);
        cpBal = (rowInc === 0 && rowDec === 0 && rowCur !== 0) ? rowCur : rowInit;
      } else {
        cpBal = (colMap.checkpoint_balance >= 0 && r[colMap.checkpoint_balance] !== undefined) ? parseMoneyNumber(r[colMap.checkpoint_balance]) : parseMoneyNumber(r[colMap.initial_balance]);
      }
      if (cpStr && !walletCheckpointMap[wName]) {
        if (cpD) {
          const cpObj = { date: cpD, dateStr: cpStr, balance: cpBal };
          if (wName) walletCheckpointMap[wName] = cpObj;
          if (wId) walletCheckpointMap[wId] = cpObj;
          const canonK = resolveCanonicalWKey(wId, wName);
          if (canonK) walletCheckpointMap[canonK] = cpObj;
        }
      }
    });

    const walletMap = {};
    const cardStatementDebtMap = {};
    const cardPreorderMap = {};
    const cardSettlementMap = {};

    // 🌟 ĐỌC TRỰC TIẾP TỪ SỔ CÁI TRUNG TÂM "WalletLedger" ĐỂ TÍNH BIẾN ĐỘNG SỐ DƯ & DƯ NỢ THẺ (Chỉ khi !fromSheetOnly)
    let ledgerSheet = null;
    if (!fromSheetOnly) {
      ledgerSheet = ss.getSheetByName(SHEET_WALLET_LEDGER) || ss.getSheetByName("WalletLedger");
      if ((!ledgerSheet || ledgerSheet.getLastRow() < 2) && typeof syncLedgerFromHistory === 'function') {
        try {
          syncLedgerFromHistory({ dryRun: false }, ss);
          ledgerSheet = ss.getSheetByName(SHEET_WALLET_LEDGER) || ss.getSheetByName("WalletLedger");
        } catch(e) {}
      }
    }

    const hasLedgerSheet = Boolean(!fromSheetOnly && ledgerSheet && ledgerSheet.getLastRow() >= 2);
    if (hasLedgerSheet) {
      const lData = ledgerSheet.getRange(2, 1, ledgerSheet.getLastRow() - 1, Math.max(ledgerSheet.getLastColumn(), 16)).getValues();

      const seenLedgerTxKeys = new Set();

      for (let i = 0; i < lData.length; i++) {
        const row = lData[i];
        const is16Col = row.length >= 13;
        const status = String(row[is16Col ? 11 : 10] || "POSTED").trim().toUpperCase();
        if (status !== "POSTED") continue;

        const effectType = String(row[6] || "").trim().toUpperCase();
        if (effectType.startsWith("PARTNER_")) continue;

        const srcId = String(row[8] || "").trim();
        const eventType = String(row[is16Col ? 9 : 8] || "").trim().toUpperCase();
        // Bỏ qua bút toán OPENING_BALANCE / INIT_ vì đã có baseBal (Số Dư Ban Đầu / Checkpoint) trên sheet Wallets
        if (eventType === "OPENING_BALANCE" || srcId.toUpperCase().startsWith("INIT_")) continue;

        const cpRef = is16Col ? String(row[15] || "").trim() : "";
        if (cpRef) continue; // Đã nằm trong mốc chốt sổ trước đó -> Bỏ qua

        const wKey = resolveCanonicalWKey(row[1], row[2]);
        if (!wKey) continue;

        const txDate = row[3];
        const cpInfo = walletCheckpointMap[wKey] || (row[2] ? walletCheckpointMap[String(row[2]).trim().toLowerCase()] : null) || (row[1] ? walletCheckpointMap[String(row[1]).trim().toLowerCase()] : null);
        // Nếu ví có mốc Checkpoint, mọi giao dịch trước ngày Checkpoint đều bị bỏ qua,
        // TRỪ KHI giao dịch này được tạo sau thời điểm chốt sổ (Backdated transaction tạo bù sau khi đã chốt)
        if (cpInfo && cpInfo.date) {
          const isAfter = isTransactionAfterCheckpoint(txDate, cpInfo.date, cpInfo.dateStr);
          if (!isAfter) {
            const txCreatedAtRaw = row.length >= 14 ? row[13] : "";
            const txCreatedAtTs = txCreatedAtRaw ? new Date(txCreatedAtRaw).getTime() : 0;
            const cpTs = cpInfo.createdAtTs || (cpInfo.date ? (new Date(cpInfo.date).getTime()) : 0);
            const isBackdated = txCreatedAtTs > 0 && cpTs > 0 && (txCreatedAtTs > cpTs);
            if (!isBackdated) continue;
          }
        }

        // Lọc tháng/năm cho việc tính thống kê biến động trong kỳ (monthInc / monthDec)
        let isMatchPeriod = isAllMonth && isAllYear;
        if (!isMatchPeriod) {
          const dL = parseServerDate(txDate);
          const mL = dL ? (dL.getMonth() + 1) : null;
          const yL = dL ? dL.getFullYear() : null;
          isMatchPeriod = (isAllMonth || !mL || mL === targetMonth) && (isAllYear || !yL || yL === targetYear);
        }

        const amt = parseMoneyNumber(row[4]);
        if (amt <= 0) continue;

        const dir = String(row[5] || "").trim().toUpperCase();
        const isCred = walletIsCreditMap[wKey] !== undefined
          ? walletIsCreditMap[wKey]
          : (effectType === "CARD_DEBT" || /^c[-_\s]/i.test(wKey) || wKey.includes("thẻ") || wKey.includes("credit"));

        const isIncDir = isCred
          ? (dir === "DECREASE" || dir === "IN" || dir === "+")
          : (dir === "IN" || dir === "INCREASE" || dir === "+");

        // Chống cộng trùng nếu trong WalletLedger bị ghi đúp 2 dòng POSTED cho cùng 1 SourceID + Ví + Chiều
        const idemKey = is16Col ? String(row[10] || "").trim() : "";
        if (srcId && srcId !== "GEN" && !idemKey.includes("SETTLE_")) {
          const dedupKey = `${wKey}|${srcId.toLowerCase()}|${isIncDir ? "INC" : "DEC"}|${amt}`;
          if (seenLedgerTxKeys.has(dedupKey)) continue;
          seenLedgerTxKeys.add(dedupKey);
        }

        if (!walletMap[wKey]) walletMap[wKey] = { inc: 0, dec: 0, monthInc: 0, monthDec: 0 };

        // 1. Số dư lũy kế của Thẻ/Ví luôn tính từ Phần chốt + hoặc - cho toàn bộ phần tiếp theo sau chốt sổ
        if (isCred) {
          if (isIncDir) {
            // Tất toán thẻ: GIẢM DƯ NỢ (giảm CHI/dec), TUYỆT ĐỐI KHÔNG TĂNG THU
            walletMap[wKey].dec = Math.max(0, (walletMap[wKey].dec || 0) - amt);
            cardSettlementMap[wKey] = (cardSettlementMap[wKey] || 0) + amt;
          } else {
            walletMap[wKey].dec = (walletMap[wKey].dec || 0) + amt;
            cardStatementDebtMap[wKey] = (cardStatementDebtMap[wKey] || 0) + amt;
          }
        } else {
          if (isIncDir) {
            walletMap[wKey].inc += amt;
          } else {
            walletMap[wKey].dec += amt;
          }
        }

        // 2. Thống kê biến động THU / CHI trong tháng đang chọn
        if (isMatchPeriod) {
          if (isCred) {
            if (isIncDir) walletMap[wKey].monthDec = Math.max(0, (walletMap[wKey].monthDec || 0) - amt);
            else walletMap[wKey].monthDec = (walletMap[wKey].monthDec || 0) + amt;
          } else {
            if (isIncDir) walletMap[wKey].monthInc += amt;
            else walletMap[wKey].monthDec += amt;
          }
        }
      }
    }

    // 1. Quét đơn PRE-ORDER từ Sổ Cái WalletLedger (Status = PENDING, EventType = PREORDER) làm Single Source of Truth
    let tab3Summary = null;
    const pendingPreOrders = [];
    const choShipOrderKeys = new Set();
    const choHoanOrderKeys = new Set();
    const khachNoOrderKeys = new Set();
    const preorderOrderKeys = new Set();
    const seenPreOrderIds = new Set();

    try {
      if (typeof getPendingPreOrdersFromLedger === 'function') {
        const ledgerPreorders = getPendingPreOrdersFromLedger(ss);
        ledgerPreorders.forEach(item => {
          const rawId = String(item.id || item.ledgerId || "").trim();
          if (rawId) seenPreOrderIds.add(rawId);
          if (String(item.sourceSheet || "").trim().toLowerCase() === "purchase") {
            pendingPreOrders.push(item);
          }

          const pKey = extractBaseOrderIdServer(rawId) || ('PREORDER_LED_' + rawId);
          preorderOrderKeys.add(pKey);

          const rawW = String(item.wallet || item.nguonTien || "").trim();
          const total = parseMoneyNumber(item.amount || item.total);
          const pDate = parseServerDate(item.date);
          const mP = pDate ? (pDate.getMonth() + 1) : null;
          const yP = pDate ? pDate.getFullYear() : null;
          const matchMonthP = isAllMonth || !mP || mP === targetMonth;
          const matchYearP = isAllYear || !yP || yP === targetYear;

          if (rawW && total > 0) {
            const wKey = resolveCanonicalWKey("", rawW);
            if (wKey) cardPreorderMap[wKey] = (cardPreorderMap[wKey] || 0) + total;
          }
        });
      }
    } catch (lPreErr) {
      Logger.log("Lỗi parse WalletLedger preOrders: " + lPreErr);
    }

    // Đơn chờ ship & chờ hoàn từ Sheet Purchase (chỉ lấy count trạng thái kho vận)
    try {
      const pSheet = getSheetByNameSafely("Purchase", ss);
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 13);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach((r, idx) => {
          const tenSP = String(r[4] || "").trim();
          const lowerWh = String(r[3] || "").trim().toLowerCase();
          const lowerCardStatus = String(r[9] || "").trim().toLowerCase();
          const lowerNotes = String(r[10] || "").trim().toLowerCase();
          const isCancelled = lowerWh.includes("hủy") || lowerWh.includes("bị hủy") || lowerWh.includes("cancel");

          if (tenSP && tenSP !== "Tên Sản Phẩm") {
            const rawId = String(r[0] || "").trim();
            const orderKey = extractBaseOrderIdServer(rawId) || ('PURCHASE_ROW_' + idx);
            const isPendingRefund = lowerWh.includes("chờ hoàn") || lowerWh.includes("cho_hoan") || lowerCardStatus.includes("cho_hoan") || lowerCardStatus.includes("chờ hoàn") || lowerCardStatus.includes("cần hoàn") || lowerCardStatus.includes("refund") || (isCancelled && (lowerCardStatus.includes("hoàn") || lowerWh.includes("hoàn") || lowerNotes.includes("hoàn")));
            const isChoShip = !isCancelled && (lowerWh === "chờ ship" || lowerWh === "cho ship");
            if (isChoShip) choShipOrderKeys.add(orderKey);
            if (isPendingRefund) choHoanOrderKeys.add(orderKey || ('REFUND_ROW_' + idx));
          }
        });
      }
    } catch (e) {
      Logger.log("Lỗi parse Purchase status counts: " + e);
    }

    // Đơn Khách Nợ từ Sheet Sales (gom theo mã đơn hàng)
    try {
      const sSheet = getSheetByNameSafely("Sales", ss);
      if (sSheet && sSheet.getLastRow() >= 2) {
        const lastColS = Math.max(sSheet.getLastColumn(), 11);
        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, lastColS).getValues();
        sData.forEach((r, idx) => {
          const tenSP = String(r[2] || "").trim();
          if (!tenSP && !r[0]) return;

          const dS = parseServerDate(r[1]);
          const mS = dS ? (dS.getMonth() + 1) : null;
          const yS = dS ? dS.getFullYear() : null;
          const matchMonthS = isAllMonth || !mS || mS === targetMonth;
          const matchYearS = isAllYear || !yS || yS === targetYear;

          if (matchMonthS && matchYearS) {
            const rawId = String(r[0] || "").trim();
            const orderKey = extractBaseOrderIdServer(rawId) || ('SALES_ROW_' + idx);
            const nhanTien = String(r[8] || "").trim().toLowerCase();
            const trangThai = String(r[9] || "").trim().toUpperCase();
            const ghiChu = String(r[10] || r[9] || "").trim().toLowerCase();

            const isCompleted = trangThai === "HOAN_TAT" || trangThai === "HOÀN TẤT" || trangThai === "HOAN TAT" ||
                                trangThai === "ĐÃ THU" || trangThai === "DA_THU" || trangThai === "DA THU" ||
                                trangThai === "ĐÃ THANH TOÁN" || trangThai === "DA THANH TOAN" || trangThai === "DONE" ||
                                ghiChu.includes("đã thu") || ghiChu.includes("da thu") || ghiChu.includes("đã thanh toán");
            const isChoThu = !isCompleted && (trangThai === "CHO_THU" || trangThai.includes("CHỜ THU") || nhanTien.includes("nợ") || (ghiChu.includes("khách nợ") && !ghiChu.includes("đã thu")));
            if (isChoThu) {
              khachNoOrderKeys.add(orderKey);
            }
          }
        });
      }
    } catch(e) {
      Logger.log("Lỗi đếm khách nợ từ Sheet Sales: " + e);
    }

    const wallets = [];
    const batchRowsToSync = [];
    let hasAnySheetChanges = false;

    dataRows.forEach(function(r, index) {
      const id = String(r[colMap.id] || "").trim();
      if (!id) return;

      const wName = String(r[colMap.name] || "").trim();
      const wNameLower = wName.toLowerCase();
      const initialBal = parseMoneyNumber(r[colMap.initial_balance]);
      const isCredit = String(r[colMap.type] || "DEBIT").trim().toUpperCase() === "CREDIT";

      // 🌟 Giá trị lấy trực tiếp từ sheet Wallets (Số từ ban đầu + thu - chi => số dư hiện tại)
      const sheetInit = initialBal;
      const sheetInc = (colMap.total_increase !== undefined && colMap.total_increase >= 0) ? parseMoneyNumber(r[colMap.total_increase]) : 0;
      const sheetDec = (colMap.total_decrease !== undefined && colMap.total_decrease >= 0) ? parseMoneyNumber(r[colMap.total_decrease]) : 0;
      const sheetCur = (colMap.current_balance !== undefined && colMap.current_balance >= 0 && r[colMap.current_balance] !== "" && r[colMap.current_balance] !== undefined)
        ? parseMoneyNumber(r[colMap.current_balance])
        : (sheetInit + sheetInc - sheetDec);

      // Số dư hiện tại chuẩn theo sheet Wallets: Số ban đầu + Thu - Chi
      const walletFromSheetBal = (sheetInc !== 0 || sheetDec !== 0)
        ? (sheetInit + sheetInc - sheetDec)
        : ((sheetCur !== undefined && sheetCur !== 0) ? sheetCur : sheetInit);

      const creditLimit = parseMoneyNumber(r[colMap.credit_limit]);
      const sheetPreorder = (colMap.preorder !== undefined && colMap.preorder >= 0) ? parseMoneyNumber(r[colMap.preorder]) : 0;
      const sheetDebt = isCredit ? ((sheetDec > 0 || sheetInc > 0) ? ((sheetInc > 0 && sheetInc >= sheetDec) ? sheetDec : Math.max(0, sheetDec - sheetInc)) : Math.abs(sheetInit)) : 0;
      const sheetAvail = isCredit ? (creditLimit > 0 ? Math.max(0, creditLimit - sheetDebt - sheetPreorder) : 0) : walletFromSheetBal;

      const canonKey = resolveCanonicalWKey(id, wName) || wNameLower;
      const cpInfo = walletCheckpointMap[canonKey] || walletCheckpointMap[wNameLower] || (id ? walletCheckpointMap[id.toLowerCase()] : null);
      const rawCpVal = (colMap.checkpoint_date >= 0 && r[colMap.checkpoint_date]) ? r[colMap.checkpoint_date] : "";
      const cpDateStr = cpInfo ? cpInfo.dateStr : formatServerDateToDDMMYYYY(rawCpVal);
      let cpBal = initialBal;
      if (cpInfo) {
        cpBal = cpInfo.balance;
      } else if (cpDateStr) {
        if (colMap.checkpoint_balance >= 0 && r[colMap.checkpoint_balance] !== undefined && r[colMap.checkpoint_balance] !== "") {
          if (is13ColLayout || isLegacy11or12) {
            const rowInc = parseMoneyNumber(r[colMap.total_increase]);
            const rowDec = parseMoneyNumber(r[colMap.total_decrease]);
            const rowCur = parseMoneyNumber(r[colMap.current_balance]);
            cpBal = (rowInc === 0 && rowDec === 0 && rowCur !== 0) ? rowCur : initialBal;
          } else {
            cpBal = parseMoneyNumber(r[colMap.checkpoint_balance]);
          }
        }
      }
      const baseBal = (cpInfo || cpDateStr) ? cpBal : initialBal;

      let inc = sheetInc;
      let dec = sheetDec;
      let monthInc = inc;
      let monthDec = dec;

      let currentBal = isCredit ? -sheetDebt : walletFromSheetBal;
      let statementDebt = sheetDebt;
      let availableCredit = sheetAvail;
      let cardPreorderAmt = sheetPreorder;

      if (!fromSheetOnly && hasLedgerSheet) {
        inc = 0;
        dec = 0;
        if (walletMap[canonKey]) {
          inc = walletMap[canonKey].inc;
          dec = walletMap[canonKey].dec;
          monthInc = walletMap[canonKey].monthInc !== undefined ? walletMap[canonKey].monthInc : inc;
          monthDec = walletMap[canonKey].monthDec !== undefined ? walletMap[canonKey].monthDec : dec;
        } else if (walletMap[wNameLower]) {
          inc = walletMap[wNameLower].inc;
          dec = walletMap[wNameLower].dec;
          monthInc = walletMap[wNameLower].monthInc !== undefined ? walletMap[wNameLower].monthInc : inc;
          monthDec = walletMap[wNameLower].monthDec !== undefined ? walletMap[wNameLower].monthDec : dec;
        }

        currentBal = baseBal + inc - dec;

        if (isCredit) {
          cardPreorderAmt = cardPreorderMap[canonKey] || cardPreorderMap[wNameLower] || 0;
          const baseDebt = Math.abs(baseBal);
          statementDebt = Math.max(0, baseDebt + dec - inc);
          availableCredit = creditLimit > 0 ? Math.max(0, creditLimit - statementDebt - cardPreorderAmt) : 0;
          currentBal = statementDebt > 0 ? -statementDebt : 0;
        }
      } else if (!fromSheetOnly && !hasLedgerSheet) {
        currentBal = isCredit ? -sheetDebt : walletFromSheetBal;
      }

      const statusStr = (colMap.balance_status >= 0 && r[colMap.balance_status]) ? String(r[colMap.balance_status]).trim() : "SYNCED";
      const settleSrc = (colMap.settle_source >= 0 && r[colMap.settle_source]) ? String(r[colMap.settle_source]).trim() : "";

      const finalBal = (currentBal === 0 || Object.is(currentBal, -0)) ? 0 : currentBal;
      const finalDebt = isCredit ? statementDebt : 0;

      const recInfo = walletLatestRecMap[wNameLower] || (canonKey ? walletLatestRecMap[canonKey] : null) || (id ? walletLatestRecMap[id.toLowerCase()] : null);
      const lastRecDateStr = recInfo ? recInfo.dateStr : "";
      const lastRecBatchId = recInfo ? recInfo.batchId : "";

      const colNStatus = (r.length >= 14 && r[13] !== undefined) ? String(r[13] || "").trim().toUpperCase() : "";
      const isCardDeleted = (colNStatus === "DELETED" || colNStatus === "HIDDEN" || colNStatus === "XOA" || colNStatus === "ĐÃ XÓA");

      let cardLast4 = "";
      let maskedNum = "";
      try {
        // Thẻ chính: Load số thẻ duy nhất từ Cột O (15, index 14)
        if (r.length >= 15 && r[14] !== undefined && r[14] !== null && String(r[14]).trim() !== "") {
          const rawVal = String(r[14]).trim();
          let dec = rawVal;
          if (rawVal.startsWith("ENC:v1:") && typeof decryptCardField === 'function') {
            dec = decryptCardField(rawVal);
          }
          const cleanDigits = String(dec || '').replace(/\D/g, '');
          if (cleanDigits.length >= 4 && cleanDigits.length <= 19) {
            cardLast4 = cleanDigits.slice(-4);
            maskedNum = "•••• •••• •••• " + cardLast4;
          }
        }
      } catch(eN) {}

      // Nếu ví Debit/Cash có số dư trên sheet nhưng finalBal = 0 do chưa có phát sinh trong Sổ Cái
      let resolvedBal = finalBal;
      if (!isCredit && resolvedBal === 0 && walletFromSheetBal !== 0 && inc === 0 && dec === 0 && !cpInfo && !cpDateStr) {
        resolvedBal = walletFromSheetBal;
      }

      const walletObj = {
        id: id,
        name: wName,
        type: isCredit ? "CREDIT" : "DEBIT",
        credit_limit: creditLimit,
        closing_date: (r[colMap.closing_date] instanceof Date) ? formatServerDateToDDMMYYYY(r[colMap.closing_date]) : (r[colMap.closing_date] ? String(r[colMap.closing_date]) : ""),
        due_date: (r[colMap.due_date] instanceof Date) ? formatServerDateToDDMMYYYY(r[colMap.due_date]) : (r[colMap.due_date] ? String(r[colMap.due_date]) : ""),
        initial_balance: initialBal,
        total_increase: isCredit ? 0 : (hasLedgerSheet ? monthInc : inc),
        total_decrease: isCredit ? statementDebt : (hasLedgerSheet ? monthDec : dec),
        current_balance: resolvedBal,
        debt: finalDebt,
        statement_debt: finalDebt,
        preorder: cardPreorderAmt,
        preorder_amount: cardPreorderAmt,
        available: availableCredit,
        settle_source: settleSrc,
        checkpoint_date: cpDateStr,
        checkpoint_balance: cpBal,
        last_reconciled_date: lastRecDateStr,
        last_reconciled_batch: lastRecBatchId,
        balance_status: statusStr
      };

      if (cardLast4) {
        walletObj.last4 = cardLast4;
        walletObj.masked_number = maskedNum;
      }

      const rawColV = r.length >= 22 ? r[21] : null;
      const rawColW = r.length >= 23 ? r[22] : null;
      if (typeof parseWalletTemplateCell === 'function') {
        walletObj.fileTemplate = parseWalletTemplateCell(rawColV);
        walletObj.pasteTemplate = parseWalletTemplateCell(rawColW);
      }

      if (isCardDeleted) {
        walletObj.status = colNStatus;
        walletObj.is_hidden = true;
        walletObj.is_deleted = true;
      }

      if (fromSheetOnly) {
        walletObj.sheet_initial_balance = sheetInit;
        walletObj.sheet_total_increase = sheetInc;
        walletObj.sheet_total_decrease = sheetDec;
        walletObj.sheet_current_balance = walletFromSheetBal;
        walletObj.sheet_debt = sheetDebt;
        walletObj.sheet_available = sheetAvail;
      }

      wallets.push(walletObj);

      // Thu thập dữ liệu để đồng bộ 1 lần duy nhất cho toàn bộ sheet Wallets (tránh ghi từng dòng gây lag 15s)
      if (!fromSheetOnly && isAllMonth && isAllYear) {
        const sheetBalToWrite = isCredit ? availableCredit : currentBal;
        if (is13ColLayout) {
          const curH = parseMoneyNumber(r[7]);
          const curI = parseMoneyNumber(r[8]);
          const curJ = parseMoneyNumber(r[9]);
          const curK = parseMoneyNumber(r[10]);
          if (curH !== inc || curI !== dec || curJ !== cardPreorderAmt || curK !== sheetBalToWrite) {
            hasAnySheetChanges = true;
          }
          batchRowsToSync.push([inc, dec, cardPreorderAmt, sheetBalToWrite]);
        } else if (isLegacy11or12) {
          const curH = parseMoneyNumber(r[7]);
          const curI = parseMoneyNumber(r[8]);
          const curJ = parseMoneyNumber(r[9]);
          if (curH !== inc || curI !== dec || curJ !== sheetBalToWrite) {
            hasAnySheetChanges = true;
          }
          batchRowsToSync.push([inc, dec, sheetBalToWrite]);
        }
      }
    });

    // 🌟 Ghi đồng bộ hàng loạt (Batch update 1 lần duy nhất) nếu có thay đổi
    if (!fromSheetOnly && isAllMonth && isAllYear && hasAnySheetChanges && batchRowsToSync.length > 0 && sheet && typeof sheet.getRange === 'function') {
      try {
        if (is13ColLayout) {
          sheet.getRange(2, 8, batchRowsToSync.length, 4).setValues(batchRowsToSync);
        } else if (isLegacy11or12) {
          sheet.getRange(2, 8, batchRowsToSync.length, 3).setValues(batchRowsToSync);
        }
      } catch(eSync) {}
    }

    const countChoShip = choShipOrderKeys.size;
    const countPreorder = preorderOrderKeys.size;
    const countKhachNo = khachNoOrderKeys.size;
    const countChoHoan = choHoanOrderKeys.size;

    // Danh sách Thẻ Ảo độc lập từ Cột R (R2..U)
    const virtualCards = [];
    dataRows.forEach(function(r, index) {
      const rowNum = index + 2;
      const rawVName = (r.length >= 18 && r[17] !== undefined && r[17] !== null) ? String(r[17]).trim() : "";
      const rawVNum  = (r.length >= 19 && r[18] !== undefined && r[18] !== null) ? String(r[18]).trim() : "";
      const rawVExp  = (r.length >= 20 && r[19] !== undefined && r[19] !== null) ? String(r[19]).trim() : "";
      const rawVCvv  = (r.length >= 21 && r[20] !== undefined && r[20] !== null) ? String(r[20]).trim() : "";

      if (rawVName || rawVNum || rawVExp || rawVCvv) {
        let vName = rawVName;
        if (rawVName.startsWith("ENC:v1:") && typeof decryptCardField === 'function') {
          vName = decryptCardField(rawVName);
        }
        let decNum = rawVNum;
        if (rawVNum.startsWith("ENC:v1:") && typeof decryptCardField === 'function') {
          decNum = decryptCardField(rawVNum);
        }
        const cleanDigits = String(decNum || '').replace(/\D/g, '');
        const last4 = cleanDigits.length >= 4 ? cleanDigits.slice(-4) : cleanDigits;
        const masked = last4 ? ("•••• •••• •••• " + last4) : (decNum || "");
        virtualCards.push({
          id: "VC_" + rowNum,
          row: rowNum,
          name: vName || ("Thẻ Ảo R" + rowNum),
          last4: last4,
          masked_number: masked,
          cardNumber: masked,
          cardExp: "",
          cardCvv: "",
          isVirtual: true,
          type: "VIRTUAL",
          is_hidden: false
        });
      }
    });

    return {
      success: true,
      wallets: wallets,
      virtualCards: virtualCards,
      tab3Summary: tab3Summary,
      pendingPreOrders: pendingPreOrders,
      orderCounts: {
        choShip: countChoShip,
        preorder: countPreorder,
        khachNo: countKhachNo,
        choHoan: countChoHoan
      }
    };
  } catch (err) {
    Logger.log("Lỗi getWalletsFromSheet: " + err.toString());
    return { success: false, message: err.toString(), wallets: [], pendingPreOrders: [] };
  }
}

function saveWalletToSheet(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (payload && payload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const requestId = payload ? (payload.requestId || payload.clientRequestId) : null;

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    let sheet = getSheetByNameSafely(SHEET_WALLETS, ss) || (ss ? (ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe") || ss.getSheetByName("Ví")) : null);
    if (!sheet) {
      if (ss && typeof ss.insertSheet === 'function') {
        sheet = ss.insertSheet("Wallets");
      } else {
        return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Wallets'." };
      }
    }

    if (sheet.getLastRow() < 1) {
      const defaultHeaders = [
        "Mã Ví", "Tên Ví", "Phân Loại", "Hạn Mức", "Ngày Chốt", "Ngày Trả",
        "Số Dư Ban Đầu", "Tổng Thu", "Tổng Chi", "Đơn Preorder", "Số Dư Hiện Tại",
        "Nguồn Thanh Toán", "Ngày Chốt Sổ", "Trạng Thái",
        "Số Thẻ Chính", "HSD Thẻ Chính", "CVV Thẻ Chính",
        "Tên Thẻ Ảo", "Số Thẻ Ảo", "HSD Thẻ Ảo", "CVV Thẻ Ảo",
        "Mẫu Sao Kê (File)", "Mẫu Sao Kê (Dán)"
      ];
      sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    }

    if (!payload.name) {
      return { success: false, message: "❌ Lỗi: Vui lòng nhập tên Ví / Thẻ!" };
    }

    let walletName = String(payload.name).trim();
    if (payload.type === "CREDIT" && walletName) {
      if (!/^C[-_\s]/i.test(walletName)) {
        walletName = "C- " + walletName;
      } else if (/^c-/i.test(walletName)) {
        walletName = "C- " + walletName.slice(2).trim();
      }
    } else if (payload.type && payload.type !== "CREDIT" && walletName) {
      if (/^C[-_\s]/i.test(walletName)) {
        walletName = walletName.replace(/^C[-_\s]+/i, '').trim();
      }
    }
    payload.name = walletName;

    const lastRow = sheet.getLastRow();
    let rowIndex = -1;

    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]).trim() === String(payload.id).trim()) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    let initialBal = 0;
    let totalInc = 0;
    let totalDec = 0;
    let preorder = payload.preorder !== undefined ? Number(payload.preorder) : 0;
    let currentBal = 0;
    let settleSource = payload.settle_source || "";
    let checkpointDate = payload.checkpoint_date || "";

    const headerRow = sheet.getLastRow() >= 1 ? (sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 13)).getValues()[0] || []) : [];
    const is13Col = headerRow.length >= 10 && (
      String(headerRow[9] || '').toUpperCase().includes('PREORDER') ||
      String(headerRow[9] || '').toUpperCase().includes('PRE-ORDER') ||
      String(headerRow[9] || '').toUpperCase().includes('ORDER')
    );

    if (rowIndex === -1) {
      initialBal = payload.initial_balance !== undefined ? Number(payload.initial_balance) : Number(payload.current_balance || 0);
      totalInc = Number(payload.total_increase || 0);
      totalDec = Number(payload.total_decrease || 0);
      currentBal = payload.current_balance !== undefined ? Number(payload.current_balance) : (initialBal + totalInc - totalDec);
    } else {
      const existingRow = sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), 13)).getValues()[0];
      initialBal = payload.initial_balance !== undefined ? Number(payload.initial_balance) : parseMoneyNumber(existingRow[6]);
      totalInc = parseMoneyNumber(existingRow[7]);
      totalDec = parseMoneyNumber(existingRow[8]);
      if (is13Col) {
        preorder = payload.preorder !== undefined ? Number(payload.preorder) : parseMoneyNumber(existingRow[9]);
        settleSource = payload.settle_source !== undefined ? payload.settle_source : (existingRow[11] || "");
        checkpointDate = payload.checkpoint_date !== undefined ? payload.checkpoint_date : (existingRow[12] || "");
      } else {
        settleSource = payload.settle_source !== undefined ? payload.settle_source : (existingRow[10] || "");
        checkpointDate = payload.checkpoint_date !== undefined ? payload.checkpoint_date : (existingRow[11] || "");
      }

      if (payload.current_balance !== undefined && !isNaN(Number(payload.current_balance))) {
        currentBal = Number(payload.current_balance);
        if (payload.initial_balance === undefined) {
          initialBal = currentBal - (totalInc - totalDec);
        }
      } else {
        currentBal = initialBal + totalInc - totalDec;
      }
    }

    const rowData = is13Col ? [
      payload.id || "W" + Date.now().toString().slice(-5),
      payload.name,
      payload.type || "DEBIT",
      payload.type === "CREDIT" ? parseMoneyNumber(payload.credit_limit) : "",
      payload.closing_date || "",
      payload.due_date || "",
      initialBal,
      totalInc,
      totalDec,
      preorder,
      currentBal,
      settleSource,
      checkpointDate
    ] : [
      payload.id || "W" + Date.now().toString().slice(-5),
      payload.name,
      payload.type || "DEBIT",
      payload.type === "CREDIT" ? parseMoneyNumber(payload.credit_limit) : "",
      payload.closing_date || "",
      payload.due_date || "",
      initialBal,
      totalInc,
      totalDec,
      currentBal,
      settleSource,
      checkpointDate
    ];

    if (rowIndex === -1) {
      sheet.appendRow(rowData);
    } else {
      const numCols = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 13) || 13;
      if (is13Col && numCols >= 13) {
        sheet.getRange(rowIndex, 1, 1, 13).setValues([rowData]);
      } else if (numCols >= 12) {
        sheet.getRange(rowIndex, 1, 1, Math.min(numCols, rowData.length)).setValues([rowData.slice(0, Math.min(numCols, rowData.length))]);
      } else if (numCols >= 11) {
        sheet.getRange(rowIndex, 1, 1, 11).setValues([rowData.slice(0, 11)]);
      } else {
        sheet.getRange(rowIndex, 1, 1, 7).setValues([rowData.slice(0, 7)]);
      }
    }

    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(payload.name);
    }
    const nowD = new Date();
    const curM = String(nowD.getMonth() + 1);
    const curY = String(nowD.getFullYear());
    if (typeof clearAppDataCache === 'function') clearAppDataCache(curM, curY);
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let freshWallets = null;
    try {
      const wRes = getWalletsFromSheet(curM, curY, ss);
      if (wRes && wRes.wallets) freshWallets = wRes.wallets;
    } catch (eW) {}

    const res = {
      success: true,
      wallets: freshWallets,
      updatedWallets: [{ id: rowData[0], name: rowData[1], currentBalance: currentBal, total_increase: totalInc, total_decrease: totalDec }],
      dataVersion: nextVersion,
      message: "✅ Đã lưu ví/thẻ thành công: " + payload.name
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * GHI BÚT TOÁN TÀI CHÍNH TẬP TRUNG VÀO SỔ CÁI (WalletLedger)
 * VÀ CẬP NHẬT TRỰC TIẾP SỐ DƯ MATERIALIZED (CurrentBalance)
 */
function recordFinancialEvent(event, ssTarget) {
  try {
    if (!event || !event.walletName || !event.amount) return { success: false, message: "Dữ liệu event không hợp lệ" };
    const rawSs = ssTarget || (event && event.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false };

    const ledgerSheet = getOrCreateSheetHelper(SHEET_WALLET_LEDGER, null, ss);

    const now = new Date();
    const ledgerId = "LED_" + Date.now().toString(36).toUpperCase() + "_" + Math.floor(Math.random()*1000);
    const txDate = event.date ? (event.date instanceof Date ? event.date : parseServerDate(event.date) || event.date) : now;
    const direction = (event.direction === "+" || String(event.type).toUpperCase() === "THU" || String(event.type).toUpperCase() === "IN") ? "+" : "-";
    const amt = parseMoneyNumber(event.amount);

    if (ledgerSheet) {
      const dStr = (txDate instanceof Date) ? `${txDate.getFullYear()}-${String(txDate.getMonth()+1).padStart(2,'0')}-${String(txDate.getDate()).padStart(2,'0')}` : String(txDate);
      const row = [
        ledgerId,
        event.walletId || "",
        event.walletName || "",
        dStr,
        amt,
        direction,
        event.type || (direction === "+" ? "THU" : "CHI"),
        event.sourceModule || event.module || "Family",
        event.sourceId || event.id || "",
        event.note || event.noidung || "",
        "POSTED",
        now.toISOString()
      ];
      ledgerSheet.appendRow(row);
    }

    // Cập nhật số dư tức thời trên sheet Wallets
    const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss) || getSheetByNameSafely("ViThe", ss);
    if (wSheet && wSheet.getLastRow() >= 2) {
      const wNameTarget = String(event.walletName).trim().toLowerCase();
      const wData = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, Math.max(wSheet.getLastColumn(), 12)).getValues();
      for (let i = 0; i < wData.length; i++) {
        const rowWName = String(wData[i][1] || "").trim().toLowerCase();
        if (rowWName === wNameTarget || (event.walletId && String(wData[i][0]).trim() === String(event.walletId).trim())) {
          const rowIndex = i + 2;
          const cur = parseMoneyNumber(wData[i][9]);
          const curInc = parseMoneyNumber(wData[i][7]);
          const curDec = parseMoneyNumber(wData[i][8]);
          if (direction === '+') {
            wSheet.getRange(rowIndex, 8).setValue(curInc + amt);
            wSheet.getRange(rowIndex, 10).setValue(cur + amt);
          } else {
            wSheet.getRange(rowIndex, 9).setValue(curDec + amt);
            wSheet.getRange(rowIndex, 10).setValue(cur - amt);
          }
          break;
        }
      }
    }

    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(event.walletName);
    }

    return { success: true, ledgerId: ledgerId };
  } catch (err) {
    Logger.log("Lỗi recordFinancialEvent: " + err);
    return { success: false, error: err.toString() };
  }
}

/**
 * 8. CHỐT SỔ KỲ / CHECKPOINT SỐ DƯ VÍ (TẠO MỐC SNAPSHOT MỚI)
 */
function checkpointWalletBalance(payload, ssTarget) {
  try {
    const rawSs = ssTarget || (payload && payload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss) || getSheetByNameSafely("ViThe", ss);
    if (!wSheet || wSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Wallets!" };

    const walletId = String(payload.walletId || payload.id || "").trim();
    const walletName = String(payload.walletName || payload.name || "").trim();

    const lastRow = wSheet.getLastRow();
    const lastCol = Math.max(wSheet.getLastColumn(), 19);
    const data = wSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let rowIndex = -1;
    let foundRow = null;

    for (let i = 0; i < data.length; i++) {
      const rId = String(data[i][0] || "").trim();
      const rName = String(data[i][1] || "").trim().toLowerCase();
      if ((walletId && rId === walletId) || (walletName && rName === walletName.toLowerCase())) {
        rowIndex = i + 2;
        foundRow = data[i];
        break;
      }
    }

    if (rowIndex === -1 || !foundRow) {
      return { success: false, message: "❌ Không tìm thấy ví/thẻ cần chốt sổ!" };
    }

    const resolvedWalletId = String(foundRow[0] || walletId).trim();
    const resolvedWalletName = String(foundRow[1] || walletName).trim();

    const rowType = String(foundRow[2] || '').trim().toUpperCase();
    const isCredit = (rowType === 'CREDIT') || (rowType !== 'DEBIT' && ((typeof isCreditCardWallet === 'function') ? isCreditCardWallet(resolvedWalletName, ss) : (/^c[-_\s]/i.test(resolvedWalletName) || resolvedWalletName.toLowerCase().includes("credit") || resolvedWalletName.toLowerCase().includes("tín dụng"))));

    let curBal = 0;
    if (payload.currentBalance !== undefined && payload.currentBalance !== null && String(payload.currentBalance).trim() !== '') {
      curBal = parseMoneyNumber(payload.currentBalance);
    } else {
      const headerRowVals = wSheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
      let cBalColIdx = -1;
      headerRowVals.forEach((h, hI) => {
        const ht = String(h || '').trim().toLowerCase();
        if (ht.includes('hiện tại') || ht === 'currentbalance') cBalColIdx = hI;
      });
      if (cBalColIdx >= 0) {
        curBal = parseMoneyNumber(foundRow[cBalColIdx]);
      } else if (lastCol >= 11) {
        curBal = parseMoneyNumber(foundRow[10]);
      } else {
        curBal = parseMoneyNumber(foundRow[9]);
      }

      // Đối với thẻ tín dụng: Nếu số dư hiện tại đang là 0 nhưng có phát sinh chi/thu hoặc nợ trước đó
      if (isCredit && curBal === 0) {
        const prevInit = Math.abs(parseMoneyNumber(foundRow[6] || 0));
        const prevInc = parseMoneyNumber(foundRow[7] || 0);
        const prevDec = parseMoneyNumber(foundRow[8] || 0);
        const calcDebt = Math.max(0, prevInit + prevDec - prevInc);
        if (calcDebt > 0) curBal = -calcDebt;
      }
    }

    // Đối với thẻ tín dụng: Nếu người dùng nhập số nợ dương (ví dụ 1021243), chuẩn hóa thành số âm (-1021243) để lưu vào database
    if (isCredit && curBal > 0) {
      curBal = -curBal;
    }

    const now = new Date();
    const cpId = "CP_" + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + "_" + Math.floor(Math.random()*10000);
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const todayDDMMYYYY = `${dd}/${mm}/${yyyy}`;

    let cpDateStr = todayDDMMYYYY;
    if (payload.checkpointDate) {
      const raw = String(payload.checkpointDate).trim();
      const pD = parseServerDate(raw);
      if (pD) {
        const pDd = String(pD.getDate()).padStart(2, '0');
        const pMm = String(pD.getMonth() + 1).padStart(2, '0');
        const pYyyy = pD.getFullYear();
        cpDateStr = `${pDd}/${pMm}/${pYyyy}`;
      } else {
        cpDateStr = raw.split(' ')[0];
      }
    }

    // 1. Ghi vào Sheet WalletCheckpoints
    const cpSheet = getOrCreateSheetHelper(SHEET_WALLET_CHECKPOINTS, null, ss);
    if (cpSheet) {
      cpSheet.appendRow([
        cpId,
        resolvedWalletId,
        resolvedWalletName,
        cpDateStr,
        curBal,
        now.toISOString(),
        payload.createdBy || "User",
        "ACTIVE"
      ]);
    }

    // 1b. Nếu có danh sách khớp đối soát đi kèm, tự động lưu vết vào BankReconciliations
    if (Array.isArray(payload.recMatched) && payload.recMatched.length > 0) {
      try {
        confirmReconcileBatch({
          walletName: resolvedWalletName,
          batchId: payload.batchId || ("REC_" + cpId),
          matched: payload.recMatched,
          reconciledBy: payload.createdBy || "User"
        }, ss);
      } catch(e) {}
    }

    // 2. Cập nhật Sheet Wallets: Copy Số Dư Hiện Tại sang Số Dư Ban Đầu (Đầu kỳ mới), reset THU/CHI về 0, lưu Checkpoint Date
    const headerRow = wSheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
    let initBalCol = -1;
    let incCol = -1;
    let decCol = -1;
    let curBalCol = -1;
    let cpIdCol = -1;
    let cpDateCol = -1;
    let cpBalCol = -1;
    let statusCol = -1;

    headerRow.forEach((h, idx) => {
      const title = String(h || '').trim().toLowerCase();
      if (!title) return;
      if (title.includes('ban đầu') || title === 'initialbalance') initBalCol = idx + 1;
      else if (title === 'thu' || title.includes('phát sinh tăng') || title === 'tăng') incCol = idx + 1;
      else if (title === 'chi' || title.includes('phát sinh giảm') || title === 'giảm') decCol = idx + 1;
      else if (title.includes('hiện tại') || title === 'currentbalance') curBalCol = idx + 1;
      else if (title === 'checkpointid') cpIdCol = idx + 1;
      else if ((title.includes('checkpoint') && (title.includes('date') || title.includes('ngày'))) || title.includes('ngày chốt sổ')) cpDateCol = idx + 1;
      else if ((title.includes('checkpoint') && (title.includes('balance') || title.includes('số dư'))) || title.includes('số dư chốt')) cpBalCol = idx + 1;
      else if (title.includes('trạng thái') || title.includes('status')) statusCol = idx + 1;
    });

    const is13ColCP = headerRow.length >= 10 && (
      String(headerRow[9] || '').toUpperCase().includes('PREORDER') ||
      String(headerRow[9] || '').toUpperCase().includes('PRE-ORDER') ||
      String(headerRow[9] || '').toUpperCase().includes('ORDER')
    );

    // Default fallback cho layout 13 cột hoặc 11-12 cột nếu không tìm thấy qua header
    if (is13ColCP) {
      if (initBalCol <= 0) initBalCol = 7;
      if (incCol <= 0) incCol = 8;
      if (decCol <= 0) decCol = 9;
      if (curBalCol <= 0) curBalCol = 11;
      if (cpDateCol <= 0) cpDateCol = 13;
    } else {
      if (initBalCol <= 0 && wSheet.getLastColumn() >= 10) initBalCol = 7;
      if (incCol <= 0 && wSheet.getLastColumn() >= 10) incCol = 8;
      if (decCol <= 0 && wSheet.getLastColumn() >= 10) decCol = 9;
      if (curBalCol <= 0 && wSheet.getLastColumn() >= 10) curBalCol = 10;
      if (cpDateCol <= 0 && wSheet.getLastColumn() >= 12) cpDateCol = 12;
    }

    if (initBalCol > 0) wSheet.getRange(rowIndex, initBalCol).setValue(curBal);
    if (incCol > 0) wSheet.getRange(rowIndex, incCol).setValue(0);
    if (decCol > 0) wSheet.getRange(rowIndex, decCol).setValue(0);
    if (curBalCol > 0) wSheet.getRange(rowIndex, curBalCol).setValue(curBal);
    if (cpDateCol > 0) wSheet.getRange(rowIndex, cpDateCol).setValue(cpDateStr);
    if (cpBalCol > 0) wSheet.getRange(rowIndex, cpBalCol).setValue(curBal);
    if (cpIdCol > 0) wSheet.getRange(rowIndex, cpIdCol).setValue(cpId);
    if (statusCol > 0) wSheet.getRange(rowIndex, statusCol).setValue("SYNCED");

    if (curBalCol <= 0 && cpDateCol <= 0) {
      // Fallback cho layout chuẩn 8-12
      const header8 = String(wSheet.getRange(1, 8).getValue() || '').toUpperCase();
      if (header8.includes('HIỆN TẠI') || header8.includes('CURRENT')) {
        wSheet.getRange(rowIndex, 7, 1, 6).setValues([[curBal, curBal, cpId, cpDateStr, curBal, "SYNCED"]]);
      } else {
        wSheet.getRange(rowIndex, 7, 1, 4).setValues([[curBal, 0, 0, curBal]]);
        if (wSheet.getLastColumn() >= 12) {
          wSheet.getRange(rowIndex, 12).setValue(cpDateStr);
        }
      }
    }

    // 3. Đánh dấu CheckpointRef vào các dòng WalletLedger chưa chốt của ví này
    if (typeof markCheckpointInLedger === 'function') {
      markCheckpointInLedger(resolvedWalletId, resolvedWalletName, cpId, ss);
    }

    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(resolvedWalletName);
    }
    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let freshWallets = [];
    if (typeof getWalletsFromSheet === 'function') {
      const freshRes = getWalletsFromSheet("ALL", "ALL", ss);
      if (freshRes && freshRes.wallets) freshWallets = freshRes.wallets;
    }

    const resObj = {
      success: true,
      message: `✅ Đã chốt sổ kỳ thành công cho ${resolvedWalletName}! Số dư gốc mốc chốt: ${curBal.toLocaleString()} ¥`,
      checkpointId: cpId,
      checkpointDate: cpDateStr,
      checkpointBalance: curBal,
      wallets: freshWallets,
      dataVersion: nextVersion
    };
    return JSON.parse(JSON.stringify(resObj));
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}

/**
 * 9. TỰ PHỤC HỒI / REBUILD SỐ DƯ VÍ TỪ MỐC CHECKPOINT
 */
function rebuildWalletBalance(walletIdentifier, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "Không tìm thấy spreadsheet" };

    const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss) || getSheetByNameSafely("ViThe", ss);
    if (!wSheet || wSheet.getLastRow() < 2) return { success: false, message: "Không tìm thấy sheet Wallets" };

    const targetId = String(walletIdentifier || "").trim();
    if (!targetId) return { success: false, message: "Vui lòng chỉ định Wallet ID hoặc Tên ví" };

    const lastRow = wSheet.getLastRow();
    const lastCol = Math.max(wSheet.getLastColumn(), 19);
    const data = wSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let rowIndex = -1;
    let foundRow = null;

    for (let i = 0; i < data.length; i++) {
      const rId = String(data[i][0] || "").trim();
      const rName = String(data[i][1] || "").trim().toLowerCase();
      if (rId === targetId || rName === targetId.toLowerCase()) {
        rowIndex = i + 2;
        foundRow = data[i];
        break;
      }
    }

    if (rowIndex === -1 || !foundRow) return { success: false, message: "Không tìm thấy ví cần rebuild" };

    const wId = String(foundRow[0] || "").trim().toLowerCase();
    const wName = String(foundRow[1] || "").trim();
    const isCredit = String(foundRow[2] || "DEBIT").trim().toUpperCase() === "CREDIT";
    const initialBal = parseMoneyNumber(foundRow[6]);
    let checkpointBal = initialBal;
    let checkpointDate = null;
    let checkpointCreatedAt = null;
    let hasActiveCpRecord = false;

    // 1. Tìm checkpoint mới nhất trong Sheet WalletCheckpoints
    const cpSheet = ss.getSheetByName(SHEET_WALLET_CHECKPOINTS);
    if (cpSheet && cpSheet.getLastRow() >= 2) {
      const cpData = cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, 8).getValues();
      for (let i = cpData.length - 1; i >= 0; i--) {
        const cpWId = String(cpData[i][1] || "").trim();
        const cpWName = String(cpData[i][2] || "").trim().toLowerCase();
        const status = String(cpData[i][7] || "ACTIVE").trim().toUpperCase();
        if ((cpWId === String(foundRow[0]).trim() || cpWName === wName.toLowerCase()) && status === "ACTIVE") {
          checkpointBal = parseMoneyNumber(cpData[i][4]);
          checkpointDate = parseServerDate(cpData[i][3]);
          checkpointCreatedAt = cpData[i][5] || null;
          hasActiveCpRecord = true;
          break;
        }
      }
    }

    // 2. Nếu không có trong WalletCheckpoints, kiểm tra cột Checkpoint trên Wallets
    if (!checkpointDate) {
      const headerRow = wSheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
      const is13ColRebuild = headerRow.length >= 10 && (
        String(headerRow[9] || '').toUpperCase().includes('PREORDER') ||
        String(headerRow[9] || '').toUpperCase().includes('PRE-ORDER') ||
        String(headerRow[9] || '').toUpperCase().includes('ORDER')
      );
      const isLegacy11or12Rebuild = !is13ColRebuild && headerRow.length >= 8 && (
        String(headerRow[7] || '').toUpperCase().includes('THU') ||
        String(headerRow[7] || '').toUpperCase().includes('TĂNG') ||
        String(headerRow[8] || '').toUpperCase().includes('CHI') ||
        String(headerRow[8] || '').toUpperCase().includes('GIẢM')
      );
      let cpDateIdx = -1;
      let cpBalIdx = -1;
      let curBalIdx = -1;
      headerRow.forEach((h, idx) => {
        const title = String(h || '').trim().toLowerCase();
        if ((title.includes('checkpoint') && (title.includes('date') || title.includes('ngày'))) || title.includes('ngày chốt sổ')) cpDateIdx = idx;
        else if ((title.includes('checkpoint') && (title.includes('balance') || title.includes('số dư'))) || title.includes('số dư chốt')) cpBalIdx = idx;
        else if (title.includes('hiện tại') || title === 'currentbalance') curBalIdx = idx;
      });
      if (cpDateIdx >= 0 && foundRow[cpDateIdx]) {
        checkpointDate = parseServerDate(foundRow[cpDateIdx]);
      } else if (is13ColRebuild && foundRow[12]) {
        checkpointDate = parseServerDate(foundRow[12]);
      } else if (foundRow[11]) {
        checkpointDate = parseServerDate(foundRow[11]);
      }
      if (cpBalIdx >= 0 && foundRow[cpBalIdx] !== undefined && foundRow[cpBalIdx] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[cpBalIdx]);
      } else if (is13ColRebuild) {
        const rowInc = parseMoneyNumber(foundRow[7]);
        const rowDec = parseMoneyNumber(foundRow[8]);
        const rowCur = parseMoneyNumber(foundRow[10]);
        checkpointBal = (rowInc === 0 && rowDec === 0 && rowCur !== 0) ? rowCur : initialBal;
      } else if (isLegacy11or12Rebuild) {
        const rowInc = parseMoneyNumber(foundRow[7]);
        const rowDec = parseMoneyNumber(foundRow[8]);
        const rowCur = parseMoneyNumber(foundRow[9]);
        checkpointBal = (rowInc === 0 && rowDec === 0 && rowCur !== 0) ? rowCur : initialBal;
      } else if (curBalIdx >= 0 && foundRow[curBalIdx] !== undefined && foundRow[curBalIdx] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[curBalIdx]);
      } else if (foundRow[10] !== undefined && foundRow[10] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[10]);
      } else if (foundRow[9] !== undefined && foundRow[9] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[9]);
      } else if (foundRow[12] !== undefined && foundRow[12] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[12]);
      }
    }

    // 3. Tính tổng phát sinh sau checkpoint trực tiếp 100% từ Sổ Cái WalletLedger
    let totalInc = 0;
    let totalDec = 0;

    function normalizeWalletName(str) {
      if (!str) return '';
      return String(str)
        .trim()
        .toLowerCase()
        .replace(/^(?:c[\s\-_:]*|thẻ\s+|ví\s+)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    const normWName = normalizeWalletName(wName);
    function matchW(val) {
      if (!val) return false;
      const s = String(val).trim().toLowerCase();
      if (s === wName.toLowerCase() || (wId && s === wId)) return true;
      const normS = normalizeWalletName(s);
      if (normS && normWName && normS === normWName) return true;
      return false;
    }

    let ledgerSheet = ss.getSheetByName(SHEET_WALLET_LEDGER) || ss.getSheetByName("WalletLedger");
    if ((!ledgerSheet || ledgerSheet.getLastRow() < 2) && typeof syncLedgerFromHistory === 'function') {
      try {
        syncLedgerFromHistory({ dryRun: false }, ss);
        ledgerSheet = ss.getSheetByName(SHEET_WALLET_LEDGER) || ss.getSheetByName("WalletLedger");
      } catch(e) {}
    }

    if (ledgerSheet && ledgerSheet.getLastRow() >= 2) {
      const lData = ledgerSheet.getRange(2, 1, ledgerSheet.getLastRow() - 1, Math.max(ledgerSheet.getLastColumn(), 16)).getValues();

      const seenRebuildTxKeys = new Set();
      for (let i = 0; i < lData.length; i++) {
        const row = lData[i];
        const is16Col = row.length >= 13;
        const status = String(row[is16Col ? 11 : 10] || "POSTED").trim().toUpperCase();
        if (status !== "POSTED") continue;

        const effectType = String(row[6] || "").trim().toUpperCase();
        if (effectType.startsWith("PARTNER_")) continue;

        const srcId = String(row[is16Col ? 8 : 7] || "").trim();
        const eventType = String(row[is16Col ? 9 : 8] || "").trim().toUpperCase();
        // Bỏ qua bút toán OPENING_BALANCE (INIT_...) vì đã có trong initialBal/checkpointBal
        if (eventType === "OPENING_BALANCE" || srcId.toUpperCase().startsWith("INIT_")) continue;

        const cpRef = is16Col ? String(row[15] || "").trim() : "";
        if (cpRef) continue; // Đã nằm trong mốc chốt sổ trước đó -> Bỏ qua

        if (!matchW(row[1]) && !matchW(row[2])) continue;

        // Nếu ví có mốc Checkpoint, mọi giao dịch trước ngày Checkpoint đều bị bỏ qua,
        // TRỪ KHI giao dịch này được tạo sau thời điểm chốt sổ (Backdated transaction tạo bù sau khi đã chốt)
        if (checkpointDate) {
          const isAfter = isTransactionAfterCheckpoint(row[3], checkpointDate);
          if (!isAfter) {
            const txCreatedAtRaw = row.length >= 14 ? row[13] : "";
            const txCreatedAtTs = txCreatedAtRaw ? new Date(txCreatedAtRaw).getTime() : 0;
            const cpCreatedAtTs = checkpointCreatedAt ? new Date(checkpointCreatedAt).getTime() : (checkpointDate ? new Date(checkpointDate).getTime() : 0);
            const isBackdated = txCreatedAtTs > 0 && cpCreatedAtTs > 0 && (txCreatedAtTs > cpCreatedAtTs);
            if (!isBackdated) continue;
          }
        }

        const amt = parseMoneyNumber(row[4]);
        if (amt <= 0) continue;

        const dir = String(row[5] || "").trim().toUpperCase();
        const isIncDir = isCredit
          ? (dir === "DECREASE" || dir === "IN" || dir === "+")
          : (dir === "IN" || dir === "INCREASE" || dir === "+");

        const idemKey = is16Col ? String(row[10] || "").trim() : "";
        if (srcId && srcId !== "GEN" && !idemKey.includes("SETTLE_")) {
          const dedupKey = `${srcId.toLowerCase()}|${isIncDir ? "INC" : "DEC"}|${amt}`;
          if (seenRebuildTxKeys.has(dedupKey)) continue;
          seenRebuildTxKeys.add(dedupKey);
        }

        if (isCredit) {
          if (isIncDir) {
            // Tất toán thẻ: GIẢM DƯ NỢ (giảm CHI/totalDec), TUYỆT ĐỐI KHÔNG TĂNG THU
            totalDec = Math.max(0, totalDec - amt);
          } else {
            // Chi tiêu thẻ: TĂNG DƯ NỢ (tăng CHI/totalDec)
            totalDec += amt;
          }
        } else {
          // DEBIT:
          if (isIncDir) totalInc += amt;
          else totalDec += amt;
        }
      }
    }

    let newCurrentBal;
    if (isCredit) {
      const creditLimit = parseMoneyNumber(foundRow[3]);
      const baseDebt = Math.abs(checkpointBal);
      const cardDebt = Math.max(0, baseDebt + totalDec);
      newCurrentBal = creditLimit > 0 ? Math.max(0, creditLimit - cardDebt) : 0;
      totalInc = 0; // Thẻ credit không có THU
      totalDec = cardDebt; // Dư nợ còn lại
    } else {
      newCurrentBal = checkpointBal + totalInc - totalDec;
    }

    // 4. Ghi lại vào Sheet Wallets & đặt BalanceStatus = SYNCED
    const header8 = String(wSheet.getRange(1, 8).getValue() || '').toUpperCase();
    const header10 = wSheet.getLastColumn() >= 10 ? String(wSheet.getRange(1, 10).getValue() || '').toUpperCase() : '';
    const is13ColHeader = header10.includes('PREORDER') || header10.includes('PRE-ORDER') || header10.includes('ORDER');

    const oldCurrentBal = is13ColHeader ? parseMoneyNumber(foundRow[10]) : (header8.includes('HIỆN TẠI') ? parseMoneyNumber(foundRow[7]) : parseMoneyNumber(foundRow[9]));
    const hasDiscrepancy = Math.abs(oldCurrentBal - newCurrentBal) >= 1;

    if (header8.includes('HIỆN TẠI') || header8.includes('CURRENT')) {
      wSheet.getRange(rowIndex, 8).setValue(newCurrentBal);
      wSheet.getRange(rowIndex, 12).setValue("SYNCED");
    } else if (is13ColHeader) {
      // Giữ nguyên preorder hiện tại ở Cột J (10), chỉ cập nhật THU (8), CHI (9), và Số Dư Hiện Tại (11)
      const currentPreorder = parseMoneyNumber(foundRow[9]);
      wSheet.getRange(rowIndex, 8, 1, 4).setValues([[totalInc, totalDec, currentPreorder, newCurrentBal]]);
    } else {
      wSheet.getRange(rowIndex, 8, 1, 3).setValues([[totalInc, totalDec, newCurrentBal]]);
    }

    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(wName);
    }
    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return {
      success: true,
      message: `✅ Đã rebuild số dư ví ${wName} thành công! Số dư hiện tại: ${newCurrentBal.toLocaleString()} ¥ (Status: SYNCED)`,
      currentBalance: newCurrentBal,
      oldBalance: oldCurrentBal,
      newBalance: newCurrentBal,
      discrepancy: hasDiscrepancy,
      difference: newCurrentBal - oldCurrentBal,
      status: "SYNCED"
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi rebuild: " + err.toString() };
  }
}

/**
 * REBUILD SỐ DƯ TẤT CẢ CÁC VÍ DỰA VÀO SỔ CÁI WALLETLEDGER LÀ NGUỒN SỰ THẬT
 * Thứ tự ghi cố định: WalletLedger trước, Wallets sau.
 * Viết hàm rebuildWalletBalances(ss) tính lại số dư mọi ví từ WalletLedger rồi so với sheet Wallets. Nếu lệch thì báo và sửa.
 * Chạy hàm này bằng trigger hằng ngày, hoặc nút "Kiểm tra số dư" cho người quản trị.
 */
function rebuildWalletBalances(ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    try {
      const rawSs = ssTarget || (typeof event !== 'undefined' && event && event.ssTarget) || null;
      const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
      if (!ss) return { success: false, message: "Không tìm thấy bảng tính dữ liệu" };

      const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss) || getSheetByNameSafely("ViThe", ss);
      if (!wSheet || wSheet.getLastRow() < 2) {
        return { success: true, message: "Sheet Wallets trống hoặc không có ví nào để kiểm tra", totalWallets: 0, discrepanciesFixed: 0, reconciled: [] };
      }

      const lastRow = wSheet.getLastRow();
      const lastCol = Math.max(wSheet.getLastColumn(), 14);
      const data = wSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      const reconciled = [];
      let discrepanciesCount = 0;

      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const wId = String(row[0] || "").trim();
        const wName = String(row[1] || "").trim();
        if (!wId && !wName) continue;

        const rb = rebuildWalletBalance(wId || wName, ss);
        if (rb && rb.success) {
          const isDiscrepant = Boolean(rb.discrepancy);
          if (isDiscrepant) discrepanciesCount++;
          reconciled.push({
            id: wId,
            name: wName,
            status: isDiscrepant ? "DISCREPANCY_FIXED" : "BALANCED",
            oldBalance: rb.oldBalance,
            newBalance: rb.newBalance,
            difference: rb.difference || 0
          });
        } else {
          reconciled.push({
            id: wId,
            name: wName,
            status: "ERROR",
            error: rb ? rb.message : "Rebuild failed"
          });
        }
      }

      if (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.flush) {
        SpreadsheetApp.flush();
      }
      if (typeof clearAppDataCache === 'function') {
        clearAppDataCache();
      }

      const msg = discrepanciesCount > 0
        ? `⚠️ Đã kiểm tra ${reconciled.length} ví. Phát hiện và tự động sửa lệch số dư cho ${discrepanciesCount} ví theo Sổ cái WalletLedger!`
        : `✅ Toàn bộ ${reconciled.length} ví đều khớp 100% với Sổ cái WalletLedger!`;

      return {
        success: true,
        message: msg,
        totalWallets: reconciled.length,
        discrepanciesFixed: discrepanciesCount,
        reconciled: reconciled
      };
    } catch(err) {
      return { success: false, message: "❌ Lỗi rebuildWalletBalances: " + err.toString() };
    }
  });
}

function rebuildAllWallets(ssTarget) {
  return rebuildWalletBalances(ssTarget);
}

/**
 * 3. XOÁ VÍ/THẺ
 */
/**
 * ẨN / XÓA THẺ VÀO CỘT N CỦA SHEET WALLETS (KHÔNG XÓA DÒNG ĐỂ BẢO VỆ DỮ LIỆU CŨ, KHÔNG HIỂN THỊ TRÊN SUGGEST)
 */
function hideCardOrWallet(idOrNameOrPayload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (typeof idOrNameOrPayload === 'object' && idOrNameOrPayload ? idOrNameOrPayload.ssTarget : null) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    let target = "";
    let isVirtual = false;
    let vRow = -1;
    if (typeof idOrNameOrPayload === 'object' && idOrNameOrPayload !== null) {
      target = String(idOrNameOrPayload.id || idOrNameOrPayload.name || "").trim();
      isVirtual = Boolean(idOrNameOrPayload.isVirtual || idOrNameOrPayload.mode === 'VIRTUAL' || target.startsWith("VC_"));
      if (idOrNameOrPayload.row && Number(idOrNameOrPayload.row) >= 2) vRow = Number(idOrNameOrPayload.row);
      else if (target.startsWith("VC_")) vRow = parseInt(target.replace("VC_", ""), 10);
    } else {
      target = String(idOrNameOrPayload || "").trim();
      isVirtual = target.startsWith("VC_");
      if (isVirtual) vRow = parseInt(target.replace("VC_", ""), 10);
    }

    if (!target) return { success: false, message: "⚠️ Thiếu thông tin thẻ cần xóa!" };

    const sheet = getSheetByNameSafely(SHEET_WALLETS, ss) || (ss ? ss.getSheetByName("Wallets") : null);
    if (!sheet) return { success: false, message: "Không tìm thấy sheet 'Wallets'!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "⚠️ Danh sách thẻ đang trống, không có thẻ để xóa!" };

    // Nếu là Thẻ Ảo -> Xóa sạch các cột R, S, T, U (18, 19, 20, 21) của hàng đó mà không xóa Thẻ chính
    if (isVirtual) {
      if (vRow === -1) {
        const vColData = sheet.getRange(2, 18, lastRow - 1, 1).getValues();
        for (let i = 0; i < vColData.length; i++) {
          if (String(vColData[i][0] || "").trim().toLowerCase() === target.toLowerCase()) {
            vRow = i + 2;
            break;
          }
        }
      }
      if (vRow >= 2 && vRow <= lastRow) {
        sheet.getRange(vRow, 18, 1, 4).setValues([["", "", "", ""]]);
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        return { success: true, message: `✅ Đã xóa thông tin thẻ ảo "${target}" thành công!` };
      }
    }

    // Đảm bảo Sheet có ít nhất 14 cột (đến Cột N)
    const maxCols = (typeof sheet.getMaxColumns === 'function') ? sheet.getMaxColumns() : 26;
    if (maxCols < 14 && typeof sheet.insertColumnsAfter === 'function') {
      sheet.insertColumnsAfter(maxCols, 14 - maxCols);
    }

    // Đảm bảo tiêu đề cột N là 'Trạng Thái'
    try {
      const curHeaderN = String(sheet.getRange(1, 14).getValue() || "").trim();
      if (!curHeaderN) {
        sheet.getRange(1, 14).setValue("Trạng Thái");
      }
    } catch(e) {}

    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    let rowIndex = -1;
    let foundName = target;
    let foundId = target;

    for (let i = 0; i < data.length; i++) {
      const rId = String(data[i][0] || "").trim();
      const rName = String(data[i][1] || "").trim();
      if (rId.toLowerCase() === target.toLowerCase() || rName.toLowerCase() === target.toLowerCase()) {
        rowIndex = i + 2;
        foundId = rId;
        foundName = rName;
        break;
      }
    }

    if (rowIndex === -1) {
      return { success: false, message: "❌ Không tìm thấy thẻ trong database!" };
    }

    // Đối với Thẻ: Luôn chỉ ẩn đi (Ghi 'DELETED' vào Cột N) để bảo toàn dữ liệu lịch sử
    sheet.getRange(rowIndex, 14).setValue("DELETED");

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(foundName);
    }

    let freshWallets = [];
    if (typeof getWalletsFromSheet === 'function') {
      const freshRes = getWalletsFromSheet("ALL", "ALL", ss);
      if (freshRes && freshRes.wallets) freshWallets = freshRes.wallets;
    }

    return {
      success: true,
      message: `✅ Đã xóa thẻ "${foundName}" thành công (Đã ẩn khỏi giao diện và gợi ý, dữ liệu lịch sử được bảo toàn)!`,
      cardId: foundId,
      cardName: foundName,
      wallets: freshWallets
    };
  });
}

/**
 * PHỤC HỒI THẺ ĐÃ ẨN (GỠ BỎ TRẠNG THÁI DELETED Ở CỘT N SHEET WALLETS)
 */
function restoreCardOrWallet(idOrNameOrPayload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (typeof idOrNameOrPayload === 'object' && idOrNameOrPayload ? idOrNameOrPayload.ssTarget : null) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    let target = "";
    if (typeof idOrNameOrPayload === 'object' && idOrNameOrPayload !== null) {
      target = String(idOrNameOrPayload.id || idOrNameOrPayload.name || "").trim();
    } else {
      target = String(idOrNameOrPayload || "").trim();
    }

    if (!target) return { success: false, message: "⚠️ Thiếu thông tin thẻ cần phục hồi!" };

    const sheet = getSheetByNameSafely(SHEET_WALLETS, ss) || (ss ? ss.getSheetByName("Wallets") : null);
    if (!sheet) return { success: false, message: "Không tìm thấy sheet 'Wallets'!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "⚠️ Danh sách thẻ đang trống, không có thẻ để xóa!" };

    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    let rowIndex = -1;
    let foundName = target;
    let foundId = target;

    for (let i = 0; i < data.length; i++) {
      const rId = String(data[i][0] || "").trim();
      const rName = String(data[i][1] || "").trim();
      if (rId.toLowerCase() === target.toLowerCase() || rName.toLowerCase() === target.toLowerCase()) {
        rowIndex = i + 2;
        foundId = rId;
        foundName = rName;
        break;
      }
    }

    if (rowIndex === -1) {
      return { success: false, message: "❌ Không tìm thấy thẻ trong database!" };
    }

    // Xóa cờ 'DELETED' ở Cột N (14) của hàng này trong sheet Wallets
    sheet.getRange(rowIndex, 14).setValue("");

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(foundName);
    }

    let freshWallets = [];
    if (typeof getWalletsFromSheet === 'function') {
      const freshRes = getWalletsFromSheet("ALL", "ALL", ss);
      if (freshRes && freshRes.wallets) freshWallets = freshRes.wallets;
    }

    return {
      success: true,
      message: `✅ Đã phục hồi thẻ "${foundName}" thành công!`,
      cardId: foundId,
      cardName: foundName,
      wallets: freshWallets
    };
  });
}

function deleteWalletFromSheet(idOrPayload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (typeof idOrPayload === 'object' && idOrPayload ? idOrPayload.ssTarget : null) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const id = (typeof idOrPayload === 'object' && idOrPayload !== null) ? String(idOrPayload.id || "").trim() : String(idOrPayload || "").trim();
    const requestId = (typeof idOrPayload === 'object' && idOrPayload !== null) ? (idOrPayload.requestId || idOrPayload.clientRequestId) : null;

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const sheet = getSheetByNameSafely(SHEET_WALLETS, ss);
    if (!sheet) return { success: false, message: "Không tìm thấy sheet 'Wallets'!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "⚠️ Danh sách thẻ đang trống, không có dữ liệu để xoá!" };

    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (let i = 0; i < data.length; i++) {
      const rId = String(data[i][0] || "").trim();
      const rName = String(data[i][1] || "").trim();
      if (rId.toLowerCase() === id.toLowerCase() || rName.toLowerCase() === id.toLowerCase()) {
        // Kiểm tra xem thẻ/ví đã có trong WalletLedger Cột C (hoặc B) chưa
        let isUsedInLedger = false;
        try {
          const lSheet = ss.getSheetByName("WalletLedger") || ss.getSheetByName("SoCaiVi");
          if (lSheet && lSheet.getLastRow() >= 2) {
            const lData = lSheet.getRange(2, 2, lSheet.getLastRow() - 1, 2).getValues();
            const idLow = rId.toLowerCase();
            const nameLow = rName.toLowerCase();
            for (let j = 0; j < lData.length; j++) {
              const colB = String(lData[j][0] || '').trim().toLowerCase();
              const colC = String(lData[j][1] || '').trim().toLowerCase();
              if ((colC && (colC === nameLow || colC === idLow)) || (colB && (colB === idLow || colB === nameLow))) {
                isUsedInLedger = true;
                break;
              }
            }
          }
        } catch(eL) {}

        if (isUsedInLedger) {
          // Đã có trong Sổ Cái WalletLedger Cột C -> CHỈ ĐƯỢC ẨN ĐI
          const maxCols = (typeof sheet.getMaxColumns === 'function') ? sheet.getMaxColumns() : 26;
          if (maxCols < 14 && typeof sheet.insertColumnsAfter === 'function') {
            sheet.insertColumnsAfter(maxCols, 14 - maxCols);
          }
          try {
            const curHeaderN = String(sheet.getRange(1, 14).getValue() || "").trim();
            if (!curHeaderN) sheet.getRange(1, 14).setValue("Trạng Thái");
          } catch(eN) {}
          sheet.getRange(i + 2, 14).setValue("DELETED");
        } else {
          // Chưa từng phát sinh trong WalletLedger -> Xóa dòng thật
          sheet.deleteRow(i + 2);
        }

        if (typeof clearAppDataCache === 'function') clearAppDataCache();
        if (typeof invalidateWalletTransactionCache === 'function') {
          invalidateWalletTransactionCache(rName);
        }
        const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

        let freshWallets = null;
        try {
          const wRes = getWalletsFromSheet(null, null, ss);
          if (wRes && wRes.wallets) freshWallets = wRes.wallets;
        } catch (eW) {}

        const res = {
          success: true,
          wallets: freshWallets,
          deletedId: id,
          dataVersion: nextVersion,
          message: isUsedInLedger
            ? `✅ Ví/thẻ "${rName || id}" đã có trong Sổ Cái (Sheet WalletLedger Cột C) nên đã được chuyển sang trạng thái Ẩn để bảo toàn dữ liệu lịch sử!`
            : `✅ Đã xoá ví/thẻ thành công!`
        };

        if (requestId && typeof recordProcessedRequest === 'function') {
          recordProcessedRequest(requestId, "DONE", res, ss);
        }

        return res;
      }
    }

    return { success: false, message: "Không tìm thấy ví cần xoá!" };
  });
}

function updateWalletBalanceHelper(walletName, amountChange, ssTarget) {
  const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
  if (!ss) return null;
  const sheet = (typeof getSheetByNames === 'function') ? getSheetByNames(SHEET_WALLETS, "Ví", ss) : (ss.getSheetByName(SHEET_WALLETS) || ss.getSheetByName("Ví"));
  if (!sheet || sheet.getLastRow() < 2) return null;

  const lastCol = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 11) || 11;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(lastCol, 11)).getValues();
  let header10 = '';
  try {
    if (lastCol >= 10) {
      const r10 = sheet.getRange(1, 10, 1, 1);
      if (typeof r10.getValue === 'function') {
        header10 = String(r10.getValue() || '').toUpperCase();
      } else if (typeof r10.getValues === 'function') {
        const v = r10.getValues();
        header10 = String((v && v[0] && v[0][0]) || '').toUpperCase();
      }
    }
  } catch(e) {}
  const is13ColHeader = header10.includes('PREORDER') || header10.includes('PRE-ORDER') || header10.includes('ORDER');

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === String(walletName).trim().toLowerCase()) {
      const rowIndex = i + 2;
      const wId = String(data[i][0] || "").trim();
      const wName = String(data[i][1] || "").trim();
      const isCredit = data[i][2] ? (String(data[i][2]).trim().toUpperCase() === "CREDIT") : /^c-\s*/i.test(wName);
      if (data[i].length >= 10 && lastCol >= 10) {
        const initialBal = parseMoneyNumber(data[i][6]);
        let inc = parseMoneyNumber(data[i][7]);
        let dec = parseMoneyNumber(data[i][8]);

        if (isCredit) {
          // 🌟 VỚI THẺ TÍN DỤNG (CREDIT):
          // Khi tất toán thẻ (amountChange > 0): GIẢM DƯ NỢ (giảm CHI/dec), TUYỆT ĐỐI KHÔNG TĂNG THU (inc)!
          // Khi chi tiêu thẻ (amountChange < 0): TĂNG DƯ NỢ (tăng CHI/dec)
          if (amountChange > 0) {
            dec = Math.max(0, dec - amountChange);
            inc = 0; // Thẻ credit không tích lũy THU
          } else if (amountChange < 0) {
            dec += Math.abs(amountChange);
          }

          const creditLimit = parseMoneyNumber(data[i][3]);
          const currentPreorder = is13ColHeader ? parseMoneyNumber(data[i][9]) : 0;
          const currentDebt = Math.max(0, dec - inc);
          const netBal = creditLimit > 0 ? Math.max(0, creditLimit - currentDebt - currentPreorder) : (initialBal + inc - dec);

          if (is13ColHeader) {
            sheet.getRange(rowIndex, 8, 1, 4).setValues([[inc, dec, currentPreorder, netBal]]);
          } else {
            sheet.getRange(rowIndex, 8, 1, 3).setValues([[inc, dec, netBal]]);
          }
          return { id: wId, name: wName, currentBalance: netBal, total_increase: inc, total_decrease: dec, debt: currentDebt };
        } else {
          // DEBIT / CASH:
          if (amountChange > 0) {
            inc += amountChange;
          } else if (amountChange < 0) {
            dec += Math.abs(amountChange);
          }

          const netBal = initialBal + inc - dec;
          if (is13ColHeader) {
            const currentPreorder = parseMoneyNumber(data[i][9]);
            sheet.getRange(rowIndex, 8, 1, 4).setValues([[inc, dec, currentPreorder, netBal]]);
          } else {
            sheet.getRange(rowIndex, 8, 1, 3).setValues([[inc, dec, netBal]]);
          }
          return { id: wId, name: wName, currentBalance: netBal, total_increase: inc, total_decrease: dec };
        }
      } else {
        const currentBal = parseMoneyNumber(data[i][6]);
        const netBal = currentBal + amountChange;
        sheet.getRange(rowIndex, 7).setValue(netBal);
        return { id: wId, name: wName, currentBalance: netBal };
      }
    }
  }
  return null;
}

/**
 * Tạo Mã giao dịch độc nhất (Unique Transaction ID)
 * Định dạng: [PREFIX][YYMMDDHHMMSS][SEQ3][RAND2]
 * Đảm bảo 100% không bao giờ trùng lặp ngay cả khi gọi liên tiếp trong cùng 1 giay.
 */
var _maGDSeq = 0;
function generateUniqueMaGD(prefix) {
  const pfx = prefix || "GD";
  const now = new Date();
  _maGDSeq = (_maGDSeq + 1) % 1000;
  const seqStr = String(_maGDSeq).padStart(3, "0");
  
  let timeStr = "";
  try {
    if (typeof Utilities !== "undefined" && Utilities.formatDate) {
      const formatted = Utilities.formatDate(now, "Asia/Tokyo", "yyMMddHHmmss");
      timeStr = String(formatted).replace(/[^0-9]/g, "");
    }
  } catch (e) {}
  
  if (!timeStr) {
    timeStr = String(now.getTime()).slice(-10);
  }
  
  const randStr = String(Math.floor(10 + Math.random() * 90));
  return pfx + timeStr + seqStr + randStr;
}

/**
 * 4. CHUYỂN TIỀN NỘI BỘ (VÍ -> VÍ)
 */
function processWalletTransfer(data, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (data && data.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const requestId = data ? (data.requestId || data.clientRequestId) : null;

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const fromWallet = String(data.fromWallet || "").trim();
    const toWallet = String(data.toWallet || "").trim();
    const amount = Number(data.amount);

    if (!fromWallet || !toWallet || fromWallet === toWallet || amount <= 0) {
      return { success: false, message: "❌ Lỗi: Dữ liệu ví hoặc số tiền không hợp lệ!" };
    }

    // Kiểm tra số dư ví nguồn (nếu là Ví Tiền Mặt / ATM / DEBIT - tính đúng Số Dư Hiện Tại, không phải Số Dư Ban Đầu)
    let srcWalletCurrentBal = null;
    let isSrcCredit = false;

    // 1. Ưu tiên lấy số dư hiện tại từ getWalletsFromSheet (tính toán đầy đủ mốc chốt sổ & thu chi thực tế)
    try {
      if (typeof getWalletsFromSheet === 'function') {
        const wListRes = getWalletsFromSheet('All', 'All', ss);
        if (wListRes && Array.isArray(wListRes.wallets)) {
          const found = wListRes.wallets.find(w => String(w.name || '').trim().toLowerCase() === fromWallet.toLowerCase());
          if (found) {
            isSrcCredit = (String(found.type || '').trim().toUpperCase() === 'CREDIT');
            srcWalletCurrentBal = Number(found.current_balance !== undefined ? found.current_balance : found.sheet_current_balance);
          }
        }
      }
    } catch (eWList) {}

    // 2. Fallback: Đọc từ sheet Wallets (tính đúng số dư hiện tại = Số dư ban đầu/chốt + Thu - Chi)
    if (srcWalletCurrentBal === null || isNaN(srcWalletCurrentBal)) {
      const walletSheet = getSheetByNameSafely(SHEET_WALLETS, ss);
      if (walletSheet && walletSheet.getLastRow() >= 2) {
        const lastCol = Math.max(walletSheet.getLastColumn(), 11);
        const wData = walletSheet.getRange(2, 1, walletSheet.getLastRow() - 1, lastCol).getValues();
        const headerRow = walletSheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];

        let curBalColIdx = -1;
        headerRow.forEach((h, idx) => {
          const title = String(h || '').trim().toLowerCase();
          if (title.includes('hiện tại') || title === 'currentbalance') {
            curBalColIdx = idx;
          }
        });

        for (let i = 0; i < wData.length; i++) {
          const wName = String(wData[i][1] || "").trim().toLowerCase();
          const wType = String(wData[i][2] || "").trim().toUpperCase();
          if (wName === fromWallet.toLowerCase()) {
            isSrcCredit = (wType === 'CREDIT');
            if (curBalColIdx >= 0 && wData[i][curBalColIdx] !== undefined && wData[i][curBalColIdx] !== "") {
              srcWalletCurrentBal = parseMoneyNumber(wData[i][curBalColIdx]);
            } else if (wData[i].length >= 10) {
              const initBal = parseMoneyNumber(wData[i][6]);
              const inc = parseMoneyNumber(wData[i][7]);
              const dec = parseMoneyNumber(wData[i][8]);
              srcWalletCurrentBal = initBal + inc - dec;
            } else {
              srcWalletCurrentBal = parseMoneyNumber(wData[i][6]);
            }
            break;
          }
        }
      }
    }

    if (!isSrcCredit && srcWalletCurrentBal !== null && !isNaN(srcWalletCurrentBal)) {
      if (amount > srcWalletCurrentBal) {
        return {
          success: false,
          message: "❌ Lỗi: Số tiền cần chuyển (" + amount.toLocaleString() + " ¥) vượt quá số dư hiện tại của ví (" + srcWalletCurrentBal.toLocaleString() + " ¥)!"
        };
      }
    }

    const updatedWallets = [];
    const wFrom = updateWalletBalanceHelper(fromWallet, -amount, ss);
    if (wFrom) updatedWallets.push(wFrom);
    const wTo = updateWalletBalanceHelper(toWallet, amount, ss);
    if (wTo) updatedWallets.push(wTo);

    const maGD = generateUniqueMaGD("TF");
    const rawDate = data && data.date ? data.date : null;
    const txDate = rawDate
      ? (typeof formatToDDMMYYYY === 'function' ? formatToDDMMYYYY(rawDate) : String(rawDate))
      : (typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB'));
    const noiDung = "Chuyển tiền: " + fromWallet + " -> " + toWallet;
    const note = data.note ? String(data.note).trim() : "";

    const familySheet = getSheetByNames("Family", "ThuChi", ss);
    if (familySheet) {
      familySheet.appendRow([maGD, txDate, "Chi", "CK NỘI BỘ", noiDung, amount, fromWallet, "", note]);
    }

    if (typeof postFinancialEvents === 'function') {
      const isFromCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(fromWallet, ss) : false;
      const isToCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(toWallet, ss) : false;

      const fromEffect = isFromCredit ? "CARD_DEBT" : "CASH";
      const fromDir = isFromCredit ? "INCREASE" : "OUT";
      const fromEvType = isFromCredit ? "CARD_CASH_ADVANCE" : "TRANSFER_OUT";

      const toEffect = isToCredit ? "CARD_DEBT" : "CASH";
      const toDir = isToCredit ? "DECREASE" : "IN";
      const toEvType = isToCredit ? "CARD_SETTLE" : "TRANSFER_IN";
      const toNote = isToCredit ? ("Tất toán thẻ từ " + fromWallet) : ("Nhận chuyển tiền từ: " + fromWallet);

      try {
        const postRes = postFinancialEvents([
          {
            walletId: fromWallet,
            walletName: fromWallet,
            date: txDate,
            transactionDate: txDate,
            direction: fromDir,
            amount: amount,
            effectType: fromEffect,
            type: fromEffect,
            status: "POSTED",
            eventType: fromEvType,
            sourceModule: "Transfer",
            sourceId: maGD,
            note: noiDung
          },
          {
            walletId: toWallet,
            walletName: toWallet,
            date: txDate,
            transactionDate: txDate,
            direction: toDir,
            amount: amount,
            effectType: toEffect,
            type: toEffect,
            status: "POSTED",
            eventType: toEvType,
            sourceModule: "Transfer",
            sourceId: maGD,
            note: toNote
          }
        ], ss);
        if (typeof Logger !== 'undefined' && Logger.log) Logger.log("processWalletTransfer postFinancialEvents result: " + JSON.stringify(postRes));
      } catch (errPost) {
        if (typeof Logger !== 'undefined' && Logger.log) Logger.log("processWalletTransfer postFinancialEvents error: " + errPost);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof clearAllWalletStatementCaches === 'function') {
      try { clearAllWalletStatementCaches(); } catch(e) {}
    }
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let allWallets = updatedWallets;
    try {
      const fullRes = getWalletsFromSheet("All", "All", ss);
      if (fullRes && Array.isArray(fullRes.wallets) && fullRes.wallets.length > 0) {
        allWallets = fullRes.wallets;
      }
    } catch(wErr) {}

    const res = {
      success: true,
      message: "✅ Đã chuyển " + amount.toLocaleString() + " ¥ từ " + fromWallet + " sang " + toWallet,
      updatedWallets: updatedWallets,
      wallets: allWallets,
      dataVersion: nextVersion
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 5. TẤT TOÁN THẺ TÍN DỤNG
 */
function processCreditCardSettlement(data, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (data && data.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    const requestId = data ? (data.requestId || data.clientRequestId) : null;

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const creditCard = String(data.creditCard || data.creditCardName || "").trim();
    const sourceWallet = String(data.sourceWallet || data.sourceWalletName || "").trim();
    const amount = Number(data.amount);

    if (!creditCard || !sourceWallet || amount <= 0) {
      return { success: false, message: "❌ Lỗi: Thông tin tất toán không hợp lệ!" };
    }

    // Cập nhật Cột K (Ví nguồn tất toán mặc định) cho Thẻ tín dụng trong sheet Wallets nếu có thay đổi
    const walletSheet = getSheetByNameSafely(SHEET_WALLETS, ss);
    if (walletSheet && walletSheet.getLastRow() >= 2) {
      const lastRow = walletSheet.getLastRow();
      const names = walletSheet.getRange(2, 2, lastRow - 1, 1).getValues();
      for (let i = 0; i < names.length; i++) {
        if (String(names[i][0] || "").trim().toLowerCase() === creditCard.toLowerCase()) {
          walletSheet.getRange(i + 2, 11).setValue(sourceWallet); // Cột K (11)
          break;
        }
      }
    }

    const updatedWallets = [];
    const wSource = updateWalletBalanceHelper(sourceWallet, -amount, ss);
    if (wSource) updatedWallets.push(wSource);
    const wCard = updateWalletBalanceHelper(creditCard, amount, ss);
    if (wCard) updatedWallets.push(wCard);

    const maGD = generateUniqueMaGD("CC");
    let dStr = "";
    if (data.date) {
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(String(data.date))) {
        const pts = String(data.date).split('T')[0].split('-');
        dStr = `${pts[2].padStart(2, '0')}/${pts[1].padStart(2, '0')}/${pts[0]}`;
      } else {
        dStr = String(data.date).trim();
      }
    }
    const now = dStr || (typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB'));
    const noiDung = "Tất toán thẻ: " + creditCard + " từ " + sourceWallet;
    const note = data.note ? String(data.note).trim() : "";

    const familySheet = getSheetByNames("Family", "ThuChi", ss);
    if (familySheet) {
      familySheet.appendRow([maGD, now, "Chi", "CK NỘI BỘ", noiDung, amount, sourceWallet, "", note]);
    }

    if (typeof postFinancialEvents === 'function') {
      try {
        const postRes = postFinancialEvents([
          {
            walletId: sourceWallet,
            walletName: sourceWallet,
            date: now,
            transactionDate: now,
            direction: "OUT",
            amount: amount,
            effectType: "CASH",
            type: "CASH",
            status: "POSTED",
            eventType: "CARD_SETTLE",
            sourceModule: "Wallets",
            sourceId: maGD,
            note: noiDung
          },
          {
            walletId: creditCard,
            walletName: creditCard,
            date: now,
            transactionDate: now,
            direction: "DECREASE",
            amount: amount,
            effectType: "CARD_DEBT",
            type: "CARD_DEBT",
            status: "POSTED",
            eventType: "CARD_SETTLE",
            sourceModule: "Wallets",
            sourceId: maGD,
            note: "Tất toán thẻ từ " + sourceWallet
          }
        ], ss);
        if (typeof Logger !== 'undefined' && Logger.log) Logger.log("processCreditCardSettlement postFinancialEvents result: " + JSON.stringify(postRes));
      } catch (errPost) {
        if (typeof Logger !== 'undefined' && Logger.log) Logger.log("processCreditCardSettlement postFinancialEvents error: " + errPost);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let freshWallets = null;
    try {
      const wRes = getWalletsFromSheet('All', 'All', ss);
      if (wRes && wRes.wallets) freshWallets = wRes.wallets;
    } catch (eW) {}

    const res = {
      success: true,
      wallets: freshWallets,
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      message: "✅ Đã tất toán " + amount.toLocaleString() + " ¥ cho " + creditCard
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 6. SỔ PHỤ TRUY VẤN LỊCH SỬ GIAO DỊCH ĐA BẢNG:
 * - Family (Thu chi gia đình)
 * - Debt / CongNo (Công nợ)
 * - Purchase / MuaHang (Mua hàng)
 * - Sales / BanHang (Bán hàng)
 */
function calculateStatementBillingMonth(useDateStr, closingDay) {
  if (!useDateStr) return '';
  let d = null, m = null, y = null;
  if (useDateStr instanceof Date) {
    if (isNaN(useDateStr.getTime())) return '';
    d = useDateStr.getDate();
    m = useDateStr.getMonth() + 1;
    y = useDateStr.getFullYear();
  } else {
    const str = String(useDateStr).trim();
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(str)) {
      const sep = str.includes('/') ? '/' : '-';
      const parts = str.split(' ')[0].split(sep);
      d = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
      y = parseInt(parts[2], 10);
      if (y < 100) y += 2000;
    } else if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(str)) {
      const sep = str.includes('-') ? '-' : '/';
      const parts = str.split(' ')[0].split(sep);
      y = parseInt(parts[0], 10);
      m = parseInt(parts[1], 10);
      d = parseInt(parts[2], 10);
    }
  }
  if (!m || !y) return '';

  const cDay = parseInt(closingDay, 10);
  if (!isNaN(cDay) && cDay > 0 && cDay <= 28) {
    if (d !== null && d > cDay) {
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return `01/${String(m).padStart(2, '0')}/${y}`;
}

function getWalletTransactionHistory(walletName, forceRefresh, ssTarget) {
  try {
    const rawWalletName = String(walletName || "").trim();
    if (!rawWalletName) return [];

    // Hỗ trợ truyền linh hoạt: getWalletTransactionHistory(walletName, ssTarget) hoặc getWalletTransactionHistory(walletName, forceRefresh, ssTarget)
    let isForce = false;
    let ssReal = null;
    if (typeof forceRefresh === 'boolean') {
      isForce = forceRefresh;
      ssReal = ssTarget;
    } else if (forceRefresh && typeof forceRefresh === 'object' && typeof forceRefresh.getSheetByName === 'function') {
      ssReal = forceRefresh;
      isForce = false;
    } else {
      ssReal = ssTarget;
    }

    const targetWallet = rawWalletName.toLowerCase();
    const cacheKey = "WALLET_STMT_V36_" + targetWallet.replace(/[^a-z0-9_]/g, '_');

    // 1. Siêu tốc từ CacheService (0-50ms) nếu đã có và không yêu cầu forceRefresh
    if (!isForce && !ssReal && typeof getCachedAppDataStr === 'function') {
      try {
        const cachedStr = getCachedAppDataStr(cacheKey);
        if (cachedStr) {
          const parsed = JSON.parse(cachedStr);
          if (Array.isArray(parsed) && parsed.length >= 0) {
            return parsed;
          }
        }
      } catch (cErr) {}
    }

    const ss = ssReal || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return [];

    function normalizeWalletName(str) {
      if (!str) return '';
      return String(str)
        .trim()
        .toLowerCase()
        .replace(/^(?:c[\s\-_:]*|thẻ\s+|ví\s+)/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const cleanNormTarget = normalizeWalletName(targetWallet);

    // 2. Tra cứu danh sách alias/canonical trước 1 lần duy nhất (O(1)) thay vì gọi hàm tra cứu liên tục trong vòng lặp
    let isTargetCreditCard = false;
    let targetClosingDate = "";
    let targetWalletId = "";
    const matchedNamesSet = new Set();
    matchedNamesSet.add(targetWallet);
    if (cleanNormTarget) matchedNamesSet.add(cleanNormTarget);

    const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss);
    let wAllData = [];
    let wHeader = [];
    let cpDateIdx = -1;
    let cpBalIdx = -1;
    let is13Col = false;

    if (wSheet && wSheet.getLastRow() >= 2) {
      const lastColW = Math.max(wSheet.getLastColumn(), 14);
      const wRows = wSheet.getRange(1, 1, wSheet.getLastRow(), lastColW).getValues();
      wHeader = wRows[0] || [];
      wAllData = wRows.slice(1);

      wHeader.forEach((h, hIdx) => {
        const ht = String(h || '').trim().toLowerCase();
        if ((ht.includes('checkpoint') && (ht.includes('date') || ht.includes('ngày'))) || ht.includes('ngày chốt sổ')) {
          cpDateIdx = hIdx;
        } else if ((ht.includes('checkpoint') && (ht.includes('bal') || ht.includes('số dư'))) || ht.includes('số dư chốt')) {
          cpBalIdx = hIdx;
        }
      });

      is13Col = wHeader.length >= 10 && (
        String(wHeader[9] || '').toUpperCase().includes('PREORDER') ||
        String(wHeader[9] || '').toUpperCase().includes('PRE-ORDER') ||
        String(wHeader[9] || '').toUpperCase().includes('ORDER')
      );

      if (cpDateIdx === -1) cpDateIdx = is13Col ? 12 : 11;
      if (cpBalIdx === -1) cpBalIdx = is13Col ? 13 : 10;

            let closingDateIdx = -1;
      wHeader.forEach((h, hIdx) => {
        const ht = String(h || '').trim().toLowerCase();
        if (ht.includes('sao kê') || (ht.includes('chốt') && !ht.includes('sổ'))) {
          closingDateIdx = hIdx;
        }
      });

      for (let i = 0; i < wAllData.length; i++) {
        const wId = String(wAllData[i][0] || '').trim();
        const wName = String(wAllData[i][1] || '').trim();
        const wType = String(wAllData[i][2] || '').trim().toUpperCase();
        const wLower = wName.toLowerCase();
        const wIdLower = wId.toLowerCase();
        const wNorm = normalizeWalletName(wName);

        const isMatchCurrent = (wLower === targetWallet || (wId && wIdLower === targetWallet) || (wNorm && cleanNormTarget && wNorm === cleanNormTarget));
        if (isMatchCurrent) {
          if (!targetWalletId) targetWalletId = wId;
          if (wType === 'CREDIT') isTargetCreditCard = true;
          if (closingDateIdx >= 0 && wAllData[i][closingDateIdx]) {
            targetClosingDate = String(wAllData[i][closingDateIdx]).trim();
          }
          matchedNamesSet.add(wLower);
          if (wNorm) matchedNamesSet.add(wNorm);
          if (wIdLower) matchedNamesSet.add(wIdLower);
        }
      }
    }

    if (typeof resolveWalletCanonicalName === 'function') {
      try {
        const canon = String(resolveWalletCanonicalName(targetWallet, ss) || "").trim().toLowerCase();
        if (canon) {
          matchedNamesSet.add(canon);
          const normCanon = normalizeWalletName(canon);
          if (normCanon) matchedNamesSet.add(normCanon);
        }
      } catch (cErr) {}
    }

    if (!isTargetCreditCard && (/^c-\s*/i.test(targetWallet) || targetWallet.includes("credit") || targetWallet.includes("tín dụng"))) {
      isTargetCreditCard = true;
    }

    const targetWalletIdLower = targetWalletId ? targetWalletId.toLowerCase() : "";

    // Fast O(1) matching closure
    function matchWalletFast(val) {
      if (!val) return false;
      const s = String(val).trim().toLowerCase();
      if (matchedNamesSet.has(s)) return true;
      const norm = normalizeWalletName(s);
      if (norm && matchedNamesSet.has(norm)) return true;
      return false;
    }

        const history = [];

    // Ánh xạ Ngày Mua (useDate) và Ngày Sao Kê (statementDate) từ các Sheet nghiệp vụ
    const sourceMetaMap = {};
    if (isTargetCreditCard) {
      try {
        const pSheet = ss.getSheetByName(typeof SHEET_PURCHASE !== 'undefined' ? SHEET_PURCHASE : "Purchase");
        if (pSheet && pSheet.getLastRow() >= 2) {
          const pCols = Math.max(pSheet.getLastColumn(), 13);
          const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, pCols).getValues();
          for (let p = 0; p < pData.length; p++) {
            const pId = String(pData[p][0] || "").trim();
            if (pId) {
              sourceMetaMap[pId] = {
                useDate: (typeof formatServerDateToDDMMYYYY === 'function') ? formatServerDateToDDMMYYYY(pData[p][1]) : String(pData[p][1] || ''),
                statementDate: (typeof formatServerDateToDDMMYYYY === 'function') ? formatServerDateToDDMMYYYY(pData[p][12]) : String(pData[p][12] || '')
              };
            }
          }
        }
        const fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
        if (fSheet && fSheet.getLastRow() >= 2) {
          const fCols = Math.max(fSheet.getLastColumn(), 11);
          const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, fCols).getValues();
          for (let f = 0; f < fData.length; f++) {
            const fId = String(fData[f][0] || "").trim();
            if (fId) {
              sourceMetaMap[fId] = {
                useDate: (typeof formatServerDateToDDMMYYYY === 'function') ? formatServerDateToDDMMYYYY(fData[f][1]) : String(fData[f][1] || ''),
                statementDate: (typeof formatServerDateToDDMMYYYY === 'function') ? formatServerDateToDDMMYYYY(fData[f][10]) : String(fData[f][10] || '')
              };
            }
          }
        }
        const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
        if (dSheet && dSheet.getLastRow() >= 2) {
          const dCols = Math.max(dSheet.getLastColumn(), 13);
          const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, dCols).getValues();
          for (let d = 0; d < dData.length; d++) {
            const dId = String(dData[d][0] || "").trim();
            if (dId) {
              sourceMetaMap[dId] = {
                useDate: (typeof formatServerDateToDDMMYYYY === 'function') ? formatServerDateToDDMMYYYY(dData[d][1]) : String(dData[d][1] || ''),
                statementDate: (typeof formatServerDateToDDMMYYYY === 'function') ? formatServerDateToDDMMYYYY(dData[d][12]) : String(dData[d][12] || '')
              };
            }
          }
        }
      } catch (eMeta) {}
    }

    // 🌟 ĐỌC TRỰC TIẾP 100% TỪ SỔ CÁI TRUNG TÂM "WalletLedger" (CỘT M: NOTE)
    let ledgerSheet = ss.getSheetByName(typeof SHEET_WALLET_LEDGER !== 'undefined' ? SHEET_WALLET_LEDGER : "WalletLedger") || ss.getSheetByName("WalletLedger");

    if (ledgerSheet && ledgerSheet.getLastRow() >= 2) {
      const lastCol = Math.max(ledgerSheet.getLastColumn(), 16);
      const lValues = ledgerSheet.getRange(1, 1, ledgerSheet.getLastRow(), lastCol).getValues();
      const headerRow = lValues[0] || [];
      const lData = lValues.slice(1);

      let colIdxLedgerId = 0; // Col A
      let colIdxWalletId = 1; // Col B
      let colIdxWalletName = 2; // Col C
      let colIdxDate = 3; // Col D
      let colIdxAmount = 4; // Col E
      let colIdxDir = 5; // Col F
      let colIdxEffect = 6; // Col G
      let colIdxModule = 7; // Col H
      let colIdxSrcId = 8; // Col I
      let colIdxEvent = 9; // Col J
      let colIdxIdem = 10; // Col K
      let colIdxStatus = 11; // Col L
      let colIdxNote = 12; // Col M (index 12)
      let colIdxCreatedAt = 13; // Col N (index 13)
      let colIdxCpRef = -1; // Col P nếu có
      let colIdxStmtDate = -1; // Col O (StatementDate)

      headerRow.forEach((h, cIdx) => {
        const cleanH = String(h || "").trim().toLowerCase();
        if (cleanH === "note" || cleanH === "ghi chú" || cleanH === "diễn giải" || cleanH === "nội dung") colIdxNote = cIdx;
        else if (cleanH === "walletid" || cleanH === "mã ví" || cleanH === "id ví") colIdxWalletId = cIdx;
        else if (cleanH === "walletname" || cleanH === "tên ví" || cleanH === "ví") colIdxWalletName = cIdx;
        else if (cleanH === "date" || cleanH === "ngày" || cleanH === "ngày gd") colIdxDate = cIdx;
        else if (cleanH === "amount" || cleanH === "số tiền" || cleanH === "tiền") colIdxAmount = cIdx;
        else if (cleanH === "direction" || cleanH === "chiều") colIdxDir = cIdx;
        else if (cleanH === "effecttype" || cleanH === "loại tác động") colIdxEffect = cIdx;
        else if (cleanH === "sourcemodule" || cleanH === "module") colIdxModule = cIdx;
        else if (cleanH === "sourceid" || cleanH === "mã nguồn") colIdxSrcId = cIdx;
        else if (cleanH === "eventtype" || cleanH === "loại sự kiện") colIdxEvent = cIdx;
        else if (cleanH === "idempotencykey") colIdxIdem = cIdx;
        else if (cleanH === "status" || cleanH === "trạng thái") colIdxStatus = cIdx;
        else if (cleanH === "checkpointref" || cleanH === "mã chốt sổ" || cleanH === "chốt sổ") colIdxCpRef = cIdx;
        else if (cleanH === "statementdate" || cleanH === "statement_date" || cleanH.includes("sao kê") || cleanH.includes("kỳ thanh toán") || cleanH === "reversalof") colIdxStmtDate = cIdx;
        else if (cleanH === "createdat" || cleanH === "tạo lúc" || cleanH === "thời gian tạo") colIdxCreatedAt = cIdx;
      });

      // Lấy mốc checkpoint của ví để gắn nhãn phân tách các giao dịch trước/sau kỳ chốt sổ
      let targetCpDate = null;
      let targetCpDateStr = "";
      let targetCpBal = 0;
      let targetCpCreatedAt = null;

      const cpSheet = ss.getSheetByName(SHEET_WALLET_CHECKPOINTS);
      if (cpSheet && cpSheet.getLastRow() >= 2) {
        const cpData = cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, 8).getValues();
        for (let i = cpData.length - 1; i >= 0; i--) {
          const cpWId = String(cpData[i][1] || "").trim();
          const cpWName = String(cpData[i][2] || "").trim();
          const status = String(cpData[i][7] || "ACTIVE").trim().toUpperCase();
          if ((matchWalletFast(cpWName) || (targetWalletIdLower && cpWId.toLowerCase() === targetWalletIdLower)) && status === "ACTIVE") {
            targetCpBal = parseMoneyNumber(cpData[i][4]);
            targetCpDate = parseServerDate(cpData[i][3]);
            targetCpDateStr = formatServerDateToDDMMYYYY(targetCpDate || cpData[i][3]);
            targetCpCreatedAt = cpData[i][5] || null;
            break;
          }
        }
      }

      if (!targetCpDate && wAllData && wAllData.length > 0) {
        for (let i = 0; i < wAllData.length; i++) {
          const wId = String(wAllData[i][0] || '').trim();
          const wName = String(wAllData[i][1] || '').trim();
          if (matchWalletFast(wName) || matchWalletFast(wId)) {
            const rawCp = (cpDateIdx >= 0 && wAllData[i][cpDateIdx]) ? wAllData[i][cpDateIdx] : "";
            if (rawCp) {
              const pDate = parseServerDate(rawCp);
              if (pDate && !isNaN(pDate.getTime())) {
                targetCpDate = pDate;
                targetCpDateStr = formatServerDateToDDMMYYYY(pDate);
                const rawBal = (cpBalIdx >= 0 && wAllData[i][cpBalIdx] !== undefined && wAllData[i][cpBalIdx] !== "")
                  ? wAllData[i][cpBalIdx]
                  : (is13Col ? wAllData[i][10] : wAllData[i][6]);
                targetCpBal = parseMoneyNumber(rawBal);
              }
            }
            break;
          }
        }
      }

      // Đảm bảo targetCpDateStr tuyệt đối là chuỗi ngày hợp lệ (dd/MM/yyyy), không bao giờ nhận tên ví nguồn
      if (targetCpDateStr) {
        const verifyDate = parseServerDate(targetCpDateStr);
        if (!verifyDate || isNaN(verifyDate.getTime())) {
          targetCpDateStr = "";
          targetCpDate = null;
        }
      }

      for (let i = 0; i < lData.length; i++) {
        const row = lData[i];
        const rowWId = String(row[colIdxWalletId] || "").trim();
        const rowWName = String(row[colIdxWalletName] || "").trim();
        const status = String(row[colIdxStatus] || "POSTED").trim().toUpperCase();

        // Chỉ lấy các bút toán có hiệu lực (POSTED/không bị REVERSED) và khớp với ví/thẻ này
        const isMatched = (targetWalletIdLower && (rowWId.toLowerCase() === targetWalletIdLower || rowWName.toLowerCase() === targetWalletIdLower)) || matchWalletFast(rowWName) || matchWalletFast(rowWId);

        if (status !== "REVERSED" && status !== "HUY" && status !== "DELETED" && isMatched) {
          const effectType = String(row[colIdxEffect] || "").trim().toUpperCase();
          if (effectType.startsWith("PARTNER_")) continue;
          const srcId = String(row[colIdxSrcId] || "").trim();
          const eventType = String(row[colIdxEvent] || "").trim();
          if (eventType.toUpperCase() === "OPENING_BALANCE" || srcId.toUpperCase().startsWith("INIT_")) continue;

          const date = row[colIdxDate];
          let noteText = String(row[colIdxNote] || "").trim(); // 100% CỘT M: NOTE

          // 🌟 Đối với Thẻ Tín Dụng (CREDIT):
          // Các bút toán tất toán thẻ (CARD_SETTLE, CARD_PAYMENT) chỉ thuộc về tài khoản thanh toán (Debit/Bank nguồn),
          // không hiển thị trong danh sách giao dịch / nợ đã sao kê của thẻ Credit!
          const upperEvType = eventType.toUpperCase();
          const isSettlementEvent = upperEvType === "CARD_SETTLE" || upperEvType === "CARD_PAYMENT" || upperEvType.includes("CARD_SETTLE") || upperEvType.includes("CARD_PAYMENT") || (noteText.toLowerCase().includes("tất toán thẻ") && effectType === "CARD_DEBT");
          if (isTargetCreditCard && isSettlementEvent) continue;

          const lId = String(row[colIdxLedgerId] || "").trim() || ("LEDG_" + (i + 2));
          const amt = parseMoneyNumber(row[colIdxAmount]);
          const dir = String(row[colIdxDir] || "").trim().toUpperCase();
          const srcModule = String(row[colIdxModule] || "").trim();

          // Xác định dấu +/- :
          let typeSign = "-";
          if (isTargetCreditCard) {
            typeSign = (dir === "DECREASE" || dir === "IN" || dir === "+") ? "+" : "-";
          } else {
            typeSign = (dir === "IN" || dir === "INCREASE" || dir === "+") ? "+" : "-";
          }

          // Module hiển thị thân thiện trên UI
          let modDisplay = "Sổ Cái";
          if (srcModule === "Family") modDisplay = (typeSign === "+" ? "Thu Nhập" : "Thu Chi");
          else if (srcModule === "Purchase") modDisplay = "Đơn Mua Hàng";
          else if (srcModule === "Sales") modDisplay = "Đơn Bán Hàng";
          else if (srcModule === "Debt") modDisplay = "Công Nợ";
          else if (srcModule === "Transfer") modDisplay = (eventType.includes("CARD") ? "Tất Toán Thẻ" : "CK Nội Bộ");
          else if (srcModule === "TripSplit") modDisplay = "Chia Tiền Chuyến Đi";
          else if (srcModule === "Wallets" || eventType.includes("ADJUSTMENT") || noteText.toLowerCase().includes("chỉnh lệch")) modDisplay = (typeSign === "+" ? "Thu Nhập" : "Chỉnh Lệch");
          else if (srcModule) modDisplay = srcModule;

          if (!noteText) {
            noteText = `[${modDisplay}] Giao dịch`;
          }

          const dObj = parseServerDate(date);
          const ts = dObj ? dObj.getTime() : 0;
          const fmtDate = dObj
            ? `${String(dObj.getDate()).padStart(2, '0')}/${String(dObj.getMonth() + 1).padStart(2, '0')}/${dObj.getFullYear()}`
            : String(date || '');

          const isPreorderEntry = (status !== "POSTED") && ((status === "PENDING") || (effectType === "PREORDER_HOLD") || (eventType.toUpperCase() === "PREORDER") || (noteText.startsWith("[Pre]")));

          const cpRefVal = (colIdxCpRef >= 0 && row[colIdxCpRef]) ? String(row[colIdxCpRef]).trim() : "";
          let isAfterCp = true;
          if (cpRefVal) {
            isAfterCp = false;
          } else if (targetCpDate) {
            const isAfter = isTransactionAfterCheckpoint(date, targetCpDate, targetCpDateStr);
            if (!isAfter) {
              const txCreatedAtRaw = (colIdxCreatedAt >= 0 && row[colIdxCreatedAt]) ? row[colIdxCreatedAt] : "";
              const txCreatedAtTs = txCreatedAtRaw ? new Date(txCreatedAtRaw).getTime() : 0;
              const cpCreatedAtTs = targetCpCreatedAt ? new Date(targetCpCreatedAt).getTime() : (targetCpDate ? new Date(targetCpDate).getTime() : 0);
              isAfterCp = txCreatedAtTs > 0 && cpCreatedAtTs > 0 && (txCreatedAtTs > cpCreatedAtTs);
            } else {
              isAfterCp = true;
            }
          }

          const srcMeta = sourceMetaMap[srcId] || {};
          let useDateStr = srcMeta.useDate || fmtDate;
          
          // 🌟 Ưu tiên số 1: Đọc trực tiếp từ Cột O (StatementDate) của WalletLedger
          const rawLedgerStmt = (colIdxStmtDate >= 0 && row[colIdxStmtDate]) ? row[colIdxStmtDate] : (row.length >= 15 && row[14] ? row[14] : "");
          let stmtDateStr = "";
          if (rawLedgerStmt) {
            stmtDateStr = formatServerDateToDDMMYYYY(rawLedgerStmt);
          }
          // Ưu tiên số 2: Lấy từ Cột Ngày Sao Kê của Sheet nghiệp vụ gốc (Purchase, Family, Debt)
          if (!stmtDateStr && srcMeta.statementDate) {
            stmtDateStr = srcMeta.statementDate;
          }
          // Ưu tiên số 3 (Fallback cho Credit card): Nếu hoàn toàn chưa có ngày sao kê riêng
          if (isTargetCreditCard) {
            if (!stmtDateStr) {
              stmtDateStr = calculateStatementBillingMonth(useDateStr, targetClosingDate) || fmtDate;
            }
          } else {
            stmtDateStr = fmtDate;
          }

          history.push({
            id: lId,
            rawNote: noteText,
            date: fmtDate,
            useDate: useDateStr,
            statementDate: stmtDateStr,
            _ts: ts,
            _rowIdx: i,
            module: modDisplay,
            type: typeSign,
            amount: amt,
            note: noteText,
            isPreorder: isPreorderEntry,
            status: isPreorderEntry ? "PRE-ORDER" : "HOAN_TAT",
            isAfterCp: isAfterCp,
            cpRef: cpRefVal || "",
            cpDateStr: targetCpDateStr || "",
            cpBalance: targetCpBal || 0,
            sourceId: srcId || "",
            sourceModule: srcModule || "",
            preorderId: srcId || lId
          });
        }
      }
    }

    if (history.length > 1) {
      history.sort((a, b) => {
        // Ưu tiên 1: Giao dịch Sau chốt sổ (isAfterCp === true) LUÔN đứng TRÊN giao dịch Đã chốt (isAfterCp === false)
        if (a.isAfterCp !== b.isAfterCp) {
          return a.isAfterCp ? -1 : 1;
        }
        // Ưu tiên 2: Thời gian giao dịch mới hơn đứng trước
        const diffTs = (b._ts || 0) - (a._ts || 0);
        if (diffTs !== 0) return diffTs;
        // Ưu tiên 3: Cùng ngày -> dòng mới ghi sau trong sổ cái đứng trước
        return (b._rowIdx || 0) - (a._rowIdx || 0);
      });
    }
    for (let i = 0; i < history.length; i++) {
      delete history[i]._ts;
      delete history[i]._rowIdx;
    }

    // Lưu vào CacheService (1 giờ = 3600s)
    if (!ssReal && typeof setCachedAppDataStr === 'function') {
      try {
        setCachedAppDataStr(cacheKey, JSON.stringify(history), 3600);
      } catch (cErr) {}
    }

    return history;
  } catch (err) {
    Logger.log("Lỗi getWalletTransactionHistory: " + err.toString());
    return [];
  }
}

/**
 * Xóa cache lịch sử giao dịch của ví khi có bút toán mới phát sinh
 */
function invalidateWalletTransactionCache(walletName) {
  if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) return;
  try {
    const cache = CacheService.getScriptCache();
    if (!walletName) {
      clearAllWalletStatementCaches();
      return;
    }
    const clean = String(walletName).trim().toLowerCase();
    const cacheKey = "WALLET_STMT_V36_" + clean.replace(/[^a-z0-9_]/g, '_');
    cache.remove(cacheKey);
    cache.remove(cacheKey + "_cnt");
    cache.remove(cacheKey + "_c0");
    cache.remove(cacheKey + "_c1");
  } catch (e) {}
}

/**
 * Xóa toàn bộ cache statement của mọi ví/thẻ phổ biến
 */
function clearAllWalletStatementCaches() {
  if (typeof CacheService === 'undefined' || !CacheService.getScriptCache) return;
  try {
    const cache = CacheService.getScriptCache();
    const commonWallets = [
      "resona", "resona bank", "w_resona", "c- bic ka", "bic ka", "c- bic chi", "bic chi",
      "c- raku ka", "raku ka", "c- raku chi", "raku chi", "c- amazon", "amazon",
      "c- yodo ka", "yodo ka", "c- yodo chi", "yodo chi", "c- edion", "edion",
      "c-aeon", "c- aeon", "aeon", "c-saison", "c- saison", "saison",
      "rakub ka", "rakub chi", "ufj ka", "ufj chi", "tiền mặt", "tien mat",
      "revochi", "revolut chi", "point", "techcom", "tcb"
    ];
    const keysToRemove = [];
    commonWallets.forEach(w => {
      const k = "WALLET_STMT_V36_" + w.replace(/[^a-z0-9_]/g, '_');
      keysToRemove.push(k, k + "_cnt", k + "_c0", k + "_c1");
    });
    if (typeof cache.removeAll === 'function') {
      for (let i = 0; i < keysToRemove.length; i += 100) {
        cache.removeAll(keysToRemove.slice(i, i + 100));
      }
    } else {
      keysToRemove.forEach(k => cache.remove(k));
    }
  } catch (e) {}
}

/**
 * 7. ĐIỀU CHỈNH CÂN BẰNG SỔ (CHỈNH LỆCH)
 */
function adjustWalletBalance(data, ssTarget) {
  try {
    const walletName = String(data.walletName || "").trim();
    let actualBalance = Number(data.actualBalance);
    const appBalance = Number(data.appBalance);

    if (!walletName || isNaN(actualBalance)) {
      return { success: false, message: "❌ Lỗi: Số tiền thực tế không hợp lệ!" };
    }

    const rawSs = ssTarget || (data && data.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    let isCredit = false;
    const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss) || getSheetByNameSafely("ViThe", ss);
    if (wSheet && wSheet.getLastRow() >= 2) {
      const wData = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, 3).getValues();
      for (let i = 0; i < wData.length; i++) {
        const rId = String(wData[i][0] || '').trim().toLowerCase();
        const rName = String(wData[i][1] || '').trim().toLowerCase();
        if (rId === walletName.toLowerCase() || rName === walletName.toLowerCase()) {
          const rType = String(wData[i][2] || '').trim().toUpperCase();
          if (rType === 'CREDIT') isCredit = true;
          else if (rType === 'DEBIT') isCredit = false;
          else isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(walletName, ss) : (/^c[-_\s]/i.test(walletName) || walletName.toLowerCase().includes("credit") || walletName.toLowerCase().includes("tín dụng"));
          break;
        }
      }
    } else {
      isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(walletName, ss) : (/^c[-_\s]/i.test(walletName) || walletName.toLowerCase().includes("credit") || walletName.toLowerCase().includes("tín dụng"));
    }

    // Đối với thẻ tín dụng: Nếu người dùng nhập số nợ dương (ví dụ 1021243), chuẩn hóa thành số âm (-1021243)
    if (isCredit && actualBalance > 0 && appBalance <= 0) {
      actualBalance = -actualBalance;
    }

    const diff = actualBalance - appBalance;
    updateWalletBalanceHelper(walletName, diff);

    // Xác định bản chất Thu / Chi đối với Ví thường vs Thẻ tín dụng:
    // - Ví thường: actual > app (diff > 0) là THU (tăng tiền), diff < 0 là CHI (giảm tiền).
    // - Thẻ tín dụng: Do lưu số âm (ví dụ -47,000 là thừa tiền trả lại, hoặc -100,000 là nợ ít hơn -200,000):
    //   Nếu actualBalance < appBalance (ví dụ từ 0 -> -47,000, công ty thẻ trả ngược tiền thừa hoặc hoàn tiền),
    //   đây là khoản THU HOÀN TIỀN / GIẢM DƯ NỢ -> loai = "Thu", direction = "DECREASE" (hoặc giảm nợ).
    let isIncomeOrRefund = diff >= 0;
    if (isCredit) {
      // Với thẻ tín dụng: Nếu số dư mới âm hơn số dư cũ (hoặc người dùng chốt số dư chênh lệch âm do hoàn tiền thừa),
      // thì đó là khoản THU / HOÀN TIỀN.
      // Nếu diff < 0 nhưng appBalance <= 0 và actualBalance < appBalance:
      // Lưu ý: Nếu người dùng nhập nợ tăng (ví dụ nợ từ 100k -> 200k, actual = -200k < app = -100k) thì nợ tăng (Chi).
      // Nhưng nếu công ty thẻ trả ngược lại phần thừa (-47k tức là số tiền được trả thừa về thẻ):
      // Người dùng ghi rõ: "như amazon khi chốt số dư chênh lệch là -47xxx nghĩa là trước xài kết toán rồi h công ty thẻ trả ngược lại phần thừa. khi đó sẽ hiểu là thu nhưng bây h đang hiển thị là chi"
      // Khi chênh lệch là âm (diff < 0) biểu thị công ty thẻ hoàn trả lại phần thừa -> hiểu là THU!
      // Cụ thể: nếu actualBalance < 0 và đại diện cho hoàn tiền thừa (hoặc diff < 0 trong trường hợp hoàn tiền thừa), ta xem xét cờ/hướng ghi nhận:
      if (diff < 0) {
        isIncomeOrRefund = true; // Công ty thẻ hoàn trả phần thừa -> THU
      } else {
        isIncomeOrRefund = false;
      }
    }

    const familySheet = getSheetByNames("Family", "ThuChi");
    if (familySheet) {
      const maGD = generateUniqueMaGD("ADJ");
      const now = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB');
      const loai = isIncomeOrRefund ? "Thu" : "Chi";
      const huName = isIncomeOrRefund ? "THU NHẬP" : "CK NỘI BỘ";
      const noiDung = "Chỉnh lệch sổ thực tế (App: " + appBalance.toLocaleString() + " -> Thực tế: " + actualBalance.toLocaleString() + ")";
      const note = data.note ? String(data.note).trim() : "";
      
      familySheet.appendRow([maGD, now, loai, huName, noiDung, Math.abs(diff), walletName, "", note, "HOAN_TAT"]);
    }

    if (typeof postFinancialEvents === 'function' && walletName && diff !== 0) {
      const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(walletName, ss) : false;
      const direction = isCredit ? (isIncomeOrRefund ? "DECREASE" : "INCREASE") : (diff >= 0 ? "IN" : "OUT");
      const effectType = isCredit ? "CARD_DEBT" : "CASH";
      const eventType = isIncomeOrRefund ? "ADJUSTMENT_INC" : "ADJUSTMENT_DEC";
      postFinancialEvents([{
        walletId: walletName,
        walletName: walletName,
        date: now,
        amount: Math.abs(diff),
        direction: direction,
        effectType: effectType,
        sourceModule: "Wallets",
        sourceId: maGD,
        eventType: eventType,
        note: noiDung
      }], ss);
    }

    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(walletName);
    }
    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    let freshWallets = null;
    try {
      const wRes = getWalletsFromSheet('All', 'All', ss);
      if (wRes && wRes.wallets) freshWallets = wRes.wallets;
    } catch (eW) {}

    return {
      success: true,
      wallets: freshWallets,
      message: "✅ Đã cập nhật số dư thực tế cho " + walletName + " thành " + actualBalance.toLocaleString() + " ¥"
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 8. CẬP NHẬT GIAO DỊCH TRỰC TIẾP TRÊN SỔ CÁI (WalletLedger - CỘT M)
 */
function updateFamilyTransactionById(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    try {
      const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
      const id = String(payload.id || "").trim();
      if (!id) return { success: false, message: "❌ Lỗi: Mã giao dịch không hợp lệ!" };

      const lSheet = ss ? (ss.getSheetByName(SHEET_WALLET_LEDGER) || ss.getSheetByName("WalletLedger")) : null;
      if (lSheet && lSheet.getLastRow() >= 2) {
        const lData = lSheet.getRange(2, 1, lSheet.getLastRow() - 1, Math.max(lSheet.getLastColumn(), 16)).getValues();
        for (let j = 0; j < lData.length; j++) {
          const lRowId = String(lData[j][0] || "").trim();
          const lSrcId = String(lData[j][8] || "").trim();
          const lRowIdx = j + 2;
          if (lRowId === id || lSrcId === id || id === ("LEDG_" + lRowIdx)) {
            const curDate = lData[j][3];
            const curAmt = Number(lData[j][4]) || 0;
            let newDate = curDate;
            if (payload.date !== undefined && payload.date !== "") {
              const dObj = (payload.date instanceof Date) ? payload.date : (typeof parseServerDate === 'function' ? parseServerDate(payload.date) : null);
              if (dObj && !isNaN(dObj.getTime())) {
                newDate = `${dObj.getFullYear()}-${String(dObj.getMonth() + 1).padStart(2, '0')}-${String(dObj.getDate()).padStart(2, '0')}`;
              } else {
                newDate = payload.date;
              }
            }
            const newAmt = (payload.amount !== undefined && !isNaN(Number(payload.amount))) ? Number(payload.amount) : curAmt;

            if (newDate !== curDate || newAmt !== curAmt) {
              lSheet.getRange(lRowIdx, 4, 1, 2).setValues([[newDate, newAmt]]);
            }
            if (payload.note !== undefined) {
              lSheet.getRange(lRowIdx, 13).setValue(payload.note); // Col M: Note
            }
            if (payload.statementDate !== undefined) {
              const sVal = String(payload.statementDate).trim();
              lSheet.getRange(lRowIdx, 15).setValue(sVal); // Col O: StatementDate
              const srcMod = String(lData[j][7] || "").trim();
              const srcId = String(lData[j][8] || "").trim();
              if (srcMod === "Purchase" && srcId) {
                const pSheet = ss.getSheetByName(typeof SHEET_PURCHASE !== 'undefined' ? SHEET_PURCHASE : "Purchase");
                if (pSheet && pSheet.getLastRow() >= 2) {
                  const pVals = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 1).getValues();
                  for (let p = 0; p < pVals.length; p++) {
                    if (String(pVals[p][0] || "").trim() === srcId) {
                      pSheet.getRange(p + 2, 13).setValue(sVal); // Col M: Ngày sao kê
                      break;
                    }
                  }
                }
              } else if (srcMod === "Family" && srcId) {
                const fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
                if (fSheet && fSheet.getLastRow() >= 2) {
                  const fVals = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, 1).getValues();
                  for (let f = 0; f < fVals.length; f++) {
                    if (String(fVals[f][0] || "").trim() === srcId) {
                      fSheet.getRange(f + 2, 11).setValue(sVal); // Col K: Ngày sao kê
                      break;
                    }
                  }
                }
              } else if (srcMod === "Debt" && srcId) {
                const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
                if (dSheet && dSheet.getLastRow() >= 2) {
                  const dVals = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, 1).getValues();
                  for (let d = 0; d < dVals.length; d++) {
                    if (String(dVals[d][0] || "").trim() === srcId) {
                      dSheet.getRange(d + 2, 13).setValue(sVal); // Col M: Ngày sao kê
                      break;
                    }
                  }
                }
              }
            }
            if (payload.statementDate !== undefined) {
              const sVal = String(payload.statementDate).trim();
              lSheet.getRange(lRowIdx, 15).setValue(sVal); // Col O: StatementDate
              const srcMod = String(lData[j][7] || "").trim();
              const srcId = String(lData[j][8] || "").trim();
              if (srcMod === "Purchase" && srcId) {
                const pSheet = ss.getSheetByName(typeof SHEET_PURCHASE !== 'undefined' ? SHEET_PURCHASE : "Purchase");
                if (pSheet && pSheet.getLastRow() >= 2) {
                  const pVals = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 1).getValues();
                  for (let p = 0; p < pVals.length; p++) {
                    if (String(pVals[p][0] || "").trim() === srcId) {
                      pSheet.getRange(p + 2, 13).setValue(sVal); // Col M: Ngày sao kê
                      break;
                    }
                  }
                }
              } else if (srcMod === "Family" && srcId) {
                const fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
                if (fSheet && fSheet.getLastRow() >= 2) {
                  const fVals = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, 1).getValues();
                  for (let f = 0; f < fVals.length; f++) {
                    if (String(fVals[f][0] || "").trim() === srcId) {
                      fSheet.getRange(f + 2, 11).setValue(sVal); // Col K: Ngày sao kê
                      break;
                    }
                  }
                }
              } else if (srcMod === "Debt" && srcId) {
                const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
                if (dSheet && dSheet.getLastRow() >= 2) {
                  const dVals = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, 1).getValues();
                  for (let d = 0; d < dVals.length; d++) {
                    if (String(dVals[d][0] || "").trim() === srcId) {
                      dSheet.getRange(d + 2, 13).setValue(sVal); // Col M: Ngày sao kê
                      break;
                    }
                  }
                }
              }
            }

            // Nếu có thay đổi số tiền thì cập nhật chênh lệch vào Wallets
            if (newAmt !== curAmt && typeof updateWalletBalanceHelper === 'function') {
              const wName = String(lData[j][2] || "").trim();
              const dir = String(lData[j][5] || "").trim().toUpperCase();
              if (wName) {
                const isPos = (dir === "IN" || dir === "DECREASE" || dir === "+");
                const diff = isPos ? (newAmt - curAmt) : -(newAmt - curAmt);
                if (diff !== 0) updateWalletBalanceHelper(wName, diff, ss);
              }
            }

            if (typeof clearAppDataCache === 'function') clearAppDataCache();
            if (typeof incrementDataVersion === 'function') incrementDataVersion();
            return { success: true, message: "✅ Đã cập nhật ghi chú Sổ Cái (Cột M) thành công!" };
          }
        }
      }

      return { success: false, message: "❌ Lỗi: Không tìm thấy giao dịch ID: " + id };
    } catch (err) {
      return { success: false, message: "❌ Lỗi: " + err.toString() };
    }
  });
}

// ==========================================
// THUẬT TOÁN MÃ HÓA BẢO MẬT DỮ LIỆU THẺ & MẬT KHẨU
// CHUẨN HMAC-SHA256 (PBKDF2-CTR) & MẬT MÃ HAI CHIỀU CÓ CHỐNG GIẢ MẠO (EtM)
// ==========================================

function strToUtf8Bytes(str) {
  if (!str) return [];
  const s = String(str);
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 128) {
      bytes.push(c);
    } else if (c < 2048) {
      bytes.push((c >> 6) | 192, (c & 63) | 128);
    } else {
      bytes.push((c >> 12) | 224, ((c >> 6) & 63) | 128, (c & 63) | 128);
    }
  }
  return bytes;
}

function utf8BytesToStr(bytes) {
  if (!bytes || bytes.length === 0) return '';
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    let b = bytes[i++];
    if (b < 128) {
      str += String.fromCharCode(b);
    } else if (b < 224) {
      str += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
    } else {
      str += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
    }
  }
  return str;
}

function getHmacSha256(key, message) {
  if (typeof Utilities !== 'undefined' && Utilities.computeHmacSha256Signature) {
    const sig = Utilities.computeHmacSha256Signature(message, key);
    let hex = "";
    for (let i = 0; i < sig.length; i++) {
      let b = sig[i];
      if (b < 0) b += 256;
      let s = b.toString(16);
      if (s.length === 1) s = "0" + s;
      hex += s;
    }
    return hex;
  }
  try {
    const crypto = require('crypto');
    return crypto.createHmac('sha256', key).update(message).digest('hex');
  } catch(e) {
    return "";
  }
}

function getRandomSalt(len) {
  const length = len || 16;
  const chars = "abcdef0123456789";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}

var SYSTEM_CARD_SECRET_KEY = "AgY_FiNaNcIaL_v2_SeCuRe_KeY_2026";

function getSystemCardSecretKey() {
  try {
    if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) {
      const props = PropertiesService.getScriptProperties();
      if (props) {
        let key = props.getProperty("CARD_SECRET_KEY");
        if (!key) {
          key = SYSTEM_CARD_SECRET_KEY;
          props.setProperty("CARD_SECRET_KEY", key);
        }
        return key;
      }
    }
  } catch(e) {}
  return SYSTEM_CARD_SECRET_KEY;
}

/**
 * MÃ HÓA TRƯỜNG THẺ BẢO MẬT (Số thẻ, HSD, CVV)
 * Định dạng lưu vào Database Sheet: ENC:v1:<salt>:<cipherHex>:<tag>
 */
function encryptCardField(plainText, secretKey) {
  if (plainText === null || plainText === undefined || String(plainText).trim() === "") return "";
  const str = String(plainText).trim();
  // Nếu đã được mã hóa rồi thì giữ nguyên
  if (str.startsWith("ENC:v1:")) return str;

  const key = secretKey || getSystemCardSecretKey();
  const salt = getRandomSalt(16);
  const utf8Bytes = strToUtf8Bytes(str);

  // Sinh Keystream giả ngẫu nhiên theo chế độ Counter (CTR)
  let keyStreamHex = "";
  let counter = 0;
  while (keyStreamHex.length < utf8Bytes.length * 2) {
    keyStreamHex += getHmacSha256(key, salt + ":ks:" + counter);
    counter++;
  }

  let cipherHex = "";
  for (let i = 0; i < utf8Bytes.length; i++) {
    const ksByte = parseInt(keyStreamHex.substr(i * 2, 2), 16);
    const cByte = utf8Bytes[i] ^ ksByte;
    let s = cByte.toString(16);
    if (s.length === 1) s = "0" + s;
    cipherHex += s;
  }

  const tag = getHmacSha256(key, salt + ":" + cipherHex).slice(0, 16);
  return "ENC:v1:" + salt + ":" + cipherHex + ":" + tag;
}

/**
 * GIẢI MÃ TRƯỜNG THẺ BẢO MẬT TỪ SHEET
 */
function decryptCardField(cipherText, secretKey) {
  if (!cipherText || typeof cipherText !== 'string') return "";
  const trimmed = cipherText.trim();
  // Tương thích ngược: Nếu dữ liệu cũ trong Sheet chưa mã hóa, trả về nguyên bản
  if (!trimmed.startsWith("ENC:v1:")) {
    return trimmed;
  }

  const parts = trimmed.split(":");
  if (parts.length !== 5) return "";
  const salt = parts[2];
  const cipherHex = parts[3];
  const tag = parts[4];

  const key = secretKey || getSystemCardSecretKey();
  const expectedTag = getHmacSha256(key, salt + ":" + cipherHex).slice(0, 16);
  if (tag !== expectedTag) {
    return ""; // Dữ liệu bị giả mạo hoặc sai khóa
  }

  const byteLen = cipherHex.length / 2;
  let keyStreamHex = "";
  let counter = 0;
  while (keyStreamHex.length < byteLen * 2) {
    keyStreamHex += getHmacSha256(key, salt + ":ks:" + counter);
    counter++;
  }

  const plainBytes = [];
  for (let i = 0; i < cipherHex.length; i += 2) {
    const cByte = parseInt(cipherHex.substr(i, 2), 16);
    const ksByte = parseInt(keyStreamHex.substr(i, 2), 16);
    plainBytes.push(cByte ^ ksByte);
  }

  return utf8BytesToStr(plainBytes);
}

/**
 * BĂM MẬT KHẨU BẰNG SHA-256 KÈM SALT HỆ THỐNG
 */
function t1_hashPassword(text) {
  if (!text) return "";
  const clean = String(text).trim().toLowerCase().replace(/-/g, '');
  if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
    const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, clean + ":CARD_SALT_2026", Utilities.Charset.UTF_8);
    let hex = "";
    for (let i = 0; i < rawHash.length; i++) {
      let b = rawHash[i];
      if (b < 0) b += 256;
      let s = b.toString(16);
      if (s.length === 1) s = "0" + s;
      hex += s;
    }
    return hex;
  }
  try {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(clean + ":CARD_SALT_2026").digest('hex');
  } catch(e) {
    return clean;
  }
}

/**
 * QUÉT VÀ TỰ ĐỘNG MÃ HÓA TOÀN BỘ CÁC THẺ CŨ ĐANG LƯU PLAIN-TEXT TRÊN SHEET
 */
function migrateEncryptExistingCards(ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "Không tìm thấy spreadsheet" };
    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe");
    if (!sheet || sheet.getLastRow() < 2) return { success: true, count: 0, message: "Sheet rỗng hoặc không có dữ liệu" };

    const lastRow = sheet.getLastRow();
    const maxCols = typeof sheet.getMaxColumns === 'function' ? sheet.getMaxColumns() : 26;
    if (maxCols < 21 && typeof sheet.insertColumnsAfter === 'function') {
      sheet.insertColumnsAfter(maxCols, 21 - maxCols);
    }
    const lastCol = Math.max(typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 21, 21);
    const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const vals = range.getValues();
    let updatedCount = 0;

    const headerRow = (sheet.getLastRow() >= 1) 
      ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] 
      : [];

    // Cột O..U (Col 15..21, index 14..20):
    // Cột O (15, index 14): Số thẻ chính
    // Cột P (16, index 15): Ngày hết hạn thẻ chính
    // Cột Q (17, index 16): CVV / CSV thẻ chính
    // Cột R (18, index 17): Tên thẻ ảo
    // Cột S (19, index 18): Số thẻ ảo
    // Cột T (20, index 19): HSD thẻ ảo
    // Cột U (21, index 20): CVV / CSV thẻ ảo
    const idxMainNum = 14; // Cột O (15)
    const idxMainExp = 15; // Cột P (16)
    const idxMainCvv = 16; // Cột Q (17)
    const idxVName   = 17; // Cột R (18)
    const idxVNum    = 18; // Cột S (19)
    const idxVExp    = 19; // Cột T (20)
    const idxVCvv    = 20; // Cột U (21)

    // Chỉ mã hóa 6 cột nhạy cảm (Số thẻ, HSD, CVV). Tên thẻ ảo (idxVName) và các cột A..M (tài chính) không bao giờ bị mã hóa!
    const targetIndices = [idxMainNum, idxMainExp, idxMainCvv, idxVNum, idxVExp, idxVCvv].filter(idx => idx >= 0);

    for (let i = 0; i < vals.length; i++) {
      const r = vals[i];
      let rowChanged = false;
      targetIndices.forEach(colIdx => {
        if (colIdx < r.length) {
          const rawVal = r[colIdx];
          let valStr = "";
          if (rawVal instanceof Date) {
            if (!isNaN(rawVal.getTime())) {
              const mm = String(rawVal.getMonth() + 1).padStart(2, '0');
              const yy = String(rawVal.getFullYear()).slice(-2);
              valStr = mm + "/" + yy;
            }
          } else if (rawVal !== null && rawVal !== undefined) {
            valStr = String(rawVal).trim();
          }

          if (valStr && !valStr.startsWith("ENC:v1:")) {
            const enc = encryptCardField(valStr);
            // Ghi trực tiếp vào đúng ô nhạy cảm đó, KHÔNG ghi đè cột A..L
            sheet.getRange(i + 2, colIdx + 1).setValue(enc);
            rowChanged = true;
          }
        }
      });
      if (rowChanged) {
        updatedCount++;
      }
    }

    if (updatedCount > 0 && typeof clearAppDataCache === 'function') {
      clearAppDataCache();
    }

    return { 
      success: true, 
      count: updatedCount, 
      message: "✅ Đã mã hóa thành công " + updatedCount + " thẻ trên Google Sheet Database!" 
    };
  } catch(e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * KIỂM TRA MẬT KHẨU TÀI KHOẢN NGƯỜI DÙNG VÀ MẬT KHẨU CÁ NHÂN (XÁC THỰC BẰNG MÃ BĂM SHA-256)
 */
function t1_isValidCardPassword(password, ssTarget) {
  const inputPass = String(password || "").trim();
  if (!inputPass) return false;
  const cleanPass = inputPass.toLowerCase().replace(/-/g, '');
  const inputHash = t1_hashPassword(cleanPass);

  try {
    const props = (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties) ? PropertiesService.getScriptProperties() : null;
    if (props) {
      const storedHash = String(props.getProperty("CARD_CUSTOM_PWD_HASH") || "").trim();
      if (storedHash) {
        if (inputHash === storedHash || t1_hashPassword(inputPass) === storedHash) {
          return true;
        }
      } else {
        // Tương thích ngược: Nếu trước đó đã lưu CARD_CUSTOM_PWD dạng plain text
        const legacyPass = String(props.getProperty("CARD_CUSTOM_PWD") || "").trim();
        if (legacyPass) {
          if (cleanPass === legacyPass.toLowerCase().replace(/-/g, '') || inputPass === legacyPass) {
            try {
              props.setProperty("CARD_CUSTOM_PWD_HASH", t1_hashPassword(legacyPass));
              props.deleteProperty("CARD_CUSTOM_PWD");
            } catch(e) {}
            return true;
          }
        }
      }
    }
  } catch (e) {}

  // Multi-tenant check: Kiểm tra mật khẩu tài khoản người dùng từ Sheet User (STien, Tiên, Kian, v.v.)
  try {
    const authSs = (typeof getUserAuthSpreadsheet === 'function') 
      ? getUserAuthSpreadsheet() 
      : ((typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));

    if (authSs) {
      const userSheet = authSs.getSheetByName("User") || (typeof ensureUserSheet === 'function' ? ensureUserSheet(authSs) : null);
      if (userSheet && userSheet.getLastRow() >= 2) {
        const maxC = Math.max(userSheet.getLastColumn(), 7);
        const hRow = userSheet.getRange(1, 1, 1, maxC).getValues()[0];
        const uCols = (typeof detectUserSheetColumns === 'function') 
          ? detectUserSheetColumns(hRow) 
          : { colPass: 3, colSalt: 5, colSheetId: 4 };

        const uData = userSheet.getRange(2, 1, userSheet.getLastRow() - 1, maxC).getValues();
        for (let u = 0; u < uData.length; u++) {
          const storedPass = String(uData[u][uCols.colPass - 1] || "").trim();
          const storedSalt = (uCols.colSalt !== -1) ? String(uData[u][uCols.colSalt - 1] || "").trim() : "";
          if (storedPass) {
            if (typeof verifyPassword === 'function') {
              if (verifyPassword(inputPass, storedPass, storedSalt)) return true;
              if (verifyPassword(cleanPass, storedPass, storedSalt)) return true;
            }
            if (storedPass === inputPass || storedPass.toLowerCase() === cleanPass) return true;
            if (typeof hashPassword === 'function') {
              if (storedPass.toLowerCase() === hashPassword(inputPass).toLowerCase()) return true;
              if (storedPass.toLowerCase() === hashPassword(cleanPass).toLowerCase()) return true;
            }
          }
        }
      }
    }
  } catch(uErr) {
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log("Lỗi check User sheet password trong t1_isValidCardPassword: " + uErr);
  }

  return false;
}

/**
 * ĐỔI MẬT KHẨU CÁ NHÂN MỚI (LƯU VÀO SCRIPT PROPERTIES DƯỚI DẠNG HASH SHA-256)
 */
function setCardCustomPassword(newPassword) {
  try {
    const cleanPass = String(newPassword || "").trim();
    if (!cleanPass || cleanPass.length < 3) {
      return { success: false, message: "❌ Mật khẩu phải có ít nhất 3 ký tự!" };
    }
    const hash = t1_hashPassword(cleanPass);
    const props = PropertiesService.getScriptProperties();
    if (props) {
      props.setProperty("CARD_CUSTOM_PWD_HASH", hash);
      try { props.deleteProperty("CARD_CUSTOM_PWD"); } catch(e) {}
    }
    return { success: true, message: "✅ Đã lưu mật khẩu cá nhân mới thành công (Đã mã hóa SHA-256)!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi lưu mật khẩu: " + err.toString() };
  }
}

/**
 * ĐỔI MẬT KHẨU CÁ NHÂN MỚI (YÊU CẦU MẬT KHẨU HIỆN TẠI HOẶC MẬT KHẨU RESET 25102101)
 */
function changeCardPassword(payloadOrAuthPass, optionalNewPass) {
  try {
    let authPass = "";
    let newPass = "";

    if (typeof payloadOrAuthPass === 'object' && payloadOrAuthPass !== null) {
      authPass = String(payloadOrAuthPass.oldOrResetPassword || payloadOrAuthPass.authPass || payloadOrAuthPass.oldPassword || "").trim();
      newPass = String(payloadOrAuthPass.newPassword || payloadOrAuthPass.newPass || "").trim();
    } else {
      authPass = String(payloadOrAuthPass || "").trim();
      newPass = String(optionalNewPass || "").trim();
    }

    const cleanAuth = authPass.toLowerCase().replace(/-/g, '');
    const isResetPass = (cleanAuth === "25102101");
    const isValidCurrent = t1_isValidCardPassword(authPass);

    if (!isResetPass && !isValidCurrent) {
      return { success: false, message: "❌ Mật khẩu hiện tại hoặc mật khẩu reset không chính xác!" };
    }

    if (!newPass || newPass.length < 3) {
      return { success: false, message: "❌ Mật khẩu mới phải từ 3 ký tự trở lên!" };
    }

    return setCardCustomPassword(newPass);
  } catch (err) {
    return { success: false, message: "❌ Lỗi đổi mật khẩu: " + err.toString() };
  }
}

/**
 * XÁC THỰC MẬT KHẨU & TRẢ DỮ LIỆU THẺ (GIẢI MÃ DỮ LIỆU TỪ SHEET CỘT L->R)
 */
function verifyCardPassword(password, ssTarget) {
  try {
    if (!t1_isValidCardPassword(password, ssTarget)) {
      return { success: false, message: "❌ Mật khẩu không đúng!" };
    }

    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe");
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, cards: [], virtualCards: [] };
    }

    const lastRow = sheet.getLastRow();
    const maxCols = (typeof sheet.getMaxColumns === 'function') ? sheet.getMaxColumns() : 26;
    if (maxCols < 23 && typeof sheet.insertColumnsAfter === 'function') {
      try { sheet.insertColumnsAfter(maxCols, 23 - maxCols); } catch(e) {}
    }
    const lastCol = Math.max((typeof sheet.getLastColumn === 'function') ? sheet.getLastColumn() : 23, 23);

    // Cố định chính xác vị trí cột bảo mật thẻ trong Database:
    // Cột O (15, index 14): Số thẻ chính
    // Cột P (16, index 15): Ngày hết hạn thẻ chính
    // Cột Q (17, index 16): CVV / CSV thẻ chính
    // Cột R (18, index 17): Tên thẻ ảo
    // Cột S (19, index 18): Số thẻ ảo
    // Cột T (20, index 19): HSD thẻ ảo
    // Cột U (21, index 20): CVV / CSV thẻ ảo
    const idxMainNum = 14; // Cột O (15)
    const idxMainExp = 15; // Cột P (16)
    const idxMainCvv = 16; // Cột Q (17)
    const idxVName   = 17; // Cột R (18)
    const idxVNum    = 18; // Cột S (19)
    const idxVExp    = 19; // Cột T (20)
    const idxVCvv    = 20; // Cột U (21)

    // Đảm bảo tiêu đề cột tại Hàng 1 (Cột O..U, tức Col 15..21) luôn đúng và rõ ràng
    try {
      const stdSecHeaders = ["Số Thẻ Chính", "HSD Thẻ Chính", "CVV Thẻ Chính", "Tên Thẻ Ảo", "Số Thẻ Ảo", "HSD Thẻ Ảo", "CVV Thẻ Ảo"];
      const headerRange = sheet.getRange(1, 15, 1, 7);
      const curH = headerRange.getDisplayValues()[0];
      let needH = false;
      for (let h = 0; h < 7; h++) {
        if (!curH[h] || String(curH[h]).trim() === "") { needH = true; break; }
      }
      if (needH) {
        headerRange.setValues([stdSecHeaders]);
      }
    } catch(hErr) {}

    const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const displayData = (typeof range.getDisplayValues === 'function') ? range.getDisplayValues() : range.getValues();

    function formatCardField(val) {
      if (val === null || val === undefined) return "";
      if (val instanceof Date) {
        if (isNaN(val.getTime())) return "";
        const m = String(val.getMonth() + 1).padStart(2, '0');
        const y = String(val.getFullYear()).slice(-2);
        return m + "/" + y;
      }
      return String(val).trim();
    }

    const cards = [];
    const virtualCards = [];
    displayData.forEach((r, idx) => {
      const rowNum = idx + 2;

      // 1. THẺ CHÍNH (Cột A..Q): Chỉ nạp khi có Tên thẻ ở Cột B
      const name = String(r[1] || "").trim();
      if (name) {
        const id = String(r[0] || "").trim() || ("W" + rowNum);
        const rawType = String(r[2] || "").trim().toUpperCase();
        let type = rawType;
        if (!type) {
          type = (/^c[-_\s]|credit/i.test(name)) ? "CREDIT" : "DEBIT";
        }

        const rawMainNum = formatCardField(r[idxMainNum]);
        const rawMainExp = formatCardField(r[idxMainExp]);
        const rawMainCvv = formatCardField(r[idxMainCvv]);

        const cardNumber = decryptCardField(rawMainNum);
        const cardExp = decryptCardField(rawMainExp);
        const cardCvv = decryptCardField(rawMainCvv);

        const rawLimit = r[3];
        const cardLimitNum = parseMoneyNumber(rawLimit);
        const closingDate = (r[4] instanceof Date) ? formatServerDateToDDMMYYYY(r[4]) : (r[4] ? String(r[4]).trim() : "");
        const dueDate = (r[5] instanceof Date) ? formatServerDateToDDMMYYYY(r[5]) : (r[5] ? String(r[5]).trim() : "");
        const initBal = parseMoneyNumber(r[6]);
        const wInc = parseMoneyNumber(r[7]);
        const wDec = parseMoneyNumber(r[8]);
        const sheetCurVal = (r.length >= 11 && r[10] !== undefined && r[10] !== "") ? parseMoneyNumber(r[10]) : parseMoneyNumber(r[9]);
        const currentBal = (wInc !== 0 || wDec !== 0) ? (initBal + wInc - wDec) : (sheetCurVal !== 0 ? sheetCurVal : initBal);
        const colNStatus = (r.length >= 14 && r[13] !== undefined) ? String(r[13] || "").trim().toUpperCase() : "";
        const isCardDeleted = (colNStatus === "DELETED" || colNStatus === "HIDDEN" || colNStatus === "XOA" || colNStatus === "ĐÃ XÓA");

        const cardSettleSource = (typeof colMap !== "undefined" && colMap && colMap.settle_source >= 0) ? formatCardField(r[colMap.settle_source]) : formatCardField(r[11]);

        let stmtFileHeaders = "";
        let stmtPasteHeaders = "";
        if (r.length >= 22 && r[21]) {
          const pV = (typeof parseWalletTemplateCell === 'function') ? parseWalletTemplateCell(r[21]) : null;
          if (pV && Array.isArray(pV.headers)) stmtFileHeaders = pV.headers.join(', ');
          else if (typeof r[21] === 'string') stmtFileHeaders = r[21];
        }
        if (r.length >= 23 && r[22]) {
          const pW = (typeof parseWalletTemplateCell === 'function') ? parseWalletTemplateCell(r[22]) : null;
          if (pW && Array.isArray(pW.headers)) stmtPasteHeaders = pW.headers.join(', ');
          else if (typeof r[22] === 'string') stmtPasteHeaders = r[22];
        }

        cards.push({
          id: id,
          row: rowNum,
          settle_source: cardSettleSource,
          settleSource: cardSettleSource,
          stmtFileHeaders: stmtFileHeaders,
          stmtPasteHeaders: stmtPasteHeaders,
          name: name,
          type: type,
          credit_limit: cardLimitNum,
          limit: cardLimitNum,
          initial_balance: initBal,
          current_balance: currentBal,
          closing_date: closingDate,
          due_date: dueDate,
          status: colNStatus,
          is_hidden: isCardDeleted,
          is_deleted: isCardDeleted,
          cardNumber: cardNumber,
          last4: (cardNumber ? cardNumber.replace(/\D/g, '').slice(-4) : ""),
          cardExp: cardExp,
          cardCvv: cardCvv,
          vCardName: formatCardField(r[idxVName]) || "",
          isVirtual: false
        });
      }

      // 2. THẺ ẢO TỪ R2 ĐẾN CUỐI (Cột R..U): Hoàn toàn độc lập với Cột B
      const rawVName = formatCardField(r[idxVName]);
      const rawVNum  = formatCardField(r[idxVNum]);
      const rawVExp  = formatCardField(r[idxVExp]);
      const rawVCvv  = formatCardField(r[idxVCvv]);

      let vCardName = rawVName;
      if (rawVName && typeof rawVName === 'string' && rawVName.startsWith("ENC:v1:")) {
        const decVName = decryptCardField(rawVName);
        if (decVName) {
          vCardName = decVName;
          try {
            sheet.getRange(rowNum, 18).setValue(decVName);
          } catch(e) {}
        }
      }

      const vCardNumber = decryptCardField(rawVNum);
      const vCardExp = decryptCardField(rawVExp);
      const vCardCvv = decryptCardField(rawVCvv);

      // Thẻ ảo từ R2 đến cuối nếu có bất kỳ thông tin nào ở Cột R..U
      if (vCardName || vCardNumber || vCardExp || vCardCvv) {
        const vNumDigits = String(vCardNumber || '').replace(/\D/g, '');
        const vLast4 = vNumDigits.length >= 4 ? vNumDigits.slice(-4) : vNumDigits;
        virtualCards.push({
          id: "VC_" + rowNum,
          row: rowNum,
          isVirtual: true,
          name: vCardName || ("Thẻ Ảo R" + rowNum),
          cardNumber: vCardNumber,
          last4: vLast4,
          masked_number: vLast4 ? ("•••• •••• •••• " + vLast4) : (vCardNumber || ""),
          cardExp: vCardExp,
          cardCvv: vCardCvv,
          type: "VIRTUAL",
          is_hidden: false
        });
      }
    });

    // Tự động mã hóa chuyển đổi (Auto-migration): Nếu phát hiện có dòng thẻ cũ lưu plain-text, tự động mã hóa trên Sheet
    try {
      let needsMigration = false;
      displayData.forEach(r => {
        const mNum = formatCardField(r[idxMainNum]);
        const mCvv = formatCardField(r[idxMainCvv]);
        if ((mNum && !mNum.startsWith("ENC:v1:")) || (mCvv && !mCvv.startsWith("ENC:v1:"))) {
          needsMigration = true;
        }
      });
      if (needsMigration) {
        migrateEncryptExistingCards(ss);
      }
    } catch (migErr) {
      if (typeof Logger !== 'undefined') Logger.log("Auto-migration log: " + migErr);
    }

    return {
      success: true,
      cards: cards,
      virtualCards: virtualCards
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}

/**
 * CẬP NHẬT THÔNG TIN BẢO MẬT THẺ (MÃ HÓA CỘT M->S TRƯỚC KHI LƯU VÀO DATABASE)
 */
function saveCardSecurityDetails(payload, ssTarget) {
  try {
    const isNewCard = Boolean(payload && (payload.isAdd || (!payload.row && !payload.id)));
    if (!isNewCard && payload && payload.password && !t1_isValidCardPassword(payload.password, ssTarget || (payload && payload.ssTarget))) {
      return { success: false, message: "❌ Mật khẩu không đúng!" };
    }

    const rawSs = ssTarget || (payload && payload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    let sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe") || ss.getSheetByName("Ví");
    if (!sheet) {
      if (typeof ss.insertSheet === 'function') {
        sheet = ss.insertSheet("Wallets");
      } else {
        return { success: false, message: "❌ Không tìm thấy sheet Wallets!" };
      }
    }

    const defaultHeaders = [
      "Mã Ví", "Tên Ví", "Phân Loại", "Hạn Mức", "Ngày Chốt", "Ngày Trả",
      "Số Dư Ban Đầu", "Tổng Thu", "Tổng Chi", "Đơn Preorder", "Số Dư Hiện Tại",
      "Nguồn Thanh Toán", "Ngày Chốt Sổ", "Trạng Thái",
      "Số Thẻ Chính", "HSD Thẻ Chính", "CVV Thẻ Chính",
      "Tên Thẻ Ảo", "Số Thẻ Ảo", "HSD Thẻ Ảo", "CVV Thẻ Ảo",
      "Mẫu Sao Kê (File)", "Mẫu Sao Kê (Dán)"
    ];

    if (sheet.getLastRow() < 1) {
      sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 1) {
      return { success: false, message: "❌ Lỗi: Sheet chưa có dòng tiêu đề!" };
    }

    // Đảm bảo Sheet có ít nhất 23 cột (A..W)
    const maxCols = (typeof sheet.getMaxColumns === 'function') ? sheet.getMaxColumns() : 26;
    if (maxCols < 23 && typeof sheet.insertColumnsAfter === 'function') {
      try { sheet.insertColumnsAfter(maxCols, 23 - maxCols); } catch(e) {}
    }

    // Đảm bảo tiêu đề cột tại Hàng 1 (Cột O..U, Col 15..21) luôn đúng và rõ ràng
    try {
      const stdSecHeaders = ["Số Thẻ Chính", "HSD Thẻ Chính", "CVV Thẻ Chính", "Tên Thẻ Ảo", "Số Thẻ Ảo", "HSD Thẻ Ảo", "CVV Thẻ Ảo"];
      const headerRange = sheet.getRange(1, 15, 1, 7);
      const curH = headerRange.getDisplayValues()[0];
      let needH = false;
      for (let h = 0; h < 7; h++) {
        if (!curH[h] || String(curH[h]).trim() === "") { needH = true; break; }
      }
      if (needH) {
        headerRange.setValues([stdSecHeaders]);
      }
    } catch(hErr) {}

    // Đảm bảo tiêu đề Col 22 (V) & Col 23 (W) cho Mẫu Sao Kê File & Dán
    try {
      const stmtHeaderRange = sheet.getRange(1, 22, 1, 2);
      const curSH = stmtHeaderRange.getDisplayValues()[0];
      if (!curSH[0] || !curSH[1]) {
        stmtHeaderRange.setValues([["Mẫu Sao Kê (File)", "Mẫu Sao Kê (Dán)"]]);
      }
    } catch(shErr) {}

    let rowIndex = -1;

    if (payload.mode === 'VIRTUAL' || payload.isVirtual) {
      // THẺ ẢO: Thêm / sửa từ Cột R (R..U), bắt đầu từ R2 đến cuối
      if (!payload.isAdd) {
        // 1. Khi sửa: Nếu client truyền row hợp lệ (e.g. payload.row)
        if (payload.row && Number(payload.row) >= 2) {
          rowIndex = Number(payload.row);
        } else if (payload.id && String(payload.id).startsWith("VC_")) {
          const parsedR = parseInt(String(payload.id).replace("VC_", ""), 10);
          if (!isNaN(parsedR) && parsedR >= 2 && parsedR <= Math.max(lastRow + 10, 100)) {
            rowIndex = parsedR;
          }
        }

        // 2. Khi sửa: Tìm theo Tên thẻ ảo ở Cột R (18)
        const vTarget = String(payload.vCardName || payload.name || "").trim().toLowerCase();
        if (rowIndex === -1 && vTarget) {
          if (lastRow >= 2) {
            const vColData = sheet.getRange(2, 18, lastRow - 1, 1).getValues();
            for (let i = 0; i < vColData.length; i++) {
              if (String(vColData[i][0] || "").trim().toLowerCase() === vTarget) {
                rowIndex = i + 2;
                break;
              }
            }
          }
        }

        // 3. Khi sửa: Dự phòng tìm theo ID (Cột A) hoặc Tên (Cột B) nếu là thẻ lưu cùng dòng
        if (rowIndex === -1 && lastRow >= 2) {
          const colAB = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
          if (payload.id && !String(payload.id).startsWith("VC_")) {
            for (let i = 0; i < colAB.length; i++) {
              if (String(colAB[i][0] || "").trim() === String(payload.id).trim()) {
                rowIndex = i + 2;
                break;
              }
            }
          }
          if (rowIndex === -1 && payload.name) {
            const targetName = String(payload.name).trim().toLowerCase();
            for (let i = 0; i < colAB.length; i++) {
              if (String(colAB[i][1] || "").trim().toLowerCase() === targetName) {
                rowIndex = i + 2;
                break;
              }
            }
          }
        }
      }

      // 4. Nếu thêm thẻ ảo mới (isAdd = true hoặc chưa có rowIndex):
      // Quét từ R2 đến cuối (Cột R từ dòng 2 trở đi), tìm dòng trống đầu tiên
      if (payload.isAdd || rowIndex === -1) {
        let foundEmptyRow = -1;
        if (lastRow >= 2) {
          const vColData = sheet.getRange(2, 18, lastRow - 1, 1).getValues();
          for (let i = 0; i < vColData.length; i++) {
            const cellVal = String(vColData[i][0] || "").trim();
            if (!cellVal) {
              foundEmptyRow = i + 2;
              break;
            }
          }
        }
        if (foundEmptyRow !== -1) {
          rowIndex = foundEmptyRow;
        } else {
          // 5. Nếu từ R2 đến lastRow đều đã có thẻ ảo, ghi vào dòng mới (lastRow + 1)
          rowIndex = Math.max(lastRow + 1, 2);
        }
      }
    } else {
      // THẺ CHÍNH (Cột A..Q)
      // 0. Nếu client truyền payload.row hợp lệ (đã lấy chính xác khi tải danh sách thẻ)
      if (payload.row && Number(payload.row) >= 2 && Number(payload.row) <= lastRow) {
        const cRow = Number(payload.row);
        const rowVals = sheet.getRange(cRow, 1, 1, 2).getValues()[0];
        const rId = String(rowVals[0] || "").trim();
        const rName = String(rowVals[1] || "").trim().toLowerCase();
        const pName = String(payload.name || "").trim().toLowerCase();
        if ((payload.id && rId === String(payload.id).trim()) || (pName && rName === pName)) {
          rowIndex = cRow;
        }
      }

      // 1. Thử tìm theo ID (Cột A)
      const data = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 2).getValues() : [];
      if (rowIndex === -1 && payload.id && data.length > 0) {
        for (let i = 0; i < data.length; i++) {
          if (String(data[i][0]).trim() === String(payload.id).trim()) {
            rowIndex = i + 2;
            break;
          }
        }
      }

      // 2. Thử tìm theo Tên thẻ (Cột B)
      if (rowIndex === -1 && payload.name && data.length > 0) {
        const cleanTarget = String(payload.name).trim().toLowerCase();
        for (let i = 0; i < data.length; i++) {
          const sheetName = String(data[i][1] || "").trim().toLowerCase();
          if (sheetName === cleanTarget) {
            rowIndex = i + 2;
            break;
          }
        }
        if (rowIndex === -1) {
          function cleanCardNameStr(str) {
            let s = String(str || "").trim().toLowerCase();
            while (true) {
              const next = s.replace(/^(c[-_\s]+|thẻ\s+|the\s+)/i, '').trim();
              if (next === s) break;
              s = next;
            }
            return s;
          }
          const strippedTarget = cleanCardNameStr(cleanTarget);
          if (strippedTarget) {
            for (let i = 0; i < data.length; i++) {
              const sheetName = String(data[i][1] || "").trim().toLowerCase();
              const strippedSheet = cleanCardNameStr(sheetName);
              if (strippedSheet && (strippedSheet === strippedTarget || strippedSheet.includes(strippedTarget) || strippedTarget.includes(strippedSheet))) {
                rowIndex = i + 2;
                break;
              }
            }
          }
        }
      }

      // 3. Nếu chưa có trên sheet -> Thêm dòng mới vào sheet Wallets cho thẻ này
      if (rowIndex === -1 && payload.name) {
        const newId = payload.id || ("W" + Date.now().toString().slice(-4));
        const cardType = payload.type || "CREDIT";
        let walletName = String(payload.name).trim();
        if (cardType !== "CREDIT" && /^C[-_\s]/i.test(walletName)) {
          walletName = walletName.replace(/^C[-_\s]+/i, '').trim();
        }
        payload.name = walletName;
        payload.type = cardType;
        const initBal = Number(payload.balance) || 0;
        const limitVal = Number(payload.limit) || 0;
        const cutVal = payload.closingDate || "";
        const payVal = payload.dueDate || "";
        const newRow = [newId, walletName, cardType, limitVal, cutVal, payVal, initBal, 0, 0, 0, initBal, String(payload.settleSource || payload.settle_source || "").trim(), ""];
        while (newRow.length < 21) newRow.push("");
        sheet.appendRow(newRow);
        rowIndex = sheet.getLastRow();
      }
    }

    if (rowIndex === -1) {
      return { success: false, message: "❌ Không tìm thấy thẻ để cập nhật!" };
    }

    // Cố định chính xác vị trí lưu thẻ vào database theo yêu cầu:
    // Cột O (15, index 14): Số thẻ chính
    // Cột P (16, index 15): Ngày hết hạn thẻ chính
    // Cột Q (17, index 16): CVV / CSV thẻ chính
    // Cột R (18, index 17): Tên thẻ ảo
    // Cột S (19, index 18): Số thẻ ảo
    // Cột T (20, index 19): HSD thẻ ảo
    // Cột U (21, index 20): CVV / CSV thẻ ảo
    const idxMainNum = 14; // Cột O (15)
    const idxMainExp = 15; // Cột P (16)
    const idxMainCvv = 16; // Cột Q (17)
    const idxVName   = 17; // Cột R (18)
    const idxVNum    = 18; // Cột S (19)
    const idxVExp    = 19; // Cột T (20)
    const idxVCvv    = 20; // Cột U (21)



    // Lấy dữ liệu hiện tại của dòng để bảo lưu trường khi lưu theo chế độ (MAIN hoặc VIRTUAL)
    const curRowVals = (rowIndex <= sheet.getLastRow()) ? (sheet.getRange(rowIndex, 1, 1, 21).getValues()[0] || []) : [];

    // Ghi dữ liệu THẺ CHÍNH (nếu không phải chế độ chỉ lưu THẺ ẢO)
    if (payload.mode !== 'VIRTUAL') {
      if (payload.cardNumber !== undefined) sheet.getRange(rowIndex, idxMainNum + 1).setValue(encryptCardField(payload.cardNumber));
      if (payload.cardExp !== undefined) sheet.getRange(rowIndex, idxMainExp + 1).setValue(encryptCardField(payload.cardExp));
      if (payload.cardCvv !== undefined) sheet.getRange(rowIndex, idxMainCvv + 1).setValue(encryptCardField(payload.cardCvv));

      if (payload.type) {
        sheet.getRange(rowIndex, 3).setValue(payload.type);
      }
      if (payload.name) {
        let updateName = String(payload.name).trim();
        const effectiveType = payload.type || (curRowVals[2] || "CREDIT");
        if (effectiveType !== "CREDIT" && /^C[-_\s]/i.test(updateName)) {
          updateName = updateName.replace(/^C[-_\s]+/i, '').trim();
        }
        sheet.getRange(rowIndex, 2).setValue(updateName);
        payload.name = updateName;
      }
      const rawInit = payload.initialBalance !== undefined ? payload.initialBalance : payload.initial_balance;
      if (rawInit !== undefined && rawInit !== "") {
        sheet.getRange(rowIndex, 7).setValue(Number(rawInit) || 0);
      } else if (payload.balance !== undefined && payload.balance !== "") {
        sheet.getRange(rowIndex, 7).setValue(Number(payload.balance) || 0);
      }
      if (payload.balance !== undefined && payload.balance !== "") {
        sheet.getRange(rowIndex, 11).setValue(Number(payload.balance) || 0);
      }
      if (payload.limit !== undefined && payload.limit !== "") {
        sheet.getRange(rowIndex, 4).setValue(Number(payload.limit) || 0);
      }
      if (payload.closingDate !== undefined && payload.closingDate !== "") {
        sheet.getRange(rowIndex, 5).setValue(payload.closingDate);
      }
      if (payload.dueDate !== undefined && payload.dueDate !== "") {
        sheet.getRange(rowIndex, 6).setValue(payload.dueDate);
      }
      const sSrc = payload.settleSource !== undefined ? payload.settleSource : payload.settle_source;
      if (sSrc !== undefined) {
        sheet.getRange(rowIndex, 12).setValue(String(sSrc || "").trim());
      }

      // Lưu Mẫu Sao Kê File (Col V, 22) và Mẫu Sao Kê Dán (Col W, 23)
      if (payload.stmtFileHeaders !== undefined || payload.fileHeaders !== undefined) {
        const rawF = payload.stmtFileHeaders !== undefined ? payload.stmtFileHeaders : payload.fileHeaders;
        let fStr = String(rawF || "").trim();
        if (fStr.includes('\n')) fStr = fStr.split(/\r?\n/)[0].trim();
        const dateMatchF = fStr.match(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/);
        if (dateMatchF && dateMatchF.index > 5) fStr = fStr.substring(0, dateMatchF.index).trim();
        if (fStr) {
          let fH = [];
          if (fStr.includes('\t')) {
            const parts = fStr.split('\t').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            if (parts.length > 1) fH = parts;
          }
          if (fH.length <= 1 && fStr.includes(',')) {
            const parts = fStr.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            if (parts.length > 1) fH = parts;
          }
          if (fH.length <= 1 && fStr.includes(';')) {
            const parts = fStr.split(';').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            if (parts.length > 1) fH = parts;
          }
          if (fH.length <= 1) {
            fH = fStr.split(/[\u3000\t,;]+|\s{2,}/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          }
          if (fH.length <= 1) {
            fH = fStr.split(/\s+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          }
          const fMap = (payload.fileMapping && Object.keys(payload.fileMapping).length) ? payload.fileMapping : ((typeof autoGenerateFieldMapping === 'function') ? autoGenerateFieldMapping(fH) : {});
          sheet.getRange(rowIndex, 22).setValue(JSON.stringify({ headers: fH, mapping: fMap }));
        } else {
          sheet.getRange(rowIndex, 22).setValue("");
        }
      }
      if (payload.stmtPasteHeaders !== undefined || payload.pasteHeaders !== undefined) {
        const rawP = payload.stmtPasteHeaders !== undefined ? payload.stmtPasteHeaders : payload.pasteHeaders;
        let pStr = String(rawP || "").trim();
        if (pStr.includes('\n')) pStr = pStr.split(/\r?\n/)[0].trim();
        const dateMatchP = pStr.match(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/);
        if (dateMatchP && dateMatchP.index > 5) pStr = pStr.substring(0, dateMatchP.index).trim();
        if (pStr) {
          let pH = [];
          if (pStr.includes('\t')) {
            const parts = pStr.split('\t').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            if (parts.length > 1) pH = parts;
          }
          if (pH.length <= 1 && pStr.includes(',')) {
            const parts = pStr.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            if (parts.length > 1) pH = parts;
          }
          if (pH.length <= 1 && pStr.includes(';')) {
            const parts = pStr.split(';').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            if (parts.length > 1) pH = parts;
          }
          if (pH.length <= 1) {
            pH = pStr.split(/[\u3000\t,;]+|\s{2,}/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          }
          if (pH.length <= 1) {
            pH = pStr.split(/\s+/).map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
          }
          const pMap = (payload.pasteMapping && Object.keys(payload.pasteMapping).length) ? payload.pasteMapping : ((typeof autoGenerateFieldMapping === 'function') ? autoGenerateFieldMapping(pH) : {});
          sheet.getRange(rowIndex, 23).setValue(JSON.stringify({ headers: pH, mapping: pMap }));
        } else {
          sheet.getRange(rowIndex, 23).setValue("");
        }
      }
    }

    // Ghi dữ liệu THẺ ẢO (nếu không phải chế độ chỉ lưu THẺ CHÍNH)
    if (payload.mode !== 'MAIN') {
      const effVName = payload.vCardName !== undefined ? payload.vCardName : (payload.mode === 'VIRTUAL' ? payload.name : "");
      const effVNum  = payload.vCardNumber !== undefined ? payload.vCardNumber : (payload.mode === 'VIRTUAL' ? payload.cardNumber : undefined);
      const effVExp  = payload.vCardExp !== undefined ? payload.vCardExp : (payload.mode === 'VIRTUAL' ? payload.cardExp : undefined);
      const effVCvv  = payload.vCardCvv !== undefined ? payload.vCardCvv : (payload.mode === 'VIRTUAL' ? payload.cardCvv : undefined);

      if (effVName !== undefined) sheet.getRange(rowIndex, idxVName + 1).setValue(effVName || "");
      if (effVNum !== undefined) sheet.getRange(rowIndex, idxVNum + 1).setValue(encryptCardField(effVNum));
      if (effVExp !== undefined) sheet.getRange(rowIndex, idxVExp + 1).setValue(encryptCardField(effVExp));
      if (effVCvv !== undefined) sheet.getRange(rowIndex, idxVCvv + 1).setValue(encryptCardField(effVCvv));
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    let freshWallets = [];
    if (typeof getWalletsFromSheet === 'function') {
      try {
        const wRes = getWalletsFromSheet("ALL", "ALL", ss);
        if (wRes && Array.isArray(wRes.wallets)) freshWallets = wRes.wallets;
      } catch (wErr) {}
    }

    return { 
      success: true, 
      message: "✅ Đã mã hóa và lưu thông tin thẻ " + (payload.name || "") + " vào Database an toàn 100%!",
      card: {
        id: payload.id,
        row: rowIndex,
        name: payload.name,
        type: payload.type,
        credit_limit: Number(payload.limit) || 0,
        limit: Number(payload.limit) || 0,
        closing_date: payload.closingDate || "",
        due_date: payload.dueDate || "",
        cardNumber: payload.cardNumber,
        cardExp: payload.cardExp,
        cardCvv: payload.cardCvv,
        vCardName: payload.vCardName || "",
        vCardNumber: payload.vCardNumber,
        vCardExp: payload.vCardExp,
        vCardCvv: payload.vCardCvv,
        stmtFileHeaders: payload.stmtFileHeaders !== undefined ? payload.stmtFileHeaders : (payload.fileHeaders || ""),
        stmtPasteHeaders: payload.stmtPasteHeaders !== undefined ? payload.stmtPasteHeaders : (payload.pasteHeaders || "")
      },
      wallets: freshWallets
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}

// =========================================================================
// 🌟 TÍNH NĂNG ĐỐI SOÁT SAO KÊ NGÂN HÀNG (BANK RECONCILIATION) & SHEET TEMP
// =========================================================================

const SHEET_TEMP = "Temp";

/**
 * Chuẩn hóa chuỗi ngày tháng bất kỳ (Nhật/Việt/ISO) về chuẩn 'YYYY-MM-DD' để so sánh logic phi ngôn ngữ
 */
function normalizeDateToYMD(val) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  let str = String(val).trim();
  if (!str) return "";

  // Chuẩn hóa ký tự số full-width sang half-width
  str = str.replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));

  // Loại bỏ thứ trong tuần (火) hoặc giờ kèm theo
  str = str.replace(/\s*\([日月火水木金土]\)/g, '')
           .replace(/\s*[日月火水木金土]曜日?/g, '')
           .replace(/\s*\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g, '')
           .trim();
  if (!str) return "";

  // 8 chữ số YYYYMMDD (ví dụ: 20261027 -> 2026-10-27)
  const ymd8Match = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd8Match) {
    const y = parseInt(ymd8Match[1], 10);
    const m = parseInt(ymd8Match[2], 10);
    const d = parseInt(ymd8Match[3], 10);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${ymd8Match[1]}-${ymd8Match[2]}-${ymd8Match[3]}`;
    }
  }

  // 2026年10月24日 or 10月24日
  const jpFull = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日?/);
  if (jpFull) {
    return `${jpFull[1]}-${jpFull[2].padStart(2, '0')}-${jpFull[3].padStart(2, '0')}`;
  }
  const jpShort = str.match(/(\d{1,2})月(\d{1,2})日?/);
  if (jpShort) {
    const y = new Date().getFullYear();
    return `${y}-${jpShort[1].padStart(2, '0')}-${jpShort[2].padStart(2, '0')}`;
  }

  // YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
  const ymdMatch = str.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  // YY/MM/DD or YY-MM-DD or YY.MM.DD (Nhật Bản ví dụ: 26/10/22 -> 2026-10-22)
  const ymdShortMatch = str.match(/^(\d{2})[-\/\.](\d{1,2})[-\/\.](\d{1,2})$/);
  if (ymdShortMatch) {
    const y2 = parseInt(ymdShortMatch[1], 10);
    const m = parseInt(ymdShortMatch[2], 10);
    const d = parseInt(ymdShortMatch[3], 10);
    if (y2 >= 20 && y2 <= 50 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `20${ymdShortMatch[1]}-${ymdShortMatch[2].padStart(2, '0')}-${ymdShortMatch[3].padStart(2, '0')}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  // MM/DD or M/D (không có năm)
  const mdMatch = str.match(/^(\d{1,2})[-\/\.](\d{1,2})$/);
  if (mdMatch) {
    const y = new Date().getFullYear();
    return `${y}-${mdMatch[1].padStart(2, '0')}-${mdMatch[2].padStart(2, '0')}`;
  }

  const parsed = parseServerDate(str);
  if (parsed && !isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return str;
}

/**
 * Tìm hoặc tạo mới Sheet Temp nếu chưa có
 */
function getTempSheetHelper(ssTarget) {
  const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
  if (!ss) return null;
  let sheet = ss.getSheetByName(SHEET_TEMP);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_TEMP);
    sheet.appendRow([
      "Mã Tạm", "Ngày", "Ví / Thẻ", "Số Tiền", "Chiều (+/-)", "Nội Dung Ngân Hàng", "Trạng Thái", "Phân Loại", "Mã Giao Dịch Tạo", "Thời Gian Tạo"
    ]);
  }
  return sheet;
}

/**
 * Tự động phân tích các tiêu đề cột người dùng đã tạo trong sheet Temp
 * Đảm bảo tương thích linh hoạt dù người dùng đặt tên tiêu đề cột như thế nào!
 */
function getTempColumnIndices(sheet) {
  const lastCol = Math.max(sheet ? sheet.getLastColumn() : 0, 1);
  const headers = (sheet && sheet.getLastRow() >= 1) ? (sheet.getRange(1, 1, 1, lastCol).getValues()[0] || []) : [];

  const map = {
    id: -1,
    date: -1,
    wallet: -1,
    amount: -1,
    type: -1,
    note: -1,
    status: -1,
    targetModule: -1,
    targetId: -1,
    createdAt: -1
  };

  headers.forEach((h, idx) => {
    const raw = String(h || "").trim().toLowerCase();
    if (!raw) return;
    if (raw.includes("ví") || raw.includes("thẻ") || raw.includes("wallet") || raw.includes("nguồn") || raw.includes("tài khoản")) {
      if (map.wallet === -1) map.wallet = idx;
    } else if (raw.includes("ngày") || raw === "date") {
      if (map.date === -1) map.date = idx;
    } else if (raw.includes("tiền") || raw === "amount" || raw.includes("sotien") || raw.includes("giá")) {
      if (map.amount === -1) map.amount = idx;
    } else if (raw.includes("chiều") || raw.includes("loại") || raw === "type" || raw === "dir" || raw.includes("+/-")) {
      if (map.type === -1) map.type = idx;
    } else if (raw.includes("nội dung") || raw.includes("ghi chú") || raw.includes("diễn giải") || raw.includes("note") || raw.includes("desc") || raw.includes("sao kê") || (raw.includes("tên") && !raw.includes("đích"))) {
      if (map.note === -1) map.note = idx;
    } else if (raw.includes("trạng thái") || raw === "status") {
      if (map.status === -1) map.status = idx;
    } else if (raw.includes("phân loại") || raw.includes("module") || raw.includes("xử lý") || raw.includes("đích") || raw.includes("hạng mục")) {
      if (map.targetModule === -1) map.targetModule = idx;
    } else if (raw.includes("mã tạo") || raw.includes("mã giao dịch") || raw.includes("ref") || raw.includes("kết quả")) {
      if (map.targetId === -1) map.targetId = idx;
    } else if (raw === "id" || raw === "mã" || raw === "mã tạm" || raw === "mã gd" || raw === "magd" || raw.includes("mã")) {
      if (map.id === -1) map.id = idx;
    } else if (raw.includes("thời gian") || raw.includes("created")) {
      if (map.createdAt === -1) map.createdAt = idx;
    }
  });

  // Gán mặc định nếu một số cột chưa được map
  if (map.id === -1) map.id = 0;
  if (map.date === -1) map.date = 1;
  if (map.wallet === -1) map.wallet = 2;
  if (map.amount === -1) map.amount = 3;
  if (map.type === -1) map.type = 4;
  if (map.note === -1) map.note = 5;
  if (map.status === -1) map.status = 6;
  if (map.targetModule === -1) map.targetModule = 7;
  if (map.targetId === -1) map.targetId = 8;
  if (map.createdAt === -1) map.createdAt = 9;

  return { map, headers, lastCol };
}

/**
 * Lấy danh sách giao dịch từ Sheet Temp
 */
function getTempTransactions(walletName, statusFilter, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return [];

    const sheet = ss.getSheetByName(SHEET_TEMP);
    if (!sheet || sheet.getLastRow() < 2) return [];

    const { map, lastCol } = getTempColumnIndices(sheet);
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

    const targetWalletNorm = walletName ? String(walletName).trim().toLowerCase() : "";
    const filterStatus = statusFilter ? String(statusFilter).trim().toUpperCase() : "";

    const results = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rId = String(row[map.id] || "").trim();
      if (!rId) continue;

      const rWallet = String(row[map.wallet] || "").trim();
      const rStatus = String(row[map.status] || "PENDING").trim().toUpperCase();

      if (targetWalletNorm && rWallet.toLowerCase() !== targetWalletNorm) continue;
      if (filterStatus && rStatus !== filterStatus) continue;

      const rDate = row[map.date];
      const fmtDate = (rDate instanceof Date)
        ? `${String(rDate.getDate()).padStart(2, '0')}/${String(rDate.getMonth() + 1).padStart(2, '0')}/${rDate.getFullYear()}`
        : String(rDate || '');

      results.push({
        id: rId,
        date: fmtDate,
        wallet: rWallet,
        amount: parseMoneyNumber(row[map.amount]),
        type: String(row[map.type] || "-").trim(),
        note: String(row[map.note] || "").trim(),
        status: rStatus,
        targetModule: (map.targetModule >= 0) ? String(row[map.targetModule] || "").trim() : "",
        targetId: (map.targetId >= 0) ? String(row[map.targetId] || "").trim() : "",
        createdAt: (map.createdAt >= 0) ? String(row[map.createdAt] || "") : ""
      });
    }

    return results;
  } catch (err) {
    if (typeof Logger !== 'undefined') Logger.log("Lỗi getTempTransactions: " + err.toString());
    return [];
  }
}

/**
 * Xóa toàn bộ dữ liệu giao dịch cũ trong sheet Temp (giữ lại hàng tiêu đề ở dòng 1)
 */
function clearTempSheet(walletName, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính!" };
    const tempSheet = ss.getSheetByName(SHEET_TEMP);
    if (!tempSheet || tempSheet.getLastRow() < 2) {
      return { success: true, message: "Sheet Temp đã trống sẵn.", clearedCount: 0 };
    }
    const count = tempSheet.getLastRow() - 1;
    tempSheet.deleteRows(2, count);
    return { success: true, message: `✅ Đã xóa ${count} dòng dữ liệu cũ trong Sheet Temp!`, clearedCount: count };
  } catch (err) {
    return { success: false, message: "Lỗi xóa Sheet Temp: " + err.toString() };
  }
}

/**
 * Xây dựng đối tượng ánh xạ cột từ mảng tiêu đề và cấu hình mapping
 */
function buildStatementMappingIndices(walletName, templateType, headers, customMap) {
  if (!headers || !Array.isArray(headers) || headers.length === 0) return null;
  const res = {
    walletName: walletName,
    rawWalletCell: walletName,
    templateType: templateType || 'FILE',
    headers: headers,
    dateIdx: -1,
    outflowIdx: -1,
    inflowIdx: -1,
    amountIdx: -1,
    descIdx: -1,
    subDescIdx: -1,
    balanceIdx: -1,
    memoIdx: -1
  };

  const map = (customMap && typeof customMap === 'object') ? customMap : (typeof autoGenerateFieldMapping === 'function' ? autoGenerateFieldMapping(headers) : {});

  // Gán index chính xác từ customMap nếu có
  if (map) {
    if (map.date) res.dateIdx = headers.indexOf(map.date);
    if (map.debit || map.outflow) res.outflowIdx = headers.indexOf(map.debit || map.outflow);
    if (map.credit || map.inflow) res.inflowIdx = headers.indexOf(map.credit || map.inflow);
    if (map.amount) res.amountIdx = headers.indexOf(map.amount);
    if (map.description || map.desc) res.descIdx = headers.indexOf(map.description || map.desc);
    if (map.description2 || map.subDesc) res.subDescIdx = headers.indexOf(map.description2 || map.subDesc);
    if (map.balance) res.balanceIdx = headers.indexOf(map.balance);
    if (map.memo) res.memoIdx = headers.indexOf(map.memo);
  }

  // Dự phòng: Nếu trường nào chưa map được, chạy qua vòng lặp keyword chuẩn Nhật
  headers.forEach((h, idx) => {
    const cleanH = String(h || "").toLowerCase().trim();
    if ((cleanH.includes('取引日') || cleanH.includes('利用日') || cleanH.includes('日付') || cleanH.includes('年月日') || cleanH === 'date') && !cleanH.includes('期間')) {
      if (res.dateIdx === -1) res.dateIdx = idx;
    }
    if (!cleanH.includes('入出金') && (cleanH.includes('お支払') || cleanH.includes('支払い') || cleanH.includes('お引出し') || cleanH.includes('出金') || cleanH === '引出' || cleanH.includes('支払') || cleanH.includes('請求額') || cleanH.includes('利用金額') || cleanH.includes('利用額')) && !cleanH.includes('方法') && !cleanH.includes('区分') && !cleanH.includes('日')) {
      if (res.outflowIdx === -1) res.outflowIdx = idx;
    }
    if (!cleanH.includes('入出金') && (cleanH.includes('お預り') || cleanH.includes('お預かり') || cleanH.includes('預かり') || cleanH.includes('預り') || cleanH.includes('お預入れ') || cleanH.includes('入金') || cleanH.includes('預入') || cleanH.includes('振込入金') || cleanH.includes('払戻') || cleanH.includes('credit'))) {
      if (res.inflowIdx === -1) res.inflowIdx = idx;
    }
    if (cleanH.includes('入出金') || ((cleanH.includes('金額') || cleanH.includes('amount') || cleanH === '額') && !cleanH.includes('支払') && !cleanH.includes('預') && !cleanH.includes('手数料') && !cleanH.includes('残高'))) {
      if (res.amountIdx === -1 && res.outflowIdx === -1) res.amountIdx = idx;
    }
    if (cleanH === '摘要内容' || cleanH.includes('摘要内容')) {
      res.subDescIdx = idx;
    } else if (cleanH.includes('摘要') || cleanH.includes('取扱内容') || cleanH.includes('利用店名') || cleanH.includes('内容') || cleanH.includes('加盟店') || cleanH.includes('desc')) {
      if (res.descIdx === -1) res.descIdx = idx;
    }
    if (cleanH === 'メモ' || cleanH === 'memo' || cleanH.includes('備考')) {
      if (res.memoIdx === -1) res.memoIdx = idx;
    }
    if (cleanH.includes('残高') || cleanH.includes('balance') || cleanH.includes('差引残高')) {
      if (res.balanceIdx === -1) res.balanceIdx = idx;
    }
  });

  if (res.dateIdx >= 0 && (res.outflowIdx >= 0 || res.inflowIdx >= 0 || res.amountIdx >= 0)) {
    return res;
  }
  return null;
}

/**
 * Đọc cấu hình mẫu tiêu đề sao kê ngân hàng: Ưu tiên đọc từ sheet Wallets (Cột V: File, Cột W: Dán),
 * và dự phòng đọc từ sheet Categories (hoặc Catagories)
 */
function getBankTemplatesFromCategories(targetWalletName, ssTarget, isPaste) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return null;

    const normTarget = targetWalletName ? String(targetWalletName).trim().toLowerCase() : "";
    const canonTarget = normTarget.replace(/^c[\s\-_:]*|ví|thẻ/g, '').replace(/[\s\-_]/g, '').trim();

    // 1. ƯU TIÊN ĐỌC TỪ SHEET WALLETS (CỘT V = 22: MẪU FILE, CỘT W = 23: MẪU DÁN)
    const wSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
    if (wSheet && wSheet.getLastRow() >= 2) {
      const lastR = wSheet.getLastRow();
      const lastC = Math.max(wSheet.getLastColumn ? wSheet.getLastColumn() : 23, 23);
      if (lastC >= 22) {
        const parseCellHelper = typeof parseWalletTemplateCell === 'function' ? parseWalletTemplateCell : function(c) {
          if (!c) return null;
          try {
            const p = JSON.parse(c);
            if (Array.isArray(p)) return { headers: p };
            return p;
          } catch(e) {
            return { headers: String(c).split(/[,;\t]/).map(s=>s.trim()).filter(Boolean) };
          }
        };

        const wData = wSheet.getRange(2, 1, lastR - 1, lastC).getValues();
        for (let r = 0; r < wData.length; r++) {
          const row = wData[r];
          const wId = String(row[0] || "").trim().toLowerCase();
          const wName = String(row[1] || "").trim();
          if (!wName) continue;

          const normRowW = wName.toLowerCase();
          const canonRowW = normRowW.replace(/^c[\s\-_:]*|ví|thẻ/g, '').replace(/[\s\-_]/g, '').trim();

          const isMatch = !normTarget ||
            normRowW === normTarget ||
            wId === normTarget ||
            normRowW.includes(normTarget) ||
            normTarget.includes(normRowW) ||
            (canonTarget && canonRowW && (canonRowW.includes(canonTarget) || canonTarget.includes(canonRowW)));

          if (isMatch) {
            const rawColV = row.length >= 22 ? row[21] : null; // Col V (22)
            const rawColW = row.length >= 23 ? row[22] : null; // Col W (23)

            const parsedV = parseCellHelper(rawColV);
            const parsedW = parseCellHelper(rawColW);

            // Kiểm tra trường hợp Col V là Headers mảng và Col W là Mapping
            if (parsedV && Array.isArray(parsedV.headers) && parsedW && parsedW.mapping && (!parsedW.headers || parsedW.headers.length === 0)) {
              const tmpl = buildStatementMappingIndices(wName, 'FILE', parsedV.headers, parsedW.mapping);
              if (tmpl) return tmpl;
            }

            const wantType = (isPaste === true) ? 'PASTE' : 'FILE';
            const primary = (wantType === 'PASTE') ? parsedW : parsedV;
            const fallback = (wantType === 'PASTE') ? parsedV : parsedW;
            const chosen = primary || fallback;

            if (chosen && chosen.headers && chosen.headers.length > 0) {
              const tmpl = buildStatementMappingIndices(wName, (chosen === parsedW ? 'PASTE' : 'FILE'), chosen.headers, chosen.mapping);
              if (tmpl) return tmpl;
            }
          }
        }
      }
    }

    // Đã chuyển hoàn toàn sang lưu trên Sheet Wallets (Cột V & W), không đọc từ Categories
    return null;
  } catch(e) {
    return null;
  }
}

/**
 * Đọc toàn bộ mẫu sao kê ngân hàng từ sheet Wallets (Cột V & W)
 */
function getAllBankTemplatesFromCategories(ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return {};

    const wSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
    if (!wSheet || wSheet.getLastRow() < 2) return {};

    const lastR = wSheet.getLastRow();
    const lastC = Math.max(wSheet.getLastColumn ? wSheet.getLastColumn() : 23, 23);
    if (lastC < 22) return {};

    const parseCellHelper = typeof parseWalletTemplateCell === 'function' ? parseWalletTemplateCell : function(c) {
      if (!c) return null;
      try {
        const p = JSON.parse(c);
        if (Array.isArray(p)) return { headers: p };
        return p;
      } catch(e) {
        return { headers: String(c).split(/[,;\t]/).map(s=>s.trim()).filter(Boolean) };
      }
    };

    const wData = wSheet.getRange(2, 1, lastR - 1, lastC).getValues();
    const result = {};

    for (let r = 0; r < wData.length; r++) {
      const row = wData[r];
      const wName = String(row[1] || "").trim();
      if (!wName) continue;

      const rawColV = row.length >= 22 ? row[21] : null;
      const rawColW = row.length >= 23 ? row[22] : null;
      const parsedV = parseCellHelper(rawColV);
      const parsedW = parseCellHelper(rawColW);

      const chosen = parsedV || parsedW;
      if (chosen && chosen.headers && chosen.headers.length > 0) {
        const tmpl = buildStatementMappingIndices(wName, (chosen === parsedW ? 'PASTE' : 'FILE'), chosen.headers, chosen.mapping);
        if (tmpl) {
          result[wName.toLowerCase()] = tmpl;
        }
      }
    }
    return result;
  } catch (err) {
    return {};
  }
}

/**
 * Lấy số dư ngân hàng thực tế từ sheet Categories / Catagories
 * Cột J (cột 10) = Tên Ví / Ngân hàng (Resona, UFJ, ...)
 * Cột T (cột 20) = Số dư ngân hàng (取引後残高 / Số dư)
 */
function getBankBalanceFromCategories(walletName, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return null;

    const sheet = ss.getSheetByName("Categories") || ss.getSheetByName("Catagories") || ss.getSheetByName("DanhMuc");
    if (!sheet || sheet.getLastRow() < 1) return null;

    const lastRow = Math.min(sheet.getLastRow(), 150);
    const lastCol = sheet.getLastColumn ? sheet.getLastColumn() : 10;
    const maxCols = sheet.getMaxColumns ? sheet.getMaxColumns() : lastCol;
    const effectiveLastCol = Math.min(lastCol, maxCols);
    if (effectiveLastCol < 10) return null;

    const colsToFetch = effectiveLastCol - 9;
    const data = sheet.getRange(1, 10, lastRow, colsToFetch).getValues();
    const targetNorm = walletName ? String(walletName).trim().toLowerCase() : "";
    if (!targetNorm) return null;

    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      const wNameCell = String(row[0] || "").trim().toLowerCase(); // Cột J (index 0)
      if (!wNameCell) continue;

      if (wNameCell === targetNorm || wNameCell.includes(targetNorm) || targetNorm.includes(wNameCell)) {
        const valColT = row[10]; // Cột T (index 10 = cột 20)
        if (valColT !== undefined && valColT !== null && String(valColT).trim() !== "") {
          const num = typeof valColT === 'number' ? valColT : parseMoneyNumber(valColT);
          if (!isNaN(num) && (typeof valColT === 'number' || String(valColT).trim() !== "0")) {
            return num;
          }
        }
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Định dạng ngày sao kê ngân hàng bất kỳ (20261027, 2026/10/27, 2026年10月27日...) về chuẩn DD/MM/YYYY (ví dụ: 27/10/2026)
 */
function formatBankDateToDDMMYYYY(val, yearContext) {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const d = String(val.getDate()).padStart(2, '0');
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const y = val.getFullYear();
    return `${d}/${m}/${y}`;
  }
  let str = String(val).trim();
  if (!str) return '';

  // Chuẩn hóa ký tự full-width sang half-width
  str = str.replace(/[\uFF01-\uFF5E]/g, function(ch) {
    return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
  }).replace(/\u3000/g, ' ');

  // Loại bỏ thứ trong tuần (火) hoặc giờ nếu có kèm theo chuỗi ngày
  str = str.replace(/\s*\([日月火水木金土]\)/g, '')
           .replace(/\s*[日月火水木金土]曜日?/g, '')
           .replace(/\s*\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g, '')
           .trim();
  if (!str) return '';

  const fallbackYear = yearContext || new Date().getFullYear();

  // 1. 8 chữ số YYYYMMDD (ví dụ: 20261027 -> 27/10/2026)
  const ymd8 = str.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (ymd8) {
    const y = parseInt(ymd8[1], 10);
    const m = parseInt(ymd8[2], 10);
    const d = parseInt(ymd8[3], 10);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
    }
  }

  // 2. 2026年10月27日 -> 27/10/2026
  const jp = str.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/);
  if (jp) {
    return `${String(jp[3]).padStart(2, '0')}/${String(jp[2]).padStart(2, '0')}/${jp[1]}`;
  }

  // 3. 10月27日 (không có năm -> lấy yearContext hoặc năm hiện tại) -> 27/10/YYYY
  const jpShort = str.match(/^(\d{1,2})月(\d{1,2})日?$/);
  if (jpShort) {
    return `${String(jpShort[2]).padStart(2, '0')}/${String(jpShort[1]).padStart(2, '0')}/${fallbackYear}`;
  }

  // 4. M/D hoặc MM/DD (ví dụ 10/2, 10/02, 10-2, 10.2) -> YYYY/MM/DD
  const mShort = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})$/);
  if (mShort) {
    const m = parseInt(mShort[1], 10);
    const d = parseInt(mShort[2], 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${fallbackYear}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
    }
  }

  // 5. YY/MM/DD (Nhật Bản ví dụ: 26/10/22, 26-10-22, 26.10.22 -> 22/10/2026)
  const ymdShort = str.match(/^(\d{2})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (ymdShort) {
    const y2 = parseInt(ymdShort[1], 10);
    const m = parseInt(ymdShort[2], 10);
    const d = parseInt(ymdShort[3], 10);
    if (y2 >= 20 && y2 <= 50 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const fullYear = 2000 + y2;
      return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${fullYear}`;
    }
  }

  // 6. YYYY/MM/DD, YYYY.MM.DD, YYYY-MM-DD -> DD/MM/YYYY
  const ymdFull = str.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
  if (ymdFull) {
    const y = ymdFull[1];
    const m = String(ymdFull[2]).padStart(2, '0');
    const d = String(ymdFull[3]).padStart(2, '0');
    return `${d}/${m}/${y}`;
  }
  return str;
}

/**
 * Parser thông minh nhận diện định dạng sao kê ngân hàng Nhật Bản (CSV, TSV, Text copy-paste)
 * Hỗ trợ: Resona, Rakuten Card, SMBC, UFJ, Bic Camera/View Card, số âm ▲/△, 8 số ngày (YYYYMMDD)
 */
function parseBankStatementRaw(rawText, isCredit, customTemplate) {
  if (!rawText || typeof rawText !== 'string') return [];
  // Loại bỏ BOM nếu có và chuẩn hóa ký tự full-width sang half-width
  // Loại bỏ BOM nếu có
  const cleanText = rawText.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return [];

  function extractAmount(val) {
    if (!val) return 0;
    const str = String(val)
      .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
      .replace(/[－―]/g, '-')
      .replace(/[,，円¥￥\s　]/g, '');
    const num = parseFloat(str.replace(/[▲△]/g, '-'));
    return isNaN(num) ? 0 : Math.abs(num);
  }

  function isNegativeSign(val) {
    if (!val) return false;
    const s = String(val);
    return s.includes('-') || s.includes('－') || s.includes('▲') || s.includes('△') || s.includes('出金') || s.includes('引出') || s.includes('支払') || s.includes('利用') || s.includes('払出') || s.includes('払');
  }

  function isPositiveSign(val) {
    if (!val) return false;
    const s = String(val);
    return s.includes('+') || s.includes('＋') || s.includes('入金') || s.includes('預入') || s.includes('振込入金') || s.includes('利息') || s.includes('戻り');
  }

  function parseCsvTokens(line, delim) {
    const p = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === delim && !inQuotes) {
        p.push(cur.trim().replace(/^"|"$/g, ''));
        cur = '';
      } else {
        cur += ch;
      }
    }
    p.push(cur.trim().replace(/^"|"$/g, ''));
    return p;
  }

  // 1. Nhận diện Delimiter
  let delim = ',';
  const commaCount = (cleanText.replace(/(?<=\d),(?=\d)/g, '').match(/,/g) || []).length;
  const tabCount = (cleanText.match(/\t/g) || []).length;
  const semiCount = (cleanText.match(/;/g) || []).length;
  if (tabCount > commaCount && tabCount > semiCount) delim = '\t';
  else if (semiCount > commaCount && semiCount > tabCount) delim = ';';

  // 2. Nhận diện Dòng Tiêu Đề Bảng (Header row)
  let headerRowIdx = -1;
  let colDate = (customTemplate && customTemplate.dateIdx >= 0) ? customTemplate.dateIdx : -1;
  let colOutflow = (customTemplate && customTemplate.outflowIdx >= 0) ? customTemplate.outflowIdx : -1;
  let colInflow = (customTemplate && customTemplate.inflowIdx >= 0) ? customTemplate.inflowIdx : -1;
  let colAmount = (customTemplate && customTemplate.amountIdx >= 0) ? customTemplate.amountIdx : -1;
  let colDesc = (customTemplate && customTemplate.descIdx >= 0) ? customTemplate.descIdx : -1;
  let colSubDesc = (customTemplate && customTemplate.subDescIdx >= 0) ? customTemplate.subDescIdx : -1;
  let colMemo = (customTemplate && customTemplate.memoIdx >= 0) ? customTemplate.memoIdx : -1;
  let colBalance = (customTemplate && customTemplate.balanceIdx >= 0) ? customTemplate.balanceIdx : -1;

  for (let i = 0; i < Math.min(lines.length, 25); i++) {
    const rawL = lines[i];
    let tokens = parseCsvTokens(rawL, delim);
    if (tokens.length < 2 && rawL.includes('\t')) tokens = rawL.split('\t').map(x => x.trim());
    if (tokens.length < 2) continue;

    let hasDateToken = false;
    let hasAmountToken = false;

    let candDate = -1;
    let candOutflow = -1;
    let candInflow = -1;
    let candAmount = -1;
    let candDesc = -1;
    let candSubDesc = -1;
    let candMemo = -1;
    let candBalance = -1;

    tokens.forEach((t, idx) => {
      const cleanT = t.toLowerCase().trim();
      if (!cleanT) return;

      // Cột Ngày (Hỗ trợ 取引日, 利用日, 日付, 年月日, date)
      if ((cleanT.includes('取引日') || cleanT.includes('利用日') || cleanT.includes('日付') || cleanT.includes('年月日') || cleanT === 'date') && !cleanT.includes('期間')) {
        hasDateToken = true;
        if (candDate === -1) candDate = idx;
      }

      // Cột Số dư sau giao dịch (Hỗ trợ UFJ 差引残高, Resona/Rakuten 取引後残高)
      if (cleanT.includes('残高') || cleanT.includes('balance')) {
        candBalance = idx;
      }

      // Cột Chi / Rút tiền: LUÔN LÀ DẤU TRỪ (-) (Hỗ trợ UFJ 支払い金額, Resona お支払金額, Rakuten Credit Card 当月請求額, 利用金額, ご利用金額, 出金, 引出, 支払, debit)
      const isOutflowToken = !cleanT.includes('入出金') &&
        (cleanT.includes('お支払') || cleanT.includes('支払い') || cleanT.includes('お引出し') || cleanT.includes('出金') || cleanT === '引出' || cleanT.includes('支払') || cleanT.includes('支払額') || cleanT.includes('利用額') || cleanT.includes('利用金額') || cleanT.includes('請求額') || cleanT.includes('debit')) &&
        !cleanT.includes('方法') && !cleanT.includes('区分') && !cleanT.includes('日') && !cleanT.includes('予定') && !cleanT.includes('月') && !cleanT.includes('回数') && !cleanT.includes('期') &&
        !cleanT.includes('変更') && !cleanT.includes('詳細') && !cleanT.includes('確認') && !cleanT.includes('全て') && !cleanT.includes('設定');

      if (isOutflowToken) {
        hasAmountToken = true;
        const isExactOutflow = ['利用金額', 'ご利用金額', '支払い金額', 'お支払金額', '出金額', '出金', '当月請求額', '請求額'].includes(cleanT);
        const isStrongAmount = cleanT.includes('金額') || cleanT.includes('利用金額') || cleanT.includes('請求額') || cleanT.includes('額');
        if (candOutflow === -1 || isExactOutflow || isStrongAmount) candOutflow = idx;
      }

      // Cột Thu / Nạp tiền: LUÔN LÀ DẤU CỘNG (+) (Hỗ trợ UFJ 預かり金額, Resona お預り金額, お預かり, お預入れ, 預かり, 預り, 入金, 預入, 振込入金, 払戻, credit)
      if (!cleanT.includes('入出金') && (cleanT.includes('お預り') || cleanT.includes('お預かり') || cleanT.includes('預かり') || cleanT.includes('預り') || cleanT.includes('お預入れ') || cleanT.includes('入金') || cleanT.includes('預入') || cleanT.includes('振込入金') || cleanT.includes('払戻') || cleanT.includes('credit'))) {
        hasAmountToken = true;
        if (candInflow === -1) candInflow = idx;
      }

      // Cột Số Tiền chung (Chỉ nhận diện khi KHÔNG PHẢI là cột 支払 hay 預かり riêng biệt, hỗ trợ 入出金 của Rakuten Bank)
      if (cleanT.includes('入出金') || ((cleanT.includes('金額') || cleanT.includes('amount') || cleanT === '額') && !cleanT.includes('支払') && !cleanT.includes('預') && !cleanT.includes('手数料') && !cleanT.includes('残高'))) {
        hasAmountToken = true;
        if (candAmount === -1) candAmount = idx;
      }

      // Cột Chi tiết diễn giải (Hỗ trợ UFJ 摘要内容)
      if (cleanT === '摘要内容' || cleanT.includes('摘要内容')) {
        candSubDesc = idx;
      } else if (cleanT.includes('摘要') || cleanT.includes('取扱内容') || cleanT.includes('利用店名') || cleanT.includes('内容') || cleanT.includes('加盟店') || cleanT.includes('desc')) {
        candDesc = idx;
      } else if (candDesc === -1 && (cleanT.includes('備考') || cleanT.includes('memo') || cleanT.includes('メモ') || (cleanT.includes('店名') && !cleanT.includes('店番')))) {
        candDesc = idx;
      }

      // Cột Memo
      if (cleanT === 'メモ' || cleanT === 'memo' || cleanT.includes('備考')) {
        candMemo = idx;
      }
    });

    if (candDesc === -1 && candSubDesc >= 0) {
      candDesc = candSubDesc;
      candSubDesc = -1;
    } else if (candDesc === -1 && candMemo >= 0) {
      candDesc = candMemo;
    }

    if (hasDateToken && hasAmountToken) {
      headerRowIdx = i;
      colDate = candDate;
      colOutflow = candOutflow;
      colInflow = candInflow;
      colAmount = candAmount;
      colDesc = candDesc;
      if (candSubDesc >= 0) colSubDesc = candSubDesc;
      if (candMemo >= 0) colMemo = candMemo;
      if (candBalance >= 0) colBalance = candBalance;
      break;
    }
  }

  const results = [];
  const balanceEntries = [];
  let statementClosingBalance = null;
  let currentYearContext = new Date().getFullYear();
  const startLine = (headerRowIdx >= 0) ? (headerRowIdx + 1) : 0;

  for (let i = startLine; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine || rawLine.startsWith('#')) continue;

    // Nhận diện dòng chỉ chứa Năm (ví dụ: '2026年', '2026', '令和8年', '令和08年')
    const yearMatch = rawLine.match(/^\s*(?:(20\d{2}|19\d{2})\s*年?|令和\s*(\d{1,2})\s*年?|平成\s*(\d{1,2})\s*年?)\s*$/);
    if (yearMatch) {
      if (yearMatch[1]) currentYearContext = parseInt(yearMatch[1], 10);
      else if (yearMatch[2]) currentYearContext = 2018 + parseInt(yearMatch[2], 10);
      else if (yearMatch[3]) currentYearContext = 1988 + parseInt(yearMatch[3], 10);
      continue; // Bỏ qua dòng tiêu đề năm, không coi là giao dịch!
    }

    const embeddedYear = rawLine.match(/\b(20\d{2})\b/);
    if (embeddedYear) {
      currentYearContext = parseInt(embeddedYear[1], 10);
    }

    let dateStr = '';
    let amount = 0;
    let type = isCredit ? '-' : '-';
    let note = '';
    let rowBal = null;

    // Cách 1: Đọc theo Cột Header xác định được
    if ((headerRowIdx >= 0 || customTemplate) && colDate >= 0) {
      let cols = parseCsvTokens(rawLine, delim);
      if (cols.length <= 1 && rawLine.includes('\t')) cols = rawLine.split('\t').map(x => x.trim());
      if (cols.length > colDate && cols[colDate]) {
        dateStr = cols[colDate];
      }
      const descParts = [];
      if (colDesc >= 0 && cols.length > colDesc && cols[colDesc]) descParts.push(cols[colDesc]);
      if (colSubDesc >= 0 && cols.length > colSubDesc && cols[colSubDesc]) descParts.push(cols[colSubDesc]);
      note = descParts.join(' ').trim();
      if (colMemo >= 0 && cols.length > colMemo && cols[colMemo]) {
        note = note ? `${note} (${cols[colMemo]})` : cols[colMemo];
      }

      // 支払い金額: Luôn luôn là Chi tiêu (-)
      if (colOutflow >= 0 && cols.length > colOutflow) {
        const outVal = extractAmount(cols[colOutflow]);
        if (outVal > 0) {
          amount = outVal;
          type = '-';
        }
      }
      // 預かり金額: Luôn luôn là Thu nhập (+)
      if (colInflow >= 0 && cols.length > colInflow) {
        const inVal = extractAmount(cols[colInflow]);
        if (inVal > 0) {
          amount = inVal;
          type = '+';
        }
      }
      if (amount === 0 && colAmount >= 0 && cols.length > colAmount) {
        const rawAmt = cols[colAmount];
        const val = extractAmount(rawAmt);
        if (val > 0) {
          amount = val;
          if (isNegativeSign(rawAmt)) type = '-';
          else if (isPositiveSign(rawAmt)) type = '+';
          else type = isCredit ? '-' : '+';
        }
      }

      if (colBalance >= 0 && cols.length > colBalance) {
        const rawBal = cols[colBalance];
        if (rawBal !== undefined && rawBal !== null && String(rawBal).trim() !== '') {
          const balVal = extractAmount(rawBal);
          if (!isNaN(balVal)) {
            rowBal = balVal;
          }
        }
      }
    }

    // Cách 1.5: Tự động nhận diện dòng dữ liệu chuẩn UFJ kể cả khi không copy dòng tiêu đề (TSV: Ngày, 摘要, 摘要内容, 支払い金額, 預かり金額, 差引残高...)
    if ((!dateStr || amount === 0) && delim === '\t') {
      const cols = parseCsvTokens(rawLine, delim);
      if (cols.length >= 6 && /^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(cols[0])) {
        dateStr = cols[0];
        const dParts = [];
        if (cols[1]) dParts.push(cols[1]);
        if (cols[2]) dParts.push(cols[2]);
        note = dParts.join(' ').trim();
        if (cols[6]) note = note ? `${note} (${cols[6]})` : cols[6];

        const outVal = extractAmount(cols[3]);
        const inVal = extractAmount(cols[4]);
        if (outVal > 0) {
          amount = outVal;
          type = '-';
        } else if (inVal > 0) {
          amount = inVal;
          type = '+';
        }
        if (cols[5]) {
          const bVal = extractAmount(cols[5]);
          if (!isNaN(bVal)) rowBal = bVal;
        }
      }
    }

    // Cách 1.6: Tự động nhận diện dòng dữ liệu chuẩn thẻ Amazon / Edion / Vpass (CSV & TSV) kể cả khi KHÔNG CÓ DÒNG TIÊU ĐỀ
    // Cấu trúc 7 cột chuẩn: [0] ご利用日, [1] ご利用店名 ※, [2] カード, [3] 支払区分, [4] 分割回数, [5] 支払予定月, [6] ご利用金額
    if (!dateStr || amount === 0) {
      const lineDelim = (rawLine.includes('\t') || delim === '\t') ? '\t' : (rawLine.includes(',') ? ',' : delim);
      const cols = parseCsvTokens(rawLine, lineDelim);
      if (cols.length >= 7 && /^\d{2,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(cols[0].trim())) {
        let rawAmtCol = cols[6];
        if (cols.length >= 8 && /^\d{1,3}$/.test(cols[7].trim()) && /[-+▲△¥￥]?\d+$/.test(cols[6].trim())) {
          rawAmtCol = cols[6] + cols[7];
        } else if (!rawAmtCol && cols[cols.length - 1]) {
          rawAmtCol = cols[cols.length - 1];
        }
        const outVal = extractAmount(rawAmtCol);
        if (outVal > 0) {
          dateStr = cols[0].trim();
          note = cols[1].trim();
          amount = outVal;
          if (isNegativeSign(rawAmtCol)) {
            type = '+';
          } else {
            type = '-';
          }
        }
      }
    }

    // Cách 2: Regex thông minh dự phòng
    if (!dateStr || amount === 0) {
      let remaining = rawLine;

      // Loại bỏ thời gian (HH:mm:ss hoặc HH:mm) khỏi remaining trước để không bị nhận nhầm thành số tiền
      remaining = remaining.replace(/\b\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g, ' ');

      // Loại bỏ thứ trong tuần kiểu Nhật: (火), (月), 火曜日, etc.
      remaining = remaining.replace(/\s*\([日月火水木金土]\)/g, ' ').replace(/\s*[日月火水木金土]曜日?/g, ' ');
        remaining = remaining.replace(/\d{1,2}\s*回(?:払い)?/g, ' ');

      const dateMatch = remaining.match(/(\d{4}[年\/\-\.]\d{1,2}[月\/\-\.]\d{1,2}日?|\d{1,2}[月\/\-\.]\d{1,2}日?|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}|\b20\d{6}\b)/);
      if (dateMatch) {
        dateStr = dateMatch[1];
        remaining = remaining.replace(dateMatch[0], ' ');
      }

      const amtMatch = remaining.match(/([-+▲△¥￥]?\s*\b\d{1,3}(?:,\d{3})+(?:円)?\b|[-+▲△¥￥]?\s*\b\d+(?:円)?\b)/);
      if (amtMatch) {
        const rawNumStr = amtMatch[0];
        amount = extractAmount(rawNumStr);
        if (isNegativeSign(rawNumStr)) type = '-';
        else if (isPositiveSign(rawNumStr)) type = '+';
        else if (rawLine.includes('お預り') || rawLine.includes('お預かり') || rawLine.includes('預かり') || rawLine.includes('預り') || rawLine.includes('お預入れ') || rawLine.includes('入金') || rawLine.includes('振込入金') || rawLine.includes('給料') || rawLine.includes('給与') || rawLine.includes('児童手当') || rawLine.includes('ジドウテアテ') || rawLine.includes('利息') || rawLine.includes('還付')) type = '+';
        else if (rawLine.includes('お支払') || rawLine.includes('支払い') || rawLine.includes('お引出し') || rawLine.includes('出金') || rawLine.includes('支払') || rawLine.includes('利用') || rawLine.includes('払出') || rawLine.includes('デビット') || rawLine.includes('購入')) type = '-';
        else type = isCredit ? '-' : '+';

        remaining = remaining.replace(amtMatch[0], ' ');
      }

      if (!note) {
        note = remaining
          .replace(/[,"'\t]/g, ' ')
          .replace(/[-+▲△¥￥]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }

    if (dateStr && amount > 0) {
      if (dateStr.includes('日') && !/\d/.test(dateStr)) continue;

      const formattedDate = formatBankDateToDDMMYYYY(dateStr, currentYearContext);
      results.push({
        date: formattedDate,
        amount: Math.round(amount),
        type: type,
        note: note || (type === '+' ? 'Khoản thu ngân hàng' : 'Khoản chi ngân hàng'),
        rawLine: rawLine
      });

      if (rowBal !== null) {
        let ts = 0;
        const dParts = formattedDate.split('/');
        if (dParts.length === 3) {
          ts = new Date(Number(dParts[2]), Number(dParts[1]) - 1, Number(dParts[0])).getTime();
        } else {
          const normYmd = normalizeDateToYMD(dateStr);
          if (normYmd) {
            const parts = normYmd.split('-');
            ts = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
          }
        }
        balanceEntries.push({
          index: results.length - 1,
          dateTs: ts,
          balance: rowBal
        });
      }
    }
  }

  // 3. Xử lý dự phòng: Khối nhiều dòng (Multi-line blocks copy-paste từ web/app Rakuten Bank, SMBC, ...)
  // Ví dụ Rakuten Bank:
  // Dòng 1: 20261027 (hoặc 20261027 (火))
  // Dòng 2: VISAデビット A0377714
  // Dòng 3: -8,500 ¥
  // Ví dụ SMBC:
  // Dòng 1: V907204　おおば内科クリニック (hoặc tiêu đề)
  // Dòng 2: 10月22日
  // Dòng 3: 3,000円
  // Dòng 4: 42,603円 (Số dư)
  if (results.length === 0) {
    const dateRegex = /^(\d{4}[年\/\-\.]\d{1,2}[月\/\-\.]\d{1,2}日?|\d{1,2}月\d{1,2}日?|\d{1,2}[\/\-]\d{1,2}|\b20\d{6}\b)/;
    const isHeaderLine = (l) => /^(日付|お引出し|お引き出し|お預入れ|お預け入れ|残高|お取扱内容|摘要|取引後残高)$/.test(l);
    const isYearLine = (l) => /^\s*(?:(20\d{2}|19\d{2})\s*年?\s*(?:\d{1,2}\s*月)?|令和\s*(\d{1,2})\s*年?)\s*$/.test(l);
    const isAmountPattern = (l) => /^[-+▲△¥￥]?\s*[\d,]+(?:\s*[円¥￥])?$/.test(l.trim()) && !dateRegex.test(l.trim());

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const cleanL = rawLine.replace(/\s*\([日月火水木金土]\)/g, '')
                            .replace(/\s*[日月火水木金土]曜日?/g, '')
                            .replace(/\s*\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g, '')
                            .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
                            .trim();

      if (isHeaderLine(cleanL)) continue;
      const ym = cleanL.match(/^\s*(?:(20\d{2}|19\d{2})\s*年?\s*(?:\d{1,2}\s*月)?|令和\s*(\d{1,2})\s*年?)\s*$/);
      if (ym) {
        if (ym[1]) currentYearContext = parseInt(ym[1], 10);
        else if (ym[2]) currentYearContext = 2018 + parseInt(ym[2], 10);
        continue;
      }

      const dMatch = cleanL.match(dateRegex);
      if (dMatch) {
        const rawDate = dMatch[1];
        let note = '';

        // Pattern B (SMBC): Note nằm ở dòng ngay trước ngày
        if (i > 0) {
          const prevL = lines[i - 1].trim();
          if (!isHeaderLine(prevL) && !isYearLine(prevL) && !dateRegex.test(prevL) && !isAmountPattern(prevL)) {
            note = prevL;
          }
        }

        const amounts = [];
        let rowBal = null;
        let j = 1;

        while (i + j < lines.length && j <= 6) {
          const nextL = lines[i + j].trim();
          const cleanNext = nextL.replace(/\s*\([日月火水木金土]\)/g, '')
                                 .replace(/\s*[日月火水木金土]曜日?/g, '')
                                 .replace(/\s*\d{1,2}:\d{1,2}(?::\d{1,2})?\b/g, '')
                                 .trim();

          if (dateRegex.test(cleanNext) || isYearLine(cleanNext)) break;

          if (nextL.includes('残高')) {
            const balM = nextL.match(/(\b\d{1,3}(?:,\d{3})+\b|\b\d+\b)/);
            if (balM) {
              rowBal = extractAmount(balM[0]);
              statementClosingBalance = rowBal;
            }
            j++;
          } else if (isAmountPattern(nextL)) {
            amounts.push({
              raw: nextL,
              val: extractAmount(nextL)
            });
            j++;
          } else if (!note && !isHeaderLine(nextL)) {
            // Pattern A (Rakuten Bank): Note nằm ở dòng ngay dưới ngày
            note = nextL;
            j++;
          } else {
            break;
          }
        }

        if (amounts.length > 0) {
          const txAmtObj = amounts[0];
          const txAmount = txAmtObj.val;
          if (amounts.length >= 2 && rowBal === null) {
            rowBal = amounts[1].val;
          }

          let type = isCredit ? '-' : '-';
          if (isNegativeSign(txAmtObj.raw)) {
            type = '-';
          } else if (isPositiveSign(txAmtObj.raw)) {
            type = '+';
          } else if (note.includes('振込入金') || note.includes('給料') || note.includes('給与') || note.includes('児童手当') || note.includes('ジドウテアテ') || note.includes('利息') || note.includes('預入') || note.includes('入金')) {
            type = '+';
          } else if (note.includes('デビット') || note.includes('出金') || note.includes('引出') || note.includes('支払') || note.includes('利用') || note.includes('払出') || /^V\d+/.test(note) || note.includes('店') || note.includes('カード')) {
            type = '-';
          } else {
            type = isCredit ? '-' : '+';
          }

          const fmtDate = formatBankDateToDDMMYYYY(rawDate, currentYearContext);
          results.push({
            date: fmtDate,
            amount: Math.round(txAmount),
            type: type,
            note: note || (type === '+' ? 'Khoản thu ngân hàng' : 'Khoản chi ngân hàng'),
            balance: rowBal,
            rawLine: [note, rawDate, ...amounts.map(a => a.raw)].filter(Boolean).join(' | ')
          });

          if (rowBal !== null) {
            const parts = fmtDate.split('/');
            let ts = 0;
            if (parts.length === 3) {
              if (Number(parts[0]) >= 1000) {
                ts = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
              } else {
                ts = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])).getTime();
              }
            }
            balanceEntries.push({
              index: results.length - 1,
              dateTs: ts,
              balance: rowBal
            });
          }

          i += (j - 1);
        }
      }
    }

    // Tinh chỉnh dấu +/- dựa trên biến động số dư lũy kế
    if (results.length >= 2) {
      const parseTs = (dStr) => {
        const p = (dStr || '').split('/');
        if (p.length === 3) {
          return (Number(p[0]) >= 1000) ? new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getTime() : new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0])).getTime();
        }
        return 0;
      };
      const isDesc = parseTs(results[0].date) >= parseTs(results[results.length - 1].date);

      for (let k = 0; k < results.length - 1; k++) {
        const cur = results[k];
        const next = results[k + 1];
        if (cur.balance !== null && cur.balance !== undefined && next.balance !== null && next.balance !== undefined) {
          const delta = isDesc ? (cur.balance - next.balance) : (next.balance - cur.balance);
          const target = isDesc ? cur : next;
          if (delta < 0) target.type = '-';
          else if (delta > 0) target.type = '+';
        }
      }
    }
  }

  // Tự động xác định số dư ngân hàng cuối kỳ từ các dòng giao dịch
  if (balanceEntries.length > 0) {
    const first = balanceEntries[0];
    const last = balanceEntries[balanceEntries.length - 1];
    const isDescending = (first.dateTs > last.dateTs);

    let maxTs = -1;
    balanceEntries.forEach(r => {
      if (r.dateTs > maxTs) maxTs = r.dateTs;
    });

    const latestDayEntries = balanceEntries.filter(r => r.dateTs === maxTs);
    if (latestDayEntries.length > 0) {
      statementClosingBalance = isDescending ? latestDayEntries[0].balance : latestDayEntries[latestDayEntries.length - 1].balance;
    } else {
      statementClosingBalance = isDescending ? first.balance : last.balance;
    }
  }

  results.statementClosingBalance = statementClosingBalance;
  return results;
}

const SHEET_BANK_RECONCILIATIONS = "BankReconciliations";

function getOrCreateReconcileSheetHelper(ss) {
  if (!ss) return null;
  let s = ss.getSheetByName(SHEET_BANK_RECONCILIATIONS);
  if (!s) {
    try {
      s = ss.insertSheet(SHEET_BANK_RECONCILIATIONS);
    } catch(e) {
      s = ss.getSheetByName(SHEET_BANK_RECONCILIATIONS);
    }
  }
  if (s && s.getLastRow() === 0) {
    const headers = [
      "batch_id", "wallet_name", "reconciled_at", "reconciled_by",
      "bank_signature", "app_tx_id", "match_type", "status",
      "bank_date", "bank_amount", "app_date", "app_amount", "notes"
    ];
    s.appendRow(headers);
    if (s.getRange) {
      try { s.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#EEF2F6"); } catch(e) {}
    }
  }
  return s;
}

function getReconciledHistoryHelper(walletName, ss) {
  try {
    const s = ss && ss.getSheetByName ? ss.getSheetByName(SHEET_BANK_RECONCILIATIONS) : null;
    if (!s || s.getLastRow() < 2) return { reconciledAppTxMap: {}, reconciledBankSigCounts: {}, records: [] };
    const lastRow = s.getLastRow();
    const lastCol = s.getLastColumn ? s.getLastColumn() : 13;
    if (lastCol < 1) return { reconciledAppTxMap: {}, reconciledBankSigCounts: {}, records: [] };
    const data = s.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const normTargetW = String(walletName || '').trim().toLowerCase();
    const reconciledAppTxMap = {};
    const reconciledBankSigCounts = {};
    const records = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const w = (row.length > 1) ? String(row[1] || '').trim().toLowerCase() : '';
      if (normTargetW && w && w !== normTargetW) continue;

      const status = (row.length > 7) ? String(row[7] || 'MATCHED').trim().toUpperCase() : 'MATCHED';
      if (status !== 'MATCHED' && status !== 'PARTIAL_MATCHED') continue;

      const batchId = (row.length > 0) ? String(row[0] || '').trim() : '';
      const sig = (row.length > 4) ? String(row[4] || '').trim() : '';
      const appId = (row.length > 5) ? String(row[5] || '').trim() : '';

      if (appId) {
        reconciledAppTxMap[appId] = {
          batchId: batchId,
          rowIndex: i + 2,
          reconciledAt: (row.length > 2 ? row[2] : ''),
          sig: sig,
          status: status
        };
      }

      if (sig) {
        reconciledBankSigCounts[sig] = (reconciledBankSigCounts[sig] || 0) + 1;
      }

      records.push({
        rowIndex: i + 2,
        batchId: batchId,
        walletName: (row.length > 1 ? row[1] : ''),
        reconciledAt: (row.length > 2 ? row[2] : ''),
        reconciledBy: (row.length > 3 ? row[3] : ''),
        sig: sig,
        appTxId: appId,
        matchType: (row.length > 6 ? row[6] : ''),
        status: status
      });
    }

    return { reconciledAppTxMap, reconciledBankSigCounts, records };
  } catch (err) {
    return { reconciledAppTxMap: {}, reconciledBankSigCounts: {}, records: [] };
  }
}

/**
 * Thuật toán Đối Soát Sao Kê Ngân Hàng Phi Ngôn Ngữ V2.0 (Multi-Batch & Enterprise Grade)
 * Quản lý theo Batch, chống trùng lặp 2 chiều, khóa các mục đã khớp đợt trước,
 * tự động chuyển tiếp tồn đọng (carry-over), và bảo toàn số dư.
 */
function reconcileBankStatement(payloadInput, ssTarget) {
  try {
    let payload = payloadInput;
    if (typeof payload === 'string') {
      try { payload = JSON.parse(payload); } catch(e) {}
    }
    payload = payload || {};

    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) {
      const noSsErr = { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };
      return (typeof SpreadsheetApp !== 'undefined') ? JSON.stringify(noSsErr) : noSsErr;
    }

    const walletName = String((payload && (payload.walletName || payload.wallet)) || "").trim();
    if (!walletName) {
      const noWalletErr = { success: false, message: "❌ Vui lòng chọn Ví / Thẻ cần đối soát!" };
      return (typeof SpreadsheetApp !== 'undefined') ? JSON.stringify(noWalletErr) : noWalletErr;
    }

    let rawEntries = (payload && (payload.bankEntries || payload.entries)) || [];
    if ((!Array.isArray(rawEntries) || rawEntries.length === 0) && payload && payload.rawText) {
      const isCredit = (/^c[\s\-_:]*|credit|tín dụng/i.test(walletName));
      const isPaste = payload && payload.isPaste === true;
      const customTemplate = getBankTemplatesFromCategories(walletName, ss, isPaste);
      rawEntries = parseBankStatementRaw(payload.rawText, isCredit, customTemplate);
    }

    if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
      const noEntriesErr = { success: false, message: "❌ Không tìm thấy dòng giao dịch hợp lệ nào (cần có Ngày và Số tiền) trong sao kê để đối soát!" };
      return (typeof SpreadsheetApp !== 'undefined') ? JSON.stringify(noEntriesErr) : noEntriesErr;
    }

    const autoSaveTemp = payload && payload.autoSaveTemp !== false;
    const clearOldTemp = payload && (payload.clearOldTemp === true || payload.clearTempBefore === true);

    if (clearOldTemp) {
      try {
        const tempSheet = ss && ss.getSheetByName ? ss.getSheetByName("Temp") : null;
        if (tempSheet && tempSheet.getLastRow() >= 2 && tempSheet.deleteRows) {
          tempSheet.deleteRows(2, tempSheet.getLastRow() - 1);
        }
      } catch (e) {}
    }

  // 1. Lấy lịch sử các đợt đối soát trước (Reconciled History) để chống double-matching
  const recHistory = getReconciledHistoryHelper(walletName, ss);
  const alreadyMatchedAppMap = recHistory.reconciledAppTxMap;
  const alreadyMatchedBankSigCounts = Object.assign({}, recHistory.reconciledBankSigCounts);

  // Lấy số dư ngân hàng thực tế: Ưu tiên số dư dòng cuối sao kê từ file (Rakuten 取引後残高(円), Resona 取引後残高) > sheet Categories
  const payloadClosingBal = payload && (payload.closingBalance !== undefined && payload.closingBalance !== null ? payload.closingBalance : payload.bankBalance);
  const catBankBal = getBankBalanceFromCategories(walletName, ss);
  const detectedBankBal = (payloadClosingBal !== undefined && payloadClosingBal !== null && !isNaN(Number(payloadClosingBal)))
    ? Number(payloadClosingBal)
    : ((rawEntries && rawEntries.statementClosingBalance !== undefined && rawEntries.statementClosingBalance !== null && !isNaN(Number(rawEntries.statementClosingBalance)))
        ? Number(rawEntries.statementClosingBalance)
        : ((catBankBal !== null && catBankBal !== undefined) ? catBankBal : null));

  const now = new Date();
  const currentBatchId = payload.batchId || ("REC_" + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + "_" + Math.floor(1000 + Math.random()*9000));

  // 2. Lấy toàn bộ giao dịch Sổ Cái trên App của ví này
  const appTransactions = getWalletTransactionHistory(walletName, true, ss) || [];

  // 3. Chuẩn hóa App pool: Khóa các mục đã MATCHED ở các đợt trước (read-only/locked)
  const appPool = [];
  const lockedPrevMatchedApp = [];

  appTransactions.forEach((tx, idx) => {
    const ymd = normalizeDateToYMD(tx.date);
    const amt = Math.round(Math.abs(Number(tx.amount) || 0));
    const dir = String(tx.type || "-").trim();
    const prevRec = alreadyMatchedAppMap[tx.id];
    // Chỉ nạp các dòng CHƯA đối soát vào appPool:
    // Các dòng đã đối soát ở các đợt trước (trong BankReconciliations) HOẶC đã nằm trong mốc chốt sổ trước (isAfterCp === false, cpRef) đều được đánh dấu đã đối soát/khóa
    const isAlreadyReconciled = (prevRec && prevRec.status === 'MATCHED') || (tx.isAfterCp === false) || Boolean(tx.cpRef);

    if (isAlreadyReconciled) {
      lockedPrevMatchedApp.push({
        id: tx.id,
        date: tx.date,
        ymd: ymd,
        amount: amt,
        type: dir,
        note: tx.note || tx.rawNote || "",
        module: tx.module || "",
        status: "MATCHED",
        reconciledBatchId: (prevRec && prevRec.batchId) || tx.cpRef || "CHECKPOINT",
        reconciledAt: (prevRec && prevRec.reconciledAt) || tx.date,
        isLocked: true
      });
    } else {
      appPool.push({
        id: tx.id,
        date: tx.date,
        ymd: ymd,
        amount: amt,
        type: dir,
        note: tx.note || tx.rawNote || "",
        module: tx.module || "",
        status: tx.status || "UNMATCHED",
        matched: false,
        _idx: idx
      });
    }
  });

  // 4. Chuẩn hóa Bank pool: Nhận diện và bỏ qua các dòng sao kê đã khớp ở đợt trước (De-duplication)
  const bankPool = [];
  const alreadyReconciledBank = [];

  rawEntries.forEach((b, idx) => {
    const ymd = normalizeDateToYMD(b.date);
    const amt = Math.round(Math.abs(Number(b.amount) || 0));
    let dir = String(b.type || "-").trim();
    if (dir !== "+" && dir !== "-") dir = "-";
    const dParts = ymd.split('-');
    const fmtDate = (dParts.length === 3) ? `${dParts[2]}/${dParts[1]}/${dParts[0]}` : String(b.date || '');
    const cleanNote = String(b.note || b.description || b.memo || "").trim();
    const sig = `${ymd}|${amt}|${dir}|${cleanNote.toLowerCase()}`;
    const simpleSig = `${ymd}|${amt}|${dir}`;

    if (alreadyMatchedBankSigCounts[sig] > 0) {
      alreadyMatchedBankSigCounts[sig]--;
      alreadyReconciledBank.push({
        idx: idx,
        date: fmtDate,
        ymd: ymd,
        amount: amt,
        type: dir,
        note: cleanNote,
        rawLine: b.rawLine || "",
        status: "MATCHED_PREV_BATCH",
        matchType: "PREV_BATCH",
        matched: true
      });
    } else if (!cleanNote && alreadyMatchedBankSigCounts[simpleSig] > 0) {
      alreadyMatchedBankSigCounts[simpleSig]--;
      alreadyReconciledBank.push({
        idx: idx,
        date: fmtDate,
        ymd: ymd,
        amount: amt,
        type: dir,
        note: cleanNote,
        rawLine: b.rawLine || "",
        status: "MATCHED_PREV_BATCH",
        matchType: "PREV_BATCH",
        matched: true
      });
    } else {
      bankPool.push({
        idx: idx,
        date: fmtDate,
        ymd: ymd,
        amount: amt,
        type: dir,
        note: cleanNote,
        sig: sig,
        rawLine: b.rawLine || "",
        matched: false,
        matchType: "",
        status: "UNMATCHED",
        matchedApp: null
      });
    }
  });

  const matched = [];

  // 5. Pha 1: Đối soát Chính Xác Tuyệt Đối (Exact Match: ymd + amount + type)
  for (let i = 0; i < bankPool.length; i++) {
    const b = bankPool[i];
    if (b.matched) continue;

    const matchIdx = appPool.findIndex(a => !a.matched && a.ymd === b.ymd && a.amount === b.amount && a.type === b.type);
    if (matchIdx >= 0) {
      const a = appPool[matchIdx];
      b.matched = true;
      b.matchType = "EXACT";
      b.status = "MATCHED";
      b.matchedApp = { id: a.id, date: a.date, amount: a.amount, type: a.type, note: a.note, module: a.module };
      a.matched = true;
      a.status = "MATCHED";
      matched.push({
        matchType: "EXACT",
        status: "MATCHED",
        batchId: currentBatchId,
        bank: { date: b.date, ymd: b.ymd, amount: b.amount, type: b.type, note: b.note, sig: b.sig },
        app: { id: a.id, date: a.date, ymd: a.ymd, amount: a.amount, type: a.type, note: a.note, module: a.module }
      });
    }
  }

  // 6. Pha 2: Đối soát Sai Lệch Ngày Nhẹ (Near-Date Match: ±1 đến ±2 ngày, cùng amount + type)
  for (let i = 0; i < bankPool.length; i++) {
    const b = bankPool[i];
    if (b.matched || !b.ymd) continue;

    const bDate = new Date(b.ymd);
    if (isNaN(bDate.getTime())) continue;

    let bestAppIdx = -1;
    let minDayDiff = 999;

    for (let j = 0; j < appPool.length; j++) {
      const a = appPool[j];
      if (a.matched || a.amount !== b.amount || a.type !== b.type || !a.ymd) continue;
      const aDate = new Date(a.ymd);
      if (isNaN(aDate.getTime())) continue;

      const diffDays = Math.round(Math.abs(bDate.getTime() - aDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 1 && diffDays <= 2 && diffDays < minDayDiff) {
        minDayDiff = diffDays;
        bestAppIdx = j;
      }
    }

    if (bestAppIdx >= 0) {
      const a = appPool[bestAppIdx];
      b.matched = true;
      b.matchType = "NEAR_DATE";
      b.status = "MATCHED";
      b.dayDiff = minDayDiff;
      b.matchedApp = { id: a.id, date: a.date, amount: a.amount, type: a.type, note: a.note, module: a.module };
      a.matched = true;
      a.status = "MATCHED";
      matched.push({
        matchType: "NEAR_DATE",
        status: "MATCHED",
        batchId: currentBatchId,
        dayDiff: minDayDiff,
        bank: { date: b.date, ymd: b.ymd, amount: b.amount, type: b.type, note: b.note, sig: b.sig },
        app: { id: a.id, date: a.date, ymd: a.ymd, amount: a.amount, type: a.type, note: a.note, module: a.module }
      });
    }
  }

  // 6.5. Pha 3: Đối Soát Khớp Gộp / Tách Khoản (Split / Combined Match: 1 dòng sao kê = Tổng 2 hoặc 3 khoản trên App)
  for (let i = 0; i < bankPool.length; i++) {
    const b = bankPool[i];
    if (b.matched || !b.ymd) continue;

    const bDate = new Date(b.ymd);
    if (isNaN(bDate.getTime())) continue;

    const cands = [];
    for (let j = 0; j < appPool.length; j++) {
      const a = appPool[j];
      if (a.matched || a.type !== b.type || a.amount >= b.amount || !a.ymd) continue;
      const aDate = new Date(a.ymd);
      if (isNaN(aDate.getTime())) continue;
      const diffDays = Math.round(Math.abs(bDate.getTime() - aDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays <= 2) {
        cands.push({ a: a, appIdx: j, diffDays: diffDays });
      }
    }

    if (cands.length < 2) continue;
    cands.sort((x, y) => x.diffDays - y.diffDays);

    let foundCombo = null;
    // Kiểm tra tổ hợp 2 khoản: a1 + a2 = b.amount
    for (let x = 0; x < cands.length; x++) {
      for (let y = x + 1; y < cands.length; y++) {
        if (cands[x].a.amount + cands[y].a.amount === b.amount) {
          foundCombo = [cands[x].a, cands[y].a];
          break;
        }
      }
      if (foundCombo) break;
    }

    // Nếu chưa thấy, kiểm tra tổ hợp 3 khoản
    if (!foundCombo && cands.length >= 3) {
      for (let x = 0; x < cands.length; x++) {
        for (let y = x + 1; y < cands.length; y++) {
          for (let z = y + 1; z < cands.length; z++) {
            if (cands[x].a.amount + cands[y].a.amount + cands[z].a.amount === b.amount) {
              foundCombo = [cands[x].a, cands[y].a, cands[z].a];
              break;
            }
          }
          if (foundCombo) break;
        }
        if (foundCombo) break;
      }
    }

    if (foundCombo) {
      b.matched = true;
      b.matchType = "COMBINED";
      b.status = "MATCHED";

      foundCombo.forEach(a => {
        a.matched = true;
        a.status = "MATCHED";
      });

      const notesJoined = foundCombo.map(a => `${a.note || a.module || 'Khoản'} (${Number(a.amount).toLocaleString()} ¥)`).join(' + ');
      const modulesJoined = Array.from(new Set(foundCombo.map(a => a.module || 'Sổ Cái'))).join(', ');
      const idsJoined = foundCombo.map(a => a.id).join(',');

      b.matchedApp = {
        id: idsJoined,
        date: foundCombo[0].date,
        amount: b.amount,
        type: b.type,
        note: notesJoined,
        module: modulesJoined,
        isCombined: true,
        combinedItems: foundCombo.map(a => ({ id: a.id, date: a.date, amount: a.amount, note: a.note, module: a.module }))
      };

      matched.push({
        matchType: "COMBINED",
        status: "MATCHED",
        batchId: currentBatchId,
        itemsCount: foundCombo.length,
        bank: { date: b.date, ymd: b.ymd, amount: b.amount, type: b.type, note: b.note, sig: b.sig },
        app: {
          id: idsJoined,
          date: foundCombo[0].date,
          ymd: foundCombo[0].ymd,
          amount: b.amount,
          type: b.type,
          note: notesJoined,
          module: modulesJoined,
          isCombined: true,
          combinedItems: foundCombo.map(a => ({ id: a.id, date: a.date, amount: a.amount, note: a.note, module: a.module }))
        }
      });
    }
  }

  // 7. Phân loại dòng chưa khớp:
  const missingInApp = bankPool.filter(b => !b.matched);
  const missingInBank = appPool.filter(a => !a.matched);

  // 8. Tự động lưu các mục đã MATCHED vào sheet BankReconciliations nếu được yêu cầu
  if (payload.autoCommitBatch === true && matched.length > 0) {
    confirmReconcileBatch({
      walletName: walletName,
      batchId: currentBatchId,
      matched: matched,
      reconciledBy: payload.reconciledBy || "User"
    }, ss);
  }

  // Hỗ trợ lưu sheet Temp CHỈ KHI có sheet Temp tồn tại (chế độ mock legacy)
  const legacyTempSheet = ss && ss.getSheetByName ? ss.getSheetByName("Temp") : null;
  if (autoSaveTemp && legacyTempSheet && missingInApp.length > 0) {
    try {
      const { map, lastCol } = getTempColumnIndices(legacyTempSheet);
      const existingTemp = clearOldTemp ? [] : getTempTransactions(walletName, null, ss);

      for (let i = 0; i < missingInApp.length; i++) {
        const item = missingInApp[i];
        const dupItem = existingTemp.find(t =>
          normalizeDateToYMD(t.date) === item.ymd &&
          Math.round(Math.abs(Number(t.amount) || 0)) === item.amount &&
          String(t.type || '-').trim() === item.type &&
          (String(t.note || '').trim() === item.note || !item.note)
        );

        if (dupItem) {
          item.tempId = dupItem.id;
          item.status = dupItem.status || "PENDING";
          item.targetModule = dupItem.targetModule || "";
          item.targetId = dupItem.targetId || "";
        } else {
          const newTempId = "TMP_" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
          const newRow = new Array(Math.max(lastCol, 10)).fill("");
          if (map.id >= 0) newRow[map.id] = newTempId;
          if (map.date >= 0) newRow[map.date] = item.date;
          if (map.wallet >= 0) newRow[map.wallet] = walletName;
          if (map.amount >= 0) newRow[map.amount] = item.amount;
          if (map.type >= 0) newRow[map.type] = item.type;
          if (map.note >= 0) newRow[map.note] = item.note;
          if (map.status >= 0) newRow[map.status] = "PENDING";
          legacyTempSheet.appendRow(newRow);
          item.tempId = newTempId;
        }
      }
    } catch (e) {}
  }

  const resultObj = {
    success: true,
    walletName: walletName,
    batchId: currentBatchId,
    bankBalance: detectedBankBal,
    summary: {
      totalBank: rawEntries.length,
      totalApp: appTransactions.length,
      matchedCount: matched.length,
      missingInAppCount: missingInApp.length,
      missingInBankCount: missingInBank.length,
      alreadyReconciledCount: alreadyReconciledBank.length,
      lockedPrevMatchedAppCount: lockedPrevMatchedApp.length
    },
    matched: matched,
    alreadyReconciled: alreadyReconciledBank,
    lockedPrevMatchedApp: lockedPrevMatchedApp,
    missingInApp: missingInApp.map((m, idx) => ({
      tempId: m.tempId || m.sig || ('BANK_' + (m.ymd ? String(m.ymd).replace(/-/g, '') : String(Date.now())) + '_' + (m.amount || 0) + '_' + idx),
      id: m.tempId || m.sig || ('BANK_' + (m.ymd ? String(m.ymd).replace(/-/g, '') : String(Date.now())) + '_' + (m.amount || 0) + '_' + idx),
      date: String(m.date || ""),
      ymd: String(m.ymd || ""),
      amount: Math.round(Number(m.amount) || 0),
      type: (String(m.type || "-").trim() === "+" ? "+" : "-"),
      note: String(m.note || ""),
      sig: String(m.sig || ""),
      status: (m.status && m.status !== "UNMATCHED") ? m.status : "PENDING",
      targetModule: m.targetModule || "",
      targetId: m.targetId || ""
    })),
    missingInBank: missingInBank.map(a => ({
      id: String(a.id || ""),
      date: String(a.date || ""),
      ymd: String(a.ymd || ""),
      amount: Math.round(Number(a.amount) || 0),
      type: (String(a.type || "-").trim() === "+" ? "+" : "-"),
      note: String(a.note || ""),
      module: String(a.module || ""),
      status: String(a.status || "")
    }))
  };

  const sanitized = JSON.parse(JSON.stringify(resultObj));
  if (payload && payload.returnJsonString === true) {
    return JSON.stringify(sanitized);
  }
  return sanitized;
  } catch (err) {
    if (typeof Logger !== 'undefined' && Logger.log) {
      Logger.log("reconcileBankStatement error: " + (err && err.stack ? err.stack : err));
    }
    const errObj = {
      success: false,
      message: "❌ Lỗi đối soát: " + ((err && err.message) ? err.message : String(err))
    };
    if (payload && payload.returnJsonString === true) {
      return JSON.stringify(errObj);
    }
    return errObj;
  }
}

/**
 * Lưu vết kết quả khớp của Đợt đối soát vào Sheet BankReconciliations
 */
function confirmReconcileBatch(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };

    const walletName = String(payload.walletName || "").trim();
    let batchId = String(payload.batchId || "").trim();
    if (!batchId) {
      const dNow = new Date();
      const yr = dNow.getFullYear();
      const mo = String(dNow.getMonth() + 1).padStart(2, '0');
      const da = String(dNow.getDate()).padStart(2, '0');
      const hr = String(dNow.getHours()).padStart(2, '0');
      const mi = String(dNow.getMinutes()).padStart(2, '0');
      batchId = `DS_${yr}${mo}${da}_${hr}${mi}`;
    }
    const matchedList = payload.matched || [];
    const reconciledBy = String(payload.reconciledBy || "User").trim();
    const nowIso = new Date().toISOString();

    const sheet = getOrCreateReconcileSheetHelper(ss);
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet BankReconciliations!" };

    let addedCount = 0;
    matchedList.forEach(m => {
      const b = m.bank || {};
      const a = m.app || {};
      const bYmd = normalizeDateToYMD(b.date);
      const bAmt = Math.round(Math.abs(Number(b.amount) || 0));
      const bType = String(b.type || "-").trim();
      const bNote = String(b.note || "").trim().toLowerCase();
      const sig = b.sig || `${bYmd}|${bAmt}|${bType}|${bNote}`;

      sheet.appendRow([
        batchId,
        walletName,
        nowIso,
        reconciledBy,
        sig,
        a.id || "",
        m.matchType || "EXACT",
        "MATCHED",
        b.date || "",
        bAmt,
        a.date || "",
        a.amount || bAmt,
        a.note || b.note || ""
      ]);
      addedCount++;
    });

    if (typeof invalidateWalletTransactionCache === 'function') {
      invalidateWalletTransactionCache(walletName);
    }
    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVer = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let freshWallets = null;
    try {
      if (typeof getWalletsFromSheet === 'function') {
        const wRes = getWalletsFromSheet(null, null, ss);
        if (wRes && Array.isArray(wRes.wallets)) freshWallets = wRes.wallets;
      }
    } catch(eW) {}

    return {
      success: true,
      batchId: batchId,
      addedCount: addedCount,
      wallets: freshWallets,
      dataVersion: nextVer,
      message: `✅ Đã lưu đợt đối soát ${batchId} với ${addedCount} giao dịch đã khớp!`
    };
  });
}

/**
 * Hủy đối soát (Unmatch) cho một giao dịch cụ thể
 */
function unmatchReconciledTransaction(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };

    const appTxId = String(payload.appTxId || payload.id || "").trim();
    const bankSig = String(payload.bankSignature || payload.sig || "").trim();
    const batchId = String(payload.batchId || "").trim();

    const sheet = getOrCreateReconcileSheetHelper(ss);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy bản ghi đối soát nào!" };

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn ? sheet.getLastColumn() : 13;
    if (lastCol < 1) return { success: false, message: "❌ Không tìm thấy bản ghi đối soát nào!" };
    const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    let unmatchCount = 0;
    for (let i = 0; i < data.length; i++) {
      const rowAppId = (data[i].length > 5) ? String(data[i][5] || "").trim() : "";
      const rowSig = (data[i].length > 4) ? String(data[i][4] || "").trim() : "";
      const rowBatch = (data[i].length > 0) ? String(data[i][0] || "").trim() : "";

      const isMatch = (appTxId && rowAppId === appTxId) ||
                      (bankSig && rowSig === bankSig) ||
                      (batchId && rowBatch === batchId);

      if (isMatch) {
        if (!sheet.getMaxColumns || sheet.getMaxColumns() >= 8) {
          sheet.getRange(i + 2, 8).setValue("UNMATCHED");
        }
        unmatchCount++;
      }
    }

    if (unmatchCount > 0) {
      return { success: true, unmatchCount: unmatchCount, message: `✅ Đã hủy khớp ${unmatchCount} giao dịch!` };
    } else {
      return { success: false, message: "❌ Không tìm thấy giao dịch tương ứng để hủy khớp!" };
    }
  });
}

/**
 * Hoàn tác toàn bộ một Đợt đối soát (Batch Rollback)
 */
function rollbackReconcileBatch(payload, ssTarget) {
  const batchId = String(payload.batchId || "").trim();
  if (!batchId) return { success: false, message: "❌ Thiếu batchId để hoàn tác!" };
  return unmatchReconciledTransaction({ batchId: batchId }, ssTarget);
}

/**
 * Xử lý phân loại dòng giao dịch từ sheet Temp:
 * - Lưu sang Family (Thu Chi)
 * - Lưu sang Purchase (Đơn Mua Hàng)
 * - Lưu sang Debt (Công Nợ)
 * - Hoặc Bỏ qua (IGNORE)
 */
function resolveTempTransaction(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (payload && payload.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };

    const tempId = String(payload.tempId || payload.id || "").trim();
    const action = String(payload.action || "").toUpperCase(); // 'FAMILY' | 'PURCHASE' | 'DEBT' | 'IGNORE'

    if (!tempId) return { success: false, message: "❌ Thiếu mã bản ghi (tempId)!" };
    if (!action) return { success: false, message: "❌ Thiếu hành động xử lý!" };

    const tempSheet = (ss && ss.getSheetByName) ? ss.getSheetByName(SHEET_TEMP) : null;
    let targetRowIndex = -1;
    let currentRowData = null;
    let map = null;

    let walletName = String(payload.walletName || payload.wallet || "").trim();
    let dateVal = payload.date || new Date();
    let amt = Math.round(Math.abs(Number(payload.amount) || 0));
    let dir = String(payload.type || "-").trim();
    let note = String(payload.note || "").trim();

    if (tempSheet && tempSheet.getLastRow() >= 2) {
      const colIndices = getTempColumnIndices(tempSheet);
      map = colIndices.map;
      const lastCol = colIndices.lastCol;
      const data = tempSheet.getRange(2, 1, tempSheet.getLastRow() - 1, lastCol).getValues();

      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][map.id] || "").trim();
        if (rowId === tempId) {
          targetRowIndex = i + 2; // 1-based index in sheet
          currentRowData = data[i];
          if (!walletName) walletName = String(currentRowData[map.wallet] || "").trim();
          dateVal = currentRowData[map.date] || dateVal;
          if (!amt) amt = Math.round(Math.abs(Number(currentRowData[map.amount]) || 0));
          if (dir === "-") dir = String(currentRowData[map.type] || dir).trim();
          if (!note) note = String(currentRowData[map.note] || "").trim();
          break;
        }
      }
    }

    let createdRefId = "";
    let targetModuleName = "";

    if (action === "IGNORE") {
      targetModuleName = "Bỏ qua (Khớp đối soát)";
      if (tempSheet && targetRowIndex > 0 && map) {
        tempSheet.getRange(targetRowIndex, map.status + 1).setValue("IGNORED");
        if (map.targetModule >= 0) tempSheet.getRange(targetRowIndex, map.targetModule + 1).setValue(targetModuleName);
      }

      const ymd = normalizeDateToYMD(dateVal);
      const sig = payload.sig || `${ymd}|${amt}|${dir}|${note.toLowerCase()}`;

      const recSheet = getOrCreateReconcileSheetHelper(ss);
      if (recSheet) {
        const currentBatchId = payload.batchId || ("REC_SKIP_" + (ymd ? ymd.replace(/-/g, '') : Date.now()));
        const reconciledBy = payload.reconciledBy || "User";
        recSheet.appendRow([
          currentBatchId,
          walletName,
          new Date(),
          reconciledBy,
          sig,
          "SKIP_MATCHED",
          "MANUAL_SKIP",
          "MATCHED",
          ymd,
          amt,
          ymd,
          amt,
          "Khớp đối soát (Bỏ qua - Không tạo giao dịch)"
        ]);
      }

      return {
        success: true,
        message: "✅ Đã xác nhận mục này đã khớp đối soát (Bỏ qua - không cần thêm giao dịch)!",
        status: "IGNORED",
        tempId: tempId,
        targetModule: targetModuleName,
        sig: sig
      };
    }

    if (action === "MARK_DONE") {
      targetModuleName = payload.targetModule || "Manual";
      createdRefId = payload.targetId || "";
      tempSheet.getRange(targetRowIndex, map.status + 1).setValue("PROCESSED");
      if (map.targetModule >= 0) tempSheet.getRange(targetRowIndex, map.targetModule + 1).setValue(targetModuleName);
      if (map.targetId >= 0 && createdRefId) tempSheet.getRange(targetRowIndex, map.targetId + 1).setValue(createdRefId);
      return {
        success: true,
        message: `✅ Đã đánh dấu xử lý sang ${targetModuleName}!`,
        status: "PROCESSED",
        tempId: tempId,
        targetModule: targetModuleName,
        targetId: createdRefId
      };
    }

    if (action === "MATCH_REFUND" || action === "REFUND") {
      const orderId = String(payload.orderId || payload.targetId || "").trim();
      const refundDate = payload.date || currentRowData[map.date] || new Date();
      const refundWallet = payload.walletName || walletName;
      if (!orderId) return { success: false, message: "❌ Thiếu mã đơn hàng cần khớp hoàn tiền!" };

      const refundFn = typeof confirmRefundOrderPayment === 'function' ? confirmRefundOrderPayment : (typeof global !== 'undefined' && global.confirmRefundOrderPayment ? global.confirmRefundOrderPayment : null);
      if (refundFn) {
        const refRes = refundFn([orderId], refundWallet, refundDate, ss);
        if (refRes && refRes.success === false) return refRes;
      }

      tempSheet.getRange(targetRowIndex, map.status + 1).setValue("PROCESSED");
      if (map.targetModule >= 0) tempSheet.getRange(targetRowIndex, map.targetModule + 1).setValue("Purchase");
      if (map.targetId >= 0) tempSheet.getRange(targetRowIndex, map.targetId + 1).setValue(orderId);

      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      return {
        success: true,
        message: `✅ Đã khớp hoàn tiền đơn #${orderId} về ${refundWallet}!`,
        status: "PROCESSED",
        tempId: tempId,
        targetModule: "Purchase",
        targetId: orderId,
        orderId: orderId,
        matchType: "REFUND"
      };
    }

    if (action === "MATCH_PREORDER" || action === "PREORDER") {
      const orderId = String(payload.orderId || payload.targetId || "").trim();
      const preDate = payload.date || currentRowData[map.date] || new Date();
      if (!orderId) return { success: false, message: "❌ Thiếu mã đơn hàng Pre-order cần khớp!" };

      const preFn = typeof confirmBatchPreOrdersPayment === 'function' ? confirmBatchPreOrdersPayment : (typeof global !== 'undefined' && global.confirmBatchPreOrdersPayment ? global.confirmBatchPreOrdersPayment : null);
      if (preFn) {
        const preRes = preFn([orderId], preDate, ss);
        if (preRes && preRes.success === false) return preRes;
      }

      tempSheet.getRange(targetRowIndex, map.status + 1).setValue("PROCESSED");
      if (map.targetModule >= 0) tempSheet.getRange(targetRowIndex, map.targetModule + 1).setValue("Purchase");
      if (map.targetId >= 0) tempSheet.getRange(targetRowIndex, map.targetId + 1).setValue(orderId);

      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      return {
        success: true,
        message: `✅ Đã khớp trừ thẻ đơn Pre-order #${orderId}!`,
        status: "PROCESSED",
        tempId: tempId,
        targetModule: "Purchase",
        targetId: orderId,
        orderId: orderId,
        matchType: "PREORDER"
      };
    }

    if (action === "FAMILY") {
      const formData = payload.formData || {};
      const saveFn = typeof saveFamilyTransaction === 'function' ? saveFamilyTransaction : null;
      if (saveFn) {
        const res = saveFn(formData, ss);
        if (!res || !res.success) {
          return { success: false, message: (res && res.message) ? res.message : "❌ Lỗi khi lưu vào Thu Chi!" };
        }
        createdRefId = res.id || res.transactionId || "";
        targetModuleName = "Family";
      } else {
        return { success: false, message: "❌ Không tìm thấy hàm saveFamilyTransaction!" };
      }
    } else if (action === "PURCHASE") {
      const formData = payload.formData || {};
      const saveFn = typeof savePurchaseOrder === 'function' ? savePurchaseOrder : null;
      if (saveFn) {
        const res = saveFn(formData, ss);
        if (!res || !res.success) {
          return { success: false, message: (res && res.message) ? res.message : "❌ Lỗi khi lưu Đơn Mua Hàng!" };
        }
        createdRefId = res.orderId || res.id || "";
        targetModuleName = "Purchase";
      } else {
        return { success: false, message: "❌ Không tìm thấy hàm savePurchaseOrder!" };
      }
    } else if (action === "DEBT") {
      const formData = payload.formData || {};
      const saveFn = typeof saveDebtTransaction === 'function' ? saveDebtTransaction : null;
      if (saveFn) {
        const res = saveFn(formData, ss);
        if (!res || !res.success) {
          return { success: false, message: (res && res.message) ? res.message : "❌ Lỗi khi lưu Công Nợ!" };
        }
        createdRefId = res.id || "";
        targetModuleName = "Debt";
      } else {
        return { success: false, message: "❌ Không tìm thấy hàm saveDebtTransaction!" };
      }
    } else {
      return { success: false, message: `❌ Hành động ${action} không hợp lệ!` };
    }

    // Cập nhật trạng thái bản ghi trong sheet Temp nếu có
    if (tempSheet && targetRowIndex > 0 && map) {
      tempSheet.getRange(targetRowIndex, map.status + 1).setValue("PROCESSED");
      if (map.targetModule >= 0) tempSheet.getRange(targetRowIndex, map.targetModule + 1).setValue(targetModuleName);
      if (map.targetId >= 0 && createdRefId) tempSheet.getRange(targetRowIndex, map.targetId + 1).setValue(createdRefId);
    }

    // Ghi nhận vào BankReconciliations
    const recSheet = getOrCreateReconcileSheetHelper(ss);
    if (recSheet && createdRefId) {
      const ymd = normalizeDateToYMD(dateVal);
      const sig = payload.sig || `${ymd}|${amt}|${dir}|${note.toLowerCase()}`;
      const batchId = payload.batchId || ("REC_" + (ymd ? ymd.replace(/-/g, '') : Date.now()));
      const reconciledBy = payload.reconciledBy || "User";
      recSheet.appendRow([
        batchId,
        walletName,
        new Date(),
        reconciledBy,
        sig,
        createdRefId,
        "AUTO_RESOLVED",
        "MATCHED",
        ymd,
        amt,
        ymd,
        amt,
        `Tạo giao dịch ${targetModuleName} (${createdRefId})`
      ]);
    }

    // Xóa cache sổ cái để Tab 1 hiển thị số dư và giao dịch mới
    if (walletName && typeof clearAllWalletStatementCaches === 'function') {
      try { clearAllWalletStatementCaches(); } catch(e) {}
    }

    return {
      success: true,
      message: `✅ Đã xử lý thành công sang ${targetModuleName}! Mã: ${createdRefId}`,
      status: "PROCESSED",
      tempId: tempId,
      targetModule: targetModuleName,
      targetId: createdRefId
    };
  });
}

/**
 * Bỏ qua hàng loạt bản ghi trong Temp
 */
function batchIgnoreTempTransactions(tempIds, ssTarget) {
  try {
    if (!Array.isArray(tempIds) || tempIds.length === 0) return { success: false, message: "❌ Danh sách rỗng" };
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };

    const sheet = ss.getSheetByName(SHEET_TEMP);
    if (!sheet || sheet.getLastRow() < 2) return { success: false, message: "❌ Không có dữ liệu Temp" };

    const { map, lastCol } = getTempColumnIndices(sheet);
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
    const idSet = new Set(tempIds.map(id => String(id).trim()));

    let updatedCount = 0;
    const recSheet = getOrCreateReconcileSheetHelper(ss);
    for (let i = 0; i < data.length; i++) {
      const rId = String(data[i][map.id] || "").trim();
      if (idSet.has(rId)) {
        sheet.getRange(i + 2, map.status + 1).setValue("IGNORED");
        if (map.targetModule >= 0) sheet.getRange(i + 2, map.targetModule + 1).setValue("Bỏ qua (Khớp đối soát)");

        if (recSheet) {
          const wName = String(data[i][map.wallet] || "").trim();
          const dateVal = data[i][map.date];
          const ymd = normalizeDateToYMD(dateVal);
          const amt = Math.round(Math.abs(Number(data[i][map.amount]) || 0));
          const dir = String(data[i][map.type] || '-').trim();
          const note = String(data[i][map.note] || '').trim();
          const sig = `${ymd}|${amt}|${dir}|${note.toLowerCase()}`;
          const batchId = "REC_SKIP_" + (ymd ? ymd.replace(/-/g, '') : Date.now());
          recSheet.appendRow([
            batchId,
            wName,
            new Date(),
            "User",
            sig,
            "SKIP_MATCHED",
            "MANUAL_SKIP",
            "MATCHED",
            ymd,
            amt,
            ymd,
            amt,
            "Khớp đối soát (Bỏ qua hàng loạt)"
          ]);
        }

        updatedCount++;
      }
    }

    return { success: true, count: updatedCount, message: `✅ Đã xác nhận khớp đối soát (Bỏ qua) cho ${updatedCount} giao dịch!` };
  } catch (e) {
    return { success: false, message: "❌ Lỗi: " + e.toString() };
  }
}

/**
 * Khớp gộp thủ công giữa các khoản trên App và dòng sao kê ngân hàng
 * Cho phép người dùng ghép 2 hoặc nhiều khoản trên App với 1 dòng sao kê (hoặc ngược lại)
 */
function manualMatchTransactions(payload, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };

    const walletName = String(payload.walletName || "").trim();
    const batchId = payload.batchId || ("REC_MANUAL_" + Date.now());
    const reconciledBy = payload.reconciledBy || "User";

    const bankItems = (Array.isArray(payload.bankItems) && payload.bankItems.length > 0)
      ? payload.bankItems
      : (payload.bankItem ? [payload.bankItem] : []);
    const appItemIds = Array.isArray(payload.appItemIds) ? payload.appItemIds : [payload.appItemId];
    const appNotes = Array.isArray(payload.appNotes) ? payload.appNotes.join(' + ') : String(payload.appNote || '');

    const recSheet = getOrCreateReconcileSheetHelper(ss);
    if (!recSheet) return { success: false, message: "❌ Không tìm thấy bảng đối soát!" };

    const idsStr = appItemIds.filter(Boolean).join(',');

    bankItems.forEach(b => {
      const bYmd = normalizeDateToYMD(b.date || payload.date);
      const bAmt = Math.round(Math.abs(Number(b.amount || payload.amount) || 0));
      const bType = String(b.type || payload.type || "-").trim();
      const bNote = String(b.note || payload.note || "").trim();
      const sig = b.sig || `${bYmd}|${bAmt}|${bType}|${bNote.toLowerCase()}`;

      recSheet.appendRow([
        batchId,
        walletName,
        new Date(),
        reconciledBy,
        sig,
        idsStr || "MANUAL_MATCHED",
        "MANUAL_COMBINED",
        "MATCHED",
        bYmd,
        bAmt,
        bYmd,
        bAmt,
        `Khớp gộp thủ công: ${appNotes || idsStr}`
      ]);
    });

    const primaryBank = bankItems[0] || {};
    const bYmd = normalizeDateToYMD(primaryBank.date || payload.date);
    const totalBankAmt = bankItems.reduce((s, b) => s + Math.round(Math.abs(Number(b.amount) || 0)), 0);

    return {
      success: true,
      message: "✅ Đã khớp gộp thành công!",
      batchId: batchId,
      matched: {
        matchType: "COMBINED",
        status: "MATCHED",
        bank: {
          date: primaryBank.date,
          ymd: bYmd,
          amount: totalBankAmt,
          type: primaryBank.type || "-",
          note: bankItems.map(b => `${b.note || 'Sao kê'} (${Number(b.amount).toLocaleString()} ¥)`).join(' + ')
        },
        app: {
          id: idsStr,
          date: primaryBank.date,
          ymd: bYmd,
          amount: totalBankAmt,
          type: primaryBank.type || "-",
          note: appNotes
        }
      }
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi khớp gộp: " + err.toString() };
  }
}

/**
 * Đánh dấu bỏ qua giao dịch trên App (coi như đã đối soát, không nhắc nữa)
 */
function skipAppTransaction(payload, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };

    const walletName = String(payload.walletName || "").trim();
    const appId = String(payload.appId || payload.id || "").trim();
    if (!appId) return { success: false, message: "❌ Thiếu mã giao dịch App!" };

    const ymd = normalizeDateToYMD(payload.date);
    const amt = Math.round(Math.abs(Number(payload.amount) || 0));
    const type = String(payload.type || "-").trim();
    const note = String(payload.note || "").trim();

    const recSheet = getOrCreateReconcileSheetHelper(ss);
    if (recSheet) {
      const batchId = payload.batchId || ("REC_APP_SKIP_" + (ymd ? ymd.replace(/-/g, '') : Date.now()));
      const reconciledBy = payload.reconciledBy || "User";
      recSheet.appendRow([
        batchId,
        walletName,
        new Date(),
        reconciledBy,
        `APP_${appId}`,
        appId,
        "MANUAL_APP_SKIP",
        "MATCHED",
        ymd,
        amt,
        ymd,
        amt,
        `Bỏ qua trên App (${note})`
      ]);
    }

    return {
      success: true,
      message: "✅ Đã đánh dấu giao dịch này là đã đối soát!",
      appId: appId
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * Xóa hoàn toàn sheet Temp khỏi Google Spreadsheet
 */
function deleteTempSheet(ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "Không tìm thấy bảng tính." };
    const s = ss.getSheetByName("Temp");
    if (s && ss.deleteSheet) {
      ss.deleteSheet(s);
      return { success: true, message: "✅ Đã xóa hoàn toàn sheet Temp khỏi bảng tính!" };
    }
    return { success: true, message: "Không có sheet Temp trong bảng tính." };
  } catch (err) {
    return { success: false, message: "Lỗi xóa sheet Temp: " + err.toString() };
  }
}

/**
 * Khớp nhanh đơn kinh doanh (Hoàn tiền / Pre-order) trực tiếp từ sheet Temp
 */
function confirmMatchTempOrder(payload, ssTarget) {
  const matchType = String(payload.matchType || "").toUpperCase();
  const action = (matchType === "REFUND") ? "MATCH_REFUND" : "MATCH_PREORDER";
  return resolveTempTransaction(Object.assign({}, payload, { action: action }), ssTarget);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getWalletsFromSheet,
    saveWalletToSheet,
    deleteWalletFromSheet,
    hideCardOrWallet,
    restoreCardOrWallet,
    updateWalletBalanceHelper,
    generateUniqueMaGD,
    checkpointWalletBalance,
    rebuildWalletBalance,
    rebuildWalletBalances,
    rebuildAllWallets,
    processWalletTransfer,
    processCreditCardSettlement,
    recordFinancialEvent,
    getWalletTransactionHistory,
    invalidateWalletTransactionCache,
    clearAllWalletStatementCaches,
    t1_isValidCardPassword,
    t1_hashPassword,
    setCardCustomPassword,
    verifyCardPassword,
    changeCardPassword,
    saveCardSecurityDetails,
    encryptCardField,
    decryptCardField,
    migrateEncryptExistingCards,
    extractBaseOrderIdServer,
    normalizeDateToYMD,
    getTempSheetHelper,
    getTempColumnIndices,
    getTempTransactions,
    clearTempSheet,
    parseBankStatementRaw,
    reconcileBankStatement,
    confirmReconcileBatch,
    unmatchReconciledTransaction,
    rollbackReconcileBatch,
    getOrCreateReconcileSheetHelper,
    getReconciledHistoryHelper,
    getBankBalanceFromCategories,
    getBankTemplatesFromCategories,
    buildStatementMappingIndices,
    getAllBankTemplatesFromCategories,
    resolveTempTransaction,
    confirmMatchTempOrder,
    manualMatchTransactions,
    skipAppTransaction,
    deleteTempSheet,
    parseServerDate,
    batchIgnoreTempTransactions
  };
}


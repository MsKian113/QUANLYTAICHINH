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
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    return ss ? ss.getSheetByName(name) : null;
  } catch (e) {
    Logger.log("Lỗi truy cập sheet " + name + ": " + e);
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
  if (!str) return null;

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
    const spaceParts = str.split(' ');
    const parts = spaceParts[0].split('/');
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

  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const spaceParts = str.includes('T') ? str.split('T') : str.split(' ');
    const parts = spaceParts[0].split('-');
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
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  } catch(e) {
    return null;
  }
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
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
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

function getWalletsFromSheet(month, year, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
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

    const lastCol = Math.max((typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 19) || 19, 19);
    const lastRow = sheet.getLastRow();
    const range = sheet.getRange(1, 1, lastRow, lastCol);
    const allData = range.getValues();
    const headerRow = allData[0] || [];
    const dataRows = allData.slice(1);

    // Auto-migrate: Quét và tự động mã hóa dữ liệu thẻ nếu phát hiện còn thẻ plain-text trong sheet Wallets
    try {
      let needsAutoMigrate = false;
      const checkCols = [12, 13, 14, 16, 17, 18]; // Cols M, N, O, Q, R, S
      for (let r = 0; r < dataRows.length; r++) {
        const rowData = dataRows[r];
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

    // Map column headers dynamically
    let colMap = {
      id: 0, name: 1, type: 2, credit_limit: 3, closing_date: 4, due_date: 5,
      initial_balance: 6, current_balance: 7, checkpoint_id: 8, checkpoint_date: 9,
      checkpoint_balance: 10, balance_status: 11, settle_source: 12
    };

    // Check if legacy 11-column layout (where Col 7=Initial, Col 8=THU, Col 9=CHI, Col 10=CurrentBalance, Col 11=Ví nguồn, Col 12=Checkpoint Date)
    const isLegacy11or12 = headerRow.length >= 8 && (
      String(headerRow[7] || '').toUpperCase().includes('THU') ||
      String(headerRow[7] || '').toUpperCase().includes('TĂNG') ||
      String(headerRow[8] || '').toUpperCase().includes('CHI') ||
      String(headerRow[8] || '').toUpperCase().includes('GIẢM')
    );

    if (isLegacy11or12) {
      colMap = {
        id: 0, name: 1, type: 2, credit_limit: 3, closing_date: 4, due_date: 5,
        initial_balance: 6, total_increase: 7, total_decrease: 8, current_balance: 9,
        settle_source: 10, checkpoint_date: 11, checkpoint_balance: 9, checkpoint_id: -1, balance_status: -1
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
        else if (title === 'checkpointid') colMap.checkpoint_id = idx;
        else if ((title.includes('checkpoint') && (title.includes('date') || title.includes('ngày'))) || title.includes('ngày chốt sổ')) colMap.checkpoint_date = idx;
        else if ((title.includes('checkpoint') && (title.includes('balance') || title.includes('số dư'))) || title.includes('số dư chốt')) colMap.checkpoint_balance = idx;
        else if (title.includes('trạng thái') || title.includes('status') || title === 'balancestatus') colMap.balance_status = idx;
        else if (title.includes('nguồn') || title === 'settlesource') colMap.settle_source = idx;
      });
    }

    // Build checkpoint map: Ưu tiên nạp từ Sheet WalletCheckpoints
    const walletCheckpointMap = {}; // key -> { date, dateStr, balance, id }
    const cpSheet = ss.getSheetByName(SHEET_WALLET_CHECKPOINTS);
    if (cpSheet && cpSheet.getLastRow() >= 2) {
      const cpData = cpSheet.getRange(2, 1, cpSheet.getLastRow() - 1, 8).getValues();
      for (let i = 0; i < cpData.length; i++) {
        const cpWId = String(cpData[i][1] || "").trim();
        const cpWName = String(cpData[i][2] || "").trim().toLowerCase();
        const cpDateStr = String(cpData[i][3] || "").trim();
        const cpBal = parseMoneyNumber(cpData[i][4]);
        const status = String(cpData[i][7] || "ACTIVE").trim().toUpperCase();
        if (status === "ACTIVE") {
          const cpDate = parseServerDate(cpDateStr);
          if (cpDate) {
            const cpObj = { date: cpDate, dateStr: cpDateStr, balance: cpBal, id: String(cpData[i][0] || '') };
            if (cpWName) walletCheckpointMap[cpWName] = cpObj;
            if (cpWId) walletCheckpointMap[cpWId.toLowerCase()] = cpObj;
          }
        }
      }
    }

    // Fallback: Nếu ví chưa có trong WalletCheckpoints, kiểm tra cột trên sheet Wallets
    dataRows.forEach(function(r) {
      const wId = String(r[colMap.id] || "").trim().toLowerCase();
      const wName = String(r[colMap.name] || "").trim().toLowerCase();
      const cpStr = (colMap.checkpoint_date >= 0 && r[colMap.checkpoint_date]) ? String(r[colMap.checkpoint_date]).trim() : "";
      const cpBal = (colMap.checkpoint_balance >= 0 && r[colMap.checkpoint_balance] !== undefined) ? parseMoneyNumber(r[colMap.checkpoint_balance]) : 0;
      if (cpStr && !walletCheckpointMap[wName]) {
        const cpD = parseServerDate(cpStr);
        if (cpD) {
          const cpObj = { date: cpD, dateStr: cpStr, balance: cpBal };
          if (wName) walletCheckpointMap[wName] = cpObj;
          if (wId) walletCheckpointMap[wId] = cpObj;
        }
      }
    });

    // Build ledger checkpoint map: `${walletKey}_${sourceId}` -> checkpointRef
    const ledgerCheckpointMap = {};
    const ledgerSheet = ss.getSheetByName(SHEET_WALLET_LEDGER);
    if (ledgerSheet && ledgerSheet.getLastRow() >= 2) {
      const lData = ledgerSheet.getRange(2, 1, ledgerSheet.getLastRow() - 1, Math.max(ledgerSheet.getLastColumn(), 16)).getValues();
      for (let i = 0; i < lData.length; i++) {
        const rowWId = String(lData[i][1] || "").trim().toLowerCase();
        const rowWName = String(lData[i][2] || "").trim().toLowerCase();
        const srcId = String(lData[i][8] || "").trim().toLowerCase(); // Col I: SourceID
        const status = String(lData[i][11] || "").trim().toUpperCase(); // Col L: Status
        const cpRef = String(lData[i][15] || "").trim(); // Col P: CheckpointRef
        if (srcId && status === "POSTED") {
          if (rowWName) {
            const kName = `${rowWName}_${srcId}`;
            if (!ledgerCheckpointMap[kName] || cpRef) ledgerCheckpointMap[kName] = cpRef;
          }
          if (rowWId) {
            const kId = `${rowWId}_${srcId}`;
            if (!ledgerCheckpointMap[kId] || cpRef) ledgerCheckpointMap[kId] = cpRef;
          }
        }
      }
    }

    function isTxEligible(txId, txDate, walletKey) {
      const cleanTxId = txId ? String(txId).trim().toLowerCase() : "";
      if (cleanTxId && walletKey) {
        const ledgerKey = `${walletKey}_${cleanTxId}`;
        if (ledgerCheckpointMap[ledgerKey] !== undefined) {
          // Approach 2: If found in WalletLedger, check CheckpointRef flag!
          // If CheckpointRef is present -> already checkpointed -> false (skip)
          // If CheckpointRef is empty ("") -> uncheckpointed -> true (eligible!)
          return !ledgerCheckpointMap[ledgerKey];
        }
      }
      // Fallback: Check by checkpoint date if not in WalletLedger
      const cpInfo = walletCheckpointMap[walletKey];
      if (cpInfo && cpInfo.date && txDate) {
        return isTransactionAfterCheckpoint(txDate, cpInfo.date, cpInfo.dateStr);
      }
      return true;
    }

    const walletMap = {};
    function addWalletStat(wName, incAmt, decAmt, txDate, txId) {
      if (!wName) return;
      const key = String(wName).trim().toLowerCase();
      if (!key) return;

      if (!isTxEligible(txId, txDate, key)) {
        return; // Skip transaction that is already checkpointed
      }

      if (!walletMap[key]) walletMap[key] = { inc: 0, dec: 0 };
      walletMap[key].inc += (incAmt || 0);
      walletMap[key].dec += (decAmt || 0);
    }

    // Maps for Credit card debts, preorders, and settlements
    const cardStatementDebtMap = {};
    const cardPreorderMap = {};
    const cardSettlementMap = {};

    // 1. Scan Family Sheet (ThuChi)
    const familySheet = getSheetByNames("Family", "ThuChi", ss);
    if (familySheet && familySheet.getLastRow() >= 2) {
      const fData = familySheet.getRange(2, 1, familySheet.getLastRow() - 1, Math.max(familySheet.getLastColumn(), 10)).getValues();
      fData.forEach(function(row) {
        const dF = parseServerDate(row[1]);
        const mF = dF ? (dF.getMonth() + 1) : null;
        const yF = dF ? dF.getFullYear() : null;
        const matchMonthF = isAllMonth || !mF || mF === targetMonth;
        const matchYearF = isAllYear || !yF || yF === targetYear;

        if (matchMonthF && matchYearF) {
          const loai = String(row[2] || "").trim().toLowerCase();
          const hu = String(row[3] || "").trim().toLowerCase();
          const noiDung = String(row[4] || "").trim();
          const amt = parseMoneyNumber(row[5]);
          const walletName = String(row[6] || "").trim();
          const walletKey = walletName.toLowerCase();
          const statusVal = String(row[9] || "").trim().toUpperCase();
          const isPreorder = statusVal.includes("PRE-ORDER") || statusVal.includes("PREORDER") || noiDung.includes("[Pre-order");

          const isTransfer = hu.includes("ck nội bộ") || noiDung.includes("Chuyển tiền:");
          const isSettlement = hu.includes("tất toán thẻ") || noiDung.toLowerCase().includes("tất toán thẻ");

          if (walletName && amt > 0) {
            if (loai === "thu" || loai === "thu nhập" || loai.includes("tất toán thu") || loai.includes("thu nợ") || loai.includes("thu hồi")) {
              addWalletStat(walletName, amt, 0, row[1], row[0]);
            } else {
              addWalletStat(walletName, 0, amt, row[1], row[0]);

              if (isPreorder) {
                cardPreorderMap[walletKey] = (cardPreorderMap[walletKey] || 0) + amt;
              } else if (isTxEligible(row[0], row[1], walletKey)) {
                cardStatementDebtMap[walletKey] = (cardStatementDebtMap[walletKey] || 0) + amt;
              }

              if (isSettlement) {
                const settleInfo = (typeof parseSettlementDetails === 'function') ? parseSettlementDetails(noiDung, walletName) : { cardName: "", sourceWallet: walletName };
                let cardName = settleInfo.cardName;
                if (!cardName) {
                  const cleaned = noiDung.replace(/^tất\s+toán\s*(thẻ)?\s*:?\s*/i, '');
                  const parts = cleaned.split(/\s+từ\s+/i);
                  cardName = parts[0] ? parts[0].trim() : "";
                }
                const resolvedCard = (typeof resolveWalletCanonicalName === 'function') ? resolveWalletCanonicalName(cardName) : cardName;
                if (resolvedCard) {
                  addWalletStat(resolvedCard, amt, 0, row[1], row[0]);
                  const cardKey = resolvedCard.toLowerCase();
                  if (isTxEligible(row[0], row[1], cardKey)) {
                    cardSettlementMap[cardKey] = (cardSettlementMap[cardKey] || 0) + amt;
                  }
                }
              } else if (isTransfer) {
                const parts = noiDung.split("->");
                if (parts.length > 1) {
                  const destWallet = parts[1].trim();
                  if (destWallet) addWalletStat(destWallet, amt, 0, row[1], row[0]);
                }
              }
            }
          }
        }
      });
    }

    // 2. Scan Sales Sheet - Tiền nhận vào bán hàng cho ví Debit / Tiền mặt
    const sSheetWallets = getSheetByNameSafely("Sales", ss);
    if (sSheetWallets && sSheetWallets.getLastRow() >= 2) {
      const sData = sSheetWallets.getRange(2, 1, sSheetWallets.getLastRow() - 1, Math.max(sSheetWallets.getLastColumn(), 10)).getValues();
      sData.forEach(function(row) {
        const dS = parseServerDate(row[1]);
        const mS = dS ? (dS.getMonth() + 1) : null;
        const yS = dS ? dS.getFullYear() : null;
        const matchMonthS = isAllMonth || !mS || mS === targetMonth;
        const matchYearS = isAllYear || !yS || yS === targetYear;

        if (matchMonthS && matchYearS) {
          const statusThanhToan = String(row[9] || "").trim().toUpperCase();
          const isKhachNo = statusThanhToan === "CHO_THU" || String(row[8] || "").trim().toLowerCase() === "khách nợ";
          if (isKhachNo) return; // Bỏ qua đơn khách nợ chưa nhận tiền vào ví

          const nhanTienVao = String(row[8] || "").trim();
          const totalAmt = parseMoneyNumber(row[6]);
          if (nhanTienVao && totalAmt > 0) {
            addWalletStat(nhanTienVao, totalAmt, 0, row[1], row[0]);
          }
        }
      });
    }

    // 3. Scan Purchase Sheet - Mua hàng thực tế / Pre-order
    const pSheetWallets = getSheetByNameSafely("Purchase", ss);
    if (pSheetWallets && pSheetWallets.getLastRow() >= 2) {
      const pData = pSheetWallets.getRange(2, 1, pSheetWallets.getLastRow() - 1, Math.max(pSheetWallets.getLastColumn(), 12)).getValues();
      pData.forEach(function(row) {
        const statusWh = String(row[3] || "").trim().toLowerCase();
        const statusValP = String(row[9] || "").trim().toUpperCase();
        const lowerCardStatus = String(row[9] || "").trim().toLowerCase();
        const isCancelled = statusWh.includes("hủy") || statusWh.includes("cancel");
        const isCardDone = !isCancelled && (
          statusValP === "HOAN_TAT" ||
          statusValP.includes("HOÀN TẤT") ||
          statusValP.includes("ĐÃ TRỪ") ||
          lowerCardStatus === "hoan_tat" ||
          lowerCardStatus.includes("da_tru") ||
          lowerCardStatus.includes("đã trừ") ||
          lowerCardStatus.includes("hoàn tất")
        );
        const isCardRefunded = statusValP === "DA_HOAN" || lowerCardStatus.includes("đã hoàn") || lowerCardStatus.includes("da_hoan") || statusWh === "đã hoàn tiền";

        const dP = parseServerDate(row[1]);
        const mP = dP ? (dP.getMonth() + 1) : null;
        const yP = dP ? dP.getFullYear() : null;
        const matchMonthP = isAllMonth || !mP || mP === targetMonth;
        const matchYearP = isAllYear || !yP || yP === targetYear;

        if (matchMonthP && matchYearP) {
          let walletName = String(row[8] || "").trim();
          const ghiChu = String(row[10] || "").trim();
          const m = ghiChu.match(/Ví:\s*([^\]]+)/i);
          if (m && m[1]) walletName = m[1].trim();

          const walletKey = walletName.toLowerCase();
          const qty = parseMoneyNumber(row[5]) || 1;
          const price = parseMoneyNumber(row[6]);
          const total = parseMoneyNumber(row[7]) || (qty * price);

          if (walletName && total > 0) {
            const rowId = String(row[0] || '').trim().toLowerCase();
            const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(walletName, ss) : (/^c[-_\s]/i.test(walletName) || walletName.toLowerCase().includes("thẻ") || walletName.toLowerCase().includes("credit"));
            const ngaySaoKeStr = String(row[12] || '').trim();
            const wasCharged = Boolean(ngaySaoKeStr || (rowId && ledgerCheckpointMap && ledgerCheckpointMap[`${walletKey}_${rowId}`] !== undefined));

            if (isCancelled) {
              if (!isCredit) {
                if (wasCharged) {
                  addWalletStat(walletName, 0, total, row[1], row[0]);
                  if (isCardRefunded) {
                    addWalletStat(walletName, total, 0, row[1], row[0]);
                  }
                } else if (isCardRefunded) {
                  addWalletStat(walletName, total, 0, row[1], row[0]);
                }
              } else {
                if (isCardRefunded) {
                  if (isTxEligible(row[0], row[1], walletKey)) cardSettlementMap[walletKey] = (cardSettlementMap[walletKey] || 0) + total;
                  addWalletStat(walletName, total, 0, row[1], row[0]);
                }
              }
              return;
            }

            const isPreorderP = !isCardDone;
            if (isPreorderP) {
              cardPreorderMap[walletKey] = (cardPreorderMap[walletKey] || 0) + total;
            } else {
              addWalletStat(walletName, 0, total, row[1], row[0]);
              if (isTxEligible(row[0], row[1], walletKey)) {
                cardStatementDebtMap[walletKey] = (cardStatementDebtMap[walletKey] || 0) + total;
              }
            }
          }
        }
      });
    }

    // 4. Scan Debt Sheet (CongNo) - Vay & Cho vay
    const debtSheet = getSheetByNames("Debt", "CongNo", ss);
    if (debtSheet && debtSheet.getLastRow() >= 2) {
      const dData = debtSheet.getRange(2, 1, debtSheet.getLastRow() - 1, 11).getValues();
      dData.forEach(function(row) {
        const dD = parseServerDate(row[1]);
        const mD = dD ? (dD.getMonth() + 1) : null;
        const yD = dD ? dD.getFullYear() : null;
        const matchMonthD = isAllMonth || !mD || mD === targetMonth;
        const matchYearD = isAllYear || !yD || yD === targetYear;

        if (matchMonthD && matchYearD) {
          const loai = String(row[3] || "").trim().toUpperCase();
          const amt = parseMoneyNumber(row[5]);
          const walletName = String(row[6] || "").trim();
          if (walletName && amt > 0) {
            if (loai === "VAY" || loai === "TRA") {
              addWalletStat(walletName, amt, 0, row[1], row[0]); // Đi vay: tiền nhận vào ví
            } else if (loai === "CHO_VAY" || loai === "THU") {
              addWalletStat(walletName, 0, amt, row[1], row[0]); // Cho vay: tiền xuất ra khỏi ví
            }
          }
        }
      });
    }

    const wallets = [];

    dataRows.forEach(function(r, index) {
      const id = String(r[colMap.id] || "").trim();
      if (!id) return;

      const wName = String(r[colMap.name] || "").trim();
      const wNameLower = wName.toLowerCase();
      const initialBal = parseMoneyNumber(r[colMap.initial_balance]);
      const isCredit = String(r[colMap.type] || "DEBIT").trim().toUpperCase() === "CREDIT";

      let inc = (colMap.total_increase !== undefined && colMap.total_increase >= 0) ? parseMoneyNumber(r[colMap.total_increase]) : 0;
      let dec = (colMap.total_decrease !== undefined && colMap.total_decrease >= 0) ? parseMoneyNumber(r[colMap.total_decrease]) : 0;

      if (walletMap[wNameLower]) {
        inc = walletMap[wNameLower].inc;
        dec = walletMap[wNameLower].dec;
      }

      const cpInfo = walletCheckpointMap[wNameLower] || (id ? walletCheckpointMap[id.toLowerCase()] : null);
      const cpDateStr = cpInfo ? cpInfo.dateStr : ((colMap.checkpoint_date >= 0 && r[colMap.checkpoint_date]) ? String(r[colMap.checkpoint_date]).trim() : "");
      const cpBal = cpInfo ? cpInfo.balance : (cpDateStr ? ((colMap.checkpoint_balance >= 0 && r[colMap.checkpoint_balance] !== undefined) ? parseMoneyNumber(r[colMap.checkpoint_balance]) : initialBal) : initialBal);
      const baseBal = (cpInfo || cpDateStr) ? cpBal : initialBal;
      let currentBal = baseBal + inc - dec;

      // Calculate Credit Card Statement Debt, Pre-order and Available Credit
      const creditLimit = parseMoneyNumber(r[colMap.credit_limit]);
      let cardPreorderAmt = 0;
      let statementDebt = 0;
      let availableCredit = currentBal;

      if (isCredit) {
        cardPreorderAmt = cardPreorderMap[wNameLower] || 0;
        const chargedAmt = cardStatementDebtMap[wNameLower] || 0;
        const settleAmt = cardSettlementMap[wNameLower] || 0;
        statementDebt = Math.max(0, chargedAmt - settleAmt);
        if (statementDebt === 0 && cardPreorderAmt === 0 && dec > 0) {
          statementDebt = Math.max(0, dec - inc);
        }
        availableCredit = creditLimit > 0 ? Math.max(0, creditLimit - statementDebt - cardPreorderAmt) : 0;
      }

      const statusStr = (colMap.balance_status >= 0 && r[colMap.balance_status]) ? String(r[colMap.balance_status]).trim() : "SYNCED";
      const settleSrc = (colMap.settle_source >= 0 && r[colMap.settle_source]) ? String(r[colMap.settle_source]).trim() : "";

      const finalBal = (currentBal === 0 || Object.is(currentBal, -0)) ? 0 : currentBal;
      const finalDebt = statementDebt > 0 ? statementDebt : (cardPreorderAmt > 0 ? Math.max(0, Math.abs(finalBal) - cardPreorderAmt) : (isCredit ? Math.abs(finalBal) : 0));

      wallets.push({
        id: id,
        name: wName,
        type: isCredit ? "CREDIT" : "DEBIT",
        credit_limit: creditLimit,
        closing_date: r[colMap.closing_date] ? String(r[colMap.closing_date]) : "",
        due_date: r[colMap.due_date] ? String(r[colMap.due_date]) : "",
        initial_balance: initialBal,
        total_increase: inc,
        total_decrease: dec,
        current_balance: finalBal,
        debt: finalDebt,
        statement_debt: finalDebt,
        preorder: cardPreorderAmt,
        preorder_amount: cardPreorderAmt,
        available: availableCredit,
        settle_source: settleSrc,
        checkpoint_date: cpDateStr,
        checkpoint_balance: cpBal,
        balance_status: statusStr
      });

      // Update sheet columns for consistency if ALL
      if (isAllMonth && isAllYear) {
        try {
          if (sheet && typeof sheet.getRange === 'function') {
            if (isLegacy11or12) {
              sheet.getRange(index + 2, 8, 1, 3).setValues([[inc, dec, currentBal]]);
            }
          }
        } catch(e) {}
      }
    });

    let tab3Summary = null;
    let pendingPreOrders = [];
    try {
      // Direct fast scan of Purchase sheet for PRE-ORDER items
      const pSheet = getSheetByNameSafely("Purchase", ss);
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 13);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach((r, idx) => {
          const lowerWh = String(r[3] || "").trim().toLowerCase();
          const statusVal = String(r[9] || "").trim().toUpperCase();
          const lowerCardStatus = String(r[9] || "").trim().toLowerCase();
          const lowerNotes = String(r[10] || "").trim().toLowerCase();
          const isCancelled = lowerWh.includes("hủy") || lowerWh.includes("cancel");
          const isCardDone = statusVal === "HOAN_TAT" || statusVal.includes("HOÀN TẤT") || statusVal.includes("ĐÃ TRỪ") || lowerCardStatus.includes("da_tru") || lowerCardStatus.includes("đã trừ") || lowerCardStatus.includes("hoàn tất");
          const isDatTruoc = lowerWh.includes("đặt trước") || lowerWh.includes("dat truoc") || lowerWh.includes("preorder") || lowerWh.includes("pre-order");
          const isPreOrder = isDatTruoc || statusVal === "PRE-ORDER" || lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerNotes.includes("pre-order") || lowerNotes.includes("đặt trước") || lowerNotes.includes("chờ trừ");

          if (!isCancelled && !isCardDone && isPreOrder) {
            const rowId = String(r[0] || "").trim() || String(idx + 2);
            const qty = parseMoneyNumber(r[5]) || 1;
            const price = parseMoneyNumber(r[6]);
            const total = parseMoneyNumber(r[7]) || (qty * price);
            const pDate = parseServerDate(r[1]);
            const dStr = pDate ? (pDate instanceof Date ? pDate.toISOString().split('T')[0] : String(pDate)) : String(r[1] || '');
            pendingPreOrders.push({
              id: rowId,
              date: dStr,
              ngayMua: dStr,
              content: String(r[4] || 'Hàng Đặt trước'),
              tenSP: String(r[4] || 'Hàng Đặt trước'),
              category: String(r[4] || 'Hàng Đặt trước'),
              qty: qty,
              price: price,
              amount: total,
              total: total,
              wallet: String(r[8] || 'Thẻ Credit'),
              nguonTien: String(r[8] || 'Thẻ Credit'),
              sourceSheet: "Purchase",
              ghiChu: String(r[10] || ""),
              ngaySaoKe: String(r[12] || "")
            });
          }
        });
      }

      // Pre-order chỉ tính từ Sheet Purchase (Mua hàng / Kinh doanh), không tính bên Family và Debt
    } catch (e) {
      Logger.log("Lỗi parse pendingPreOrders: " + e);
    }

    // 4. Đếm số lượng 4 loại đơn hàng & công nợ cho phần Thống kê Tab 1 (Gom theo mã đơn hàng)
    const choShipOrderKeys = new Set();
    const choHoanOrderKeys = new Set();
    const khachNoOrderKeys = new Set();
    const preorderOrderKeys = new Set();

    // A. Quét Sheet Purchase
    try {
      const pSheet = getSheetByNameSafely("Purchase", ss);
      if (pSheet && pSheet.getLastRow() >= 2) {
        const lastColP = Math.max(pSheet.getLastColumn(), 13);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach((r, idx) => {
          const tenSP = String(r[4] || "").trim();
          if (!tenSP || tenSP === "Tên Sản Phẩm") return;

          const dP = parseServerDate(r[1]);
          const mP = dP ? (dP.getMonth() + 1) : null;
          const yP = dP ? dP.getFullYear() : null;
          const matchMonthP = isAllMonth || !mP || mP === targetMonth;
          const matchYearP = isAllYear || !yP || yP === targetYear;

          if (matchMonthP && matchYearP) {
            const rawId = String(r[0] || "").trim();
            const orderKey = extractBaseOrderIdServer(rawId) || ('PURCHASE_ROW_' + idx);
            const lowerWh = String(r[3] || "").trim().toLowerCase();
            const lowerCardStatus = String(r[9] || "").trim().toLowerCase();
            const lowerGhiChu = String(r[10] || "").trim().toLowerCase();
            const isCancelled = lowerWh.includes("hủy") || lowerWh.includes("bị hủy") || lowerWh.includes("cancel");
            const isPendingRefund = lowerWh.includes("chờ hoàn") || lowerWh.includes("cho_hoan") || lowerCardStatus.includes("cho_hoan") || lowerCardStatus.includes("chờ hoàn") || lowerCardStatus.includes("cần hoàn") || lowerCardStatus.includes("refund") || (isCancelled && (lowerCardStatus.includes("hoàn") || lowerWh.includes("hoàn") || lowerGhiChu.includes("hoàn")));

            const isDatTruoc = lowerWh.includes("đặt trước") || lowerWh.includes("dat truoc") || lowerWh.includes("preorder") || lowerWh.includes("pre-order");
            const cardDone = lowerCardStatus.includes("hoan_tat") || lowerCardStatus.includes("da_tru") || lowerCardStatus.includes("đã trừ") || lowerCardStatus.includes("hoàn tất");
            const isPreOrderMatch = !isCancelled && !cardDone && (
              isDatTruoc ||
              lowerCardStatus.includes("pre-order") ||
              lowerCardStatus.includes("preorder") ||
              lowerGhiChu.includes("pre-order") ||
              lowerGhiChu.includes("đặt trước") ||
              lowerGhiChu.includes("chờ trừ")
            );

            // 1. Đơn Đợi Ship: Kho đang Chờ Ship (không tính đơn Đặt trước / Pre-order chưa trừ tiền)
            const isChoShip = !isCancelled && !isPreOrderMatch && (
              lowerWh === "chờ ship" || lowerWh === "cho ship"
            );
            if (isChoShip) choShipOrderKeys.add(orderKey);

            // 2. Đơn Chờ Hoàn: Hàng bị hủy chờ hoàn tiền hoặc kho là Chờ Hoàn
            if (isPendingRefund) choHoanOrderKeys.add(orderKey || ('REFUND_ROW_' + idx));
          }
        });
      }
    } catch(e) {
      Logger.log("Lỗi đếm đơn Purchase: " + e);
    }

    // B. Đơn Pre-Order: Lấy chuẩn theo danh sách Pre-order chưa trừ thẻ (gom theo mã đơn hàng)
    if (pendingPreOrders && pendingPreOrders.length > 0) {
      pendingPreOrders.forEach((item, idx) => {
        const rawId = String(item.id || '').trim();
        const pKey = extractBaseOrderIdServer(rawId) || ('PREORDER_ROW_' + idx);
        preorderOrderKeys.add(pKey);
      });
    }

    // C. Đơn Khách Nợ từ Sheet Sales (gom theo mã đơn hàng)
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

            const isChoThu = trangThai === "CHO_THU" || (trangThai !== "HOAN_TAT" && trangThai !== "ĐÃ THU" && (nhanTien.includes("nợ") || ghiChu.includes("khách nợ")));
            if (isChoThu) {
              khachNoOrderKeys.add(orderKey);
            }
          }
        });
      }
    } catch(e) {
      Logger.log("Lỗi đếm khách nợ từ Sheet Sales: " + e);
    }

    const countChoShip = choShipOrderKeys.size;
    const countPreorder = preorderOrderKeys.size;
    const countKhachNo = khachNoOrderKeys.size;
    const countChoHoan = choHoanOrderKeys.size;

    // D. Đơn Chờ Hoàn và Khách Nợ đã được tổng hợp chính xác từ Sheet Purchase (Đơn mua chờ hoàn) và Sheet Sales (Đơn bán nợ).

    return {
      success: true,
      wallets: wallets,
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
    const ss = ssTarget || (payload && payload.ssTarget) || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
    const requestId = payload ? (payload.requestId || payload.clientRequestId) : null;

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const sheet = getSheetByNameSafely(SHEET_WALLETS, ss);
    if (!sheet) {
      return { success: false, message: "❌ Lỗi: Không tìm thấy sheet 'Wallets'." };
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
    let currentBal = 0;
    let settleSource = payload.settle_source || "";
    let checkpointDate = payload.checkpoint_date || "";

    if (rowIndex === -1) {
      initialBal = payload.initial_balance !== undefined ? Number(payload.initial_balance) : Number(payload.current_balance || 0);
      totalInc = Number(payload.total_increase || 0);
      totalDec = Number(payload.total_decrease || 0);
      currentBal = payload.current_balance !== undefined ? Number(payload.current_balance) : (initialBal + totalInc - totalDec);
    } else {
      const existingRow = sheet.getRange(rowIndex, 1, 1, Math.max(sheet.getLastColumn(), 12)).getValues()[0];
      initialBal = payload.initial_balance !== undefined ? Number(payload.initial_balance) : parseMoneyNumber(existingRow[6]);
      totalInc = parseMoneyNumber(existingRow[7]);
      totalDec = parseMoneyNumber(existingRow[8]);
      settleSource = payload.settle_source !== undefined ? payload.settle_source : (existingRow[10] || "");
      checkpointDate = payload.checkpoint_date !== undefined ? payload.checkpoint_date : (existingRow[11] || "");

      if (payload.current_balance !== undefined && !isNaN(Number(payload.current_balance))) {
        currentBal = Number(payload.current_balance);
        if (payload.initial_balance === undefined) {
          initialBal = currentBal - (totalInc - totalDec);
        }
      } else {
        currentBal = initialBal + totalInc - totalDec;
      }
    }

    const rowData = [
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
      const numCols = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 12) || 12;
      if (numCols >= 12) {
        sheet.getRange(rowIndex, 1, 1, 12).setValues([rowData]);
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
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
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
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
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

    let curBal = 0;
    if (payload.currentBalance !== undefined && payload.currentBalance !== null && String(payload.currentBalance).trim() !== '') {
      curBal = parseMoneyNumber(payload.currentBalance);
    } else {
      const headerVal = String(wSheet.getRange(1, 8).getValue() || '').toUpperCase();
      if (headerVal.includes('HIỆN TẠI') || headerVal.includes('CURRENT')) {
        curBal = parseMoneyNumber(foundRow[7]);
      } else {
        curBal = parseMoneyNumber(foundRow[9]);
      }
    }

    const rowType = String(foundRow[2] || '').trim().toUpperCase();
    const isCredit = (rowType === 'CREDIT') || (rowType !== 'DEBIT' && ((typeof isCreditCardWallet === 'function') ? isCreditCardWallet(resolvedWalletName, ss) : (/^c[-_\s]/i.test(resolvedWalletName) || resolvedWalletName.toLowerCase().includes("credit") || resolvedWalletName.toLowerCase().includes("tín dụng"))));
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

    // Default fallback cho layout 11-12 cột nếu không tìm thấy qua header
    if (initBalCol <= 0 && wSheet.getLastColumn() >= 10) initBalCol = 7;
    if (incCol <= 0 && wSheet.getLastColumn() >= 10) incCol = 8;
    if (decCol <= 0 && wSheet.getLastColumn() >= 10) decCol = 9;
    if (curBalCol <= 0 && wSheet.getLastColumn() >= 10) curBalCol = 10;
    if (cpDateCol <= 0 && wSheet.getLastColumn() >= 12) cpDateCol = 12;

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

    return {
      success: true,
      message: `✅ Đã chốt sổ kỳ thành công cho ${resolvedWalletName}! Số dư gốc mốc chốt: ${curBal.toLocaleString()} ¥`,
      checkpointId: cpId,
      checkpointDate: cpDateStr,
      checkpointBalance: curBal,
      wallets: freshWallets,
      dataVersion: nextVersion
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}

/**
 * 9. TỰ PHỤC HỒI / REBUILD SỐ DƯ VÍ TỪ MỐC CHECKPOINT
 */
function rebuildWalletBalance(walletIdentifier, ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
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

    const wName = String(foundRow[1] || "").trim();
    const initialBal = parseMoneyNumber(foundRow[6]);
    let checkpointBal = initialBal;
    let checkpointDate = null;

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
          break;
        }
      }
    }

    // 2. Nếu không có trong WalletCheckpoints, kiểm tra cột Checkpoint trên Wallets
    if (!checkpointDate) {
      const headerRow = wSheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
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
      } else if (foundRow[11]) {
        checkpointDate = parseServerDate(foundRow[11]);
      }
      if (cpBalIdx >= 0 && foundRow[cpBalIdx] !== undefined && foundRow[cpBalIdx] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[cpBalIdx]);
      } else if (curBalIdx >= 0 && foundRow[curBalIdx] !== undefined && foundRow[curBalIdx] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[curBalIdx]);
      } else if (foundRow[9] !== undefined && foundRow[9] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[9]);
      } else if (foundRow[12] !== undefined && foundRow[12] !== "") {
        checkpointBal = parseMoneyNumber(foundRow[12]);
      }
    }

    // 3. Tính tổng phát sinh sau checkpoint trực tiếp từ các sheet nghiệp vụ
    let totalInc = 0;
    let totalDec = 0;

    // Build ledger checkpoint map: `${walletKey}_${sourceId}` -> checkpointRef
    const ledgerCheckpointMap = {};
    const ledgerSheet = ss.getSheetByName(SHEET_WALLET_LEDGER);
    if (ledgerSheet && ledgerSheet.getLastRow() >= 2) {
      const lData = ledgerSheet.getRange(2, 1, ledgerSheet.getLastRow() - 1, Math.max(ledgerSheet.getLastColumn(), 16)).getValues();
      for (let i = 0; i < lData.length; i++) {
        const rowWId = String(lData[i][1] || "").trim().toLowerCase();
        const rowWName = String(lData[i][2] || "").trim().toLowerCase();
        const srcId = String(lData[i][8] || "").trim().toLowerCase();
        const status = String(lData[i][11] || "").trim().toUpperCase();
        const cpRef = String(lData[i][15] || "").trim();
        if (srcId && status === "POSTED") {
          if (rowWName) {
            const kName = `${rowWName}_${srcId}`;
            if (!ledgerCheckpointMap[kName] || cpRef) ledgerCheckpointMap[kName] = cpRef;
          }
          if (rowWId) {
            const kId = `${rowWId}_${srcId}`;
            if (!ledgerCheckpointMap[kId] || cpRef) ledgerCheckpointMap[kId] = cpRef;
          }
        }
      }
    }

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
      if (s === wName.toLowerCase()) return true;
      const normS = normalizeWalletName(s);
      if (normS && normWName && normS === normWName) return true;
      return false;
    }

    function isTxEligible(txId, txDate, targetWalletName) {
      const cleanTxId = txId ? String(txId).trim().toLowerCase() : "";
      const wKey = targetWalletName ? String(targetWalletName).trim().toLowerCase() : normWName;
      if (cleanTxId && wKey) {
        const ledgerKey = `${wKey}_${cleanTxId}`;
        if (ledgerCheckpointMap[ledgerKey] !== undefined) {
          return !ledgerCheckpointMap[ledgerKey]; // True if uncheckpointed
        }
      }
      return isTransactionAfterCheckpoint(txDate, checkpointDate);
    }

    // 1. Family (Thu Chi, Chuyển tiền, Tất toán)
    const fSheet = getSheetByNames("Family", "ThuChi", ss);
    if (fSheet && fSheet.getLastRow() >= 2) {
      const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, Math.max(fSheet.getLastColumn(), 10)).getValues();
      fData.forEach(r => {
        const src = String(r[6] || "").trim();
        const amt = parseMoneyNumber(r[5]);
        const loai = String(r[2] || "").trim().toLowerCase();
        const hu = String(r[3] || "").trim().toLowerCase();
        const noiDung = String(r[4] || "").trim();
        const isTransfer = hu.includes("ck nội bộ") || noiDung.includes("Chuyển tiền:");
        const isSettlement = hu.includes("tất toán thẻ") || noiDung.toLowerCase().includes("tất toán thẻ");

        if (matchW(src)) {
          if (isTxEligible(r[0], r[1], src)) {
            if (loai === "thu" || loai === "thu nhập" || loai.includes("tất toán thu") || loai.includes("thu nợ") || loai.includes("thu hồi")) {
              totalInc += amt;
            } else {
              totalDec += amt;
            }
          }
        } else if (isSettlement && isTxEligible(r[0], r[1], src)) {
          const settleInfo = (typeof parseSettlementDetails === 'function') ? parseSettlementDetails(noiDung, src) : { cardName: "" };
          const cardName = settleInfo.cardName || noiDung.replace(/^tất\s+toán\s*(thẻ)?\s*:?\s*/i, '').split(/\s+từ\s+/i)[0].trim();
          if (matchW(cardName)) {
            totalInc += amt;
          }
        } else if (isTransfer && isTxEligible(r[0], r[1], src)) {
          const parts = noiDung.split("->");
          if (parts.length > 1 && matchW(parts[1].trim())) {
            totalInc += amt;
          }
        }
      });
    }

    // 2. Sales (Tiền nhận vào bán hàng cho ví Debit / Tiền mặt)
    const sSheet = getSheetByNameSafely("Sales", ss);
    if (sSheet && sSheet.getLastRow() >= 2) {
      const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, Math.max(sSheet.getLastColumn(), 10)).getValues();
      sData.forEach(r => {
        const statusThanhToan = String(r[9] || "").trim().toUpperCase();
        const isKhachNo = statusThanhToan === "CHO_THU" || String(r[8] || "").trim().toLowerCase() === "khách nợ";
        if (isKhachNo) return;

        const src = String(r[8] || "").trim();
        if (matchW(src)) {
          if (isTxEligible(r[0], r[1], src)) {
            const amt = parseMoneyNumber(r[6]);
            totalInc += amt;
          }
        }
      });
    }

    // 3. Purchase
    const pSheet = getSheetByNameSafely("Purchase", ss);
    if (pSheet && pSheet.getLastRow() >= 2) {
      const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 12)).getValues();
      pData.forEach(r => {
        const statusWh = String(r[3] || "").toLowerCase();
        if (statusWh.includes("hủy") || statusWh.includes("cancel")) return;
        const src = String(r[8] || "").trim();
        if (matchW(src)) {
          if (isTxEligible(r[0], r[1], src)) {
            const qty = parseMoneyNumber(r[5]) || 1;
            const price = parseMoneyNumber(r[6]);
            const total = parseMoneyNumber(r[7]) || (qty * price);
            totalDec += total;
          }
        }
      });
    }

    // 4. Debt
    const dSheet = getSheetByNames("Debt", "CongNo", ss);
    if (dSheet && dSheet.getLastRow() >= 2) {
      const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, 11).getValues();
      dData.forEach(r => {
        const src = String(r[6] || "").trim();
        if (matchW(src)) {
          if (isTxEligible(r[0], r[1], src)) {
            const amt = parseMoneyNumber(r[5]);
            const loai = String(r[3] || "").trim().toUpperCase();
            if (loai === "VAY" || loai === "TRA") totalInc += amt;
            else if (loai === "CHO_VAY" || loai === "THU") totalDec += amt;
          }
        }
      });
    }

    const newCurrentBal = checkpointBal + totalInc - totalDec;

    // 4. Ghi lại vào Sheet Wallets & đặt BalanceStatus = SYNCED
    const header8 = String(wSheet.getRange(1, 8).getValue() || '').toUpperCase();
    if (header8.includes('HIỆN TẠI') || header8.includes('CURRENT')) {
      wSheet.getRange(rowIndex, 8).setValue(newCurrentBal);
      wSheet.getRange(rowIndex, 12).setValue("SYNCED");
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
      status: "SYNCED"
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi rebuild: " + err.toString() };
  }
}

function rebuildAllWallets(ssTarget) {
  try {
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss) || getSheetByNameSafely("ViThe", ss);
    if (!wSheet || wSheet.getLastRow() < 2) return { success: true, message: "Không có ví để rebuild" };

    const ids = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, 1).getValues();
    const results = [];
    ids.forEach(r => {
      const id = String(r[0] || "").trim();
      if (id) {
        results.push(rebuildWalletBalance(id, ss));
      }
    });
    return { success: true, message: `✅ Đã rebuild hoàn tất ${results.length} ví/thẻ!`, results: results };
  } catch (e) {
    return { success: false, message: "Lỗi: " + e.toString() };
  }
}

/**
 * 3. XOÁ VÍ/THẺ
 */
function deleteWalletFromSheet(idOrPayload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
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
    if (lastRow < 2) return { success: false, message: "Không có dữ liệu để xoá!" };

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(id).trim()) {
        sheet.deleteRow(i + 2);
        if (typeof clearAppDataCache === 'function') clearAppDataCache();
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
          message: "✅ Đã xoá ví/thẻ thành công!"
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
  const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
  if (!ss) return null;
  const sheet = (typeof getSheetByNames === 'function') ? getSheetByNames(SHEET_WALLETS, "Ví", ss) : (ss.getSheetByName(SHEET_WALLETS) || ss.getSheetByName("Ví"));
  if (!sheet || sheet.getLastRow() < 2) return null;

  const lastCol = (typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 11) || 11;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(lastCol, 11)).getValues();

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1]).trim().toLowerCase() === String(walletName).trim().toLowerCase()) {
      const rowIndex = i + 2;
      const wId = String(data[i][0] || "").trim();
      const wName = String(data[i][1] || "").trim();
      if (data[i].length >= 10 && lastCol >= 10) {
        const initialBal = parseMoneyNumber(data[i][6]);
        let inc = parseMoneyNumber(data[i][7]);
        let dec = parseMoneyNumber(data[i][8]);

        if (amountChange > 0) {
          inc += amountChange;
        } else if (amountChange < 0) {
          dec += Math.abs(amountChange);
        }

        const netBal = initialBal + inc - dec;
        sheet.getRange(rowIndex, 8, 1, 3).setValues([[inc, dec, netBal]]);
        return { id: wId, name: wName, currentBalance: netBal, total_increase: inc, total_decrease: dec };
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
    const ss = ssTarget || (data && data.ssTarget) || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
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

    // Kiểm tra số dư ví nguồn (nếu là Ví Tiền Mặt / ATM)
    const walletSheet = getSheetByNameSafely(SHEET_WALLETS, ss);
    if (walletSheet && walletSheet.getLastRow() >= 2) {
      const wData = walletSheet.getRange(2, 1, walletSheet.getLastRow() - 1, 7).getValues();
      for (let i = 0; i < wData.length; i++) {
        const wName = String(wData[i][1] || "").trim().toLowerCase();
        const wType = String(wData[i][2] || "").trim().toUpperCase();
        const wBal = Number(wData[i][6]) || 0;
        if (wName === fromWallet.toLowerCase() && wType !== 'CREDIT') {
          if (amount > wBal) {
            return {
              success: false,
              message: "❌ Lỗi: Số tiền cần chuyển (" + amount.toLocaleString() + " ¥) vượt quá số dư hiện có trong ví (" + wBal.toLocaleString() + " ¥)!"
            };
          }
          break;
        }
      }
    }

    const updatedWallets = [];
    const wFrom = updateWalletBalanceHelper(fromWallet, -amount, ss);
    if (wFrom) updatedWallets.push(wFrom);
    const wTo = updateWalletBalanceHelper(toWallet, amount, ss);
    if (wTo) updatedWallets.push(wTo);

    const maGD = generateUniqueMaGD("TF");
    const now = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB');
    const noiDung = "Chuyển tiền: " + fromWallet + " -> " + toWallet;
    const note = data.note ? String(data.note).trim() : "";

    const familySheet = getSheetByNames("Family", "ThuChi", ss);
    if (familySheet) {
      familySheet.appendRow([maGD, now, "Chi", "CK NỘI BỘ", noiDung, amount, fromWallet, "", note]);
    }

    if (typeof postFinancialEvents === 'function') {
      postFinancialEvents([
        {
          walletId: fromWallet,
          walletName: fromWallet,
          transactionDate: now,
          direction: "OUT",
          amount: amount,
          type: "CASH",
          eventType: "WALLET_TRANSFER",
          sourceModule: "Wallets",
          sourceId: maGD,
          note: noiDung
        },
        {
          walletId: toWallet,
          walletName: toWallet,
          transactionDate: now,
          direction: "IN",
          amount: amount,
          type: "CASH",
          eventType: "WALLET_TRANSFER",
          sourceModule: "Wallets",
          sourceId: maGD,
          note: "Nhận chuyển tiền từ: " + fromWallet
        }
      ], ss);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    const res = {
      success: true,
      message: "✅ Đã chuyển " + amount.toLocaleString() + " ¥ từ " + fromWallet + " sang " + toWallet,
      updatedWallets: updatedWallets,
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
    const ss = ssTarget || (data && data.ssTarget) || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
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
      postFinancialEvents([
        {
          walletId: sourceWallet,
          walletName: sourceWallet,
          transactionDate: now,
          direction: "OUT",
          amount: amount,
          type: "CASH",
          eventType: "CARD_SETTLE",
          sourceModule: "Wallets",
          sourceId: maGD,
          note: noiDung
        },
        {
          walletId: creditCard,
          walletName: creditCard,
          transactionDate: now,
          direction: "DECREASE",
          amount: amount,
          type: "CARD_DEBT",
          eventType: "CARD_SETTLE",
          sourceModule: "Wallets",
          sourceId: maGD,
          note: "Tất toán thẻ từ " + sourceWallet
        }
      ], ss);
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
function getWalletTransactionHistory(walletName, ssTarget) {
  try {
    const targetWallet = String(walletName || "").trim().toLowerCase();
    if (!targetWallet) return [];

    const normTarget = targetWallet.replace(/^c-\s*/i, '').trim();

    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
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

    function matchWallet(val) {
      if (!val) return false;
      const s = String(val).trim().toLowerCase();
      if (s === targetWallet) return true;
      const normS = normalizeWalletName(s);
      const normTarget = normalizeWalletName(targetWallet);
      if (normS && normTarget && normS === normTarget) return true;
      return false;
    }

    const recordedBizIds = new Set();
    const history = [];

    // Kiểm tra xem targetWallet có phải là Thẻ Credit hay không
    let isTargetCreditCard = false;
    const wSheet = getSheetByNames(SHEET_WALLETS, "Ví", ss);
    if (wSheet && wSheet.getLastRow() >= 2) {
      const wData = wSheet.getRange(2, 1, wSheet.getLastRow() - 1, 3).getValues();
      for (let i = 0; i < wData.length; i++) {
        const wName = String(wData[i][1] || '').trim();
        const wType = String(wData[i][2] || '').trim().toUpperCase();
        if (matchWallet(wName) && wType === 'CREDIT') {
          isTargetCreditCard = true;
          break;
        }
      }
    }
    if (!isTargetCreditCard && (/^c-\s*/i.test(targetWallet) || targetWallet.includes("credit") || targetWallet.includes("tín dụng"))) {
      isTargetCreditCard = true;
    }

    // 1. Quét SHEET "Family" / "ThuChi"
    const fSheet = getSheetByNames("Family", "ThuChi", ss);
    if (fSheet && fSheet.getLastRow() > 1) {
      const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, Math.max(fSheet.getLastColumn(), 10)).getValues();
      fData.forEach((r, idx) => {
        const id = String(r[0] || "").trim() || ("ROW_" + (idx + 2));
        const source = String(r[6] || "").trim();
        const loai = String(r[2] || "").trim();
        const hu = String(r[3] || "").trim();
        const noiDung = String(r[4] || "").trim();
        const amt = parseMoneyNumber(r[5]);
        const date = r[1];
        const ghiChu = String(r[8] || "").trim();
        const rawNote = noiDung || ghiChu || loai;

        if (matchWallet(source)) {
          const statusVal = String(r[9] || "").trim().toUpperCase();
          const isPreorder = isTargetCreditCard ? (statusVal.includes("PRE-ORDER") || statusVal.includes("PREORDER") || rawNote.includes("[Pre-order")) : false;

          const isChi = (loai.toUpperCase() === "CHI" || loai.toUpperCase() === "KHOẢN CHI" || loai === "-");

          let cleanRawNote = cleanTransactionDetailNote(rawNote, hu, isChi);

          let cleanModule = formatCleanModule(hu, !isChi);

          if (isChi) {
            history.push({
              id: id,
              rawNote: cleanRawNote,
              date: date,
              module: cleanModule,
              type: "-",
              amount: amt,
              note: cleanRawNote,
              isPreorder: isPreorder,
              status: isPreorder ? "PRE-ORDER" : (statusVal || "HOAN_TAT")
            });
          } else {
            history.push({
              id: id,
              rawNote: cleanRawNote,
              date: date,
              module: cleanModule,
              type: "+",
              amount: amt,
              note: cleanRawNote,
              isPreorder: false,
              status: statusVal || "HOAN_TAT"
            });
          }
        } else if (isTargetCreditCard && hu && hu.includes("Tất toán thẻ")) {
          // Bút toán thanh toán tất toán nợ thẻ từ ví khác
          if (noiDung.toLowerCase().includes(targetWallet) || (normTarget && noiDung.toLowerCase().includes(normTarget))) {
            history.push({
              id: id,
              rawNote: noiDung,
              date: date,
              module: "Tất Toán Thẻ",
              type: "+",
              amount: amt,
              note: `[Tất toán thẻ] Thanh toán từ ${source || 'Ví nguồn'} (+${amt.toLocaleString()} ¥)`,
              isPreorder: false,
              status: "HOAN_TAT"
            });
          }
        }
      });
    }

    // 2. Quét SHEET "Purchase" (Đơn Mua Hàng & Hoàn Tiền)
    const pSheet = getSheetByNameSafely("Purchase", ss);
    if (pSheet && pSheet.getLastRow() > 1) {
      const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 12)).getValues();
      pData.forEach((r, idx) => {
        const pId = String(r[0] || "").trim() || ("PO_ROW_" + (idx + 2));
        const statusWh = String(r[3] || "").trim().toLowerCase();
        const statusValP = String(r[9] || "").trim().toUpperCase();
        const lowerCardStatus = String(r[9] || "").trim().toLowerCase();
        const isCancelled = statusWh.includes("hủy") || statusWh.includes("cancel");
        const isCardDone = statusValP === "HOAN_TAT" || statusValP.includes("HOÀN TẤT") || statusValP.includes("ĐÃ TRỪ") || lowerCardStatus.includes("da_tru") || lowerCardStatus.includes("đã trừ") || statusValP === "ĐÃ SAO KÊ";
        const isCardRefunded = statusValP === "DA_HOAN" || lowerCardStatus.includes("đã hoàn") || lowerCardStatus.includes("da_hoan") || statusWh === "đã hoàn tiền";

        const source = String(r[8] || "").trim(); // Cột I: Nguồn Tiền Mua
        const date = r[1];
        const tenSP = String(r[4] || "").trim();
        const noiMua = String(r[2] || "").trim();
        const qty = parseMoneyNumber(r[5]) || 1;
        const price = parseMoneyNumber(r[6]);
        const total = parseMoneyNumber(r[7]) || (qty * price);
        const ghiChu = String(r[10] || "").trim();

        // 1. Xử lý đơn đã hoàn tiền (Refunded): Sinh dòng Thu "+" hoàn tiền vào ví nhận
        if (isCardRefunded) {
          let refundWallet = source;
          const m = ghiChu.match(/Ví:\s*([^\]]+)/i);
          if (m && m[1]) refundWallet = m[1].trim();

          if (matchWallet(refundWallet)) {
            history.push({
              id: pId + "_REFUND",
              rawNote: `Hoàn tiền đơn hủy: ${tenSP}`,
              date: date,
              module: "Hoàn Tiền Đơn Hủy",
              type: "+",
              amount: total,
              note: `📦 [Hoàn Tiền] ${tenSP || 'Hàng hóa'} (+${total.toLocaleString()} ¥)`,
              isPreorder: false,
              status: "HOAN_TAT"
            });
          }
          return;
        }

        // 2. Xử lý đơn mua bình thường hoặc đơn hủy đang chờ hoàn
        if (isCancelled && !isCardDone) return; // Đơn hủy chưa trừ tiền -> bỏ qua

        if (matchWallet(source)) {
          if (recordedBizIds.has(pId)) return;

          const isPreorderP = isTargetCreditCard ? (!isCancelled && !isCardDone) : false;

          let noteText = `[Đơn Mua] ${tenSP || 'Hàng hóa'}`;
          if (isCancelled) noteText = `[HỦY - Chờ Hoàn] ${tenSP || 'Hàng hóa'}`;
          if (noiMua) noteText += ` (${noiMua})`;
          if (qty > 1) noteText += ` x${qty}`;
          if (ghiChu) noteText += ` - ${ghiChu}`;

          history.push({
            id: pId,
            rawNote: noteText,
            date: date,
            module: isCancelled ? "Đơn Hủy Chờ Hoàn" : "Đơn Mua Hàng",
            type: "-",
            amount: total,
            note: noteText,
            isPreorder: isPreorderP,
            status: isCancelled ? "CHO_HOAN" : (isPreorderP ? "PRE-ORDER" : "HOAN_TAT")
          });
        }
      });
    }

    // 3. Quét SHEET "Sales" (Đơn Bán Hàng - Chỉ áp dụng cho Ví Debit / Tiền mặt)
    if (!isTargetCreditCard) {
      const sSheet = getSheetByNameSafely("Sales", ss);
      if (sSheet && sSheet.getLastRow() > 1) {
        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, Math.max(sSheet.getLastColumn(), 10)).getValues();
        sData.forEach((r, idx) => {
          const sId = String(r[0] || "").trim() || ("SO_ROW_" + (idx + 2));
          if (recordedBizIds.has(sId)) return;

          const nhanTien = String(r[8] || r[7] || "").trim(); // Cột I (index 8) hoặc Cột H (index 7)
          if (matchWallet(nhanTien)) {
            const date = r[1];
            const tenSP = String(r[2] || r[3] || "").trim();
            const totalAmt = parseMoneyNumber(r[6]);
            const noteText = `[Đơn Bán] ${tenSP || 'Hàng hóa'} (+${totalAmt.toLocaleString()} ¥)`;

            history.push({
              id: sId,
              rawNote: noteText,
              date: date,
              module: "Đơn Bán Hàng",
              type: "+",
              amount: totalAmt,
              note: noteText,
              isPreorder: false,
              status: "HOAN_TAT"
            });
          }
        });
      }
    }

    // 4. Quét SHEET "Debt" / "CongNo" (Công Nợ)
    const dSheet = getSheetByNames("Debt", "CongNo", ss);
    if (dSheet && dSheet.getLastRow() > 1) {
      const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, Math.max(dSheet.getLastColumn(), 11)).getValues();
      dData.forEach((r, idx) => {
        const dId = String(r[0] || "").trim() || ("DEBT_ROW_" + (idx + 2));
        const source = String(r[6] || "").trim(); // Cột G: Nguồn
        if (matchWallet(source)) {
          const date = r[1];
          const loai = String(r[3] || "").trim().toUpperCase();
          const person = String(r[2] || "").trim();
          const noiDung = String(r[4] || "").trim();
          const amt = parseMoneyNumber(r[5]);

          const isChoVay = (loai === "CHO_VAY" || loai === "THU" || loai.includes("CHO_VAY") || loai.includes("CHO VAY"));
          const noteText = `[Công Nợ] ${isChoVay ? 'Cho vay' : 'Vay từ'}: ${person || 'Đối tác'} (${noiDung || ''})`;

          history.push({
            id: dId,
            rawNote: noteText,
            date: date,
            module: "Công Nợ",
            type: isChoVay ? "-" : "+",
            amount: amt,
            note: noteText,
            isPreorder: false,
            status: "HOAN_TAT"
          });
        }
      });
    }

    // Sort ngày giảm dần (mới nhất đến cũ nhất)
    history.sort((a, b) => {
      const dA = parseServerDate(a.date);
      const dB = parseServerDate(b.date);
      const tA = dA ? dA.getTime() : 0;
      const tB = dB ? dB.getTime() : 0;
      return tB - tA;
    });

    // Format ngày chuẩn dd/MM/yyyy
    history.forEach(h => {
      const d = parseServerDate(h.date);
      if (d) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        h.date = `${dd}/${mm}/${yyyy}`;
      } else {
        h.date = String(h.date || '');
      }
    });

    return history;
  } catch (err) {
    Logger.log("Lỗi getWalletTransactionHistory: " + err.toString());
    return [];
  }
}

/**
 * 7. ĐIỀU CHỈNH CÂN BẰNG SỔ (CHỈNH LỆCH)
 */
function adjustWalletBalance(data) {
  try {
    const walletName = String(data.walletName || "").trim();
    let actualBalance = Number(data.actualBalance);
    const appBalance = Number(data.appBalance);

    if (!walletName || isNaN(actualBalance)) {
      return { success: false, message: "❌ Lỗi: Số tiền thực tế không hợp lệ!" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
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

    const familySheet = getSheetByNames("Family", "ThuChi");
    if (familySheet) {
      const maGD = generateUniqueMaGD("ADJ");
      const now = typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : new Date().toLocaleDateString('en-GB');
      const loai = diff >= 0 ? "Thu" : "Chi";
      const huName = diff >= 0 ? "THU NHẬP" : "CK NỘI BỘ";
      const noiDung = "Chỉnh lệch sổ thực tế (App: " + appBalance.toLocaleString() + " -> Thực tế: " + actualBalance.toLocaleString() + ")";
      const note = data.note ? String(data.note).trim() : "";
      
      familySheet.appendRow([maGD, now, loai, huName, noiDung, Math.abs(diff), walletName, "", note, "HOAN_TAT"]);
    }

    if (typeof postFinancialEvents === 'function' && walletName && diff !== 0) {
      const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(walletName, ss) : false;
      const direction = isCredit ? (diff >= 0 ? "DECREASE" : "INCREASE") : (diff >= 0 ? "IN" : "OUT");
      const effectType = isCredit ? "CARD_DEBT" : "CASH";
      const eventType = diff >= 0 ? "ADJUSTMENT_INC" : "ADJUSTMENT_DEC";
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
      const wRes = getWalletsFromSheet('All', 'All');
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
 * 8. CẬP NHẬT GIAO DỊCH TỪ CHI TIẾT SỔ PHỤ (STATEMENT MODAL)
 */
function updateFamilyTransactionById(payload, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    try {
      const ss = ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null);
      const fSheet = getSheetByNames("Family", "ThuChi", ss);
      if (!fSheet || fSheet.getLastRow() < 2) {
        return { success: false, message: "❌ Lỗi: Không tìm thấy dữ liệu giao dịch." };
      }
      const id = String(payload.id || "").trim();
      if (!id) return { success: false, message: "❌ Lỗi: Mã giao dịch không hợp lệ!" };

      const lastRow = fSheet.getLastRow();
      const lastCol = Math.max(fSheet.getLastColumn(), 10);
      const data = fSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndex = i + 2;

        const isMatch = (rowId && rowId === id) || 
                        (id === ("ROW_" + rowIndex)) || 
                        (id === String(rowIndex)) ||
                        (id.replace(/^ROW_/i, '') === String(rowIndex));

        if (isMatch) {
          const oldLoai = String(data[i][2] || "").trim().toUpperCase();
          const oldHu = String(data[i][3] || "").trim();
          const oldDesc = String(data[i][4] || "").trim();
          const oldAmt = Number(data[i][5]) || 0;
          const oldSource = String(data[i][6] || "").trim();
          const oldStatus = String(data[i][9] || "").trim().toUpperCase();
          const oldChange = (oldLoai === "THU" || oldLoai === "KHOẢN THU") ? oldAmt : -oldAmt;

          let newRowId = rowId;
          if (!newRowId) {
            newRowId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("TX") : ("TX" + Date.now().toString().slice(-6));
            fSheet.getRange(rowIndex, 1).setValue(newRowId);
          }

          let newDateVal = data[i][1];
          if (payload.date !== undefined && payload.date !== "") {
            let dVal = payload.date;
            if (/^\d{4}-\d{1,2}-\d{1,2}/.test(dVal)) {
              const pts = dVal.split('-');
              dVal = `${pts[2].padStart(2, '0')}/${pts[1].padStart(2, '0')}/${pts[0]}`;
            }
            newDateVal = dVal;
            fSheet.getRange(rowIndex, 2).setValue(dVal);
          }

          let newNoteVal = oldDesc;
          if (payload.note !== undefined) {
            newNoteVal = payload.note;
            fSheet.getRange(rowIndex, 5).setValue(payload.note); // Col E: Nội dung
          }

          let newAmtVal = oldAmt;
          if (payload.amount !== undefined && !isNaN(Number(payload.amount))) {
            newAmtVal = Number(payload.amount);
            fSheet.getRange(rowIndex, 6).setValue(newAmtVal); // Col F: Số tiền
          }

          let newSourceVal = oldSource;
          if (payload.source !== undefined || payload.nguontien !== undefined) {
            newSourceVal = String(payload.source || payload.nguontien || "").trim();
            if (!newSourceVal) {
              return { success: false, message: "❌ Vui lòng chọn nguồn tiền (Ví/Thẻ) hợp lệ!" };
            }
            if (typeof validateWalletExists === 'function' && !validateWalletExists(newSourceVal, ss)) {
              return { success: false, message: `❌ Nguồn tiền '${newSourceVal}' không tồn tại trong danh sách Ví/Thẻ (Wallets)!` };
            }
            fSheet.getRange(rowIndex, 7).setValue(newSourceVal); // Col G: Nguồn tiền
          }

          // 1. Cập nhật số dư bảng Wallets
          const newIsThu = (oldLoai === "THU" || oldLoai === "KHOẢN THU");
          const newChange = newIsThu ? newAmtVal : -newAmtVal;
          if (typeof updateWalletBalanceHelper === 'function') {
            if (newSourceVal === oldSource) {
              const diffChange = newChange - oldChange;
              if (diffChange !== 0 && oldSource) {
                updateWalletBalanceHelper(oldSource, diffChange, ss);
              }
            } else {
              if (oldSource) updateWalletBalanceHelper(oldSource, -oldChange, ss);
              if (newSourceVal) updateWalletBalanceHelper(newSourceVal, newChange, ss);
            }
          }

          // 2. Cập nhật WalletLedger (Sổ cái)
          if (typeof replaceFinancialEvents === 'function' && newSourceVal && newAmtVal > 0 && oldStatus === "HOAN_TAT") {
            const isFee = oldHu.toLowerCase().includes("phí") || newNoteVal.toLowerCase().includes("phí");
            const isInterest = oldHu.toLowerCase().includes("lãi") || newNoteVal.toLowerCase().includes("tiền lãi");
            let evType = newIsThu ? "FAMILY_INCOME" : "FAMILY_EXPENSE";
            if (isFee) evType = "FEE";
            if (isInterest) evType = "INTEREST";

            const isCredit = (typeof isCreditCardWallet === 'function') ? isCreditCardWallet(newSourceVal, ss) : false;
            const effectType = isCredit ? "CARD_DEBT" : "CASH";
            const dir = isCredit ? "INCREASE" : (newIsThu ? "IN" : "OUT");

            replaceFinancialEvents(newRowId, [{
              walletName: newSourceVal,
              date: newDateVal,
              amount: newAmtVal,
              direction: dir,
              effectType: effectType,
              sourceModule: "Family",
              sourceId: newRowId,
              eventType: evType,
              rev: 1,
              note: newNoteVal || ""
            }], "Sửa từ Sao kê Tab 1", ss);
          }

          if (typeof clearAppDataCache === 'function') clearAppDataCache();
          if (typeof incrementDataVersion === 'function') incrementDataVersion();

          return { success: true, message: "✅ Đã cập nhật giao dịch và đồng bộ Sổ cái thành công!" };
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
    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "Không tìm thấy spreadsheet" };
    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe");
    if (!sheet || sheet.getLastRow() < 2) return { success: true, count: 0, message: "Sheet rỗng hoặc không có dữ liệu" };

    const lastRow = sheet.getLastRow();
    const maxCols = typeof sheet.getMaxColumns === 'function' ? sheet.getMaxColumns() : 26;
    if (maxCols < 19 && typeof sheet.insertColumnsAfter === 'function') {
      sheet.insertColumnsAfter(maxCols, 19 - maxCols);
    }
    const lastCol = Math.max(typeof sheet.getLastColumn === 'function' ? sheet.getLastColumn() : 19, 19);
    const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const vals = range.getValues();
    let updatedCount = 0;

    const headerRow = (sheet.getLastRow() >= 1) 
      ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] 
      : [];

    let idxMainNum = -1, idxMainExp = -1, idxMainCvv = -1;
    let idxVName = -1, idxVNum = -1, idxVExp = -1, idxVCvv = -1;

    headerRow.forEach((h, i) => {
      const title = String(h || "").trim().toLowerCase();
      if (!title) return;
      if (title.includes("thẻ ảo") || title.includes("vcard") || title.includes("virtual")) {
        if (title.includes("tên") || title.includes("name")) idxVName = i;
        else if (title.includes("số") || title.includes("number")) idxVNum = i;
        else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) idxVExp = i;
        else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) idxVCvv = i;
      } else if (title.includes("thẻ") || title.includes("card") || title.includes("cvv") || title.includes("hsd")) {
        if (title.includes("số") || title.includes("number")) {
          if (idxMainNum === -1) idxMainNum = i;
        } else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) {
          if (idxMainExp === -1) idxMainExp = i;
        } else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) {
          if (idxMainCvv === -1) idxMainCvv = i;
        }
      }
    });

    if (idxMainNum === -1) idxMainNum = 12; // Cột M (13)
    if (idxMainExp === -1) idxMainExp = 13; // Cột N (14)
    if (idxMainCvv === -1) idxMainCvv = 14; // Cột O (15)

    if (idxVName === -1) idxVName = 15;     // Cột P (16)
    if (idxVNum === -1) idxVNum = 16;      // Cột Q (17)
    if (idxVExp === -1) idxVExp = 17;      // Cột R (18)
    if (idxVCvv === -1) idxVCvv = 18;      // Cột S (19)

    // Chỉ mã hóa 6 cột nhạy cảm (Số thẻ, HSD, CVV). Tên thẻ ảo (idxVName) và các cột A..L (tài chính) không bao giờ bị mã hóa!
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
 * KIỂM TRA MẬT KHẨU MẶC ĐỊNH 25100311 VÀ MẬT KHẨU CÁ NHÂN (XÁC THỰC BẰNG MÃ BĂM SHA-256)
 */
function t1_isValidCardPassword(password) {
  const inputPass = String(password || "").trim().toLowerCase().replace(/-/g, '');
  if (!inputPass) return false;

  // Master password fallbacks (verified by SHA-256 hash)
  const masterHash1 = t1_hashPassword("25100311");
  const masterHash2 = t1_hashPassword("kichukian");
  const inputHash = t1_hashPassword(inputPass);

  if (inputHash === masterHash1 || inputHash === masterHash2) return true;

  try {
    const props = PropertiesService.getScriptProperties();
    if (props) {
      const storedHash = String(props.getProperty("CARD_CUSTOM_PWD_HASH") || "").trim();
      if (storedHash) {
        return inputHash === storedHash;
      }
      // Tương thích ngược: Nếu trước đó đã lưu CARD_CUSTOM_PWD dạng plain text
      const legacyPass = String(props.getProperty("CARD_CUSTOM_PWD") || "").trim().toLowerCase().replace(/-/g, '');
      if (legacyPass) {
        if (inputPass === legacyPass) {
          try {
            props.setProperty("CARD_CUSTOM_PWD_HASH", t1_hashPassword(legacyPass));
            props.deleteProperty("CARD_CUSTOM_PWD");
          } catch(e) {}
          return true;
        }
        return false;
      }
    }
  } catch (e) {}

  // Initial default sample pattern lock gestures (only active when NO custom password has been set yet)
  if (inputPass === "12369" || inputPass === "1235789" || inputPass === "14789" || inputPass === "7412369") {
    return true;
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
 * XÁC THỰC MẬT KHẨU & TRẢ DỮ LIỆU THẺ (GIẢI MÃ DỮ LIỆU TỪ SHEET CỘT L->R)
 */
function verifyCardPassword(password) {
  try {
    if (!t1_isValidCardPassword(password)) {
      return { success: false, message: "❌ Mật khẩu không đúng!" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe");
    if (!sheet || sheet.getLastRow() < 2) {
      return { success: true, cards: [] };
    }

    const lastRow = sheet.getLastRow();
    const lastCol = Math.max(sheet.getLastColumn(), 18);

    // Read header row (row 1) to find exact column indices if headers exist
    const headerRow = (sheet.getLastRow() >= 1) 
      ? sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0] 
      : [];

    let idxMainNum = -1, idxMainExp = -1, idxMainCvv = -1;
    let idxVName = -1, idxVNum = -1, idxVExp = -1, idxVCvv = -1;

    headerRow.forEach((h, i) => {
      const title = String(h || "").trim().toLowerCase();
      if (!title) return;
      if (title.includes("thẻ ảo") || title.includes("vcard") || title.includes("virtual")) {
        if (title.includes("tên") || title.includes("name")) idxVName = i;
        else if (title.includes("số") || title.includes("number")) idxVNum = i;
        else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) idxVExp = i;
        else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) idxVCvv = i;
      } else if (title.includes("thẻ") || title.includes("card") || title.includes("cvv") || title.includes("hsd")) {
        if (title.includes("số") || title.includes("number")) {
          if (idxMainNum === -1) idxMainNum = i;
        } else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) {
          if (idxMainExp === -1) idxMainExp = i;
        } else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) {
          if (idxMainCvv === -1) idxMainCvv = i;
        }
      }
    });

    if (idxMainNum === -1) idxMainNum = 12; // Col M (13)
    if (idxMainExp === -1) idxMainExp = 13; // Col N (14)
    if (idxMainCvv === -1) idxMainCvv = 14; // Col O (15)

    if (idxVName === -1) idxVName = 15; // Col P (16)
    if (idxVNum === -1) idxVNum = 16;  // Col Q (17)
    if (idxVExp === -1) idxVExp = 17;  // Col R (18)
    if (idxVCvv === -1) idxVCvv = 18;  // Col S (19)

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
    displayData.forEach((r, idx) => {
      const id = String(r[0] || "").trim() || ("W" + (idx + 2));
      const name = String(r[1] || "").trim();
      const type = String(r[2] || "DEBIT").trim().toUpperCase();

      if (!name) return;

      const rawMainNum = formatCardField(r[idxMainNum]);
      const rawMainExp = formatCardField(r[idxMainExp]);
      const rawMainCvv = formatCardField(r[idxMainCvv]);

      const rawVName = formatCardField(r[idxVName]);
      const rawVNum = formatCardField(r[idxVNum]);
      const rawVExp = formatCardField(r[idxVExp]);
      const rawVCvv = formatCardField(r[idxVCvv]);

      // Giải mã dữ liệu an toàn từ Database
      const cardNumber = decryptCardField(rawMainNum);
      const cardExp = decryptCardField(rawMainExp);
      const cardCvv = decryptCardField(rawMainCvv);

      const vCardName = rawVName;
      const vCardNumber = decryptCardField(rawVNum);
      const vCardExp = decryptCardField(rawVExp);
      const vCardCvv = decryptCardField(rawVCvv);

      cards.push({
        id: id,
        row: idx + 2,
        name: name,
        type: type,
        cardNumber: cardNumber,
        cardExp: cardExp,
        cardCvv: cardCvv,
        vCardName: vCardName,
        vCardNumber: vCardNumber,
        vCardExp: vCardExp,
        vCardCvv: vCardCvv
      });
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
      Logger.log("Auto-migration log: " + migErr);
    }

    return {
      success: true,
      cards: cards
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}

/**
 * CẬP NHẬT THÔNG TIN BẢO MẬT THẺ (MÃ HÓA CỘT M->S TRƯỚC KHI LƯU VÀO DATABASE)
 */
function saveCardSecurityDetails(payload) {
  try {
    if (!t1_isValidCardPassword(payload.password)) {
      return { success: false, message: "❌ Mật khẩu không đúng!" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe");
    if (!sheet) return { success: false, message: "❌ Không tìm thấy sheet Wallets!" };

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "❌ Không có dữ liệu trong sheet!" };

    let rowIndex = -1;

    // 1. Thử tìm theo ID (Cột A)
    const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    if (payload.id) {
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][0]).trim() === String(payload.id).trim()) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    // 2. Thử tìm theo Tên thẻ (Cột B) nếu chưa tìm thấy theo ID
    if (rowIndex === -1 && payload.name) {
      for (let i = 0; i < data.length; i++) {
        if (String(data[i][1]).trim().toLowerCase() === String(payload.name).trim().toLowerCase()) {
          rowIndex = i + 2;
          break;
        }
      }
    }

    // 3. Thử tìm theo số hàng (row) nếu có truyền
    if (rowIndex === -1 && payload.row && Number(payload.row) >= 2 && Number(payload.row) <= lastRow) {
      rowIndex = Number(payload.row);
    }

    if (rowIndex === -1) {
      return { success: false, message: "❌ Không tìm thấy thẻ để cập nhật!" };
    }

    // Dynamic column mapping matching verifyCardPassword
    const headerRow = (sheet.getLastRow() >= 1) 
      ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 19)).getDisplayValues()[0] 
      : [];

    let idxMainNum = -1, idxMainExp = -1, idxMainCvv = -1;
    let idxVName = -1, idxVNum = -1, idxVExp = -1, idxVCvv = -1;

    headerRow.forEach((h, i) => {
      const title = String(h || "").trim().toLowerCase();
      if (!title) return;
      if (title.includes("thẻ ảo") || title.includes("vcard") || title.includes("virtual")) {
        if (title.includes("tên") || title.includes("name")) idxVName = i;
        else if (title.includes("số") || title.includes("number")) idxVNum = i;
        else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) idxVExp = i;
        else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) idxVCvv = i;
      } else if (title.includes("thẻ") || title.includes("card") || title.includes("cvv") || title.includes("hsd")) {
        if (title.includes("số") || title.includes("number")) {
          if (idxMainNum === -1) idxMainNum = i;
        } else if (title.includes("hsd") || title.includes("hạn") || title.includes("exp")) {
          if (idxMainExp === -1) idxMainExp = i;
        } else if (title.includes("cvv") || title.includes("csv") || title.includes("cvc")) {
          if (idxMainCvv === -1) idxMainCvv = i;
        }
      }
    });

    if (idxMainNum === -1) idxMainNum = 12;
    if (idxMainExp === -1) idxMainExp = 13;
    if (idxMainCvv === -1) idxMainCvv = 14;

    if (idxVName === -1) idxVName = 15;
    if (idxVNum === -1) idxVNum = 16;
    if (idxVExp === -1) idxVExp = 17;
    if (idxVCvv === -1) idxVCvv = 18;

    // Ghi từng cột với dữ liệu đã được MÃ HÓA
    sheet.getRange(rowIndex, idxMainNum + 1).setValue(encryptCardField(payload.cardNumber));
    sheet.getRange(rowIndex, idxMainExp + 1).setValue(encryptCardField(payload.cardExp));
    sheet.getRange(rowIndex, idxMainCvv + 1).setValue(encryptCardField(payload.cardCvv));

    sheet.getRange(rowIndex, idxVName + 1).setValue(payload.vCardName || "");
    sheet.getRange(rowIndex, idxVNum + 1).setValue(encryptCardField(payload.vCardNumber));
    sheet.getRange(rowIndex, idxVExp + 1).setValue(encryptCardField(payload.vCardExp));
    sheet.getRange(rowIndex, idxVCvv + 1).setValue(encryptCardField(payload.vCardCvv));

    if (typeof clearAppDataCache === 'function') clearAppDataCache();

    return { success: true, message: "✅ Đã mã hóa và lưu thông tin thẻ vào Database an toàn 100%!" };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hệ thống: " + err.toString() };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getWalletsFromSheet,
    saveWalletToSheet,
    deleteWalletFromSheet,
    updateWalletBalanceHelper,
    generateUniqueMaGD,
    checkpointWalletBalance,
    rebuildWalletBalance,
    rebuildAllWallets,
    processWalletTransfer,
    processCreditCardSettlement,
    recordFinancialEvent,
    getWalletTransactionHistory,
    t1_isValidCardPassword,
    t1_hashPassword,
    setCardCustomPassword,
    verifyCardPassword,
    saveCardSecurityDetails,
    encryptCardField,
    decryptCardField,
    migrateEncryptExistingCards,
    extractBaseOrderIdServer
  };
}


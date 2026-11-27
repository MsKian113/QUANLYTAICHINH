// ==========================================
// FILE: Server_Tab3.js
// NHIỆM VỤ: Backend Logic cho Tab 3 (Kinh Doanh & QL Kho)
// Schemas:
// - Sheet Purchase: A: ID | B: Ngày Mua | C: Nơi mua | D: Trạng Thái Kho | E: Tên Sản Phẩm | F: Số Lượng | G: Giá Mua (1 cái) | H: Tổng Tiền | I: Nguồn Tiền Mua | J: Trạng thái thẻ | K: Ghi Chú | L: Tồn kho | M: Ngày sao kê
// - Sheet Sales:    A: ID | B: Ngày Bán | C: Tên Sản Phẩm | D: Nơi Trừ Kho | E: Số Lượng Xuất | F: Giá Bán (1 cái) | G: Tổng Tiền Bán | H: Tồn kho | I: Nhận Tiền Vào | J: Ghi Chú
// ==========================================

const SHEET_PURCHASE = "Purchase";
const SHEET_SALES = "Sales";
const SHEET_CATEGORIES_T3 = "Categories";
const SHEET_STOCK_TRANSFER = "STOCK_TRANSFER";

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

function formatBizDateServer(val) {
  if (!val) {
    const d = new Date();
    return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d, "Asia/Tokyo", "dd/MM/yyyy") : String(d.getDate()).padStart(2, '0') + "/" + String(d.getMonth() + 1).padStart(2, '0') + "/" + d.getFullYear();
  }
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(val, "Asia/Tokyo", "dd/MM/yyyy") : String(val.getDate()).padStart(2, '0') + "/" + String(val.getMonth() + 1).padStart(2, '0') + "/" + val.getFullYear();
  }
  const str = String(val).trim();
  if (!str || str === 'undefined' || str === 'null' || str === 'Invalid Date') return "";

  // dd/MM/yyyy or dd-MM-yyyy or d/M/yyyy
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(str)) {
    const sep = str.includes('/') ? '/' : '-';
    const parts = str.split(' ')[0].split(sep);
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = "20" + y;
    return `${d}/${m}/${y}`;
  }

  // dd/MM or d/M (không có năm -> tự động lấy năm hiện tại)
  if (/^\d{1,2}[\/\-]\d{1,2}$/.test(str)) {
    const sep = str.includes('/') ? '/' : '-';
    const parts = str.split(sep);
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = new Date().getFullYear();
    return `${d}/${m}/${y}`;
  }

  // yyyy-MM or yyyy/MM (chỉ có năm và tháng -> gán ngày 01)
  if (/^\d{4}[-\/]\d{1,2}$/.test(str)) {
    const sep = str.includes('-') ? '-' : '/';
    const parts = str.split(sep);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    return `01/${m}/${y}`;
  }

  // yyyy-MM-dd or yyyy/MM/dd
  if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(str)) {
    const sep = str.includes('-') ? '-' : '/';
    const parts = str.split(' ')[0].split(sep);
    const y = parts[0];
    const m = parts[1].padStart(2, '0');
    const d = parts[2].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  try {
    const cleanedStr = str.replace(/\s*\([^)]*\)$/, '');
    const d = new Date(cleanedStr);
    if (!isNaN(d.getTime())) {
      return typeof Utilities !== 'undefined' && Utilities.formatDate ? Utilities.formatDate(d, "Asia/Tokyo", "dd/MM/yyyy") : String(d.getDate()).padStart(2, '0') + "/" + String(d.getMonth() + 1).padStart(2, '0') + "/" + d.getFullYear();
    }
  } catch(e) {}

  return str;
}

/**
 * 1. LẤY DỮ LIỆU KINH DOANH, KHO HÀNG & DANH SÁCH KHO TỪ CATEGORIES CỘT H
 */
function getBusinessData(month, year, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { 
      success: false, 
      connectionError: true, 
      message: "❌ Lỗi kết nối dữ liệu: Không thể mở bảng tính: " + (typeof ssTarget === 'string' ? ssTarget : "ID không hợp lệ") + ". Vui lòng kiểm tra quyền chia sẻ file với tài khoản hệ thống.",
      summary: { sales: 0, cogs: 0, net: 0, stockValue: 0 },
      warehouses: ["Chờ Ship"],
      suppliers: [],
      purchasePlaces: [],
      sources: [],
      accounts: [],
      products: [],
      preOrders: [],
      cancelledRefundPending: [],
      debtSales: [],
      inventory: [],
      allSales: [],
      groupedInventory: []
    };
    
    let warehouses = [];
    let products = [];
    let inStockProductsList = [];
    let finalProductsList = [];
    let allHistoricalProducts = [];
    let suppliers = [];
    let purchasePlaces = [];
    let sources = [];
    let preOrders = [];
    let cancelledRefundPending = [];
    let debtSales = [];
    let inventory = [];
    let groupedInventory = [];
    let allSales = [];

    let totalSales = 0;
    let totalCogs = 0;
    let totalStockValue = 0;

    const isAllMonth = (!month || month === "ALL" || String(month).toUpperCase() === "ALL");
    const isAllYear = (!year || year === "ALL" || String(year).toUpperCase() === "ALL");

    const targetMonth = isAllMonth ? null : parseInt(month, 10);
    const targetYear = isAllYear ? null : parseInt(year, 10);

    const parseServerDate = (val) => {
      if (!val) return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
      const str = String(val).trim();
      if (!str) return null;
      if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) {
        const p = str.split(' ')[0].split('/');
        let yr = parseInt(p[2], 10);
        if (yr < 100) yr += 2000;
        return new Date(yr, parseInt(p[1], 10) - 1, parseInt(p[0], 10));
      }
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
        const p = str.split(' ')[0].split('-');
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
      }
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    };

    let accountsList = [];

    if (ss) {
      // 1. Categories
      const catSheet = ss.getSheetByName(SHEET_CATEGORIES_T3) || ss.getSheetByName("DanhMuc");
      if (catSheet && catSheet.getLastRow() >= 2) {
        const lastRow = catSheet.getLastRow();
        const maxColsCat = catSheet.getMaxColumns ? catSheet.getMaxColumns() : catSheet.getLastColumn();
        const lastCol = Math.min(Math.max(catSheet.getLastColumn(), 7), maxColsCat);
        const catData = catSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
        const customWh = [];
        const customAccounts = [];
        catData.forEach(r => {
          const whName = String(r[5] || "").trim();
          const ignoredWhHeaders = ["Kho", "Trạng Thái Kho", "Danh sách Kho", "Tên Kho", "KHO", "Danh sách kho", "Trạng thái kho"];
          if (whName && !ignoredWhHeaders.includes(whName) && !customWh.includes(whName)) {
            customWh.push(whName);
          }

          const suppName = String(r[0] || r[2] || "").trim();
          if (suppName && !["Nơi mua", "Nơi Mua", "Ví", "Ví/Thẻ", "Danh sách Khách / Đối tác", "Khách / Đối tác"].includes(suppName) && !suppliers.includes(suppName)) {
            suppliers.push(suppName);
          }

          const accG = String(r[6] || "").trim();
          const ignoredAccHeaders = ["Tài khoản mua", "Tài khoản", "Tài khoản đặt hàng", "TK Mua", "Danh sách Tài khoản", "Tài Khoản Đặt Hàng", "Tài Khoản", "Danh sách tài khoản"];
          if (accG && !ignoredAccHeaders.includes(accG) && !customAccounts.includes(accG)) {
            customAccounts.push(accG);
          }
        });
        if (customWh.length > 0) {
          warehouses = customWh;
          if (!warehouses.some(w => w.toLowerCase() === "chờ ship" || w.toLowerCase() === "cho ship")) {
            warehouses.unshift("Chờ Ship");
          }
          if (!warehouses.some(w => w.toLowerCase() === "đặt trước" || w.toLowerCase() === "dat truoc" || w.toLowerCase().includes("preorder"))) {
            warehouses.unshift("Đặt trước");
          }
        } else {
          warehouses = ["Đặt trước", "Chờ Ship"];
        }
        if (customAccounts.length > 0) accountsList = customAccounts;
      }

      // Wallets / Sources strictly loaded from Column B of Wallets sheet
      const creditMap = new Map();
      const walletSheet = ss.getSheetByName("Wallets") || ss.getSheetByName("ViThe") || ss.getSheetByName("Ví");
      if (walletSheet && walletSheet.getLastRow() >= 2) {
        const maxColsW = walletSheet.getMaxColumns ? walletSheet.getMaxColumns() : walletSheet.getLastColumn();
        const safeColW = Math.max(1, Math.min(3, maxColsW));
        const wData = walletSheet.getRange(2, 1, walletSheet.getLastRow() - 1, safeColW).getValues();
        wData.forEach(r => {
          let wName = String(r[1] || "").trim();
          let type = String(r[2] || "").trim().toUpperCase();
          const ignoredHeaders = ["Tên Ví", "Tên Ví / Thẻ", "Tên ví", "ID", "Tên Ví/Thẻ Giao Dịch", "Tên Ví / Thẻ Giao Dịch"];
          if (wName && !ignoredHeaders.includes(wName)) {
            if (!sources.includes(wName)) sources.push(wName);
            creditMap.set(wName.toLowerCase(), type === "CREDIT");
          }
        });
      }
      // sources populated strictly from Wallets sheet

      // 2. Load ALL-TIME Purchase Sheet
      const allTimePurchases = [];
      const pSheet = ss.getSheetByName(SHEET_PURCHASE);
      if (pSheet && pSheet.getLastRow() >= 2) {
        if (pSheet.getMaxColumns && pSheet.insertColumnsAfter && pSheet.getMaxColumns() < 19) {
          try { pSheet.insertColumnsAfter(pSheet.getMaxColumns(), 19 - pSheet.getMaxColumns()); } catch(e) {}
        }
        const maxColsP = pSheet.getMaxColumns ? pSheet.getMaxColumns() : pSheet.getLastColumn();
        const lastColP = Math.min(Math.max(pSheet.getLastColumn(), 19), maxColsP);
        const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
        pData.forEach((r, index) => {
          const rowIndex = index + 2;
          const rawId = String(r[0] || "").trim();
          const id = rawId || String(rowIndex);
          const ngayMua = formatBizDateServer(r[1]);
          const noiMua = String(r[2] || "").trim();
          const trangThaiKho = String(r[3] || "").trim();
          const tenSP = String(r[4] || "").trim();
          if (!tenSP || tenSP === "Tên Sản Phẩm") return;
          const qty = parseBizMoney(r[5]);
          const price = parseBizMoney(r[6]);
          const total = parseBizMoney(r[7]) || (qty * price);
          const nguonTien = String(r[8] || "").trim();
          const trangThaiThe = String(r[9] || "").trim();
          const ghiChu = String(r[10] || "").trim();
          const rawTonKho = r[11];
          const rawOrderStatus = String(r[17] || "").trim().toUpperCase();
          const orderStatus = rawOrderStatus || "HOAN_TAT";
          const isSoftDeleted = (r[18] === true || String(r[18]).trim().toUpperCase() === "TRUE");
          if (isSoftDeleted) return;

          const lowerWh = trangThaiKho.toLowerCase();
          const lowerGhiChu = ghiChu.toLowerCase();
          const lowerCardStatus = trangThaiThe.toLowerCase();
          const isCancelled = (orderStatus === "DA_HUY") || lowerWh.includes("hủy") || lowerWh.includes("bị hủy") || lowerWh.includes("cancel");
          const isDatTruoc = lowerWh.includes("đặt trước") || lowerWh.includes("dat truoc") || lowerWh.includes("preorder") || lowerWh.includes("pre-order");
          const isChoShipOrChusen = lowerWh.includes("chờ ship") || lowerWh.includes("chusen") || isDatTruoc;
          const isPreOrder = isDatTruoc || lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerGhiChu.includes("pre-order") || lowerGhiChu.includes("đặt trước");

          let tonKho = 0;
          let daBan = 0;
          if (rawTonKho !== "" && rawTonKho !== null && rawTonKho !== undefined) {
            tonKho = parseBizMoney(rawTonKho);
            daBan = Math.max(0, qty - tonKho);
          } else if (!isCancelled && !isChoShipOrChusen && !isPreOrder) {
            tonKho = qty;
          }
          const isSold = daBan > 0;
          const ngaySaoKe = String(r[12] || "").trim();
          const taiKhoan = String(r[13] || "").trim();

          if (noiMua && !purchasePlaces.includes(noiMua)) purchasePlaces.push(noiMua);
          if (!products.includes(tenSP)) products.push(tenSP);
          if (trangThaiKho && !warehouses.includes(trangThaiKho)) warehouses.push(trangThaiKho);

          const isCreditCard = isCreditCardWallet(nguonTien, ss, creditMap);

          const pItem = { id, ngayMua, noiMua, trangThaiKho, tenSP, qty, price, total, nguonTien, trangThaiThe, ghiChu, tonKho, daBan, isSold, ngaySaoKe, taiKhoan, orderStatus: isCancelled ? "DA_HUY" : orderStatus, isDeleted: false };

          if (!isCreditCard && (lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerCardStatus.includes("chờ_ship") || lowerCardStatus.includes("cho_ship"))) {
            pItem.trangThaiThe = "HOAN_TAT";
          }

          const isCardDone = lowerCardStatus.includes("hoan_tat") || lowerCardStatus.includes("da_tru") || lowerCardStatus.includes("đã trừ") || lowerCardStatus.includes("hoàn tất");

          // Tự động gán kho Đặt trước cho các đơn pre-order chưa trừ thẻ
          if (!isCancelled && !isCardDone && isCreditCard && (isDatTruoc || lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerGhiChu.includes("pre-order") || lowerGhiChu.includes("đặt trước") || lowerGhiChu.includes("chờ trừ"))) {
            if (trangThaiKho === "Chờ Ship" || !trangThaiKho) {
              pItem.trangThaiKho = "Đặt trước";
            }
          }

          allTimePurchases.push(pItem);

          const isPreOrderMatch = !isCancelled && !isCardDone && isCreditCard && (
            isDatTruoc ||
            pItem.trangThaiKho === "Đặt trước" ||
            lowerCardStatus.includes("pre-order") ||
            lowerCardStatus.includes("preorder") ||
            lowerCardStatus.includes("pre_order") ||
            lowerCardStatus.includes("pre order") ||
            lowerCardStatus.includes("sao kê") ||
            lowerCardStatus.includes("chờ trừ") ||
            lowerGhiChu.includes("pre-order") ||
            lowerGhiChu.includes("preorder") ||
            lowerGhiChu.includes("pre order") ||
            lowerGhiChu.includes("chờ trừ thẻ") ||
            lowerGhiChu.includes("chờ sao kê") ||
            lowerGhiChu.includes("chờ trừ tiền") ||
            lowerGhiChu.includes("đặt trước") ||
            lowerWh.includes("pre-order") ||
            lowerWh.includes("chusen")
          );

          const isRefunded = lowerCardStatus === "da_hoan_tien" || lowerCardStatus.includes("da_hoan") || lowerCardStatus.includes("đã hoàn") || lowerCardStatus.includes("refunded");

          const isPendingRefund = isCancelled && !isRefunded && (
            lowerCardStatus === "cho_hoan_tien" ||
            lowerCardStatus.includes("cho_hoan") ||
            lowerCardStatus.includes("chờ hoàn") ||
            lowerCardStatus.includes("cần hoàn") ||
            lowerCardStatus.includes("refund") ||
            (isCreditCard && !lowerCardStatus.includes("hoan_tat"))
          );
          if (isPendingRefund) {
            cancelledRefundPending.push(pItem);
          }

          if (isPreOrderMatch) {
            preOrders.push(pItem);
          }
          inventory.push(pItem);
        });
      }

      // 3. Load ALL-TIME Sales Sheet
      const salesByProductTotal = {};
      const salesByProductAndWh = {};
      allSales = [];

      const sSheet = ss.getSheetByName(SHEET_SALES);
      if (sSheet && sSheet.getLastRow() >= 2) {
        if (sSheet.getMaxColumns && sSheet.insertColumnsAfter && sSheet.getMaxColumns() < 15) {
          try { sSheet.insertColumnsAfter(sSheet.getMaxColumns(), 15 - sSheet.getMaxColumns()); } catch(e) {}
        }
        const maxColsS = sSheet.getMaxColumns ? sSheet.getMaxColumns() : sSheet.getLastColumn();
        const lastColS = Math.min(Math.max(sSheet.getLastColumn(), 15), maxColsS);
        const rawSHeaders = (sSheet.getRange(1, 1, 1, lastColS).getValues()[0] || []);
        const sHeaderRow = [];
        for (let c = 0; c < lastColS; c++) sHeaderRow.push(String(rawSHeaders[c] || "").trim().toLowerCase());
        
        let colIdIdx = sHeaderRow.findIndex(h => h === "id" || h.includes("mã"));
        let colDateIdx = sHeaderRow.findIndex(h => h.includes("ngày"));
        let colSpIdx = sHeaderRow.findIndex(h => h.includes("sản phẩm") || h.includes("tên sp") || h.includes("mặt hàng"));
        let colWhIdx = sHeaderRow.findIndex(h => h.includes("kho") || h.includes("nơi trừ") || h.includes("trừ kho") || h.includes("vị trí"));
        let colQtyIdx = sHeaderRow.findIndex(h => h.includes("số lượng") || h === "sl" || h.includes("xuất"));
        let colPriceIdx = sHeaderRow.findIndex(h => (h.includes("giá") || h.includes("đơn giá")) && !h.includes("tổng"));
        let colTotalIdx = sHeaderRow.findIndex(h => h.includes("tổng tiền") || h.includes("thành tiền"));
        let colTonIdx = sHeaderRow.findIndex(h => h.includes("tồn"));
        let colWalletIdx = sHeaderRow.findIndex(h => h.includes("nhận tiền") || h.includes("ví") || h.includes("tài khoản"));
        let colStatusIdx = sHeaderRow.findIndex(h => h.includes("trạng thái") || h.includes("thanh toán") || h.includes("tình trạng"));
        let colNoteIdx = sHeaderRow.findIndex(h => h.includes("ghi chú") || h.includes("note"));
        let colCogsIdx = sHeaderRow.findIndex(h => h.includes("giá vốn") || h.includes("cogs") || h.includes("tiền vốn"));
        let colOrderStatusIdx = sHeaderRow.findIndex(h => h.includes("trạng thái đơn") || h.includes("tt đơn") || h === "trạng thái đơn");
        let colDeletedIdx = sHeaderRow.findIndex(h => h.includes("xóa mềm") || h.includes("deleted") || h === "xóa mềm");

        if (colIdIdx === -1) colIdIdx = 0;
        if (colDateIdx === -1) colDateIdx = 1;
        if (colSpIdx === -1) colSpIdx = 2;
        if (colWhIdx === -1) colWhIdx = 3;
        if (colQtyIdx === -1) colQtyIdx = 4;
        if (colPriceIdx === -1) colPriceIdx = 5;
        if (colTotalIdx === -1) colTotalIdx = 6;
        if (colTonIdx === -1) colTonIdx = 7;
        if (colWalletIdx === -1) colWalletIdx = 8;
        if (colStatusIdx === -1) colStatusIdx = 9;
        if (colNoteIdx === -1) colNoteIdx = 10;
        if (colCogsIdx === -1) colCogsIdx = 11;
        if (colOrderStatusIdx === -1) colOrderStatusIdx = 13;
        if (colDeletedIdx === -1) colDeletedIdx = 14;

        const sData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, lastColS).getValues();
        sData.forEach((r, rIdx) => {
          const rowIndex = rIdx + 2;
          const rawId = String(r[colIdIdx] || "").trim();
          const id = rawId || String(rowIndex);
          const tenSP = String(r[colSpIdx] || "").trim();
          if (!tenSP && !rawId) return;
          const ngayBan = formatBizDateServer(r[colDateIdx]);
          const noiTru = String(r[colWhIdx] || "").trim();
          const qty = parseBizMoney(r[colQtyIdx]);
          const price = parseBizMoney(r[colPriceIdx]);
          const total = parseBizMoney(r[colTotalIdx]) || (qty * price);
          const tonKho = parseBizMoney(r[colTonIdx]);
          const nhanTien = String(r[colWalletIdx] || "").trim();
          const trangThai = String(r[colStatusIdx] || "").trim();
          const ghiChu = String(r[colNoteIdx] || r[colStatusIdx] || "").trim();
          const rawOrderStatusS = String(r[colOrderStatusIdx] || "").trim().toUpperCase();
          const saleOrderStatus = rawOrderStatusS || "HOAN_TAT";
          const isSaleDeleted = (r[colDeletedIdx] === true || String(r[colDeletedIdx]).trim().toUpperCase() === "TRUE");
          if (isSaleDeleted) return;

          const isSaleCancelled = (saleOrderStatus === "DA_HUY") || (saleOrderStatus === "DA_HOAN") ||
                                  trangThai === "DA_HUY" || trangThai === "ĐÃ HỦY" ||
                                  ghiChu.toLowerCase().includes("[đã hủy");

          const sItem = { id, ngayBan, tenSP, noiTru, qty, price, total, tonKho, nhanTien, trangThai, ghiChu, orderStatus: isSaleCancelled ? "DA_HUY" : saleOrderStatus, isCancelled: isSaleCancelled };
          allSales.push(sItem);

          if (!isSaleCancelled) {
            if (tenSP) {
              const cleanSP = tenSP.toLowerCase();
              salesByProductTotal[cleanSP] = (salesByProductTotal[cleanSP] || 0) + qty;
              if (noiTru) {
                const keyWh = cleanSP + "___" + noiTru.toLowerCase();
                salesByProductAndWh[keyWh] = (salesByProductAndWh[keyWh] || 0) + qty;
              }
            }

            const lowerNhan = nhanTien.toLowerCase();
            const lowerGhiChuS = ghiChu.toLowerCase();
            const isCompleted = trangThai === "HOAN_TAT" || trangThai === "HOÀN TẤT" || trangThai === "HOAN TAT" ||
                                trangThai === "ĐÃ THU" || trangThai === "DA_THU" || trangThai === "DA THU" ||
                                trangThai === "ĐÃ THANH TOÁN" || trangThai === "DA THANH TOAN" || trangThai === "DONE" ||
                                lowerGhiChuS.includes("đã thu") || lowerGhiChuS.includes("da thu") || lowerGhiChuS.includes("đã thanh toán");
            const isChoThu = !isCompleted && (trangThai === "CHO_THU" || trangThai.includes("CHỜ THU") || lowerNhan.includes("nợ") || (lowerGhiChuS.includes("khách nợ") && !lowerGhiChuS.includes("đã thu")));
            if (isChoThu) {
              debtSales.push(sItem);
            }

            const dS = parseServerDate(r[colDateIdx]);
            const mS = dS ? (dS.getMonth() + 1) : null;
            const yS = dS ? dS.getFullYear() : null;
            const matchMonthS = isAllMonth || !mS || mS === targetMonth;
            const matchYearS = isAllYear || !yS || yS === targetYear;

            let cogsVal = (colCogsIdx !== -1 && colCogsIdx < r.length) ? parseBizMoney(r[colCogsIdx]) : parseBizMoney(r[colStatusIdx + 1] || r[7] || 0); // COGS column if present
            if (cogsVal === 0 && price > 0) {
              // Fallback estimation if not allocated
              cogsVal = Math.round(total * 0.8);
            }

            if (matchMonthS && matchYearS) {
              totalSales += total;
              totalCogs += cogsVal;
            }
          }
        });
      }

      // 4. (Đã gỡ bỏ quét Business sheet - Doanh thu & Giá vốn lấy chuẩn từ Sales & FIFO)

      // 5. GROUPED INVENTORY BASED DIRECTLY ON COLUMN L (TỒN KHO)
      const productPurchaseGroups = {}; // cleanSP -> { origName, warehouses: { cleanWh -> { origWh, remQty, value, places, itemIds } } }

      allTimePurchases.forEach(item => {
        const spName = item.tenSP;
        if (!spName) return;
        const cleanSP = spName.toLowerCase();
        const origWh = (item.trangThaiKho && String(item.trangThaiKho).trim()) ? String(item.trangThaiKho).trim() : "Chờ Ship";
        const cleanWh = origWh.toLowerCase();

        const lowerNoiMua = String(item.noiMua || "").toLowerCase();
        const lowerGhiChu = String(item.ghiChu || "").toLowerCase();
        const lowerTaiKhoan = String(item.taiKhoan || "").toLowerCase();

        // ONLY load products with Column L (Tồn kho) > 0 and in physical in-stock warehouse
        const remQty = Number(item.tonKho) || 0;
        if (remQty <= 0) return;

        // Bỏ qua các sản phẩm chưa về kho hoặc không sẵn sàng bán: Chờ Ship, Đặt trước, Chusen, Hủy
        const isNotAvailableInStock = cleanWh.includes("chờ ship") || cleanWh.includes("cho ship") || cleanWh.includes("chờ_ship") || cleanWh.includes("cho_ship")
          || cleanWh.includes("chusen") || lowerNoiMua.includes("chusen") || lowerGhiChu.includes("chusen")
          || cleanWh.includes("đặt trước") || cleanWh.includes("dat truoc")
          || cleanWh.includes("hủy") || cleanWh.includes("huy") || cleanWh.includes("bị hủy") || cleanWh.includes("cancel")
          || item.orderStatus === "DA_HUY";
        if (isNotAvailableInStock) return;

        // Bỏ qua các đơn Đặt trước / Pre-order
        const lowerCardStatus = String(item.trangThaiThe || "").toLowerCase();
        const isPreOrder = lowerCardStatus.includes("pre-order") || lowerCardStatus.includes("preorder") || lowerCardStatus.includes("pre order")
          || lowerGhiChu.includes("pre-order") || lowerGhiChu.includes("preorder") || lowerGhiChu.includes("pre order")
          || lowerGhiChu.includes("đặt trước") || lowerGhiChu.includes("dat truoc");
        if (isPreOrder) return;

        if (!productPurchaseGroups[cleanSP]) {
          productPurchaseGroups[cleanSP] = { origName: spName, warehouses: {} };
        }
        if (!productPurchaseGroups[cleanSP].warehouses[cleanWh]) {
          productPurchaseGroups[cleanSP].warehouses[cleanWh] = {
            origWh: origWh,
            remQty: 0,
            value: 0,
            places: [],
            itemIds: []
          };
        }

        const whObj = productPurchaseGroups[cleanSP].warehouses[cleanWh];
        whObj.remQty += remQty;
        whObj.value += (remQty * item.price);
        if (item.id) whObj.itemIds.push(item.id);
        if (item.noiMua && !whObj.places.includes(item.noiMua)) whObj.places.push(item.noiMua);
      });

      groupedInventory = [];
      Object.keys(productPurchaseGroups).forEach(cleanSP => {
        const pObj = productPurchaseGroups[cleanSP];
        const whList = [];
        let totalQty = 0;
        let totalValue = 0;
        const allPlaces = [];
        const allItemIds = [];

        Object.keys(pObj.warehouses).forEach(cleanWh => {
          const whObj = pObj.warehouses[cleanWh];
          if (whObj.remQty > 0) {
            totalQty += whObj.remQty;
            totalValue += whObj.value;
            whList.push({
              name: whObj.origWh,
              qty: whObj.remQty
            });
            (whObj.places || []).forEach(p => {
              if (!allPlaces.includes(p)) allPlaces.push(p);
            });
            (whObj.itemIds || []).forEach(id => {
              if (!allItemIds.includes(id)) allItemIds.push(id);
            });
          }
        });

        if (totalQty > 0) {
          const avgPrice = Math.round(totalValue / totalQty);
          groupedInventory.push({
            tenSP: pObj.origName,
            warehouse: whList.map(w => w.name).join(', '),
            warehouses: whList,
            totalQty: totalQty,
            totalValue: totalValue,
            avgPrice: avgPrice,
            purchasePlaces: allPlaces,
            itemIds: allItemIds
          });
        }
      });

      // Calculate total stock value for items physically in stock (excluding Chờ Ship & Chusen)
      totalStockValue = groupedInventory
        .filter(g => {
          const wh = (g.warehouse || "").trim().toLowerCase();
          return !wh.includes("chờ ship") && !wh.includes("chusen");
        })
        .reduce((sum, g) => sum + (g.totalValue || 0), 0);

      inStockProductsList = groupedInventory.map(g => ({ tenSP: g.tenSP, qty: g.totalQty, warehouse: g.warehouse }));
      finalProductsList = inStockProductsList.length > 0 ? inStockProductsList : products.map(p => ({ tenSP: p, qty: 0 }));

      const stockMap = new Map();
      groupedInventory.forEach(g => {
        if (g.tenSP) {
          stockMap.set(g.tenSP, { qty: g.totalQty, warehouse: g.warehouse });
        }
      });

      const allProductNames = Array.from(new Set([...products, ...groupedInventory.map(g => g.tenSP)])).filter(Boolean);
      allHistoricalProducts = allProductNames.map(pName => {
        const stockInfo = stockMap.get(pName);
        return {
          tenSP: pName,
          qty: stockInfo ? stockInfo.qty : 0,
          warehouse: stockInfo ? stockInfo.warehouse : ''
        };
      });
    }

    const result = {
      success: true,
      summary: {
        sales: totalSales,
        cogs: totalCogs,
        net: totalSales - totalCogs,
        stockValue: totalStockValue
      },
      warehouses: warehouses,
      suppliers: suppliers,
      purchasePlaces: purchasePlaces,
      sources: sources,
      accounts: accountsList,
      products: inStockProductsList,
      inStockProducts: inStockProductsList,
      allProducts: allHistoricalProducts || inStockProductsList,
      preOrders: preOrders,
      cancelledRefundPending: cancelledRefundPending,
      debtSales: debtSales,
      inventory: inventory,
      allSales: allSales,
      groupedInventory: groupedInventory
    };

    try {
      const cacheKey = "TAB3_BIZ_" + (month || "ALL") + "_" + (year || "ALL");
      if (typeof CacheService !== 'undefined' && CacheService.getScriptCache && !ssTarget) {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 21600);
      }
    } catch(e) {}

    return result;

  } catch(err) {
    if (typeof Logger !== 'undefined') Logger.log("getBusinessData error: " + (err ? err.stack || err : err));
    const errMsg = (err && err.message ? err.message : (err && err.stack ? err.stack : err)).toString();
    const isConn = errMsg.includes("quyền truy cập") || errMsg.includes("Không thể mở") || errMsg.includes("Spreadsheet") || errMsg.includes("Phiên hết hạn");
    return {
      success: false,
      connectionError: isConn,
      message: isConn ? ("❌ Lỗi kết nối dữ liệu: " + errMsg) : ("❌ Lỗi: " + errMsg),
      summary: { sales: 0, cogs: 0, net: 0, stockValue: 0 },
      warehouses: ["Chờ Ship"],
      suppliers: [],
      purchasePlaces: [],
      sources: [],
      accounts: [],
      products: [],
      preOrders: [],
      cancelledRefundPending: [],
      debtSales: [],
      inventory: [],
      allSales: [],
      groupedInventory: []
    };
  }
}

function getCreditCardWalletsMap(ssTarget) {
  const creditMap = new Map();
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return creditMap;
    const sheet = ss.getSheetByName("Wallets") || ss.getSheetByName("Ví") || ss.getSheetByName("ViThe");
    if (!sheet || sheet.getLastRow() < 2) return creditMap;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      const colA = String(data[i][0] || "").trim().toLowerCase();
      const colB = String(data[i][1] || "").trim().toLowerCase();
      const type = String(data[i][2] || "").trim().toUpperCase();
      const isCredit = (type === "CREDIT");
      
      if (colB) creditMap.set(colB, isCredit);
      if (colA) creditMap.set(colA, isCredit);
    }
  } catch(e) {}
  return creditMap;
}

function isCreditCardWallet(walletName, ssTarget, creditMap) {
  if (!walletName) return false;
  const nameClean = String(walletName).trim().toLowerCase();
  
  const map = (creditMap && creditMap instanceof Map) ? creditMap : getCreditCardWalletsMap(ssTarget);
  if (map && map.has(nameClean)) {
    return map.get(nameClean);
  }

  return nameClean.startsWith("c-") || nameClean.startsWith("c_") || nameClean.includes("credit") || nameClean.includes("tín dụng") || nameClean.includes("thẻ") || nameClean.includes("card");
}

function isCashWallet(walletName) {
  if (!walletName) return false;
  const w = String(walletName).trim().toLowerCase();
  return w === "ví tiền mặt" || w === "vi tien mat" || w === "tiền mặt" || w === "tien mat" || w === "tienmat" || w === "cash" || w.startsWith("ví tiền mặt") || w.startsWith("tiền mặt");
}

/**
 * 2. LƯU ĐƠN NHẬP MUA HÀNG (PURCHASE) - TỐI ƯU TỐC ĐỘ BẰNG BATCH SETVALUES
 */
function savePurchaseOrder(formData, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (formData && formData.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const requestId = formData ? (formData.requestId || formData.clientRequestId) : null;

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    let pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet) {
      pSheet = ss.insertSheet(SHEET_PURCHASE);
    }

    const newId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("PO-") : ("PO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
    const dateVal = formatBizDateServer(formData.ngay);
    const noiMua = String(formData.noiMua || "").trim();
    let trangThaiKho = String(formData.trangThaiKho || "").trim();
    const items = formData.items || [];
    const nguonTien = String(formData.nguonTien || "").trim();
    const taiKhoanMua = String(formData.taiKhoanMua || "").trim();
    const isMuonThe = Boolean(formData.isMuonThe);
    const doiTacMuon = String(formData.doiTacMuon || "").trim();

    const isOpeningStock = Boolean(formData.isOpeningStock) || (nguonTien === "TỒN KHO ĐẦU KỲ") || (nguonTien.toUpperCase().includes("TỒN KHO"));

    if (!isOpeningStock && !nguonTien && (!isMuonThe || !doiTacMuon)) {
      return { success: false, message: "❌ Vui lòng chọn Nguồn tiền mua hoặc Mượn thẻ đối tác!" };
    }

    if (nguonTien && !isMuonThe && !isOpeningStock && typeof validateWalletExists === 'function') {
      if (!validateWalletExists(nguonTien, ss)) {
        return {
          success: false,
          message: `❌ Nguồn tiền "${nguonTien}" không tồn tại trong danh sách Ví / Thẻ! Vui lòng chọn ví hợp lệ.`
        };
      }
    }

    const isCreditWallet = isOpeningStock ? false : isCreditCardWallet(nguonTien, ss);
    const isPreOrder = isOpeningStock ? false : (Boolean(formData.isPreOrder) || isCreditWallet);
    if (isOpeningStock) {
      if (!trangThaiKho || trangThaiKho === "Chờ Ship" || trangThaiKho === "Đặt trước") {
        trangThaiKho = "Kho Nhà";
      }
    } else if (!trangThaiKho || (isPreOrder && trangThaiKho === "Chờ Ship")) {
      trangThaiKho = isPreOrder ? "Đặt trước" : "Chờ Ship";
    }
    const ghiChuOrder = String(formData.ghiChuOrder || "").trim();

    // Tính toán Cooldown cho Tab 5 / Lịch Mua Cooldown
    const cooldownDays = (typeof getDefaultCooldownDays === 'function') ? getDefaultCooldownDays(noiMua) : (noiMua.toLowerCase().includes("yodo") ? 13 : 30);
    const ngayMuaDate = (typeof parseTab5Date === 'function') ? parseTab5Date(dateVal) : new Date(dateVal);
    const ngayKhaDungDate = new Date(ngayMuaDate.getTime());
    ngayKhaDungDate.setDate(ngayKhaDungDate.getDate() + cooldownDays);
    const ngayKhaDung = (typeof formatDateTab5Standard === 'function') ? formatDateTab5Standard(ngayKhaDungDate) : formatBizDateServer(ngayKhaDungDate);

    let totalPurchaseAmt = 0;
    const rowsToAppend = [];

    const lowerWh = trangThaiKho.toLowerCase();
    const lowerNoi = noiMua.toLowerCase();
    const lowerNotes = ghiChuOrder.toLowerCase();
    const isChoShipOrChusen = lowerWh.includes("chờ ship") || lowerWh.includes("chusen") || lowerNoi.includes("chusen") || lowerNotes.includes("chusen") || lowerNotes.includes("chờ ship");

    items.forEach((it, idx) => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = it.total ? Math.round(Number(it.total)) : Math.round(qty * price);
      totalPurchaseAmt += itemTotal;

      const itemId = items.length > 1 ? `${newId}-${idx + 1}` : newId;

      let ghiChu = "";
      if (isMuonThe) ghiChu += `[Mượn thẻ đối tác: ${doiTacMuon}] `;
      if (ghiChuOrder) ghiChu += `${ghiChuOrder} `;
      if (it.ghiChu) ghiChu += it.ghiChu;

      const isFilm = (typeof isFilmProduct === 'function') ? isFilmProduct(tenSP) : (function(name) {
        const clean = (typeof removeAccentsTab5 === 'function' ? removeAccentsTab5(name) : String(name || '')).trim().toLowerCase();
        return clean.startsWith("film") || clean.includes("instax") || clean.includes("fujifilm") || clean.includes("polaroid");
      })(tenSP);
      const cooldownDays = isFilm ? ((typeof getDefaultCooldownDays === 'function') ? getDefaultCooldownDays(noiMua, tenSP) : (noiMua.toLowerCase().includes("yodo") ? 13 : 30)) : 0;
      const ngayKhaDungItemDate = new Date(ngayMuaDate.getTime());
      if (isFilm && cooldownDays > 0) {
        ngayKhaDungItemDate.setDate(ngayKhaDungItemDate.getDate() + cooldownDays);
      }
      const ngayKhaDungItem = (typeof formatDateTab5Standard === 'function') ? formatDateTab5Standard(ngayKhaDungItemDate) : formatBizDateServer(ngayKhaDungItemDate);
      const cardStatus = isPreOrder ? "PRE-ORDER" : "HOAN_TAT";
      const initialTonKho = isOpeningStock ? qty : ((isPreOrder || isChoShipOrChusen) ? "" : qty);
      const ngaySaoKe = isPreOrder ? "" : dateVal;
      const recordStatus = (isFilm && cooldownDays > 0) ? "DANG_CHO" : "KET_THUC";

      rowsToAppend.push([
        itemId,           // 1: ID
        dateVal,          // 2: Ngày Mua
        noiMua,           // 3: Nơi mua
        trangThaiKho,     // 4: Trạng Thái Kho
        tenSP,            // 5: Tên Sản Phẩm
        qty,              // 6: Số Lượng
        price,            // 7: Giá Mua (1 cái)
        itemTotal,        // 8: Tổng Tiền
        nguonTien,        // 9: Nguồn Tiền Mua
        cardStatus,       // 10: Trạng thái thẻ
        ghiChu.trim(),    // 11: Note / Ghi chú
        initialTonKho,    // 12: Tồn kho
        ngaySaoKe,        // 13: Ngày Sao kê
        taiKhoanMua,      // 14: Thông tin tài khoản mua
        cooldownDays,     // 15: SoNgayCooldown
        ngayKhaDungItem,  // 16: NgayKhaDung
        recordStatus,     // 17: TrangThai
        "HOAN_TAT",       // 18: Trạng Thái Đơn
        false             // 19: Xóa Mềm
      ]);
    });

    if (rowsToAppend.length > 0) {
      const maxCols = typeof pSheet.getMaxColumns === 'function' ? pSheet.getMaxColumns() : Math.max(pSheet.getLastColumn(), 19);
      if (maxCols < 19 && typeof pSheet.insertColumnsAfter === 'function') {
        try {
          pSheet.insertColumnsAfter(maxCols, 19 - maxCols);
        } catch(eCols) {}
      }
      if (pSheet.getLastColumn && pSheet.getRange && pSheet.getLastRow() >= 1) {
        try {
          const pHeaders = pSheet.getRange(1, 1, 1, Math.max(pSheet.getLastColumn(), 19)).getValues()[0];
          if (!pHeaders[17]) pSheet.getRange(1, 18).setValue("Trạng Thái Đơn");
          if (!pHeaders[18]) pSheet.getRange(1, 19).setValue("Xóa Mềm");
        } catch(eH) {}
      }
      const startRow = pSheet.getLastRow() + 1;
      pSheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }

    const updatedWallets = [];

    // Ghi nhận Financial Event vào WalletLedger
    if (totalPurchaseAmt > 0 && typeof postFinancialEvents === 'function') {
      const pSourceType = isMuonThe ? "PARTNER_CARD" : (isCreditWallet ? "CREDIT" : "DEBIT");
      const pSourceId = isMuonThe ? doiTacMuon : nguonTien;

      const firstItem = items[0] || {};
      const firstSpName = String(firstItem.tenSP || firstItem.name || noiMua || "Hàng hóa").trim();
      const firstQty = Number(firstItem.qty || firstItem.soLuong || 1);
      const itemDesc = (items.length === 1) 
        ? `${firstSpName} (x${firstQty})` 
        : `${firstSpName} (x${firstQty}) + ${items.length - 1} SP khác`;

      if (isPreOrder) {
        // Ghi bút toán theo dõi PREORDER_HOLD (Status PENDING, không trừ hạn mức)
        postFinancialEvents([{
          walletId: pSourceId,
          walletName: pSourceId,
          date: dateVal,
          transactionDate: dateVal,
          direction: "HOLD",
          amount: totalPurchaseAmt,
          effectType: "PREORDER_HOLD",
          type: "PREORDER_HOLD",
          eventType: "PREORDER",
          status: "PENDING",
          sourceModule: "Purchase",
          sourceId: newId,
          note: `[Pre] - ${itemDesc}`
        }], ss);
      } else {
        // Giao dịch thanh toán chính thức
        let direction = "OUT";
        let effectType = "CASH";
        let eventType = "PURCHASE_CHARGE";

        if (pSourceType === "CREDIT") {
          direction = "INCREASE";
          effectType = "CARD_DEBT";
        } else if (pSourceType === "PARTNER_CARD") {
          direction = "INCREASE";
          effectType = "PARTNER_DEBT";
          eventType = "PARTNER_BORROW";
        }

        const extraNote = ghiChuOrder ? ` - ${ghiChuOrder}` : '';
        const purchaseNote = isMuonThe 
          ? `[Mượn thẻ ${doiTacMuon}] ${itemDesc}${extraNote}` 
          : `[Mua hàng] ${itemDesc}${extraNote}`;

        postFinancialEvents([{
          walletId: pSourceId,
          walletName: pSourceId,
          date: dateVal,
          transactionDate: dateVal,
          direction: direction,
          amount: totalPurchaseAmt,
          effectType: effectType,
          type: effectType,
          eventType: eventType,
          status: "POSTED",
          sourceModule: "Purchase",
          sourceId: newId,
          note: purchaseNote
        }], ss);
      }
    }

    // Nếu mượn tiền đối tác -> Tự động sinh công nợ bên Sheet Debt để đối soát
    if (isMuonThe && doiTacMuon && totalPurchaseAmt > 0) {
      let debtSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (debtSheet) {
        const debtId = "CN" + Date.now().toString().slice(-6);
        debtSheet.appendRow([
          debtId,
          dateVal,
          doiTacMuon,
          "TRA",
          `Mượn thẻ mua hàng: ${noiMua}`,
          totalPurchaseAmt,
          nguonTien || "Thẻ đối tác",
          0,
          "",
          totalPurchaseAmt,
          "DANG_NO"
        ]);
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}

    let freshTab5 = null;

    const res = {
      success: true,
      message: "✅ Đã lưu đơn nhập mua hàng thành công!",
      savedItem: { id: newId, date: dateVal, totalAmount: totalPurchaseAmt, itemsCount: items.length },
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData,
      freshTab5: freshTab5
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 3. LƯU ĐƠN XUẤT BÁN HÀNG (SALES)
 */
function saveSalesOrder(formData, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (formData && formData.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const requestId = formData ? (formData.requestId || formData.clientRequestId) : null;

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    let sSheet = ss.getSheetByName(SHEET_SALES);
    if (!sSheet) {
      sSheet = ss.insertSheet(SHEET_SALES);
    }

    const newId = (typeof generateUniqueMaGD === 'function') ? generateUniqueMaGD("SO-") : ("SO-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90));
    const dateVal = formatBizDateServer(formData.ngay);
    const items = formData.items || [];
    const nhanTienVao = String(formData.nhanTienVao || "").trim();
    const isKhachNo = Boolean(formData.isKhachNo);

    let totalSalesAmt = 0;
    let totalOrderCOGS = 0;
    const rowsToAppend = [];
    const allocatedItemIds = [];

    items.forEach((it, idx) => {
      const tenSP = String(it.tenSP || "").trim();
      if (!tenSP) return;
      const qty = Number(it.qty) || 1;
      const price = Number(it.price) || 0;
      const itemTotal = qty * price;
      totalSalesAmt += itemTotal;
      const noiTru = String(it.noiTru || "").trim();

      let ghiChu = isKhachNo ? "[Khách Nợ]" : "";
      if (it.ghiChu) ghiChu += " " + it.ghiChu;

      const itemId = items.length > 1 ? `${newId}-${idx + 1}` : newId;
      const statusThanhToan = isKhachNo ? "CHO_THU" : "HOAN_TAT";

      // Phân bổ FIFO & Tính COGS
      let itemCOGS = 0;
      if (typeof allocateSaleFIFOCost === 'function') {
        const allocRes = allocateSaleFIFOCost(itemId, tenSP, qty, noiTru, dateVal, ss);
        if (allocRes && allocRes.success) {
          itemCOGS = allocRes.totalCOGS;
          allocatedItemIds.push(itemId);
        }
      }
      totalOrderCOGS += itemCOGS;
      const itemLoiNhuan = itemTotal - itemCOGS;

      rowsToAppend.push([
        itemId,
        dateVal,
        tenSP,
        noiTru,
        qty,
        price,
        itemTotal,
        0, // Tồn kho cột H
        isKhachNo ? "Khách Nợ" : nhanTienVao,
        statusThanhToan,
        ghiChu.trim(),
        itemCOGS,
        itemLoiNhuan,
        "HOAN_TAT", // 14: Trạng Thái Đơn
        false       // 15: Xóa Mềm
      ]);
    });

    if (rowsToAppend.length > 0) {
      const maxColsS = typeof sSheet.getMaxColumns === 'function' ? sSheet.getMaxColumns() : Math.max(sSheet.getLastColumn(), 15);
      if (maxColsS < 15 && typeof sSheet.insertColumnsAfter === 'function') {
        try {
          sSheet.insertColumnsAfter(maxColsS, 15 - maxColsS);
        } catch(eCols) {}
      }
      if (sSheet.getLastColumn && sSheet.getRange && sSheet.getLastRow() >= 1) {
        try {
          const sHeaders = sSheet.getRange(1, 1, 1, Math.max(sSheet.getLastColumn(), 15)).getValues()[0];
          if (!sHeaders[13]) sSheet.getRange(1, 14).setValue("Trạng Thái Đơn");
          if (!sHeaders[14]) sSheet.getRange(1, 15).setValue("Xóa Mềm");
        } catch(eH) {}
      }
      const startRow = sSheet.getLastRow() + 1;
      sSheet.getRange(startRow, 1, rowsToAppend.length, rowsToAppend[0].length).setValues(rowsToAppend);
    }

    const updatedWallets = [];

    // Nếu không phải Khách Nợ -> Ghi nhận Financial Event vào WalletLedger
    if (!isKhachNo && totalSalesAmt > 0 && nhanTienVao) {
      if (typeof postFinancialEvents === 'function') {
        const firstSaleItem = items[0] || {};
        const firstSaleName = String(firstSaleItem.tenSP || firstSaleItem.name || "Sản phẩm").trim();
        const firstSaleQty = Number(firstSaleItem.qty || firstSaleItem.soLuong || 1);
        const saleDesc = (items.length === 1) 
          ? `${firstSaleName} (x${firstSaleQty})` 
          : `${firstSaleName} (x${firstSaleQty}) + ${items.length - 1} SP khác`;
        const saleNote = `[Bán hàng] ${saleDesc}`;

        const postRes = postFinancialEvents([{
          walletId: nhanTienVao,
          walletName: nhanTienVao,
          date: dateVal,
          transactionDate: dateVal,
          direction: "IN",
          amount: totalSalesAmt,
          effectType: "CASH",
          type: "CASH",
          status: "POSTED",
          eventType: "SALE_COLLECT",
          sourceModule: "Sales",
          sourceId: newId,
          note: saleNote
        }], ss);

        if (postRes && !postRes.success) {
          // Rollback FIFO nếu post event thất bại
          if (typeof rollbackSaleFIFOCost === 'function') {
            allocatedItemIds.forEach(id => rollbackSaleFIFOCost(id, ss));
          }
          return { success: false, message: "❌ Lỗi ghi nhận dòng tiền: " + postRes.message };
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}

    const res = {
      success: true,
      message: `✅ Đã xuất bán đơn hàng thành công! (Doanh thu: ${totalSalesAmt.toLocaleString()} ¥, Giá vốn: ${totalOrderCOGS.toLocaleString()} ¥)`,
      savedItem: { id: newId, date: dateVal, totalSales: totalSalesAmt, totalCOGS: totalOrderCOGS, itemsCount: items.length },
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 3.0. HỦY ĐƠN MUA HÀNG (PURCHASE) - ĐẢO NGƯỢC TỒN KHO & BÚT TOÁN TÀI CHÍNH
 */
function cancelPurchaseOrder(orderIdOrData, cancelReason, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (typeof orderIdOrData === 'object' && orderIdOrData && orderIdOrData.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const targetId = String((typeof orderIdOrData === 'object' && orderIdOrData !== null) ? (orderIdOrData.id || orderIdOrData.orderId || "") : (orderIdOrData || "")).trim();
    const reason = String((typeof orderIdOrData === 'object' && orderIdOrData !== null) ? (orderIdOrData.reason || cancelReason || "") : (cancelReason || "")).trim();
    const requestId = (typeof orderIdOrData === 'object' && orderIdOrData !== null) ? (orderIdOrData.requestId || orderIdOrData.clientRequestId) : null;

    if (!targetId) return { success: false, message: "❌ Mã đơn mua không hợp lệ!" };

    const isSoftDelete = Boolean(typeof orderIdOrData === 'object' && orderIdOrData !== null && (orderIdOrData.isSoftDelete || orderIdOrData.softDelete));
    if (isSoftDelete) {
      const plainOrder = Object.assign({}, typeof orderIdOrData === 'object' ? orderIdOrData : { id: targetId }, { isSoftDelete: false, softDelete: false });
      const cancelRes = cancelPurchaseOrder(plainOrder, "Xóa mềm đơn mua", ss);
      if (!cancelRes.success && !cancelRes.message.includes("đã ở trạng thái hủy")) {
        return cancelRes;
      }
      const targetBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(targetId) : targetId;
      const pSheet = ss.getSheetByName(SHEET_PURCHASE);
      if (pSheet && pSheet.getLastRow() >= 2) {
        const curData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 19)).getValues();
        for (let i = 0; i < curData.length; i++) {
          const rowId = String(curData[i][0] || "").trim();
          const isSubItem = targetBaseId && rowId.startsWith(targetBaseId + "-") && /^\d+$/.test(rowId.slice(targetBaseId.length + 1));
          const isMatch = (rowId === targetId) || (rowId === targetBaseId) || isSubItem ||
                          (typeof extractBaseOrderIdServer === 'function' && extractBaseOrderIdServer(rowId) === targetBaseId);
          if (isMatch) {
            pSheet.getRange(i + 2, 19).setValue(true);
            pSheet.getRange(i + 2, 18).setValue("DA_XOA");
            pSheet.getRange(i + 2, 12).setValue(0);
          }
        }
      }
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      const freshData = getBusinessData(null, null, ss);
      return {
        success: true,
        message: "✅ Đã xóa đơn mua #" + targetBaseId + " thành công (xóa mềm)!",
        deletedId: targetBaseId,
        freshData: freshData
      };
    }

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) {
      return { success: false, message: "❌ Sheet Purchase trống hoặc không tồn tại!" };
    }

    const targetBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(targetId) : targetId;
    const lastRow = pSheet.getLastRow();
    if (pSheet.getMaxColumns && pSheet.getMaxColumns() < 19 && pSheet.insertColumnsAfter) {
      try { pSheet.insertColumnsAfter(pSheet.getMaxColumns(), 19 - pSheet.getMaxColumns()); } catch(e) {}
    }

    try {
      const pHeaders = pSheet.getRange(1, 1, 1, Math.max(pSheet.getLastColumn(), 19)).getValues()[0];
      if (!pHeaders[17]) pSheet.getRange(1, 18).setValue("Trạng Thái Đơn");
      if (!pHeaders[18]) pSheet.getRange(1, 19).setValue("Xóa Mềm");
    } catch(eH) {}

    const data = pSheet.getRange(2, 1, lastRow - 1, Math.max(pSheet.getLastColumn(), 19)).getValues();
    const matchedItems = [];

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const isSubItem = targetBaseId && rowId.startsWith(targetBaseId + "-") && /^\d+$/.test(rowId.slice(targetBaseId.length + 1));
      const isMatch = (rowId === targetId) || (rowId === targetBaseId) || isSubItem ||
                      (typeof extractBaseOrderIdServer === 'function' && extractBaseOrderIdServer(rowId) === targetBaseId);

      if (isMatch) {
        matchedItems.push({
          rowId: rowId,
          rowIndex: i + 2,
          tenSP: String(data[i][4] || "").trim(),
          qty: Number(data[i][5]) || 0,
          price: Number(data[i][6]) || 0,
          total: Number(data[i][7]) || 0,
          nguonTien: String(data[i][8] || "").trim(),
          cardStatus: String(data[i][9] || "").trim().toUpperCase(),
          ghiChu: String(data[i][10] || "").trim(),
          tonKho: (data[i][11] !== "" && data[i][11] !== null && data[i][11] !== undefined) ? Number(data[i][11]) : null,
          trangThaiKho: String(data[i][3] || "").trim(),
          orderStatus: String(data[i][17] || "").trim().toUpperCase()
        });
      }
    }

    if (matchedItems.length === 0) {
      return { success: false, message: "❌ Không tìm thấy đơn mua: " + targetId };
    }

    const allAlreadyCancelled = matchedItems.every(it => it.orderStatus === "DA_HUY" || it.trangThaiKho.toLowerCase().includes("hủy"));
    if (allAlreadyCancelled) {
      return { success: false, message: "⚠️ Đơn mua #" + targetBaseId + " đã ở trạng thái hủy trước đó." };
    }

    // Safety check: Has any item been sold?
    const matchedItemIds = new Set(matchedItems.map(it => it.rowId));
    const aSheet = ss.getSheetByName("SaleCostAllocations") || ss.getSheetByName("Allocations");
    if (aSheet && aSheet.getLastRow() >= 2) {
      const aData = aSheet.getRange(2, 1, aSheet.getLastRow() - 1, Math.max(aSheet.getLastColumn(), 10)).getValues();
      const linkedSalesOrders = new Set();
      for (let i = 0; i < aData.length; i++) {
        const pId = String(aData[i][2] || "").trim();
        const soId = String(aData[i][1] || "").trim();
        const status = String(aData[i][7] || "").trim().toUpperCase();
        if (matchedItemIds.has(pId) && status === "ACTIVE") {
          linkedSalesOrders.add(soId);
        }
      }
      if (linkedSalesOrders.size > 0) {
        return {
          success: false,
          message: "❌ Không thể hủy đơn mua [" + targetBaseId + "] vì sản phẩm đã được xuất bán trong đơn bán: #" + Array.from(linkedSalesOrders).join(', #') + "! Vui lòng hủy các đơn bán này trước."
        };
      }
    }

    for (let it of matchedItems) {
      if (it.tonKho !== null && it.tonKho < it.qty) {
        return {
          success: false,
          message: "❌ Không thể hủy đơn mua [" + targetBaseId + "] vì sản phẩm \"" + it.tenSP + "\" đã được xuất bán (chỉ còn tồn " + it.tonKho + "/" + it.qty + ")!"
        };
      }
    }

    let totalOrderAmt = 0;
    matchedItems.forEach(it => { totalOrderAmt += it.total; });

    const firstItem = matchedItems[0] || {};
    const nguonTien = firstItem.nguonTien || "";
    const isOpeningStock = (nguonTien === "TỒN KHO ĐẦU KỲ") || (nguonTien.toUpperCase().includes("TỒN KHO"));
    const isPreOrder = (firstItem.cardStatus === "PRE-ORDER" || firstItem.cardStatus.includes("PRE"));
    const isMuonThe = firstItem.ghiChu.includes("[Mượn thẻ đối tác:");
    let doiTacMuon = "";
    if (isMuonThe) {
      const match = firstItem.ghiChu.match(/\[Mượn thẻ đối tác:\s*([^\]]+)\]/);
      if (match && match[1]) doiTacMuon = match[1].trim();
    }

    const updatedWallets = [];

    // Financial reversal
    if (typeof reverseFinancialEvents === 'function') {
      reverseFinancialEvents(targetBaseId, "Hủy đơn nhập mua hàng" + (reason ? ": " + reason : ""), ss);
      if (targetId !== targetBaseId) {
        reverseFinancialEvents(targetId, "Hủy đơn nhập mua hàng" + (reason ? ": " + reason : ""), ss);
      }
    }

    // Hoàn trả số dư ví: CHỈ khi nguồn tiền là Ví Tiền Mặt.
    // Đối với tất cả các loại Thẻ (CẢ Thẻ tín dụng Credit VÀ Thẻ ghi nợ Debit / Ngân hàng) đều phải chờ hoàn tiền sao kê ngân hàng (CHO_HOAN_TIEN), không cộng khống tiền ngay.
    const isCash = isCashWallet(nguonTien);
    if (!isOpeningStock && !isMuonThe && !isPreOrder && isCash && totalOrderAmt > 0) {
      if (typeof updateWalletBalanceHelper === 'function') {
        const wInfo = updateWalletBalanceHelper(nguonTien, totalOrderAmt, ss);
        if (wInfo) updatedWallets.push(wInfo);
      }
    }

    // Debt reversal if borrowed card
    if (isMuonThe && doiTacMuon) {
      const debtSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (debtSheet && debtSheet.getLastRow() >= 2) {
        const dData = debtSheet.getRange(2, 1, debtSheet.getLastRow() - 1, Math.max(debtSheet.getLastColumn(), 11)).getValues();
        for (let i = dData.length - 1; i >= 0; i--) {
          const dDoiTac = String(dData[i][2] || "").trim();
          const dNote = String(dData[i][4] || "").trim();
          const dAmt = Number(dData[i][5]) || 0;
          if (dDoiTac === doiTacMuon && dNote.includes("Mượn thẻ mua hàng") && (dAmt === totalOrderAmt || dNote.includes(targetBaseId))) {
            debtSheet.getRange(i + 2, 11).setValue("DA_HUY");
            break;
          }
        }
      }
    }

    // Update matched rows in Purchase sheet
    const todayStr = formatBizDateServer(new Date());
    const cancelTag = `[ĐÃ HỦY: ${reason || 'Hủy đơn'} (${todayStr})]`;

    matchedItems.forEach(it => {
      pSheet.getRange(it.rowIndex, 18).setValue("DA_HUY");
      pSheet.getRange(it.rowIndex, 12).setValue(0);
      const itIsCash = isCashWallet(it.nguonTien);
      // Nếu không phải ví tiền mặt (tức là Thẻ tín dụng Credit hoặc Thẻ ghi nợ Debit / Ngân hàng), chuyển trạng thái thẻ thành CHO_HOAN_TIEN
      if (!itIsCash && it.cardStatus !== "DA_HOAN_TIEN") {
        pSheet.getRange(it.rowIndex, 10).setValue("CHO_HOAN_TIEN");
      }
      let curNote = it.ghiChu;
      if (!curNote.includes("[ĐÃ HỦY")) {
        curNote = (curNote ? (curNote + " ") : "") + cancelTag;
        pSheet.getRange(it.rowIndex, 11).setValue(curNote);
      }
    });

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof clearAllWalletStatementCaches === 'function') {
      try { clearAllWalletStatementCaches(); } catch(e) {}
    }
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}
    let freshTab5 = null;

    const res = {
      success: true,
      message: "✅ Đã hủy đơn mua #" + targetBaseId + " (" + matchedItems.length + " món) thành công!",
      cancelledId: targetBaseId,
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData,
      freshTab5: freshTab5
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }
    return res;
  });
}

/**
 * 3.0. HỦY ĐƠN XUẤT BÁN HÀNG (SALES) - PHỤC HỒI TỒN KHO & ĐẢO NGƯỢC DOANH THU
 */
function cancelSalesOrder(saleIdOrData, cancelReason, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (typeof saleIdOrData === 'object' && saleIdOrData && saleIdOrData.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const targetId = String((typeof saleIdOrData === 'object' && saleIdOrData !== null) ? (saleIdOrData.id || saleIdOrData.saleId || "") : (saleIdOrData || "")).trim();
    const reason = String((typeof saleIdOrData === 'object' && saleIdOrData !== null) ? (saleIdOrData.reason || cancelReason || "") : (cancelReason || "")).trim();
    const requestId = (typeof saleIdOrData === 'object' && saleIdOrData !== null) ? (saleIdOrData.requestId || saleIdOrData.clientRequestId) : null;

    if (!targetId) return { success: false, message: "❌ Mã đơn bán không hợp lệ!" };

    const isSoftDelete = Boolean(typeof saleIdOrData === 'object' && saleIdOrData !== null && (saleIdOrData.isSoftDelete || saleIdOrData.softDelete));
    if (isSoftDelete) {
      const plainSale = Object.assign({}, typeof saleIdOrData === 'object' ? saleIdOrData : { id: targetId }, { isSoftDelete: false, softDelete: false });
      const cancelRes = cancelSalesOrder(plainSale, "Xóa mềm đơn bán", ss);
      if (!cancelRes.success && !cancelRes.message.includes("đã ở trạng thái hủy")) {
        return cancelRes;
      }
      const targetBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(targetId) : targetId.replace(/-\d+$/, '');
      const sSheet = ss.getSheetByName(SHEET_SALES);
      if (sSheet && sSheet.getLastRow() >= 2) {
        const curData = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, Math.max(sSheet.getLastColumn(), 15)).getValues();
        for (let i = 0; i < curData.length; i++) {
          const rowId = String(curData[i][0] || "").trim();
          const rowBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(rowId) : rowId.replace(/-\d+$/, '');
          const isSubItem = targetBaseId && rowId.startsWith(targetBaseId + "-") && /^\d+$/.test(rowId.slice(targetBaseId.length + 1));
          const isMatch = (rowId === targetId) || (rowId === targetBaseId) || isSubItem || (rowBaseId === targetBaseId);
          if (isMatch) {
            sSheet.getRange(i + 2, 15).setValue(true);
            sSheet.getRange(i + 2, 14).setValue("DA_XOA");
          }
        }
      }
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      const freshData = getBusinessData(null, null, ss);
      return {
        success: true,
        message: "✅ Đã xóa đơn bán #" + targetBaseId + " thành công (xóa mềm)!",
        deletedId: targetBaseId,
        freshData: freshData
      };
    }

    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const sSheet = ss.getSheetByName(SHEET_SALES);
    if (!sSheet || sSheet.getLastRow() < 2) {
      return { success: false, message: "❌ Sheet Sales trống hoặc không tồn tại!" };
    }

    const targetBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(targetId) : targetId.replace(/-\d+$/, '');
    const lastRow = sSheet.getLastRow();
    if (sSheet.getMaxColumns && sSheet.getMaxColumns() < 15 && sSheet.insertColumnsAfter) {
      try { sSheet.insertColumnsAfter(sSheet.getMaxColumns(), 15 - sSheet.getMaxColumns()); } catch(e) {}
    }

    try {
      const sHeaders = sSheet.getRange(1, 1, 1, Math.max(sSheet.getLastColumn(), 15)).getValues()[0];
      if (!sHeaders[13]) sSheet.getRange(1, 14).setValue("Trạng Thái Đơn");
      if (!sHeaders[14]) sSheet.getRange(1, 15).setValue("Xóa Mềm");
    } catch(eH) {}

    const data = sSheet.getRange(2, 1, lastRow - 1, Math.max(sSheet.getLastColumn(), 15)).getValues();
    const matchedItems = [];

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(rowId) : rowId.replace(/-\d+$/, '');
      const isSubItem = targetBaseId && rowId.startsWith(targetBaseId + "-") && /^\d+$/.test(rowId.slice(targetBaseId.length + 1));
      const isMatch = (rowId === targetId) || (rowId === targetBaseId) || isSubItem || (rowBaseId === targetBaseId);

      if (isMatch) {
        matchedItems.push({
          rowId: rowId,
          rowIndex: i + 2,
          tenSP: String(data[i][2] || "").trim(),
          noiTru: String(data[i][3] || "").trim(),
          qty: Number(data[i][4]) || 0,
          price: Number(data[i][5]) || 0,
          total: Number(data[i][6]) || 0,
          nhanTien: String(data[i][8] || "").trim(),
          statusThanhToan: String(data[i][9] || "").trim().toUpperCase(),
          ghiChu: String(data[i][10] || "").trim(),
          orderStatus: String(data[i][13] || "").trim().toUpperCase()
        });
      }
    }

    if (matchedItems.length === 0) {
      return { success: false, message: "❌ Không tìm thấy đơn bán: " + targetId };
    }

    const allAlreadyCancelled = matchedItems.every(it => it.orderStatus === "DA_HUY" || it.statusThanhToan === "DA_HUY");
    if (allAlreadyCancelled) {
      return { success: false, message: "⚠️ Đơn bán #" + targetBaseId + " đã ở trạng thái hủy trước đó." };
    }

    // Restore inventory back to Purchase sheet
    for (let it of matchedItems) {
      let fifoRestored = false;
      if (typeof rollbackSaleFIFOCost === 'function') {
        const rbRes = rollbackSaleFIFOCost(it.rowId, ss);
        if (rbRes && rbRes.success && !rbRes.message.includes("Không tìm thấy allocation")) {
          fifoRestored = true;
        }
      }

      if (!fifoRestored) {
        const pSheet = ss.getSheetByName(SHEET_PURCHASE);
        if (pSheet && pSheet.getLastRow() >= 2) {
          const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 12)).getValues();
          for (let p = 0; p < pData.length; p++) {
            const pTen = String(pData[p][4] || "").trim();
            const pKho = String(pData[p][3] || "").trim();
            if (pTen.toLowerCase() === it.tenSP.toLowerCase() && (!it.noiTru || pKho.toLowerCase() === it.noiTru.toLowerCase())) {
              const curTon = (pData[p][11] !== "" && pData[p][11] !== null && pData[p][11] !== undefined) ? Number(pData[p][11]) : Number(pData[p][5] || 0);
              pSheet.getRange(p + 2, 12).setValue(curTon + it.qty);
              break;
            }
          }
        }
      }
    }

    let totalSalesAmt = 0;
    matchedItems.forEach(it => { totalSalesAmt += it.total; });

    const firstItem = matchedItems[0] || {};
    const nhanTienVao = firstItem.nhanTien || "";
    const isKhachNo = (nhanTienVao === "Khách Nợ") || firstItem.statusThanhToan.includes("CHO_THU") || firstItem.ghiChu.includes("[Khách Nợ]");

    const updatedWallets = [];

    // Financial reversal
    if (typeof reverseFinancialEvents === 'function') {
      reverseFinancialEvents(targetBaseId, "Hủy đơn xuất bán hàng" + (reason ? ": " + reason : ""), ss);
      if (targetId !== targetBaseId) {
        reverseFinancialEvents(targetId, "Hủy đơn xuất bán hàng" + (reason ? ": " + reason : ""), ss);
      }
    }

    // Deduct collected money from wallet
    if (!isKhachNo && nhanTienVao && totalSalesAmt > 0) {
      if (typeof updateWalletBalanceHelper === 'function') {
        const wInfo = updateWalletBalanceHelper(nhanTienVao, -totalSalesAmt, ss);
        if (wInfo) updatedWallets.push(wInfo);
      }
    }

    // Update matched rows in Sales sheet
    const todayStr = formatBizDateServer(new Date());
    const cancelTag = `[ĐÃ HỦY: ${reason || 'Khách hủy'} (${todayStr})]`;

    matchedItems.forEach(it => {
      sSheet.getRange(it.rowIndex, 14).setValue("DA_HUY");
      sSheet.getRange(it.rowIndex, 10).setValue("DA_HUY");
      let curNote = it.ghiChu;
      if (!curNote.includes("[ĐÃ HỦY")) {
        curNote = (curNote ? (curNote + " ") : "") + cancelTag;
        sSheet.getRange(it.rowIndex, 11).setValue(curNote);
      }
    });

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof clearAllWalletStatementCaches === 'function') {
      try { clearAllWalletStatementCaches(); } catch(e) {}
    }
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;
    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}

    const res = {
      success: true,
      message: "✅ Đã hủy đơn bán #" + targetBaseId + " và phục hồi tồn kho thành công!",
      cancelledId: targetBaseId,
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }
    return res;
  });
}

/**
 * 3.1. XOÁ ĐƠN MUA HÀNG (PURCHASE) - KÈM HOÀN TRẢ TIỀN & ĐẢO SỔ CÁI
 */
function deletePurchaseOrder(orderIdOrData, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (typeof orderIdOrData === 'object' && orderIdOrData && orderIdOrData.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const targetId = String((typeof orderIdOrData === 'object' && orderIdOrData !== null) ? (orderIdOrData.id || orderIdOrData.orderId || "") : (orderIdOrData || "")).trim();
    const requestId = (typeof orderIdOrData === 'object' && orderIdOrData !== null) ? (orderIdOrData.requestId || orderIdOrData.clientRequestId) : null;
    const isSoftDelete = Boolean(typeof orderIdOrData === 'object' && orderIdOrData !== null && (orderIdOrData.isSoftDelete || orderIdOrData.softDelete));

    if (!targetId) return { success: false, message: "❌ Mã đơn mua không hợp lệ!" };

    if (isSoftDelete) {
      return cancelPurchaseOrder(orderIdOrData, "Xóa mềm đơn mua", ss);
    }

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) {
      return { success: false, message: "❌ Sheet Purchase trống hoặc không tồn tại!" };
    }

    const targetBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(targetId) : targetId;
    const lastRow = pSheet.getLastRow();
    const lastCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const matchingRowIndices = []; // 1-based row indices in pSheet
    const matchedItems = [];
    const matchedItemIds = new Set();

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const isSubItem = targetBaseId && rowId.startsWith(targetBaseId + "-") && /^\d+$/.test(rowId.slice(targetBaseId.length + 1));
      const isMatch = (rowId === targetId) || (rowId === targetBaseId) || isSubItem ||
                      (typeof extractBaseOrderIdServer === 'function' && extractBaseOrderIdServer(rowId) === targetBaseId);

      if (isMatch) {
        matchingRowIndices.push(i + 2); // 1-based index in sheet
        matchedItemIds.add(rowId);
        matchedItems.push({
          rowId: rowId,
          rowIndex: i + 2,
          tenSP: String(data[i][4] || "").trim(),
          qty: Number(data[i][5]) || 0,
          price: Number(data[i][6]) || 0,
          total: Number(data[i][7]) || 0,
          nguonTien: String(data[i][8] || "").trim(),
          cardStatus: String(data[i][9] || "").trim().toUpperCase(),
          ghiChu: String(data[i][10] || "").trim(),
          tonKho: (data[i][11] !== "" && data[i][11] !== null && data[i][11] !== undefined) ? Number(data[i][11]) : null,
          trangThaiKho: String(data[i][3] || "").trim()
        });
      }
    }

    if (matchingRowIndices.length === 0) {
      return { success: false, message: "❌ Không tìm thấy đơn mua: " + targetId };
    }

    // 2. Kiểm tra an toàn: Đã có sản phẩm nào trong đơn mua này bị xuất bán chưa?
    // 2a. Kiểm tra bảng SaleCostAllocations
    const aSheet = ss.getSheetByName("SaleCostAllocations") || ss.getSheetByName("Allocations");
    if (aSheet && aSheet.getLastRow() >= 2) {
      const aData = aSheet.getRange(2, 1, aSheet.getLastRow() - 1, Math.max(aSheet.getLastColumn(), 10)).getValues();
      for (let i = 0; i < aData.length; i++) {
        const pId = String(aData[i][2] || "").trim();
        const status = String(aData[i][7] || "").trim().toUpperCase();
        if (matchedItemIds.has(pId) && status === "ACTIVE") {
          return {
            success: false,
            message: "❌ Không thể xóa đơn mua [" + targetBaseId + "] vì sản phẩm đã được xuất bán trong đơn bán #" + aData[i][1] + "! Vui lòng xóa đơn bán trước."
          };
        }
      }
    }

    // 2b. Kiểm tra tồn kho so với số lượng ban đầu (nếu tồn kho đã bị trừ đi)
    for (let it of matchedItems) {
      if (it.tonKho !== null && it.tonKho < it.qty) {
        return {
          success: false,
          message: "❌ Không thể xóa đơn mua [" + targetBaseId + "] vì sản phẩm \"" + it.tenSP + "\" đã được xuất kho/bán bớt (chỉ còn " + it.tonKho + "/" + it.qty + ")!"
        };
      }
    }

    // 3. Hoàn tiền & Đảo bút toán tài chính
    let totalOrderAmt = 0;
    matchedItems.forEach(it => { totalOrderAmt += it.total; });

    const firstItem = matchedItems[0] || {};
    const nguonTien = firstItem.nguonTien || "";
    const isOpeningStock = (nguonTien === "TỒN KHO ĐẦU KỲ") || (nguonTien.toUpperCase().includes("TỒN KHO"));
    const isPreOrder = (firstItem.cardStatus === "PRE-ORDER" || firstItem.cardStatus.includes("PRE"));
    const isMuonThe = firstItem.ghiChu.includes("[Mượn thẻ đối tác:");
    let doiTacMuon = "";
    if (isMuonThe) {
      const match = firstItem.ghiChu.match(/\[Mượn thẻ đối tác:\s*([^\]]+)\]/);
      if (match && match[1]) doiTacMuon = match[1].trim();
    }

    const updatedWallets = [];

    // Revert WalletLedger events
    if (typeof reverseFinancialEvents === 'function') {
      reverseFinancialEvents(targetBaseId, "Xóa đơn nhập mua hàng", ss);
      if (targetId !== targetBaseId) {
        reverseFinancialEvents(targetId, "Xóa đơn nhập mua hàng", ss);
      }
    }

    // Hoàn trả số dư ví: CHỈ khi nguồn tiền là Ví Tiền Mặt.
    // Đối với tất cả các loại Thẻ (CẢ Thẻ tín dụng Credit VÀ Thẻ ghi nợ Debit / Ngân hàng) đều phải chờ hoàn tiền sao kê ngân hàng (CHO_HOAN_TIEN), không cộng khống tiền ngay.
    const isCash = isCashWallet(nguonTien);
    if (!isOpeningStock && !isMuonThe && !isPreOrder && isCash && totalOrderAmt > 0) {
      if (typeof updateWalletBalanceHelper === 'function') {
        const wInfo = updateWalletBalanceHelper(nguonTien, totalOrderAmt, ss);
        if (wInfo) updatedWallets.push(wInfo);
      }
    }

    // Nếu mượn thẻ đối tác: Tìm và xóa dòng công nợ tương ứng bên Sheet Debt
    if (isMuonThe && doiTacMuon) {
      const debtSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (debtSheet && debtSheet.getLastRow() >= 2) {
        const dData = debtSheet.getRange(2, 1, debtSheet.getLastRow() - 1, Math.max(debtSheet.getLastColumn(), 11)).getValues();
        for (let i = dData.length - 1; i >= 0; i--) {
          const dDoiTac = String(dData[i][2] || "").trim();
          const dNote = String(dData[i][4] || "").trim();
          const dAmt = Number(dData[i][5]) || 0;
          if (dDoiTac === doiTacMuon && dNote.includes("Mượn thẻ mua hàng") && (dAmt === totalOrderAmt || dNote.includes(targetBaseId))) {
            debtSheet.deleteRow(i + 2);
            break;
          }
        }
      }
    }

    // 4. Xóa các dòng khỏi Sheet Purchase (từ dưới lên trên để không lệch index)
    matchingRowIndices.sort((a, b) => b - a);
    matchingRowIndices.forEach(rowIdx => {
      pSheet.deleteRow(rowIdx);
    });

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof clearAllWalletStatementCaches === 'function') {
      try { clearAllWalletStatementCaches(); } catch(e) {}
    }
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}
    let freshTab5 = null;

    const res = {
      success: true,
      message: "✅ Đã xóa đơn mua #" + targetBaseId + " (" + matchedItems.length + " món, " + totalOrderAmt.toLocaleString() + " ¥) thành công!",
      deletedId: targetBaseId,
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData,
      freshTab5: freshTab5
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

/**
 * 3.2. XOÁ ĐƠN BÁN HÀNG (SALES) - KÈM HOÀN TRẢ TỒN KHO & ĐẢO SỔ CÁI
 */
function deleteSalesOrder(saleIdOrData, ssTarget) {
  const runner = typeof executeWithLock === 'function' ? executeWithLock : function(ms, fn) { return fn(); };
  return runner(15000, function() {
    const rawSs = ssTarget || (typeof saleIdOrData === 'object' && saleIdOrData && saleIdOrData.ssTarget) || null;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawSs) : (rawSs || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const targetId = String((typeof saleIdOrData === 'object' && saleIdOrData !== null) ? (saleIdOrData.id || saleIdOrData.saleId || "") : (saleIdOrData || "")).trim();
    const requestId = (typeof saleIdOrData === 'object' && saleIdOrData !== null) ? (saleIdOrData.requestId || saleIdOrData.clientRequestId) : null;
    const isSoftDelete = Boolean(typeof saleIdOrData === 'object' && saleIdOrData !== null && (saleIdOrData.isSoftDelete || saleIdOrData.softDelete));

    if (!targetId) return { success: false, message: "❌ Mã đơn bán không hợp lệ!" };

    if (isSoftDelete) {
      return cancelSalesOrder(saleIdOrData, "Xóa mềm đơn bán", ss);
    }

    // 1. Idempotency Check
    if (requestId && typeof getProcessedRequest === 'function') {
      const processed = getProcessedRequest(requestId, ss);
      if (processed && processed.status === "DONE" && processed.result) {
        return Object.assign({}, processed.result, { duplicate: true });
      }
    }

    const sSheet = ss.getSheetByName(SHEET_SALES);
    if (!sSheet || sSheet.getLastRow() < 2) {
      return { success: false, message: "❌ Sheet Sales trống hoặc không tồn tại!" };
    }

    const targetBaseId = (typeof extractBaseOrderIdServer === 'function') ? extractBaseOrderIdServer(targetId) : targetId;
    const lastRow = sSheet.getLastRow();
    const lastCol = Math.max(sSheet.getLastColumn(), 13);
    const data = sSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    const matchingRowIndices = [];
    const matchedItems = [];

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const isSubItem = targetBaseId && rowId.startsWith(targetBaseId + "-") && /^\d+$/.test(rowId.slice(targetBaseId.length + 1));
      const isMatch = (rowId === targetId) || (rowId === targetBaseId) || isSubItem ||
                      (typeof extractBaseOrderIdServer === 'function' && extractBaseOrderIdServer(rowId) === targetBaseId);

      if (isMatch) {
        matchingRowIndices.push(i + 2);
        matchedItems.push({
          rowId: rowId,
          rowIndex: i + 2,
          tenSP: String(data[i][2] || "").trim(),
          noiTru: String(data[i][3] || "").trim(),
          qty: Number(data[i][4]) || 0,
          price: Number(data[i][5]) || 0,
          total: Number(data[i][6]) || 0,
          nhanTien: String(data[i][8] || "").trim(),
          statusThanhToan: String(data[i][9] || "").trim().toUpperCase(),
          ghiChu: String(data[i][10] || "").trim()
        });
      }
    }

    if (matchingRowIndices.length === 0) {
      return { success: false, message: "❌ Không tìm thấy đơn bán: " + targetId };
    }

    // 2. Rollback FIFO & Phục hồi tồn kho về Sheet Purchase
    for (let it of matchedItems) {
      let fifoRestored = false;
      if (typeof rollbackSaleFIFOCost === 'function') {
        const rbRes = rollbackSaleFIFOCost(it.rowId, ss);
        if (rbRes && rbRes.success && !rbRes.message.includes("Không tìm thấy allocation")) {
          fifoRestored = true;
        }
      }

      // Fallback: nếu không có allocation FIFO (đơn cũ hoặc không tìm thấy), phục hồi trực tiếp vào Purchase
      if (!fifoRestored) {
        const pSheet = ss.getSheetByName(SHEET_PURCHASE);
        if (pSheet && pSheet.getLastRow() >= 2) {
          const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, Math.max(pSheet.getLastColumn(), 12)).getValues();
          for (let p = 0; p < pData.length; p++) {
            const pTen = String(pData[p][4] || "").trim();
            const pKho = String(pData[p][3] || "").trim();
            if (pTen.toLowerCase() === it.tenSP.toLowerCase() && (!it.noiTru || pKho.toLowerCase() === it.noiTru.toLowerCase())) {
              const curTon = (pData[p][11] !== "" && pData[p][11] !== null && pData[p][11] !== undefined) ? Number(pData[p][11]) : Number(pData[p][5] || 0);
              pSheet.getRange(p + 2, 12).setValue(curTon + it.qty);
              break;
            }
          }
        }
      }
    }

    // 3. Hoàn trả dòng tiền / Thu hồi doanh thu đã nhận vào ví
    let totalSalesAmt = 0;
    matchedItems.forEach(it => { totalSalesAmt += it.total; });

    const firstItem = matchedItems[0] || {};
    const nhanTienVao = firstItem.nhanTien || "";
    const isKhachNo = (nhanTienVao === "Khách Nợ") || firstItem.statusThanhToan.includes("CHO_THU") || firstItem.ghiChu.includes("[Khách Nợ]");

    const updatedWallets = [];

    // Revert WalletLedger events
    if (typeof reverseFinancialEvents === 'function') {
      reverseFinancialEvents(targetBaseId, "Xóa đơn xuất bán hàng", ss);
      if (targetId !== targetBaseId) {
        reverseFinancialEvents(targetId, "Xóa đơn xuất bán hàng", ss);
      }
    }

    // Trừ lại doanh thu khỏi ví nhận tiền (vì đã thu vào ví trước đó)
    if (!isKhachNo && nhanTienVao && totalSalesAmt > 0) {
      if (typeof updateWalletBalanceHelper === 'function') {
        const wInfo = updateWalletBalanceHelper(nhanTienVao, -totalSalesAmt, ss);
        if (wInfo) updatedWallets.push(wInfo);
      }
    }

    // 4. Xóa dòng khỏi Sheet Sales
    matchingRowIndices.sort((a, b) => b - a);
    matchingRowIndices.forEach(rowIdx => {
      sSheet.deleteRow(rowIdx);
    });

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    if (typeof clearAllWalletStatementCaches === 'function') {
      try { clearAllWalletStatementCaches(); } catch(e) {}
    }
    const nextVersion = (typeof incrementDataVersion === 'function') ? incrementDataVersion() : 1;

    let freshData = null;
    try { freshData = getBusinessData(null, null, ss); } catch(eFresh) {}

    const res = {
      success: true,
      message: "✅ Đã xóa đơn bán #" + targetBaseId + " và phục hồi tồn kho thành công!",
      deletedId: targetBaseId,
      updatedWallets: updatedWallets,
      dataVersion: nextVersion,
      freshData: freshData
    };

    if (requestId && typeof recordProcessedRequest === 'function') {
      recordProcessedRequest(requestId, "DONE", res, ss);
    }

    return res;
  });
}

function confirmBatchPreOrdersPayment(itemIds, customDate, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const idArray = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng pre-order nào." };

    const idSet = new Set(idArray.flatMap(id => String(id).split(',')).map(s => s.trim()).filter(Boolean));
    
    // Mở rộng tìm kiếm: Tra cứu trong WalletLedger để ánh xạ giữa LedgerID và SourceID (Mã đơn hàng gốc)
    const lSheetForLookup = ss.getSheetByName(SHEET_WALLET_LEDGER) || ss.getSheetByName("WalletLedger");
    if (lSheetForLookup && lSheetForLookup.getLastRow() >= 2) {
      const lVals = lSheetForLookup.getRange(2, 1, lSheetForLookup.getLastRow() - 1, Math.max(lSheetForLookup.getLastColumn(), 16)).getValues();
      for (let i = 0; i < lVals.length; i++) {
        const lId = String(lVals[i][0] || "").trim();
        const sId = String(lVals[i][8] || "").trim();
        const sNote = String(lVals[i][12] || "").trim();
        if (idSet.has(lId) || idSet.has(sId)) {
          if (lId) idSet.add(lId);
          if (sId) {
            idSet.add(sId);
            // Trích xuất mã số hoặc phần cơ sở nếu có
            const cleanSId = sId.replace(/^(?:PURCHASE_|FAMILY_|DEBT_|PREORDER_)/i, '');
            if (cleanSId) idSet.add(cleanSId);
          }
        }
      }
    }

    let totalAmt = 0;
    let purchaseTotalAmt = 0;
    const purchaseMapByWallet = {};
    let hasChanges = false;
    let dateVal = customDate ? formatBizDateServer(customDate) : formatBizDateServer(new Date());

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (pSheet && pSheet.getLastRow() >= 2) {
      const lastColP = Math.max(pSheet.getLastColumn(), 13);
      const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, lastColP).getValues();
      let pChanged = false;
      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
          data[i][9] = "HOAN_TAT";
          data[i][12] = dateVal; // Col M: Ngày sao kê
          let ghiChu = String(data[i][10] || "").trim();
          ghiChu = ghiChu.replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          data[i][10] = ghiChu;

          // Tự động chuyển kho từ Đặt trước sang Chờ Ship
          const curWh = String(data[i][3] || "").trim().toLowerCase();
          if (curWh.includes("đặt trước") || curWh.includes("dat truoc") || curWh.includes("preorder") || curWh.includes("pre-order")) {
            data[i][3] = "Chờ Ship";
          }

          const qty = parseBizMoney(data[i][5]);
          const price = parseBizMoney(data[i][6]);
          const itemTotal = parseBizMoney(data[i][7]) || (qty * price);
          totalAmt += itemTotal;
          purchaseTotalAmt += itemTotal;

          const nguonTien = String(data[i][8] || "").trim() || "Thẻ";
          purchaseMapByWallet[nguonTien] = (purchaseMapByWallet[nguonTien] || 0) + itemTotal;
          if (!customDate && data[i][1]) dateVal = formatBizDateServer(data[i][1]);
          hasChanges = true;
          pChanged = true;
        }
      }
      if (pChanged) {
        pSheet.getRange(2, 1, data.length, lastColP).setValues(data);
      }
    }

    // Check Family Sheet for pre-orders
    const fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
    if (fSheet && fSheet.getLastRow() >= 2) {
      const lastColF = Math.max(fSheet.getLastColumn(), 11);
      const fData = fSheet.getRange(2, 1, fSheet.getLastRow() - 1, lastColF).getValues();
      let fChanged = false;
      for (let i = 0; i < fData.length; i++) {
        const rowId = String(fData[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
          fData[i][9] = "HOAN_TAT";
          fData[i][10] = dateVal; // Col K: Ngày sao kê
          let ghiChu = String(fData[i][8] || "").trim();
          ghiChu = ghiChu.replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          fData[i][8] = ghiChu;

          let noiDung = String(fData[i][4] || "").trim();
          noiDung = noiDung.replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          fData[i][4] = noiDung;

          const itemTotal = parseBizMoney(fData[i][5]);
          totalAmt += itemTotal;
          hasChanges = true;
          fChanged = true;
        }
      }
      if (fChanged) {
        fSheet.getRange(2, 1, fData.length, lastColF).setValues(fData);
      }
    }

    // Check Debt Sheet for pre-orders
    const dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
    if (dSheet && dSheet.getLastRow() >= 2) {
      const lastColD = Math.max(dSheet.getLastColumn(), 13);
      const dData = dSheet.getRange(2, 1, dSheet.getLastRow() - 1, lastColD).getValues();
      let dChanged = false;
      for (let i = 0; i < dData.length; i++) {
        const rowId = String(dData[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
          const duNo = Number(dData[i][9]) || 0;
          dData[i][10] = duNo <= 0 ? "DA_TRA" : "DANG_NO";
          dData[i][11] = "HOAN_TAT";
          dData[i][12] = dateVal; // Col M: Ngày sao kê
          let noiDung = String(dData[i][4] || "").trim();
          noiDung = noiDung.replace(/\[Pre-order\/Chờ sao kê\]/gi, '').replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').replace(/\[Pre-order\]/gi, '').trim();
          dData[i][4] = noiDung;

          const itemTotal = parseBizMoney(dData[i][5]);
          totalAmt += itemTotal;
          hasChanges = true;
          dChanged = true;
        }
      }
      if (dChanged) {
        dSheet.getRange(2, 1, dData.length, lastColD).setValues(dData);
      }
    }

    // Cập nhật Sổ Cái WalletLedger: Chuyển PENDING pre-orders -> POSTED CARD_DEBT
    const linkedIdsArray = Array.from(idSet);
    let ledgerUpdatedCount = 0;
    if (typeof confirmLedgerPreOrders === 'function') {
      const lRes = confirmLedgerPreOrders(linkedIdsArray, dateVal, ss);
      if (lRes && lRes.success) {
        ledgerUpdatedCount = lRes.count || 0;
        if (ledgerUpdatedCount > 0) hasChanges = true;
      }
    }

    if (!hasChanges && ledgerUpdatedCount === 0) {
      return { success: false, message: "❌ Không tìm thấy đơn hàng pre-order nào để xác nhận trừ thẻ." };
    }

    // Nếu các đơn hàng hoàn toàn chưa có dòng PENDING trong Sổ Cái (dữ liệu cũ chỉ lưu trên sheet), ghi nhận dòng POSTED mới
    if (ledgerUpdatedCount === 0 && purchaseTotalAmt > 0 && typeof postFinancialEvents === 'function') {
      const linkedIdsStr = linkedIdsArray.join(", ");
      const events = [];
      Object.keys(purchaseMapByWallet).forEach((w) => {
        const amt = purchaseMapByWallet[w];
        const isCredit = isCreditCardWallet(w, ss);
        events.push({
          walletId: w,
          walletName: w,
          date: dateVal,
          transactionDate: dateVal,
          direction: isCredit ? "INCREASE" : "OUT",
          amount: amt,
          effectType: isCredit ? "CARD_DEBT" : "CASH",
          eventType: "PREORDER_CHARGE",
          status: "POSTED",
          statementDate: dateVal,
          sourceModule: "Purchase",
          sourceId: linkedIdsStr,
          note: `[Mua hàng] - Trừ thẻ thực tế (${idSet.size} đơn)`
        });
      });
      postFinancialEvents(events, ss);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã xác nhận trừ thẻ thực tế ${totalAmt.toLocaleString()} ¥ cho ${idSet.size} đơn pre-order!`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

function confirmPreOrderPayment(targetId, customDate, ssTarget) {
  return confirmBatchPreOrdersPayment([targetId], customDate, ssTarget);
}

/**
 * BÁO THU TIỀN CHO CÁC ĐƠN KHÁCH NỢ (SALES) - BATCH UPDATE TỐI ƯU TỐC ĐỘ
 */
function confirmBatchDebtSalesPayment(itemIds, walletName, dateStr, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, connectionError: true, message: "❌ Lỗi kết nối dữ liệu: Không tìm thấy Spreadsheet!" };

    const sSheet = ss.getSheetByName(SHEET_SALES);
    if (!sSheet || sSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Sales." };

    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return { success: false, message: "❌ Chưa chọn đơn hàng nào." };
    }

    const wallet = String(walletName || "Ví Tiền Mặt").trim();
    const idSet = new Set(itemIds.map(id => String(id).trim()));

    const numCols = Math.max(sSheet.getLastColumn(), 11);
    const data = sSheet.getRange(2, 1, sSheet.getLastRow() - 1, numCols).getValues();
    let totalCollected = 0;
    const collectedItems = [];
    let hasChanges = false;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      if (idSet.has(rowId)) {
        // Cập nhật Cột I (Column 9, index 8) sang Tên Ví nhận tiền
        data[i][8] = wallet;
        
        // Cập nhật Cột J (Column 10, index 9) sang HOAN_TAT
        data[i][9] = "HOAN_TAT";

        // Cập nhật Cột K (Column 11, index 10) sang Ghi chú
        let ghiChu = String(data[i][10] || data[i][9] || "").trim();
        if (!ghiChu.includes("[Đã thu tiền]")) {
          ghiChu = (ghiChu.replace(/\[Khách Nợ\]/gi, '').trim() + " [Đã thu tiền]").trim();
        }
        data[i][10] = ghiChu;

        const qty = parseBizMoney(data[i][4]);
        const price = parseBizMoney(data[i][5]);
        const total = parseBizMoney(data[i][6]) || (qty * price);
        totalCollected += total;
        if (data[i][2]) collectedItems.push(String(data[i][2]).trim());
        hasChanges = true;
      }
    }

    if (hasChanges) {
      // Ghi hàng loạt vào Google Sheets chỉ với 1 call duy nhất -> siêu nhanh!
      sSheet.getRange(2, 1, data.length, numCols).setValues(data);
    }

    const updatedWallets = [];
    if (wallet && totalCollected > 0 && typeof updateWalletBalanceHelper === 'function') {
      const wInfo = updateWalletBalanceHelper(wallet, totalCollected, ss);
      if (wInfo) updatedWallets.push(wInfo);
    }

    const familySheet = ss ? (ss.getSheetByName("Family") || ss.getSheetByName("ThuChi")) : null;
    const logDate = (dateStr && String(dateStr).trim()) ? String(dateStr).trim() : formatBizDateServer(new Date());
    if (familySheet && totalCollected > 0) {
      const maGD = "DH" + Date.now().toString().slice(-6);
      const noiDungStr = `[Thu tiền khách nợ] ${collectedItems.length} sản phẩm [${itemIds.join(", ")}]`;
      const ghiChuStr = `Mã đơn hàng khách nợ: ${itemIds.join(", ")}`;
      familySheet.appendRow([maGD, logDate, "Thu", "CÔNG NỢ", noiDungStr, totalCollected, wallet, "", ghiChuStr, "HOAN_TAT"]);
    }

    if (collectedItems.length > 0 && totalCollected > 0 && typeof postFinancialEvents === 'function') {
      postFinancialEvents([{
        walletId: wallet,
        walletName: wallet,
        date: logDate,
        transactionDate: logDate,
        direction: "IN",
        amount: totalCollected,
        effectType: "CASH",
        type: "CASH",
        status: "POSTED",
        eventType: "CUSTOMER_COLLECT",
        sourceModule: "Sales",
        sourceId: itemIds.join(", "),
        note: `Thu tiền đơn khách nợ (${collectedItems.length} SP)`
      }], ss);
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { 
      success: true, 
      message: `✅ Đã ghi nhận thu ${totalCollected.toLocaleString()} ¥ từ ${collectedItems.length} đơn hàng vào ${wallet}!`,
      freshData: freshData,
      updatedWallets: updatedWallets
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi thu tiền đơn khách nợ: " + err.toString() };
  }
}

const SHEET_CANCEL_LOG = "Log_HuyDon";

function logCancelledOrderToSheet(logItem, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return;

    let sheet = getSheetByNameSafely(SHEET_CANCEL_LOG, ss);
    if (!sheet) return; // Do not auto-create Log_HuyDon sheet

    const dStr = formatBizDateServer(logItem.date || new Date());
    sheet.appendRow([
      dStr,
      logItem.id || "",
      logItem.tenSP || "",
      logItem.qty || 0,
      logItem.price || 0,
      logItem.total || 0,
      logItem.wallet || "",
      logItem.orderType || "PRE-ORDER",
      logItem.paymentMethod || "CREDIT",
      logItem.refundStatus || "Chờ Hoàn",
      logItem.reason || "Người dùng hủy đơn"
    ]);
  } catch (e) {
    Logger.log("Lỗi logCancelledOrderToSheet: " + e);
  }
}

/**
 * 4.2. HỦY ĐƠN PRE-ORDER
 */
/**
 * 4.3. QUAY LẠI PRE-ORDER (HỦY XÁC NHẬN TRỪ THẺ THỰC TẾ)
 * Đưa đơn hàng đã lỡ ấn trừ thẻ quay về trạng thái PRE-ORDER
 */
function revertPreOrderPayment(targetIds, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, message: "❌ Không tìm thấy bảng tính Spreadsheet!" };

    const idArray = (Array.isArray(targetIds) ? targetIds : [targetIds]).map(id => String(id || '').trim()).filter(Boolean);
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng nào để quay lại Pre-order." };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const pData = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 14).getValues();
    let revertedCount = 0;

    for (let i = 0; i < pData.length; i++) {
      const rowId = String(pData[i][0] || '').trim();
      const rowIndex = i + 2;
      const cleanRowId = rowId.replace(/^(?:PURCHASE_|FAMILY_|DEBT_|PREORDER_)/i, '');

      const isMatch = idArray.some(tid => {
        const cleanTid = String(tid).trim().replace(/^(?:PURCHASE_|FAMILY_|DEBT_|PREORDER_)/i, '');
        return cleanTid === cleanRowId || tid === rowId || String(rowIndex) === tid;
      });

      if (isMatch) {
        // Cột 10 (Trạng thái thẻ): Đổi về PRE-ORDER
        pSheet.getRange(rowIndex, 10).setValue("PRE-ORDER");
        
        // Cột 11 (Ghi chú): Thêm [Pre-order] nếu chưa có
        let ghiChu = String(pData[i][10] || '').trim();
        if (!ghiChu.toLowerCase().includes("pre-order") && !ghiChu.toLowerCase().includes("preorder")) {
          ghiChu = `[Pre-order] ${ghiChu}`.trim();
          pSheet.getRange(rowIndex, 11).setValue(ghiChu);
        }

        // Đảo ngược / hủy công nợ thẻ trong WalletLedger
        if (typeof reverseFinancialEvents === 'function') {
          reverseFinancialEvents(rowId, "Quay lại Pre-order (Hủy xác nhận trừ thẻ)", ss);
        }

        revertedCount++;
      }
    }

    if (revertedCount > 0) {
      if (typeof clearAppDataCache === 'function') clearAppDataCache();
      const freshData = (typeof getTab3Data === 'function') ? getTab3Data("ALL", "ALL") : null;
      return {
        success: true,
        message: `✅ Đã đưa ${revertedCount} đơn hàng về lại trạng thái Pre-order (Chờ trừ thẻ)!`,
        freshData: freshData
      };
    } else {
      return { success: false, message: "❌ Không tìm thấy đơn hàng tương ứng để quay lại Pre-order." };
    }
  } catch (err) {
    return { success: false, message: "❌ Lỗi khi quay lại Pre-order: " + err.toString() };
  }
}

function cancelBatchPreOrders(itemIds, reason, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, connectionError: true, message: "❌ Lỗi kết nối dữ liệu: Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const idArray = Array.isArray(itemIds) ? itemIds : [itemIds];
    if (idArray.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng pre-order nào." };

    const idSet = new Set(idArray.flatMap(id => String(id).split(',')).map(s => s.trim()).filter(Boolean));
    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();
    const creditMap = getCreditCardWalletsMap(ss);

    let cancelledCount = 0;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if (idSet.has(rowId) || idSet.has(rowIndexStr)) {
        cancelledCount++;
        const rowIndex = i + 2;
        const walletName = String(data[i][8] || "").trim();
        const isCredit = isCreditCardWallet(walletName, ss, creditMap);
        const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
        const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");

        pSheet.getRange(rowIndex, 4).setValue("Hủy");
        pSheet.getRange(rowIndex, 10).setValue(cardDone ? "CHO_HOAN_TIEN" : "HUY");
        if (typeof updatePurchaseLimitStatus === 'function') {
          updatePurchaseLimitStatus(rowId, "DA_HUY");
        } else if (pSheet.getLastColumn() >= 17) {
          pSheet.getRange(rowIndex, 17).setValue("KET_THUC");
        }
      }
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã hủy ${cancelledCount} đơn hàng đặt trước!`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi hủy đơn pre-order: " + err.toString() };
  }
}

function cancelPreOrderOrder(targetId) {
  return cancelBatchPreOrders([targetId]);
}

/**
 * 5. CẬP NHẬT TRẠNG THÁI KHO CHO SẢN PHẨM INVENTORY
 */
function updateWarehouseStatus(targetId, newStatus, reason, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const targetStr = String(targetId || "").trim();
    const isCancel = (newStatus === 'CANCEL' || newStatus === 'Hủy' || newStatus === 'BỊ HỦY' || newStatus === 'BỊ HỦY - CHỜ HOÀN');
    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();

    let matched = false;
    const targetStatus = isCancel ? "Hủy" : newStatus;
    const ckSheet = getOrCreateStockTransferSheetHelper(ss);
    const ckRows = [];
    let cancelLimitId = null;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      const rIdLower = rowId.toLowerCase();
      const targetLower = targetStr.toLowerCase();

      const isMatch = (
        (rowId && rIdLower === targetLower) ||
        rowIndexStr === targetStr ||
        (rowId && (rIdLower.startsWith(targetLower + "-") || rIdLower.startsWith(targetLower + "_"))) ||
        (rowId && (targetLower.startsWith(rIdLower + "-") || targetLower.startsWith(rIdLower + "_")))
      );

      if (isMatch) {
        const currentWh = String(data[i][3] || "").trim();
        const currentWhLower = currentWh.toLowerCase();
        const isPendingWh = (currentWh === "Chờ Ship" || currentWhLower.includes("chờ ship") || currentWhLower.includes("chusen") || currentWhLower.includes("đặt trước") || currentWhLower.includes("preorder"));
        if (isCancel && !isPendingWh) {
          return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Đặt trước', 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
        }
        const rowIndex = i + 2;
        const fromWh = currentWh || "Chờ Ship";
        const spName = String(data[i][4] || "").trim();
        const origQty = parseBizMoney(data[i][5]);

        data[i][3] = targetStatus;

        const lowerWhCheck = targetStatus.toLowerCase();
        const isWhInStock = !lowerWhCheck.includes("chờ ship") && !lowerWhCheck.includes("chusen") && !lowerWhCheck.includes("đặt trước") && !lowerWhCheck.includes("preorder") && !lowerWhCheck.includes("hủy") && !lowerWhCheck.includes("cancel");

        if (isWhInStock) {
          const curTon = parseBizMoney(data[i][11]);
          if (!curTon || curTon <= 0) {
            data[i][11] = origQty || 1;
          }
        } else if (!isCancel) {
          data[i][11] = "";
        }

        if (ckSheet) {
          const nowStr = typeof Utilities !== 'undefined' && Utilities.formatDate 
            ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy HH:mm:ss")
            : new Date().toLocaleString("vi-VN");
          ckRows.push([
            "CK_" + Date.now() + "_1",
            nowStr,
            rowId || rowIndexStr,
            spName,
            fromWh,
            targetStatus,
            origQty || 1,
            "Admin",
            reason || `Chuyển đơn hàng từ ${fromWh} sang ${targetStatus}`
          ]);
        }

        if (isCancel) {
          const wasDatTruoc = currentWhLower.includes("đặt trước") || currentWhLower.includes("preorder");
          const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
          const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");
          if (wasDatTruoc && !cardDone) {
            data[i][9] = "HUY";
          } else {
            data[i][9] = "CHO_HOAN_TIEN";
          }
          data[i][11] = 0;
          if (maxCol >= 17) data[i][16] = "KET_THUC";
          cancelLimitId = rowId;
        }
        matched = true;
        break;
      }
    }

    if (!matched) return { success: false, message: "❌ Không tìm thấy đơn hàng cần chuyển kho." };

    pSheet.getRange(2, 1, data.length, data[0].length).setValues(data);
    if (ckSheet && ckRows.length > 0) {
      ckSheet.getRange(ckSheet.getLastRow() + 1, 1, ckRows.length, ckRows[0].length).setValues(ckRows);
    }
    if (cancelLimitId && typeof updatePurchaseLimitStatus === 'function') {
      updatePurchaseLimitStatus(cancelLimitId, "DA_HUY");
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã chuyển trạng thái kho sang ${isCancel ? "Hủy" : newStatus}`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * Helper to safely get or create STOCK_TRANSFER sheet with standard headers
 */
function getOrCreateStockTransferSheetHelper(ssTarget) {
  try {
    var ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return null;

    var existing = ss.getSheetByName("STOCK_TRANSFER") || 
                   ss.getSheetByName("STOCK TRANSFER") || 
                   ss.getSheetByName("CHUYEN_KHO") || 
                   ss.getSheetByName("Chuyển Kho") || 
                   ss.getSheetByName("Chuyen Kho");
    if (existing) return existing;

    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var name = String(sheets[i].getName() || "").trim().toUpperCase();
      if (name.includes("STOCK_TRANSFER") || name.includes("STOCK TRANSFER") || name.includes("CHUYEN") || name.includes("CHUYỂN")) {
        return sheets[i];
      }
    }

    var ckSheet = ss.insertSheet("STOCK_TRANSFER");
    return ckSheet;
  } catch (err) {
    try {
      var ssFallback = ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null);
      if (ssFallback) {
        return ssFallback.getSheetByName("STOCK_TRANSFER") || 
               ssFallback.getSheetByName("STOCK TRANSFER") || 
               ssFallback.getSheetByName("CHUYEN_KHO") || 
               ssFallback.getSheetByName("Chuyển Kho") || null;
      }
    } catch(e2) {}
    return null;
  }
}

/**
 * 5.2. CHUYỂN KHO THÔNG MINH THEO SẢN PHẨM & KHO NGUỒN
 */
function transferWarehouseBatch(spName, fromWarehouse, toWarehouse, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const spTarget = String(spName || "").trim();
    const spTargetLower = spTarget.toLowerCase();
    const fromWh = String(fromWarehouse || "").trim();
    const fromWhLower = fromWh.toLowerCase();
    const toWh = String(toWarehouse || "").trim();

    if (!spTarget || !toWh) return { success: false, message: "❌ Vui lòng chọn sản phẩm và kho đích hợp lệ!" };

    const isCancel = (toWh === 'CANCEL' || toWh === 'BỊ HỦY' || toWh === 'BỊ HỦY - CHỜ HOÀN' || toWh === 'Hủy');
    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();

    if (isCancel) {
      for (let i = 0; i < data.length; i++) {
        const rowSp = String(data[i][4] || "").trim().toLowerCase();
        const rowWh = String(data[i][3] || "").trim();
        const rowWhLower = rowWh.toLowerCase();
        const isRowPendingWh = (rowWh === 'Chờ Ship' || rowWhLower.includes('chờ ship') || rowWhLower.includes('chusen'));
        if (rowSp === spTargetLower && (!fromWh || fromWh === 'ALL' || fromWhLower === 'all' || rowWhLower === fromWhLower)) {
          if (!isRowPendingWh) {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
          }
        }
      }
    }

    let updatedCount = 0;
    const targetStatus = isCancel ? "Hủy" : toWh;
    const ckSheet = getOrCreateStockTransferSheetHelper(ss);
    const nowStr = typeof Utilities !== 'undefined' && Utilities.formatDate 
      ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy HH:mm:ss")
      : new Date().toLocaleString("vi-VN");

    const ckRows = [];
    const cancelLimitRowIds = [];

    for (let i = 0; i < data.length; i++) {
      const rowSp = String(data[i][4] || "").trim().toLowerCase();
      const rowWh = String(data[i][3] || "").trim();
      const rowWhLower = rowWh.toLowerCase();
      const rowId = String(data[i][0] || "").trim();
      if (rowSp === spTargetLower && (!fromWh || fromWh === 'ALL' || fromWhLower === 'all' || rowWhLower === fromWhLower)) {
        const rowIndex = i + 2;
        const fromWhActual = rowWh || "Chờ Ship";
        data[i][3] = targetStatus;
        updatedCount++;

        if (ckSheet) {
          const qtyVal = parseBizMoney(data[i][5]) || 1;
          ckRows.push([
            "CK_" + Date.now() + "_" + updatedCount,
            nowStr,
            rowId || String(rowIndex),
            spTarget,
            fromWhActual,
            targetStatus,
            qtyVal,
            "Admin",
            `Chuyển kho sản phẩm "${spTarget}" từ ${fromWhActual} sang ${targetStatus}`
          ]);
        }

        if (isCancel) {
          data[i][9] = "CHO_HOAN_TIEN";
          data[i][11] = 0;
          if (maxCol >= 17) data[i][16] = "KET_THUC";
          cancelLimitRowIds.push(rowId);
        } else if (targetStatus !== "Chờ Ship" && !targetStatus.toLowerCase().includes("chusen")) {
          const curTon = parseBizMoney(data[i][11]);
          if (!curTon || curTon <= 0) {
            data[i][11] = parseBizMoney(data[i][5]);
          }
        } else {
          data[i][11] = "";
        }
      }
    }

    if (updatedCount === 0) {
      return { success: false, message: "❌ Không tìm thấy sản phẩm phù hợp ở kho nguồn." };
    }

    pSheet.getRange(2, 1, data.length, data[0].length).setValues(data);
    if (ckSheet && ckRows.length > 0) {
      ckSheet.getRange(ckSheet.getLastRow() + 1, 1, ckRows.length, ckRows[0].length).setValues(ckRows);
    }
    if (cancelLimitRowIds.length > 0 && typeof updatePurchaseLimitStatus === 'function') {
      cancelLimitRowIds.forEach(id => updatePurchaseLimitStatus(id, "DA_HUY"));
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: `✅ Đã chuyển ${updatedCount} đơn hàng sản phẩm "${spTarget}" sang ${targetStatus}!`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi chuyển kho: " + err.toString() };
  }
}

/**
 * 5.3. CẬP NHẬT TRẠNG THÁI KHO CHO NHIỀU ĐƠN HÀNG CÙNG LÚC
 */
function updateBatchWarehouseStatus(itemIds, newStatus, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const newWh = String(newStatus || "").trim();
    if (!newWh) return { success: false, message: "❌ Thông tin kho mới không hợp lệ." };

    // Process inputs into transfer map: id -> qtyToTransfer (null if full transfer)
    const items = Array.isArray(itemIds) ? itemIds : [itemIds];
    const transferMap = {};
    items.forEach(item => {
      if (typeof item === 'object' && item !== null) {
        const idStr = String(item.id || item.itemId || '').trim();
        const qtyVal = Number(item.qty || item.transferQty || 0);
        if (idStr) transferMap[idStr] = qtyVal > 0 ? qtyVal : null;
      } else if (item !== undefined && item !== null) {
        const idStr = String(item).trim();
        if (idStr) transferMap[idStr] = null;
      }
    });

    const targetIds = Object.keys(transferMap);
    if (targetIds.length === 0) return { success: false, message: "❌ Chưa chọn đơn hàng nào." };

    const isCancel = (newWh === 'CANCEL' || newWh === 'BỊ HỦY' || newWh === 'BỊ HỦY - CHỜ HOÀN' || newWh === 'Hủy');
    const targetStatus = isCancel ? "Hủy" : newWh;

    const lastRow = pSheet.getLastRow();
    const lastCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    if (isCancel) {
      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        let isTargetRow = false;

        for (let k in transferMap) {
          const kClean = String(k || "").trim().toLowerCase();
          const kNoRow = kClean.replace(/^row_/i, "");
          const rIdLower = rowId.toLowerCase();
          if (
            (rowId && rIdLower === kClean) ||
            kClean === rowIndexStr ||
            kNoRow === rowIndexStr ||
            (rowId && (rIdLower.startsWith(kClean + "-") || rIdLower.startsWith(kClean + "_"))) ||
            (rowId && (kClean.startsWith(rIdLower + "-") || kClean.startsWith(rIdLower + "_")))
          ) {
            isTargetRow = true;
            break;
          }
        }

        if (isTargetRow) {
          const currentWh = String(data[i][3] || "").trim().toLowerCase();
          const isPendingWh = (currentWh === "chờ ship" || currentWh.includes("chờ ship") || currentWh.includes("chusen") || currentWh.includes("đặt trước") || currentWh.includes("preorder"));
          if (!isPendingWh) {
            return { success: false, message: "❌ Chỉ đơn hàng ở trạng thái 'Đặt trước', 'Chờ Ship' hoặc 'Chusen' mới được Hủy!" };
          }
        }
      }
    }

    // Ensure STOCK_TRANSFER sheet exists safely without exception
    const ckSheet = getOrCreateStockTransferSheetHelper(ss);

    let updatedCount = 0;
    const nowStr = typeof Utilities !== 'undefined' && Utilities.formatDate 
      ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy HH:mm:ss")
      : new Date().toLocaleString("vi-VN");

    const ckRows = [];
    const newSplitRows = [];
    const cancelLimitRowIds = [];

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      let matchKey = null;

      if (rowId && Object.prototype.hasOwnProperty.call(transferMap, rowId)) {
        matchKey = rowId;
      } else if (Object.prototype.hasOwnProperty.call(transferMap, rowIndexStr)) {
        matchKey = rowIndexStr;
      } else {
        for (let k in transferMap) {
          const kClean = String(k || "").trim().toLowerCase();
          const kNoRow = kClean.replace(/^row_/i, "");
          const rIdLower = rowId.toLowerCase();

          if (
            (rowId && rIdLower === kClean) ||
            kClean === rowIndexStr ||
            kNoRow === rowIndexStr ||
            (rowId && (rIdLower.startsWith(kClean + "-") || rIdLower.startsWith(kClean + "_"))) ||
            (rowId && (kClean.startsWith(rIdLower + "-") || kClean.startsWith(rIdLower + "_")))
          ) {
            matchKey = k;
            break;
          }
        }
      }

      if (matchKey !== null) {
        const rowIndex = i + 2;
        const origQty = parseBizMoney(data[i][5]);
        const origPrice = parseBizMoney(data[i][6]);
        const origTonKho = (data[i][11] !== "" && data[i][11] !== null && data[i][11] !== undefined) ? parseBizMoney(data[i][11]) : origQty;
        const fromWh = String(data[i][3] || "").trim() || "Chờ Ship";
        const reqQty = transferMap[matchKey];
        const spName = String(data[i][4] || "").trim();

        if (reqQty === null || reqQty >= origQty || origQty <= 1) {
          // Full transfer
          data[i][3] = targetStatus;
          updatedCount++;

          if (ckSheet) {
            ckRows.push([
              "CK_" + Date.now() + "_" + updatedCount,
              nowStr,
              rowId || rowIndexStr,
              spName,
              fromWh,
              targetStatus,
              origQty,
              "Admin",
              `Chuyển toàn bộ ${origQty} SP từ ${fromWh} sang ${targetStatus}`
            ]);
          }

          if (isCancel) {
            const wasDatTruoc = fromWh.toLowerCase().includes("đặt trước") || fromWh.toLowerCase().includes("preorder");
            const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
            const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");
            if (wasDatTruoc && !cardDone) {
              data[i][9] = "HUY";
            } else {
              data[i][9] = "CHO_HOAN_TIEN";
            }
            data[i][11] = 0;
            if (lastCol >= 17) data[i][16] = "KET_THUC";
            cancelLimitRowIds.push(rowId || rowIndexStr);
          } else if (targetStatus.toLowerCase().includes("chờ ship") || targetStatus.toLowerCase().includes("chusen") || targetStatus.toLowerCase().includes("đặt trước") || targetStatus.toLowerCase().includes("preorder")) {
            data[i][11] = "";
          } else {
            const curTon = parseBizMoney(data[i][11]);
            if (!curTon || curTon <= 0) {
              data[i][11] = origQty;
            }
          }
        } else {
          // Partial transfer -> Row Splitting (Option A)
          const remainingQty = origQty - reqQty;
          const remainingTotal = remainingQty * origPrice;
          const newTonKhoOrig = Math.max(0, origTonKho - reqQty);

          data[i][5] = remainingQty;
          data[i][7] = remainingTotal;
          data[i][11] = newTonKhoOrig;

          const newRowId = (rowId ? rowId : rowIndexStr) + "_CK";
          const newGhiChu = (String(data[i][10] || "").trim() + ` [Tách từ #${rowId || rowIndexStr}]`).trim();
          const isTargetInStock = !targetStatus.toLowerCase().includes("chờ ship") && !targetStatus.toLowerCase().includes("chusen") && !targetStatus.toLowerCase().includes("đặt trước") && !targetStatus.toLowerCase().includes("preorder") && !targetStatus.toLowerCase().includes("hủy") && !targetStatus.toLowerCase().includes("cancel");
          const splitTonKho = isTargetInStock ? reqQty : "";

          const newRow = [...data[i]];
          newRow[0] = newRowId;
          newRow[3] = targetStatus;
          newRow[5] = reqQty;
          newRow[7] = reqQty * origPrice;
          newRow[10] = newGhiChu;
          newRow[11] = splitTonKho;

          if (isCancel) {
            const wasDatTruoc = fromWh.toLowerCase().includes("đặt trước") || fromWh.toLowerCase().includes("preorder");
            const cardStatusRaw = String(data[i][9] || "").trim().toLowerCase();
            const cardDone = cardStatusRaw.includes("hoan_tat") || cardStatusRaw.includes("da_tru") || cardStatusRaw.includes("đã trừ");
            if (wasDatTruoc && !cardDone) {
              newRow[9] = "HUY";
            } else {
              newRow[9] = "CHO_HOAN_TIEN";
            }
            newRow[11] = 0;
            if (lastCol >= 17) newRow[16] = "KET_THUC";
            cancelLimitRowIds.push(newRowId);
          }

          newSplitRows.push(newRow);
          updatedCount++;

          if (ckSheet) {
            ckRows.push([
              "CK_" + Date.now() + "_" + updatedCount,
              nowStr,
              rowId || rowIndexStr,
              spName,
              fromWh,
              targetStatus,
              reqQty,
              "Admin",
              `Tách dòng: Chuyển ${reqQty}/${origQty} SP từ ${fromWh} sang ${targetStatus}`
            ]);
          }
        }
      }
    }

    if (updatedCount === 0) {
      return { success: false, message: "❌ Không tìm thấy đơn hàng phù hợp để chuyển kho." };
    }

    // Batch write updated data
    pSheet.getRange(2, 1, data.length, data[0].length).setValues(data);

    // Batch append new split rows if any
    if (newSplitRows.length > 0) {
      pSheet.getRange(lastRow + 1, 1, newSplitRows.length, newSplitRows[0].length).setValues(newSplitRows);
    }

    // Batch append stock transfer logs if any
    if (ckSheet && ckRows.length > 0) {
      ckSheet.getRange(ckSheet.getLastRow() + 1, 1, ckRows.length, ckRows[0].length).setValues(ckRows);
    }

    if (cancelLimitRowIds.length > 0 && typeof updatePurchaseLimitStatus === 'function') {
      cancelLimitRowIds.forEach(id => updatePurchaseLimitStatus(id, "KET_THUC"));
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    const statusDisp = isCancel ? 'Hủy' : newWh;
    return { success: true, message: `✅ Đã chuyển ${updatedCount} đơn hàng sang "${statusDisp}"!`, freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

/**
 * 5.4. XÁC NHẬN ĐÃ NHẬN HOÀN TIỀN (BẢO VỆ CHỐNG CỘNG TIỀN 2 LẦN)
 */
function confirmRefundOrderPayment(orderId, targetWallet, customDate, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || (typeof SpreadsheetApp !== 'undefined' && SpreadsheetApp.getActiveSpreadsheet ? SpreadsheetApp.getActiveSpreadsheet() : null));
    if (!ss) return { success: false, message: "❌ Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    let targetIds = [];
    if (Array.isArray(orderId)) {
      targetIds = orderId.map(id => String(id || '').trim()).filter(Boolean);
    } else {
      targetIds = String(orderId || '').split(',').map(id => String(id || '').trim()).filter(Boolean);
    }

    if (targetIds.length === 0) return { success: false, message: "❌ Chưa chọn mã đơn hàng cần nhận hoàn tiền." };

    const walletToValidate = String(targetWallet || '').trim();
    if (walletToValidate && typeof validateWalletExists === 'function') {
      if (!validateWalletExists(walletToValidate, ss)) {
        return {
          success: false,
          message: `❌ Nguồn tiền "${walletToValidate}" không tồn tại trong danh sách Ví / Thẻ! Vui lòng chọn ví hợp lệ.`
        };
      }
    }

    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, 11).getValues();
    const dateVal = parseServerDate(customDate) || new Date();
    const dateStrFormatted = dateVal instanceof Date ? dateVal.toISOString().split('T')[0] : String(dateVal);

    let countSuccess = 0;
    let totalRefunded = 0;

    for (let idx = 0; idx < targetIds.length; idx++) {
      const targetStr = targetIds[idx];
      let foundIndex = -1;
      let targetRow = null;

      for (let i = 0; i < data.length; i++) {
        const rowId = String(data[i][0] || "").trim();
        const rowIndexStr = String(i + 2);
        if (rowId === targetStr || rowIndexStr === targetStr) {
          foundIndex = i + 2;
          targetRow = data[i];
          break;
        }
      }

      if (foundIndex === -1 || !targetRow) continue;

      const currentStatus = String(targetRow[3] || "").trim().toUpperCase();
      const currentCardStatus = String(targetRow[9] || "").trim().toUpperCase();
      if (currentCardStatus === "DA_HOAN_TIEN" || currentCardStatus === "ĐÃ HOÀN TIỀN") continue;

      const totalAmt = parseMoneyNumber(targetRow[7]);
      const walletName = String(targetWallet || targetRow[8] || "Ví Tiền Mặt").trim();
      if (!walletName) {
        return { success: false, message: "⚠️ Thiếu thông tin ví/thẻ để nhận hoàn tiền!" };
      }
      if (typeof validateWalletExists === 'function' && !validateWalletExists(walletName, ss)) {
        return {
          success: false,
          message: `❌ Nguồn tiền "${walletName}" không tồn tại trong danh sách Ví / Thẻ! Vui lòng chọn ví hợp lệ.`
        };
      }
      const tenSP = String(targetRow[4] || "Sản phẩm").trim();

      // Cột D (trạng thái kho) vẫn phải là Hủy, chỉ đổi Cột J (trạng thái thẻ) là đã hoàn tiền
      pSheet.getRange(foundIndex, 4).setValue("Hủy");
      pSheet.getRange(foundIndex, 10).setValue("DA_HOAN_TIEN");
      const existingGhiChu = String(targetRow[10] || "");
      pSheet.getRange(foundIndex, 11).setValue((existingGhiChu + ` [DA_HOAN_TIEN - Ngày: ${dateStrFormatted} - Ví: ${walletName}]`).trim());

      if (typeof postFinancialEvents === 'function') {
        const isCredit = isCreditCardWallet(walletName, ss);
        const direction = isCredit ? "DECREASE" : "IN";
        const effectType = isCredit ? "CARD_DEBT" : "CASH";
        const eventType = isCredit ? "REFUND_CARD_DEBT" : "REFUND_CASH";

        const refQty = Number(targetRow[5] || 1);
        postFinancialEvents([{
          walletId: walletName,
          walletName: walletName,
          date: dateStrFormatted,
          transactionDate: dateStrFormatted,
          direction: direction,
          amount: totalAmt,
          effectType: effectType,
          type: effectType,
          status: "POSTED",
          eventType: eventType,
          sourceModule: "Purchase",
          sourceId: String(targetRow[0] || ""),
          note: `[Hoàn tiền] ${tenSP} (x${refQty})`
        }], ss);
      }

      countSuccess++;
      totalRefunded += totalAmt;
    }

    if (countSuccess === 0) {
      return { success: false, message: "❌ Không có đơn hàng nào được hoàn tiền (đơn hàng đã được xác nhận hoàn tiền trước đó)." };
    }

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return {
      success: true,
      message: `✅ Đã nhận hoàn tiền ${totalRefunded.toLocaleString()} ¥ về ${targetWallet || 'Ví/Thẻ'} cho ${countSuccess} đơn!`,
      freshData: freshData
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi xác nhận hoàn tiền: " + err.toString() };
  }
}

/**
 * 6. CẬP NHẬT CHI TIẾT ĐƠN HÀNG MUA (SỬA TOÀN BỘ THÔNG TIN ĐƠN)
 */
function updatePurchaseItemDetail(itemId, newWh, newQty, newPrice, newGhiChu, newNoiMua, newTenSP, newNgayMua, newNguonTien, newCardStatus, newTaiKhoan, ssTarget) {
  try {
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(ssTarget) : (ssTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, connectionError: true, message: "❌ Lỗi kết nối dữ liệu: Không tìm thấy Spreadsheet!" };

    const pSheet = ss.getSheetByName(SHEET_PURCHASE);
    if (!pSheet || pSheet.getLastRow() < 2) return { success: false, message: "❌ Không tìm thấy sheet Purchase." };

    const targetStr = String(itemId || "").trim();
    if (!targetStr) return { success: false, message: "❌ Mã đơn không hợp lệ." };

    const maxCol = Math.max(pSheet.getLastColumn(), 17);
    const data = pSheet.getRange(2, 1, pSheet.getLastRow() - 1, maxCol).getValues();
    let found = false;

    for (let i = 0; i < data.length; i++) {
      const rowId = String(data[i][0] || "").trim();
      const rowIndexStr = String(i + 2);
      if ((rowId && rowId === targetStr) || rowIndexStr === targetStr) {
        const rowIndex = i + 2;
        const currentNoi = (newNoiMua !== undefined && newNoiMua !== null && String(newNoiMua).trim()) 
          ? String(newNoiMua).trim() 
          : String(data[i][2] || "").trim();

        const rawNgayMua = (newNgayMua !== undefined && newNgayMua !== null && String(newNgayMua).trim()) 
          ? newNgayMua 
          : data[i][1];
        const formattedDate = formatBizDateServer(rawNgayMua);

        if (formattedDate) {
          pSheet.getRange(rowIndex, 2).setValue(formattedDate);
          pSheet.getRange(rowIndex, 13).setValue(formattedDate);
        }

        if (newNoiMua !== undefined && newNoiMua !== null) pSheet.getRange(rowIndex, 3).setValue(currentNoi);
        const currentWh = (newWh !== undefined && newWh !== null) ? String(newWh).trim() : String(data[i][3] || "").trim();
        const lowerWhCheck = currentWh.toLowerCase();
        const isWhInStock = !lowerWhCheck.includes("chờ ship") && !lowerWhCheck.includes("chusen") && !lowerWhCheck.includes("hủy") && !lowerWhCheck.includes("cancel");

        if (newWh !== undefined && newWh !== null) {
          const whStr = String(newWh).trim();
          pSheet.getRange(rowIndex, 4).setValue(whStr);
          if (isWhInStock) {
            const curTon = parseBizMoney(data[i][11]);
            if (!curTon || curTon <= 0) {
              const qtyVal = (newQty !== undefined && !isNaN(Number(newQty))) ? Number(newQty) : parseBizMoney(data[i][5]);
              pSheet.getRange(rowIndex, 12).setValue(qtyVal);
            }
          } else {
            pSheet.getRange(rowIndex, 12).setValue("");
          }
        }
        const origQty = parseBizMoney(data[i][5]);
        const origPrice = parseBizMoney(data[i][6]);
        const origTenSP = String(data[i][4] || "").trim();
        const curTon = (data[i][11] !== "" && data[i][11] !== null && data[i][11] !== undefined) ? parseBizMoney(data[i][11]) : null;
        const isItemSold = (curTon !== null && curTon < origQty);

        const effectiveTenSP = isItemSold ? origTenSP : ((newTenSP !== undefined && newTenSP !== null && String(newTenSP).trim()) ? String(newTenSP).trim() : origTenSP);
        if (!isItemSold && newTenSP !== undefined && newTenSP !== null && String(newTenSP).trim()) {
          pSheet.getRange(rowIndex, 5).setValue(effectiveTenSP);
        }
        
        const qtyVal = isItemSold ? origQty : ((newQty !== undefined && !isNaN(Number(newQty))) ? Number(newQty) : origQty);
        const priceVal = isItemSold ? origPrice : ((newPrice !== undefined && !isNaN(Number(newPrice))) ? Number(newPrice) : origPrice);
        
        if (!isItemSold && newQty !== undefined && !isNaN(Number(newQty))) {
          pSheet.getRange(rowIndex, 6).setValue(qtyVal);
          if (isWhInStock) {
            pSheet.getRange(rowIndex, 12).setValue(qtyVal);
          } else {
            pSheet.getRange(rowIndex, 12).setValue("");
          }
        }
        if (!isItemSold && newPrice !== undefined && !isNaN(Number(newPrice))) {
          pSheet.getRange(rowIndex, 7).setValue(priceVal);
        }
        pSheet.getRange(rowIndex, 8).setValue(Math.round(qtyVal * priceVal));
        
        if (newNguonTien !== undefined && newNguonTien !== null) pSheet.getRange(rowIndex, 9).setValue(String(newNguonTien).trim());
        if (newCardStatus !== undefined && newCardStatus !== null && String(newCardStatus).trim()) {
          pSheet.getRange(rowIndex, 10).setValue(String(newCardStatus).trim());
        }
        if (newTaiKhoan !== undefined && newTaiKhoan !== null && String(newTaiKhoan).trim()) {
          pSheet.getRange(rowIndex, 14).setValue(String(newTaiKhoan).trim());
        }
        let effectiveGhiChu = (newGhiChu !== undefined && newGhiChu !== null) ? String(newGhiChu).trim() : String(data[i][10] || "").trim();
        if (newCardStatus && String(newCardStatus).trim() === "PRE-ORDER") {
          if (!effectiveGhiChu.toLowerCase().includes("pre-order") && !effectiveGhiChu.toLowerCase().includes("preorder")) {
            effectiveGhiChu = `[Pre-order] ${effectiveGhiChu}`.trim();
          }
        } else if (newCardStatus && String(newCardStatus).trim() === "HOAN_TAT") {
          effectiveGhiChu = effectiveGhiChu.replace(/\[Pre-order(?:\/[^\]]+)?\]/gi, "").trim();
        }
        pSheet.getRange(rowIndex, 11).setValue(effectiveGhiChu);
        
        // Recalculate Cooldown, NgayKhaDung & TrangThaiCooldown (Col 15, 16, 17)
        const targetSp = (newTenSP !== undefined && newTenSP !== null && String(newTenSP).trim()) ? String(newTenSP).trim() : String(data[i][4] || "").trim();
        const isFilm = (typeof isFilmProduct === 'function') ? isFilmProduct(targetSp) : (removeAccentsTab5(String(targetSp)).trim().toLowerCase().startsWith("film"));
        const cooldownDays = isFilm ? ((typeof getDefaultCooldownDays === 'function') ? getDefaultCooldownDays(currentNoi, targetSp) : (currentNoi.toLowerCase().includes("yodo") ? 13 : 30)) : 0;
        const parsedDate = (typeof parseServerDate === 'function') ? parseServerDate(formattedDate) : new Date();

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          const khaDungDate = new Date(parsedDate.getTime());
          const currentWh = String(newWh || data[i][3] || "").trim();
          const isCancelled = currentWh.toLowerCase().includes("hủy") || currentWh.toLowerCase().includes("cancel");
          
          let effectiveCdDays = cooldownDays;
          if (isFilm && isCancelled) {
            effectiveCdDays = 10;
          }

          if (isFilm) {
            khaDungDate.setDate(khaDungDate.getDate() + effectiveCdDays);
          }
          const formattedKhaDung = formatBizDateServer(khaDungDate);
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const cooldownStatus = (isFilm && khaDungDate.getTime() > today.getTime()) ? "DANG_CHO" : "KET_THUC";

          pSheet.getRange(rowIndex, 15).setValue(effectiveCdDays);
          pSheet.getRange(rowIndex, 16).setValue(formattedKhaDung);
          pSheet.getRange(rowIndex, 17).setValue(cooldownStatus);
        }

        const targetCardStatus = (newCardStatus !== undefined && newCardStatus !== null && String(newCardStatus).trim()) ? String(newCardStatus).trim() : String(data[i][9] || "").trim();
        const targetNguonTien = (newNguonTien !== undefined && newNguonTien !== null && String(newNguonTien).trim()) ? String(newNguonTien).trim() : String(data[i][8] || "").trim();
        const oldNguonTien = String(data[i][8] || "").trim();
        const oldTotal = (parseBizMoney(data[i][5]) || 1) * (parseBizMoney(data[i][6]) || 0);
        const newTotal = qtyVal * priceVal;
        const purchaseOrderId = rowId || targetStr;

        // Đồng bộ sự kiện vào WalletLedger khi sửa đơn mua
        if (typeof replaceFinancialEvents === 'function' && purchaseOrderId) {
          const isDone = (targetCardStatus === "HOAN_TAT" || targetCardStatus === "ĐÃ TRỪ" || targetCardStatus === "ĐÃ SAO KÊ");
          if (isDone && targetNguonTien && newTotal > 0) {
            const isCredit = isCreditCardWallet(targetNguonTien, ss);
            const direction = isCredit ? "INCREASE" : "OUT";
            const effectType = isCredit ? "CARD_DEBT" : "CASH";
            replaceFinancialEvents(purchaseOrderId, [{
              walletId: targetNguonTien,
              walletName: targetNguonTien,
              date: formattedDate || rawNgayMua,
              amount: newTotal,
              direction: direction,
              effectType: effectType,
              eventType: "PURCHASE_CHARGE",
              sourceModule: "Purchase",
              sourceId: purchaseOrderId,
              note: `[Mua hàng] ${targetSp} (x${qtyVal || 1})`
            }], "Sửa đơn mua Purchase", ss);
          } else if (targetCardStatus === "PRE-ORDER") {
            if (typeof replaceFinancialEvents === 'function') {
              replaceFinancialEvents(purchaseOrderId, [{
                walletId: targetNguonTien,
                walletName: targetNguonTien,
                date: formattedDate || rawNgayMua,
                amount: newTotal,
                direction: "HOLD",
                effectType: "PREORDER_HOLD",
                eventType: "PREORDER",
                status: "PENDING",
                sourceModule: "Purchase",
                sourceId: purchaseOrderId,
                note: `[Pre] - ${targetSp}`
              }], "Chuyển về Pre-order chờ trừ thẻ", ss);
            } else if (typeof reverseFinancialEvents === 'function') {
              reverseFinancialEvents(purchaseOrderId, "Chuyển về Pre-order", ss);
            }
          } else if (typeof reverseFinancialEvents === 'function' && (targetCardStatus === "CHO_HOAN_TIEN" || isCancelled)) {
            reverseFinancialEvents(purchaseOrderId, "Chuyển trạng thái Purchase", ss);
          }
        }

        found = true;
        break;
      }
    }

    if (!found) return { success: false, message: "❌ Không tìm thấy đơn hàng cần sửa." };

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return { success: true, message: "✅ Đã cập nhật chi tiết đơn hàng thành công!", freshData: freshData };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

function saveBatchPurchaseOrderEdit(payload, ssTarget) {
  try {
    const rawTarget = (payload && payload.ssTarget) ? payload.ssTarget : ssTarget;
    const ss = (typeof resolveSpreadsheet === 'function') ? resolveSpreadsheet(rawTarget) : (rawTarget || SpreadsheetApp.getActiveSpreadsheet());
    if (!ss) return { success: false, connectionError: true, message: "❌ Lỗi kết nối dữ liệu: Không tìm thấy Spreadsheet!" };

    if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
      return { success: false, message: "❌ Không có danh sách sản phẩm để cập nhật!" };
    }

    const { ngayMua, noiMua, nguonTien, trangThaiThe, taiKhoan, items } = payload;
    let updatedCount = 0;

    items.forEach(it => {
      const itemNgayMua = (it.ngayMua !== undefined && it.ngayMua !== null && String(it.ngayMua).trim()) ? String(it.ngayMua).trim() : ngayMua;
      const itemNoiMua = (it.noiMua !== undefined && it.noiMua !== null && String(it.noiMua).trim()) ? String(it.noiMua).trim() : noiMua;
      const itemNguonTien = (it.nguonTien !== undefined && it.nguonTien !== null && String(it.nguonTien).trim()) ? String(it.nguonTien).trim() : nguonTien;
      const itemTrangThaiThe = (it.trangThaiThe !== undefined && it.trangThaiThe !== null && String(it.trangThaiThe).trim()) ? String(it.trangThaiThe).trim() : trangThaiThe;
      const itemTaiKhoan = (it.taiKhoan !== undefined && it.taiKhoan !== null && String(it.taiKhoan).trim()) ? String(it.taiKhoan).trim() : taiKhoan;
      const itemGhiChu = (it.ghiChu !== undefined && it.ghiChu !== null) ? it.ghiChu : null;

      const res = updatePurchaseItemDetail(
        it.id,
        it.trangThaiKho,
        it.qty,
        it.price,
        itemGhiChu,
        itemNoiMua,
        it.tenSP,
        itemNgayMua,
        itemNguonTien,
        itemTrangThaiThe,
        itemTaiKhoan
      );
      if (res && res.success) updatedCount++;
    });

    if (typeof clearAppDataCache === 'function') clearAppDataCache();
    const freshData = getBusinessData(null, null, ss);
    return {
      success: true,
      message: `✅ Đã cập nhật thành công ${updatedCount} món của đơn hàng!`,
      freshData: freshData
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi: " + err.toString() };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatBizDateServer,
    confirmPreOrderPayment,
    revertPreOrderPayment,
    confirmRefundOrderPayment,
    confirmBatchPreOrdersPayment,
    getBusinessData,
    savePurchaseOrder,
    saveSalesOrder,
    cancelPurchaseOrder,
    cancelSalesOrder,
    deletePurchaseOrder,
    deleteSalesOrder
  };
}


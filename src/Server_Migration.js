// ==========================================
// FILE: Server_Migration.js
// NHIỆM VỤ: Import & Tự Động Ánh Xạ Dữ Liệu Cũ (Tháng 1 -> Tháng 8) Sang Hệ Thống Mới
// ==========================================

function cleanLegacyMoney(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let str = String(val).trim().replace(/¥/g, '').replace(/,/g, '');
  if ((str.match(/\./g) || []).length >= 1) {
    str = str.replace(/\./g, '');
  }
  const cleanStr = str.replace(/[^0-9-]/g, '');
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

function cleanLegacyDate(val) {
  if (!val) return typeof Utilities !== 'undefined' ? Utilities.formatDate(new Date(), "Asia/Tokyo", "dd/MM/yyyy") : "01/01/2026";
  const str = String(val).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(str)) {
    const parts = str.split(' ')[0].split('/');
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const parts = str.split(' ')[0].split('-');
    return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
  }
  return str;
}

function mapLegacyWallet(val) {
  if (!val) return "";
  return String(val).trim();
}

function parseLegacyRow(row) {
  if (!row || row.length < 3) return { target: "IGNORE" };
  const col0 = String(row[0] || "").trim();
  const col2 = String(row[2] || "").trim();

  // Skip table header rows
  if (col0.toUpperCase() === "ID" || col2.toLowerCase().includes("mặt hàng") || col2.toLowerCase().includes("loại nợ")) {
    return { target: "IGNORE" };
  }

  // === FORMAT 1: BẢNG KINH DOANH (DT... / MUA / BÁN) ===
  if (col0.startsWith("DT") || col2.toUpperCase() === "MUA" || col2.toUpperCase() === "BÁN") {
    const id = col0 || ("DT" + Date.now().toString().slice(-6));
    const date = cleanLegacyDate(row[1]);
    const loai = col2.toUpperCase() === "MUA" ? "MUA" : "BÁN";
    const itemName = String(row[3] || "").trim();
    const source = mapLegacyWallet(row[4]);
    const status = String(row[5] || "").trim();
    const qty = cleanLegacyMoney(row[6]) || 1;
    const buyPrice = cleanLegacyMoney(row[7]);
    const sellPrice = cleanLegacyMoney(row[8]);
    const paidDate = cleanLegacyDate(row[9]);
    const linkTC = String(row[10] || "").trim();
    const profit = cleanLegacyMoney(row[11]);

    return {
      target: "BUSINESS_TABLE",
      data: { id, date, loai, itemName, source, status, qty, buyPrice, sellPrice, paidDate, linkTC, profit }
    };
  }

  // === FORMAT 2: BẢNG CÔNG NỢ (CN... / PThu / PTrả) ===
  if (col0.startsWith("CN") || col2.startsWith("PThu") || col2.startsWith("PTrả") || col2.includes("Mượn") || col2.includes("Ứng")) {
    const id = col0 || ("CN" + Date.now().toString().slice(-6));
    const date = cleanLegacyDate(row[1]);
    const loaiNo = col2;
    const partner = String(row[3] || "").trim();
    const desc = String(row[4] || "").trim();
    const source = mapLegacyWallet(row[5]);
    const amount = cleanLegacyMoney(row[6]);
    const status = String(row[7] || "").trim();
    const paidDate = cleanLegacyDate(row[8]);
    const linkTC = String(row[9] || "").trim();

    const isDone = status.toLowerCase().includes("đã tt") || status.toLowerCase().includes("đã thanh toán");

    return {
      target: "DEBT_TABLE",
      data: { id, date, loaiNo, partner, desc, source, amount, isDone, paidDate, linkTC }
    };
  }

  // === FORMAT 3: BẢNG THU CHI (TC... / Chi / Thu) ===
  const id = col0 || ("TC" + Date.now().toString().slice(-6));
  const date = cleanLegacyDate(row[1]);
  const loaiRaw = col2 || "Chi";
  const loai = loaiRaw.toLowerCase().includes("thu") ? "Thu" : "Chi";
  const huRaw = String(row[3] || "").trim();
  const subCat = String(row[4] || "").trim();
  const walletRaw = String(row[5] || "").trim();
  const wallet = mapLegacyWallet(walletRaw);
  const desc = String(row[6] || "").trim();
  const amount = cleanLegacyMoney(row[7]);
  const refId = String(row[8] || "").trim();

  const fullDesc = subCat ? (desc ? `${subCat} - ${desc}` : subCat) : desc;

  if (huRaw.toLowerCase().includes("kinh doanh") || subCat.toLowerCase().includes("tenbai") || desc.toLowerCase().includes("tenbai")) {
    return {
      target: "BUSINESS",
      data: { id, date, loai, subCat, wallet, desc: fullDesc, amount, refId }
    };
  }

  if (huRaw.toLowerCase().includes("công nợ") || subCat.toLowerCase().includes("ứng") || subCat.toLowerCase().includes("công nợ") || refId.startsWith("CN")) {
    return {
      target: "DEBT",
      data: { id, date, loai, subCat, wallet, desc: fullDesc, amount, refId }
    };
  }

  let finalHu = huRaw;
  if (huRaw.startsWith("-----") || huRaw.startsWith("----")) {
    const cleanHu = huRaw.replace(/^-+/, "").trim();
    if (cleanHu === "Tất toán thẻ") finalHu = "----Tất toán thẻ";
    else if (cleanHu === "CK nội bộ") finalHu = "----CK Nội Bộ";
    else if (cleanHu === "Thu nhập") finalHu = "----Thu nhập";
    else if (cleanHu === "Trích trước") finalHu = "Đầu tư";
    else finalHu = cleanHu || "Thiết yếu";
  } else if (!finalHu) {
    finalHu = "Thiết yếu";
  }

  if (loai === "Thu" && (!finalHu || finalHu === "Thu Chi" || finalHu === "Khác")) {
    finalHu = "----Thu nhập";
  }

  return {
    target: "FAMILY",
    data: {
      id: id,
      date: date,
      loai: loai,
      hu: finalHu,
      noidung: fullDesc || subCat || "Giao dịch cũ",
      sotien: amount,
      nguontien: wallet,
      codinh: desc.toLowerCase().includes("dinh ky") ? "Có" : "",
      ghichu: `Import cũ [${id}] ${refId ? 'Ref: ' + refId : ''}`.trim()
    }
  };
}

function importLegacyTSVData(tsvText, ssTarget) {
  try {
    if (!tsvText || !String(tsvText).trim()) {
      return { success: false, message: "❌ Không có dữ liệu đầu vào." };
    }

    const ss = ssTarget || SpreadsheetApp.getActiveSpreadsheet();
    const lines = String(tsvText).trim().split(/\r?\n/);

    let countFamily = 0;
    let countBusiness = 0;
    let countDebt = 0;

    const familyRows = [];
    const businessRows = [];
    const purchaseRows = [];
    const salesRows = [];
    const debtRows = [];

    lines.forEach(line => {
      if (!line.trim()) return;
      const parts = line.split('\t');
      if (parts.length < 3) return;

      const parsed = parseLegacyRow(parts);
      if (parsed.target === "IGNORE") return;

      if (parsed.target === "FAMILY") {
        const d = parsed.data;
        familyRows.push([
          d.id,
          d.date,
          d.loai,
          d.hu,
          d.noidung,
          d.sotien,
          d.nguontien,
          d.codinh,
          d.ghichu
        ]);
        countFamily++;
      } else if (parsed.target === "BUSINESS_TABLE") {
        const d = parsed.data;
        if (d.loai === "MUA") {
          purchaseRows.push([
            d.id,
            d.date,
            "Nhà cung cấp cũ",
            "Kho Nhật",
            d.itemName || "Hàng Tenbai cũ",
            d.qty,
            d.buyPrice,
            d.buyPrice * d.qty,
            d.source,
            `Import cũ [${d.id}] Vị trí: ${d.status || ''}`
          ]);
          businessRows.push([
            d.id,
            d.date,
            "Chi",
            d.buyPrice * d.qty,
            d.source,
            `[MUA] ${d.itemName} (SL: ${d.qty})`
          ]);
        } else if (d.loai === "BÁN") {
          if (d.sellPrice > 0) {
            salesRows.push([
              d.id,
              d.paidDate || d.date,
              "Khách lẻ cũ",
              d.itemName || "Hàng Tenbai cũ",
              d.qty,
              d.sellPrice,
              d.sellPrice * d.qty,
              d.source,
              `Import cũ [${d.id}] Lãi/Lỗ: ${d.profit}`
            ]);
            businessRows.push([
              d.id,
              d.paidDate || d.date,
              "Thu",
              d.sellPrice * d.qty,
              d.source,
              `[BÁN] ${d.itemName} (SL: ${d.qty})`
            ]);
          }
        }
        countBusiness++;
      } else if (parsed.target === "DEBT_TABLE") {
        const d = parsed.data;
        const loaiCode = d.loaiNo.includes("PThu") ? "CHO_VAY" : "NO_CAN_TRA";
        debtRows.push([
          d.id,
          d.date,
          d.partner || "Đối tác cũ",
          loaiCode,
          d.desc || d.loaiNo,
          d.amount,
          d.source,
          d.isDone ? d.amount : 0,
          d.paidDate || "",
          d.isDone ? 0 : d.amount,
          d.isDone ? "HOAN_TAT" : "DANG_NO"
        ]);
        countDebt++;
      } else if (parsed.target === "BUSINESS") {
        const d = parsed.data;
        if (d.loai === "Chi") {
          purchaseRows.push([
            d.refId || d.id,
            d.date,
            "Nhà cung cấp cũ",
            "Kho Nhật",
            d.subCat || "Sản phẩm cũ",
            1,
            d.amount,
            d.amount,
            d.wallet,
            `Import cũ [${d.id}]`
          ]);
        }
        businessRows.push([
          d.id,
          d.date,
          d.loai,
          d.amount,
          d.wallet,
          d.desc
        ]);
        countBusiness++;
      } else if (parsed.target === "DEBT") {
        const d = parsed.data;
        debtRows.push([
          d.refId || d.id,
          d.date,
          d.subCat || "Đối tác cũ",
          d.loai === "Chi" ? "CHO_VAY" : "NO_CAN_TRA",
          d.desc,
          d.amount,
          d.wallet,
          0,
          "",
          d.amount,
          "DANG_NO"
        ]);
        countDebt++;
      }
    });

    // Batch Insert Into Sheets
    if (familyRows.length > 0 && ss) {
      let fSheet = ss.getSheetByName("Family") || ss.getSheetByName("ThuChi");
      if (!fSheet) {
        fSheet = ss.insertSheet("Family");
        fSheet.appendRow(["ID", "Timestamp", "Loại", "Hũ", "Nội dung", "Số tiền", "Ví/Thẻ Giao Dịch", "Là Khoản Cố Định?", "Ghi chú"]);
      }
      const startRow = fSheet.getLastRow() + 1;
      fSheet.getRange(startRow, 1, familyRows.length, 9).setValues(familyRows);
    }

    if (purchaseRows.length > 0 && ss) {
      let pSheet = ss.getSheetByName("Purchase") || ss.getSheetByName("MuaHang");
      if (!pSheet) {
        pSheet = ss.insertSheet("Purchase");
        pSheet.appendRow(["ID", "Ngày Mua", "Nơi mua", "Trạng Thái Kho", "Tên Sản Phẩm", "Số Lượng", "Giá Mua (1 cái)", "Tổng Tiền", "Nguồn Tiền Mua", "Ghi Chú"]);
      }
      const startRow = pSheet.getLastRow() + 1;
      pSheet.getRange(startRow, 1, purchaseRows.length, 10).setValues(purchaseRows);
    }

    if (salesRows.length > 0 && ss) {
      let sSheet = ss.getSheetByName("Sales") || ss.getSheetByName("BanHang");
      if (!sSheet) {
        sSheet = ss.insertSheet("Sales");
        sSheet.appendRow(["ID", "Ngày Bán", "Tên Khách Hàng", "Tên Sản Phẩm", "Số Lượng", "Giá Bán (1 cái)", "Tổng Tiền", "Nguồn Tiền Thu", "Ghi Chú"]);
      }
      const startRow = sSheet.getLastRow() + 1;
      sSheet.getRange(startRow, 1, salesRows.length, 9).setValues(salesRows);
    }

    if (businessRows.length > 0 && ss) {
      let bSheet = ss.getSheetByName("Business") || ss.getSheetByName("KinhDoanh");
      if (!bSheet) {
        bSheet = ss.insertSheet("Business");
        bSheet.appendRow(["ID", "Ngày", "Loại", "Số Tiền", "Nguồn tiền", "Nội Dung / Diễn Giải"]);
      }
      const startRow = bSheet.getLastRow() + 1;
      bSheet.getRange(startRow, 1, businessRows.length, 6).setValues(businessRows);
    }

    if (debtRows.length > 0 && ss) {
      let dSheet = ss.getSheetByName("Debt") || ss.getSheetByName("CongNo");
      if (!dSheet) {
        dSheet = ss.insertSheet("Debt");
        dSheet.appendRow(["ID", "Ngày Ghi Nợ", "Tên Đối Tượng", "Loại Nợ", "Nội dung", "Tổng Tiền Nợ", "Nguồn", "Đã Thanh Toán", "Ngày thanh toán", "Dư Nợ Còn Lại", "Trạng Thái"]);
      }
      const startRow = dSheet.getLastRow() + 1;
      dSheet.getRange(startRow, 1, debtRows.length, 11).setValues(debtRows);
    }

    if (typeof clearAppDataCache === 'function') {
      clearAppDataCache();
    }

    return {
      success: true,
      message: `✅ Đã chuyển đổi và nạp thành công: ${countFamily} giao dịch Thu Chi, ${countBusiness} đơn Kinh Doanh, ${countDebt} mục Công Nợ!`,
      details: { countFamily, countBusiness, countDebt }
    };
  } catch (err) {
    return { success: false, message: "❌ Lỗi import dữ liệu: " + err.toString() };
  }
}

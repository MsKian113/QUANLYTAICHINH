// ============================================================
// CẤU HÌNH
// ============================================================
const TAB_MUA = "Purchase";
const TAB_BAN = "Sales";
const TAB_TC = "Business";
const TAB_WALLETS = "Wallets";

// ============================================================
// HÀM CƠ BẢN
// ============================================================
function getSheet(sheetName) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}

// ============================================================
// 1. LẤY DANH SÁCH THANH TOÁN
// ============================================================
function getDanhSachThanhToan() {
  try {
    const sheet = getSheet(TAB_WALLETS);
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];

    const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    return data.flat().map(x => String(x).trim()).filter(x => x);
  } catch (err) {
    Logger.log("getDanhSachThanhToan error: " + err);
    return [];
  }
}

// ============================================================
// 2. LẤY DANH SÁCH SẢN PHẨM CÒN TRONG KHO
// ============================================================
function getDanhSachSanPhamInKho() {
  try {
    const sheet = getSheet(TAB_MUA);
    if (!sheet) return [];

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    const rows = sheet.getRange(2, 1, lastRow - 1, 10).getValues();
    const danhSach = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const orderId = String(r[0] || "").trim();
      const tenSP = String(r[4] || "").trim();
      const tonKho = Number(r[6]) || 0;
      const viTriKho = String(r[8] || "").trim();

      if (!tenSP) continue;
      if (tonKho <= 0) continue;

      const status = viTriKho.toLowerCase();

      // Không cho bán hàng chưa ship hoặc đã huỷ
      if (
        status.includes("chờ ship") ||
        status.includes("cho ship") ||
        status.includes("❌") ||
        status.includes("hủy") ||
        status.includes("huy")
      ) {
        continue;
      }

      danhSach.push({
        rowIndex: i + 2,
        orderId: orderId,
        tenSP: tenSP,
        tonKho: tonKho,
        viTriKho: viTriKho
      });
    }

    return danhSach.reverse();
  } catch (err) {
    Logger.log("getDanhSachSanPhamInKho error: " + err);
    return [];
  }
}

// Alias tương thích nếu cần
function getDanhSachSanPhamChoDoiKho() {
  return getDanhSachSanPhamInKho();
}

// ============================================================
// 3. LƯU ĐƠN MUA HÀNG
// ============================================================
function luuDonMuaHang(data) {
  try {
    const sheet = getSheet(TAB_MUA);
    if (!sheet) throw new Error("Không tìm thấy sheet MuaHang!");

    const sheetTC = getSheet(TAB_TC);

    if (!data.danhSachSP || data.danhSachSP.length === 0) {
      throw new Error("Chưa có sản phẩm!");
    }

    const now = new Date();
    const ngayMua = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
    const maDon = "MUA-" + Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMdd-HHmmss");

    let tongTienDonHang = 0;
    const rowsToAdd = [];

    data.danhSachSP.forEach(sp => {
      const tenSP = String(sp.ten || "").trim();
      const soLuong = Number(sp.sl) || 0;
      const giaYen = Number(sp.gia) || 0;

      if (!tenSP || soLuong <= 0) return;

      tongTienDonHang += soLuong * giaYen;

      rowsToAdd.push([
        maDon,                              // A Mã đơn
        ngayMua,                            // B Ngày mua
        data.sanMua || "",                  // C Sàn mua
        data.theQuet || "",                 // D Thẻ thanh toán
        tenSP,                              // E Tên SP
        soLuong,                            // F Số lượng nhập
        soLuong,                            // G Tồn kho
        giaYen,                             // H Giá nhập
        sp.trangThaiKho || "📦 Chờ Ship",   // I Vị trí kho
        data.ghiChu || ""                   // J Ghi chú
      ]);
    });

    if (rowsToAdd.length === 0) throw new Error("Không có sản phẩm hợp lệ!");

    // Ghi vào MuaHang
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);

    // Ghi CHI vào TaiChinh
    // Cấu trúc: A Ngày | B Loại | C Số tiền | D Nguồn | E Danh mục | F Ghi chú
    if (sheetTC && tongTienDonHang > 0) {
      sheetTC.appendRow([
        ngayMua,
        "Chi",
        tongTienDonHang,
        data.theQuet || "Không xác định",
        "Kinh doanh",
        "Mua hàng đơn " + maDon + " (" + (data.sanMua || "Không xác định") + ")"
      ]);
    }

    return "🟢 Đã lưu đơn mua hàng thành công!";
  } catch (error) {
    Logger.log("luuDonMuaHang error: " + error);
    throw new Error(error.message);
  }
}

// ============================================================
// 4. LƯU ĐƠN BÁN HÀNG
// ============================================================
function luuDonBanHang(data) {
  const sheetMua = getSheet(TAB_MUA);
  if (!sheetMua) throw new Error("Không tìm thấy sheet MuaHang!");

  const sheetBan = getSheet(TAB_BAN);
  if (!sheetBan) throw new Error("Không tìm thấy sheet BanHang!");

  const sheetTC = getSheet(TAB_TC);

  // Chấp nhận cả 2 tên field từ client: danhSachSP hoặc danhSachSPBan
  const danhSachSPBan = data.danhSachSP || data.danhSachSPBan;
  if (!danhSachSPBan || danhSachSPBan.length === 0) {
    throw new Error("Danh sách sản phẩm bán trống!");
  }

  const itemsToProcess = [];
  let tongTienDonHang = 0;

  // ========================================================
  // KIỂM TRA TỒN KHO TRƯỚC
  // ========================================================
  danhSachSPBan.forEach(sp => {
    const rowIndex = Number(sp.rowIndex);
    const soLuongBan = Number(sp.soLuong);
    const giaBan = Number(sp.giaBan);

    if (!rowIndex || soLuongBan <= 0 || giaBan < 0) {
      throw new Error("Dữ liệu sản phẩm bán không hợp lệ!");
    }

    const tonKhoHienTai = Number(sheetMua.getRange(rowIndex, 7).getValue()) || 0;

    if (soLuongBan > tonKhoHienTai) {
      const tenSPCheck = String(sheetMua.getRange(rowIndex, 5).getValue());
      throw new Error("Sản phẩm [" + tenSPCheck + "] không đủ tồn kho! Kho còn: " + tonKhoHienTai);
    }

    const maDonMua = String(sheetMua.getRange(rowIndex, 1).getValue()).trim();
    const tenSP = String(sheetMua.getRange(rowIndex, 5).getValue()).trim();

    tongTienDonHang += soLuongBan * giaBan;

    itemsToProcess.push({
      rowIndex: rowIndex,
      soLuongBan: soLuongBan,
      tonKhoHienTai: tonKhoHienTai,
      maDonMua: maDonMua,
      tenSP: tenSP,
      giaBan: giaBan
    });
  });

  if (itemsToProcess.length === 0) throw new Error("Không có sản phẩm hợp lệ!");

  // ========================================================
  // TẠO MÃ ĐƠN
  // ========================================================
  const now = new Date();
  const ngayBan = Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
  const maDonBan = "BAN-" + Utilities.formatDate(now, "Asia/Tokyo", "yyyyMMdd-HHmmss");
  const trangThaiTT = data.trangThaiTT || "🟡 Chờ thu";
  const hinhThucNhan = data.hinhThucNhan || "";
  const banRows = [];

  // ========================================================
  // TRỪ KHO + TẠO DỮ LIỆU BÁN
  // ========================================================
  itemsToProcess.forEach(item => {
    // Trừ tồn kho
    const tonKhoMoi = item.tonKhoHienTai - item.soLuongBan;
    sheetMua.getRange(item.rowIndex, 7).setValue(tonKhoMoi);

    // Ghi dòng bán
    banRows.push([
      maDonBan,          // A Mã đơn bán
      item.maDonMua,     // B Mã đơn mua
      ngayBan,           // C Ngày bán
      item.tenSP,        // D Tên SP
      item.soLuongBan,   // E SL bán
      item.giaBan,       // F Giá bán
      trangThaiTT,       // G Thanh toán
      hinhThucNhan       // H Nguồn nhận
    ]);
  });

  // Ghi tất cả sản phẩm cùng lúc
  sheetBan.getRange(sheetBan.getLastRow() + 1, 1, banRows.length, banRows[0].length).setValues(banRows);

  // ========================================================
  // NẾU ĐÃ THANH TOÁN → GHI THU 1 LẦN
  // ========================================================
  if (sheetTC && tongTienDonHang > 0 && trangThaiTT.includes("Đã TT")) {
    sheetTC.appendRow([
      ngayBan,
      "Thu",
      tongTienDonHang,
      hinhThucNhan,
      "Kinh doanh",
      "Thu tiền đơn bán: " + maDonBan + " (" + itemsToProcess.length + " sản phẩm)"
    ]);
  }

  return "🚀 Bán thành công " + itemsToProcess.length + " sản phẩm!";
}

// ============================================================
// 5. LẤY DANH SÁCH TẤT CẢ SẢN PHẨM (DÙNG CHO TAB CẬP NHẬT)
// ============================================================
function getDanhSachTatCaSP() {
  const result = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // ========================================================
  // MUA HÀNG
  // ========================================================
  const sheetMua = ss.getSheetByName(TAB_MUA);
  if (sheetMua) {
    const dataMua = sheetMua.getDataRange().getValues();
    for (let i = 1; i < dataMua.length; i++) {
      const r = dataMua[i];
      if (!r[4]) continue;

      result.push({
        rowIndex: i + 1,
        sheet: TAB_MUA,
        tenSP: r[4],
        soLuong: r[5],
        tonKho: r[6],
        gia: r[7],
        sanThe: r[3],
        info: "Tồn: " + r[6] + " | " + r[8]
      });
    }
  }

  // ========================================================
  // BÁN HÀNG
  // ========================================================
  const sheetBan = ss.getSheetByName(TAB_BAN);
  if (sheetBan) {
    const dataBan = sheetBan.getDataRange().getValues();
    for (let i = 1; i < dataBan.length; i++) {
      const r = dataBan[i];
      if (!r[3]) continue;

      result.push({
        rowIndex: i + 1,
        sheet: TAB_BAN,
        tenSP: r[3],
        soLuong: r[4],
        gia: r[5],
        sanThe: r[7],
        info: r[0] + " | " + r[6]
      });
    }
  }

  return result;
}

// ============================================================
// 6. CẬP NHẬT THÔNG TIN
// ============================================================
function capNhatThongTin(payload) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rowIndex = Number(payload.rowIndex);
  if (!rowIndex) throw new Error("Dòng dữ liệu không hợp lệ!");

  const sheetName = payload.sheet === TAB_BAN ? TAB_BAN : TAB_MUA;
  const sheet = ss.getSheetByName(sheetName);
  const sheetTC = ss.getSheetByName(TAB_TC);

  if (!sheet) throw new Error("Không tìm thấy sheet: " + sheetName);

  // ========================================================
  // A. SỬA CHI TIẾT
  // ========================================================
  if (payload.loai === "suaChiTiet") {

    // ------------------------------------------------------
    // MUA HÀNG
    // ------------------------------------------------------
    if (sheetName === TAB_MUA) {
      // Tên SP
      if (payload.tenSP) {
        sheet.getRange(rowIndex, 5).setValue(payload.tenSP);
      }

      // Số lượng - Tự động tính lại tồn kho
      if (payload.soLuong !== "") {
        const soLuongMoi = Number(payload.soLuong);
        if (soLuongMoi < 0) throw new Error("Số lượng không hợp lệ!");

        const soLuongCu = Number(sheet.getRange(rowIndex, 6).getValue()) || 0;
        const tonKhoCu = Number(sheet.getRange(rowIndex, 7).getValue()) || 0;

        // Đã bán = Số lượng ban đầu - tồn kho hiện tại
        const daBan = soLuongCu - tonKhoCu;
        const tonKhoMoi = soLuongMoi - daBan;

        if (tonKhoMoi < 0) {
          throw new Error("Số lượng mới không thể nhỏ hơn số lượng đã bán!");
        }

        sheet.getRange(rowIndex, 6).setValue(soLuongMoi);
        sheet.getRange(rowIndex, 7).setValue(tonKhoMoi);
      }

      // Giá nhập
      if (payload.gia !== "") {
        sheet.getRange(rowIndex, 8).setValue(Number(payload.gia));
      }

      // Thẻ
      if (payload.sanThe) {
        sheet.getRange(rowIndex, 4).setValue(payload.sanThe);
      }
    }

    // ------------------------------------------------------
    // BÁN HÀNG
    // ------------------------------------------------------
    else if (sheetName === TAB_BAN) {
      if (payload.tenSP) {
        sheet.getRange(rowIndex, 4).setValue(payload.tenSP);
      }
      if (payload.soLuong !== "") {
        sheet.getRange(rowIndex, 5).setValue(Number(payload.soLuong));
      }
      if (payload.gia !== "") {
        sheet.getRange(rowIndex, 6).setValue(Number(payload.gia));
      }
    }

    return "✅ Đã sửa chi tiết thành công!";
  }

  // ========================================================
  // B. CẬP NHẬT KHO
  // ========================================================
  if (payload.loai === "capNhatKho") {
    if (sheetName !== TAB_MUA) {
      throw new Error("Chỉ có thể cập nhật kho cho hàng mua!");
    }

    sheet.getRange(rowIndex, 9).setValue(payload.khoMoi);
    return "✅ Đã cập nhật kho: " + payload.khoMoi;
  }

  // ========================================================
  // C. CẬP NHẬT THANH TOÁN
  // ========================================================
  if (payload.loai === "capNhatTT") {
    if (sheetName !== TAB_BAN) {
      throw new Error("Chỉ có thể cập nhật thanh toán cho đơn bán!");
    }

    // Lấy mã đơn bán
    const maDonBan = String(sheet.getRange(rowIndex, 1).getValue()).trim();
    if (!maDonBan) throw new Error("Không tìm thấy mã đơn bán!");

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) throw new Error("Không có dữ liệu!");

    // Lấy toàn bộ dữ liệu BanHang
    const dataBan = sheet.getRange(2, 1, lastRow - 1, 8).getValues();

    let tongTien = 0;
    let daThanhToan = false;
    const rowsCanUpdate = [];

    // ======================================================
    // TÌM TOÀN BỘ SẢN PHẨM CÙNG MÃ ĐƠN
    // ======================================================
    for (let i = 0; i < dataBan.length; i++) {
      const r = dataBan[i];
      if (String(r[0]).trim() === maDonBan) {
        const soLuong = Number(r[4]) || 0;
        const giaBan = Number(r[5]) || 0;
        tongTien += soLuong * giaBan;

        if (String(r[6]).includes("Đã TT")) {
          daThanhToan = true;
        }

        rowsCanUpdate.push(i + 2);
      }
    }

    const hinhThucNhan = payload.hinhThucNhan || "";

    // ======================================================
    // CẬP NHẬT TOÀN BỘ ĐƠN
    // ======================================================
    rowsCanUpdate.forEach(row => {
      sheet.getRange(row, 7).setValue(payload.ttMoi);
      if (hinhThucNhan) {
        sheet.getRange(row, 8).setValue(hinhThucNhan);
      }
    });

    // ======================================================
    // CHỈ GHI THU 1 LẦN
    // ======================================================
    if (!daThanhToan && payload.ttMoi.includes("Đã TT") && sheetTC && tongTien > 0) {
      const ngay = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy-MM-dd HH:mm:ss");
      sheetTC.appendRow([
        ngay,
        "Thu",
        tongTien,
        hinhThucNhan,
        "Kinh doanh",
        "Thu tiền đơn bán: " + maDonBan
      ]);
    }

    return "✅ Đã cập nhật thanh toán toàn bộ đơn: " + maDonBan;
  }

  throw new Error("Loại thao tác không hợp lệ!");
}

// ============================================================
// 7. CẬP NHẬT NHIỀU SẢN PHẨM CÙNG LÚC
// DÙNG CHO "CẬP NHẬT KHO" / "CẬP NHẬT THANH TOÁN" Ở TAB 3
// ============================================================
function capNhatNhieuThongTin(payload) {
  const items = payload.items || [];
  if (items.length === 0) throw new Error("Chưa chọn sản phẩm nào!");

  const thanhCong = [];
  const loi = [];

  items.forEach(function(item) {
    try {
      const singlePayload = Object.assign({}, payload, {
        rowIndex: item.rowIndex,
        sheet: item.sheet
      });
      delete singlePayload.items;

      capNhatThongTin(singlePayload);
      thanhCong.push(item.tenSP || ("Dòng " + item.rowIndex));
    } catch (err) {
      loi.push((item.tenSP || ("Dòng " + item.rowIndex)) + ": " + err.message);
    }
  });

  let thongBao = "✅ Đã cập nhật " + thanhCong.length + "/" + items.length + " sản phẩm!";
  if (loi.length > 0) {
    thongBao += " ⚠️ Lỗi: " + loi.join(" | ");
  }

  return thongBao;
}

// ==================== 8. BÁO CÁO / TRA CỨU THEO LOẠI ====================
function layBaoCaoTraCuu(loaiBaoCao) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(TAB_MUA);
    if (!sheet) return { items: [], tongSoLuong: 0, tongTien: 0 };

    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { items: [], tongSoLuong: 0, tongTien: 0 };

    const items = [];
    let tongSoLuong = 0;
    let tongTien = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const orderId = String(r[0] || "").trim();
      const tenSP = String(r[4] || "").trim();
      const soLuong = Number(r[5]) || 0;
      const gia = Number(r[6]) || 0;
      const trangThaiKho = String(r[7] || "").trim();
      const khachMua = String(r[9] || "").trim();
      const trangThaiTT = String(r[10] || "").trim();

      if (!tenSP) continue;

      let match = false;
      switch (loaiBaoCao) {
        case "kho1f":   match = trangThaiKho === "🟢 Kho 1F" && khachMua === ""; break;
        case "kho2f":   match = trangThaiKho === "🟢 Kho 2F" && khachMua === ""; break;
        case "choship": match = trangThaiKho === "🟡 Chờ Ship" && khachMua === ""; break;
        case "chothu":  match = khachMua !== "" && trangThaiTT === "🟡 Chờ TT "; break;
        case "dathu":   match = khachMua !== "" && trangThaiTT === "🟢 Đã TT"; break;
        case "dahuy":   match = trangThaiKho === "🔴 Đã Hủy" || trangThaiTT === "🔴 Khách hủy đơn"; break;
      }

      if (match) {
        items.push({ rowIndex: i + 1, orderId, tenSP, soLuong, gia, trangThaiKho, khachMua, trangThaiTT });
        tongSoLuong += soLuong;
        tongTien += soLuong * gia;
      }
    }

    return { items: items.reverse(), tongSoLuong, tongTien };
  } catch (err) {
    Logger.log("layBaoCaoTraCuu error: " + err);
    return { items: [], tongSoLuong: 0, tongTien: 0 };
  }
}

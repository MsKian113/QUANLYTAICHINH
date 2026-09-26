const test = require('node:test');
const assert = require('node:assert/strict');

// Test helper mimicking updateBatchWarehouseStatus Option A logic
function mockUpdateBatchWarehouseStatus(purchaseData, itemsToTransfer, newStatus) {
  const items = Array.isArray(itemsToTransfer) ? itemsToTransfer : [itemsToTransfer];
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

  const logs = [];
  let updatedCount = 0;

  for (let i = 0; i < purchaseData.length; i++) {
    const rowId = String(purchaseData[i][0] || "").trim();
    if (Object.prototype.hasOwnProperty.call(transferMap, rowId)) {
      const origQty = Number(purchaseData[i][5]) || 0;
      const origPrice = Number(purchaseData[i][6]) || 0;
      const origTonKho = Number(purchaseData[i][11]) || origQty;
      const fromWh = String(purchaseData[i][3] || "").trim();
      const reqQty = transferMap[rowId];
      const spName = String(purchaseData[i][4] || "").trim();

      if (reqQty === null || reqQty >= origQty || origQty <= 1) {
        // Full transfer
        purchaseData[i][3] = newStatus;
        updatedCount++;
        logs.push({
          type: 'FULL',
          id: rowId,
          spName,
          fromWh,
          toWh: newStatus,
          qty: origQty
        });
      } else {
        // Partial transfer (Option A split)
        const remainingQty = origQty - reqQty;
        const remainingTotal = remainingQty * origPrice;
        const newTonKhoOrig = Math.max(0, origTonKho - reqQty);

        purchaseData[i][5] = remainingQty;
        purchaseData[i][7] = remainingTotal;
        purchaseData[i][11] = newTonKhoOrig;

        const newRowId = rowId + "_CK";
        const splitRow = [
          newRowId,
          purchaseData[i][1],
          purchaseData[i][2],
          newStatus,
          spName,
          reqQty,
          origPrice,
          reqQty * origPrice,
          purchaseData[i][8],
          purchaseData[i][9],
          (String(purchaseData[i][10] || "") + ` [Tách từ #${rowId}]`).trim(),
          reqQty
        ];
        purchaseData.push(splitRow);
        updatedCount++;
        logs.push({
          type: 'PARTIAL_SPLIT',
          id: rowId,
          newRowId,
          spName,
          fromWh,
          toWh: newStatus,
          qty: reqQty,
          remainingQty
        });
      }
    }
  }

  return { success: true, updatedCount, logs };
}

test('updateBatchWarehouseStatus performs full warehouse transfer when requested', () => {
  const mockPurchases = [
    ["#1024", "18/09/2026", "Amazon", "Kho 1F", "iPhone 15 Pro Max", 2, 145000, 290000, "Thẻ Credit", "", "Ghi chú", 2],
    ["#1025", "19/09/2026", "BicCamera", "Kho 1F", "Film Mini Instax", 10, 1200, 12000, "Ví ATM", "", "", 10]
  ];

  const res = mockUpdateBatchWarehouseStatus(mockPurchases, ["#1024"], "Kho 2F");
  assert.equal(res.success, true);
  assert.equal(res.updatedCount, 1);
  assert.equal(mockPurchases[0][3], "Kho 2F");
  assert.equal(res.logs[0].type, 'FULL');
});

test('updateBatchWarehouseStatus Option A splits row when partial Qty is transferred', () => {
  const mockPurchases = [
    ["#1025", "19/09/2026", "BicCamera", "Kho 1F", "Film Mini Instax", 10, 1200, 12000, "Ví ATM", "", "Đơn hộp quà", 10]
  ];

  // Transfer 6 out of 10 items to Kho 2F
  const res = mockUpdateBatchWarehouseStatus(mockPurchases, [{ id: "#1025", qty: 6 }], "Kho 2F");
  assert.equal(res.success, true);
  assert.equal(res.updatedCount, 1);

  // Original row remains at Kho 1F with remaining 4 items
  assert.equal(mockPurchases[0][3], "Kho 1F");
  assert.equal(mockPurchases[0][5], 4);
  assert.equal(mockPurchases[0][7], 4800);
  assert.equal(mockPurchases[0][11], 4);

  // Split row appended at Kho 2F with 6 items
  assert.equal(mockPurchases.length, 2);
  assert.equal(mockPurchases[1][0], "#1025_CK");
  assert.equal(mockPurchases[1][3], "Kho 2F");
  assert.equal(mockPurchases[1][5], 6);
  assert.equal(mockPurchases[1][7], 7200);
  assert.equal(mockPurchases[1][11], 6);
});

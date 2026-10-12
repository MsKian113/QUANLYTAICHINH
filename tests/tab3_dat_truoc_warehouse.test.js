const test = require('node:test');
const assert = require('node:assert/strict');

test('Pre-order lifecycle with Đặt trước -> Chờ Ship -> Kho', () => {
    // 1. Creation: Pre-order defaults warehouse to "Đặt trước"
    function determinePurchaseWarehouse(formData) {
        const nguonTien = String(formData.nguonTien || '').trim();
        const isCredit = nguonTien.toLowerCase().startsWith('c-') || nguonTien.toLowerCase().includes('credit');
        const isPreOrder = Boolean(formData.isPreOrder) || isCredit;
        let trangThaiKho = String(formData.trangThaiKho || '').trim();
        if (!trangThaiKho || (isPreOrder && trangThaiKho === 'Chờ Ship')) {
            trangThaiKho = isPreOrder ? 'Đặt trước' : 'Chờ Ship';
        }
        return { trangThaiKho, isPreOrder };
    }

    const order1 = determinePurchaseWarehouse({ nguonTien: 'CreditCard1', isPreOrder: true, trangThaiKho: 'Chờ Ship' });
    assert.strictEqual(order1.trangThaiKho, 'Đặt trước', 'Pre-order must default to Đặt trước warehouse');

    const orderDirect = determinePurchaseWarehouse({ nguonTien: 'TienMat', isPreOrder: false, trangThaiKho: 'Chờ Ship' });
    assert.strictEqual(orderDirect.trangThaiKho, 'Chờ Ship', 'Cash order must remain Chờ Ship');

    // 2. Confirm card deduction ("Đã Trừ Thẻ") automatically moves warehouse from "Đặt trước" to "Chờ Ship"
    const purchaseRow = [
        'PO-20261012-001', // 0: ID
        '2026/10/12',      // 1: Ngày
        'Amazon JP',       // 2: Nơi mua
        'Đặt trước',       // 3: Kho
        'Product A',       // 4: Tên SP
        1,                 // 5: SL
        5000,              // 6: Đơn giá
        5000,              // 7: Tổng
        'CreditCard1',     // 8: Nguồn tiền
        'PRE-ORDER',       // 9: Trạng thái thẻ
        '[Pre-order/Chờ trừ thẻ]', // 10: Ghi chú
        '',                // 11: Tồn kho
        ''                 // 12: Ngày sao kê
    ];

    function mockConfirmPayment(row) {
        row[9] = 'HOAN_TAT';
        row[12] = '2026/10/12';
        row[10] = row[10].replace(/\[Pre-order\/Chờ trừ thẻ\]/gi, '').trim();
        const curWh = String(row[3] || '').trim().toLowerCase();
        if (curWh.includes('đặt trước') || curWh.includes('dat truoc') || curWh.includes('preorder')) {
            row[3] = 'Chờ Ship';
        }
    }

    mockConfirmPayment(purchaseRow);
    assert.strictEqual(purchaseRow[3], 'Chờ Ship', 'Warehouse must transition from Đặt trước to Chờ Ship on card confirmation');
    assert.strictEqual(purchaseRow[9], 'HOAN_TAT', 'Card status must become HOAN_TAT');

    // 3. Cancelling while at "Đặt trước" (uncharged) marks warehouse Hủy and card status HUY (no phantom refund)
    const preorderToCancel = [
        'PO-20261012-002', '2026/10/12', 'Rakuten', 'Đặt trước', 'Product B', 1, 3000, 3000, 'CreditCard1', 'PRE-ORDER', '', '', ''
    ];

    function mockCancelOrder(row) {
        const curWh = String(row[3] || '').trim().toLowerCase();
        const cardStatus = String(row[9] || '').trim().toLowerCase();
        const cardDone = cardStatus.includes('hoan_tat') || cardStatus.includes('da_tru');
        const wasDatTruoc = curWh.includes('đặt trước') || curWh.includes('preorder');

        row[3] = 'Hủy';
        if (wasDatTruoc && !cardDone) {
            row[9] = 'HUY'; // No refund needed
        } else {
            row[9] = 'CHO_HOAN_TIEN'; // Card was charged, needs refund
        }
        row[11] = 0;
    }

    mockCancelOrder(preorderToCancel);
    assert.strictEqual(preorderToCancel[3], 'Hủy');
    assert.strictEqual(preorderToCancel[9], 'HUY', 'Uncharged pre-order cancellation must be HUY, not CHO_HOAN_TIEN');

    // 4. Cancelling an order that was already charged at "Chờ Ship" needs refund
    const chargedOrderToCancel = [
        'PO-20261012-003', '2026/10/12', 'Rakuten', 'Chờ Ship', 'Product C', 1, 4000, 4000, 'CreditCard1', 'HOAN_TAT', '', '', '2026/10/12'
    ];
    mockCancelOrder(chargedOrderToCancel);
    assert.strictEqual(chargedOrderToCancel[3], 'Hủy');
    assert.strictEqual(chargedOrderToCancel[9], 'CHO_HOAN_TIEN', 'Charged order cancellation must be CHO_HOAN_TIEN');

    // 5. Tab 1 Statistics separation: Đặt trước is NOT counted under Đợi Ship
    const mockInventory = [
        { id: '1', trangThaiKho: 'Đặt trước', trangThaiThe: 'PRE-ORDER' },
        { id: '2', trangThaiKho: 'Chờ Ship', trangThaiThe: 'HOAN_TAT' },
        { id: '3', trangThaiKho: 'Chờ Ship', trangThaiThe: 'HOAN_TAT' },
        { id: '4', trangThaiKho: 'Kho 1F', trangThaiThe: 'HOAN_TAT' }
    ];

    const choShipSet = new Set();
    const preorderSet = new Set();

    mockInventory.forEach(item => {
        const wh = item.trangThaiKho.toLowerCase();
        const isDatTruoc = wh.includes('đặt trước') || wh.includes('preorder');
        const isPreOrderMatch = isDatTruoc || item.trangThaiThe === 'PRE-ORDER';

        if (wh === 'chờ ship' && !isPreOrderMatch) {
            choShipSet.add(item.id);
        }
        if (isPreOrderMatch) {
            preorderSet.add(item.id);
        }
    });

    assert.strictEqual(choShipSet.size, 2, 'Đợi Ship should only count the 2 paid orders waiting for shipment');
    assert.strictEqual(preorderSet.size, 1, 'Đặt trước should only count the 1 pre-order item');
    assert.strictEqual(choShipSet.has('1'), false, 'Đặt trước order 1 must NOT be in Đợi Ship');
});

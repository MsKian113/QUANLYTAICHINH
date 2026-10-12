# BUSINESS RULES — FAMILY FINANCE APP

Version: 1.0
Purpose: QA/UAT baseline for Gemini or another QA agent.

## 1. Scope

The application is a family-finance system combining:
- Wallets / cash accounts
- Debit and credit cards
- Income & expenses
- Business / purchase / sales
- Personal debts
- Family/group expense splitting
- Settlement
- Inventory / pre-order lifecycle
- Reports/statistics
- Wallet checkpoints and rebuild
- Card security

The QA agent MUST use these rules as the source of truth. If code conflicts with a rule, report a BUG unless the rule is explicitly marked `NEEDS_CLARIFICATION`.

## 2. Core Accounting Principles

### BR-001 — Expense
`EXPENSE` represents actual economic spending.

### BR-002 — Transfer
A transfer moves money between accounts. It is NOT an expense.
Example: Wallet A -30,000 and Wallet B +30,000; total assets do not change.

### BR-003 — Liability Payment
A credit-card payment reduces cash and reduces card liability. It is NOT a new expense.
Example: Wallet -80,000 + Card Debt -80,000; expense remains the original purchase amount.

### BR-004 — Refund
A refund reverses or offsets the original economic spending according to the source transaction. It must not create an unexplained duplicate gain/loss.

### BR-005 — Idempotency
Repeated Save/Submit/Finalize actions must not create duplicate financial events, ledger entries, debt records, settlements, or stock movements.

## 3. Wallets

### BR-W001 — DEBIT
DEBIT represents cash/bank/debit money that can hold positive available funds.

### BR-W002 — CREDIT
CREDIT represents a credit-card liability account.

### BR-W003 — Wallet Balance
For a DEBIT wallet:
`CurrentBalance = CheckpointBalance + increases_after_checkpoint - decreases_after_checkpoint`

### BR-W004 — Materialized Balance
`CurrentBalance` is a materialized value used for fast display. It must remain consistent with the ledger.

### BR-W005 — Initial Balance
Original `InitialBalance` should be treated as historical baseline and must not be overwritten merely because a checkpoint is created.

### BR-W006 — Checkpoint
A checkpoint stores a snapshot of the wallet balance and timestamp. Historical transactions remain available.

### BR-W007 — Multiple Checkpoints
Multiple checkpoints must be auditable. Preferred structure: `WalletCheckpoints` with CheckpointID, WalletID, CheckpointDate, Balance, CreatedAt, CreatedBy, Status.

### BR-W008 — Rebuild
If a historical transaction is edited/deleted/imported, the system must be able to rebuild the balance from the relevant checkpoint/ledger and return to a correct state.

### BR-W009 — Backdated Transactions
A transaction dated before the current checkpoint must not silently corrupt CurrentBalance. It must trigger an appropriate rebuild/correction path.

## 4. Credit Cards

### BR-C001 — Credit Limit
Available credit = Credit Limit - Current Debt, subject to the application's handling of pending/authorized amounts.

### BR-C002 — Current Debt
Current Debt is the outstanding card liability.

### BR-C003 — Statement Balance
Statement Balance is the amount closed in a statement cycle. It is not the same field as Current Debt.

### BR-C004 — Payment
A payment reduces card debt and reduces the source DEBIT wallet. It must not create a second expense.

### BR-C005 — Partial Payment
Partial payment is supported. Paid Amount increases and Remaining Statement Amount decreases.

### BR-C006 — Statement Closing
Closing a statement freezes the relevant cycle into a statement record; it must not reset Current Debt to zero.

### BR-C007 — Card Source Wallet
Card settlement must use the configured default source wallet or an explicitly selected wallet.

## 5. Pre-order / Purchase

### BR-P001 — Pre-order
A PRE-ORDER that has not actually been captured/charged must not silently reduce the DEBIT wallet.

### BR-P002 — Capture
When a card charge is actually captured/posted according to the app's defined event, the card liability and economic expense must be recognized exactly once.

### BR-P003 — Cancellation Before Capture
Canceling an uncaptured pre-order must not create a wallet outflow or card debt.

### BR-P004 — Cancellation After Charge
If a charged order is canceled and awaiting refund, use the cancellation/refund lifecycle without prematurely crediting the wallet before the refund is actually received.

### BR-P005 — Refund Received
When the refund is actually received, the relevant wallet/card balance and expense/refund accounting must update exactly once.

### BR-P006 — Inventory
Purchase status, inventory status, and financial status must not contradict each other.

## 6. Business / Sales

### BR-B001 — Purchase Paid Immediately
Immediate purchase decreases the selected business funding wallet and records business expense/purchase.

### BR-B002 — Business Pre-order
Business pre-order does not reduce the source DEBIT wallet until the actual payment/charge event occurs.

### BR-B003 — Immediate Sale
A customer who pays immediately creates cash inflow to the selected wallet.

### BR-B004 — Customer Debt
A sale on credit creates a receivable and does not increase wallet balance until payment is received.

### BR-B005 — Customer Payment
Collecting a receivable increases the selected wallet and decreases the receivable.

## 7. Personal Debt

### BR-D001 — Lending
When the user lends money, the user's wallet decreases and a receivable is created.

### BR-D002 — Borrowing
When the user borrows money, the user's wallet increases and a payable is created.

### BR-D003 — Partial Debt Payment
Partial repayment reduces the outstanding debt by exactly the paid amount.

### BR-D004 — Full Settlement
Full settlement reduces the outstanding debt to zero and creates the corresponding wallet movement.

### BR-D005 — Debt Edit/Delete
Editing/deleting a debt-related transaction must keep wallet, ledger, and debt balances synchronized.

## 8. Family / Group Split

### BR-F001 — Expense Snapshot
A group expense stores enough normalized information to reproduce the split calculation later.

### BR-F002 — Payer
If ME pays the whole group expense from a personal wallet, the wallet outflow equals the full amount paid.

### BR-F003 — Personal Cost
The payer's personal economic cost equals the payer's calculated share, not necessarily the full cash outflow.

### BR-F004 — Receivable
Other members' shares owed to ME become receivables/debts when the expense is finalized according to the app workflow.

### BR-F005 — Split Total
Sum of all calculated member shares must equal the expense amount after the defined rounding rule.

### BR-F006 — Equal Split
Equal split distributes the amount equally subject to rounding.

### BR-F007 — Weight Split
Weight split follows member weights.

### BR-F008 — Child Weight
Child member weight may be 0.5 where configured.

### BR-F009 — Percentage Split
Percentage shares must total 100% after allowed rounding/tolerance.

### BR-F010 — Manual Split
Manual calculated/input values must reconcile to the total expense.

### BR-F011 — Settlement
A settlement reduces the payer's receivable and creates the actual wallet movement between payer and payer-back member(s).

### BR-F012 — Finalize Idempotency
Finalizing a group settlement twice must not create duplicate debt or wallet movements.

## 9. Inventory

### BR-I001 — Stock Increase
Receiving valid purchased stock increases inventory.

### BR-I002 — Stock Decrease
A valid sale/consumption decreases inventory.

### BR-I003 — No Negative Stock
Inventory must not become negative unless explicitly supported by business rules.

### BR-I004 — Cancellation
Canceled orders must not create phantom inventory.

### BR-I005 — Refund/Return
Returned/refunded goods must update stock only according to the actual physical return state.

## 10. Reports

### BR-R001 — Single Economic Event
The same economic event must not be counted twice across reports.

### BR-R002 — Transfer Exclusion
Internal transfers are excluded from expense totals.

### BR-R003 — Card Payment Exclusion
Credit-card payments are excluded from expense totals because the original purchase is already the expense.

### BR-R004 — Refund
Reports must show the correct gross/net treatment of refunds according to the source transaction.

### BR-R005 — Monthly/Yearly Consistency
Monthly and yearly totals must reconcile with the underlying ledger.

## 11. Security

### BR-S001 — Server-side Verification
Sensitive card credentials/PIN validation must not depend on a hardcoded secret in frontend HTML/JS.

### BR-S002 — Masking
Card number, expiry, and CVV/CSV are masked by default.

### BR-S003 — Unlock
Correct authentication is required before revealing sensitive data.

### BR-S004 — Auto-lock
Sensitive card view automatically locks after the configured inactivity period (currently 60 seconds).

### BR-S005 — Authorization
Client-side hiding is not considered sufficient protection for sensitive card data.

## 12. Concurrency / Reliability

### BR-X001 — Double Submit
Double click or repeated requests must be idempotent.

### BR-X002 — Concurrent Requests
Concurrent writes must not corrupt balances or create duplicate ledger entries.

### BR-X003 — Atomicity
A financial operation that spans multiple records should either complete consistently or leave a recoverable error state.

### BR-X004 — Auditability
Every material financial movement should be traceable to its source module/source transaction.

## 13. Important Clarification

The exact moment when a PRE-ORDER becomes an official card expense must be ONE clearly defined event, preferably:
`PRE-ORDER -> CAPTURED/CHARGED -> Card Debt + Expense exactly once -> POSTED/STATEMENT`.

Do not implement both "expense immediately at PRE-ORDER" and "expense again at capture".

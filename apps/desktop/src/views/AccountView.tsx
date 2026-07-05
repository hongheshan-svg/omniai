import type { CreditAmount, CreditPackage, Order, SessionResponse } from "@gw-link-omniai/shared";
import { formatCreditBalance } from "../creditModel";
import { buildReceiptLines, formatDateTime, formatMoney, formatPackagePrice, getOrderStatusLabel } from "../orderModel";

export interface AccountViewProps {
  session: SessionResponse;
  balance?: CreditAmount;
  packages: CreditPackage[];
  orders: Order[];
  selectedOrderId: string | null;
  purchaseOpen: boolean;
  onTopUp(): void;
  onBuy(pkg: CreditPackage): void;
  onDevComplete(orderId: string): void;
  onSelectOrder(orderId: string | null): void;
  onCopyReceipt(order: Order, packageName: string): void;
  onOpenPurchase(): void;
  onClosePurchase(): void;
}

export function AccountView({
  session,
  balance,
  packages,
  orders,
  selectedOrderId,
  purchaseOpen,
  onTopUp,
  onBuy,
  onDevComplete,
  onSelectOrder,
  onCopyReceipt,
  onOpenPurchase,
  onClosePurchase
}: AccountViewProps) {
  return (
    <>
      <div className="account-grid">
        <section aria-label="账户信息" className="card stack">
          <h2>账户</h2>
          {session.user ? (
            <>
              <p>{session.user.displayName}</p>
              <p className="muted">{session.user.destination}</p>
              <p className="muted">套餐计划：{session.user.plan}</p>
            </>
          ) : null}
        </section>

        <section aria-label="点数" className="card stack">
          <h2>点数余额</h2>
          {balance ? (
            <div className="row">
              <span className="chip">
                <span className="spark" aria-hidden="true" />
                {formatCreditBalance(balance)}
              </span>
              <button type="button" className="btn-sm" onClick={onTopUp}>
                充值
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={onOpenPurchase}>
                选购套餐
              </button>
            </div>
          ) : (
            <p className="empty">余额加载中</p>
          )}
        </section>

        <section aria-label="订单" className="card stack">
          <h2>订单</h2>
          {orders.length === 0 ? (
            <p className="empty">暂无订单</p>
          ) : (
            <div className="stack">
              {orders.map((order) => {
                const expanded = order.id === selectedOrderId;
                const packageName = packages.find((pkg) => pkg.id === order.packageId)?.displayName ?? order.packageId;
                return (
                  <div className="item" key={order.id}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>
                        {packageName} ·{" "}
                        <span className={`status status--${order.status}`}>{getOrderStatusLabel(order.status)}</span>
                      </span>
                      <button type="button" className="btn-sm" onClick={() => onSelectOrder(expanded ? null : order.id)}>
                        {expanded ? "收起" : "查看"}
                      </button>
                    </div>
                    {order.status === "pending" && (
                      <div className="actions">
                        {order.checkoutUrl ? <a href={order.checkoutUrl}>去支付</a> : null}
                        <button type="button" className="btn-sm" onClick={() => onDevComplete(order.id)}>
                          （开发）完成支付
                        </button>
                      </div>
                    )}
                    {expanded && (
                      <div aria-label="订单详情" className="detail">
                        <p>订单号：{order.id}</p>
                        <p>套餐：{packageName}</p>
                        <p>积分：{order.credits}</p>
                        <p>金额：{formatMoney(order.amountCents, order.currency)}</p>
                        <p>状态：{getOrderStatusLabel(order.status)}</p>
                        <p>下单时间：{formatDateTime(order.createdAt)}</p>
                        {order.paidAt && <p>付款时间：{formatDateTime(order.paidAt)}</p>}
                        <p>凭证：{order.checkoutRef}</p>
                        {order.status === "paid" && (
                          <>
                            <dl aria-label="收据" className="receipt">
                              {buildReceiptLines(order, packageName).map((line) => (
                                <div key={line.label}>
                                  <dt>{line.label}</dt>
                                  <dd>{line.value}</dd>
                                </div>
                              ))}
                            </dl>
                            <button type="button" className="btn-sm" onClick={() => onCopyReceipt(order, packageName)}>
                              复制收据
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {purchaseOpen ? (
        <div className="modal-backdrop" onClick={onClosePurchase}>
          <div aria-label="购买积分" className="modal stack" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="row">
              <h2>购买积分</h2>
              <div className="spacer" />
              <button type="button" className="btn-sm" onClick={onClosePurchase}>
                关闭
              </button>
            </div>
            {packages.map((pkg) => (
              <div className="pkg" key={pkg.id}>
                <div>
                  <div style={{ fontWeight: 600 }}>{pkg.displayName}</div>
                  <div className="pkg-meta">{pkg.credits} 积分</div>
                </div>
                <div className="row">
                  <span className="pkg-price">{formatPackagePrice(pkg)}</span>
                  <button type="button" className="btn-primary btn-sm" onClick={() => onBuy(pkg)}>
                    购买 {pkg.displayName}
                  </button>
                </div>
              </div>
            ))}
            {orders[0] && orders[0].status === "pending" ? (
              <div className="item stack">
                <h3>最新订单</h3>
                <div className="actions" style={{ marginTop: 0 }}>
                  {orders[0].checkoutUrl ? <a href={orders[0].checkoutUrl}>去支付</a> : null}
                  <button type="button" className="btn-sm" onClick={() => onDevComplete(orders[0].id)}>
                    （开发）完成支付
                  </button>
                </div>
              </div>
            ) : null}
            {orders[0] && orders[0].status === "paid" ? (
              <p className="muted">
                最新订单：<span className="status status--paid">已支付</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

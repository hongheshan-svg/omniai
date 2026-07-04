"use client";
import { useEffect, useState } from "react";
import { createApiClient, type ApiClient, type Order, formatMoney, formatDateTime, getOrderStatusLabel } from "@gw-link-omniai/shared";
import { summarizeOrders } from "./ordersDashboardModel";

export function OrdersSection({ client, token }: { client?: ApiClient; token?: string } = {}) {
  const [orders, setOrders] = useState<Order[] | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }
    const api = client ?? createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL });
    let cancelled = false;
    api
      .listAllOrders(token)
      .then((loaded) => {
        if (!cancelled) {
          setOrders(loaded);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, token]);

  if (!token) {
    return <p>请先登录</p>;
  }
  if (error) {
    return <p>订单加载失败，请稍后重试</p>;
  }
  if (!orders) {
    return <p>加载中…</p>;
  }

  const summary = summarizeOrders(orders);
  return (
    <div>
      <dl aria-label="订单概览">
        <div>{`总数：${summary.total}`}</div>
        <div>{`已付：${summary.paid}`}</div>
        <div>{`待付：${summary.pending}`}</div>
        <div>{`失败：${summary.failed}`}</div>
        <div>{`营收：${formatMoney(summary.revenueCents, "CNY")}`}</div>
        <div>{`售出积分：${summary.creditsSold}`}</div>
      </dl>
      <ul aria-label="订单列表">
        {orders.map((order) => (
          <li key={order.id}>
            <span>{order.id}</span>
            <span>{order.packageId}</span>
            <span>{getOrderStatusLabel(order.status)}</span>
            <span>{formatMoney(order.amountCents, order.currency)}</span>
            <span>{formatDateTime(order.createdAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

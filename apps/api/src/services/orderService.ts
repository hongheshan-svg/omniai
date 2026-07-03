import { randomUUID } from "node:crypto";
import type { Order } from "@gw-link-omniai/shared";
import type { OrderRecord, OrderRepository } from "../repositories/types";
import { InMemoryOrderRepository } from "../repositories/memory";
import { PackageCatalogError, type PackageCatalog } from "./packageCatalog";

export interface OrderServiceClock {
  now(): Date;
}

export interface OrderServiceOptions {
  idGenerator?: () => string;
  checkoutRefGenerator?: () => string;
  clock?: OrderServiceClock;
}

export class OrderServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "OrderServiceError";
  }
}

export interface OrderService {
  createOrder(userId: string, packageId: string): Promise<Order>;
  listOrders(userId: string): Promise<Order[]>;
  getOrder(userId: string, orderId: string): Promise<Order | null>;
}

function toOrder(record: OrderRecord): Order {
  return {
    id: record.id,
    packageId: record.packageId,
    credits: record.credits,
    amountCents: record.amountCents,
    currency: record.currency,
    status: record.status,
    checkoutRef: record.checkoutRef,
    createdAt: record.createdAt,
    ...(record.paidAt !== undefined ? { paidAt: record.paidAt } : {})
  };
}

export class OrderServiceImpl implements OrderService {
  private readonly orders: OrderRepository;
  private readonly catalog: PackageCatalog;
  private readonly idGenerator: () => string;
  private readonly checkoutRefGenerator: () => string;
  private readonly clock: OrderServiceClock;

  constructor(orders: OrderRepository, catalog: PackageCatalog, options: OrderServiceOptions = {}) {
    this.orders = orders;
    this.catalog = catalog;
    this.idGenerator = options.idGenerator ?? (() => `order_${randomUUID()}`);
    this.checkoutRefGenerator = options.checkoutRefGenerator ?? (() => `checkout_${randomUUID()}`);
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async createOrder(userId: string, packageId: string): Promise<Order> {
    let pkg;
    try {
      pkg = this.catalog.getPackage(packageId);
    } catch (error) {
      if (error instanceof PackageCatalogError) {
        throw new OrderServiceError(error.message, error.statusCode);
      }
      throw error;
    }
    const record: OrderRecord = {
      id: this.idGenerator(),
      packageId: pkg.id,
      credits: pkg.credits,
      amountCents: pkg.amountCents,
      currency: pkg.currency,
      status: "pending",
      checkoutRef: this.checkoutRefGenerator(),
      createdAt: this.clock.now().toISOString()
    };
    await this.orders.insert(record, userId);
    return toOrder(record);
  }

  async listOrders(userId: string): Promise<Order[]> {
    const records = await this.orders.listByOwner(userId);
    return records.map(toOrder);
  }

  async getOrder(userId: string, orderId: string): Promise<Order | null> {
    const record = await this.orders.get(userId, orderId);
    return record ? toOrder(record) : null;
  }
}

export class InMemoryOrderService extends OrderServiceImpl {
  constructor(catalog: PackageCatalog, options: OrderServiceOptions = {}) {
    super(new InMemoryOrderRepository(), catalog, options);
  }
}

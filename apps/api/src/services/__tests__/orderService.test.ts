import { describe, expect, it } from "vitest";
import { ConfigPackageCatalog } from "../packageCatalog";
import { InMemoryOrderRepository } from "../../repositories/memory";
import { OrderServiceImpl, OrderServiceError, InMemoryOrderService } from "../orderService";
import { FakeCheckoutProvider } from "../fakeCheckoutProvider";
import { PaymentProviderError, type PaymentProvider } from "../paymentProvider";

function makeService() {
  const catalog = new ConfigPackageCatalog({
    packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
  });
  let seq = 0;
  return new OrderServiceImpl(new InMemoryOrderRepository(), catalog, {
    idGenerator: () => `order_${++seq}`,
    checkoutRefGenerator: () => `checkout_${seq}`,
    clock: { now: () => new Date("2026-07-03T00:00:00.000Z") }
  });
}

describe("OrderServiceImpl", () => {
  it("creates a pending order from a package", async () => {
    const order = await makeService().createOrder("user-a", "credits-100");
    expect(order).toEqual({
      id: "order_1",
      packageId: "credits-100",
      credits: 100,
      amountCents: 990,
      currency: "CNY",
      status: "pending",
      checkoutRef: "checkout_1",
      createdAt: "2026-07-03T00:00:00.000Z",
      checkoutUrl: "http://localhost/checkout/mock?ref=checkout_1"
    });
  });

  it("throws a 404 for an unknown package", async () => {
    await expect(makeService().createOrder("user-a", "nope")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("lists a user's own orders only", async () => {
    const service = makeService();
    await service.createOrder("user-a", "credits-100");
    await service.createOrder("user-b", "credits-100");
    const listA = await service.listOrders("user-a");
    expect(listA).toHaveLength(1);
    expect(listA[0].id).toBe("order_1");
  });

  it("does not leak internal references (defensive clone)", async () => {
    const service = makeService();
    const order = await service.createOrder("user-a", "credits-100");
    order.status = "paid";
    const [reloaded] = await service.listOrders("user-a");
    expect(reloaded.status).toBe("pending");
  });

  it("gets a user's own order by id", async () => {
    const service = makeService();
    const created = await service.createOrder("user-a", "credits-100");
    expect(await service.getOrder("user-a", created.id)).toMatchObject({ id: created.id, status: "pending" });
    expect(await service.getOrder("user-b", created.id)).toBeNull();
    expect(await service.getOrder("user-a", "missing")).toBeNull();
  });

  it("sets checkoutUrl from the configured payment provider", async () => {
    const catalog = new ConfigPackageCatalog({
      packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
    });
    const service = new InMemoryOrderService(catalog, {
      paymentProvider: new FakeCheckoutProvider("https://app.test"),
      idGenerator: () => "order_1",
      checkoutRefGenerator: () => "chk_1"
    });
    const order = await service.createOrder("user-a", "credits-100");
    expect(order.checkoutUrl).toBe("https://app.test/checkout/mock?ref=chk_1");
  });

  it("translates a PaymentProviderError into an OrderServiceError with the same statusCode", async () => {
    const catalog = new ConfigPackageCatalog({
      packages: [{ id: "credits-100", displayName: "100 积分", credits: 100, amountCents: 990, currency: "CNY" }]
    });
    const failingProvider: PaymentProvider = {
      async createCheckout() {
        throw new PaymentProviderError("boom", 502);
      }
    };
    const service = new InMemoryOrderService(catalog, {
      paymentProvider: failingProvider,
      idGenerator: () => "order_1",
      checkoutRefGenerator: () => "chk_1"
    });
    await expect(service.createOrder("user-a", "credits-100")).rejects.toMatchObject({
      statusCode: 502
    });
    await expect(service.createOrder("user-a", "credits-100")).rejects.toBeInstanceOf(OrderServiceError);
  });
});

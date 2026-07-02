"use client";
import { useEffect, useState } from "react";
import { createApiClient, type ApiClient, type ProductModel } from "@gw-link-omniai/shared";
import { formatModelSummary } from "./catalogModel";

export function ModelCatalogSection({ client }: { client?: ApiClient } = {}) {
  const [models, setModels] = useState<ProductModel[] | undefined>(undefined);
  const [error, setError] = useState(false);

  useEffect(() => {
    const api = client ?? createApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL });
    let cancelled = false;
    api
      .listModels()
      .then((loaded) => {
        if (!cancelled) {
          setModels(loaded);
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
  }, [client]);

  if (error) {
    return <p>模型目录加载失败，请稍后重试</p>;
  }
  if (!models) {
    return <p>加载中…</p>;
  }
  return (
    <ul aria-label="Model catalog">
      {models.map((model) => (
        <li key={model.id}>
          <span>{model.displayName}</span>
          <span>{formatModelSummary(model)}</span>
        </li>
      ))}
    </ul>
  );
}

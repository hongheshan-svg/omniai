import { useMemo } from "react";
import type { CreationAsset } from "@gw-link-omniai/shared";
import { filterCreationAssets, getAssetFilterLabel, summarizeAssetPrompt, type AssetFilter } from "@gw-link-omniai/shared";

const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];

export interface AssetsViewProps {
  assets: CreationAsset[];
  filter: AssetFilter;
  onFilterChange(filter: AssetFilter): void;
}

export function AssetsView({ assets, filter, onFilterChange }: AssetsViewProps) {
  const filteredAssets = useMemo(() => filterCreationAssets(assets, filter), [assets, filter]);
  return (
    <section aria-label="资产库" className="stack">
      <div className="asset-toolbar">
        <h2>资产库</h2>
        <nav aria-label="资产过滤" className="filters">
          {assetFilters.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={filter === candidate}
              onClick={() => onFilterChange(candidate)}
            >
              {getAssetFilterLabel(candidate)}
            </button>
          ))}
        </nav>
      </div>
      {filteredAssets.length === 0 ? (
        <p className="empty">暂无资产</p>
      ) : (
        <ol className="items">
          {filteredAssets.map((asset) => (
            <li key={asset.id}>
              <article className="item">
                <h3>{asset.title}</h3>
                <p>{asset.preview.description}</p>
                {asset.content.kind === "image" ? <img src={asset.content.url} alt={asset.content.alt} /> : null}
                {asset.content.kind === "video" ? (
                  <video controls src={asset.content.url} poster={asset.content.posterUrl} />
                ) : null}
                <p className="muted">{summarizeAssetPrompt(asset)}</p>
                <p className="muted">{asset.preset.modelId}</p>
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

import { useMemo } from "react";
import type { CreationAsset } from "@gw-link-omniai/shared";
import { filterCreationAssets, getAssetFilterLabel, type AssetFilter } from "@gw-link-omniai/shared";
import { formatDateTime } from "../orderModel";

const assetFilters: AssetFilter[] = ["all", "text", "image", "video"];

export interface AssetsViewProps {
  assets: CreationAsset[];
  filter: AssetFilter;
  selectedAssetId: string | null;
  onFilterChange(filter: AssetFilter): void;
  onSelectAsset(assetId: string | null): void;
  onCopyAssetText(asset: CreationAsset): void;
}

export function AssetsView({ assets, filter, selectedAssetId, onFilterChange, onSelectAsset, onCopyAssetText }: AssetsViewProps) {
  const filteredAssets = useMemo(() => filterCreationAssets(assets, filter), [assets, filter]);
  const selectedAsset = assets.find((asset) => asset.id === selectedAssetId);

  return (
    <section aria-label="资产库" className="stack">
      <div className="asset-toolbar">
        <h2>资产库</h2>
        <nav aria-label="资产过滤" className="filters">
          {assetFilters.map((candidate) => (
            <button key={candidate} type="button" aria-pressed={filter === candidate} onClick={() => onFilterChange(candidate)}>
              {getAssetFilterLabel(candidate)}
            </button>
          ))}
        </nav>
      </div>

      {filteredAssets.length === 0 ? (
        <div className="canvas-empty">
          <h2>还没有资产</h2>
          <p>生成满意的结果后，点「保存到资产库」就会出现在这里。</p>
        </div>
      ) : (
        <div className="asset-grid">
          {filteredAssets.map((asset) => (
            <button key={asset.id} type="button" className="asset-card" aria-label={asset.title} onClick={() => onSelectAsset(asset.id)}>
              <span className="asset-thumb">
                {asset.content.kind === "image" ? (
                  <img src={asset.content.url} alt={asset.content.alt} />
                ) : asset.content.kind === "video" ? (
                  <img src={asset.content.posterUrl} alt="" />
                ) : (
                  <span aria-hidden="true">文</span>
                )}
              </span>
              <span className="asset-overlay">
                <span>{asset.title}</span>
                <span className="muted">{formatDateTime(asset.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedAsset ? (
        <aside aria-label="资产详情" className="asset-panel">
          <button type="button" className="btn-sm panel-close" onClick={() => onSelectAsset(null)}>
            关闭
          </button>
          {selectedAsset.content.kind === "image" ? (
            <img src={selectedAsset.content.url} alt={selectedAsset.content.alt} />
          ) : null}
          {selectedAsset.content.kind === "video" ? (
            <video controls src={selectedAsset.content.url} poster={selectedAsset.content.posterUrl} />
          ) : null}
          {selectedAsset.content.kind === "text" ? <p className="canvas-text">{selectedAsset.content.text}</p> : null}
          <h2>{selectedAsset.title}</h2>
          <p>{selectedAsset.prompt}</p>
          <p className="muted">{selectedAsset.optimizedPrompt}</p>
          <p className="muted">{selectedAsset.preset.modelId}</p>
          <p className="muted">{formatDateTime(selectedAsset.createdAt)}</p>
          <div className="actions">
            {selectedAsset.content.kind === "text" ? (
              <button type="button" className="btn-sm" onClick={() => onCopyAssetText(selectedAsset)}>
                复制文本
              </button>
            ) : (
              <a className="btn-sm" href={selectedAsset.content.url} download>
                下载
              </a>
            )}
          </div>
        </aside>
      ) : null}
    </section>
  );
}

const staleProductionAssetCodes = new Set([
  'SLASH_ASSET_NOT_FOUND',
  'SNAPSHOT_NOT_FOUND',
  'STALE_REVIEW_SNAPSHOT',
  'ASSET_NOT_FOUND',
  'MEDIA_NOT_FOUND',
  'MEDIA_ASSET_NOT_ACCESSIBLE'
]);

type ErrorLike = {
  status?: number;
  code?: string;
};

export function isStaleProductionAssetError(error: unknown) {
  const item = error as ErrorLike | null | undefined;
  return item?.status === 404 || item?.status === 409 || staleProductionAssetCodes.has(item?.code || '');
}

export function staleProductionAssetMessage(prefix = '素材已失效') {
  return `${prefix}：团队素材已更新、归档或无权访问，列表已刷新，请重新选择。`;
}

export function notifyProductionAssetsChanged(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('jiying:production-assets-changed', { detail }));
}

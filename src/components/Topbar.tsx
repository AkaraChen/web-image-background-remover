import { getRuntime, useCutoutStore } from '../store/cutout-store';

export function Topbar() {
  const tab = useCutoutStore((s) => s.tab);
  const downloadsDisabled = useCutoutStore((s) => s.downloadsDisabled);

  return (
    <header className="topbar">
      <a
        className="brand"
        href="/"
        id="btn-home"
        aria-label="回到上传"
        onClick={(e) => {
          e.preventDefault();
          getRuntime().resetToUpload();
        }}
      >
        <span className="logo" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <circle cx="16" cy="16" r="16" fill="#0F70E6" />
            <path
              fill="#fff"
              d="M16.2 8.4c1.7 0 3 1.3 3 3s-1.3 3-3 3-3-1.3-3-3 1.3-3 3-3Zm-5.3 8.2c.4-1.2 2.2-2 5.3-2s4.9.8 5.3 2l1.5 5.2c.2.6-.2 1.2-.8 1.2h-2.1l-.5 1.8c-.1.5-.6.8-1.1.6l-2.3-.8-2.3.8c-.5.2-1-.1-1.1-.6l-.5-1.8H9.2c-.6 0-1-.6-.8-1.2l1.5-5.2Z"
            />
          </svg>
        </span>
        <span className="wordmark">抠图台</span>
      </a>

      <nav className="editor-tabs editor-only" id="editor-tabs" role="tablist" aria-label="编辑工具">
        <button
          type="button"
          role="tab"
          data-tab="cutout"
          className={tab === 'cutout' ? 'active' : undefined}
          aria-selected={tab === 'cutout'}
          onClick={() => getRuntime().setTab('cutout')}
        >
          抠图
        </button>
        <button
          type="button"
          role="tab"
          data-tab="background"
          className={tab === 'background' ? 'active' : undefined}
          aria-selected={tab === 'background'}
          onClick={() => getRuntime().setTab('background')}
        >
          背景
        </button>
        <button
          type="button"
          role="tab"
          data-tab="adjust"
          className={tab === 'adjust' ? 'active' : undefined}
          aria-selected={tab === 'adjust'}
          onClick={() => getRuntime().setTab('adjust')}
        >
          调整
        </button>
        <button type="button" id="btn-advanced" data-testid="btn-advanced" aria-haspopup="dialog" onClick={() => getRuntime().openAdvanced()}>
          高级
        </button>
      </nav>

      <div className="top-actions">
        <button type="button" id="btn-new" className="ghost editor-only" onClick={() => getRuntime().resetToUpload()}>
          新图片
        </button>
        <div className="header-download editor-only">
          <button
            id="btn-download-mask"
            className="ghost"
            disabled={downloadsDisabled}
            data-testid="btn-download-mask"
            onClick={() => getRuntime().downloadMask()}
          >
            下载遮罩
          </button>
          <button
            id="btn-download"
            className="primary pill"
            disabled={downloadsDisabled}
            data-testid="btn-download"
            onClick={() => getRuntime().downloadResult()}
          >
            下载
          </button>
        </div>
      </div>
    </header>
  );
}

import { DTYPE_OPTIONS, MODEL_OPTIONS } from '../cutout/runtime';
import { host } from '../cutout/host';
import { getRuntime, useCutoutStore } from '../store/cutout-store';

export function AdvancedDialog() {
  const modelId = useCutoutStore((s) => s.modelId);
  const dtype = useCutoutStore((s) => s.dtype);
  const device = useCutoutStore((s) => s.device);
  const modelNote = useCutoutStore((s) => s.modelNote);
  const progressHidden = useCutoutStore((s) => s.progressHidden);
  const progressPct = useCutoutStore((s) => s.progressPct);
  const progressLabel = useCutoutStore((s) => s.progressLabel);
  const badgeDevice = useCutoutStore((s) => s.badgeDevice);
  const badgeDeviceClass = useCutoutStore((s) => s.badgeDeviceClass);
  const badgeModel = useCutoutStore((s) => s.badgeModel);
  const badgeModelClass = useCutoutStore((s) => s.badgeModelClass);

  return (
    <dialog
      id="adv-dialog"
      className="adv-dialog"
      data-testid="adv-dialog"
      aria-labelledby="adv-title"
      ref={(el) => {
        host.advDialog = el;
      }}
      onClick={(e) => getRuntime().onAdvancedBackdrop(e.nativeEvent)}
    >
      <div className="adv-head">
        <h2 id="adv-title">高级设置</h2>
        <button type="button" className="adv-close" id="adv-close" data-testid="adv-close" aria-label="关闭" onClick={() => getRuntime().closeAdvanced()}>
          ✕
        </button>
      </div>
      <div className="adv-body">
        <div className="adv-group">
          <span className="tool-kicker">模型</span>
          <select id="sel-model" aria-label="识别模型" value={modelId} onChange={(e) => getRuntime().setModelId(e.target.value)}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="hint" id="model-note" title={modelNote}>
            {modelNote}
          </p>
        </div>
        <div className="adv-group">
          <span className="tool-kicker">运行方式</span>
          <div className="field-pair">
            <select id="sel-device" aria-label="后端" title="推理后端" value={device} onChange={(e) => getRuntime().setDevice(e.target.value)}>
              <option value="auto">自动后端</option>
              <option value="webgpu">WebGPU</option>
              <option value="wasm">WASM (CPU)</option>
            </select>
            <select id="sel-dtype" aria-label="精度" title="权重精度" value={dtype} onChange={(e) => getRuntime().setDtype(e.target.value)}>
              {DTYPE_OPTIONS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="adv-group">
          <span className="tool-kicker">会话</span>
          <div className="icon-actions">
            <button id="btn-load" className="primary compact" onClick={() => void getRuntime().loadClicked()}>
              载入模型
            </button>
            <button id="btn-release" className="ghost" onClick={() => getRuntime().releaseClicked()}>
              释放
            </button>
          </div>
          <div className="badges">
            <span className={badgeDeviceClass} id="badge-device">
              {badgeDevice}
            </span>
            <span className={badgeModelClass} id="badge-model">
              {badgeModel}
            </span>
          </div>
          <div className="progress" id="progress" hidden={progressHidden}>
            <div className="bar">
              <i id="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="progress-label" id="progress-label">
              {progressLabel}
            </span>
          </div>
        </div>
      </div>
    </dialog>
  );
}
